import type { ConnectionConfig } from "./config";
import {
	discardRows,
	forgetQuery,
	forgetTable,
	loadTable,
	type RunOutcome,
	refreshTables,
	runQuery,
} from "./database";
import {
	rememberedTabs,
	rememberTabs,
	type SavedTab,
	type TabsState,
} from "./state";
import {
	$activeTab,
	$activeTable,
	$connection,
	$openTables,
	$queryResults,
	$querySql,
	$selectedRows,
	$selectedTable,
	$sorts,
	$tableData,
	$tables,
	$tabs,
	clearNotice,
	type QueryTab,
	type Sort,
	setEntry,
	type Tab,
	type TableData,
} from "./store";

function saveTab(tab: Tab): SavedTab {
	return tab.kind === "table"
		? tab.table
		: { query: tab.id, sql: $querySql.get()[tab.id] ?? "" };
}

function saveTabs(
	connection: ConnectionConfig | null = $connection.get(),
): void {
	const tabs: readonly Tab[] = $tabs.get();
	const active: Tab | null = $activeTab.get();

	if (connection) {
		rememberTabs(connection, {
			open: tabs.map(saveTab),
			active: active === null ? null : tabs.indexOf(active),
		});
	}
}

// Shows a tab, loading a table the first time it is shown, or again if it
// failed, and selecting it in the sidebar. With no tab left, or a query
// shown, the sidebar keeps its selection.
function activate(tab: Tab | null): void {
	clearNotice();
	$activeTab.set(tab);

	if (tab?.kind !== "table") {
		return;
	}

	const data: TableData | undefined = $tableData.get()[tab.table];

	$selectedTable.set(tab.table);

	if (!data || data.status === "error") {
		loadTable(tab.table);
	}
}

export function openTable(name: string): void {
	const tabs: readonly Tab[] = $tabs.get();
	const open: Tab | undefined = tabs.find(
		(tab: Tab): boolean => tab.kind === "table" && tab.table === name,
	);
	const tab: Tab = open ?? { kind: "table", table: name };

	if (!open) {
		$tabs.set([...tabs, tab]);
	}

	activate(tab);
	saveTabs();
}

function addQuery(id: string, sql: string): QueryTab {
	setEntry($querySql, id, sql);
	setEntry($queryResults, id, { status: "idle" });

	return { kind: "query", id: id };
}

// Opens an empty query tab, numbered one past the highest open one.
export function newQuery(): void {
	const tabs: readonly Tab[] = $tabs.get();
	const highest: number = Math.max(
		0,
		...tabs.map((tab: Tab): number =>
			tab.kind === "query" ? Number(tab.id) || 0 : 0,
		),
	);
	const tab: QueryTab = addQuery(String(highest + 1), "");

	$tabs.set([...tabs, tab]);
	activate(tab);
	saveTabs();
}

export function tabLabel(tab: Tab): string {
	return tab.kind === "table" ? tab.table : `Query ${tab.id}`;
}

// Keeps a query tab's SQL, which is saved with its tab.
export function setQuerySql(id: string, sql: string): void {
	const queries: Readonly<Record<string, string>> = $querySql.get();

	if (id in queries && queries[id] !== sql) {
		setEntry($querySql, id, sql);
		saveTabs();
	}
}

// Runs a query tab's SQL. A run that may have made or dropped a table lists
// the tables again, and one that may have written loads the open tables
// again, the active one now and the others when shown.
export async function runQueryTab(id: string): Promise<void> {
	const sql: string = $querySql.get()[id] ?? "";

	clearNotice();

	const outcome: RunOutcome =
		sql.trim() === "" ? "skipped" : await runQuery(id, sql);

	if (outcome === "ran" || outcome === "wrote") {
		await refreshTables();
	}

	if (outcome === "wrote") {
		reloadOpenTables();
	}
}

