import type { ConnectionConfig } from "./config";
import { discardRows, forgetTable, loadTable } from "./database";
import { rememberedTabs, rememberTabs, type TabsState } from "./state";
import {
	$activeTable,
	$connection,
	$openTables,
	$selectedRows,
	$selectedTable,
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

// Shows a tab and selects it in the sidebar, loading it the first time it is
// shown, or again if it failed. With no tab left, the sidebar keeps its
// selection.
function activate(table: string | null): void {
	$activeTable.set(table);

	if (table !== null) {
		$selectedTable.set(table);
	}

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
	if (name !== null) {
		closeTables([name]);
	}
}

export function closeAllTables(): void {
	closeTables($openTables.get());
}

// Closes the tabs in one go. When the active one closes, the tab that was
// after it shows, or else the last one.
function closeTables(names: readonly string[]): void {
	const open: string[] = $openTables.get();
	const active: string | null = $activeTable.get();
	const remaining: string[] = open.filter(
		(table: string): boolean => !names.includes(table),
	);

	if (remaining.length === open.length) {
		return;
	}

	$openTables.set(remaining);

	for (const name of names) {
		forgetTable(name);
	}

	if (active !== null && names.includes(active)) {
		const before: number = open
			.slice(0, open.indexOf(active))
			.filter((table: string): boolean => remaining.includes(table)).length;

		activate(remaining[Math.min(before, remaining.length - 1)] ?? null);
	}

	saveTabs();
}

// A table that is no longer listed, such as after a drop, closes its tab and
// leaves the sidebar's selection.
$tables.listen((tables: readonly string[]): void => {
	const selected: string | null = $selectedTable.get();

	closeTables(
		$openTables
			.get()
			.filter((table: string): boolean => !tables.includes(table)),
	);

	if (selected !== null && !tables.includes(selected)) {
		$selectedTable.set($activeTable.get() ?? tables[0] ?? null);
	}
});

// Loads an open table again, keeping its sort, after its rows changed
// underneath it. The active table loads now, and another when it is shown.
export function reloadTable(name: string): void {
	if (name === $activeTable.get()) {
		loadTable(name);
	} else if ($openTables.get().includes(name)) {
		discardRows(name);
	}
}

export function reloadOpenTables(): void {
	for (const table of $openTables.get()) {
		reloadTable(table);
	}
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
