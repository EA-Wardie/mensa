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

// Connections are saved by name, with production ones apart, since one may
// share its name with a connection that isn't.
interface State {
	lastConnection?: string;
	// Set only when the last connection is production.
	lastProduction?: true;
	tabs: Record<string, TabsState>;
	productionTabs: Record<string, TabsState>;
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

// Keeps the tabs of the group's connections that are still in the config.
function parseTabs(
	value: unknown,
	production: boolean,
): Record<string, TabsState> {
	const tabs: Record<string, TabsState> = {};

	if (!isTable(value)) {
		return tabs;
	}

	for (const connection of connections) {
		const entry: unknown =
			connection.production === production ? value[connection.name] : null;
		const { open, active }: Record<string, unknown> = isTable(entry)
			? entry
			: {};

		if (isSavedTabs(open)) {
			tabs[connection.name] = {
				open: open,
				active: parseActive(open, active),
			};
		}
	}

	return tabs;
}

function emptyState(): State {
	return { tabs: {}, productionTabs: {} };
}

async function loadState(): Promise<State> {
	const file: Bun.BunFile = Bun.file(STATE_PATH);

	if (!(await file.exists())) {
		return emptyState();
	}

	try {
		const {
			lastConnection,
			lastProduction,
			tabs,
			productionTabs,
		}: Record<string, unknown> = await file.json();
		const state: State = {
			tabs: parseTabs(tabs, false),
			productionTabs: parseTabs(productionTabs, true),
		};

		if (typeof lastConnection === "string") {
			state.lastConnection = lastConnection;
		}

		if (lastProduction === true) {
			state.lastProduction = true;
		}

		return state;
	} catch (error) {
		logError(error);

		return emptyState();
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

// The last connection, while it's still in the config.
// The saved tabs of the connection's group.
function groupTabs(connection: ConnectionConfig): Record<string, TabsState> {
	return connection.production ? state.productionTabs : state.tabs;
}

function isLast(connection: ConnectionConfig | null): boolean {
	return (
		(state.lastConnection ?? null) === (connection?.name ?? null) &&
		(state.lastProduction ?? false) === (connection?.production ?? false)
	);
}

// The last connection, while it's still in the config.
export function lastConnection(): ConnectionConfig | null {
	return connections.find(isLast) ?? null;
}

export function rememberConnection(connection: ConnectionConfig | null): void {
	if (isLast(connection)) {
		return;
	}

	delete state.lastConnection;
	delete state.lastProduction;

	if (connection) {
		state.lastConnection = connection.name;

		if (connection.production) {
			state.lastProduction = true;
		}
	}

	saveState();
}

export function rememberedTabs(connection: ConnectionConfig): TabsState | null {
	return groupTabs(connection)[connection.name] ?? null;
}

export function rememberTabs(
	connection: ConnectionConfig,
	tabs: TabsState,
): void {
	const group: Record<string, TabsState> = groupTabs(connection);

	if (Bun.deepEquals(group[connection.name], tabs)) {
		return;
	}

	group[connection.name] = tabs;

	saveState();
}
