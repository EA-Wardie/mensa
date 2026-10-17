import * as core from "@opentui/core";
import { theme } from "../lib/config";
import { ctx } from "../lib/context";
import { clamp } from "../lib/math";

interface Options extends core.RenderableOptions<HorizontalScrollBar> {
	onChange: (position: number) => void;
}

interface Thumb {
	start: number;
	width: number;
	max: number;
}

// A lower half block keeps the thumb as thin as a vertical scrollbar's, which a
// full cell high ScrollBarRenderable can't do.
const THUMB: string = "▄";

// Takes the same sizes as ScrollBarRenderable, with the track as wide as the
// renderable.
export class HorizontalScrollBar extends core.Renderable {
	private _onChange: (position: number) => void;
	private _scrollSize: number = 0;
	private _viewportSize: number = 0;
	private _scrollPosition: number = 0;
	private _grab: number | null = null;

	constructor(options: Options) {
		super(ctx, { height: 1, ...options });

		this._onChange = options.onChange;
	}

	public static make(options: Options): HorizontalScrollBar {
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

	private thumb(): Thumb | null {
		const total: number = this._scrollSize;
		const track: number = this.width;

		if (total <= this._viewportSize || track <= 0) {
			return null;
		}

		const width: number = Math.min(
			track,
			Math.max(1, Math.round((track * this._viewportSize) / total)),
		);
		const max: number = total - this._viewportSize;
		const start: number = Math.round(
			(this._scrollPosition / max) * (track - width),
		);

		return { start, width, max };
	}

	protected override renderSelf(buffer: core.OptimizedBuffer): void {
		const thumb: Thumb | null = this.thumb();

		if (!thumb) {
			return;
		}

		for (let cell: number = 0; cell < thumb.width; cell++) {
			buffer.setCellWithAlphaBlending(
				this.screenX + thumb.start + cell,
				this.screenY,
				THUMB,
				theme.scrollbar_thumb,
				theme.scrollbar_track,
			);
		}
	}

	protected override onMouseEvent(event: core.MouseEvent): void {
		switch (event.type) {
			case "down":
				this.handleDown(event);
				break;
			case "drag":
				this.drag(event.x);
				break;
			case "up":
			case "drag-end":
				this.release();
				break;
		}
	}

	private handleDown(event: core.MouseEvent): void {
		const thumb: Thumb | null = this.thumb();
		const x: number = event.x - this.screenX;

		this._grab = null;

		if (!thumb || event.button !== core.MouseButton.LEFT) {
			return;
		}

		const onThumb: boolean = x >= thumb.start && x < thumb.start + thumb.width;

		// Clicking the track centres the thumb on the click, then drags from there.
		this._grab = onThumb ? x - thumb.start : Math.floor(thumb.width / 2);

		this.drag(event.x);
	}

	// A drag goes to whatever is under the pointer when it first moves, so the
	// parent passes on a thumb drag that strays off the bar.
	public drag(screenX: number): void {
		const thumb: Thumb | null = this.thumb();

		if (!thumb || this._grab === null) {
			return;
		}

		const room: number = this.width - thumb.width;
		const start: number = clamp(screenX - this.screenX - this._grab, 0, room);

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
