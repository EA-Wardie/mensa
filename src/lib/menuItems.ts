import type { MenuItem } from "../components/Menu";
import { copyToClipboard } from "./actions";
import { COPY_ICON, VIEW_ICON } from "./consts";
import { rowAsCsv, rowAsJson } from "./export";
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

// Copies the row as it was when the menu opened.
export function copyRowItems(source: GridSource, row: number): MenuItem[] {
	const values: Value[] = source.rows[row] ?? [];

	return [
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

// Copies a column's, table's or tab's name as the database gives it.
export function copyNameItem(name: string): MenuItem {
	return {
		label: `${COPY_ICON} Copy name`,
		onSelect: (): void => {
			copyToClipboard(name);
		},
	};
}
