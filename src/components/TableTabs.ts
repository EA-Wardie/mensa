import * as core from "@opentui/core";
import { closeAllTabs, closeTab } from "../lib/actions";
import { theme } from "../lib/config";
import { ADD_ICON, CLOSE_ICON, QUERY_ICON, TAB_MIN_WIDTH } from "../lib/consts";
import { ctx } from "../lib/context";
import { confirmDiscard } from "../lib/editor";
import { displayText } from "../lib/format";
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

// A visible tab, its label, where it starts in the bar and how wide it is.
interface Placed {
	tab: Tab;
	label: string;
	x: number;
	width: number;
}

// Each tab is " name  󰅖 ": a space, the name, a gap, the icon and a space.
const TAB_PADDING: number = 5;

// The close icon's offset from the end of its tab.
const CLOSE_FROM_END: number = 2;

// The + after the last tab: a space, the icon and a space.
const ADD_WIDTH: number = 3;

const SCROLL_LEFT: string = "‹";

const SCROLL_RIGHT: string = "›";

function labelOf(tab: Tab): string {
	return displayText(
		tab.kind === "query" ? `${QUERY_ICON} ${tabLabel(tab)}` : tabLabel(tab),
	);
}

// A tab is as wide as its name, so names aren't cut, but no narrower than the
// minimum.
function widthOf(label: string): number {
	return Math.max(TAB_MIN_WIDTH, Bun.stringWidth(label) + TAB_PADDING);
}

class TabBar extends core.Renderable {
	private _tabs: readonly Tab[] = [];
	// Each tab's label, made once, since a tab's never changes.
	private _labels: string[] = [];
	// Where each tab starts when the first is at 0, with one more for where
	// the last ends, so a span of tabs, or a tab's width, is one subtraction.
	private _starts: number[] = [0];
	private _active: Tab | null = null;
	// How far the tabs are scrolled, in cells, so the first one shown may be
	// cut at the left.
	private _scroll: number = 0;
	private _hovered: Hit | null = null;
	private _mouseX: number | null = null;

	constructor() {
		super(ctx, { width: "100%", height: 1 });

		this.registerStoreEvents();
	}

	// Where the tabs end while they overflow, leaving the + its room.
	private get limit(): number {
		return this.width - ADD_WIDTH;
	}

	// The width of every tab together.
	private get total(): number {
		return this._starts.at(-1) ?? 0;
	}

	// Overflowing tabs reach the + at the edge of the bar, and the last one is
	// cut there.
	private get overflows(): boolean {
		return this.total - this._scroll > this.limit;
	}

	// Where the + is drawn: right after the last tab, or at the edge.
	private get addOffset(): number {
		return Math.min(this.total - this._scroll, this.limit);
	}

	// Where the › arrow is drawn, over the cut tab's end.
	private get rightArrowOffset(): number {
		return this.limit - 1;
	}

	// Scrolled all the way, the last tab ends at the +.
	private get maxScroll(): number {
		return Math.max(0, this.total - this.limit);
	}

	// The tab at a cell of the strip of every tab, or -1 past them.
	private indexAt(cell: number): number {
		return this._starts.findIndex(
			(start: number, index: number): boolean =>
				index < this._tabs.length && cell < (this._starts[index + 1] ?? start),
		);
	}

	// The tabs in the bar, the first and last of which may be cut.
	private placedTabs(): Placed[] {
		const placed: Placed[] = [];

		for (
			let index: number = Math.max(0, this.indexAt(this._scroll));
			index < this._tabs.length;
			index++
		) {
			const tab: Tab | undefined = this._tabs[index];
			const start: number = this._starts[index] ?? 0;
			const x: number = start - this._scroll;

			if (x >= this.limit) {
				break;
			}

			if (tab !== undefined) {
				placed.push({
					tab: tab,
					label: this._labels[index] ?? "",
					x: x,
					width: (this._starts[index + 1] ?? start) - start,
				});
			}
		}

		return placed;
	}

