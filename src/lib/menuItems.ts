import type { MenuItem } from "../components/Menu";
import { copyToClipboard } from "./actions";
import { COPY_ICON, EDIT_ICON, VIEW_ICON } from "./consts";
import { editRow } from "./editor";
import { rowAsCsv, rowAsJson, rowsAsCsv, rowsAsJson } from "./export";
import type { GridSource } from "./grid";
import { SHORTCUTS, shortcutLabel } from "./shortcuts";
import type { Value } from "./store";
import { viewRow } from "./viewer";

// The row menu items both grids have.
export function viewRowItem(row: number): MenuItem {
	return {
		label: `${VIEW_ICON} View`,
		shortcut: shortcutLabel(SHORTCUTS.viewRow),
		onSelect: (): void => {
			viewRow(row, null);
		},
	};
}

// A table's E edits its row, while a query's edits its SQL, so only a table's
// item shows the shortcut.
export function editRowItem(row: number, shortcut: boolean): MenuItem {
	return {
		label: `${EDIT_ICON} Edit`,
		...(shortcut ? { shortcut: shortcutLabel(SHORTCUTS.editRow) } : {}),
		onSelect: (): void => {
			editRow(row, null);
		},
	};
}

// Copies the row, and the column's cell unless it's NULL, as they were when
// the menu opened. The cell is copied as the database gave it.
export function copyRowItems(
	source: GridSource,
	row: number,
	column: string | null,
): MenuItem[] {
	const values: Value[] = source.rows[row] ?? [];
	const cell: Value | undefined =
		column === null ? undefined : values[source.columns.indexOf(column)];
	const cellItems: MenuItem[] =
		typeof cell === "string"
			? [
					{
						label: `${COPY_ICON} Copy cell`,
						onSelect: (): void => {
							copyToClipboard(cell);
						},
					},
				]
			: [];

	return [
		...cellItems,
		{
			label: `${COPY_ICON} Copy row as CSV`,
			onSelect: (): void => {
				copyToClipboard(rowAsCsv(source.columns, values));
			},
		},
		{
			label: `${COPY_ICON} Copy row as JSON`,
			onSelect: (): void => {
				copyToClipboard(rowAsJson(source.columns, source.kinds, values));
			},
		},
	];
}

// Copies the marked rows as they were when the menu opened, in grid order.
// There are none without marks.
export function copyMarkedItems(
	source: GridSource,
	marks: ReadonlySet<number>,
): MenuItem[] {
	if (!marks.size) {
		return [];
	}

	const rows: () => Value[][] = (): Value[][] =>
		[...marks]
			.sort((a: number, b: number): number => a - b)
			.map((index: number): Value[] => source.rows[index] ?? []);

	return [
		{
			label: `${COPY_ICON} Copy marked as CSV`,
			onSelect: (): void => {
				copyToClipboard(rowsAsCsv(source.columns, rows()));
			},
		},
		{
			label: `${COPY_ICON} Copy marked as JSON`,
			onSelect: (): void => {
				copyToClipboard(rowsAsJson(source.columns, source.kinds, rows()));
			},
		},
	];
}

// Copies a column's, table's or tab's name as the database gives it.
export function copyNameItem(name: string): MenuItem {
	return {
		label: `${COPY_ICON} Copy name`,
		onSelect: (): void => {
			copyToClipboard(name);
		},
	};
}
