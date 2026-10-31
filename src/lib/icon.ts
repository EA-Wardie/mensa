import type { RGBA } from "@opentui/core";

// A glyph drawn in its own colour, such as a column's type or a connection's
// dot.
export interface Icon {
	icon: string;
	color: RGBA;
}

// The cells an icon takes before a label: the icon and a space, or none.
export function iconWidth(icon: Icon | null | undefined): number {
	return icon ? Bun.stringWidth(icon.icon) + 1 : 0;
}
