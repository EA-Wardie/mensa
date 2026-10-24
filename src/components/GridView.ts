import * as core from "@opentui/core";
import type { ColumnIcon } from "../lib/columnKinds";
import { theme } from "../lib/config";
import { ctx } from "../lib/context";
import { displayText, fitText, NULL_TEXT } from "../lib/format";
import {
	CELL_PADDING,
	type Cell,
	columnSpan,
	type Grid,
	ICON_SPACE,
} from "../lib/grid";
import { unbindOnDestroy } from "../lib/lifetime";
import { clamp } from "../lib/math";
import { HorizontalScrollBar } from "./HorizontalScrollBar";

export interface Position {
	x: number;
	y: number;
}

// An icon drawn at the end of a column's name, such as its sort.
export interface HeaderMarker {
	index: number;
	icon: ColumnIcon;
}

// The top rule, the column names and the rule under them.
const HEADER_HEIGHT: number = 3;

const SEPARATOR: string = "│";

const RULE: string = "─";

const TOP_TEE: string = "┬";

const CROSS: string = "┼";

const BOTTOM_TEE: string = "┴";

const SCROLL_STEP_X: number = 4;

// Rows under their column names, drawing only the rows and columns in view,
// with scrollbars both ways. A subclass gives the grid and says what clicks
// on it do.
export abstract class GridView extends core.Renderable {
	// The grid the shown tab has, which the shortcuts scroll.
	public static current: GridView | null = null;

	private _vertical: core.ScrollBarRenderable;
	private _horizontal: HorizontalScrollBar;
	private _grid: Grid | null = null;
	private _hovered: number | null = null;
	private _mouseY: number | null = null;
	protected _offset: Position = { x: 0, y: 0 };

	constructor(options: core.RenderableOptions<GridView>) {
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

		unbindOnDestroy(this, (): void => {
			if (GridView.current === this) {
				GridView.current = null;
			}
		});
	}

	// Why there are no rows to show, such as while they load, or null.
	protected abstract message(): string | null;

	public abstract selectedRow(): number | null;

	public abstract clearSelection(): void;

	protected messageColor(): core.RGBA {
		return theme.muted;
	}

	// Whether the message sits in the middle rather than at the top left.
	protected centresMessage(): boolean {
		return false;
	}

	// Asked once a frame.
	protected headerMarker(): HeaderMarker | null {
		return null;
	}

	// A left press anywhere on the grid, its scrollbars included.
	protected onPress(): void {}

	protected onHeaderClick(_index: number): void {}

	// A left press on the grid's own cells, with the row null when it's not
	// on one.
	protected onRowClick(_row: number | null, _column: number | null): void {}

	protected onRowMenu(_event: core.MouseEvent, _row: number): void {}

	protected onScrolled(): void {}

	protected get grid(): Grid | null {
		return this._grid;
	}

	// Shows a grid, scrolled to the offset.
	protected setGrid(grid: Grid | null, offset: Position = this._offset): void {
		this._grid = grid;
		this._offset = offset;

		this.sync();
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

	private drawMessage(buffer: core.OptimizedBuffer, message: string): void {
		const width: number = Math.max(0, this.width - 2);
		const centred: boolean = this.centresMessage();

		if (width <= 0 || this.height <= 1) {
			return;
		}

		buffer.drawText(
			RULE.repeat(this.width),
			this.screenX,
			this.screenY,
			theme.border,
		);

		const text: string = fitText(displayText(message), width);
		const x: number = centred
			? this.screenX + Math.floor((this.width - Bun.stringWidth(text)) / 2)
			: this.screenX + 1;
		const y: number = centred
			? this.screenY + 1 + Math.floor((this.height - 2) / 2)
			: this.screenY + 1;

		buffer.drawText(text, x, y, this.messageColor());
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
		// With no rows under it, the separators end at the rule under the names.
		const join: string = grid.cells.length > 0 ? CROSS : BOTTOM_TEE;
		const marker: HeaderMarker | null = this.headerMarker();

		this.forEachColumn(
			grid,
			(index: number, x: number, separator: number): void => {
				const icon: ColumnIcon | undefined = grid.icons[index];

				if (icon) {
					buffer.drawText(icon.icon, x + CELL_PADDING, y, icon.color);
				}
				buffer.drawText(
					grid.columns[index] ?? "",
					x + CELL_PADDING + ICON_SPACE,
					y,
					theme.fg,
					undefined,
					core.TextAttributes.BOLD,
				);

				if (marker?.index === index) {
					buffer.drawText(
						marker.icon.icon,
						x + CELL_PADDING + (grid.widths[index] ?? 0) - 1,
						y,
						marker.icon.color,
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

				if (event.button === core.MouseButton.LEFT) {
					this.onPress();
				}

				this.handleHeaderDown(event);
				this.handleRowDown(event);
				this.handleRowMenu(event);
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

	private handleHeaderDown(event: core.MouseEvent): void {
		if (
			event.button !== core.MouseButton.LEFT ||
			event.y !== this.screenY + 1 ||
			this.message() !== null
		) {
			return;
		}

		const index: number | null = this.columnAt(event.x);

		if (index !== null) {
			this.onHeaderClick(index);
		}
	}

	private handleRowDown(event: core.MouseEvent): void {
		if (event.button !== core.MouseButton.LEFT) {
			return;
		}

		const index: number | null = this.bodyRowAt(event);

		this.onRowClick(index, index === null ? null : this.columnAt(event.x));
	}

	private handleRowMenu(event: core.MouseEvent): void {
		const index: number | null =
			event.button === core.MouseButton.RIGHT ? this.bodyRowAt(event) : null;

		if (index !== null) {
			this.onRowMenu(event, index);
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

	// The row a press is on. Presses on the scrollbars bubble up here too, so
	// only the grid's own count.
	private bodyRowAt(event: core.MouseEvent): number | null {
		return event.target !== this || event.x >= this.screenX + this.bodyWidth
			? null
			: this.rowAt(event.y);
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

		this.onScrolled();
		this.updateHovered();
		this.requestRender();
	}
}
