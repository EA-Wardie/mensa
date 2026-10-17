import type * as core from "@opentui/core";
import { Confirmation } from "../components/Confirmation";
import { DataGrid } from "../components/DataGrid";
import type { ConnectionConfig } from "./config";
import { QUIT_TIMEOUT } from "./consts";
import { ctx } from "./context";
import { closeClient } from "./database";
import { editRow } from "./editor";
import { connect, disconnect } from "./session";
import { flushState } from "./state";
import {
	$connection,
	$connections,
	$dialogOpen,
	$editor,
	$screen,
	$selectedConnection,
	$selectedTable,
	$tables,
	moveSelection,
	type Screen,
} from "./store";
import { closeTable, cycleTable, openTable, selectRow } from "./tabs";

type Run = () => void;

interface Shortcut {
	key: string;
	alias?: string;
	description: string;
	screen?: Screen;
	run: Run;
}

// Bun's SQL close() waits for a pending connect to time out, and the pool can
// keep the process alive, so exit after a short grace period. The client is
// closed without resetting the UI, which would build the start screen first.
function quit(): void {
	Promise.race([
		Promise.all([closeClient(), flushState()]),
		Bun.sleep(QUIT_TIMEOUT),
	]).finally((): void => {
		ctx.destroy();
		process.exit(0);
	});
}

function withGrid(action: (grid: DataGrid) => void): Run {
	return (): void => {
		if (DataGrid.current) {
			action(DataGrid.current);
		}
	};
}

export const SHORTCUTS = {
	connectionUp: {
		key: "up",
		alias: "k",
		description: "Select the connection above",
		screen: "connections",
		run: (): void => {
			moveSelection($connections, $selectedConnection, -1);
		},
	},
	connectionDown: {
		key: "down",
		alias: "j",
		description: "Select the connection below",
		screen: "connections",
		run: (): void => {
			moveSelection($connections, $selectedConnection, 1);
		},
	},
	connect: {
		key: "return",
		alias: "l",
		description: "Connect to the selected connection",
		screen: "connections",
		run: (): void => {
			const connection: ConnectionConfig | null = $selectedConnection.get();

			if (connection) {
				connect(connection);
			}
		},
	},
	tableUp: {
		key: "up",
		alias: "k",
		description: "Select the table above",
		screen: "database",
		run: (): void => {
			moveSelection($tables, $selectedTable, -1);
		},
	},
	tableDown: {
		key: "down",
		alias: "j",
		description: "Select the table below",
		screen: "database",
		run: (): void => {
			moveSelection($tables, $selectedTable, 1);
		},
	},
	openTable: {
		key: "return",
		description: "Open the selected table in a tab",
		screen: "database",
		run: (): void => {
			const table: string | null = $selectedTable.get();

			if (table !== null) {
				openTable(table);
			}
		},
	},
	nextTab: {
		key: "]",
		description: "Show the next tab",
		screen: "database",
		run: (): void => {
			cycleTable(1);
		},
	},
	previousTab: {
		key: "[",
		description: "Show the previous tab",
		screen: "database",
		run: (): void => {
			cycleTable(-1);
		},
	},
	closeTab: {
		key: "x",
		description: "Close the active tab",
		screen: "database",
		run: (): void => {
			closeTable();
		},
	},
	pageUp: {
		key: "pageup",
		description: "Scroll the rows up a page",
		screen: "database",
		run: withGrid((grid: DataGrid): void => grid.scrollPage(-1)),
	},
	pageDown: {
		key: "pagedown",
		description: "Scroll the rows down a page",
		screen: "database",
		run: withGrid((grid: DataGrid): void => grid.scrollPage(1)),
	},
	firstRow: {
		key: "home",
		description: "Scroll to the first row",
		screen: "database",
		run: withGrid((grid: DataGrid): void => grid.scrollToEdge(false)),
	},
	lastRow: {
		key: "end",
		description: "Scroll to the last row",
		screen: "database",
		run: withGrid((grid: DataGrid): void => grid.scrollToEdge(true)),
	},
	columnLeft: {
		key: "left",
		alias: "h",
		description: "Scroll the columns left",
		screen: "database",
		run: withGrid((grid: DataGrid): void => grid.scrollColumns(-1)),
	},
	columnRight: {
		key: "right",
		alias: "l",
		description: "Scroll the columns right",
		screen: "database",
		run: withGrid((grid: DataGrid): void => grid.scrollColumns(1)),
	},
	editRow: {
		key: "e",
		description: "Edit the selected row",
		screen: "database",
		run: withGrid((grid: DataGrid): void => {
			const row: number | null = grid.selectedRow();

			if (row !== null) {
				editRow(row, null);
			}
		}),
	},
	clearRow: {
		key: "escape",
		description: "Clear the selected row",
		screen: "database",
		run: (): void => {
			selectRow(null);
		},
	},
	disconnect: {
		key: "c",
		description: "Close the connection",
		screen: "database",
		run: (): void => {
			Confirmation.make({
				heading: "Close connection?",
				description: `Are you sure you want to close the connection to ${$connection.get()?.name ?? "the database"}?`,
				confirmLabel: "Close",
				onConfirm: disconnect,
			});
		},
	},
	quit: {
		key: "q",
		description: "Quit the application",
		run: (): void => {
			Confirmation.make({
				heading: "Quit?",
				description: "Are you sure you want to quit the application?",
				confirmLabel: "Quit",
				onConfirm: quit,
			});
		},
	},
} satisfies Record<string, Shortcut>;

const SHORTCUT_LIST: Shortcut[] = Object.values(SHORTCUTS);

const KEYMAPS: Record<Screen, Map<string, Run>> = {
	connections: new Map<string, Run>(),
	database: new Map<string, Run>(),
};

for (const { key, alias, screen, run } of SHORTCUT_LIST) {
	const keymaps: Map<string, Run>[] = screen
		? [KEYMAPS[screen]]
		: Object.values(KEYMAPS);

	for (const keymap of keymaps) {
		keymap.set(key, run);

		if (alias) {
			keymap.set(alias, run);
		}
	}
}

export function shortcutLabel({ key }: Pick<Shortcut, "key">): string {
	return key
		.split("+")
		.map((part: string): string => part[0]?.toUpperCase() + part.slice(1))
		.join("+");
}

export function registerKeyboardShortcuts(): void {
	ctx.keyInput.on("keypress", (key: core.KeyEvent): void => {
		// The row editor handles its own keys, and an input or a textarea takes
		// any other.
		if (
			$dialogOpen.get() ||
			$editor.get() !== null ||
			ctx.currentFocusedEditor !== null ||
			key.meta ||
			key.option
		) {
			return;
		}

		const run: Run | undefined = KEYMAPS[$screen.get()].get(
			key.ctrl ? `ctrl+${key.name}` : key.name,
		);

		if (run) {
			key.preventDefault();
			run();
		}
	});
}
