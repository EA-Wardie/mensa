import type * as core from "@opentui/core";
import { plural } from "../lib/format";
import { gridOf } from "../lib/grid";
import type { QueryResult } from "../lib/store";
import { GridView } from "./GridView";

interface Options extends core.RenderableOptions<GridView> {
	runKey: string;
	// A left press on the grid, which takes the focus from the SQL.
	onPress: () => void;
}

// A query tab's rows. They are read only, so a click only selects a row, and
// new rows start at the top with no selection. Its query view shows an error
// in its place.
export class ResultGrid extends GridView {
	private _runKey: string;
	private _onPress: () => void;
	private _result: QueryResult | undefined = undefined;
	private _selected: number | null = null;

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

	protected override onPress(): void {
		this._onPress();
	}

	protected override onRowClick(row: number | null): void {
		if (row !== null) {
			this.select(row);
		}
	}

	private select(row: number | null): void {
		this._selected = row;

		this.requestRender();
	}
}
