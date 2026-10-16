import { SQL } from "bun";
import { type ConnectionConfig, rowLimit } from "./config";
import { CONNECTION_TIMEOUT } from "./consts";
import { logError } from "./log";
import { $openTables, $tableData, type TableData, type Value } from "./store";

const SCHEMA: string = "public";

interface TableRow {
	table_name: string;
}

interface ColumnRow {
	column_name: string;
}

export interface OpenedClient {
	tables: string[];
	tablesError: string;
}

// The open client, or the one still connecting. closeClient() clears it, so a
// query that finishes later can tell its session has ended.
let client: SQL | null = null;

export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function makeClient(connection: ConnectionConfig): SQL {
	const options: Bun.SQL.PostgresOrMySQLOptions = {
		adapter: "postgres",
		max: 4,
		connectionTimeout: CONNECTION_TIMEOUT,
	};

	if (connection.url) options.url = connection.url;
	if (connection.host) options.hostname = connection.host;
	if (connection.port !== undefined) options.port = connection.port;
	if (connection.user) options.username = connection.user;
	if (connection.password) options.password = connection.password;
	if (connection.database) options.database = connection.database;
	if (connection.ssl) options.tls = connection.ssl;

	return new SQL(options);
}

// Quoted by hand, since sql() splits identifiers on dots and a table name
// can contain one.
function quoteIdentifier(name: string): string {
	return `"${name.replaceAll('"', '""')}"`;
}

function setTableData(name: string, data: TableData | undefined): void {
	const { [name]: _, ...rest }: Readonly<Record<string, TableData>> =
		$tableData.get();

	$tableData.set(data ? { ...rest, [name]: data } : rest);
}

async function listTables(sql: SQL): Promise<string[]> {
	const rows: TableRow[] = await sql`
		SELECT table_name
		FROM information_schema.tables
		WHERE table_schema = ${SCHEMA}
			AND table_type IN ('BASE TABLE', 'VIEW')
		ORDER BY table_name
	`;

	return rows.map((row: TableRow): string => row.table_name);
}

// Opens a client and lists its tables. Throws if it can't connect, and
// resolves to null if the client was closed while connecting.
export async function openClient(
	connection: ConnectionConfig,
): Promise<OpenedClient | null> {
	const sql: SQL = makeClient(connection);
	const opened: OpenedClient = { tables: [], tablesError: "" };

	client = sql;

	try {
		await sql`SELECT 1`;
	} catch (error) {
		const current: boolean = client === sql;

		if (current) {
			client = null;
		}

		await sql.close({ timeout: 0 }).catch(logError);

		if (current) {
			throw error;
		}

		return null;
	}

	try {
		opened.tables = await listTables(sql);
	} catch (error) {
		logError(error);
		opened.tablesError = `Could not list tables: ${errorMessage(error)}`;
	}

	return client === sql ? opened : null;
}

export async function loadTable(name: string): Promise<void> {
	const sql: SQL | null = client;

	if (!sql) {
		return;
	}

	const isCurrent: () => boolean = (): boolean =>
		client === sql && $openTables.get().includes(name);

	setTableData(name, { status: "loading" });

	try {
		const columns: string[] = (
			await sql<ColumnRow[]>`
				SELECT column_name
				FROM information_schema.columns
				WHERE table_schema = ${SCHEMA} AND table_name = ${name}
				ORDER BY ordinal_position
			`
		).map((column: ColumnRow): string => column.column_name);
		// Each value is cast to text, so Postgres formats it with its type's own
		// output, such as a date without a time or a timestamp in the session's
		// time zone.
		const values: string = columns
			.map((column: string): string => `${quoteIdentifier(column)}::text`)
			.join(", ");
		const table: string = `${quoteIdentifier(SCHEMA)}.${quoteIdentifier(name)}`;
		// One extra row tells whether the table has more than the limit.
		const rows: Value[][] = await (sql`
			SELECT ${sql.unsafe(values)} FROM ${sql.unsafe(table)}
			LIMIT ${rowLimit + 1}
		`.values() as Promise<Value[][]>);

		if (!isCurrent()) {
			return;
		}

		setTableData(name, {
			status: "loaded",
			columns: columns,
			rows: rows.slice(0, rowLimit),
			truncated: rows.length > rowLimit,
		});
	} catch (error) {
		if (!isCurrent()) {
			return;
		}

		logError(error);
		setTableData(name, { status: "error", message: errorMessage(error) });
	}
}

export function forgetTable(name: string): void {
	setTableData(name, undefined);
}

export async function closeClient(): Promise<void> {
	const sql: SQL | null = client;

	client = null;

	await sql?.close({ timeout: 0 }).catch(logError);
}
