import * as core from "@opentui/core";
import { theme } from "./config";

// The arms of a line's character, as bits.
const UP: number = 1;
const RIGHT: number = 2;
const DOWN: number = 4;
const LEFT: number = 8;

const ARMS: [keyof core.BorderCharacters, number][] = [
	["horizontal", LEFT | RIGHT],
	["vertical", UP | DOWN],
	["topLeft", RIGHT | DOWN],
	["topRight", LEFT | DOWN],
	["bottomLeft", UP | RIGHT],
	["bottomRight", UP | LEFT],
	["topT", LEFT | RIGHT | DOWN],
	["bottomT", LEFT | RIGHT | UP],
	["leftT", UP | DOWN | RIGHT],
	["rightT", UP | DOWN | LEFT],
	["cross", UP | RIGHT | DOWN | LEFT],
];

// Each neighbour's offset, the arm toward it, and its arm back.
const NEIGHBOURS: [number, number, number, number][] = [
	[0, -1, UP, DOWN],
	[1, 0, RIGHT, LEFT],
	[0, 1, DOWN, UP],
	[-1, 0, LEFT, RIGHT],
];

const CHARS: core.BorderCharacters = core.BorderChars.single;

const armsByChar: Map<number, number> = new Map(
	ARMS.map(
		([key, arms]: [keyof core.BorderCharacters, number]): [number, number] => [
			CHARS[key].codePointAt(0) ?? 0,
			arms,
		],
	),
);

const charByArms: Map<number, string> = new Map(
	ARMS.map(
		([key, arms]: [keyof core.BorderCharacters, number]): [number, string] => [
			arms,
			CHARS[key],
		],
	),
);

// Keeps the colour under a joined line.
const CLEAR: core.RGBA = core.RGBA.fromValues(0, 0, 0, 0);

// Each cell's arms, and the layer it's in, kept between frames.
let cellArms: Uint8Array = new Uint8Array(0);
let cellLayers: Uint8Array = new Uint8Array(0);

// The menus and dialogs drawn over the screen, in the order they opened.
let layers: core.Renderable[] = [];

// Keeps a menu's or dialog's lines apart from those under it, until it's
// destroyed. Its own lines still join.
export function addLayer(renderable: core.Renderable): void {
	layers.push(renderable);
}

// Numbers each cell by the topmost layer over it, or 0.
function markLayers(width: number, height: number): void {
	layers = layers.filter(
		(layer: core.Renderable): boolean => !layer.isDestroyed,
	);
	cellLayers.fill(0, 0, width * height);

	layers.forEach((layer: core.Renderable, index: number): void => {
		const left: number = Math.max(0, layer.screenX);
		const top: number = Math.max(0, layer.screenY);
		const right: number = Math.min(width, layer.screenX + layer.width);
		const bottom: number = Math.min(height, layer.screenY + layer.height);

		for (let y: number = top; y < bottom; y++) {
			cellLayers.fill(index + 1, y * width + left, y * width + right);
		}
	});
}

function sameColour(
	plane: Uint16Array,
	index: number,
	colour: Uint16Array,
): boolean {
	return (
		plane[index * 4] === colour[0] &&
		plane[index * 4 + 1] === colour[1] &&
		plane[index * 4 + 2] === colour[2] &&
		plane[index * 4 + 3] === colour[3]
	);
}

// Joins the lines on screen where they meet, once everything has drawn: a
// line in the border colour gains the arm toward a neighbouring line in the
// same layer that points back at it, so a gap like │── becomes ├──. Arms are
// only added, so tees drawn by hand stay. Only cells that hold a code point are
// seen: box borders and lines drawn with setCell, not drawText's graphemes.
export function joinBorders(buffer: core.OptimizedBuffer): void {
	const joins: [number, number, string][] = [];

	buffer.withBuffers((cells: core.BufferAccess): void => {
		const { width, height, char, fg }: core.BufferAccess = cells;
		const border: Uint16Array = theme.border.buffer;

		if (cellArms.length < width * height) {
			cellArms = new Uint8Array(width * height);
			cellLayers = new Uint8Array(width * height);
		}

		cellArms.fill(0, 0, width * height);
		markLayers(width, height);

		for (let index: number = 0; index < width * height; index++) {
			const arms: number | undefined = armsByChar.get(char[index] ?? 0);

			if (arms !== undefined && sameColour(fg, index, border)) {
				cellArms[index] = arms;
			}
		}

		for (let y: number = 0; y < height; y++) {
			for (let x: number = 0; x < width; x++) {
				const index: number = y * width + x;
				const own: number = cellArms[index] ?? 0;

				if (!own) {
					continue;
				}

				let joined: number = own;

				for (const [dx, dy, arm, back] of NEIGHBOURS) {
					const nx: number = x + dx;
					const ny: number = y + dy;
					const neighbour: number = ny * width + nx;

					if (
						nx >= 0 &&
						ny >= 0 &&
						nx < width &&
						ny < height &&
						(cellArms[neighbour] ?? 0) & back &&
						cellLayers[index] === cellLayers[neighbour]
					) {
						joined |= arm;
					}
				}

				const next: string | undefined = charByArms.get(joined);

				if (joined !== own && next !== undefined) {
					joins.push([x, y, next]);
				}
			}
		}
	});

	for (const [x, y, next] of joins) {
		buffer.setCellWithAlphaBlending(x, y, next, theme.border, CLEAR);
	}
}
