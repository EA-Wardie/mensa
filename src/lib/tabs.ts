import type { ConnectionConfig } from "./config";
import { forgetTable, loadTable } from "./database";
import { rememberedTabs, rememberTabs, type TabsState } from "./state";
import {
	$activeTable,
	$connection,
	$openTables,
	$selectedRows,
	$sorts,
	$tableData,
	$tables,
	type Sort,
	setEntry,
	type TableData,
} from "./store";

function saveTabs(
	connection: ConnectionConfig | null = $connection.get(),
): void {
	if (connection) {
		rememberTabs(connection, {
			open: $openTables.get(),
			active: $activeTable.get(),
		});
	}
}

// Shows a tab, loading it the first time it is shown, or again if it failed.
function activate(table: string | null): void {
	$activeTable.set(table);

	const data: TableData | undefined =
		table === null ? undefined : $tableData.get()[table];

	if (table !== null && (!data || data.status === "error")) {
		loadTable(table);
	}
}

export function openTable(name: string): void {
	const open: string[] = $openTables.get();

	if (!open.includes(name)) {
		$openTables.set([...open, name]);
	}

	activate(name);
	saveTabs();
}

export function closeTable(name: string | null = $activeTable.get()): void {
	const open: string[] = $openTables.get();
	const index: number = name === null ? -1 : open.indexOf(name);

	if (name === null || index < 0) {
		return;
	}

	const remaining: string[] = open.filter(
		(table: string): boolean => table !== name,
	);

	$openTables.set(remaining);
	forgetTable(name);

	if ($activeTable.get() === name) {
		activate(remaining[Math.min(index, remaining.length - 1)] ?? null);
	}

	saveTabs();
}

export function cycleTable(step: number): void {
	const open: string[] = $openTables.get();
	const active: string | null = $activeTable.get();

	if (!open.length) {
		return;
	}

	const index: number = active === null ? 0 : open.indexOf(active);
	const next: number = (index + step + open.length) % open.length;

	activate(open[next] ?? null);
	saveTabs();
}

// Cycles the column through ascending, descending and no sort, and loads the
// table sorted. A table has one sort, so a new column replaces the old one.
export function sortTable(
	column: string,
	table: string | null = $activeTable.get(),
): void {
	if (table === null) {
		return;
	}

	const sort: Sort | undefined = $sorts.get()[table];

	if (sort?.column !== column) {
		setEntry($sorts, table, { column: column, direction: "asc" });
	} else if (sort.direction === "asc") {
		setEntry($sorts, table, { column: column, direction: "desc" });
	} else {
		setEntry($sorts, table, undefined);
	}

	loadTable(table);
}

// Selects a row of the table's loaded rows, or clears the selection with null.
export function selectRow(
	row: number | null,
	table: string | null = $activeTable.get(),
): void {
	if (table !== null) {
		setEntry($selectedRows, table, row ?? undefined);
	}
}

// Reopens the connection's saved tabs that still exist. Only the active one
// loads now, and the others when they are shown.
export function restoreTabs(connection: ConnectionConfig): void {
	const saved: TabsState | null = rememberedTabs(connection);
	const tables: string[] = $tables.get();

	if (!saved) {
		return;
	}

	const open: string[] = saved.open.filter((table: string): boolean =>
		tables.includes(table),
	);

	$openTables.set(open);
	activate(
		saved.active !== null && open.includes(saved.active)
			? saved.active
			: (open[0] ?? null),
	);
	saveTabs(connection);
}

// Clears the tabs without saving, so the connection keeps its saved tabs.
export function resetTabs(): void {
	$openTables.set([]);
	$activeTable.set(null);
	$tableData.set({});
	$sorts.set({});
	$selectedRows.set({});
}
