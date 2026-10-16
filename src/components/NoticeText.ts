import * as core from "@opentui/core";
import type { ReadableAtom } from "nanostores";
import { theme } from "../lib/config";
import { ctx } from "../lib/context";
import { displayText } from "../lib/format";
import { unbindOnDestroy } from "../lib/lifetime";
import { $notice } from "../lib/store";

interface Options extends core.TextOptions {
	// The text shown while there is no notice.
	fallback: () => string;
	fallbackColor?: core.RGBA;
	redrawOn?: ReadableAtom<unknown>[];
}

// A footer line that shows $notice in the danger colour, or else its fallback.
export class NoticeText {
	private _options: Options;
	private _component: core.TextRenderable;

	constructor(options: Options) {
		const {
			fallback: _fallback,
			fallbackColor: _fallbackColor,
			redrawOn: _redrawOn,
			...textOptions
		}: Options = options;

		this._options = options;

		this._component = new core.TextRenderable(ctx, {
			content: "",
			selectable: false,
			...textOptions,
		});

		this.registerStoreEvents();
	}

	public static make(options: Options): core.TextRenderable {
		return new this(options)._component;
	}

	private update(): void {
		const notice: string = $notice.get();

		this._component.content = displayText(notice || this._options.fallback());
		this._component.fg = notice
			? theme.danger
			: (this._options.fallbackColor ?? theme.fg);
	}

	private registerStoreEvents(): void {
		unbindOnDestroy(
			this._component,
			...[$notice, ...(this._options.redrawOn ?? [])].map(
				(atom: ReadableAtom<unknown>): (() => void) =>
					atom.subscribe((): void => {
						this.update();
					}),
			),
		);
	}
}
