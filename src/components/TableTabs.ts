import * as core from "@opentui/core";
import { closeAllTabs, closeTab } from "../lib/actions";
import { theme } from "../lib/config";
import { ADD_ICON, CLOSE_ICON, QUERY_ICON, TAB_WIDTH } from "../lib/consts";
import { ctx } from "../lib/context";
import { confirmDiscard, confirmDiscardIf } from "../lib/editor";
import { displayText, fitText } from "../lib/format";
import { unbindOnDestroy } from "../lib/lifetime";
import { clamp } from "../lib/math";
import { SHORTCUTS, shortcutLabel } from "../lib/shortcuts";
import { $activeTab, $tabs, type Tab } from "../lib/store";
import { newQuery, showTab, tabLabel } from "../lib/tabs";
import { Menu } from "./Menu";

// A tab, and whether it's on its close icon. A null tab is the + after the
// tabs.
interface Hit {
	tab: Tab | null;
	close: boolean;
}

// Each tab is " name…  󰅖 ": a space, the name, a gap, the icon and a space.
const CLOSE_OFFSET: number = TAB_WIDTH - 2;

const NAME_WIDTH: number = TAB_WIDTH - 5;

// The + after the last tab: a space, the icon and a space.
const ADD_WIDTH: number = 3;

const SCROLL_LEFT: string = "‹";

const SCROLL_RIGHT: string = "›";

class TabBar extends core.Renderable {
	private _tabs: readonly Tab[] = [];
	private _active: Tab | null = null;
	private _first: number = 0;
	private _hovered: Hit | null = null;
	private _mouseX: number | null = null;

	constructor() {
		super(ctx, { width: "100%", height: 1 });

		this.registerStoreEvents();
	}

	// The + keeps its room, so it shows however many tabs are open.
	private get slots(): number {
		return Math.max(1, Math.floor((this.width - ADD_WIDTH) / TAB_WIDTH));
	}

	// One past the last visible tab.
	private get end(): number {
		return Math.min(this._tabs.length, this._first + this.slots);
	}

	// Where the + is drawn, right after the last visible tab.
	private get addOffset(): number {
		return (this.end - this._first) * TAB_WIDTH;
	}

	// Where the › arrow is drawn, over the last visible tab's outer padding.
	private get rightArrowOffset(): number {
		return this.addOffset - 1;
	}

	protected override renderSelf(buffer: core.OptimizedBuffer): void {
		const end: number = this.end;

		for (let index: number = this._first; index < end; index++) {
			const tab: Tab | undefined = this._tabs[index];

			if (tab !== undefined) {
				this.drawTab(
					buffer,
					tab,
					this.screenX + (index - this._first) * TAB_WIDTH,
				);
			}
		}

		if (this._first > 0) {
			this.drawArrow(buffer, SCROLL_LEFT, 0, this._tabs[this._first]);
		}

		if (end < this._tabs.length) {
			this.drawArrow(
				buffer,
				SCROLL_RIGHT,
				this.rightArrowOffset,
				this._tabs[end - 1],
			);
		}

		this.drawAdd(buffer);
	}

