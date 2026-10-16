import { SQL } from "bun";
import { type ConnectionConfig, rowLimit } from "./config";
import { CONNECTION_TIMEOUT } from "./consts";
import { logError } from "./log";
import {
	$notice,
	$openTables,
	$sorts,
	$tableData,
	type Sort,
	setEntry,
	type TableData,
	type Value,
} from "./store";

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

interface SortNotice {
	table: string;
	text: string;
}

// The notice a failed sort set, so the next load of that table can clear it
// without clearing any other notice.
let sortNotice: SortNotice | null = null;

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

function clearSortNotice(table: string): void {
	if (sortNotice?.table !== table) {
		return;
	}

	if ($notice.get() === sortNotice.text) {
		$notice.set("");
	}

	sortNotice = null;
}

async function listColumns(sql: SQL, name: string): Promise<string[]> {
	const rows: ColumnRow[] = await sql`
		SELECT column_name
		FROM information_schema.columns
		WHERE table_schema = ${SCHEMA} AND table_name = ${name}
		ORDER BY ordinal_position
	`;

	return rows.map((row: ColumnRow): string => row.column_name);
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

	const sort: Sort | undefined = $sorts.get()[name];
	const previous: TableData | undefined = $tableData.get()[name];
	// A newer sort replaces the entry, so this load's result is dropped.
	const isCurrent: () => boolean = (): boolean =>
		client === sql &&
		$openTables.get().includes(name) &&
		$sorts.get()[name] === sort;

	clearSortNotice(name);

	// A new sort keeps showing the old rows until the sorted ones arrive, and
	// reuses their columns.
	if (previous?.status !== "loaded") {
		setEntry($tableData, name, { status: "loading" });
	}

	try {
		const columns: string[] =
			previous?.status === "loaded"
				? previous.columns
				: await listColumns(sql, name);
		// Each value is cast to text, so Postgres formats it with its type's own
		// output, such as a date without a time or a timestamp in the session's
		// time zone.
		const values: string = columns
			.map((column: string): string => `${quoteIdentifier(column)}::text`)
			.join(", ");
		const table: string = `${quoteIdentifier(SCHEMA)}.${quoteIdentifier(name)}`;
		// Qualified with the table, since a bare name would mean the ::text
		// output column, and sort numbers and dates as text.
		const order: string = sort
			? ` ORDER BY ${table}.${quoteIdentifier(sort.column)} ${sort.direction === "asc" ? "ASC" : "DESC"}`
			: "";
		// One extra row tells whether the table has more than the limit.
		const rows: Value[][] = await (sql`
			SELECT ${sql.unsafe(values)} FROM ${sql.unsafe(`${table}${order}`)}
			LIMIT ${rowLimit + 1}
		`.values() as Promise<Value[][]>);

		if (!isCurrent()) {
			return;
		}

		setEntry($tableData, name, {
			status: "loaded",
			columns: columns,
			rows: rows.slice(0, rowLimit),
			truncated: rows.length > rowLimit,
			sort: sort ?? null,
		});
	} catch (error) {
		if (!isCurrent()) {
			return;
		}

		const data: TableData | undefined = $tableData.get()[name];

		logError(error);

		// A failed sort keeps the rows and the sort they have.
		if (data?.status === "loaded") {
			const text: string = sort
				? `Could not sort by ${sort.column}: ${errorMessage(error)}`
				: `Could not reload ${name}: ${errorMessage(error)}`;

			setEntry($sorts, name, data.sort ?? undefined);
			$notice.set(text);

			sortNotice = { table: name, text: text };

			return;
		}

		setEntry($tableData, name, {
			status: "error",
			message: errorMessage(error),
		});
	}
}

export function forgetTable(name: string): void {
	setEntry($tableData, name, undefined);
	setEntry($sorts, name, undefined);
}

export async function closeClient(): Promise<void> {
	const sql: SQL | null = client;

	client = null;
	sortNotice = null;

	await sql?.close({ timeout: 0 }).catch(logError);
}
