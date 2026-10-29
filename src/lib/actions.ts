import { Confirmation } from "../components/Confirmation";
import { copyText } from "./clipboard";
import type { ConnectionConfig } from "./config";
import {
	deleteRow,
	dropAll,
	dropTable,
	type RowTarget,
	refreshTables,
	truncateAll,
	truncateTable,
} from "./database";
import { confirmDiscardIf } from "./editor";
import { switchConnection } from "./session";
import {
	$activeTab,
	$connection,
	$editor,
	$notice,
	$querySql,
	$schema,
	$tableData,
	$tabs,
	clearNotice,
	type QueryTab,
	type Tab,
	type TableData,
} from "./store";
import { closeTabs, reloadOpenTables, reloadTable, tabLabel } from "./tabs";

interface Write {
	// Whether the write replaces the edited rows, so it asks about unsaved
	// changes first.
	discards: boolean;
	heading: string;
	description: string;
	confirmLabel: string;
	run: () => Promise<string | null>;
	// Updates the store afterwards, even after an error, since MySQL may have
	// changed some tables.
	after?: () => void;
}

function isEditing(table: string): boolean {
	return $editor.get()?.table === table;
}

// Runs an action, which clears the last notice. The update afterwards and the
// error only show while the same connection is open.
async function report(
	run: () => Promise<string | null>,
	after?: () => void,
): Promise<void> {
	const connection: ConnectionConfig | null = $connection.get();

	clearNotice();

	const error: string | null = await run();

	if ($connection.get() !== connection) {
		return;
	}

	after?.();

	if (error) {
		$notice.set(error);
	}
}

// Asks, then writes.
function confirmWrite(write: Write): void {
	const onConfirm: () => Promise<void> = (): Promise<void> =>
		report(write.run, write.after);

	confirmDiscardIf(write.discards, (): void => {
		Confirmation.make({
			heading: write.heading,
			description: write.description,
			confirmLabel: write.confirmLabel,
			onConfirm: onConfirm,
		});
	});
}

// Copies the text, showing why it couldn't be, or else calling onCopied.
export function copyToClipboard(
	text: string,
	onCopied?: () => void,
): Promise<void> {
	return report(async (): Promise<string | null> => {
		const error: string | null = await copyText(text);

		if (error === null) {
			onCopied?.();
		}

		return error;
	});
}

// Lists the tables again. Tables that are gone close their tabs.
export function refreshSchema(): Promise<void> {
	return report(refreshTables);
}

// Deletes a loaded row. Rows loaded since leave the row unmatched, which
// says so.
export function deleteRowAt(target: RowTarget): void {
	const data: TableData | undefined = $tableData.get()[target.table];

	if (data?.status === "loaded" && data.meta.readOnly !== null) {
		$notice.set(data.meta.readOnly);

		return;
	}

	confirmWrite({
		discards: isEditing(target.table),
		heading: "Delete row?",
		description: `The row will be deleted from ${target.table}. This can't be undone.`,
		confirmLabel: "Delete",
		run: (): Promise<string | null> => deleteRow(target),
	});
}

export function truncateTableNamed(table: string): void {
	confirmWrite({
		discards: isEditing(table),
		heading: `Truncate ${table}?`,
		description: `Every row in ${table} will be deleted. This can't be undone.`,
		confirmLabel: "Truncate",
		run: (): Promise<string | null> => truncateTable(table),
		after: (): void => reloadTable(table),
	});
}

// Dropping takes the table out of the list, which closes its tab.
export function dropTableNamed(table: string): void {
	confirmWrite({
		discards: isEditing(table),
		heading: `Delete ${table}?`,
		description: `${table} will be dropped with all its rows. This can't be undone.`,
		confirmLabel: "Delete",
		run: (): Promise<string | null> => dropTable(table),
	});
}

export function truncateAllTables(): void {
	const schema: string = $schema.get();

	confirmWrite({
		discards: $editor.get() !== null,
		heading: "Truncate all tables?",
		description: `Every row in every table in ${schema} will be deleted. This can't be undone.`,
		confirmLabel: "Truncate all",
		run: truncateAll,
		after: reloadOpenTables,
	});
}

export function dropAllTables(): void {
	const schema: string = $schema.get();

	confirmWrite({
		discards: $editor.get() !== null,
		heading: "Drop all tables?",
		description: `Every table and view in ${schema} will be dropped with all their rows. This can't be undone.`,
		confirmLabel: "Drop all",
		run: dropAll,
	});
}

export function switchTo(connection: ConnectionConfig): void {
	confirmDiscardIf($editor.get() !== null, (): void => {
		switchConnection(connection);
	});
}

// Closes tabs, asking first when the edited row's tab is among them, and then
// when a query tab would lose its SQL.
function closeTabsAsking(tabs: readonly Tab[]): void {
	const editing: boolean = tabs.some(
		(tab: Tab): boolean => tab.kind === "table" && isEditing(tab.table),
	);

	confirmDiscardIf(editing, (): void => {
		const written: QueryTab[] = tabs.filter(
			(tab: Tab): tab is QueryTab =>
				tab.kind === "query" && ($querySql.get()[tab.id] ?? "").trim() !== "",
		);
		const [first]: QueryTab[] = written;

		if (!first) {
			closeTabs(tabs);

			return;
		}

		Confirmation.make({
			heading:
				written.length === 1 ? `Close ${tabLabel(first)}?` : "Close queries?",
			description:
				written.length === 1
					? "Its SQL will be lost."
					: `The SQL of ${written.length} queries will be lost.`,
			confirmLabel: "Close",
			onConfirm: (): void => {
				closeTabs(tabs);
			},
		});
	});
}

export function closeTab(tab: Tab | null = $activeTab.get()): void {
	if (tab !== null) {
		closeTabsAsking([tab]);
	}
}

export function closeAllTabs(): void {
	closeTabsAsking($tabs.get());
}
