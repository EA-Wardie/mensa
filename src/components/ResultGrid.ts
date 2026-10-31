import type * as core from "@opentui/core";
import { DoubleClick } from "../lib/clicks";
import { plural } from "../lib/format";
import { type GridSource, gridOf } from "../lib/grid";
import { copyMarkedItems, copyRowItems, viewRowItem } from "../lib/menuItems";
import type { QueryResult } from "../lib/store";
import { GridView } from "./GridView";
import { Menu } from "./Menu";

interface Options extends core.RenderableOptions<GridView> {
	runKey: string;
	// A left press on the grid, which takes the focus from the SQL.
	onPress: () => void;
}

// A query tab's rows. They are read only, so a click selects a row and a
// double click views it, and new rows start at the top with no selection. Its
// query view shows an error in its place.
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
		this._result = result;
		this._source = result?.status === "rows" ? { ...result, meta: null } : null;
		this._selected = null;
		this._clicks.reset();

		this.setGrid(this._source ? gridOf(this._source) : null, { x: 0, y: 0 });
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
		} else {
			this.clickRow(row, column, this._clicks.click(row));
		}
	}

	protected override onRowMenu(event: core.MouseEvent, row: number): void {
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
				"divider",
				...copyRowItems(source, row),
				...copyMarkedItems(source, this.markedRows()),
			],
		});
	}

	protected override resetClicks(): void {
		this._clicks.reset();
	}

	private select(row: number | null): void {
		this._selected = row;

		this.requestRender();
	}
}
