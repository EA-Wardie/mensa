import type { ConnectionConfig } from "./config";
import {
	closeClient,
	errorMessage,
	type OpenedClient,
	openClient,
} from "./database";
import { logError } from "./log";
import { rememberConnection } from "./state";
import {
	$connecting,
	$connection,
	$notice,
	$screen,
	$selectedTable,
	$tables,
} from "./store";
import { resetTabs, restoreTabs } from "./tabs";

export async function connect(connection: ConnectionConfig): Promise<void> {
	if ($connecting.get() !== null || $connection.get() !== null) {
		return;
	}

	let opened: OpenedClient | null = null;

	$connecting.set(connection);
	$notice.set("");

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
	$notice.set("");
	$tables.set([]);
	$selectedTable.set(null);
	$screen.set("connections");

	await closing;
}
