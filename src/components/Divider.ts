import * as core from "@opentui/core";
import { theme } from "../lib/config";
import { BOTTOM_TEE, TOP_TEE } from "../lib/consts";
import { ctx } from "../lib/context";

interface Options extends core.BoxOptions {
	vertical?: boolean;
	// Joins a vertical divider to its parent's top and bottom borders.
	joined?: boolean;
}

// Drawn over the parent's borders, just outside the divider.
function drawTees(this: core.Renderable, buffer: core.OptimizedBuffer): void {
	buffer.drawText(TOP_TEE, this.screenX, this.screenY - 1, theme.border);
	buffer.drawText(
		BOTTOM_TEE,
		this.screenX,
		this.screenY + this.height,
		theme.border,
	);
}

export class Divider {
	private _options: Options;
	private _component: core.BoxRenderable;

	constructor(options: Options) {
		this._options = options;

		const { vertical, joined, ...boxOptions }: Options = this._options;

		this._component = new core.BoxRenderable(ctx, {
			border: vertical ? ["left"] : ["top"],
			borderColor: theme.border,
			flexShrink: 0,
			...(vertical && joined ? { renderAfter: drawTees } : {}),
			...boxOptions,
		});
	}

	public static make(options: Options = {}): core.BoxRenderable {
		return new this(options)._component;
	}
}