	// The tabs are clipped where the + starts, so a cut tab ends there, and the
	// + to the bar, so neither draws over the row editor.
	protected override renderSelf(buffer: core.OptimizedBuffer): void {
		const placed: Placed[] = this.placedTabs();

		buffer.pushScissorRect(
			this.screenX,
			this.screenY,
			Math.max(0, this.overflows ? this.limit : this.width),
			1,
		);

		for (const tab of placed) {
			this.drawTab(buffer, tab);
		}

		if (this._scroll > 0) {
			this.drawArrow(buffer, SCROLL_LEFT, 0, placed[0]?.tab);
		}

		if (this.overflows) {
			this.drawArrow(
				buffer,
				SCROLL_RIGHT,
				this.rightArrowOffset,
				placed.at(-1)?.tab,
			);
		}

		buffer.popScissorRect();
		buffer.pushScissorRect(this.screenX, this.screenY, this.width, 1);

		this.drawAdd(buffer);

		buffer.popScissorRect();
	}

	private drawTab(
		buffer: core.OptimizedBuffer,
		{ tab, label, x, width }: Placed,
	): void {
		const left: number = this.screenX + x;
		const active: boolean = tab === this._active;
		const hovered: boolean = this._hovered?.tab === tab;
		const closeHovered: boolean = hovered && this._hovered?.close === true;

		if (active || hovered) {
			buffer.fillRect(
				left,
				this.screenY,
				width,
				1,
				active ? theme.active : theme.hover,
			);
		}

		buffer.drawText(
			label,
			left + 1,
			this.screenY,
			active ? theme.fg_inverse : theme.fg,
			undefined,
			active ? core.TextAttributes.BOLD : core.TextAttributes.NONE,
		);
		buffer.drawText(
			CLOSE_ICON,
			left + width - CLOSE_FROM_END,
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

	// Drawn over the tab at that edge, in the colour of its text.
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

		if (relative === 0 && this._scroll > 0) {
			return -1;
		}

		if (relative === this.rightArrowOffset && this.overflows) {
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

		// The cut end of the last tab is under the +.
		if (relative < 0 || relative >= this.limit) {
			return null;
		}

		// Found without placing the tabs, since it runs on every mouse move.
		const index: number = this.indexAt(relative + this._scroll);
		const tab: Tab | undefined = this._tabs[index];

		if (tab === undefined) {
			return null;
		}

		const close: number =
			(this._starts[index + 1] ?? 0) - this._scroll - CLOSE_FROM_END;

		return { tab: tab, close: relative >= close - 1 && relative <= close + 1 };
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
			this.step(arrow);

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
		} else if (left && tab === this._active) {
			// It may be cut at an edge.
			this.reveal();
		} else if (left) {
			confirmDiscard((): void => showTab(tab));
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

		this.step(direction === "up" || direction === "left" ? -1 : 1);
	}

	// Scrolls to the start of the tab before or after the one cut at the left,
	// or to the end, where the last tab meets the +.
	private step(direction: number): void {
		const index: number = this.indexAt(this._scroll);
		const start: number = this._starts[index] ?? 0;
		const target: number =
			direction < 0
				? start < this._scroll
					? start
					: (this._starts[index - 1] ?? 0)
				: (this._starts[index + 1] ?? this.maxScroll);

		this.scrollTo(target);
	}

	private scrollTo(scroll: number): void {
		this._scroll = clamp(scroll, 0, this.maxScroll);

		this.updateHovered();
		this.requestRender();
	}

	// Scrolls the least needed to bring the active tab into view.
	private reveal(): void {
		const index: number =
			this._active === null ? -1 : this._tabs.indexOf(this._active);

		let scroll: number = this._scroll;

		if (index >= 0) {
			const start: number = this._starts[index] ?? 0;
			const end: number = this._starts[index + 1] ?? start;

			scroll = Math.min(Math.max(scroll, end - this.limit), start);
		}

		this.scrollTo(scroll);
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
				this._labels = tabs.map(labelOf);
				this._starts = [0];

				for (const label of this._labels) {
					this._starts.push((this._starts.at(-1) ?? 0) + widthOf(label));
				}

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
