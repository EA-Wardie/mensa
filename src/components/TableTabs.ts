import * as core from "@opentui/core";
import { theme } from "../lib/config";
import { CLOSE_ICON, TAB_WIDTH } from "../lib/consts";
import { ctx } from "../lib/context";
import { confirmDiscard, confirmDiscardIf } from "../lib/editor";
import { displayText, fitText } from "../lib/format";
import { unbindOnDestroy } from "../lib/lifetime";
import { clamp } from "../lib/math";
import { SHORTCUTS, shortcutLabel } from "../lib/shortcuts";
import { $activeTable, $openTables } from "../lib/store";
import { closeAllTables, closeTable, openTable } from "../lib/tabs";
import { Menu } from "./Menu";

interface Hit {
	table: string;
	close: boolean;
}

// Each tab is " name…  󰅖 ": a space, the name, a gap, the icon and a space.
const CLOSE_OFFSET: number = TAB_WIDTH - 2;

const NAME_WIDTH: number = TAB_WIDTH - 5;

const SCROLL_LEFT: string = "‹";

const SCROLL_RIGHT: string = "›";

class TabBar extends core.Renderable {
	private _open: readonly string[] = [];
	private _active: string | null = null;
	private _first: number = 0;
	private _hovered: Hit | null = null;
	private _mouseX: number | null = null;

	constructor() {
		super(ctx, { width: "100%", height: 1 });

		this.registerStoreEvents();
	}

	private get slots(): number {
		return Math.max(1, Math.floor(this.width / TAB_WIDTH));
	}

	// One past the last visible tab.
	private get end(): number {
		return Math.min(this._open.length, this._first + this.slots);
	}

	// Where the › arrow is drawn, over the last visible tab's outer padding.
	private get rightArrowOffset(): number {
		return (this.end - this._first) * TAB_WIDTH - 1;
	}

	protected override renderSelf(buffer: core.OptimizedBuffer): void {
		const end: number = this.end;

		for (let index: number = this._first; index < end; index++) {
			const table: string | undefined = this._open[index];

			if (table !== undefined) {
				this.drawTab(
					buffer,
					table,
					this.screenX + (index - this._first) * TAB_WIDTH,
				);
			}
		}

		if (this._first > 0) {
			this.drawArrow(buffer, SCROLL_LEFT, 0, this._open[this._first]);
		}

		if (end < this._open.length) {
			this.drawArrow(
				buffer,
				SCROLL_RIGHT,
				this.rightArrowOffset,
				this._open[end - 1],
			);
		}
	}

	private drawTab(
		buffer: core.OptimizedBuffer,
		table: string,
		x: number,
	): void {
		const active: boolean = table === this._active;
		const hovered: boolean = this._hovered?.table === table;
		const closeHovered: boolean = hovered && this._hovered?.close === true;

		if (active || hovered) {
			buffer.fillRect(
				x,
				this.screenY,
				TAB_WIDTH,
				1,
				active ? theme.active : theme.hover,
			);
		}

		buffer.drawText(
			fitText(displayText(table), NAME_WIDTH),
			x + 1,
			this.screenY,
			active ? theme.fg_inverse : theme.fg,
			undefined,
			active ? core.TextAttributes.BOLD : core.TextAttributes.NONE,
		);
		buffer.drawText(
			CLOSE_ICON,
			x + CLOSE_OFFSET,
			this.screenY,
			closeHovered ? theme.danger : active ? theme.fg_inverse : theme.muted,
		);
	}

	// Drawn over a tab's outer padding, in the colour of that tab's text.
	private drawArrow(
		buffer: core.OptimizedBuffer,
		arrow: string,
		offset: number,
		table: string | undefined,
	): void {
		buffer.drawText(
			arrow,
			this.screenX + offset,
			this.screenY,
			table === this._active ? theme.fg_inverse : theme.fg,
		);
	}

	// -1 or 1 when x is on the ‹ or › arrow, else 0.
	private arrowAt(x: number): number {
		const relative: number = x - this.screenX;

		if (relative === 0 && this._first > 0) {
			return -1;
		}

		if (relative === this.rightArrowOffset && this.end < this._open.length) {
			return 1;
		}

		return 0;
	}

	private hitAt(x: number): Hit | null {
		if (this.arrowAt(x) !== 0) {
			return null;
		}

		const relative: number = x - this.screenX;
		const slot: number = Math.floor(relative / TAB_WIDTH);
		const table: string | undefined =
			relative >= 0 && slot < this.slots
				? this._open[this._first + slot]
				: undefined;

		if (table === undefined) {
			return null;
		}

		const column: number = relative % TAB_WIDTH;

		return {
			table: table,
			close: column >= CLOSE_OFFSET - 1 && column <= CLOSE_OFFSET + 1,
		};
	}

