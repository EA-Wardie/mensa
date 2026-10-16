import { BINARY_PREVIEW_BYTES, ELLIPSIS } from "./consts";

const SEGMENTER: Intl.Segmenter = new Intl.Segmenter(undefined, {
	granularity: "grapheme",
});

export const NULL_TEXT: string = "NULL";

export function fitText(text: string, width: number): string {
	if (Bun.stringWidth(text) <= width) {
		return text;
	}

	const limit: number = width - 1;
	let fitted: string = "";
	let fittedWidth: number = 0;

	for (const { segment } of SEGMENTER.segment(text)) {
		const segmentWidth: number = Bun.stringWidth(segment);

		if (fittedWidth + segmentWidth > limit) {
			break;
		}

		fitted += segment;
		fittedWidth += segmentWidth;
	}

	return `${fitted}${ELLIPSIS}`;
}

function formatBinary(value: Uint8Array): string {
	const hex: string = Buffer.from(
		value.subarray(0, BINARY_PREVIEW_BYTES),
	).toString("hex");

	return `\\x${hex}${value.length > BINARY_PREVIEW_BYTES ? ELLIPSIS : ""}`;
}

// C0 controls, DEL and C1 controls, which would otherwise reach the terminal
// as cursor moves or escape sequences.
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching them is the point.
const CONTROL_CHARACTERS: RegExp = /[\x00-\x1f\x7f-\x9f]/g;

function controlPicture(character: string): string {
	const code: number = character.charCodeAt(0);

	if (code < 0x20) {
		return String.fromCharCode(0x2400 + code);
	}

	return code === 0x7f ? "␡" : "�";
}

function flatten(text: string): string {
	return text
		.replace(/\r?\n/g, "↵")
		.replace(/\t/g, "⇥")
		.replace(CONTROL_CHARACTERS, controlPicture);
}

export function formatValue(value: unknown): string {
	if (value === null || value === undefined) {
		return NULL_TEXT;
	}

	if (value instanceof Date) {
		return Number.isNaN(value.getTime()) ? String(value) : value.toISOString();
	}

	if (value instanceof Uint8Array) {
		return formatBinary(value);
	}

	if (typeof value === "object") {
		return flatten(JSON.stringify(value));
	}

	return flatten(String(value));
}
