import { type ReservedSQL, SQL, type TransactionSQL } from "bun";
import { type ConnectionConfig, type Driver, rowLimit } from "./config";
import { CONNECTION_TIMEOUT, LONG_TEXT_LENGTH } from "./consts";
import { logError } from "./log";
import {
	$notice,
	$queryResults,
	$querySql,
	$selectedRows,
	$sorts,
	$tableData,
	$tables,
	type ColumnEdit,
	type ColumnMeta,
	type EditorTarget,
	type LoadedTable,
	type QueryResult,
	type Sort,
	setEntry,
	type TableData,
	type TableMeta,
	type TextPosition,
	type TypeKind,
	type Value,
} from "./store";

interface TableRow {
	table_name: string;
	table_type: string;
}

type RelationKind = "table" | "view";

interface Relation {
	name: string;
	kind: RelationKind;
}

interface ColumnRow {
	column_name: string;
	data_type: string;
}

// Named as in the loaded TableData, which keeps them for a re-sort.
interface Columns {
	columns: string[];
	types: string[];
	kinds: TypeKind[];
	meta: TableMeta;
}

interface SchemaRow {
	name: string | null;
}

interface PostgresColumnRow {
	name: string;
	type_label: string;
	cast_type: string;
	type_name: string;
	type_kind: string;
	base_type: string;
	type_category: string;
	typmod: number;
	nullable: boolean;
	generated: boolean;
	key_position: number | null;
	foreign_key: boolean;
	enum_values: string | null;
	relation_kind: string;
}

interface MysqlColumnRow {
	name: string;
	data_type: string;
	column_type: string;
	max_length: number | bigint | string | null;
	is_nullable: string;
	generation_expression: string | null;
	key_position: number | bigint | string | null;
	foreign_key: number | bigint | string;
	table_type: string;
}

// The table metadata, the key position of each column and whether it's in a
// foreign key, which the dialects turn into a TableMeta the same way. A key
// column that isn't matchable is loaded in a form that can't be compared back,
// such as MySQL's hex.
interface DescribedColumn {
	meta: ColumnMeta;
	keyPosition: number | null;
	foreign: boolean;
	matchable: boolean;
}

export interface RowChange {
	column: string;
	value: Value;
}

// A loaded row, by its index into the rows array it was loaded in.
export type RowTarget = Pick<EditorTarget, "table" | "rows" | "row">;

// A row a write can match by its primary key.
interface MatchedRow {
	data: LoadedTable;
	// The value the loaded row has in a column.
	value: (name: string) => Value;
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
	// Reads what the row editor needs to know about a table's columns.
	describe: (sql: SQL, schema: string, name: string) => Promise<TableMeta>;
	// The kind of an information_schema data type, for a table describe
	// couldn't read.
	typeKind: (type: string) => TypeKind;
	// The kind of each column of a query's result. known holds the kinds read
	// before on this connection, by type.
	resultKinds: (
		sql: SQL,
		columns: SQL.ResultColumn[],
		known: Map<number, TypeKind>,
	) => Promise<TypeKind[]>;
	// Whether a result column holds raw bytes rather than text, shown as hex.
	resultHex: (column: SQL.ResultColumn) => boolean;
	// The placeholder for the nth parameter, which sets or matches a column.
	param: (index: number, column: ColumnMeta) => string;
	// Whether UPDATE and DELETE can return rows, or MySQL's count is read.
	returning: boolean;
	// The statements that empty quoted tables, restarting their numbering on
	// both. Postgres names them all in one, so the references between them
	// don't stop it, and MySQL truncates one at a time.
	truncate: (tables: string[]) => string[];
	// Runs statements that empty or drop every table on one connection, where
	// references between the tables don't stop them. References from outside
	// the schema still do, so nothing outside it changes.
	runAll: (sql: SQL, statements: string[]) => Promise<void>;
}

