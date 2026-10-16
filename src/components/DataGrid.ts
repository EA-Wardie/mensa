import * as core from "@opentui/core";
import { theme } from "../lib/config";
import { MAX_COLUMN_WIDTH, SORT_ASC_ICON, SORT_DESC_ICON } from "../lib/consts";
import { ctx } from "../lib/context";
import { displayText, fitText, NULL_TEXT } from "../lib/format";
import { unbindOnDestroy } from "../lib/lifetime";
import { clamp } from "../lib/math";
import {
	$activeTable,
	$activeTableData,
	$openTables,
	$sorts,
	$tableData,
	type Sort,
	type TableData,
	type Value,
} from "../lib/store";
import { sortTable } from "../lib/tabs";

type Cell = string | null;

// Column names and cells are fitted to their column once per load, so a frame
// only draws them.
interface Grid {
	columns: string[];
	cells: Cell[][];
	widths: number[];
	totalWidth: number;
}

interface Position {
	x: number;
	y: number;
}

// A tab's scroll position, and the sort its rows had then.
interface TablePosition {
	offset: Position;
	sort: Sort | null;
}

interface Thumb {
	start: number;
	width: number;
	track: number;
	max: number;
}

// The top rule, the column names and the rule under them.
const HEADER_HEIGHT: number = 3;

const CELL_PADDING: number = 1;

// Every header keeps room for a gap and the sort chevron, so sorting doesn't
// move the columns.
const SORT_SPACE: number = 2;

const SEPARATOR: string = "│";

const RULE: string = "─";

const TOP_TEE: string = "┬";

const CROSS: string = "┼";

const BOTTOM_TEE: string = "┴";

const SCROLL_STEP_X: number = 4;

// A lower half block keeps the horizontal thumb as thin as the vertical one,
// which a full cell high ScrollBarRenderable can't do.
const THUMB: string = "▄";

const GRIDS: WeakMap<Value[][], Grid> = new WeakMap<Value[][], Grid>();

function columnSpan(width: number): number {
	return width + CELL_PADDING * 2 + 1;
}

interface Measured {
	text: string;
	width: number;
}

function measure(value: Value): Measured {
	const text: string = value === null ? NULL_TEXT : displayText(value);

	return { text: text, width: Bun.stringWidth(text) };
}

// Each text is measured once, both to size its column and to fit it.
function makeGrid(columns: string[], rows: Value[][]): Grid {
	const header: Measured[] = columns.map(measure);
	const measured: Measured[][] = rows.map((row: Value[]): Measured[] =>
		row.map(measure),
	);
	const widths: number[] = header.map(
		(column: Measured, index: number): number =>
			Math.min(
				MAX_COLUMN_WIDTH,
				measured.reduce(
					(width: number, row: Measured[]): number =>
						Math.max(width, row[index]?.width ?? 0),
					column.width + SORT_SPACE,
				),
			),
	);

	return {
		columns: header.map((column: Measured, index: number): string =>
			fitText(column.text, (widths[index] ?? 0) - SORT_SPACE, column.width),
		),
		cells: measured.map((row: Measured[], index: number): Cell[] =>
			row.map(
				(cell: Measured, column: number): Cell =>
					rows[index]?.[column] === null
						? null
						: fitText(cell.text, widths[column] ?? 0, cell.width),
			),
		),
		widths: widths,
		totalWidth: widths.reduce(
			(total: number, width: number): number => total + columnSpan(width),
			0,
		),
	};
}

function gridFor(data: TableData | undefined): Grid | null {
	if (data?.status !== "loaded") {
		return null;
	}

	let grid: Grid | undefined = GRIDS.get(data.rows);

	if (!grid) {
		grid = makeGrid(data.columns, data.rows);
		GRIDS.set(data.rows, grid);
	}

	return grid;
}

export class DataGrid extends core.Renderable {
	public static current: DataGrid | null = null;

