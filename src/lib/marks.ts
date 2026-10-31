import {
	$markedRows,
	$queryResults,
	$tableData,
	type MarkedRows,
	type QueryResult,
	type TableData,
	type Value,
} from "./store";

// The rows marked in rows, in grid order, or none when the marks belong to
// other rows.
export function markedIndexes(rows: Value[][] | undefined): number[] {
	const marked: MarkedRows | null = $markedRows.get();

	if (!marked || marked.rows !== rows) {
		return [];
	}

	return [...marked.indexes].sort((a: number, b: number): number => a - b);
}

// Marking a row of other rows starts again from it.
export function toggleMark(rows: Value[][], row: number): void {
	const marked: MarkedRows | null = $markedRows.get();
	const indexes: Set<number> = new Set<number>(
		marked?.rows === rows ? marked.indexes : [],
	);

	if (!indexes.delete(row)) {
		indexes.add(row);
	}

	$markedRows.set(indexes.size ? { rows: rows, indexes: indexes } : null);
}

export function clearMarks(): void {
	if ($markedRows.get() !== null) {
		$markedRows.set(null);
	}
}

// Whether a table's loaded rows or a query's last rows are still rows.
function isShown(rows: Value[][]): boolean {
	return (
		Object.values($tableData.get()).some(
			(data: TableData): boolean =>
				data.status === "loaded" && data.rows === rows,
		) ||
		Object.values($queryResults.get()).some(
			(result: QueryResult): boolean =>
				result.status === "rows" && result.rows === rows,
		)
	);
}

// The marks go once their rows are replaced, such as by a reload, sort, save
// or run, or their tab closes.
function clearIfStale(): void {
	const marked: MarkedRows | null = $markedRows.get();

	if (marked && !isShown(marked.rows)) {
		clearMarks();
	}
}

$tableData.listen(clearIfStale);
$queryResults.listen(clearIfStale);
