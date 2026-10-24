import * as core from "@opentui/core";
import { doubleClickTimeout, theme } from "../lib/config";
import { CANCEL_ICON, CONFIRM_ICON } from "../lib/consts";
import { ctx } from "../lib/context";
import { displayText } from "../lib/format";
import { $dialogOpen } from "../lib/store";
import { Button } from "./Button";

interface Options {
	heading: string;
	description: string;
	confirmLabel: string;
	// A deliberate confirmation takes a click on its button, not Return, and
	// ignores clicks for a double click's time after it opens, so a repeated
	// Return or a double click on an earlier dialog can't confirm it.
	deliberate?: boolean;
	onConfirm: () => void;
}

export class Confirmation {
	private _options: Options;
	private _component: core.BoxRenderable;
	private _dialog: core.BoxRenderable;
	// What had the focus, which the dialog takes while it's open and gives
	// back when it closes.
	private _focused: core.Renderable | null;
	private _openedAt: number = Date.now();

	constructor(options: Options) {
		this._options = options;

		this._component = new core.BoxRenderable(ctx, {
			width: "100%",
			height: "100%",
			alignItems: "center",
			justifyContent: "center",
			position: "absolute",
			top: 0,
			left: 0,
			zIndex: 100,
		});

		this._dialog = new core.BoxRenderable(ctx, {
			width: 42,
			backgroundColor: theme.surface,
			border: true,
			borderColor: theme.border,
			paddingX: 1,
			zIndex: 101,
		});

		this._component.add(this._dialog);
		this.addText(this._options.heading, core.TextAttributes.BOLD);
		this.addText(this._options.description);
		this.addFooter();

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

	private addText(content: string, attributes: number = 0): void {
		this._dialog.add(
			new core.TextRenderable(ctx, {
				content: displayText(content),
				fg: theme.fg,
				attributes: attributes,
				wrapMode: "word",
				marginBottom: 1,
			}),
		);
	}

	private addFooter(): void {
		const footer: core.BoxRenderable = new core.BoxRenderable(ctx, {
			width: "100%",
			flexDirection: "row",
			justifyContent: "flex-end",
			columnGap: 1,
		});

		footer.add(
			Button.make({
				label: `${CANCEL_ICON} Cancel`,
				onClick: (): void => {
					this.close();
				},
			}),
		);

		footer.add(
			Button.make({
				label: `${CONFIRM_ICON} ${this._options.confirmLabel}`,
				variant: "danger",
				onClick: (): void => {
					if (
						!this._options.deliberate ||
						Date.now() - this._openedAt >= doubleClickTimeout
					) {
						this.confirm();
					}
				},
			}),
		);

		this._dialog.add(footer);
	}

	private onKeypress = (key: core.KeyEvent): void => {
		if (key.name === "return" && !this._options.deliberate) {
			this.confirm();
		}

		if (key.name === "escape") {
			this.close();
		}
	};

	private confirm(): void {
		this.close();
		this._options.onConfirm();
	}

	private close(): void {
		ctx.keyInput.off("keypress", this.onKeypress);
		this._component.destroyRecursively();

		$dialogOpen.set(false);

		if (this._focused && !this._focused.isDestroyed) {
			this._focused.focus();
		}
	}
}
