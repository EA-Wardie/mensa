import * as core from "@opentui/core";
import { theme } from "../lib/config";
import { ctx } from "../lib/context";

interface Options extends core.BoxOptions {
	vertical?: boolean;
}

// A line between items. joinBorders joins its ends to the lines they meet.
export class Divider {
	private _options: Options;
	private _component: core.BoxRenderable;

	constructor(options: Options) {
		this._options = options;

		const { vertical, ...boxOptions }: Options = this._options;

		this._component = new core.BoxRenderable(ctx, {
			border: vertical ? ["left"] : ["top"],
			borderColor: theme.border,
			flexShrink: 0,
			...boxOptions,
		});
	}

	public static make(options: Options = {}): core.BoxRenderable {
		return new this(options)._component;
	}
}
