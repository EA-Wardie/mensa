import { type ColumnKind, columnKind } from "./columnKinds";
import { MAX_COLUMN_WIDTH } from "./consts";
import { displayText, fitText, NULL_TEXT } from "./format";
import type { LoadedTable, TableData, Value } from "./store";

export type Cell = string | null;

// Column names and cells are fitted to their column once per load, so a frame
// only draws them.
export interface Grid {
	columns: string[];
	kinds: ColumnKind[];
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

// Each text is measured once, both to size its column and to fit it.
function makeGrid({ columns, types, rows, meta }: LoadedTable): Grid {
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
					column.width + HEADER_SPACE,
				),
			),
	);

	return {
		columns: header.map((column: Measured, index: number): string =>
			fitText(column.text, (widths[index] ?? 0) - HEADER_SPACE, column.width),
		),
		kinds: columns.map(
			(column: string, index: number): ColumnKind =>
				columnKind(meta, column, types[index] ?? ""),
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

export function gridFor(data: TableData | undefined): Grid | null {
	if (data?.status !== "loaded") {
		return null;
	}

	let grid: Grid | undefined = GRIDS.get(data.rows);

	if (!grid) {
		grid = makeGrid(data);
		GRIDS.set(data.rows, grid);
	}

	return grid;
}
