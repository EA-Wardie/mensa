import { type ColumnIcon, columnIcon, columnKind } from "./columnKinds";
import { MAX_COLUMN_WIDTH } from "./consts";
import { displayText, fitText, NULL_TEXT } from "./format";
import type { TableData, TableMeta, TypeKind, Value } from "./store";

export type Cell = string | null;

// What a grid shows: a loaded table, or a query's rows, which have no keys.
export interface GridSource {
	columns: string[];
	kinds: TypeKind[];
	rows: Value[][];
	meta: TableMeta | null;
}

// Column names and cells are fitted to their column once per load, so a frame
// only draws them.
export interface Grid {
	columns: string[];
	icons: ColumnIcon[];
	cells: Cell[][];
	widths: number[];
	totalWidth: number;
}

interface Measured {
	text: string;
	width: number;
}

export const CELL_PADDING: number = 1;

// Every header keeps room for a gap and the sort chevron, so sorting doesn't
// move the columns.
const SORT_SPACE: number = 2;

// Every name has its column's icon and a gap before it.
export const ICON_SPACE: number = 2;

const HEADER_SPACE: number = ICON_SPACE + SORT_SPACE;

const GRIDS: WeakMap<Value[][], Grid> = new WeakMap<Value[][], Grid>();

export function columnSpan(width: number): number {
	return width + CELL_PADDING * 2 + 1;
}

function measure(value: Value): Measured {
	const text: string = value === null ? NULL_TEXT : displayText(value);

	return { text: text, width: Bun.stringWidth(text) };
}

// Follows a NOT NULL column's name. A query's columns have no metadata.
const NOT_NULL_MARK: string = "*";

function notNullMark(meta: TableMeta | null, column: string): string {
	return meta?.columns.get(column)?.nullable === false ? NOT_NULL_MARK : "";
}

// Each text is measured once, both to size its column and to fit it. A cut
// name keeps its mark.
function makeGrid({ columns, kinds, rows, meta }: GridSource): Grid {
	const marks: string[] = columns.map((column: string): string =>
		notNullMark(meta, column),
	);
	const header: Measured[] = columns.map(measure);
	const measured: Measured[][] = rows.map((row: Value[]): Measured[] =>
		row.map(measure),
	);
	const widths: number[] = header.map(
		(column: Measured, index: number): number =>
			Math.min(
				MAX_COLUMN_WIDTH,
				measured.reduce(
					(width: number, row: Measured[]): number =>
						Math.max(width, row[index]?.width ?? 0),
					column.width + (marks[index]?.length ?? 0) + HEADER_SPACE,
				),
			),
	);

	return {
		columns: header.map((column: Measured, index: number): string => {
			const mark: string = marks[index] ?? "";

			return `${fitText(
				column.text,
				(widths[index] ?? 0) - HEADER_SPACE - mark.length,
				column.width,
			)}${mark}`;
		}),
		icons: columns.map(
			(column: string, index: number): ColumnIcon =>
				columnIcon(columnKind(meta, column, kinds[index] ?? "other")),
		),
		cells: measured.map((row: Measured[], index: number): Cell[] =>
			row.map(
				(cell: Measured, column: number): Cell =>
					rows[index]?.[column] === null
						? null
						: fitText(cell.text, widths[column] ?? 0, cell.width),
			),
		),
		widths: widths,
		totalWidth: widths.reduce(
			(total: number, width: number): number => total + columnSpan(width),
			0,
		),
	};
}

export function gridOf(source: GridSource): Grid {
	let grid: Grid | undefined = GRIDS.get(source.rows);

	if (!grid) {
		grid = makeGrid(source);
		GRIDS.set(source.rows, grid);
	}

	return grid;
}

export function gridFor(data: TableData | undefined): Grid | null {
	return data?.status === "loaded" ? gridOf(data) : null;
}
