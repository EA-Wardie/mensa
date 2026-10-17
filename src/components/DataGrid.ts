import * as core from "@opentui/core";
import { DoubleClick } from "../lib/clicks";
import { theme } from "../lib/config";
import { SORT_ASC_ICON, SORT_DESC_ICON } from "../lib/consts";
import { ctx } from "../lib/context";
import { confirmDiscard, editRow } from "../lib/editor";
import { displayText, fitText, NULL_TEXT } from "../lib/format";
import {
	CELL_PADDING,
	type Cell,
	columnSpan,
	type Grid,
	gridFor,
} from "../lib/grid";
import { unbindOnDestroy } from "../lib/lifetime";
import { clamp } from "../lib/math";
import {
	$activeTable,
	$activeTableData,
	$editor,
	$openTables,
	$selectedRows,
	$sorts,
	$tableData,
	type Sort,
	type TableData,
} from "../lib/store";
import { selectRow, sortTable } from "../lib/tabs";
import { HorizontalScrollBar } from "./HorizontalScrollBar";

interface Position {
	x: number;
	y: number;
}

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

// The top rule, the column names and the rule under them.
const HEADER_HEIGHT: number = 3;

const SEPARATOR: string = "│";

const RULE: string = "─";

const TOP_TEE: string = "┬";

const CROSS: string = "┼";

const BOTTOM_TEE: string = "┴";

const SCROLL_STEP_X: number = 4;

export class DataGrid extends core.Renderable {
	public static current: DataGrid | null = null;

	private _vertical: core.ScrollBarRenderable;
	private _horizontal: HorizontalScrollBar;
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
	// Reset when the rows change, since a row index means another row then.
	private _clicks: DoubleClick<CellClick> = new DoubleClick<CellClick>(
		(a: CellClick, b: CellClick): boolean =>
			a.row === b.row && a.column === b.column,
	);

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

		this._horizontal = HorizontalScrollBar.make({
			position: "absolute",
			left: 0,
			right: 1,
			bottom: 0,
			visible: false,
			onChange: (position: number): void => {
				this.scrollTo({ x: position, y: this._offset.y });
			},
		});

		this.add(this._vertical);
		this.add(this._horizontal);
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
		this.drawHighlights(buffer, this._grid);

		buffer.pushScissorRect(
			this.screenX,
			this.screenY,
			this.bodyWidth,
			this.height,
		);

		this.drawHeader(buffer, this._grid);
		this.drawRows(buffer, this._grid);

		buffer.popScissorRect();
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
		// With no rows under it, the separators end at the rule under the names.
		const join: string = grid.cells.length > 0 ? CROSS : BOTTOM_TEE;

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
				buffer.drawText(join, separator, y + 1, theme.border);
			},
		);
	}

	// The hovered and selected rows, drawn before the clip, so they take the
	// scrollbar's column too while it's hidden, like the rules do.
	private drawHighlights(buffer: core.OptimizedBuffer, grid: Grid): void {
		const selected: number | null = this.selectedRow();

		if (this._hovered !== selected) {
			this.fillRow(buffer, grid, this._hovered, theme.hover);
		}

		this.fillRow(buffer, grid, selected, theme.selected);
	}

	private fillRow(
		buffer: core.OptimizedBuffer,
		grid: Grid,
		index: number | null,
		color: core.RGBA,
	): void {
		const shown: number = index === null ? -1 : index - this._offset.y;

		if (
			index === null ||
			index >= grid.cells.length ||
			shown < 0 ||
			shown >= this.bodyHeight
		) {
			return;
		}

		buffer.fillRect(
			this.screenX,
			this.screenY + HEADER_HEIGHT + shown,
			this._vertical.visible ? this.bodyWidth : this.width,
			1,
			color,
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
		const selected: number | null = this.selectedRow();

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
			const isSelected: boolean = index === selected;

			this.forEachColumn(
				grid,
				(column: number, x: number, separator: number): void => {
					const cell: Cell | undefined = row[column];

					buffer.drawText(
						cell ?? NULL_TEXT,
						x + CELL_PADDING,
						y,
						isSelected
							? theme.fg_inverse
							: cell === null
								? theme.muted
								: theme.fg,
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

	public selectedRow(): number | null {
		return (
			(this._table === null ? undefined : $selectedRows.get()[this._table]) ??
			null
		);
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

	// A thumb drag that strays onto the rows is captured by the grid, so the grid
	// passes it on to the scrollbar. The scrollbars' own events bubble up here
	// too, and they have handled those already.
	protected override onMouseEvent(event: core.MouseEvent): void {
		const own: boolean = event.target === this;

		switch (event.type) {
			case "down":
				if (own) {
					this._horizontal.release();
				}

				this.handleHeaderDown(event);
				this.handleRowDown(event);
				break;
			case "up":
			case "drag-end":
				if (own) {
					this._horizontal.release();
				}
				break;
			case "scroll":
				this.handleScroll(event);
				break;
			case "drag":
				if (own) {
					this._horizontal.drag(event.x);
				}

				this.trackHover(event);
				break;
			case "over":
			case "move":
			case "out":
				this.trackHover(event);
				break;
		}
	}

	private trackHover(event: core.MouseEvent): void {
		this._mouseY =
			event.type === "out" || event.target !== this ? null : event.y;

		this.updateHovered();
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

		// Sorting reloads the rows, which closes the row editor.
		confirmDiscard((): void => {
			sortTable(column);
		});
	}

	// Clicking a row selects it, and double clicking a cell edits its row. While
	// the editor is open, the selection stays on its row. Clicks on the
	// scrollbars bubble up here too, so only the grid's own count.
	private handleRowDown(event: core.MouseEvent): void {
		const index: number | null =
			event.button !== core.MouseButton.LEFT ||
			event.target !== this ||
			event.x >= this.screenX + this.bodyWidth
				? null
				: this.rowAt(event.y);

		if (index === null) {
			this._clicks.reset();

			return;
		}

		const column: number | null = this.columnAt(event.x);

		if (this._clicks.click({ row: index, column: column })) {
			editRow(
				index,
				column === null ? null : (this.columnNames()[column] ?? null),
			);
		} else if ($editor.get() === null) {
			selectRow(index);
		}
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
		const scrollsX: boolean = this.scrollsX;
		const bottom: number = scrollsX ? 1 : 0;

		if (this._vertical.bottom !== bottom) {
			this._vertical.bottom = bottom;
		}

		if (this._horizontal.visible !== scrollsX) {
			this._horizontal.visible = scrollsX;
		}

		this._vertical.scrollSize = grid?.cells.length ?? 0;
		this._vertical.viewportSize = this.bodyHeight;
		this._horizontal.scrollSize = grid?.totalWidth ?? 0;
		this._horizontal.viewportSize = this.bodyWidth;

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
		this._horizontal.scrollPosition = this._offset.x;

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
		if (data !== this._data) {
			this._clicks.reset();
		}

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
			$selectedRows.listen((): void => {
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
