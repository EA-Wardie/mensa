import * as nanostores from "nanostores";
import { type ConnectionConfig, connections } from "./config";
import { clamp } from "./math";

export type Screen = "connections" | "database";

// A value as the database formats it as text, or null.
export type Value = string | null;

export type SortDirection = "asc" | "desc";

export interface Sort {
	column: string;
	direction: SortDirection;
}

// How the row editor edits a column. A choice's labels are shown beside its
// options, such as true for MySQL's 1, and may be left out.
export type ColumnEdit =
	| { as: "text"; long: boolean }
	| { as: "json" }
	| { as: "choice"; options: string[]; labels: string[] }
	| { as: "readonly"; reason: string };

// What a column holds, for its header icon.
export type TypeKind =
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

export interface ColumnMeta {
	name: string;
	// The type as the database names it, shown in the editor.
	typeLabel: string;
	// The type a saved value is cast to. Without a length, since a cast to
	// varchar(5) would cut a longer value instead of failing.
	castType: string;
	nullable: boolean;
	edit: ColumnEdit;
	kind: TypeKind;
}

export interface TableMeta {
	// A Map, since a column can be named like an Object property.
	columns: Map<string, ColumnMeta>;
	primaryKey: string[];
	// The columns in any foreign key, in table order.
	foreignKeys: string[];
	// Why the table's rows can't be saved, or null.
	readOnly: string | null;
}

// A loaded table's sort is the one its rows have, which lags behind $sorts
// while a new sort loads.
export type TableData =
	| { status: "loading" }
	| {
			status: "loaded";
			columns: string[];
			// Each column's data type, as information_schema names it.
			types: string[];
			// Each column's kind, from its metadata or else its data type.
			kinds: TypeKind[];
			rows: Value[][];
			truncated: boolean;
			sort: Sort | null;
			// What the row editor needs. When it couldn't be read, it has no
			// columns and is read only.
			meta: TableMeta;
	  }
	| { status: "error"; message: string };

export type LoadedTable = Extract<TableData, { status: "loaded" }>;

// The row the editor has open. rows is the loaded array row indexes into, so
// a reload, which replaces it, shows the row is gone.
export interface EditorTarget {
	table: string;
	rows: Value[][];
	row: number;
	// The column to focus, or null for the first editable one.
	column: string | null;
}

export const $screen = nanostores.atom<Screen>("connections");

export const $connections = nanostores.atom<ConnectionConfig[]>(connections);

export const $selectedConnection = nanostores.atom<ConnectionConfig | null>(
	connections[0] ?? null,
);

// The connection being made, while connect() runs.
export const $connecting = nanostores.atom<ConnectionConfig | null>(null);

export const $connection = nanostores.atom<ConnectionConfig | null>(null);

// The schema whose tables are listed: public, or the MySQL database. Empty
// when listing them failed.
export const $schema = nanostores.atom<string>("");

export const $tables = nanostores.atom<string[]>([]);

export const $selectedTable = nanostores.atom<string | null>(null);

export const $openTables = nanostores.atom<string[]>([]);

export const $activeTable = nanostores.atom<string | null>(null);

export const $tableData = nanostores.atom<Readonly<Record<string, TableData>>>(
	{},
);

// The sort each open table asked for, set as soon as a header is clicked.
export const $sorts = nanostores.atom<Readonly<Record<string, Sort>>>({});

// The selected row of each open table, as an index into its loaded rows. New
// rows clear it.
export const $selectedRows = nanostores.atom<Readonly<Record<string, number>>>(
	{},
);

export const $activeTableData: nanostores.ReadableAtom<TableData | undefined> =
	nanostores.computed(
		[$activeTable, $tableData],
		(
			table: string | null,
			data: Readonly<Record<string, TableData>>,
		): TableData | undefined => (table === null ? undefined : data[table]),
	);

// Replaces one entry of a record atom, or removes it when value is undefined.
// An unchanged entry leaves the atom as it is, so listeners aren't notified.
export function setEntry<T>(
	store: nanostores.WritableAtom<Readonly<Record<string, T>>>,
	name: string,
	value: T | undefined,
): void {
	const entries: Readonly<Record<string, T>> = store.get();

	if (entries[name] === value) {
		return;
	}

	const { [name]: _, ...rest }: Readonly<Record<string, T>> = entries;

	store.set(value === undefined ? rest : { ...rest, [name]: value });
}

// Moves the selection by step through the items, stopping at the ends.
export function moveSelection<T>(
	items: nanostores.ReadableAtom<readonly T[]>,
	selected: nanostores.WritableAtom<T | null>,
	step: number,
): void {
	const list: readonly T[] = items.get();
	const current: T | null = selected.get();
	const index: number = current === null ? -1 : list.indexOf(current);
	const next: number = clamp(index + step, 0, list.length - 1);

	if (next >= 0) {
		selected.set(list[next] ?? null);
	}
}

export const $editor = nanostores.atom<EditorTarget | null>(null);

// Whether the open editor has unsaved changes.
export const $editorDirty = nanostores.atom<boolean>(false);

export const $dialogOpen = nanostores.atom<boolean>(false);

export const $notice = nanostores.atom<string>("");
