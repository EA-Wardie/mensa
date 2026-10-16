import * as nanostores from "nanostores";
import { type ConnectionConfig, connections } from "./config";

export type Screen = "connections" | "database";

export type TableData =
	| { status: "loading" }
	| {
			status: "loaded";
			columns: string[];
			rows: unknown[][];
			truncated: boolean;
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

export const $tables = nanostores.atom<string[]>([]);

export const $selectedTable = nanostores.atom<string | null>(null);

export const $openTables = nanostores.atom<string[]>([]);

export const $activeTable = nanostores.atom<string | null>(null);

export const $tableData = nanostores.atom<Readonly<Record<string, TableData>>>(
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

export const $dialogOpen = nanostores.atom<boolean>(false);

export const $notice = nanostores.atom<string>("");
