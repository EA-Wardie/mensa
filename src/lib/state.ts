import { type ConnectionConfig, connections, isTable } from "./config";
import { STATE_PATH, STATE_SAVE_DELAY } from "./consts";
import { logError } from "./log";

export interface TabsState {
	open: string[];
	active: string | null;
}

interface State {
	lastConnection?: string;
	tabs: Record<string, TabsState>;
}

function isStringArray(value: unknown): value is string[] {
	return (
		Array.isArray(value) &&
		value.every((item: unknown): boolean => typeof item === "string")
	);
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

		if (isStringArray(open)) {
			tabs[name] = {
				open: open,
				active: typeof active === "string" ? active : null,
			};
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

	if (
		saved?.active === tabs.active &&
		saved.open.join("\0") === tabs.open.join("\0")
	) {
		return;
	}

	state.tabs[connection.name] = tabs;

	saveState();
}