interface Client {
	sql: SQL;
	// The query tabs' own connection, so a transaction or a SET they start
	// lasts from one run to the next, and never reaches the table tabs'
	// connections. It connects on the first run.
	queries: SQL;
	dialect: Dialect;
	// Empty until the client connects.
	schema: string;
	// The kinds of the types query results have had, kept for later runs.
	typeKinds: Map<number, TypeKind>;
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

// Types loaded in a text form of their own, as hex, bits or WKT.
const MYSQL_TEXT_FORMS: ReadonlySet<string> = new Set<string>([
	...MYSQL_BINARY_TYPES,
	"bit",
	...MYSQL_SPATIAL_TYPES,
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

const NO_KEY: string =
	"The table has no primary key, so its rows can't be saved.";

const VIEW: string = "Views are read only.";

const GENERATED: string = "Generated by the database.";

const CLOSED: string = "The connection is closed.";

const ROW_NOT_FOUND: string =
	"The row wasn't found. It may have been changed or deleted, so reload the table.";

// The table's columns in order, with the primary key in key order. A table
// that can't be saved says why.
function makeTableMeta(
	described: DescribedColumn[],
	readOnly: string | null,
): TableMeta {
	const keys: DescribedColumn[] = described
		.filter((column: DescribedColumn): boolean => column.keyPosition !== null)
		.sort(
			(a: DescribedColumn, b: DescribedColumn): number =>
				(a.keyPosition ?? 0) - (b.keyPosition ?? 0),
		);
	const unmatchable: DescribedColumn | undefined = keys.find(
		(column: DescribedColumn): boolean => !column.matchable,
	);

	return {
		columns: new Map<string, ColumnMeta>(
			described.map((column: DescribedColumn): [string, ColumnMeta] => [
				column.meta.name,
				column.meta,
			]),
		),
		primaryKey: keys.map((column: DescribedColumn): string => column.meta.name),
		foreignKeys: described
			.filter((column: DescribedColumn): boolean => column.foreign)
			.map((column: DescribedColumn): string => column.meta.name),
		readOnly:
			readOnly ??
			(!keys.length
				? NO_KEY
				: unmatchable
					? `The primary key ${unmatchable.meta.name} can't be matched yet, so rows can't be saved.`
					: null),
	};
}

function postgresEdit(row: PostgresColumnRow): ColumnEdit {
	if (row.generated) {
		return { as: "readonly", reason: GENERATED };
	}

	if (row.type_name === "bool") {
		return { as: "choice", options: ["true", "false"], labels: [] };
	}

	if (row.type_kind === "e") {
		return {
			as: "choice",
			options: JSON.parse(row.enum_values ?? "[]"),
			labels: [],
		};
	}

	if (row.type_name === "json" || row.type_name === "jsonb") {
		return { as: "json" };
	}

	// A varchar's typmod is its length plus 4, or -1 without one.
	const long: boolean =
		row.type_name === "text" ||
		row.type_name === "xml" ||
		(row.type_name === "varchar" &&
			(row.typmod < 0 || row.typmod - 4 > LONG_TEXT_LENGTH));

	return { as: "text", long: long };
}

// Types whose category holds several kinds, named as format_type and
// information_schema name them. The rest are only for a table describe
// couldn't read, since the category tells them apart.
const POSTGRES_TYPE_KINDS: ReadonlyMap<string, TypeKind> = new Map<
	string,
	TypeKind
>([
	["smallint", "integer"],
	["integer", "integer"],
	["bigint", "integer"],
	["oid", "integer"],
	["numeric", "decimal"],
	["real", "decimal"],
	["double precision", "decimal"],
	["money", "decimal"],
	["date", "date"],
	["time without time zone", "time"],
	["time with time zone", "time"],
	["timestamp without time zone", "timestamp"],
	["timestamp with time zone", "timestamp"],
	["json", "json"],
	["jsonb", "json"],
	["uuid", "uuid"],
	["xml", "xml"],
	["bytea", "binary"],
	["geometry", "spatial"],
	["geography", "spatial"],
	["macaddr", "network"],
	["macaddr8", "network"],
	["character varying", "text"],
	["character", "text"],
	["text", "text"],
	["name", "text"],
	// Its category is internal, and format_type quotes its name.
	['"char"', "text"],
	["boolean", "boolean"],
	["interval", "interval"],
	["bit", "binary"],
	["bit varying", "binary"],
	["inet", "network"],
	["cidr", "network"],
	["point", "spatial"],
	["line", "spatial"],
	["lseg", "spatial"],
	["box", "spatial"],
	["path", "spatial"],
	["polygon", "spatial"],
	["circle", "spatial"],
	["ARRAY", "array"],
]);

// pg_type's typcategory, so a domain, a user defined enum or an array is
// named by the type it holds.
const POSTGRES_CATEGORY_KINDS: ReadonlyMap<string, TypeKind> = new Map<
	string,
	TypeKind
>([
	["A", "array"],
	["B", "boolean"],
	["E", "enum"],
	["G", "spatial"],
	["I", "network"],
	["S", "text"],
	["T", "interval"],
	["V", "binary"],
]);

function postgresKind(type: string, category: string): TypeKind {
	return (
		POSTGRES_TYPE_KINDS.get(type) ??
		POSTGRES_CATEGORY_KINDS.get(category) ??
		"other"
	);
}

// pg_catalog rather than information_schema, for the exact types, enum labels,
// generated columns and the key order. Names and "char" columns are cast to
// text, so they arrive as strings. A type without its length is unlimited,
// except character and bit, which mean char(1) and bit(1), so those are cast
// to bpchar and varbit. A domain's kind is its base type's.
async function describePostgres(
	sql: SQL,
	schema: string,
	name: string,
): Promise<TableMeta> {
	const rows: PostgresColumnRow[] = await sql`
		SELECT
			a.attname::text AS name,
			format_type(a.atttypid, a.atttypmod) AS type_label,
			CASE t.typname
				WHEN 'bpchar' THEN 'bpchar'
				WHEN '_bpchar' THEN 'bpchar[]'
				WHEN 'bit' THEN 'varbit'
				WHEN '_bit' THEN 'varbit[]'
				ELSE format_type(a.atttypid, NULL)
			END AS cast_type,
			t.typname::text AS type_name,
			t.typtype::text AS type_kind,
			format_type(b.oid, NULL) AS base_type,
			b.typcategory::text AS type_category,
			a.atttypmod AS typmod,
			NOT a.attnotnull AS nullable,
			(a.attgenerated <> '' OR a.attidentity = 'a') AS generated,
			array_position(i.indkey::int2[], a.attnum) AS key_position,
			EXISTS (
				SELECT 1
				FROM pg_catalog.pg_constraint f
				WHERE f.conrelid = c.oid AND f.contype = 'f'
					AND a.attnum = ANY (f.conkey)
			) AS foreign_key,
			CASE WHEN t.typtype = 'e' THEN (
				SELECT json_agg(e.enumlabel ORDER BY e.enumsortorder)::text
				FROM pg_catalog.pg_enum e
				WHERE e.enumtypid = t.oid
			) END AS enum_values,
			c.relkind::text AS relation_kind
		FROM pg_catalog.pg_attribute a
		JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
		JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
		JOIN pg_catalog.pg_type t ON t.oid = a.atttypid
		JOIN pg_catalog.pg_type b
			ON b.oid = CASE WHEN t.typtype = 'd' THEN t.typbasetype ELSE t.oid END
		LEFT JOIN pg_catalog.pg_index i
			ON i.indrelid = c.oid AND i.indisprimary
		WHERE n.nspname = ${schema} AND c.relname = ${name}
			AND a.attnum > 0 AND NOT a.attisdropped
		ORDER BY a.attnum
	`;
	const kind: string = rows[0]?.relation_kind ?? "";

	return makeTableMeta(
		rows.map(
			(row: PostgresColumnRow): DescribedColumn => ({
				meta: {
					name: row.name,
					typeLabel: row.type_label,
					castType: row.cast_type,
					nullable: row.nullable,
					edit: postgresEdit(row),
					kind: postgresKind(row.base_type, row.type_category),
				},
				keyPosition: row.key_position,
				foreign: row.foreign_key,
				matchable: true,
			}),
		),
		kind === "r" || kind === "p"
			? null
			: kind === "f"
				? "Foreign tables are read only."
				: VIEW,
	);
}

interface PostgresTypeRow {
	oid: number;
	base_type: string;
	type_category: string;
}

// The result names its columns' types by OID, which are read from the catalog
// to name them as describe does, with a domain as its base type. An OID names
// one type for as long as it exists, so each is read once.
async function postgresResultKinds(
	sql: SQL,
	columns: SQL.ResultColumn[],
	known: Map<number, TypeKind>,
): Promise<TypeKind[]> {
	const oids: number[] = [
		...new Set<number>(
			columns
				.map((column: SQL.ResultColumn): number => column.type)
				.filter((oid: number): boolean => !known.has(oid)),
		),
	];
	const rows: PostgresTypeRow[] = oids.length
		? await sql`
				SELECT
					t.oid::int AS oid,
					format_type(b.oid, NULL) AS base_type,
					b.typcategory::text AS type_category
				FROM pg_catalog.pg_type t
				JOIN pg_catalog.pg_type b
					ON b.oid = CASE WHEN t.typtype = 'd' THEN t.typbasetype ELSE t.oid END
				WHERE t.oid = ANY (${`{${oids.join(",")}}`}::oid[])
			`
		: [];
	for (const row of rows) {
		known.set(row.oid, postgresKind(row.base_type, row.type_category));
	}

	return columns.map(
		(column: SQL.ResultColumn): TypeKind => known.get(column.type) ?? "other",
	);
}

// MySQL's enum labels are quoted in column_type, with quotes doubled.
function mysqlEnumOptions(columnType: string): string[] {
	return [...columnType.matchAll(/'((?:[^']|'')*)'/g)].map(
		(match: RegExpMatchArray): string => (match[1] ?? "").replaceAll("''", "'"),
	);
}

// Named as data_type names them. Binary and spatial types have their own sets.
const MYSQL_TYPE_KINDS: ReadonlyMap<string, TypeKind> = new Map<
	string,
	TypeKind
>([
	["char", "text"],
	["varchar", "text"],
	["tinytext", "text"],
	["text", "text"],
	["mediumtext", "text"],
	["longtext", "text"],
	["tinyint", "integer"],
	["smallint", "integer"],
	["mediumint", "integer"],
	["int", "integer"],
	["bigint", "integer"],
	["decimal", "decimal"],
	["float", "decimal"],
	["double", "decimal"],
	["date", "date"],
	["year", "date"],
	["time", "time"],
	["datetime", "timestamp"],
	["timestamp", "timestamp"],
	["json", "json"],
	["enum", "enum"],
	["set", "enum"],
	["bit", "binary"],
]);

// MySQL has no boolean type, and its BOOLEAN is a tinyint(1), which only
// column_type shows.
function mysqlKind(type: string, columnType: string): TypeKind {
	const lower: string = type.toLowerCase();

	if (columnType.toLowerCase().startsWith("tinyint(1)")) {
		return "boolean";
	}

	if (MYSQL_BINARY_TYPES.has(lower)) {
		return "binary";
	}

	if (MYSQL_SPATIAL_TYPES.has(lower)) {
		return "spatial";
	}

	return MYSQL_TYPE_KINDS.get(lower) ?? "other";
}

const MYSQL_TINY: number = 1;

const MYSQL_BIT: number = 16;

const MYSQL_GEOMETRY: number = 255;

// The protocol's type codes. Strings and blobs share codes with their binary
// forms, and the binary flag is set for a _bin collation's text too, so they
// are all text, and enums and sets are strings with a flag of their own.
const MYSQL_PROTOCOL_KINDS: ReadonlyMap<number, TypeKind> = new Map<
	number,
	TypeKind
>([
	[0, "decimal"],
	[MYSQL_TINY, "integer"],
	[2, "integer"],
	[3, "integer"],
	[4, "decimal"],
	[5, "decimal"],
	[7, "timestamp"],
	[8, "integer"],
	[9, "integer"],
	[10, "date"],
	[11, "time"],
	[12, "timestamp"],
	[13, "date"],
	[14, "date"],
	[MYSQL_BIT, "binary"],
	[245, "json"],
	[246, "decimal"],
	[247, "enum"],
	[248, "enum"],
	[MYSQL_GEOMETRY, "spatial"],
]);

const MYSQL_STRING_TYPES: ReadonlySet<number> = new Set<number>([
	15, 249, 250, 251, 252, 253, 254,
]);

const MYSQL_ENUM_FLAGS: number = 256 | 2048;

// A tinyint(1) is MySQL's boolean, as in mysqlKind.
function mysqlResultKind(column: SQL.ResultColumn): TypeKind {
	if (column.type === MYSQL_TINY && column.length === 1) {
		return "boolean";
	}

	if (MYSQL_STRING_TYPES.has(column.type)) {
		return (column.flags ?? 0) & MYSQL_ENUM_FLAGS ? "enum" : "text";
	}

	return MYSQL_PROTOCOL_KINDS.get(column.type) ?? "other";
}

function mysqlEdit(row: MysqlColumnRow): ColumnEdit {
	const type: string = row.data_type.toLowerCase();

	// DEFAULT_GENERATED in extra only means a default like CURRENT_TIMESTAMP,
	// so a generated column is told by its expression.
	if (row.generation_expression) {
		return { as: "readonly", reason: GENERATED };
	}

	if (MYSQL_BINARY_TYPES.has(type)) {
		return {
			as: "readonly",
			reason: "Shown as hex. Editing binary values isn't supported yet.",
		};
	}

	if (type === "bit") {
		return {
			as: "readonly",
			reason: "Shown in binary. Editing bit values isn't supported yet.",
		};
	}

	if (MYSQL_SPATIAL_TYPES.has(type)) {
		return {
			as: "readonly",
			reason: "Shown as text. Editing spatial values isn't supported yet.",
		};
	}

	if (type === "enum") {
		return {
			as: "choice",
			options: mysqlEnumOptions(row.column_type),
			labels: [],
		};
	}

	if (row.column_type.toLowerCase().startsWith("tinyint(1)")) {
		return { as: "choice", options: ["1", "0"], labels: ["true", "false"] };
	}

	if (type === "json") {
		return { as: "json" };
	}

	const long: boolean =
		type.endsWith("text") || Number(row.max_length ?? 0) > LONG_TEXT_LENGTH;

	return { as: "text", long: long };
}

// The key comes from the PRIMARY index, since column_key says PRI for a
// unique key too when there is no primary key. The foreign keys are matched by
// the schema and table given, rather than the outer row's, so MySQL reads
// key_column_usage for this table alone.
async function describeMysql(
	sql: SQL,
	schema: string,
	name: string,
): Promise<TableMeta> {
	const rows: MysqlColumnRow[] = await sql`
		SELECT
			c.column_name AS name,
			c.data_type AS data_type,
			c.column_type AS column_type,
			c.character_maximum_length AS max_length,
			c.is_nullable AS is_nullable,
			c.generation_expression AS generation_expression,
			s.seq_in_index AS key_position,
			EXISTS (
				SELECT 1
				FROM information_schema.key_column_usage k
				WHERE k.table_schema = ${schema}
					AND k.table_name = ${name}
					AND k.column_name = c.column_name
					AND k.referenced_table_name IS NOT NULL
			) AS foreign_key,
			t.table_type AS table_type
		FROM information_schema.columns c
		JOIN information_schema.tables t
			ON t.table_schema = c.table_schema AND t.table_name = c.table_name
		LEFT JOIN information_schema.statistics s
			ON s.table_schema = c.table_schema
			AND s.table_name = c.table_name
			AND s.column_name = c.column_name
			AND s.index_name = 'PRIMARY'
		WHERE c.table_schema = ${schema} AND c.table_name = ${name}
		ORDER BY c.ordinal_position
	`;
	const type: string = rows[0]?.table_type ?? "";

	return makeTableMeta(
		rows.map(
			(row: MysqlColumnRow): DescribedColumn => ({
				meta: {
					name: row.name,
					typeLabel: row.column_type,
					castType: row.data_type,
					nullable: row.is_nullable === "YES",
					edit: mysqlEdit(row),
					kind: mysqlKind(row.data_type, row.column_type),
				},
				keyPosition:
					row.key_position === null ? null : Number(row.key_position),
				foreign: Number(row.foreign_key) === 1,
				// Binary, bit and spatial values are loaded as text the column
				// can't be compared with.
				matchable: !MYSQL_TEXT_FORMS.has(row.data_type.toLowerCase()),
			}),
		),
		type === "BASE TABLE" || type === "SYSTEM VERSIONED" ? null : VIEW,
	);
}

// A table quoted with its schema.
function qualified(dialect: Dialect, schema: string, name: string): string {
	return `${dialect.quote(schema)}.${dialect.quote(name)}`;
}

// Quoted by hand, since sql() splits identifiers on dots and a table name
// can contain one.
function quoteWith(mark: string): (name: string) => string {
	return (name: string): string =>
		`${mark}${name.replaceAll(mark, mark + mark)}${mark}`;
}

// Postgres runs them in one transaction, so a failure leaves every table.
async function runAllPostgres(sql: SQL, statements: string[]): Promise<void> {
	await sql.begin(async (transaction: TransactionSQL): Promise<void> => {
		for (const statement of statements) {
			await transaction.unsafe(statement);
		}
	});
}

// MySQL commits each TRUNCATE and DROP by itself, and can't truncate a table
// another references, so the foreign key checks are turned off on one
// reserved connection instead. A connection whose checks can't be turned back
// on is closed rather than returned to the pool.
async function runAllMysql(sql: SQL, statements: string[]): Promise<void> {
	const reserved: ReservedSQL = await sql.reserve();

	try {
		await reserved.unsafe("SET FOREIGN_KEY_CHECKS = 0");

		for (const statement of statements) {
			await reserved.unsafe(statement);
		}
	} finally {
		try {
			await reserved.unsafe("SET FOREIGN_KEY_CHECKS = 1");
			reserved.release();
		} catch (error) {
			logError(error);
			await reserved.close({ timeout: 0 }).catch(logError);
		}
	}
}

const DIALECTS: Record<Driver, Dialect> = {
	postgres: {
		quote: quoteWith('"'),
		asText: (column: string): string => `${column}::text`,
		schema: "'public'",
		describe: describePostgres,
		typeKind: (type: string): TypeKind => postgresKind(type, ""),
		resultKinds: postgresResultKinds,
		// bytea's text is already hex.
		resultHex: (): boolean => false,
		// Values are text, so they're read as the column's type. A parameter
		// typed as text wouldn't assign to most columns.
		param: (index: number, column: ColumnMeta): string =>
			`CAST($${index}::text AS ${column.castType})`,
		returning: true,
		truncate: (tables: string[]): string[] => [
			`TRUNCATE TABLE ${tables.join(", ")} RESTART IDENTITY`,
		],
		runAll: runAllPostgres,
	},
	mysql: {
		quote: quoteWith("`"),
		asText: mysqlAsText,
		schema: "DATABASE()",
		describe: describeMysql,
		typeKind: (type: string): TypeKind => mysqlKind(type, ""),
		resultKinds: async (
			_sql: SQL,
			columns: SQL.ResultColumn[],
		): Promise<TypeKind[]> => columns.map(mysqlResultKind),
		// Bits and spatial values, which tables show in binary and as WKT.
		resultHex: (column: SQL.ResultColumn): boolean =>
			column.type === MYSQL_BIT || column.type === MYSQL_GEOMETRY,
		param: (_index: number, column: ColumnMeta): string =>
			column.edit.as === "json" ? "CAST(? AS JSON)" : "?",
		returning: false,
		truncate: (tables: string[]): string[] =>
			tables.map((table: string): string => `TRUNCATE TABLE ${table}`),
		runAll: runAllMysql,
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

// Each table's latest load. A load whose token was replaced or removed drops
// its result, such as one that started before the table was truncated.
const loads: Map<string, object> = new Map<string, object>();

// Each query tab's run, the same way.
const runs: Map<string, object> = new Map<string, object>();

export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

// The drivers are named as Bun's adapters.
function makeClient(connection: ConnectionConfig, max: number): SQL {
	const options: Bun.SQL.PostgresOrMySQLOptions = {
		adapter: connection.driver,
		max: max,
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

// The columns are aliased, since MySQL names them in capitals. The row
// editor's metadata is read alongside, and a table whose metadata can't be read
// still loads, with rows that can't be edited.
async function listColumns(
	sql: SQL,
	dialect: Dialect,
	schema: string,
	name: string,
): Promise<Columns> {
	const [rows, meta]: [ColumnRow[], TableMeta] = await Promise.all([
		sql`
				SELECT column_name AS column_name, data_type AS data_type
				FROM information_schema.columns
				WHERE table_schema = ${schema} AND table_name = ${name}
				ORDER BY ordinal_position
			` as Promise<ColumnRow[]>,
		dialect.describe(sql, schema, name).catch((error: unknown): TableMeta => {
			logError(error);

			return {
				columns: new Map<string, ColumnMeta>(),
				primaryKey: [],
				foreignKeys: [],
				readOnly: `Could not read the table's columns, so its rows can't be edited: ${errorMessage(error)}`,
			};
		}),
	]);

	return {
		columns: rows.map((row: ColumnRow): string => row.column_name),
		types: rows.map((row: ColumnRow): string => row.data_type),
		kinds: rows.map(
			(row: ColumnRow): TypeKind =>
				meta.columns.get(row.column_name)?.kind ??
				dialect.typeKind(row.data_type),
		),
		meta: meta,
	};
}

// Each value is cast to text, so the database formats it with its type's own
// output, such as a date without a time or a timestamp in the session's time
// zone.
function selectList(
	dialect: Dialect,
	columns: string[],
	types: string[],
): string {
	return columns
		.map((column: string, index: number): string =>
			dialect.asText(dialect.quote(column), types[index] ?? ""),
		)
		.join(", ");
}

function toRelation(row: TableRow): Relation {
	return {
		name: row.table_name,
		kind: row.table_type === "VIEW" ? "view" : "table",
	};
}

// The tables and views the sidebar lists. The types are aliased too, since
// MySQL names the columns in capitals.
async function listRelations(sql: SQL, schema: string): Promise<Relation[]> {
	const rows: TableRow[] = await sql`
		SELECT table_name AS table_name, table_type AS table_type
		FROM information_schema.tables
		WHERE table_schema = ${schema}
			AND table_type IN ('BASE TABLE', 'VIEW')
		ORDER BY table_name
	`;

	return rows.map(toRelation);
}

async function listTables(sql: SQL, schema: string): Promise<string[]> {
	return (await listRelations(sql, schema)).map(
		(relation: Relation): string => relation.name,
	);
}

// Opens a client and lists its tables. Throws if it can't connect, and
// resolves to null if the client was closed while connecting.
export async function openClient(
	connection: ConnectionConfig,
): Promise<OpenedClient | null> {
	const sql: SQL = makeClient(connection, 4);
	const dialect: Dialect = DIALECTS[connection.driver];
	const opening: Client = {
		sql: sql,
		queries: makeClient(connection, 1),
		dialect: dialect,
		schema: "",
		typeKinds: new Map<number, TypeKind>(),
	};
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

		await closeSql(opening);

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
	const { quote }: Dialect = dialect;
	const sort: Sort | undefined = $sorts.get()[name];
	const previous: TableData | undefined = $tableData.get()[name];
	const token: object = {};
	// A newer load, such as for a new sort, closing the table or the client
	// replaces or removes the token, so this load's result is dropped.
	const isCurrent: () => boolean = (): boolean => loads.get(name) === token;

	loads.set(name, token);

	clearSortNotice(name);

	// A new sort keeps showing the old rows until the sorted ones arrive.
	if (previous?.status !== "loaded") {
		setEntry($tableData, name, { status: "loading" });
	}

	try {
		// Read on every load, so the columns and keys follow schema changes.
		const { columns, types, kinds, meta }: Columns = await listColumns(
			sql,
			dialect,
			schema,
			name,
		);
		const values: string = selectList(dialect, columns, types);
		const table: string = qualified(dialect, schema, name);
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
			kinds: kinds,
			rows: rows.slice(0, rowLimit),
			truncated: rows.length > rowLimit,
			sort: sort ?? null,
			meta: meta,
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

// Places a value that sets or matches a column, as the next parameter. Every
// column it's called with is checked to be described first.
function assign(
	dialect: Dialect,
	meta: TableMeta,
	params: Value[],
	name: string,
	value: Value,
): string {
	params.push(value);

	return `${dialect.quote(name)} = ${dialect.param(params.length, meta.columns.get(name) as ColumnMeta)}`;
}

// Matches a row by the values its primary key has.
function matchKey(
	dialect: Dialect,
	meta: TableMeta,
	params: Value[],
	value: (name: string) => Value,
): string {
	return meta.primaryKey
		.map((key: string): string =>
			assign(dialect, meta, params, key, value(key)),
		)
		.join(" AND ");
}

// The loaded row a write matches by its primary key, or why it can't.
function matchRow(target: RowTarget): MatchedRow | string {
	const data: TableData | undefined = $tableData.get()[target.table];

	if (data?.status !== "loaded" || data.rows !== target.rows) {
		return "The table was reloaded. Open the row again to edit it.";
	}

	if (data.meta.readOnly !== null) {
		return data.meta.readOnly;
	}

	const { columns, primaryKey }: TableMeta = data.meta;
	const original: Value[] | undefined = data.rows[target.row];

	if (
		!original ||
		!primaryKey.every((key: string): boolean => columns.has(key))
	) {
		return "The row can't be matched by its primary key.";
	}

	return {
		data: data,
		value: (name: string): Value =>
			original[data.columns.indexOf(name)] ?? null,
	};
}

// Saves the changed values of a loaded row, matched by its primary key, and
// puts the row the database stored in place of the loaded one, so triggers and
// the database's own formatting show. Resolves to an error message, or null.
export async function updateRow(
	target: EditorTarget,
	changes: RowChange[],
): Promise<string | null> {
	const current: Client | null = client;

	if (!current) {
		return CLOSED;
	}

	const matched: MatchedRow | string = matchRow(target);

	if (typeof matched === "string") {
		return matched;
	}

	const { data, value: oldValue }: MatchedRow = matched;
	const { sql, dialect, schema }: Client = current;
	const { meta }: LoadedTable = data;
	const params: Value[] = [];

	if (
		!changes.every((change: RowChange): boolean =>
			meta.columns.has(change.column),
		)
	) {
		return "The row can't be matched by its primary key.";
	}

	const newValue: (name: string) => Value = (name: string): Value => {
		const change: RowChange | undefined = changes.find(
			(candidate: RowChange): boolean => candidate.column === name,
		);

		return change ? change.value : oldValue(name);
	};
	const table: string = qualified(dialect, schema, target.table);
	const set: string = changes
		.map((change: RowChange): string =>
			assign(dialect, meta, params, change.column, change.value),
		)
		.join(", ");
	const where: string = matchKey(dialect, meta, params, oldValue);
	const values: string = selectList(dialect, data.columns, data.types);
	let updated: Value[] | undefined;

	try {
		if (dialect.returning) {
			const rows: Value[][] = await (sql
				.unsafe(
					`UPDATE ${table} SET ${set} WHERE ${where} RETURNING ${values}`,
					params,
				)
				.values() as Promise<Value[][]>);

			updated = rows[0];
		} else {
			// MySQL counts the rows that changed rather than the ones that
			// matched, so the row is selected again by its new key to tell it was
			// found.
			await sql.unsafe(
				`UPDATE ${table} SET ${set} WHERE ${where} LIMIT 1`,
				params,
			);

			params.length = 0;

			const key: string = matchKey(dialect, meta, params, newValue);
			const rows: Value[][] = await (sql
				.unsafe(`SELECT ${values} FROM ${table} WHERE ${key}`, params)
				.values() as Promise<Value[][]>);

			updated = rows[0];
		}
	} catch (error) {
		logError(error);

		return errorMessage(error);
	}

	if (!updated) {
		return ROW_NOT_FOUND;
	}

	const latest: TableData | undefined = $tableData.get()[target.table];

	// Rows that were reloaded meanwhile already show the saved values.
	if (client === current && latest === data) {
		const rows: Value[][] = data.rows.slice();

		rows[target.row] = updated;

		setEntry($tableData, target.table, {
			...data,
			rows: rows,
		});
	}

	return null;
}

// Deletes a loaded row, matched by its primary key, and takes it out of the
// loaded rows, which clears the table's selection. Resolves to an error
// message, or null.
export async function deleteRow(target: RowTarget): Promise<string | null> {
	const current: Client | null = client;

	if (!current) {
		return CLOSED;
	}

	const matched: MatchedRow | string = matchRow(target);

	if (typeof matched === "string") {
		return matched;
	}

	const { data, value }: MatchedRow = matched;
	const { sql, dialect, schema }: Client = current;
	const params: Value[] = [];
	const table: string = qualified(dialect, schema, target.table);
	const where: string = matchKey(dialect, data.meta, params, value);
	let deleted: number;

	try {
		if (dialect.returning) {
			const rows: Value[][] = await (sql
				.unsafe(`DELETE FROM ${table} WHERE ${where} RETURNING 1`, params)
				.values() as Promise<Value[][]>);

			deleted = rows.length;
		} else {
			const result: { affectedRows?: number | bigint } = await sql.unsafe(
				`DELETE FROM ${table} WHERE ${where} LIMIT 1`,
				params,
			);

			deleted = Number(result.affectedRows ?? 0);
		}
	} catch (error) {
		logError(error);

		return errorMessage(error);
	}

	if (!deleted) {
		return ROW_NOT_FOUND;
	}

	// Rows that were reloaded meanwhile already leave it out.
	if (client === current && $tableData.get()[target.table] === data) {
		setEntry($selectedRows, target.table, undefined);
		setEntry($tableData, target.table, {
			...data,
			rows: data.rows.filter(
				(_row: Value[], index: number): boolean => index !== target.row,
			),
		});
	}

	return null;
}

// One statement's result, each value as raw bytes or null.
type RawResult = (Buffer | null)[][] & SQL.ResultMetadata;

// Statements that only read. MySQL doesn't name its statements, so there a
// statement that returns no columns counts as a write.
const READ_COMMANDS: ReadonlySet<string> = new Set<string>([
	"SELECT",
	"SHOW",
	"EXPLAIN",
	"VALUES",
	"FETCH",
]);

// Statements whose count is the rows they wrote. MySQL doesn't name its
// statements, so there a count is only shown when it's above 0, since DDL
// counts 0.
const COUNTED_COMMANDS: ReadonlySet<string> = new Set<string>([
	"INSERT",
	"UPDATE",
	"DELETE",
	"MERGE",
	"COPY",
]);

const UTF8: TextDecoder = new TextDecoder("utf-8", { fatal: true });

// A value as the database's text, or as hex when it is raw bytes that aren't
// text, such as a MySQL blob.
function rawText(value: Buffer | null, hex: boolean): Value {
	if (value === null) {
		return null;
	}

	if (!hex) {
		try {
			return UTF8.decode(value);
		} catch {
			// Not text, so shown as hex below.
		}
	}

	return `0x${value.toString("hex").toUpperCase()}`;
}

function hasColumns(result: RawResult): boolean {
	return Boolean(result.columns?.length);
}

function wrote(result: RawResult): boolean {
	return result.command === null
		? !hasColumns(result)
		: !READ_COMMANDS.has(result.command);
}

// Postgres gives where an error is as a character offset from 1.
function errorPosition(error: unknown, text: string): TextPosition | null {
	const position: number = Number(
		error instanceof Error && "position" in error ? error.position : NaN,
	);

	if (!Number.isInteger(position) || position < 1) {
		return null;
	}

	const before: string[] = Array.from(text)
		.slice(0, position - 1)
		.join("")
		.split("\n");

	return {
		line: before.length,
		column: Array.from(before.at(-1) ?? "").length + 1,
	};
}

// What a run shows: the last statement that returned columns, or else the
// last statement, with the rows every statement wrote.
async function showResult(
	{ sql, dialect, typeKinds }: Client,
	results: RawResult[],
	ms: number,
): Promise<QueryResult> {
	const last: RawResult | undefined = results.at(-1);
	const shown: RawResult | undefined = results.findLast(hasColumns) ?? last;
	const columns: SQL.ResultColumn[] = shown?.columns ?? [];

	if (!shown || !columns.length) {
		const command: string | null = last?.command ?? null;
		const affected: number = results.reduce(
			(total: number, result: RawResult): number => total + result.affectedRows,
			0,
		);
		const counted: boolean =
			command === null ? affected > 0 : COUNTED_COMMANDS.has(command);

		return {
			status: "done",
			command: command,
			affected: counted ? affected : null,
			ms: ms,
		};
	}

	const hex: boolean[] = columns.map(dialect.resultHex);
	const kinds: TypeKind[] = await dialect
		.resultKinds(sql, columns, typeKinds)
		.catch((error: unknown): TypeKind[] => {
			logError(error);

			return columns.map((): TypeKind => "other");
		});

	return {
		status: "rows",
		columns: columns.map((column: SQL.ResultColumn): string => column.name),
		kinds: kinds,
		rows: shown
			.slice(0, rowLimit)
			.map((row: (Buffer | null)[]): Value[] =>
				row.map(
					(value: Buffer | null, index: number): Value =>
						rawText(value, hex[index] ?? false),
				),
			),
		total: shown.length,
		ms: ms,
	};
}

// What a run may have changed. One whose statements all returned rows only
// read, short of a SELECT whose CTE writes, which Postgres tags as SELECT. One
// with a statement that returned none, such as CREATE TABLE AS, which is
// tagged SELECT too, may have made or dropped a table, so the tables are
// listed again. One that wrote loads the open tables again too.
export type RunOutcome = "skipped" | "read" | "ran" | "wrote";

// Runs a query tab's SQL as it is, which may hold several statements, on the
// query tabs' own connection, and keeps the result in $queryResults while the
// tab and the connection stay open. The SQL is the user's own, so its errors are
// shown rather than logged.
export async function runQuery(id: string, text: string): Promise<RunOutcome> {
	const current: Client | null = client;
	const token: object = {};
	const isCurrent: () => boolean = (): boolean =>
		client === current && runs.get(id) === token;
	const setResult: (result: QueryResult) => void = (
		result: QueryResult,
	): void => {
		if (id in $queryResults.get() && isCurrent()) {
			setEntry($queryResults, id, result);
		}
	};

	if (!current || $queryResults.get()[id]?.status === "running") {
		return "skipped";
	}

	runs.set(id, token);
	setResult({ status: "running" });

	const started: number = performance.now();
	let result: QueryResult;
	// A failed run may have made a table with an earlier statement.
	let outcome: RunOutcome = "ran";

	try {
		// Simple queries take several statements, and send every value as text.
		const raw: RawResult | RawResult[] = await current.queries
			.unsafe(text)
			.simple()
			.raw();
		// Several statements resolve to a result each.
		const results: RawResult[] = "columns" in raw ? [raw] : raw;

		outcome = results.some(wrote)
			? "wrote"
			: results.every(hasColumns)
				? "read"
				: "ran";
		result = await showResult(
			current,
			results,
			Math.round(performance.now() - started),
		);
	} catch (error) {
		result = {
			status: "error",
			message: errorMessage(error),
			at: errorPosition(error, text),
			sql: text,
		};
	}

	setResult(result);

	if (isCurrent()) {
		runs.delete(id);
	}

	return client === current ? outcome : "skipped";
}

// Runs a statement, or statements with runAll, on the open client. Resolves
// to an error message, or null.
async function run(
	statement: (current: Client) => Promise<unknown>,
): Promise<string | null> {
	const current: Client | null = client;

	if (!current) {
		return CLOSED;
	}

	try {
		await statement(current);
	} catch (error) {
		logError(error);

		return errorMessage(error);
	}

	return null;
}

// Looks the relation up again, since the sidebar's list doesn't say which are
// views, and it may have changed since.
async function findRelation(
	{ sql, schema }: Client,
	name: string,
): Promise<Relation> {
	const relation: Relation | undefined = (
		await listRelations(sql, schema)
	).find((candidate: Relation): boolean => candidate.name === name);

	if (!relation) {
		throw new Error(`${name} no longer exists.`);
	}

	return relation;
}

// Takes dropped relations out of the sidebar's list.
function leaveOut(current: Client, names: string[]): void {
	if (client === current) {
		$tables.set(
			$tables.get().filter((table: string): boolean => !names.includes(table)),
		);
	}
}

// Empties a table. A table others reference fails, rather than emptying them
// too.
export function truncateTable(name: string): Promise<string | null> {
	return run(async (current: Client): Promise<void> => {
		const { sql, dialect, schema }: Client = current;
		const relation: Relation = await findRelation(current, name);

		if (relation.kind === "view") {
			throw new Error("Views can't be truncated.");
		}

		for (const statement of dialect.truncate([
			qualified(dialect, schema, name),
		])) {
			await sql.unsafe(statement);
		}
	});
}

// Drops a table or a view. One that others depend on fails, rather than
// dropping their references too.
export function dropTable(name: string): Promise<string | null> {
	return run(async (current: Client): Promise<void> => {
		const { sql, dialect, schema }: Client = current;
		const relation: Relation = await findRelation(current, name);

		await sql.unsafe(
			`DROP ${relation.kind === "view" ? "VIEW" : "TABLE"} ${qualified(dialect, schema, name)}`,
		);

		leaveOut(current, [name]);
	});
}

// The relations of a kind, quoted with the schema.
function qualifiedOfKind(
	{ dialect, schema }: Client,
	relations: Relation[],
	kind: RelationKind,
): string[] {
	return relations
		.filter((relation: Relation): boolean => relation.kind === kind)
		.map((relation: Relation): string =>
			qualified(dialect, schema, relation.name),
		);
}

// Empties every table in the schema.
export function truncateAll(): Promise<string | null> {
	return run(async (current: Client): Promise<void> => {
		const { sql, dialect, schema }: Client = current;
		const tables: string[] = qualifiedOfKind(
			current,
			await listRelations(sql, schema),
			"table",
		);

		if (tables.length) {
			await dialect.runAll(sql, dialect.truncate(tables));
		}
	});
}

// Drops every table and view in the schema, the views first, each kind in one
// statement so the references between them don't stop it. MySQL commits each
// drop by itself, so after a failure the tables are listed again.
export async function dropAll(): Promise<string | null> {
	const error: string | null = await run(
		async (current: Client): Promise<void> => {
			const { sql, dialect, schema }: Client = current;
			const relations: Relation[] = await listRelations(sql, schema);
			const views: string[] = qualifiedOfKind(current, relations, "view");
			const tables: string[] = qualifiedOfKind(current, relations, "table");

			await dialect.runAll(sql, [
				...(views.length ? [`DROP VIEW ${views.join(", ")}`] : []),
				...(tables.length ? [`DROP TABLE ${tables.join(", ")}`] : []),
			]);

			leaveOut(
				current,
				relations.map((relation: Relation): string => relation.name),
			);
		},
	);

	if (error) {
		await refreshTables();
	}

	return error;
}

export async function refreshTables(): Promise<void> {
	const current: Client | null = client;

	if (!current) {
		return;
	}

	try {
		const tables: string[] = await listTables(current.sql, current.schema);
		// Query runs list the tables, which mostly haven't changed.
		if (client === current && !Bun.deepEquals(tables, $tables.get())) {
			$tables.set(tables);
		}
	} catch (error) {
		logError(error);
	}
}

// Drops a table's rows and any load of them, so it loads again when shown.
export function discardRows(name: string): void {
	loads.delete(name);
	setEntry($tableData, name, undefined);
	setEntry($selectedRows, name, undefined);
}

export function forgetTable(name: string): void {
	discardRows(name);
	setEntry($sorts, name, undefined);
}

export function forgetQuery(id: string): void {
	runs.delete(id);
	setEntry($querySql, id, undefined);
	setEntry($queryResults, id, undefined);
}

// Closing the query tabs' connection ends any transaction they left open,
// which the database rolls back.
async function closeSql({ sql, queries }: Client): Promise<void> {
	await Promise.all([
		sql.close({ timeout: 0 }).catch(logError),
		queries.close({ timeout: 0 }).catch(logError),
	]);
}

export async function closeClient(): Promise<void> {
	const closing: Client | null = client;

	client = null;
	sortNotice = null;
	loads.clear();
	runs.clear();

	if (closing) {
		await closeSql(closing);
	}
}
