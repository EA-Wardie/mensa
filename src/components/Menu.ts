import * as core from "@opentui/core";
import { theme } from "../lib/config";
import { MENU_WIDTH } from "../lib/consts";
import { ctx } from "../lib/context";
import { clamp } from "../lib/math";
import { $dialogOpen } from "../lib/store";
import { Divider } from "./Divider";
import { MenuButton } from "./MenuButton";

export interface MenuItem {
	label: string;
	shortcut?: string;
	danger?: boolean;
	onSelect: () => void;
}

// A divider is a line between groups of items.
export type MenuEntry = MenuItem | "divider";

interface Options {
	items: MenuEntry[];
	x: number;
	y: number;
}

// A context menu at the mouse. It sets $dialogOpen like a dialog, so the
// shortcuts pause while it's open. Choosing an item closes the menu before the
// item runs, so the item can open a dialog or another menu.
export class Menu {
	private _options: Options;
	private _component: core.BoxRenderable;
	private _menu: core.BoxRenderable;
	// What had the focus, which the menu takes while it's open and gives back
	// when it closes.
	private _focused: core.Renderable | null;

	constructor(options: Options) {
		this._options = options;

		// Clicks on the menu bubble up here too, so only the overlay's own close
		// it.
		this._component = new core.BoxRenderable(ctx, {
			width: "100%",
			height: "100%",
			position: "absolute",
			top: 0,
			left: 0,
			zIndex: 100,
			onMouseDown: (event: core.MouseEvent): void => {
				if (event.target === this._component) {
					this.close();
				}
			},
		});

		this._menu = this.addMenu();
		this.addItems();

		this._focused = ctx.currentFocusedRenderable;
		this._focused?.blur();

		ctx.keyInput.on("keypress", this.onKeypress);
		ctx.root.add(this._component);

		$dialogOpen.set(true);
	}

	public static make(options: Options): core.BoxRenderable | null {
		if ($dialogOpen.get()) {
			return null;
		}

		return new this(options)._component;
	}

	// Below the mouse, or above it when there's no room below.
	private addMenu(): core.BoxRenderable {
		const { items, x, y }: Options = this._options;
		const height: number = items.length + 2;
		const below: boolean = y + 1 + height <= ctx.height;
		const menu: core.BoxRenderable = new core.BoxRenderable(ctx, {
			width: MENU_WIDTH,
			backgroundColor: theme.surface,
			border: true,
			borderColor: theme.border,
			position: "absolute",
			left: clamp(x, 0, Math.max(0, ctx.width - MENU_WIDTH)),
			top: Math.max(0, below ? y + 1 : y - height),
			zIndex: 101,
		});

		this._component.add(menu);

		return menu;
	}

	private addItems(): void {
		for (const item of this._options.items) {
			if (item === "divider") {
				this._menu.add(Divider.make());

				continue;
			}

			this._menu.add(
				MenuButton.make({
					...item,
					onClick: (): void => {
						this.close();
						item.onSelect();
					},
				}),
			);
		}
	}

	private onKeypress = (key: core.KeyEvent): void => {
		if (key.name === "escape") {
			key.preventDefault();
			this.close();
		}
	};

	private close(): void {
		if (this._component.isDestroyed) {
			return;
		}

		ctx.keyInput.off("keypress", this.onKeypress);
		this._component.destroyRecursively();

		$dialogOpen.set(false);

		if (this._focused && !this._focused.isDestroyed) {
			this._focused.focus();
		}
	}
}
