import type { ConnectionConfig } from "./config";
import { closeClient, type OpenedClient, openClient } from "./database";
import { errorMessage } from "./format";
import { logError } from "./log";
import { rememberConnection } from "./state";
import {
	$connecting,
	$connection,
	$notice,
	$schema,
	$screen,
	$selectedConnection,
	$selectedTable,
	$tables,
	clearNotice,
} from "./store";
import { resetTabs, restoreTabs } from "./tabs";

export async function connect(connection: ConnectionConfig): Promise<void> {
	if ($connecting.get() !== null || $connection.get() !== null) {
		return;
	}

	let opened: OpenedClient | null = null;

	$connecting.set(connection);
	clearNotice();

	try {
		opened = await openClient(connection);
	} catch (error) {
		logError(error);
		$notice.set(
			`Could not connect to ${connection.name}: ${errorMessage(error)}`,
		);
	} finally {
		$connecting.set(null);
	}

	if (!opened) {
		return;
	}

	$schema.set(opened.schema);
	$tables.set(opened.tables);
	$selectedTable.set(opened.tables[0] ?? null);
	$connection.set(connection);
	rememberConnection(connection.name);
	restoreTabs(connection);
	$screen.set("database");
	$notice.set(opened.tablesError);
}

// Closing on purpose also forgets the connection, so the next start shows the
// list. Quitting only calls closeClient(), which keeps it.
export async function disconnect(): Promise<void> {
	const closing: Promise<void> = closeClient();

	rememberConnection(null);
	resetTabs();
	$connection.set(null);
	clearNotice();
	$schema.set("");
	$tables.set([]);
	$selectedTable.set(null);
	$screen.set("connections");

	await closing;
}

// Closes the connection and opens another, selected in the list, so one that
// fails to connect leaves the connections screen on it, showing why.
export async function switchConnection(
	connection: ConnectionConfig,
): Promise<void> {
	await disconnect();
	$selectedConnection.set(connection);
	await connect(connection);
}