	private drawTab(buffer: core.OptimizedBuffer, tab: Tab, x: number): void {
		const active: boolean = tab === this._active;
		const hovered: boolean = this._hovered?.tab === tab;
		const closeHovered: boolean = hovered && this._hovered?.close === true;
		const label: string = displayText(
			tab.kind === "query" ? `${QUERY_ICON} ${tabLabel(tab)}` : tabLabel(tab),
		);

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
			fitText(label, NAME_WIDTH),
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

	private drawAdd(buffer: core.OptimizedBuffer): void {
		const x: number = this.screenX + this.addOffset;
		const hovered: boolean = this._hovered?.tab === null;

		if (hovered) {
			buffer.fillRect(x, this.screenY, ADD_WIDTH, 1, theme.hover);
		}

		buffer.drawText(ADD_ICON, x + 1, this.screenY, theme.fg);
	}

	// Drawn over a tab's outer padding, in the colour of that tab's text.
	private drawArrow(
		buffer: core.OptimizedBuffer,
		arrow: string,
		offset: number,
		tab: Tab | undefined,
	): void {
		buffer.drawText(
			arrow,
			this.screenX + offset,
			this.screenY,
			tab === this._active ? theme.fg_inverse : theme.fg,
		);
	}

	// -1 or 1 when x is on the ‹ or › arrow, else 0.
	private arrowAt(x: number): number {
		const relative: number = x - this.screenX;

		if (relative === 0 && this._first > 0) {
			return -1;
		}

		if (relative === this.rightArrowOffset && this.end < this._tabs.length) {
			return 1;
		}

		return 0;
	}

	private hitAt(x: number): Hit | null {
		if (this.arrowAt(x) !== 0) {
			return null;
		}

		const relative: number = x - this.screenX;

		if (relative >= this.addOffset && relative < this.addOffset + ADD_WIDTH) {
			return { tab: null, close: false };
		}

		const slot: number = Math.floor(relative / TAB_WIDTH);
		const tab: Tab | undefined =
			relative >= 0 && slot < this.slots
				? this._tabs[this._first + slot]
				: undefined;

		if (tab === undefined) {
			return null;
		}

		const column: number = relative % TAB_WIDTH;

		return {
			tab: tab,
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
		const left: boolean = event.button === core.MouseButton.LEFT;

		if (event.button === core.MouseButton.RIGHT) {
			this.handleMenu(event, hit);

			return;
		}

		if (arrow !== 0 && left) {
			this.scrollTo(this._first + arrow);

			return;
		}

		if (!hit) {
			return;
		}

		const { tab, close }: Hit = hit;

		// Leaving the active tab, which holds the edited row, asks first when
		// the row has unsaved changes. Closing asks for itself.
		if (tab === null) {
			if (left) {
				confirmDiscard(newQuery);
			}
		} else if (event.button === core.MouseButton.MIDDLE || (left && close)) {
			closeTab(tab);
		} else if (left) {
			confirmDiscardIf(tab !== this._active, (): void => showTab(tab));
		}
	}

	// Right clicking a tab shows it first, which may ask to discard the edited
	// row, and then opens the menu.
	private handleMenu(event: core.MouseEvent, hit: Hit | null): void {
		const tab: Tab | null = hit?.tab ?? null;

		if (tab === null) {
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
							closeTab();
						},
					},
					{
						label: `${CLOSE_ICON} Close all`,
						onSelect: closeAllTabs,
					},
				],
			});
		};

		if (tab !== this._active) {
			confirmDiscard((): void => {
				showTab(tab);
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
		const max: number = Math.max(0, this._tabs.length - this.slots);

		this._first = clamp(first, 0, max);

		this.updateHovered();
		this.requestRender();
	}

	// Scrolls the least needed to bring the active tab into view.
	private reveal(): void {
		const index: number =
			this._active === null ? -1 : this._tabs.indexOf(this._active);

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
			hovered?.tab === this._hovered?.tab &&
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
			$tabs.subscribe((tabs: readonly Tab[]): void => {
				this._tabs = tabs;

				this.reveal();
			}),
			$activeTab.subscribe((active: Tab | null): void => {
				this._active = active;

				this.reveal();
			}),
		);
	}
}

// Always shown once connected, so the + can open a query with no tabs open.
export class TableTabs {
	private _component: core.BoxRenderable;

	constructor(options: core.BoxOptions) {
		// The grid draws the rule under the tabs, joined to its columns.
		this._component = new core.BoxRenderable(ctx, {
			width: "100%",
			flexShrink: 0,
			border: ["top"],
			borderColor: theme.border,
			...options,
		});

		this._component.add(new TabBar());
	}

	public static make(options: core.BoxOptions = {}): core.BoxRenderable {
		return new this(options)._component;
	}
}
