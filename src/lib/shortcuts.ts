import type * as core from "@opentui/core";
import { Confirmation } from "../components/Confirmation";
import { GridView } from "../components/GridView";
import { QueryView } from "../components/QueryView";
import { closeTab, refreshSchema } from "./actions";
import { disposeClipboard } from "./clipboard";
import { type ConnectionConfig, connectionLabel } from "./config";
import { QUIT_TIMEOUT } from "./consts";
import { ctx } from "./context";
import { closeClient } from "./database";
import { confirmDiscard, editRow } from "./editor";
import { clearMarks } from "./marks";
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
	$viewer,
	moveSelection,
	type Screen,
} from "./store";
import {
	cycleTab,
	newQuery,
	openTable,
	refreshActiveTab,
	runActiveQuery,
} from "./tabs";
import { closeViewer, viewRow } from "./viewer";

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
		Promise.all([closeClient(), flushState(), disposeClipboard()]),
		Bun.sleep(QUIT_TIMEOUT),
	]).finally((): void => {
		ctx.destroy();
		process.exit(0);
	});
}

// Views the shown grid's next row while a row is viewed, which selects it, and
// otherwise moves the sidebar's table.
function stepRowOrTable(step: number): void {
	if ($viewer.get() === null) {
		moveSelection($tables, $selectedTable, step);

		return;
	}

	const row: number | null = GridView.current?.stepRow(step) ?? null;

	if (row !== null) {
		viewRow(row, null);
	}
}

// Acts on the shown grid: the table's, or the query's results.
function withGrid(action: (grid: GridView) => void): Run {
	return (): void => {
		if (GridView.current) {
			action(GridView.current);
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
		description: "Select the table above, or the row above while viewing one",
		screen: "database",
		run: (): void => {
			stepRowOrTable(-1);
		},
	},
	tableDown: {
		key: "down",
		alias: "j",
		description: "Select the table below, or the row below while viewing one",
		screen: "database",
		run: (): void => {
			stepRowOrTable(1);
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
			cycleTab(1);
		},
	},
	previousTab: {
		key: "[",
		description: "Show the previous tab",
		screen: "database",
		run: (): void => {
			cycleTab(-1);
		},
	},
	closeTab: {
		key: "x",
		description: "Close the active tab",
		screen: "database",
		run: (): void => {
			closeTab();
		},
	},
	runQuery: {
		key: "ctrl+return",
		description: "Run the query",
		screen: "database",
		run: (): void => {
			runActiveQuery();
		},
	},
	newQuery: {
		key: "n",
		description: "Open a new query tab",
		screen: "database",
		run: (): void => {
			newQuery();
		},
	},
	// Reloading replaces the rows, which closes the row editor.
	refresh: {
		key: "r",
		description: "Reload the active table, or run the active query again",
		screen: "database",
		run: (): void => {
			confirmDiscard(refreshActiveTab);
		},
	},
	refreshSchema: {
		key: "ctrl+r",
		description: "List the tables again",
		screen: "database",
		run: (): void => {
			refreshSchema();
		},
	},
	pageUp: {
		key: "pageup",
		description: "Scroll the rows up a page",
		screen: "database",
		run: withGrid((grid: GridView): void => grid.scrollPage(-1)),
	},
	pageDown: {
		key: "pagedown",
		description: "Scroll the rows down a page",
		screen: "database",
		run: withGrid((grid: GridView): void => grid.scrollPage(1)),
	},
	firstRow: {
		key: "home",
		description: "Scroll to the first row",
		screen: "database",
		run: withGrid((grid: GridView): void => grid.scrollToEdge(false)),
	},
	lastRow: {
		key: "end",
		description: "Scroll to the last row",
		screen: "database",
		run: withGrid((grid: GridView): void => grid.scrollToEdge(true)),
	},
	columnLeft: {
		key: "left",
		alias: "h",
		description: "Scroll the columns left",
		screen: "database",
		run: withGrid((grid: GridView): void => grid.scrollColumns(-1)),
	},
	columnRight: {
		key: "right",
		alias: "l",
		description: "Scroll the columns right",
		screen: "database",
		run: withGrid((grid: GridView): void => grid.scrollColumns(1)),
	},
	editRow: {
		key: "e",
		description: "Edit the selected row, or the query's SQL",
		screen: "database",
		run: (): void => {
			// A query's rows aren't edited, so E edits its SQL instead. Otherwise
			// the shown grid is the table's.
			if (QueryView.focusShown()) {
				return;
			}

			const row: number | null = GridView.current?.selectedRow() ?? null;

			if (row !== null) {
				editRow(row, null);
			}
		},
	},
	viewRow: {
		key: "v",
		description: "View the selected row",
		screen: "database",
		run: (): void => {
			const row: number | null = GridView.current?.selectedRow() ?? null;

			if (row !== null) {
				viewRow(row, null);
			}
		},
	},
	markRow: {
		key: "space",
		description: "Mark or unmark the selected row, then select the next",
		screen: "database",
		run: withGrid((grid: GridView): void => grid.markSelected()),
	},
	clearRow: {
		key: "escape",
		description: "Close the row view, or clear the marks, or the selected row",
		screen: "database",
		run: withGrid((grid: GridView): void => {
			if ($viewer.get() !== null) {
				closeViewer();
			} else if (grid.markedRows().length) {
				clearMarks();
			} else {
				grid.clearSelection();
			}
		}),
	},
	disconnect: {
		key: "c",
		description: "Close the connection",
		screen: "database",
		run: (): void => {
			const connection: ConnectionConfig | null = $connection.get();

			Confirmation.make({
				heading: "Close connection?",
				description: `Are you sure you want to close the connection to ${connection ? connectionLabel(connection) : "the database"}?`,
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
