import type * as core from "@opentui/core";
import { DoubleClick } from "../lib/clicks";
import { canEditRows, editRow } from "../lib/editor";
import { plural } from "../lib/format";
import { type GridSource, gridOf } from "../lib/grid";
import {
	copyMarkedItems,
	copyRowItems,
	editRowItem,
	viewRowItem,
} from "../lib/menuItems";
import { $editor, type QueryResult } from "../lib/store";
import { GridView } from "./GridView";
import { Menu } from "./Menu";

interface Options extends core.RenderableOptions<GridView> {
	runKey: string;
	// A left press on the grid, which takes the focus from the SQL.
	onPress: () => void;
}

// A query tab's rows. A click selects a row and a double click views it, and
// rows from one table can be edited from the menu or the view. A new run
// starts at the top with no selection, while a saved row keeps both. Its query
// view shows an error in its place.
export class ResultGrid extends GridView {
	private _runKey: string;
	private _onPress: () => void;
	private _result: QueryResult | undefined = undefined;
	private _source: GridSource | null = null;
	private _selected: number | null = null;
	private _clicks: DoubleClick<number> = new DoubleClick<number>();

	constructor({ runKey, onPress, ...options }: Options) {
		super(options);

		this._runKey = runKey;
		this._onPress = onPress;
	}

	public static make(options: Options): ResultGrid {
		return new this(options);
	}

	public show(result: QueryResult | undefined): void {
		const previous: QueryResult | undefined = this._result;
		// A saved row replaces the rows of the same run, which keeps its columns.
		const saved: boolean =
			result?.status === "rows" &&
			previous?.status === "rows" &&
			result.columns === previous.columns;

		this._result = result;
		this._source = result?.status === "rows" ? { ...result, meta: null } : null;

		if (!saved) {
			this._selected = null;
		}

		this._clicks.reset();
		this.setGrid(
			this._source ? gridOf(this._source) : null,
			saved ? undefined : { x: 0, y: 0 },
		);
	}

	protected override message(): string | null {
		const result: QueryResult | undefined = this._result;

		switch (result?.status) {
			case undefined:
			case "idle":
				return `Run the query to see its rows (${this._runKey})`;
			case "running":
				return "Running…";
			case "done":
				return result.affected === null
					? (result.command ?? "Done")
					: `${result.command ?? "Done"} · ${plural(result.affected, "row")} affected`;
			default:
				return null;
		}
	}

	public override selectedRow(): number | null {
		return this._selected;
	}

	public override clearSelection(): void {
		this.select(null);
	}

	protected override selectRowAt(row: number): void {
		this.select(row);
	}

	protected override source(): GridSource | null {
		return this._source;
	}

	protected override onPress(): void {
		this._onPress();
	}

	protected override onRowClick(
		row: number | null,
		column: number | null,
	): void {
		if (row === null) {
			this._clicks.reset();

			return;
		}

		const double: boolean = this._clicks.click(row);

		// While the editor is open, the selection stays on its row, and a double
		// click moves the editor's focus.
		if ($editor.get() === null) {
			this.clickRow(row, column, double);
		} else if (double) {
			editRow(row, column);
		}
	}

	protected override onRowMenu(
		event: core.MouseEvent,
		row: number,
		column: number | null,
	): void {
		const source: GridSource | null = this._source;

		if (!source) {
			return;
		}

		this.pickRow(row);

		Menu.make({
			x: event.x,
			y: event.y,
			items: [
				viewRowItem(row),
				...(canEditRows() ? [editRowItem(row, false)] : []),
				"divider",
				...copyRowItems(source, row, column),
				...copyMarkedItems(source, this.marks()),
			],
		});
	}

	// While the editor is open, the selection stays on its row.
	protected override pickRow(row: number): void {
		if ($editor.get() === null) {
			super.pickRow(row);
		}
	}

	protected override resetClicks(): void {
		this._clicks.reset();
	}

	private select(row: number | null): void {
		this._selected = row;

		this.requestRender();
	}
}
