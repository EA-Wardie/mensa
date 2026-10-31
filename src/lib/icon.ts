import type { RGBA } from "@opentui/core";

// A glyph drawn in its own colour, such as a column's type or a connection's
// dot.
export interface Icon {
	icon: string;
	color: RGBA;
}
