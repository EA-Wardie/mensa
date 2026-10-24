import { Confirmation } from "../components/Confirmation";
import type { ConnectionConfig } from "./config";
import {
	deleteRow,
	dropAll,
	dropTable,
	type RowTarget,
	truncateAll,
	truncateTable,
} from "./database";
import { confirmDiscardIf } from "./editor";
import { switchConnection } from "./session";
import {
	$connection,
	$editor,
	$notice,
	$schema,
	$tableData,
	type TableData,
} from "./store";
import { reloadOpenTables, reloadTable } from "./tabs";

interface Write {
	// Whether the write replaces the edited rows, so it asks about unsaved
	// changes first.
	discards: boolean;
	heading: string;
	description: string;
	// Set for writes to every table, which ask a second time, deliberately.
	warning?: string;
	confirmLabel: string;
	run: () => Promise<string | null>;
	// Updates the store afterwards, even after an error, since MySQL may have
	// changed some tables.
	after?: () => void;
}

function isEditing(table: string): boolean {
	return $editor.get()?.table === table;
}

// Asks, then writes. The update afterwards and the error only show while the
// same connection is open.
function confirmWrite(write: Write): void {
	const onConfirm: () => Promise<void> = async (): Promise<void> => {
		const connection: ConnectionConfig | null = $connection.get();
		const error: string | null = await write.run();

		if ($connection.get() !== connection) {
			return;
		}

		write.after?.();

		if (error) {
			$notice.set(error);
		}
	};
	const { warning }: Write = write;

	confirmDiscardIf(write.discards, (): void => {
		Confirmation.make({
			heading: write.heading,
			description: write.description,
			confirmLabel: write.confirmLabel,
			onConfirm:
				warning === undefined
					? onConfirm
					: (): void => {
							Confirmation.make({
								heading: "Are you sure?",
								description: warning,
								confirmLabel: write.confirmLabel,
								deliberate: true,
								onConfirm: onConfirm,
							});
						},
		});
	});
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
		description: `Every row in every table in ${schema} will be deleted.`,
		warning: `This empties every table in ${schema} and can't be undone.`,
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
		description: `Every table and view in ${schema} will be dropped with all their rows.`,
		warning: `This drops every table and view in ${schema} and can't be undone.`,
		confirmLabel: "Drop all",
		run: dropAll,
	});
}

export function switchTo(connection: ConnectionConfig): void {
	confirmDiscardIf($editor.get() !== null, (): void => {
		switchConnection(connection);
	});
}
