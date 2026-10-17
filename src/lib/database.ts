import { SQL } from "bun";
import { type ConnectionConfig, type Driver, rowLimit } from "./config";
import { CONNECTION_TIMEOUT } from "./consts";
import { logError } from "./log";
import {
	$notice,
	$openTables,
	$selectedRows,
	$sorts,
	$tableData,
	type Sort,
	setEntry,
	type TableData,
	type Value,
} from "./store";

interface TableRow {
	table_name: string;
}

interface ColumnRow {
	column_name: string;
	data_type: string;
}

// Named as in the loaded TableData, which keeps them for a re-sort.
interface Columns {
	columns: string[];
	types: string[];
}

interface SchemaRow {
	name: string | null;
}

export interface OpenedClient {
	// Left empty when listing the tables failed, so the sidebar doesn't claim
	// the schema has none.
	schema: string;
	tables: string[];
	tablesError: string;
}

// What differs between the drivers. The queries are otherwise the same.
interface Dialect {
	quote: (name: string) => string;
	// Casts a quoted column of a data type to text, so values arrive as the
	// database formats them.
	asText: (column: string, type: string) => string;
	// The schema whose tables are listed, as an expression. Selecting it also
	// checks the connection.
	schema: string;
}

interface Client {
	sql: SQL;
	dialect: Dialect;
	// Empty until the client connects.
	schema: string;
}

// MySQL types that cast to raw bytes, so they're shown as hex, like Postgres
// shows bytea.
const MYSQL_BINARY_TYPES: ReadonlySet<string> = new Set<string>([
	"binary",
	"varbinary",
	"tinyblob",
	"blob",
	"mediumblob",
	"longblob",
]);

const MYSQL_SPATIAL_TYPES: ReadonlySet<string> = new Set<string>([
	"geometry",
	"point",
	"linestring",
	"polygon",
	"multipoint",
	"multilinestring",
	"multipolygon",
	"geometrycollection",
	"geomcollection",
]);

function mysqlAsText(column: string, type: string): string {
	const lower: string = type.toLowerCase();

	if (MYSQL_BINARY_TYPES.has(lower)) {
		return `CONCAT('0x', HEX(${column}))`;
	}

	// A bit value casts to raw bytes too, and reads best in binary.
	if (lower === "bit") {
		return `BIN(${column})`;
	}

	if (MYSQL_SPATIAL_TYPES.has(lower)) {
		return `ST_AsText(${column})`;
	}

	return `CAST(${column} AS CHAR)`;
}

// Quoted by hand, since sql() splits identifiers on dots and a table name
// can contain one.
function quoteWith(mark: string): (name: string) => string {
	return (name: string): string =>
		`${mark}${name.replaceAll(mark, mark + mark)}${mark}`;
}

const DIALECTS: Record<Driver, Dialect> = {
	postgres: {
		quote: quoteWith('"'),
		asText: (column: string): string => `${column}::text`,
		schema: "'public'",
	},
	mysql: {
		quote: quoteWith("`"),
		asText: mysqlAsText,
		schema: "DATABASE()",
	},
};

// The open client, or the one still connecting. closeClient() clears it, so a
// query that finishes later can tell its session has ended.
let client: Client | null = null;

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

// The drivers are named as Bun's adapters.
function makeClient(connection: ConnectionConfig): SQL {
	const options: Bun.SQL.PostgresOrMySQLOptions = {
		adapter: connection.driver,
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
	if (connection.allowPublicKeyRetrieval) {
		options.allowPublicKeyRetrieval = true;
	}

	return new SQL(options);
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

// The columns are aliased, since MySQL names them in capitals.
async function listColumns(
	sql: SQL,
	schema: string,
	name: string,
): Promise<Columns> {
	const rows: ColumnRow[] = await sql`
		SELECT column_name AS column_name, data_type AS data_type
		FROM information_schema.columns
		WHERE table_schema = ${schema} AND table_name = ${name}
		ORDER BY ordinal_position
	`;

	return {
		columns: rows.map((row: ColumnRow): string => row.column_name),
		types: rows.map((row: ColumnRow): string => row.data_type),
	};
}

async function listTables(sql: SQL, schema: string): Promise<string[]> {
	const rows: TableRow[] = await sql`
		SELECT table_name AS table_name
		FROM information_schema.tables
		WHERE table_schema = ${schema}
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
	const dialect: Dialect = DIALECTS[connection.driver];
	const opening: Client = { sql: sql, dialect: dialect, schema: "" };
	const opened: OpenedClient = { schema: "", tables: [], tablesError: "" };

	client = opening;

	try {
		const rows: SchemaRow[] =
			await sql`SELECT ${sql.unsafe(dialect.schema)} AS name`;

		opening.schema = rows[0]?.name ?? "";
	} catch (error) {
		const current: boolean = client === opening;

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
		opened.tables = await listTables(sql, opening.schema);
		opened.schema = opening.schema;
	} catch (error) {
		logError(error);
		opened.tablesError = `Could not list tables: ${errorMessage(error)}`;
	}

	return client === opening ? opened : null;
}

export async function loadTable(name: string): Promise<void> {
	const current: Client | null = client;

	if (!current) {
		return;
	}

	const { sql, dialect, schema }: Client = current;
	const { quote, asText }: Dialect = dialect;
	const sort: Sort | undefined = $sorts.get()[name];
	const previous: TableData | undefined = $tableData.get()[name];
	// A newer sort replaces the entry, so this load's result is dropped.
	const isCurrent: () => boolean = (): boolean =>
		client === current &&
		$openTables.get().includes(name) &&
		$sorts.get()[name] === sort;

	clearSortNotice(name);

	// A new sort keeps showing the old rows until the sorted ones arrive, and
	// reuses their columns.
	if (previous?.status !== "loaded") {
		setEntry($tableData, name, { status: "loading" });
	}

	try {
		const { columns, types }: Columns =
			previous?.status === "loaded"
				? previous
				: await listColumns(sql, schema, name);
		// Each value is cast to text, so the database formats it with its type's
		// own output, such as a date without a time or a timestamp in the
		// session's time zone.
		const values: string = columns
			.map((column: string, index: number): string =>
				asText(quote(column), types[index] ?? ""),
			)
			.join(", ");
		const table: string = `${quote(schema)}.${quote(name)}`;
		// Qualified with the table, since a bare name could mean the text output
		// column, and sort numbers and dates as text.
		const order: string = sort
			? ` ORDER BY ${table}.${quote(sort.column)} ${sort.direction === "asc" ? "ASC" : "DESC"}`
			: "";
		// One extra row tells whether the table has more than the limit.
		const rows: Value[][] = await (sql`
			SELECT ${sql.unsafe(values)} FROM ${sql.unsafe(`${table}${order}`)}
			LIMIT ${rowLimit + 1}
		`.values() as Promise<Value[][]>);

		if (!isCurrent()) {
			return;
		}

		// Cleared first, so no listener sees the old selection with the new rows.
		setEntry($selectedRows, name, undefined);
		setEntry($tableData, name, {
			status: "loaded",
			columns: columns,
			types: types,
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
	setEntry($selectedRows, name, undefined);
}

export async function closeClient(): Promise<void> {
	const closing: Client | null = client;

	client = null;
	sortNotice = null;

	await closing?.sql.close({ timeout: 0 }).catch(logError);
}
