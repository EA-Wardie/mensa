import * as nanostores from "nanostores";
import { type ConnectionConfig, connections } from "./config";

export type Screen = "connections" | "database";

// A value as the database formats it as text, or null.
export type Value = string | null;

export type SortDirection = "asc" | "desc";

export interface Sort {
	column: string;
	direction: SortDirection;
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
			rows: Value[][];
			truncated: boolean;
			sort: Sort | null;
	  }
	| { status: "error"; message: string };

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

export const $dialogOpen = nanostores.atom<boolean>(false);

export const $notice = nanostores.atom<string>("");
