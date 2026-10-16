import type * as core from "@opentui/core";
import { App } from "./components/App";
import { ConnectionsScreen } from "./components/ConnectionsScreen";
import { DatabaseScreen } from "./components/DatabaseScreen";
import type { ConnectionConfig } from "./lib/config";
import { makeApp } from "./lib/context";
import { connect } from "./lib/session";
import { registerKeyboardShortcuts } from "./lib/shortcuts";
import { lastConnection } from "./lib/state";
import {
	$connections,
	$screen,
	$selectedConnection,
	type Screen,
} from "./lib/store";

const SCREENS: Record<Screen, () => core.BoxRenderable> = {
	connections: ConnectionsScreen.make.bind(ConnectionsScreen),
	database: DatabaseScreen.make.bind(DatabaseScreen),
};

function reconnect(): void {
	const name: string | null = lastConnection();
	const connection: ConnectionConfig | undefined = $connections
		.get()
		.find((candidate: ConnectionConfig): boolean => candidate.name === name);

	if (connection) {
		$selectedConnection.set(connection);
		connect(connection);
	}
}

function main(): void {
	makeApp((): void => {
		registerKeyboardShortcuts();

		const app: core.BoxRenderable = App.make({
			components: [],
		});
		let screen: core.BoxRenderable | null = null;

		$screen.subscribe((name: Screen): void => {
			screen?.destroyRecursively();
			screen = SCREENS[name]();
			app.add(screen);
		});

		reconnect();
	});
}

main();
