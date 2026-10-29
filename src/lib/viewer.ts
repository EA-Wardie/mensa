import { confirmDiscard } from "./editor";
import type { GridSource } from "./grid";
import {
	$activeTab,
	$queryResults,
	$tableData,
	$viewer,
	type QueryResult,
	type Tab,
	type TableData,
	type ViewerTarget,
} from "./store";

// The rows a tab shows: a table's loaded rows, or a query's last rows.
function tabSource(tab: Tab): GridSource | null {
	if (tab.kind === "table") {
		const data: TableData | undefined = $tableData.get()[tab.table];

		return data?.status === "loaded" ? data : null;
	}

	const result: QueryResult | undefined = $queryResults.get()[tab.id];

	return result?.status === "rows" ? { ...result, meta: null } : null;
}

// The view's row index only means something for the rows it was opened on, so
// it stays open while its tab is shown with those same rows. Gives them while
// the target is current, or else null.
export function viewerSource(target: ViewerTarget): GridSource | null {
	const source: GridSource | null =
		$activeTab.get() === target.tab ? tabSource(target.tab) : null;

	return source?.rows === target.rows ? source : null;
}

// Shows a row of the active tab in the view, scrolled to the column, which
// the grid showing it then selects. It closes the editor first, asking when it
// has unsaved changes.
export function viewRow(row: number, column: string | null): void {
	const tab: Tab | null = $activeTab.get();
	const source: GridSource | null = tab === null ? null : tabSource(tab);

	if (tab === null || !source?.rows[row]) {
		return;
	}

	const target: ViewerTarget = {
		tab: tab,
		rows: source.rows,
		row: row,
		column: column,
	};

	confirmDiscard((): void => {
		$viewer.set(target);
	});
}

export function closeViewer(): void {
	$viewer.set(null);
}

function closeIfStale(): void {
	const target: ViewerTarget | null = $viewer.get();

	if (target && !viewerSource(target)) {
		closeViewer();
	}
}

$activeTab.listen(closeIfStale);
$tableData.listen(closeIfStale);
$queryResults.listen(closeIfStale);
