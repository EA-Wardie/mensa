import { doubleClickTimeout } from "./config";

// Tells a second click on the same target, within the double click timeout,
// from a first one.
export class DoubleClick<T> {
	private _same: (a: T, b: T) => boolean;
	private _last: { target: T; time: number } | null = null;

	constructor(same: (a: T, b: T) => boolean = Object.is) {
		this._same = same;
	}

	// Whether this click makes a double click. One that does starts over.
	public click(target: T): boolean {
		const now: number = Date.now();
		const isDouble: boolean =
			this._last !== null &&
			this._same(this._last.target, target) &&
			now - this._last.time < doubleClickTimeout;

		this._last = isDouble ? null : { target: target, time: now };

		return isDouble;
	}

	public reset(): void {
		this._last = null;
	}
}
