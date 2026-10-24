import { KEY_ICON } from "./consts";
import type { ColumnMeta, TableMeta } from "./store";

// What a column's header icon shows: the key it's in, or else its type.
export type ColumnKind =
	| "primary"
	| "foreign"
	| "text"
	| "integer"
	| "decimal"
	| "boolean"
	| "date"
	| "time"
	| "timestamp"
	| "interval"
	| "json"
	| "uuid"
	| "enum"
	| "binary"
	| "array"
	| "spatial"
	| "network"
	| "xml"
	| "other";

export const COLUMN_ICONS: Record<ColumnKind, string> = {
	primary: KEY_ICON,
	foreign: KEY_ICON,
	text: "󰊄",
	integer: "󰎠",
	decimal: "󱂡",
	boolean: "󰨚",
	date: "󰃭",
	time: "󰅐",
	timestamp: "󰃰",
	interval: "󰔟",
	json: "󰘦",
	uuid: "󰻾",
	enum: "󰉹",
	binary: "󱊧",
	array: "󰅪",
	spatial: "󰟙",
	network: "󰲐",
	xml: "󰗀",
	other: "󰠲",
};

// Type names as Postgres's format_type and MySQL's data_type give them, and
// as information_schema does when the table's metadata couldn't be read.
const TYPE_KINDS: ReadonlyMap<string, ColumnKind> = new Map<string, ColumnKind>(
	[
		["character varying", "text"],
		["varchar", "text"],
		["character", "text"],
		["char", "text"],
		["bpchar", "text"],
		["text", "text"],
		["tinytext", "text"],
		["mediumtext", "text"],
		["longtext", "text"],
		["name", "text"],
		["citext", "text"],
		["smallint", "integer"],
		["integer", "integer"],
		["bigint", "integer"],
		["tinyint", "integer"],
		["mediumint", "integer"],
		["int", "integer"],
		["oid", "integer"],
		["numeric", "decimal"],
		["decimal", "decimal"],
		["real", "decimal"],
		["double precision", "decimal"],
		["double", "decimal"],
		["float", "decimal"],
		["money", "decimal"],
		["boolean", "boolean"],
		["date", "date"],
		["year", "date"],
		["time without time zone", "time"],
		["time with time zone", "time"],
		["time", "time"],
		["timestamp without time zone", "timestamp"],
		["timestamp with time zone", "timestamp"],
		["timestamp", "timestamp"],
		["datetime", "timestamp"],
		["interval", "interval"],
		["json", "json"],
		["jsonb", "json"],
		["uuid", "uuid"],
		["enum", "enum"],
		["set", "enum"],
		["bytea", "binary"],
		["binary", "binary"],
		["varbinary", "binary"],
		["tinyblob", "binary"],
		["blob", "binary"],
		["mediumblob", "binary"],
		["longblob", "binary"],
		["bit", "binary"],
		["bit varying", "binary"],
		["varbit", "binary"],
		["point", "spatial"],
		["line", "spatial"],
		["lseg", "spatial"],
		["box", "spatial"],
		["path", "spatial"],
		["polygon", "spatial"],
		["circle", "spatial"],
		["geometry", "spatial"],
		["geography", "spatial"],
		["linestring", "spatial"],
		["multipoint", "spatial"],
		["multilinestring", "spatial"],
		["multipolygon", "spatial"],
		["geometrycollection", "spatial"],
		["geomcollection", "spatial"],
		["inet", "network"],
		["cidr", "network"],
		["macaddr", "network"],
		["macaddr8", "network"],
		["xml", "xml"],
	],
);

function typeKind(type: string): ColumnKind {
	const lower: string = type.toLowerCase();

	if (lower.endsWith("[]") || lower === "array") {
		return "array";
	}

	return TYPE_KINDS.get(lower) ?? "other";
}

// A primary key column is shown as one, also when it's in a foreign key too.
// The type is the column's own when its metadata was read, since
// information_schema names arrays and enums only generically.
export function columnKind(
	meta: TableMeta,
	column: string,
	type: string,
): ColumnKind {
	if (meta.primaryKey.includes(column)) {
		return "primary";
	}

	if (meta.foreignKeys.includes(column)) {
		return "foreign";
	}

	const described: ColumnMeta | undefined = meta.columns.get(column);
	const kind: ColumnKind = typeKind(described?.castType ?? type);

	// MySQL's tinyint(1) is a boolean, picked by its labels, and a Postgres
	// enum is named by its own type.
	if (described?.edit.as === "choice") {
		return described.edit.labels.length
			? "boolean"
			: kind === "other"
				? "enum"
				: kind;
	}

	return kind;
}
