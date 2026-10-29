import * as core from "@opentui/core";
import { theme } from "../lib/config";
import { THUMB_X, THUMB_Y } from "../lib/consts";
import { ctx } from "../lib/context";
import { unbindOnDestroy } from "../lib/lifetime";
import { clamp } from "../lib/math";

type Orientation = "horizontal" | "vertical";

interface Options extends core.RenderableOptions<RuleScrollBar> {
	orientation: Orientation;
	onChange: (position: number) => void;
}

interface Thumb {
	start: number;
	length: number;
	max: number;
}

// A scrollbar laid over a rule, which its owner draws, as a heavier stretch of
// the same line. Takes the same sizes as ScrollBarRenderable, with the track as
// long as the renderable, and draws nothing while everything is in view. The
// thumb is drawn once the whole frame is, so it stays one solid line over the
// joins on its rule and whatever later renderables draw there, such as the
// footer's divider.
export class RuleScrollBar extends core.Renderable {
	private _vertical: boolean;
	private _onChange: (position: number) => void;
	private _scrollSize: number = 0;
	private _viewportSize: number = 0;
	private _scrollPosition: number = 0;
	private _grab: number | null = null;
	// The thumb to draw at the end of this frame, set only while the bar is
	// rendered, so a hidden one draws nothing.
	private _pending: Thumb | null = null;

	constructor({ orientation, onChange, ...options }: Options) {
		super(ctx, {
			...(orientation === "vertical" ? { width: 1 } : { height: 1 }),
			...options,
		});

		this._vertical = orientation === "vertical";
		this._onChange = onChange;

		ctx.addPostProcessFn(this.drawThumb);
		unbindOnDestroy(this, (): void => {
			ctx.removePostProcessFn(this.drawThumb);
		});
	}

	public static make(options: Options): RuleScrollBar {
		return new this(options);
	}

	public set scrollSize(size: number) {
		if (size === this._scrollSize) {
			return;
		}

		this._scrollSize = size;

		this.requestRender();
	}

	public set viewportSize(size: number) {
		if (size === this._viewportSize) {
			return;
		}

		this._viewportSize = size;

		this.requestRender();
	}

	public set scrollPosition(position: number) {
		if (position === this._scrollPosition) {
			return;
		}

		this._scrollPosition = position;

		this.requestRender();
	}

	private get track(): number {
		return this._vertical ? this.height : this.width;
	}

	// Where a point is along the track, from its start.
	private along(x: number, y: number): number {
		return this._vertical ? y - this.screenY : x - this.screenX;
	}

	private thumb(): Thumb | null {
		const total: number = this._scrollSize;
		const track: number = this.track;

		if (total <= this._viewportSize || track <= 0) {
			return null;
		}

		const length: number = Math.min(
			track,
			Math.max(1, Math.round((track * this._viewportSize) / total)),
		);
		const max: number = total - this._viewportSize;
		const start: number = Math.round(
			(this._scrollPosition / max) * (track - length),
		);

		return { start, length, max };
	}

	protected override renderSelf(): void {
		this._pending = this.thumb();
	}

	private drawThumb = (buffer: core.OptimizedBuffer): void => {
		const thumb: Thumb | null = this._pending;

		this._pending = null;

		if (!thumb) {
			return;
		}

		if (!this._vertical) {
			buffer.drawText(
				THUMB_X.repeat(thumb.length),
				this.screenX + thumb.start,
				this.screenY,
				theme.scrollbar,
			);

			return;
		}

		for (let cell: number = 0; cell < thumb.length; cell++) {
			buffer.drawText(
				THUMB_Y,
				this.screenX,
				this.screenY + thumb.start + cell,
				theme.scrollbar,
			);
		}
	};

	protected override onMouseEvent(event: core.MouseEvent): void {
		switch (event.type) {
			case "down":
				this.handleDown(event);
				break;
			case "drag":
				this.drag(event.x, event.y);
				break;
			case "up":
			case "drag-end":
				this.release();
				break;
		}
	}

	private handleDown(event: core.MouseEvent): void {
		const thumb: Thumb | null = this.thumb();
		const at: number = this.along(event.x, event.y);

		this._grab = null;

		if (!thumb || event.button !== core.MouseButton.LEFT) {
			return;
		}

		const onThumb: boolean =
			at >= thumb.start && at < thumb.start + thumb.length;

		// Clicking the track centres the thumb on the click, then drags from there.
		this._grab = onThumb ? at - thumb.start : Math.floor(thumb.length / 2);

		this.drag(event.x, event.y);
	}

	// A drag goes to whatever is under the pointer when it first moves, so the
	// owner passes on a thumb drag that strays off the bar.
	public drag(x: number, y: number): void {
		const thumb: Thumb | null = this.thumb();

		if (!thumb || this._grab === null) {
			return;
		}

		const room: number = this.track - thumb.length;
		const start: number = clamp(this.along(x, y) - this._grab, 0, room);

		this._onChange(room ? Math.round((start / room) * thumb.max) : 0);
	}

	public release(): void {
		if (this._grab === null) {
			return;
		}

		this._grab = null;

		this.requestRender();
	}
}
