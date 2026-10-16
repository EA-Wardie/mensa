import { resolve } from "node:path";
import { parseColor, RGBA } from "@opentui/core";
import {
	DEFAULT_DOUBLE_CLICK_TIMEOUT,
	DEFAULT_PORT,
	DEFAULT_ROW_LIMIT,
	HOME_DIRECTORY,
	MAX_PORT,
	USER_CONFIG_PATH,
} from "./consts";
import { logError, setLogsPath } from "./log";

const THEME_KEYS = [
	"bg",
	"fg",
	"border",
	"success",
	"danger",
	"accent",
	"surface",
] as const;

type ThemeKey = (typeof THEME_KEYS)[number];

type BaseColorKey = Exclude<ThemeKey, "surface">;

export interface ThemeType {
	bg: RGBA;
	surface: RGBA;
	fg: RGBA;
	fg_inverse: RGBA;
	muted: RGBA;
	border: RGBA;
	hover: RGBA;
	selected: RGBA;
	active: RGBA;
	pressed: RGBA;
	input_bg: RGBA;
	transparent: RGBA;
	scrollbar_thumb: RGBA;
	scrollbar_track: RGBA;
	accent: RGBA;
	success: RGBA;
	success_pressed: RGBA;
	danger: RGBA;
	danger_pressed: RGBA;
}

const SSL_MODES = [
	"disable",
	"allow",
	"prefer",
	"require",
	"verify-ca",
	"verify-full",
] as const;

export type SslMode = (typeof SSL_MODES)[number];

export interface ConnectionConfig {
	name: string;
	url?: string;
	host?: string;
	port?: number;
	user?: string;
	password?: string;
	database?: string;
	ssl?: SslMode;
}

interface ConfigFile {
	logs_path?: string;
	row_limit?: unknown;
	double_click_timeout?: unknown;
	connections?: unknown;
	theme?: unknown;
}

async function loadUserConfig(): Promise<ConfigFile> {
	const file: Bun.BunFile = Bun.file(USER_CONFIG_PATH);

	if (!(await file.exists())) {
		return {};
	}

	try {
		return Bun.TOML.parse(await file.text()) as ConfigFile;
	} catch (error) {
		logError(error);

		return {};
	}
}

export function expandHome(path: string): string {
	if (path === "~" || path.startsWith("~/")) {
		return HOME_DIRECTORY + path.slice(1);
	}

	return path;
}

function normalizePath(path: string): string {
	return resolve(expandHome(path));
}

const userConfig: ConfigFile = await loadUserConfig();

if (userConfig.logs_path) {
	setLogsPath(normalizePath(userConfig.logs_path));
}

function isPositiveInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function parsePositiveInteger(
	key: string,
	value: unknown,
	fallback: number,
): number {
	if (value === undefined) {
		return fallback;
	}

	if (isPositiveInteger(value)) {
		return value;
	}

	logError(new Error(`Invalid ${key}: ${String(value)}`));

	return fallback;
}

export const doubleClickTimeout: number = parsePositiveInteger(
	"double_click_timeout",
	userConfig.double_click_timeout,
	DEFAULT_DOUBLE_CLICK_TIMEOUT,
);

export const rowLimit: number = parsePositiveInteger(
	"row_limit",
	userConfig.row_limit,
	DEFAULT_ROW_LIMIT,
);

function optionalString(
	entry: Record<string, unknown>,
	key: string,
): string | undefined {
	const value: unknown = entry[key];

	return typeof value === "string" && value ? value : undefined;
}

function parseConnection(
	value: unknown,
	index: number,
): ConnectionConfig | undefined {
	if (!isTable(value)) {
		logError(new Error(`Invalid connection #${index + 1}: ${String(value)}`));

		return undefined;
	}

	const name: string | undefined = optionalString(value, "name");
	const url: string | undefined = optionalString(value, "url");
	const host: string | undefined = optionalString(value, "host");
	// A url carries its own port, which an explicit port option would override.
	const port: unknown = value.port ?? (url ? undefined : DEFAULT_PORT);
	const ssl: unknown = value.ssl;

	if (!name) {
		logError(new Error(`Connection #${index + 1} has no name`));

		return undefined;
	}

	if (!url && !host) {
		logError(new Error(`Connection "${name}" needs a url or a host`));

		return undefined;
	}

	if (port !== undefined && !(isPositiveInteger(port) && port <= MAX_PORT)) {
		logError(new Error(`Invalid port for "${name}": ${String(port)}`));

		return undefined;
	}

	if (
		ssl !== undefined &&
		!(typeof ssl === "string" && isOneOf(SSL_MODES, ssl))
	) {
		logError(new Error(`Invalid ssl for "${name}": ${String(ssl)}`));

		return undefined;
	}

	const connection: ConnectionConfig = { name: name };
	const user: string | undefined = optionalString(value, "user");
	const password: string | undefined = optionalString(value, "password");
	const database: string | undefined = optionalString(value, "database");

	if (port !== undefined) connection.port = port;
	if (url) connection.url = url;
	if (host) connection.host = host;
	if (user) connection.user = user;
	if (password) connection.password = password;
	if (database) connection.database = database;
	if (ssl) connection.ssl = ssl;

	return connection;
}

