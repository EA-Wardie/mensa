import { ELLIPSIS } from "./consts";

const SEGMENTER: Intl.Segmenter = new Intl.Segmenter(undefined, {
	granularity: "grapheme",
});

export const NULL_TEXT: string = "NULL";

// Takes the text's width when the caller has already measured it.
export function fitText(
	text: string,
	width: number,
	textWidth: number = Bun.stringWidth(text),
): string {
	if (textWidth <= width) {
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

// Makes text from the database or the config safe to draw on one line.
// Newlines, tabs and other control characters become symbols, so the text
// can't send escape sequences to the terminal.
export function displayText(text: string): string {
	return text
		.replace(/\r?\n/g, "↵")
		.replace(/\t/g, "⇥")
		.replace(CONTROL_CHARACTERS, controlPicture);
}
