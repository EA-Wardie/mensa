import * as core from "@opentui/core";
import { ctx } from "./context";

// Screens are destroyed when they change, so store listeners must go with them.
export function unbindOnDestroy(
	renderable: core.Renderable,
	...unbinds: (() => void)[]
): void {
	renderable.once(core.RenderableEvents.DESTROYED, (): void => {
		for (const unbind of unbinds) {
			unbind();
		}
	});
}

// Runs the action now and again after the next frame, while the renderable
// lives, since new renderables have no layout until they have been rendered.
export function afterLayout(
	renderable: core.Renderable,
	action: () => void,
): void {
	const run: () => void = (): void => {
		if (!renderable.isDestroyed) {
			action();
		}
	};

	run();
	ctx.once(core.CliRenderEvents.FRAME, run);
	ctx.requestRender();
}