	private _vertical: core.ScrollBarRenderable;
	private _table: string | null = null;
	private _data: TableData | undefined = undefined;
	private _grid: Grid | null = null;
	private _offset: Position = { x: 0, y: 0 };
	private _positions: Map<string, TablePosition> = new Map<
		string,
		TablePosition
	>();
	private _hovered: number | null = null;
	private _mouseY: number | null = null;
	private _thumbGrab: number | null = null;

	constructor(options: core.RenderableOptions<DataGrid>) {
		super(ctx, {
			flexGrow: 1,
			width: "100%",
			...options,
		});

		this._vertical = new core.ScrollBarRenderable(ctx, {
			orientation: "vertical",
			position: "absolute",
			top: HEADER_HEIGHT,
			right: 0,
			bottom: 0,
			trackOptions: {
				foregroundColor: theme.scrollbar_thumb,
				backgroundColor: theme.scrollbar_track,
			},
			onChange: (position: number): void => {
				this.scrollTo({ x: this._offset.x, y: position });
			},
		});

		this._vertical.focusable = false;

		this.add(this._vertical);
		this.registerStoreEvents();

		DataGrid.current = this;
	}

	public static make(options: core.RenderableOptions<DataGrid> = {}): DataGrid {
		return new this(options);
	}

	private get scrollsX(): boolean {
		return (this._grid?.totalWidth ?? 0) > this.bodyWidth;
	}

	// The horizontal scrollbar takes a row only when the columns overflow.
	private get bodyHeight(): number {
		return Math.max(0, this.height - HEADER_HEIGHT - (this.scrollsX ? 1 : 0));
	}

	private get thumbY(): number {
		return this.screenY + this.height - 1;
	}

	private get bodyWidth(): number {
		return Math.max(0, this.width - 1);
	}

	private scrollRows(delta: number): void {
		this.scrollTo({ x: this._offset.x, y: this._offset.y + delta });
	}

	public scrollPage(direction: number): void {
		this.scrollRows(direction * Math.max(1, this.bodyHeight - 1));
	}

	public scrollToEdge(end: boolean): void {
		this.scrollTo({
			x: this._offset.x,
			y: end ? Number.MAX_SAFE_INTEGER : 0,
		});
	}

	public scrollColumns(direction: number): void {
		const widths: number[] = this._grid?.widths ?? [];
		let start: number = 0;

		for (const width of widths) {
			const end: number = start + columnSpan(width);

			if (direction > 0 && start > this._offset.x) {
				break;
			}

			if (direction < 0 && end >= this._offset.x) {
				break;
			}

			start = end;
		}

		this.scrollTo({ x: start, y: this._offset.y });
	}

	protected override renderSelf(buffer: core.OptimizedBuffer): void {
		const message: string | null = this.message();

		if (message !== null) {
			this.drawMessage(buffer, message);

			return;
		}

		if (!this._grid) {
			return;
		}

		this.drawRules(buffer);
		buffer.pushScissorRect(
			this.screenX,
			this.screenY,
			this.bodyWidth,
			this.height,
		);

		this.drawHeader(buffer, this._grid);
		this.drawRows(buffer, this._grid);
		buffer.popScissorRect();
		this.drawThumb(buffer);
	}