// Runs the active tab's SQL, if it's a query.
export function runActiveQuery(): void {
	const tab: Tab | null = $activeTab.get();

	if (tab?.kind === "query") {
		runQueryTab(tab.id);
	}
}

// Closes the tabs in one go, without asking. When the active one closes, the
// tab that was after it shows, or else the last one.
export function closeTabs(closing: readonly Tab[]): void {
	const tabs: readonly Tab[] = $tabs.get();
	const active: Tab | null = $activeTab.get();
	const remaining: Tab[] = tabs.filter(
		(tab: Tab): boolean => !closing.includes(tab),
	);

	if (remaining.length === tabs.length) {
		return;
	}

	$tabs.set(remaining);

	for (const tab of closing) {
		if (tab.kind === "table") {
			forgetTable(tab.table);
		} else {
			forgetQuery(tab.id);
		}
	}

	if (active !== null && closing.includes(active)) {
		const before: number = tabs
			.slice(0, tabs.indexOf(active))
			.filter((tab: Tab): boolean => remaining.includes(tab)).length;

		activate(remaining[Math.min(before, remaining.length - 1)] ?? null);
	}

	saveTabs();
}

// A table that is no longer listed, such as after a drop, closes its tab and
// leaves the sidebar's selection.
$tables.listen((tables: readonly string[]): void => {
	const selected: string | null = $selectedTable.get();

	closeTabs(
		$tabs
			.get()
			.filter(
				(tab: Tab): boolean =>
					tab.kind === "table" && !tables.includes(tab.table),
			),
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

// Shows a table, loading its rows again if it was already open. A new tab
// loads when it is shown.
export function refreshTable(name: string): void {
	const open: boolean = $openTables.get().includes(name);

	openTable(name);

	if (open) {
		reloadTable(name);
	}
}

// Loads the active table again, or runs the active query again.
export function refreshActiveTab(): void {
	const tab: Tab | null = $activeTab.get();

	if (tab?.kind === "query") {
		runActiveQuery();
	} else if (tab?.kind === "table") {
		clearNotice();
		reloadTable(tab.table);
	}
}

export function reloadOpenTables(): void {
	for (const table of $openTables.get()) {
		reloadTable(table);
	}
}

export function cycleTab(step: number): void {
	const tabs: readonly Tab[] = $tabs.get();
	const active: Tab | null = $activeTab.get();

	if (!tabs.length) {
		return;
	}

	const index: number = active === null ? 0 : tabs.indexOf(active);
	const next: number = (index + step + tabs.length) % tabs.length;

	activate(tabs[next] ?? null);
	saveTabs();
}

export function showTab(tab: Tab): void {
	activate(tab);
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

	clearNotice();

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

// Reopens the connection's saved tabs: the tables that still exist, and the
// queries with their SQL. Only the active table loads now, and the others
// when they are shown.
export function restoreTabs(connection: ConnectionConfig): void {
	const saved: TabsState | null = rememberedTabs(connection);
	const tables: string[] = $tables.get();

	if (!saved) {
		return;
	}

	const restored: (Tab | null)[] = saved.open.map(
		(tab: SavedTab): Tab | null => {
			if (typeof tab !== "string") {
				return addQuery(tab.query, tab.sql);
			}

			return tables.includes(tab) ? { kind: "table", table: tab } : null;
		},
	);
	const open: Tab[] = restored.filter(
		(tab: Tab | null): tab is Tab => tab !== null,
	);
	const active: Tab | null =
		saved.active === null ? null : (restored[saved.active] ?? null);

	$tabs.set(open);
	activate(active ?? open[0] ?? null);
	saveTabs(connection);
}

// Clears the tabs without saving, so the connection keeps its saved tabs.
export function resetTabs(): void {
	$tabs.set([]);
	$activeTab.set(null);
	$tableData.set({});
	$sorts.set({});
	$selectedRows.set({});
	$querySql.set({});
	$queryResults.set({});
}
