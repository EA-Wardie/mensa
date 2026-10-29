import type * as core from "@opentui/core";
import { deleteRowAt } from "../lib/actions";
import { DoubleClick } from "../lib/clicks";
import { theme } from "../lib/config";
import {
	DELETE_ICON,
	EDIT_ICON,
	SORT_ASC_ICON,
	SORT_DESC_ICON,
} from "../lib/consts";
import { confirmDiscard, editRow } from "../lib/editor";
import { type GridSource, gridFor } from "../lib/grid";
import { unbindOnDestroy } from "../lib/lifetime";
import { copyRowItems, viewRowItem } from "../lib/rowMenu";
import { SHORTCUTS, shortcutLabel } from "../lib/shortcuts";
import {
	$activeTable,
	$activeTableData,
	$editor,
	$selectedRows,
	$sorts,
	$tableData,
	$tabs,
	type Sort,
	type TableData,
} from "../lib/store";
import { selectRow, sortTable } from "../lib/tabs";
import { GridView, type HeaderMarker, type Position } from "./GridView";
import { Menu } from "./Menu";

// A clicked cell, to tell a double click.
interface CellClick {
	row: number;
	column: number | null;
}

// A tab's scroll position, and the sort its rows had then.
interface TablePosition {
	offset: Position;
	sort: Sort | null;
}

// The active table's rows, which it sorts, selects, edits and deletes. The
// query host hides it while a query tab is active.
export class DataGrid extends GridView {
	private _table: string | null = null;
	private _data: TableData | undefined = undefined;
	private _positions: Map<string, TablePosition> = new Map<
		string,
		TablePosition
	>();
	// Reset when the rows change, since a row index means another row then.
	private _clicks: DoubleClick<CellClick> = new DoubleClick<CellClick>(
		(a: CellClick, b: CellClick): boolean =>
			a.row === b.row && a.column === b.column,
	);

	constructor(options: core.RenderableOptions<GridView>) {
		super(options);

		this.registerStoreEvents();
	}

	public static make(options: core.RenderableOptions<GridView> = {}): DataGrid {
		return new this(options);
	}

	protected override message(): string | null {
		if (this._table === null) {
			return "Open a table from the sidebar, or a query with +";
		}

		switch (this._data?.status) {
			case undefined:
			case "loading":
				return "Loading…";
			case "error":
				return this._data.message;
			default:
				return null;
		}
	}

	protected override messageColor(): core.RGBA {
		return this._data?.status === "error" ? theme.danger : theme.muted;
	}

	// With no tabs open, the hint sits in the middle of the empty grid.
	protected override centresMessage(): boolean {
		return $tabs.get().length === 0;
	}

	// While a new sort loads, its chevron is muted, or the old one's if the
	// sort is being removed.
	protected override headerMarker(): HeaderMarker | null {
		const applied: Sort | null = this.loadedSort();
		const requested: Sort | null =
			(this._table === null ? undefined : $sorts.get()[this._table]) ?? null;
		const sort: Sort | null = requested ?? applied;
		const index: number = sort
			? (this.source()?.columns.indexOf(sort.column) ?? -1)
			: -1;

		if (!sort || index < 0) {
			return null;
		}

		return {
			index: index,
			icon: {
				icon: sort.direction === "desc" ? SORT_DESC_ICON : SORT_ASC_ICON,
				color: requested !== applied ? theme.muted : theme.fg,
			},
		};
	}

	public override selectedRow(): number | null {
		return (
			(this._table === null ? undefined : $selectedRows.get()[this._table]) ??
			null
		);
	}

	public override clearSelection(): void {
		selectRow(null);
	}

	protected override selectRowAt(row: number): void {
		selectRow(row);
	}

	protected override source(): GridSource | null {
		return this._data?.status === "loaded" ? this._data : null;
	}

	// Clicking a column name cycles its sort, which reloads the rows and so
	// closes the row editor.
	protected override onHeaderClick(index: number): void {
		const column: string | null = this.columnName(index);

		if (column !== null) {
			confirmDiscard((): void => {
				sortTable(column);
			});
		}
	}

	// While the editor is open, the selection stays on its row, and a double
	// click moves the editor's focus.
	protected override onRowClick(
		row: number | null,
		column: number | null,
	): void {
		if (row === null) {
			this._clicks.reset();

			return;
		}

		const double: boolean = this._clicks.click({ row: row, column: column });

		if ($editor.get() === null) {
			this.clickRow(row, column, double);
		} else if (double) {
			editRow(row, this.columnName(column));
		}
	}

	// Right clicking a row opens its menu, and picks the row unless the editor
	// is open. The menu acts on the rows it was opened on.
	protected override onRowMenu(event: core.MouseEvent, row: number): void {
		const table: string | null = this._table;
		const data: TableData | undefined = this._data;

		if (table === null || data?.status !== "loaded") {
			return;
		}

		if ($editor.get() === null) {
			this.pickRow(row);
		}

		Menu.make({
			x: event.x,
			y: event.y,
			items: [
				viewRowItem(row),
				{
					label: `${EDIT_ICON} Edit`,
					shortcut: shortcutLabel(SHORTCUTS.editRow),
					onSelect: (): void => {
						editRow(row, null);
					},
				},
				"divider",
				...copyRowItems(data, row),
				"divider",
				{
					label: `${DELETE_ICON} Delete`,
					danger: true,
					onSelect: (): void => {
						deleteRowAt({ table: table, rows: data.rows, row: row });
					},
				},
			],
		});
	}

	protected override onScrolled(): void {
		if (this._table !== null) {
			this._positions.set(this._table, {
				offset: this._offset,
				sort: this.loadedSort(),
			});
		}
	}

	// The sort the shown rows have.
	private loadedSort(): Sort | null {
		return this._data?.status === "loaded" ? this._data.sort : null;
	}

	private update(): void {
		const table: string | null = $activeTable.get();
		const data: TableData | undefined = $activeTableData.get();
		const saved: TablePosition | undefined =
			table === null ? undefined : this._positions.get(table);
		// Newly sorted rows start at the top, also when they arrived while
		// another tab was shown. A failed sort keeps the rows and where they
		// were scrolled to.
		const resorted: boolean =
			data?.status === "loaded" &&
			saved !== undefined &&
			data.sort !== saved.sort;
		let offset: Position = this._offset;

		if (table !== this._table || resorted) {
			const position: Position = saved?.offset ?? { x: 0, y: 0 };

			offset = resorted ? { x: position.x, y: 0 } : position;
		}

		this._table = table;
		if (data !== this._data) {
			this._clicks.reset();
		}

		this._data = data;

		for (const name of this._positions.keys()) {
			if (!(name in $tableData.get())) {
				this._positions.delete(name);
			}
		}

		this.setGrid(gridFor(data), offset);
	}

	private registerStoreEvents(): void {
		// $tableData as well as the active table's data, to forget the scroll
		// positions of closed tabs.
		unbindOnDestroy(
			this,
			$activeTable.listen((): void => {
				this.update();
			}),
			$tableData.subscribe((): void => {
				this.update();
			}),
			$sorts.listen((): void => {
				this.requestRender();
			}),
			$selectedRows.listen((): void => {
				this.requestRender();
			}),
		);
	}
}
