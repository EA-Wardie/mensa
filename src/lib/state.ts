import { type ConnectionConfig, connections, isTable } from "./config";
import { STATE_PATH, STATE_SAVE_DELAY } from "./consts";
import { logError } from "./log";

// A query tab's id and its SQL.
export interface SavedQuery {
	query: string;
	sql: string;
}

// A table tab by its name, or a query tab.
export type SavedTab = string | SavedQuery;

export interface TabsState {
	open: SavedTab[];
	// The active tab's index in open.
	active: number | null;
}

interface State {
	lastConnection?: string;
	tabs: Record<string, TabsState>;
}

// A query's id is its number, which its tab shows.
function isSavedTab(value: unknown): value is SavedTab {
	return (
		typeof value === "string" ||
		(isTable(value) &&
			typeof value.query === "string" &&
			/^[1-9][0-9]*$/.test(value.query) &&
			typeof value.sql === "string")
	);
}

function isSavedTabs(value: unknown): value is SavedTab[] {
	return Array.isArray(value) && value.every(isSavedTab);
}

// Before query tabs, the active tab was saved by its table's name.
function parseActive(open: SavedTab[], active: unknown): number | null {
	if (typeof active === "string") {
		const index: number = open.indexOf(active);

		return index < 0 ? null : index;
	}

	return typeof active === "number" &&
		Number.isInteger(active) &&
		active >= 0 &&
		active < open.length
		? active
		: null;
}

// Keeps the tabs of connections that are still in the config.
function parseTabs(value: unknown): Record<string, TabsState> {
	const tabs: Record<string, TabsState> = {};

	if (!isTable(value)) {
		return tabs;
	}

	for (const { name } of connections) {
		const entry: unknown = value[name];
		const { open, active }: Record<string, unknown> = isTable(entry)
			? entry
			: {};

		if (isSavedTabs(open)) {
			tabs[name] = { open: open, active: parseActive(open, active) };
		}
	}

	return tabs;
}

async function loadState(): Promise<State> {
	const file: Bun.BunFile = Bun.file(STATE_PATH);

	if (!(await file.exists())) {
		return { tabs: {} };
	}

	try {
		const { lastConnection, tabs }: Record<string, unknown> = await file.json();
		const state: State = { tabs: parseTabs(tabs) };

		if (typeof lastConnection === "string") {
			state.lastConnection = lastConnection;
		}

		return state;
	} catch (error) {
		logError(error);

		return { tabs: {} };
	}
}

const state: State = await loadState();

// Writes are chained so they reach the file in the order they were made.
let pending: Promise<unknown> = Promise.resolve();

let timer: Timer | null = null;

// Batches bursts of changes, such as cycling through tabs, into one write.
function saveState(): void {
	timer ??= setTimeout((): void => {
		flushState();
	}, STATE_SAVE_DELAY);
}

// Writes any change still waiting, for quitting.
export function flushState(): Promise<unknown> {
	if (timer === null) {
		return pending;
	}

	const json: string = `${JSON.stringify(state, null, "\t")}\n`;

	clearTimeout(timer);
	timer = null;

	pending = pending
		.then((): Promise<number> => Bun.write(STATE_PATH, json))
		.catch(logError);

	return pending;
}

export function lastConnection(): string | null {
	return state.lastConnection ?? null;
}

export function rememberConnection(name: string | null): void {
	if ((state.lastConnection ?? null) === name) {
		return;
	}

	if (name === null) {
		delete state.lastConnection;
	} else {
		state.lastConnection = name;
	}

	saveState();
}

export function rememberedTabs(connection: ConnectionConfig): TabsState | null {
	return state.tabs[connection.name] ?? null;
}

export function rememberTabs(
	connection: ConnectionConfig,
	tabs: TabsState,
): void {
	const saved: TabsState | undefined = state.tabs[connection.name];

	if (Bun.deepEquals(saved, tabs)) {
		return;
	}

	state.tabs[connection.name] = tabs;

	saveState();
}
