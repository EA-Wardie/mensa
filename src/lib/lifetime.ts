import * as core from "@opentui/core";

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
