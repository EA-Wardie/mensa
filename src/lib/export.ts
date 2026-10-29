import { JSON_INDENT } from "./consts";
import { isJson, reformatJson } from "./format";
import type { TypeKind, Value } from "./store";

// A number as JSON writes it, so the database's digits can be kept as they
// are. NaN, Infinity and money aren't.
const JSON_NUMBER: RegExp = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/;

const TRUE_TEXTS: ReadonlySet<string> = new Set<string>(["true", "t", "1"]);

const FALSE_TEXTS: ReadonlySet<string> = new Set<string>(["false", "f", "0"]);

// Quoted when it holds a separator, a quote, a line break or spaces at its
// ends, which a reader would trim. NULL is an empty field, and an empty text
// is quoted, so the two stay apart.
function csvField(value: Value): string {
	if (value === null) {
		return "";
	}

	return value === "" || /[",\r\n]|^\s|\s$/.test(value)
		? `"${value.replaceAll('"', '""')}"`
		: value;
}

function csvLine(values: Value[]): string {
	return values.map(csvField).join(",");
}

// The column names, then the row.
export function rowAsCsv(columns: string[], row: Value[]): string {
	return `${csvLine(columns)}\n${csvLine(row)}`;
}

// A value typed by its column: numbers with their digits as the database
// wrote them, booleans, and JSON as it is, re-indented to sit in the object.
// Anything else is a string.
function jsonValue(value: Value, kind: TypeKind): string {
	if (value === null) {
		return "null";
	}

	switch (kind) {
		case "integer":
		case "decimal":
			if (JSON_NUMBER.test(value)) {
				return value;
			}

			break;
		case "boolean":
			if (TRUE_TEXTS.has(value)) {
				return "true";
			}

			if (FALSE_TEXTS.has(value)) {
				return "false";
			}

			break;
		case "json":
			if (isJson(value)) {
				return reformatJson(value, JSON_INDENT).replaceAll(
					"\n",
					`\n${JSON_INDENT}`,
				);
			}

			break;
	}

	return JSON.stringify(value);
}

// One object, keyed by the column names.
export function rowAsJson(
	columns: string[],
	kinds: TypeKind[],
	row: Value[],
): string {
	if (!columns.length) {
		return "{}";
	}

	const entries: string[] = columns.map(
		(column: string, index: number): string =>
			`${JSON_INDENT}${JSON.stringify(column)}: ${jsonValue(row[index] ?? null, kinds[index] ?? "other")}`,
	);

	return `{\n${entries.join(",\n")}\n}`;
}
