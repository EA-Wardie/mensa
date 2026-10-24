import type { RGBA } from "@opentui/core";
import { theme } from "./config";
import { KEY_ICON } from "./consts";
import type { TableMeta, TypeKind } from "./store";

// What a column's header icon shows: the key it's in, or else its type.
export type ColumnKind = "primary" | "foreign" | TypeKind;

export interface ColumnIcon {
	icon: string;
	color: RGBA;
}

const TYPE_ICONS: Record<TypeKind, string> = {
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

// A primary key column is shown as one, also when it's in a foreign key too.
export function columnKind(
	meta: TableMeta,
	column: string,
	type: TypeKind,
): ColumnKind {
	if (meta.primaryKey.includes(column)) {
		return "primary";
	}

	if (meta.foreignKeys.includes(column)) {
		return "foreign";
	}

	return type;
}

// Keys have a yellow or a white key, and types a muted icon.
export function columnIcon(kind: ColumnKind): ColumnIcon {
	switch (kind) {
		case "primary":
			return { icon: KEY_ICON, color: theme.warning };
		case "foreign":
			return { icon: KEY_ICON, color: theme.fg };
		default:
			return { icon: TYPE_ICONS[kind], color: theme.muted };
	}
}