function parseConnections(value: unknown): ConnectionConfig[] {
	if (value === undefined) {
		return [];
	}

	if (!Array.isArray(value)) {
		logError(new Error(`Invalid connections: ${String(value)}`));

		return [];
	}

	const parsed: ConnectionConfig[] = [];
	const names: Set<string> = new Set<string>();

	value.forEach((entry: unknown, index: number): void => {
		const connection: ConnectionConfig | undefined = parseConnection(
			entry,
			index,
		);

		if (!connection) {
			return;
		}

		// Saved state is keyed by name, so names must be unique.
		if (names.has(connection.name)) {
			logError(new Error(`Duplicate connection name "${connection.name}"`));

			return;
		}

		names.add(connection.name);
		parsed.push(connection);
	});

	return parsed;
}

export const connections: ConnectionConfig[] = parseConnections(
	userConfig.connections,
);

export function describeConnection(connection: ConnectionConfig): string {
	if (connection.url) {
		try {
			const url: URL = new URL(connection.url);

			if (connection.port !== undefined) {
				url.port = String(connection.port);
			}

			return `${url.username ? `${url.username}@` : ""}${url.host}${url.pathname}`;
		} catch {
			// Drops the password from a url the URL parser rejects.
			return connection.url.replace(
				/^([^:/?#]+:\/\/[^:@/?#]*):[^/?#]*@/,
				"$1@",
			);
		}
	}

	const user: string = connection.user ? `${connection.user}@` : "";
	const database: string = connection.database ? `/${connection.database}` : "";

	return `${user}${connection.host}:${connection.port ?? DEFAULT_PORT}${database}`;
}

const COLOR_PATTERN: RegExp =
	/^#?([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

const BLACK: RGBA = RGBA.fromValues(0, 0, 0, 1);

const WHITE: RGBA = RGBA.fromValues(1, 1, 1, 1);

const TRANSPARENT: RGBA = RGBA.fromValues(0, 0, 0, 0);

const defaultTheme: Record<BaseColorKey, string> = {
	bg: "#0C0C0C",
	fg: "#fafafa",
	border: "#d4d4d4",
	success: "#16a34a",
	danger: "#dc2626",
	accent: "#0369a1",
};

function isValidColor(value: unknown): value is string {
	return (
		typeof value === "string" &&
		(value.toLowerCase() === "transparent" || COLOR_PATTERN.test(value))
	);
}

function parseThemeColor(key: string, value: unknown): RGBA | undefined {
	if (value === undefined) {
		return undefined;
	}

	if (isValidColor(value)) {
		return parseColor(value);
	}

	logError(new Error(`Invalid color for "${key}": ${String(value)}`));

	return undefined;
}

function withAlpha(color: RGBA, alpha: number): RGBA {
	return RGBA.fromValues(color.r, color.g, color.b, alpha);
}

function isLight(color: RGBA): boolean {
	return 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b > 0.5;
}

export function isTable(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOneOf<K extends string>(keys: readonly K[], key: string): key is K {
	return (keys as readonly string[]).includes(key);
}

function parseColorTable<K extends string>(
	name: string,
	value: unknown,
	keys: readonly K[],
): Partial<Record<K, RGBA>> {
	const colors: Partial<Record<K, RGBA>> = {};

	if (value === undefined) {
		return colors;
	}

	if (!isTable(value)) {
		logError(new Error(`Invalid ${name} table: ${String(value)}`));

		return colors;
	}

	for (const [key, color] of Object.entries(value)) {
		if (!isOneOf(keys, key)) {
			logError(new Error(`Unknown ${name} key "${key}"`));

			continue;
		}

		const parsed: RGBA | undefined = parseThemeColor(`${name}.${key}`, color);

		if (parsed) {
			colors[key] = parsed;
		}
	}

	return colors;
}

function makeTheme(config: unknown): ThemeType {
	const colors: Partial<Record<ThemeKey, RGBA>> = parseColorTable(
		"theme",
		config,
		THEME_KEYS,
	);
	const color = (key: BaseColorKey): RGBA =>
		colors[key] ?? parseColor(defaultTheme[key]);

	const bg: RGBA = color("bg");
	const fg: RGBA = color("fg");
	const success: RGBA = color("success");
	const danger: RGBA = color("danger");
	const transparent: boolean = bg.a === 0;
	const dark: boolean = transparent ? isLight(fg) : !isLight(bg);
	const fallback: RGBA = dark ? BLACK : WHITE;
	const opaqueBg: RGBA = transparent ? fallback : withAlpha(bg, 1);

	return {
		bg,
		surface: colors.surface ?? opaqueBg,
		fg,
		fg_inverse: opaqueBg,
		muted: withAlpha(fg, 0.75),
		border: color("border"),
		hover: withAlpha(fg, 0.25),
		selected: withAlpha(fg, 0.75),
		active: fg,
		pressed: withAlpha(fg, 0.75),
		input_bg: withAlpha(fg, 0.25),
		transparent: TRANSPARENT,
		scrollbar_thumb: withAlpha(fg, 0.5),
		scrollbar_track: TRANSPARENT,
		accent: color("accent"),
		success,
		success_pressed: withAlpha(success, 0.75),
		danger,
		danger_pressed: withAlpha(danger, 0.75),
	};
}

export const theme: ThemeType = makeTheme(userConfig.theme);
