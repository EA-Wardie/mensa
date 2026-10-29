import type * as core from "@opentui/core";
import { copyToClipboard } from "../lib/actions";
import { DoubleClick } from "../lib/clicks";
import { COPY_ICON, VIEW_ICON } from "../lib/consts";
import { rowAsCsv, rowAsJson } from "../lib/export";
import { plural } from "../lib/format";
import { gridOf } from "../lib/grid";
import { SHORTCUTS, shortcutLabel } from "../lib/shortcuts";
import { $viewer, type QueryResult, type Value } from "../lib/store";
import { viewRow } from "../lib/viewer";
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
		this._selected = null;
		this._clicks.reset();

		this.setGrid(
			result?.status === "rows" ? gridOf({ ...result, meta: null }) : null,
			{ x: 0, y: 0 },
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

	protected override onPress(): void {
		this._onPress();
	}

	// While the view is open, it follows the clicked row.
	protected override onRowClick(
		row: number | null,
		column: number | null,
	): void {
		if (row === null) {
			this._clicks.reset();

			return;
		}

		this.select(row);

		if (this._clicks.click(row) || $viewer.get() !== null) {
			viewRow(row, column === null ? null : (this.columns()[column] ?? null));
		}
	}

	protected override onRowMenu(event: core.MouseEvent, row: number): void {
		const result: QueryResult | undefined = this._result;

		if (result?.status !== "rows") {
			return;
		}

		const values: Value[] = result.rows[row] ?? [];

		this.select(row);

		Menu.make({
			x: event.x,
			y: event.y,
			items: [
				{
					label: `${VIEW_ICON} View`,
					shortcut: shortcutLabel(SHORTCUTS.viewRow),
					onSelect: (): void => {
						viewRow(row, null);
					},
				},
				"divider",
				{
					label: `${COPY_ICON} Copy row as CSV`,
					onSelect: (): void => {
						copyToClipboard(rowAsCsv(result.columns, values));
					},
				},
				{
					label: `${COPY_ICON} Copy row as JSON`,
					onSelect: (): void => {
						copyToClipboard(rowAsJson(result.columns, result.kinds, values));
					},
				},
			],
		});
	}

	private columns(): string[] {
		return this._result?.status === "rows" ? this._result.columns : [];
	}

	private select(row: number | null): void {
		this._selected = row;

		this.requestRender();
	}
}
