import * as core from "@opentui/core";
import { theme } from "../lib/config";
import { MENU_WIDTH } from "../lib/consts";
import { ctx } from "../lib/context";
import { displayText, fitText } from "../lib/format";
import { type Icon, iconWidth } from "../lib/icon";

interface Options extends core.BoxOptions {
	label: string;
	icon?: (highlighted: boolean) => Icon;
	shortcut?: string;
	danger?: boolean;
	onClick: () => void;
}

// The menu's border and the button's padding.
const LABEL_WIDTH: number = MENU_WIDTH - 4;

export class MenuButton {
	private _options: Options;
	private _component: core.BoxRenderable;
	private _icon: core.TextRenderable | null = null;
	private _label: core.TextRenderable;
	private _shortcut: core.TextRenderable | null = null;

	constructor(options: Options) {
		this._options = options;

		// Runs on release, like the other buttons, so the release can't land on
		// whatever the item opens. Only the left button counts, so releasing the
		// right click that opened the menu can't choose the item under it.
		this._component = new core.BoxRenderable(ctx, {
			flexDirection: "row",
			justifyContent: "space-between",
			paddingX: 1,
			onMouseOver: (): void => {
				this.setColors(theme.active, theme.fg_inverse);
			},
			onMouseOut: (): void => {
				this.setColors(theme.transparent, null);
			},
			onMouseDown: (): void => {
				this.setColors(theme.pressed, theme.fg_inverse);
			},
			onMouseUp: (event: core.MouseEvent): void => {
				this.setColors(theme.transparent, null);

				if (event.button === core.MouseButton.LEFT) {
					this._options.onClick();
				}
			},
			...this._options,
		});

		this._label = this.addLabel();
		this.addShortcut();
	}

	public static make(options: Options): core.BoxRenderable {
		return new this(options)._component;
	}

	// A null foreground puts back the idle colours.
	private setColors(background: core.RGBA, foreground: core.RGBA | null): void {
		this._component.backgroundColor = background;

		this._label.fg = foreground ?? this.labelColor();

		if (this._icon && this._options.icon) {
			this._icon.fg = this._options.icon(foreground !== null).color;
		}

		if (this._shortcut) {
			this._shortcut.fg = foreground ?? theme.muted;
		}
	}

	private labelColor(): core.RGBA {
		return this._options.danger ? theme.danger : theme.fg;
	}

	// The icon and the label sit together at the start, and the shortcut at
	// the end.
	private addLabel(): core.TextRenderable {
		const shortcutWidth: number = this._options.shortcut
			? Bun.stringWidth(this._options.shortcut) + 1
			: 0;
		const icon: Icon | undefined = this._options.icon?.(false);
		const iconSpace: number = iconWidth(icon);
		const start: core.BoxRenderable = new core.BoxRenderable(ctx, {
			flexDirection: "row",
			gap: 1,
		});

		if (icon) {
			this._icon = new core.TextRenderable(ctx, {
				content: icon.icon,
				fg: icon.color,
				selectable: false,
			});

			start.add(this._icon);
		}

		const label: core.TextRenderable = new core.TextRenderable(ctx, {
			content: fitText(
				displayText(this._options.label),
				LABEL_WIDTH - shortcutWidth - iconSpace,
			),
			fg: this.labelColor(),
			attributes: core.TextAttributes.BOLD,
			selectable: false,
		});

		start.add(label);
		this._component.add(start);

		return label;
	}

	private addShortcut(): void {
		if (!this._options.shortcut) {
			return;
		}

		this._shortcut = new core.TextRenderable(ctx, {
			content: this._options.shortcut,
			fg: theme.muted,
			attributes: core.TextAttributes.ITALIC,
			selectable: false,
		});

		this._component.add(this._shortcut);
	}
}