	protected override onResize(width: number, height: number): void {
		super.onResize(width, height);

		this.reveal();
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
				this._mouseX =
					event.type === "out" || event.target !== this ? null : event.x;

				this.updateHovered();
				break;
		}
	}

	private handleMouseDown(event: core.MouseEvent): void {
		const arrow: number = this.arrowAt(event.x);
		const hit: Hit | null = this.hitAt(event.x);

		if (event.button === core.MouseButton.RIGHT) {
			this.handleMenu(event, hit);

			return;
		}

		if (arrow !== 0 && event.button === core.MouseButton.LEFT) {
			this.scrollTo(this._first + arrow);

			return;
		}

		if (!hit) {
			return;
		}

		// Leaving the active tab, which holds the edited row, asks first when
		// the row has unsaved changes.
		const left: boolean = event.button === core.MouseButton.LEFT;

		if (event.button === core.MouseButton.MIDDLE || (left && hit.close)) {
			confirmDiscardIf(hit.table === this._active, (): void =>
				closeTable(hit.table),
			);
		} else if (left) {
			confirmDiscardIf(hit.table !== this._active, (): void =>
				openTable(hit.table),
			);
		}
	}

	// Right clicking a tab shows it first, which may ask to discard the edited
	// row, and then opens the menu.
	private handleMenu(event: core.MouseEvent, hit: Hit | null): void {
		if (!hit) {
			return;
		}

		const show: () => void = (): void => {
			Menu.make({
				x: event.x,
				y: event.y,
				items: [
					{
						label: `${CLOSE_ICON} Close`,
						shortcut: shortcutLabel(SHORTCUTS.closeTab),
						onSelect: (): void => {
							confirmDiscard((): void => closeTable());
						},
					},
					{
						label: `${CLOSE_ICON} Close all`,
						onSelect: (): void => {
							confirmDiscard(closeAllTables);
						},
					},
				],
			});
		};

		if (hit.table !== this._active) {
			confirmDiscard((): void => {
				openTable(hit.table);
				show();
			});
		} else {
			show();
		}
	}

	private handleScroll(event: core.MouseEvent): void {
		const direction: string | undefined = event.scroll?.direction;

		this.scrollTo(
			this._first + (direction === "up" || direction === "left" ? -1 : 1),
		);
	}

	private scrollTo(first: number): void {
		const max: number = Math.max(0, this._open.length - this.slots);

		this._first = clamp(first, 0, max);

		this.updateHovered();
		this.requestRender();
	}

	// Scrolls the least needed to bring the active tab into view.
	private reveal(): void {
		const index: number =
			this._active === null ? -1 : this._open.indexOf(this._active);

		let first: number = this._first;

		if (index >= 0 && index < first) {
			first = index;
		} else if (index >= first + this.slots) {
			first = index - this.slots + 1;
		}

		this.scrollTo(first);
	}

	private updateHovered(): void {
		const hovered: Hit | null =
			this._mouseX === null ? null : this.hitAt(this._mouseX);

		if (
			hovered?.table === this._hovered?.table &&
			hovered?.close === this._hovered?.close
		) {
			return;
		}

		this._hovered = hovered;

		this.requestRender();
	}

	private registerStoreEvents(): void {
		unbindOnDestroy(
			this,
			$openTables.subscribe((open: readonly string[]): void => {
				this._open = open;

				this.reveal();
			}),
			$activeTable.subscribe((active: string | null): void => {
				this._active = active;

				this.reveal();
			}),
		);
	}
}

export class TableTabs {
	private _component: core.BoxRenderable;

	constructor(options: core.BoxOptions) {
		// The grid draws the rule under the tabs, joined to its columns.
		this._component = new core.BoxRenderable(ctx, {
			width: "100%",
			flexShrink: 0,
			border: ["top"],
			borderColor: theme.border,
			visible: $openTables.get().length > 0,
			...options,
		});

		this._component.add(new TabBar());
		this.registerStoreEvents();
	}

	public static make(options: core.BoxOptions = {}): core.BoxRenderable {
		return new this(options)._component;
	}

	private registerStoreEvents(): void {
		unbindOnDestroy(
			this._component,
			$openTables.listen((open: readonly string[]): void => {
				this._component.visible = open.length > 0;
			}),
		);
	}
}
