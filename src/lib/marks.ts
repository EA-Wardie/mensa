import {
	$markedRows,
	$queryResults,
	$tableData,
	$tabs,
	type MarkedRows,
	type Tab,
	type Value,
} from "./store";
import { tabSource } from "./viewer";

const NO_MARKS: ReadonlySet<number> = new Set<number>();

// The rows marked in rows, or none when the marks belong to other rows.
export function marksOf(rows: Value[][] | undefined): ReadonlySet<number> {
	const marked: MarkedRows | null = $markedRows.get();

	return marked && marked.rows === rows ? marked.indexes : NO_MARKS;
}

// Marking a row of other rows starts again from it.
export function toggleMark(rows: Value[][], row: number): void {
	const indexes: Set<number> = new Set<number>(marksOf(rows));

	if (!indexes.delete(row)) {
		indexes.add(row);
	}

	$markedRows.set(indexes.size ? { rows: rows, indexes: indexes } : null);
}

export function clearMarks(): void {
	$markedRows.set(null);
}

// The marks go once their rows are replaced, such as by a reload, sort, save
// or run, or their tab closes.
function clearIfStale(): void {
	const marked: MarkedRows | null = $markedRows.get();

	if (
		marked &&
		!$tabs
			.get()
			.some((tab: Tab): boolean => tabSource(tab)?.rows === marked.rows)
	) {
		clearMarks();
	}
}

$tabs.listen(clearIfStale);
$tableData.listen(clearIfStale);
$queryResults.listen(clearIfStale);