	private message(): string | null {
		if (this._table === null) {
			return "Open a table from the sidebar";
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

	private drawMessage(buffer: core.OptimizedBuffer, message: string): void {
		const width: number = Math.max(0, this.width - 2);
		const centred: boolean = $openTables.get().length === 0;

		if (width <= 0 || this.height <= 1) {
			return;
		}

		// The top border, under the tabs or, with none open, level with the
		// sidebar's.
		buffer.drawText(
			RULE.repeat(this.width),
			this.screenX,
			this.screenY,
			theme.border,
		);

		const text: string = fitText(displayText(message), width);
		// With no tabs open, the hint sits in the middle of the empty grid.
		const x: number = centred
			? this.screenX + Math.floor((this.width - Bun.stringWidth(text)) / 2)
			: this.screenX + 1;
		const y: number = centred
			? this.screenY + 1 + Math.floor((this.height - 2) / 2)
			: this.screenY + 1;

		buffer.drawText(
			text,
			x,
			y,
			this._data?.status === "error" ? theme.danger : theme.muted,
		);
	}

	// Full width, past the scrollbar column, to meet the tabs' border. The
	// header then draws the column joins over them.
	private drawRules(buffer: core.OptimizedBuffer): void {
		const rule: string = RULE.repeat(this.width);

		buffer.drawText(rule, this.screenX, this.screenY, theme.border);
		buffer.drawText(rule, this.screenX, this.screenY + 2, theme.border);

		const bottom: number | null = this.bottomRuleY();

		if (bottom !== null) {
			buffer.drawText(rule, this.screenX, bottom, theme.border);
		}
	}

	// Closes off the last row when there is room for it under the rows.
	private bottomRuleY(): number | null {
		const shown: number = Math.min(
			(this._grid?.cells.length ?? 0) - this._offset.y,
			this.bodyHeight,
		);

		return shown > 0 && shown < this.bodyHeight
			? this.screenY + HEADER_HEIGHT + shown
			: null;
	}

	private drawHeader(buffer: core.OptimizedBuffer, grid: Grid): void {
		const y: number = this.screenY + 1;
		const applied: Sort | null = this.loadedSort();
		const requested: Sort | null =
			(this._table === null ? undefined : $sorts.get()[this._table]) ?? null;
		// While a new sort loads, its chevron is muted, or the old one's if the
		// sort is being removed.
		const sort: Sort | null = requested ?? applied;
		const pending: boolean = requested !== applied;
		const sorted: number = sort ? this.columnNames().indexOf(sort.column) : -1;

		this.forEachColumn(
			grid,
			(index: number, x: number, separator: number): void => {
				buffer.drawText(
					grid.columns[index] ?? "",
					x + CELL_PADDING,
					y,
					theme.fg,
					undefined,
					core.TextAttributes.BOLD,
				);

				if (index === sorted) {
					buffer.drawText(
						sort?.direction === "desc" ? SORT_DESC_ICON : SORT_ASC_ICON,
						x + CELL_PADDING + (grid.widths[index] ?? 0) - 1,
						y,
						pending ? theme.muted : theme.fg,
					);
				}

				buffer.drawText(TOP_TEE, separator, y - 1, theme.border);
				buffer.drawText(SEPARATOR, separator, y, theme.border);
				buffer.drawText(CROSS, separator, y + 1, theme.border);
			},
		);
	}

	private drawRows(buffer: core.OptimizedBuffer, grid: Grid): void {
		const end: number = Math.min(
			grid.cells.length,
			this._offset.y + this.bodyHeight,
		);

		if (!grid.cells.length) {
			buffer.drawText(
				"No rows",
				this.screenX + 1,
				this.screenY + HEADER_HEIGHT,
				theme.muted,
			);

			return;
		}

		const bottom: number | null = this.bottomRuleY();

		if (bottom !== null) {
			this.forEachColumn(
				grid,
				(_column: number, _x: number, separator: number): void => {
					buffer.drawText(BOTTOM_TEE, separator, bottom, theme.border);
				},
			);
		}

		for (let index: number = this._offset.y; index < end; index++) {
			const row: Cell[] | undefined = grid.cells[index];

			if (!row) {
				continue;
			}

			const y: number = this.screenY + HEADER_HEIGHT + index - this._offset.y;
			if (index === this._hovered) {
				buffer.fillRect(this.screenX, y, this.bodyWidth, 1, theme.hover);
			}

			this.forEachColumn(
				grid,
				(column: number, x: number, separator: number): void => {
					const cell: Cell | undefined = row[column];

					buffer.drawText(
						cell ?? NULL_TEXT,
						x + CELL_PADDING,
						y,
						cell === null ? theme.muted : theme.fg,
						undefined,
						cell === null
							? core.TextAttributes.ITALIC
							: core.TextAttributes.NONE,
					);
					buffer.drawText(SEPARATOR, separator, y, theme.border);
				},
			);
		}
	}

	// The sort the shown rows have.
	private loadedSort(): Sort | null {
		return this._data?.status === "loaded" ? this._data.sort : null;
	}

	private columnNames(): string[] {
		return this._data?.status === "loaded" ? this._data.columns : [];
	}

	private columnAt(screenX: number): number | null {
		let found: number | null = null;

		if (!this._grid || screenX >= this.screenX + this.bodyWidth) {
			return null;
		}

		this.forEachColumn(
			this._grid,
			(index: number, x: number, separator: number): void => {
				if (screenX >= x && screenX <= separator) {
					found = index;
				}
			},
		);

		return found;
	}

	private forEachColumn(
		grid: Grid,
		draw: (index: number, x: number, separator: number) => void,
	): void {
		const right: number = this.screenX + this.bodyWidth;
		let x: number = this.screenX - this._offset.x;

		for (let index: number = 0; index < grid.widths.length; index++) {
			const width: number = grid.widths[index] ?? 0;
			const span: number = columnSpan(width);

			if (x >= right) {
				break;
			}

			if (x + span > this.screenX) {
				draw(index, x, x + width + CELL_PADDING * 2);
			}

			x += span;
		}
	}

	protected override onResize(width: number, height: number): void {
		super.onResize(width, height);

		this.sync();
	}

	protected override onMouseEvent(event: core.MouseEvent): void {
		switch (event.type) {
			case "down":
				this.handleHeaderDown(event);
				this.handleThumbDown(event);
				break;
			case "up":
			case "drag-end":
				this.releaseThumb();
				break;
			case "scroll":
				this.handleScroll(event);
				break;
			case "drag":
				if (this._thumbGrab !== null) {
					this.dragThumb(event.x);
				}

				this._mouseY = event.target === this ? event.y : null;

				this.updateHovered();
				break;
			case "over":
			case "move":
			case "out":
				this._mouseY =
					event.type === "out" || event.target !== this ? null : event.y;

				this.updateHovered();
				break;
		}
	}

	// Clicking a column name cycles its sort.
	private handleHeaderDown(event: core.MouseEvent): void {
		if (
			event.button !== core.MouseButton.LEFT ||
			event.y !== this.screenY + 1 ||
			this.message() !== null
		) {
			return;
		}

		const index: number | null = this.columnAt(event.x);
		const column: string | undefined =
			index === null ? undefined : this.columnNames()[index];

		if (column === undefined) {
			return;
		}

		sortTable(column);
	}

	private thumb(): Thumb | null {
		const total: number = this._grid?.totalWidth ?? 0;
		const track: number = this.bodyWidth;

		if (total <= track || track <= 0) {
			return null;
		}

		const width: number = Math.min(
			track,
			Math.max(1, Math.round((track * track) / total)),
		);
		const max: number = total - track;
		const start: number = Math.round((this._offset.x / max) * (track - width));

		return { start, width, track, max };
	}

	private drawThumb(buffer: core.OptimizedBuffer): void {
		const thumb: Thumb | null = this.thumb();

		if (!thumb) {
			return;
		}

		const y: number = this.thumbY;

		for (let cell: number = 0; cell < thumb.width; cell++) {
			buffer.setCellWithAlphaBlending(
				this.screenX + thumb.start + cell,
				y,
				THUMB,
				theme.scrollbar_thumb,
				theme.scrollbar_track,
			);
		}
	}

	private handleThumbDown(event: core.MouseEvent): void {
		const thumb: Thumb | null = this.thumb();
		const x: number = event.x - this.screenX;

		if (
			!thumb ||
			event.button !== core.MouseButton.LEFT ||
			event.y !== this.thumbY ||
			x < 0 ||
			x >= thumb.track
		) {
			return;
		}

		const onThumb: boolean = x >= thumb.start && x < thumb.start + thumb.width;

		// Clicking the track centres the thumb on the click, then drags from there.
		this._thumbGrab = onThumb ? x - thumb.start : Math.floor(thumb.width / 2);

		this.dragThumb(event.x);
	}

	private dragThumb(screenX: number): void {
		const thumb: Thumb | null = this.thumb();

		if (!thumb || this._thumbGrab === null) {
			return;
		}

		const room: number = thumb.track - thumb.width;
		const start: number = clamp(
			screenX - this.screenX - this._thumbGrab,
			0,
			room,
		);

		this.scrollTo({
			x: room ? Math.round((start / room) * thumb.max) : 0,
			y: this._offset.y,
		});
	}

	private releaseThumb(): void {
		if (this._thumbGrab === null) {
			return;
		}

		this._thumbGrab = null;

		this.requestRender();
	}

	private handleScroll(event: core.MouseEvent): void {
		const direction: string | undefined = event.scroll?.direction;
		const step: number = Math.max(1, Math.round(event.scroll?.delta ?? 1));
		const horizontal: boolean =
			direction === "left" ||
			direction === "right" ||
			(event.modifiers.shift && (direction === "up" || direction === "down"));
		const sign: number = direction === "up" || direction === "left" ? -1 : 1;

		if (horizontal) {
			this.scrollTo({
				x: this._offset.x + sign * step * SCROLL_STEP_X,
				y: this._offset.y,
			});
		} else {
			this.scrollRows(sign * step);
		}
	}

	private rowAt(y: number): number | null {
		const rows: number = this._grid?.cells.length ?? 0;
		const relative: number = y - this.screenY - HEADER_HEIGHT;
		const index: number = this._offset.y + relative;

		return relative >= 0 && relative < this.bodyHeight && index < rows
			? index
			: null;
	}

	private updateHovered(): void {
		const hovered: number | null =
			this._mouseY === null ? null : this.rowAt(this._mouseY);

		if (hovered === this._hovered) {
			return;
		}

		this._hovered = hovered;

		this.requestRender();
	}

	private sync(): void {
		const grid: Grid | null = this._grid;

		const bottom: number = this.scrollsX ? 1 : 0;

		if (this._vertical.bottom !== bottom) {
			this._vertical.bottom = bottom;
		}

		this._vertical.scrollSize = grid?.cells.length ?? 0;
		this._vertical.viewportSize = this.bodyHeight;

		this.scrollTo(this._offset);
	}

	private scrollTo(position: Position): void {
		const rows: number = this._grid?.cells.length ?? 0;
		const width: number = this._grid?.totalWidth ?? 0;
		const maxY: number = Math.max(0, rows - this.bodyHeight);
		const maxX: number = Math.max(0, width - this.bodyWidth);

		this._offset = {
			x: clamp(position.x, 0, maxX),
			y: clamp(position.y, 0, maxY),
		};
		this._vertical.scrollPosition = this._offset.y;

		if (this._table !== null) {
			this._positions.set(this._table, {
				offset: this._offset,
				sort: this.loadedSort(),
			});
		}

		this.updateHovered();
		this.requestRender();
	}

	private update(): void {
		const table: string | null = $activeTable.get();
		const data: TableData | undefined = $activeTableData.get();
		const grid: Grid | null = gridFor(data);
		const saved: TablePosition | undefined =
			table === null ? undefined : this._positions.get(table);
		// Newly sorted rows start at the top, also when they arrived while
		// another tab was shown. A failed sort keeps the rows and where they
		// were scrolled to.
		const resorted: boolean =
			data?.status === "loaded" &&
			saved !== undefined &&
			data.sort !== saved.sort;

		if (table !== this._table || resorted) {
			const offset: Position = saved?.offset ?? { x: 0, y: 0 };

			this._offset = resorted ? { x: offset.x, y: 0 } : offset;
		}

		this._table = table;
		this._data = data;
		this._grid = grid;

		for (const name of this._positions.keys()) {
			if (!(name in $tableData.get())) {
				this._positions.delete(name);
			}
		}

		this.sync();
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
			(): void => {
				if (DataGrid.current === this) {
					DataGrid.current = null;
				}
			},
		);
	}
}
