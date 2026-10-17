import { ELLIPSIS } from "./consts";

const SEGMENTER: Intl.Segmenter = new Intl.Segmenter(undefined, {
	granularity: "grapheme",
});

export const NULL_TEXT: string = "NULL";

const WHITESPACE: ReadonlySet<string> = new Set<string>([
	" ",
	"\t",
	"\n",
	"\r",
]);

const STRUCTURE: ReadonlySet<string> = new Set<string>([
	"{",
	"}",
	"[",
	"]",
	",",
	":",
]);

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

// Re-indents JSON text without parsing it, so numbers like
// 12345678901234567890 or 1.0 and the escapes in strings stay as they were.
// An empty indent gives the compact form. The text should be valid JSON.
// Strings and literals are copied whole, since it runs on every keystroke in a
// JSON field.
export function reformatJson(text: string, indent: string): string {
	const parts: string[] = [];
	let depth: number = 0;
	let index: number = 0;
	// Whether the last part opened an empty object or array.
	let emptyOpen: boolean = false;

	const newline: () => string = (): string =>
		indent ? `\n${indent.repeat(depth)}` : "";

	while (index < text.length) {
		const character: string = text[index] ?? "";

		if (WHITESPACE.has(character)) {
			index++;

			continue;
		}

		if (character === '"') {
			let end: number = index + 1;

			while (end < text.length && text[end] !== '"') {
				end += text[end] === "\\" ? 2 : 1;
			}

			parts.push(text.slice(index, end + 1));
			emptyOpen = false;
			index = end + 1;

			continue;
		}

		if (!STRUCTURE.has(character)) {
			let end: number = index + 1;

			while (
				end < text.length &&
				!STRUCTURE.has(text[end] ?? "") &&
				!WHITESPACE.has(text[end] ?? "") &&
				text[end] !== '"'
			) {
				end++;
			}

			parts.push(text.slice(index, end));
			emptyOpen = false;
			index = end;

			continue;
		}

		if (character === "{" || character === "[") {
			let ahead: number = index + 1;

			while (WHITESPACE.has(text[ahead] ?? "")) {
				ahead++;
			}

			// An empty object or array stays on one line.
			emptyOpen = text[ahead] === (character === "{" ? "}" : "]");

			if (emptyOpen) {
				parts.push(character);
			} else {
				depth++;
				parts.push(character + newline());
			}
		} else if (character === "}" || character === "]") {
			if (!emptyOpen) {
				depth = Math.max(0, depth - 1);
				parts.push(newline());
			}

			parts.push(character);
			emptyOpen = false;
		} else if (character === ",") {
			parts.push(character + newline());
		} else {
			parts.push(indent ? ": " : ":");
		}

		index++;
	}

	return parts.join("");
}
