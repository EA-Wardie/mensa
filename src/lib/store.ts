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

// Where a query's rows come from, as their result names it. The first time a
// row is edited, it's read further into a ResultEdit.
export interface ResultOrigin {
	// The OID of the one table the result's columns come from.
	table: string;
	// The number in the table of the column each result column shows, or null
	// for an expression or a column shown as hex.
	numbers: (number | null)[];
	// The statement that returned the rows, whose plan is checked to read the
	// table once.
	statement: string;
}

// What lets a query's rows be edited: the one table its columns come from,
// whose primary key they hold.
export interface ResultEdit {
	table: string;
	// The table column each result column saves to, or null for one that
	// isn't saved: an expression, or a column shown again.
	sources: (string | null)[];
	// The table column each result column shows, or null, so a save updates
	// every copy.
	shown: (string | null)[];
	meta: TableMeta;
}

// The row the editor has open, of a table or a query's results. tab is the
// tab it was opened from, compared by reference, and rows the loaded array
// row indexes into, so a reload, which replaces it, shows the row is gone.
export interface EditorTarget {
	tab: Tab;
	// The table the row is saved to.
	table: string;
	rows: Value[][];
	row: number;
	// The index of the column to focus, or null for the first editable one.
	column: number | null;
}

export interface TableTab {
	kind: "table";
	table: string;
}

export interface QueryTab {
	kind: "query";
	// A number, as text, shown as Query 1.
	id: string;
}

export type Tab = TableTab | QueryTab;

// Where in the SQL an error is, from 1.
export interface TextPosition {
	line: number;
	column: number;
}

// A query tab's last run. Rows are kept up to the row limit, and total counts
// them all. An error keeps the SQL it ran, so editing it shows the error is
// stale.
export type QueryResult =
	| { status: "idle" }
	| { status: "running" }
	| {
			status: "rows";
			columns: string[];
			kinds: TypeKind[];
			rows: Value[][];
			total: number;
			ms: number;
			// Where the rows come from, or why they can't be edited.
			edit: ResultOrigin | string;
	  }
	| {
			status: "done";
			// The kind of statement, such as INSERT. MySQL doesn't send it.
			command: string | null;
			// The rows written, or null for a statement that doesn't count them,
			// such as CREATE TABLE.
			affected: number | null;
			ms: number;
	  }
	| {
			status: "error";
			message: string;
			at: TextPosition | null;
			sql: string;
	  };

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

// The tabs, in order. A tab is compared by reference, so the same table or
// query keeps its object while it is open.
export const $tabs = nanostores.atom<readonly Tab[]>([]);

export const $activeTab = nanostores.atom<Tab | null>(null);

// The pane the arrow and vim keys move the selection in: the sidebar's tables,
// or the shown tab's rows.
export type Pane = "tables" | "grid";

export const $focusedPane = nanostores.atom<Pane>("tables");

// The open tables, in tab order, for what only cares about tables.
export const $openTables: nanostores.ReadableAtom<string[]> =
	nanostores.computed($tabs, (tabs: readonly Tab[]): string[] =>
		tabs.flatMap((tab: Tab): string[] =>
			tab.kind === "table" ? [tab.table] : [],
		),
	);

// The active tab's table, or null when a query or no tab is active.
export const $activeTable: nanostores.ReadableAtom<string | null> =
	nanostores.computed($activeTab, (tab: Tab | null): string | null =>
		tab?.kind === "table" ? tab.table : null,
	);

// Each open query tab's SQL, by its id. Nothing redraws for it, so it can
// follow every key.
export const $querySql = nanostores.atom<Readonly<Record<string, string>>>({});

// The result of each open query tab's last run, by its id.
export const $queryResults = nanostores.atom<
	Readonly<Record<string, QueryResult>>
>({});

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

// The row the view shows, of a table or a query's results. tab is the tab it
// was opened from, compared by reference, and rows the loaded array row
// indexes into, so new rows show the row is gone.
export interface ViewerTarget {
	tab: Tab;
	rows: Value[][];
	row: number;
	// The index of the column to scroll to, or null for the top.
	column: number | null;
}

// Set only while the editor is closed.
export const $viewer = nanostores.atom<ViewerTarget | null>(null);

// The marked rows of one grid, as indexes into rows, the array they were
// marked in, compared by reference, so new rows show no marks.
export interface MarkedRows {
	rows: Value[][];
	indexes: ReadonlySet<number>;
}

export const $markedRows = nanostores.atom<MarkedRows | null>(null);

// Whether the open editor has unsaved changes.
export const $editorDirty = nanostores.atom<boolean>(false);

export const $dialogOpen = nanostores.atom<boolean>(false);

export const $notice = nanostores.atom<string>("");

// Whether an Edit is waiting to learn whether a query's rows can be edited,
// which the footer says once it takes a moment.
export const $checkingEdit = nanostores.atom<boolean>(false);

// Counts the query results read for editing, so what shows Edit can hide it
// once a result is found not to be editable.
export const $resultEditsRead = nanostores.atom<number>(0);

// A notice stays until the next action, which clears it as it starts.
export function clearNotice(): void {
	$notice.set("");
}
