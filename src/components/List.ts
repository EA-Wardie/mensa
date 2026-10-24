import * as core from "@opentui/core";
import type { ReadableAtom, WritableAtom } from "nanostores";
import { DoubleClick } from "../lib/clicks";
import { theme } from "../lib/config";
import { ctx } from "../lib/context";
import { displayText, fitText } from "../lib/format";
import { unbindOnDestroy } from "../lib/lifetime";
import { clamp } from "../lib/math";

interface Options<T> extends core.RenderableOptions<List<T>> {
	items: ReadableAtom<readonly T[]>;
	selected: WritableAtom<T | null>;
	label: (item: T) => string;
	detail?: (item: T) => string;
	bold?: (item: T) => boolean;
	redrawOn?: ReadableAtom<unknown>[];
	onActivate: (item: T) => void;
	// Opens the item's menu at the mouse, after right clicking selects it.
	onMenu?: (item: T, x: number, y: number) => void;
}

export class List<T> extends core.Renderable {
	private _options: Options<T>;
	private _scrollBar: core.ScrollBarRenderable;
	private _items: readonly T[] = [];
	private _offset: number = 0;
	private _hovered: number | null = null;
	private _mouseY: number | null = null;
	private _clicks: DoubleClick<T> = new DoubleClick<T>();

	constructor(options: Options<T>) {
		super(ctx, options);

		this._options = options;

		this._scrollBar = new core.ScrollBarRenderable(ctx, {
			orientation: "vertical",
			position: "absolute",
			top: 0,
			right: 0,
			height: "100%",
			trackOptions: {
				foregroundColor: theme.scrollbar_thumb,
				backgroundColor: theme.scrollbar_track,
			},
			onChange: (position: number): void => {
				this.scrollTo(position);
			},
		});

		this._scrollBar.focusable = false;

		this.add(this._scrollBar);
		this.registerStoreEvents();
	}

	public static make<T>(options: Options<T>): List<T> {
		return new List<T>(options);
	}

	protected override renderSelf(buffer: core.OptimizedBuffer): void {
		const rowWidth: number =
			this.width - (this._scrollBar.visible ? this._scrollBar.width : 0);
		const textWidth: number = rowWidth - 2;
		const end: number = Math.min(
			this._items.length,
			this._offset + this.height,
		);
		const selected: T | null = this._options.selected.get();

		for (let index: number = this._offset; index < end; index++) {
			const item: T | undefined = this._items[index];

			if (item === undefined) {
				continue;
			}

			const y: number = this.screenY + index - this._offset;
			const isSelected: boolean = item === selected;
			const background: core.RGBA | null = isSelected
				? theme.selected
				: index === this._hovered
					? theme.hover
					: null;

			if (background) {
				buffer.fillRect(this.screenX, y, rowWidth, 1, background);
			}

			if (textWidth <= 0) {
				continue;
			}

			this.drawItem(buffer, item, y, textWidth, isSelected);
		}
	}

	private drawItem(
		buffer: core.OptimizedBuffer,
		item: T,
		y: number,
		width: number,
		selected: boolean,
	): void {
		const label: string = fitText(
			displayText(this._options.label(item)),
			width,
		);
		const labelWidth: number = Bun.stringWidth(label);
		const detail: string = displayText(this._options.detail?.(item) ?? "");
		const detailWidth: number = width - labelWidth - 2;
		const bold: boolean = this._options.bold?.(item) ?? true;

		buffer.pushScissorRect(this.screenX + 1, y, width, 1);
		buffer.drawText(
			label,
			this.screenX + 1,
			y,
			selected ? theme.fg_inverse : theme.fg,
			undefined,
			bold ? core.TextAttributes.BOLD : core.TextAttributes.NONE,
		);

		if (detail && detailWidth > 0) {
			buffer.drawText(
				fitText(detail, detailWidth),
				this.screenX + 1 + labelWidth + 2,
				y,
				selected ? theme.fg_inverse : theme.muted,
			);
		}

		buffer.popScissorRect();
	}

	protected override onResize(width: number, height: number): void {
		super.onResize(width, height);

		const heightChanged: boolean = height !== this._scrollBar.viewportSize;

		this.sync();

		if (heightChanged) {
			this.reveal(this._options.selected.get());
		}
	}

	protected override onMouseEvent(event: core.MouseEvent): void {
		switch (event.type) {
			case "down":
				this.handleMouseDown(event);
				break;
			case "scroll":
				this.handleScroll(event);
				break;
			case "over":
			case "move":
			case "drag":
			case "out":
				this._mouseY =
					event.type === "out" || event.target !== this ? null : event.y;

				this.updateHovered();
				break;
		}
	}

	private rowAt(y: number): number | null {
		const index: number = this._offset + y - this.screenY;

		return index >= 0 && index < this._items.length ? index : null;
	}

	private handleMouseDown(event: core.MouseEvent): void {
		const index: number | null =
			event.target === this ? this.rowAt(event.y) : null;
		const item: T | undefined = index === null ? undefined : this._items[index];

		if (item !== undefined && event.button === core.MouseButton.RIGHT) {
			this._clicks.reset();

			if (this._options.onMenu) {
				this._options.selected.set(item);
				this._options.onMenu(item, event.x, event.y);
			}

			return;
		}

		if (item === undefined || event.button !== core.MouseButton.LEFT) {
			this._clicks.reset();

			return;
		}

		const isDouble: boolean = this._clicks.click(item);

		this._options.selected.set(item);

		if (isDouble) {
			this._options.onActivate(item);
		}
	}

	private handleScroll(event: core.MouseEvent): void {
		const direction: string | undefined = event.scroll?.direction;
		const step: number = Math.max(1, Math.round(event.scroll?.delta ?? 1));

		if (direction === "up") {
			this.scrollTo(this._offset - step);
		} else if (direction === "down") {
			this.scrollTo(this._offset + step);
		}
	}

	private sync(): void {
		this._scrollBar.scrollSize = this._items.length;
		this._scrollBar.viewportSize = this.height;

		this.scrollTo(this._offset);
	}

	private scrollTo(offset: number): void {
		const max: number = Math.max(0, this._items.length - this.height);

		this._offset = clamp(offset, 0, max);
		this._scrollBar.scrollPosition = this._offset;

		this.updateHovered();
		this.requestRender();
	}

	private reveal(item: T | null): void {
		const index: number = item === null ? -1 : this._items.indexOf(item);

		if (index < 0 || this.height <= 0) {
			return;
		}

		if (index < this._offset) {
			this.scrollTo(index);
		} else if (index >= this._offset + this.height) {
			this.scrollTo(index - this.height + 1);
		}
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

	private registerStoreEvents(): void {
		unbindOnDestroy(
			this,
			this._options.items.subscribe((items: readonly T[]): void => {
				this._items = items;

				this.sync();
			}),
			this._options.selected.listen((item: T | null): void => {
				this.reveal(item);
				this.requestRender();
			}),
			...(this._options.redrawOn ?? []).map(
				(atom: ReadableAtom<unknown>): (() => void) =>
					atom.listen((): void => {
						this.requestRender();
					}),
			),
		);
	}
}
