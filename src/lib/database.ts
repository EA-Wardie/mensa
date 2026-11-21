import { type ReservedSQL, SQL, type TransactionSQL } from "bun";
import { type ConnectionConfig, type Driver, rowLimit } from "./config";
import { CONNECTION_TIMEOUT, LOCK_TIMEOUT, LONG_TEXT_LENGTH } from "./consts";
import { errorMessage } from "./format";
import { logError } from "./log";
import { splitStatements } from "./statements";
import {
	$notice,
	$queryResults,
	$querySql,
	$resultEditsRead,
	$selectedRows,
	$sorts,
	$tableData,
	$tables,
	type ColumnEdit,
	type ColumnMeta,
	type EditorTarget,
	type LoadedTable,
	type QueryResult,
	type ResultEdit,
	type ResultOrigin,
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
	has_children: boolean;
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

// The rows a save matches a row in by its primary key.
interface EditedRows {
	meta: TableMeta;
	// The table column each value of a row saves to, or null.
	sources: (string | null)[];
	// The table column each value of a row shows, or null, so a save updates
	// every copy of it.
	shown: (string | null)[];
	// Reads a quoted column of the nth value as the rows show it.
	asShown: (column: string, index: number) => string;
	rows: Value[][];
	// The connection the write runs on.
	sql: SQL;
	// Whether a write also matches the shown values of the row's other
	// columns, as text, which a query's rows need, since a table joined to
	// itself names both sides' columns as the one table's.
	guarded: boolean;
	// Puts the rows with the stored values in place of the loaded ones, unless
	// they were replaced meanwhile.
	replace: (rows: Value[][]) => void;
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
	// Why no query's rows can be edited, or null when they can be.
	resultsReadOnly: string | null;
	// Runtime parameters the table tabs' connections start with.
	startup: Record<string, string | number> | undefined;
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

// A table's statements reach the tables that inherit from it, where its key
// isn't unique, so saving one row could change several. A partitioned table's
// key is unique across its partitions.
const INHERITED: string =
	"Other tables inherit from the table, and may share its keys, so its rows can't be saved.";

const GENERATED: string = "Generated by the database.";

const CLOSED: string = "The connection is closed.";

const ROW_NOT_FOUND: string =
	"The row wasn't found. It may have been changed or deleted, so reload the table.";

const SHOWN_ROW_NOT_FOUND: string =
	"The row wasn't found with the values shown. It may have changed since the query ran, so run it again.";

// Postgres's lock_not_available, and MySQL's lock wait timeout.
const LOCK_ERRORS: ReadonlySet<string> = new Set<string>(["55P03", "1205"]);

// A write's error, explaining a lock it gave up waiting for.
function writeError(error: unknown): string {
	const code: unknown =
		error instanceof Error && "errno" in error ? error.errno : undefined;

	return LOCK_ERRORS.has(String(code))
		? "The row or table is locked, such as by a query tab's open transaction. Commit or roll it back, then try again."
		: errorMessage(error);
}

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
			c.relkind::text AS relation_kind,
			EXISTS (
				SELECT 1 FROM pg_catalog.pg_inherits h WHERE h.inhparent = c.oid
			) AS has_children
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
	const inherited: boolean = rows[0]?.has_children ?? false;

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
		kind === "p"
			? null
			: kind === "r"
				? inherited
					? INHERITED
					: null
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

interface PostgresAttributeRow {
	relation: string;
	schema: string;
	number: number;
	name: string;
}

// A node of a plan from EXPLAIN (FORMAT JSON), as far as it's read here.
interface PlanNode {
	"Node Type"?: string;
	"Relation Name"?: string;
	Schema?: string;
	// The CTE a CTE Scan reads.
	"CTE Name"?: string;
	// Such as "CTE name" for the plan of a CTE.
	"Subplan Name"?: string;
	Plans?: PlanNode[];
}

// A scan of the table, with the CTEs it's inside, innermost last. A write
// to the table, such as an INSERT, isn't a scan of it.
interface TableScan {
	ctes: string[];
	write: boolean;
}

// Where a query's rows come from, from what the result says of its columns:
// each one's table by OID and its column by number, so aliases don't hide
// them. Only the columns of one table can be edited, and none shown as hex,
// since their text isn't the database's.
function resultOrigin(
	columns: SQL.ResultColumn[],
	hexed: boolean[],
	statement: string | null,
): ResultOrigin | string {
	const tables: Set<number | string> = new Set<number | string>(
		columns
			.map((column: SQL.ResultColumn): number | string => column.table)
			.filter((table: number | string): boolean => table !== 0),
	);
	const [oid]: (number | string)[] = [...tables];

	if (oid === undefined) {
		return "The rows don't come from a table, so they can't be edited.";
	}

	if (tables.size > 1) {
		return "The rows come from more than one table, so they can't be edited.";
	}

	if (statement === null) {
		return "The statement that returned the rows couldn't be told apart from the others, so they can't be edited.";
	}

	return {
		table: String(oid),
		numbers: columns.map(
			(column: SQL.ResultColumn, index: number): number | null =>
				column.table === oid && (column.number ?? 0) > 0 && !hexed[index]
					? (column.number ?? null)
					: null,
		),
		statement: statement,
	};
}

// The statement of the SQL that returned a result, when the statements split
// as the server ran them.
function statementOf(
	text: string,
	results: RawResult[],
	result: RawResult,
): string | null {
	const statements: string[] = splitStatements(text);

	return statements.length === results.length
		? (statements[results.indexOf(result)] ?? null)
		: null;
}

// Collects the plan's scans of the table, and how often each CTE is scanned.
function collectScans(
	node: PlanNode,
	table: { schema: string; name: string },
	ctes: string[],
	scans: TableScan[],
	cteScans: Map<string, number>,
): void {
	const subplan: string | undefined = node["Subplan Name"];
	const inside: string[] = subplan?.startsWith("CTE ")
		? [...ctes, subplan.slice(4)]
		: ctes;
	const cte: string | undefined = node["CTE Name"];

	if (node["Relation Name"] === table.name && node.Schema === table.schema) {
		scans.push({ ctes: inside, write: node["Node Type"] === "ModifyTable" });
	}

	if (cte !== undefined) {
		cteScans.set(cte, (cteScans.get(cte) ?? 0) + 1);
	}

	for (const child of node.Plans ?? []) {
		collectScans(child, table, inside, scans, cteScans);
	}
}

// Whether the statement reads the table once, from its plan, so each row
// shows one row of the table. A table joined to itself names both sides'
// columns as the one table's, so a column can't be told to belong to the row
// the key matches. Reading it twice, or through a CTE read twice, is refused,
// as is a plan that only names other tables, such as a partitioned table's
// partitions. Gives why the rows can't be edited, or null.
function readsOnce(
	plan: unknown,
	table: { schema: string; name: string },
): string | null {
	const root: PlanNode | undefined = (Array.isArray(plan) ? plan[0] : undefined)
		?.Plan;
	const scans: TableScan[] = [];
	const cteScans: Map<string, number> = new Map<string, number>();

	if (root) {
		collectScans(root, table, [], scans, cteScans);
	}

	const reads: TableScan[] = scans.filter(
		(scan: TableScan): boolean => !scan.write,
	);
	const [scan]: TableScan[] = reads;

	if (!scan) {
		return scans.length
			? "The rows were written by the query, such as by an INSERT, so they can't be edited. Select them to edit them."
			: "The table wasn't found in the query's plan, such as a partitioned table, so the rows can't be edited.";
	}

	if (
		reads.length > 1 ||
		scan.ctes.some((cte: string): boolean => (cteScans.get(cte) ?? 0) > 1)
	) {
		return "The query reads the table more than once, such as joining it to itself, so the rows can't be edited.";
	}

	return null;
}

// The schemas a connection finds unqualified names in, as its search_path
// gives them, with $user named.
async function searchPath(sql: SQL): Promise<string> {
	const [row]: { schemas: string }[] =
		await sql`SELECT current_schemas(false)::text AS schemas`;

	return row?.schemas ?? "";
}

// Reads what a query's rows need to be edited: the table, which must be in
// the schema and read once by the statement, and its primary key among the
// columns. A column shown again and an expression are read only. It plans on
// the table tabs' connections, so a failure can't abort a transaction the
// query tabs have open, and a table only that transaction can see can't be
// edited. Names must find the same tables there, so the query tabs' search
// path must be the same. A temporary table on the query tabs' connection only
// makes the plan read the table more often than the query did, which refuses
// rows that could be edited, never the reverse. Rejects when the reads fail.
async function readResultEdit(
	{ sql, queries, schema }: Client,
	origin: ResultOrigin,
): Promise<ResultEdit | string> {
	const [tablePath, queryPath]: string[] = await Promise.all([
		searchPath(sql),
		searchPath(queries),
	]);

	if (tablePath !== queryPath) {
		return "The query tab's search_path differs from the table tabs', so the query's table names can't be checked, and the rows can't be edited.";
	}

	// Passed as text, since an OID can be past the largest int4.
	const rows: PostgresAttributeRow[] = await sql`
		SELECT
			c.relname::text AS relation,
			n.nspname::text AS schema,
			a.attnum::int AS number,
			a.attname::text AS name
		FROM pg_catalog.pg_class c
		JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
		JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
		WHERE c.oid = ${origin.table}::oid AND a.attnum > 0 AND NOT a.attisdropped
	`;
	const relation: PostgresAttributeRow | undefined = rows[0];

	if (!relation) {
		return "The table couldn't be read, such as one made in an open transaction, so the rows can't be edited.";
	}

	if (relation.schema !== schema) {
		return `The rows come from ${relation.schema}.${relation.relation}, outside the ${schema} schema, so they can't be edited.`;
	}

	// EXPLAIN without ANALYZE plans the statement without running it. A
	// template sends it as a prepared statement, which the server refuses to
	// hold more than one statement, in case it wasn't split as the server
	// split it. sql.unsafe alone would run them all.
	const plans: Record<string, unknown>[] =
		await sql`EXPLAIN (VERBOSE, FORMAT JSON) ${sql.unsafe(origin.statement)}`;
	const plan: unknown = Object.values(plans[0] ?? {})[0];
	const once: string | null = readsOnce(
		typeof plan === "string" ? JSON.parse(plan) : plan,
		{ schema: relation.schema, name: relation.relation },
	);

	if (once !== null) {
		return once;
	}

	const names: Map<number, string> = new Map<number, string>(
		rows.map((row: PostgresAttributeRow): [number, string] => [
			row.number,
			row.name,
		]),
	);
	const shown: (string | null)[] = origin.numbers.map(
		(number: number | null): string | null =>
			number === null ? null : (names.get(number) ?? null),
	);
	const sources: (string | null)[] = shown.map(
		(name: string | null, index: number): string | null =>
			name !== null && shown.indexOf(name) === index ? name : null,
	);
	const meta: TableMeta = await describePostgres(
		sql,
		schema,
		relation.relation,
	);
	const missing: string[] = meta.primaryKey.filter(
		(key: string): boolean => !sources.includes(key),
	);

	if (meta.readOnly !== null) {
		return meta.readOnly;
	}

	if (missing.length) {
		return `The rows don't include the primary key ${missing.join(", ")}, so they can't be edited.`;
	}

	return {
		table: relation.relation,
		sources: sources,
		shown: shown,
		meta: { ...meta, columns: shownBooleans(meta.columns) },
	};
}

// What each query result's rows need to be edited, read the first time a row
// is edited and kept while the result is, since a save keeps its origin.
const resultEdits: WeakMap<ResultOrigin, ResultEdit | string> = new WeakMap<
	ResultOrigin,
	ResultEdit | string
>();

const readingEdits: WeakMap<
	ResultOrigin,
	Promise<ResultEdit | string>
> = new WeakMap<ResultOrigin, Promise<ResultEdit | string>>();

// What the result's rows need to be edited, if it has been read.
export function knownResultEdit(
	origin: ResultOrigin,
): ResultEdit | string | undefined {
	return resultEdits.get(origin);
}

// Reads what the result's rows need to be edited, once. A failed read isn't
// kept, so it's tried again, such as after the lock it waited on is released.
export function readResultEditOf(
	origin: ResultOrigin,
): Promise<ResultEdit | string> {
	const known: ResultEdit | string | undefined = resultEdits.get(origin);
	const current: Client | null = client;

	if (known !== undefined) {
		return Promise.resolve(known);
	}

	if (!current) {
		return Promise.resolve(CLOSED);
	}

	const reading: Promise<ResultEdit | string> =
		readingEdits.get(origin) ??
		readResultEdit(current, origin).then(
			(edit: ResultEdit | string): ResultEdit | string => {
				resultEdits.set(origin, edit);
				$resultEditsRead.set($resultEditsRead.get() + 1);

				return edit;
			},
			(error: unknown): string => {
				logError(error);

				return `Could not check the rows can be edited: ${writeError(error)}`;
			},
		);

	readingEdits.set(origin, reading);
	reading.finally((): void => {
		readingEdits.delete(origin);
	});

	return reading;
}

// A query shows a boolean as t or f, where a table casts it to true or false,
// so its choices are t and f, labelled as the table shows them.
function shownBooleans(
	columns: Map<string, ColumnMeta>,
): Map<string, ColumnMeta> {
	return new Map<string, ColumnMeta>(
		[...columns].map(
			([name, column]: [string, ColumnMeta]): [string, ColumnMeta] => [
				name,
				column.kind === "boolean" && column.edit.as === "choice"
					? {
							...column,
							edit: {
								as: "choice",
								options: ["t", "f"],
								labels: ["true", "false"],
							},
						}
					: column,
			],
		),
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
		resultsReadOnly: null,
		// A write or a load that waits on a lock, such as one a query tab's
		// open transaction holds, fails instead of waiting forever.
		startup: { lock_timeout: LOCK_TIMEOUT },
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
		// Results name a column by its alias, so it can't be told which column
		// of a table it is. InnoDB's own lock wait timeout applies.
		resultsReadOnly: "Query results can only be edited on Postgres.",
		startup: undefined,
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

// Each table's latest load. A load whose token was replaced or removed drops
// its result, such as one that started before the table was truncated.
const loads: Map<string, object> = new Map<string, object>();

// Each query tab's run, the same way.
const runs: Map<string, object> = new Map<string, object>();

// The drivers are named as Bun's adapters.
function makeClient(
	connection: ConnectionConfig,
	max: number,
	startup: Record<string, string | number> | undefined = undefined,
): SQL {
	const options: Bun.SQL.PostgresOrMySQLOptions = {
		adapter: connection.driver,
		max: max,
		connectionTimeout: CONNECTION_TIMEOUT,
	};

	if (startup) options.connection = startup;

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
	const dialect: Dialect = DIALECTS[connection.driver];
	const sql: SQL = makeClient(connection, 4, dialect.startup);
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
			setEntry($sorts, name, data.sort ?? undefined);
			$notice.set(
				sort
					? `Could not sort by ${sort.column}: ${errorMessage(error)}`
					: `Could not reload ${name}: ${errorMessage(error)}`,
			);

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

// The loaded table a row was loaded in, or why its rows can't be written.
function loadedTable(table: string, rows: Value[][]): LoadedTable | string {
	const data: TableData | undefined = $tableData.get()[table];

	if (data?.status !== "loaded" || data.rows !== rows) {
		return "The table was reloaded. Open the row again to edit it.";
	}

	return data.meta.readOnly ?? data;
}

// The rows a save matches a row in: a loaded table's, or a query's results
// that come from one table, saved on the query tabs' own connection, so a
// transaction the tab has open sees the write, and its locks don't block it.
// Gives the rows, or why they can't be saved.
function editedRows(
	current: Client,
	target: EditorTarget,
): EditedRows | string {
	const { tab }: EditorTarget = target;

	if (tab.kind === "table") {
		const data: LoadedTable | string = loadedTable(target.table, target.rows);

		if (typeof data === "string") {
			return data;
		}

		return {
			meta: data.meta,
			sources: data.columns,
			shown: data.columns,
			asShown: (column: string, index: number): string =>
				current.dialect.asText(column, data.types[index] ?? ""),
			rows: data.rows,
			sql: current.sql,
			guarded: false,
			replace: (rows: Value[][]): void => {
				// Rows that were reloaded meanwhile already show the saved values.
				if (client === current && $tableData.get()[target.table] === data) {
					setEntry($tableData, target.table, { ...data, rows: rows });
				}
			},
		};
	}

	const result: QueryResult | undefined = $queryResults.get()[tab.id];

	if (result?.status !== "rows" || result.rows !== target.rows) {
		return "The query ran again. Open the row again to edit it.";
	}

	const edit: ResultEdit | string | undefined =
		typeof result.edit === "string"
			? result.edit
			: knownResultEdit(result.edit);

	if (edit === undefined || typeof edit === "string") {
		return edit ?? "Open the row again to edit it.";
	}

	const { meta, sources, shown }: ResultEdit = edit;

	return (
		meta.readOnly ?? {
			meta: meta,
			sources: sources,
			shown: shown,
			asShown: postgresShown,
			rows: result.rows,
			sql: current.queries,
			guarded: true,
			replace: (rows: Value[][]): void => {
				if (client === current && $queryResults.get()[tab.id] === result) {
					setEntry($queryResults, tab.id, { ...result, rows: rows });
				}
			},
		}
	);
}

// Gives the value a row has in a table column, for matching it by its
// primary key, or why it can't be matched.
function matchRow(
	meta: TableMeta,
	sources: (string | null)[],
	original: Value[] | undefined,
): ((name: string) => Value) | string {
	if (
		!original ||
		!meta.primaryKey.every(
			(key: string): boolean => meta.columns.has(key) && sources.includes(key),
		)
	) {
		return "The row can't be matched by its primary key.";
	}

	return (name: string): Value => original[sources.indexOf(name)] ?? null;
}

// A query's value as its result shows it: the type's output, which a cast to
// text isn't always, such as t for true. format's %s gives the output, but
// gives NULL as empty text.
function postgresShown(column: string): string {
	return `CASE WHEN ${column} IS NULL THEN NULL ELSE format('%s', ${column}) END`;
}

// Matches the row's columns outside its primary key by the values shown.
// Only a query's rows are matched so, which are only edited on Postgres.
function matchShown(
	edited: EditedRows,
	quote: (name: string) => string,
	params: Value[],
	original: Value[],
): string[] {
	return edited.sources.flatMap(
		(source: string | null, index: number): string[] => {
			if (source === null || edited.meta.primaryKey.includes(source)) {
				return [];
			}

			params.push(original[index] ?? null);

			return [
				`${edited.asShown(quote(source), index)} IS NOT DISTINCT FROM $${params.length}::text`,
			];
		},
	);
}

// Saves the changed values of a loaded row, matched by its primary key, and
// puts the row the database stored in place of the loaded one, so triggers and
// the database's own formatting show. A query's expression columns keep their
// values. Resolves to an error message, or null.
export async function updateRow(
	target: EditorTarget,
	changes: RowChange[],
): Promise<string | null> {
	const current: Client | null = client;

	if (!current) {
		return CLOSED;
	}

	const edited: EditedRows | string = editedRows(current, target);

	if (typeof edited === "string") {
		return edited;
	}

	const { meta, sources, rows, sql }: EditedRows = edited;
	const original: Value[] | undefined = rows[target.row];
	const oldValue: ((name: string) => Value) | string = matchRow(
		meta,
		sources,
		original,
	);

	if (typeof oldValue === "string" || !original) {
		return typeof oldValue === "string" ? oldValue : ROW_NOT_FOUND;
	}

	const { dialect, schema }: Client = current;
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
	const where: string = [
		matchKey(dialect, meta, params, oldValue),
		...(edited.guarded
			? matchShown(edited, dialect.quote, params, original)
			: []),
	].join(" AND ");
	// The row's columns of the table, read back in their order.
	const saved: number[] = sources.flatMap(
		(source: string | null, index: number): number[] =>
			source === null ? [] : [index],
	);
	const values: string = saved
		.map((index: number): string =>
			edited.asShown(dialect.quote(sources[index] ?? ""), index),
		)
		.join(", ");
	let updated: Value[] | undefined;

	try {
		if (dialect.returning) {
			const returned: Value[][] = await (sql
				.unsafe(
					`UPDATE ${table} SET ${set} WHERE ${where} RETURNING ${values}`,
					params,
				)
				.values() as Promise<Value[][]>);

			updated = returned[0];
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
			const selected: Value[][] = await (sql
				.unsafe(`SELECT ${values} FROM ${table} WHERE ${key}`, params)
				.values() as Promise<Value[][]>);

			updated = selected[0];
		}
	} catch (error) {
		logError(error);

		return writeError(error);
	}

	if (!updated) {
		return edited.guarded ? SHOWN_ROW_NOT_FOUND : ROW_NOT_FOUND;
	}

	edited.replace(storedRows(edited, original, saved, updated));

	return null;
}

// The rows with the stored values in every copy of the saved row: each
// column that shows a saved column, in each row with the row's old key, such
// as where a query repeats a row. Other columns keep their values.
function storedRows(
	{ meta, sources, shown, rows }: EditedRows,
	original: Value[],
	saved: number[],
	updated: Value[],
): Value[][] {
	const stored: Map<string, Value> = new Map<string, Value>(
		saved.map((index: number, position: number): [string, Value] => [
			sources[index] ?? "",
			updated[position] ?? null,
		]),
	);
	const keyOf: (values: Value[]) => string = (values: Value[]): string =>
		JSON.stringify(
			meta.primaryKey.map(
				(key: string): Value => values[shown.indexOf(key)] ?? null,
			),
		);
	const key: string = keyOf(original);

	return rows.map((values: Value[]): Value[] =>
		values === original || keyOf(values) === key
			? values.map((value: Value, index: number): Value => {
					const name: string | null = shown[index] ?? null;

					return name !== null && stored.has(name)
						? (stored.get(name) ?? null)
						: value;
				})
			: values,
	);
}

// Deletes a loaded row, matched by its primary key, and takes it out of the
// loaded rows, which clears the table's selection. Resolves to an error
// message, or null.
export async function deleteRow(target: RowTarget): Promise<string | null> {
	const current: Client | null = client;

	if (!current) {
		return CLOSED;
	}

	const data: LoadedTable | string = loadedTable(target.table, target.rows);

	if (typeof data === "string") {
		return data;
	}

	const value: ((name: string) => Value) | string = matchRow(
		data.meta,
		data.columns,
		data.rows[target.row],
	);

	if (typeof value === "string") {
		return value;
	}

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

		return writeError(error);
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

// A value as the database's text, or undefined when it isn't UTF-8, so it's
// shown as hex.
function utf8Text(value: Buffer): string | undefined {
	try {
		return UTF8.decode(value);
	} catch {
		return undefined;
	}
}

// Raw bytes that aren't text, such as a MySQL blob.
function asHex(value: Buffer): string {
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
	text: string,
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
	const hexed: boolean[] = columns.map((): boolean => false);
	const kinds: TypeKind[] = await dialect
		.resultKinds(sql, columns, typeKinds)
		.catch((error: unknown): TypeKind[] => {
			logError(error);

			return columns.map((): TypeKind => "other");
		});
	const rows: Value[][] = shown
		.slice(0, rowLimit)
		.map((row: (Buffer | null)[]): Value[] =>
			row.map((value: Buffer | null, index: number): Value => {
				const text: Value | undefined =
					value === null || hex[index] ? undefined : utf8Text(value);

				if (text !== undefined) {
					return text;
				}

				hexed[index] ||= value !== null;

				return value === null ? null : asHex(value);
			}),
		);

	return {
		status: "rows",
		columns: columns.map((column: SQL.ResultColumn): string => column.name),
		kinds: kinds,
		rows: rows,
		total: shown.length,
		ms: ms,
		edit:
			dialect.resultsReadOnly ??
			resultOrigin(columns, hexed, statementOf(text, results, shown)),
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
			text,
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

		return writeError(error);
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

// Lists the tables again, resolving to the error, or null once listed or when
// the connection closed meanwhile.
export async function refreshTables(): Promise<string | null> {
	const current: Client | null = client;

	if (!current) {
		return null;
	}

	try {
		const tables: string[] = await listTables(current.sql, current.schema);
		// Query runs list the tables, which mostly haven't changed.
		if (client === current && !Bun.deepEquals(tables, $tables.get())) {
			$tables.set(tables);
		}

		return null;
	} catch (error) {
		logError(error);

		return client === current
			? `Could not list tables: ${errorMessage(error)}`
			: null;
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
	loads.clear();
	runs.clear();

	if (closing) {
		await closeSql(closing);
	}
}
