// Characters that can be part of a Postgres identifier, which a dollar quote
// can't follow, since $ can be part of one too.
const IDENTIFIER: RegExp = /[\p{L}\p{N}_$]/u;

// A dollar quote's opening tag, such as $$ or $body$.
const DOLLAR_TAG: RegExp = /^\$(?:[\p{L}_][\p{L}\p{N}_]*)?\$/u;

// The index just past a quoted string or identifier that opens at start. A
// doubled quote stands for itself, and in an escape string a backslash escapes
// the next character. An unclosed one runs to the end.
function skipQuoted(
	text: string,
	start: number,
	quote: string,
	backslash: boolean,
): number {
	let index: number = start + 1;

	while (index < text.length) {
		const char: string | undefined = text[index];

		if (backslash && char === "\\") {
			index += 2;
		} else if (char === quote) {
			if (text[index + 1] !== quote) {
				return index + 1;
			}

			index += 2;
		} else {
			index++;
		}
	}

	return text.length;
}

// The index just past a block comment that opens at start. They nest.
function skipBlockComment(text: string, start: number): number {
	let depth: number = 0;
	let index: number = start;

	while (index < text.length) {
		if (text.startsWith("/*", index)) {
			depth++;
			index += 2;
		} else if (text.startsWith("*/", index)) {
			depth--;
			index += 2;

			if (depth === 0) {
				return index;
			}
		} else {
			index++;
		}
	}

	return text.length;
}

// Splits Postgres SQL into its statements at the semicolons outside strings,
// quoted identifiers, dollar quotes and comments, as the server runs them.
// Statements that hold only whitespace and comments are left out, since the
// server returns no result for them.
export function splitStatements(text: string): string[] {
	const statements: string[] = [];
	let start: number = 0;
	let index: number = 0;
	let hasCode: boolean = false;

	const end: (at: number) => void = (at: number): void => {
		if (hasCode) {
			statements.push(text.slice(start, at).trim());
		}

		start = at + 1;
		hasCode = false;
	};

	while (index < text.length) {
		const char: string = text[index] ?? "";
		const before: string = text[index - 1] ?? "";

		if (text.startsWith("--", index)) {
			const newline: number = text.indexOf("\n", index);

			index = newline < 0 ? text.length : newline + 1;
		} else if (text.startsWith("/*", index)) {
			index = skipBlockComment(text, index);
		} else if (char === ";") {
			end(index);
			index++;
		} else if (/\s/.test(char)) {
			index++;
		} else {
			hasCode = true;

			const tag: string | undefined =
				char === "$" && !IDENTIFIER.test(before)
					? DOLLAR_TAG.exec(text.slice(index))?.[0]
					: undefined;

			if (char === "'") {
				// E'…' is an escape string, unless the E ends a longer name.
				const escaped: boolean =
					/[eE]/.test(before) && !IDENTIFIER.test(text[index - 2] ?? "");

				index = skipQuoted(text, index, "'", escaped);
			} else if (char === '"') {
				index = skipQuoted(text, index, '"', false);
			} else if (tag) {
				const close: number = text.indexOf(tag, index + tag.length);

				index = close < 0 ? text.length : close + tag.length;
			} else {
				index++;
			}
		}
	}

	end(text.length);

	return statements;
}
