import { Confirmation } from "../components/Confirmation";
import {
	$activeTab,
	$editor,
	$editorDirty,
	$notice,
	$queryResults,
	$tableData,
	$viewer,
	type EditorTarget,
	type QueryResult,
	type Tab,
	type TableData,
	type TableMeta,
	type Value,
} from "./store";

// The rows the editor edits: a table's loaded rows, or a query's results that
// come from one table.
export interface EditorData {
	// The table the rows are saved to.
	table: string;
	// The rows' column names, which label the fields.
	columns: string[];
	// The table column each is, or null for one that isn't saved, such as an
	// expression in a query.
	sources: (string | null)[];
	rows: Value[][];
	meta: TableMeta;
}

export function isSameRow(a: EditorTarget, b: EditorTarget): boolean {
	return a.tab === b.tab && a.rows === b.rows && a.row === b.row;
}

// The tab's rows the editor can open, or why a query's can't be edited, or
// null while there are none.
function tabRows(tab: Tab): EditorData | string | null {
	if (tab.kind === "table") {
		const data: TableData | undefined = $tableData.get()[tab.table];

		return data?.status === "loaded"
			? {
					table: tab.table,
					columns: data.columns,
					sources: data.columns,
					rows: data.rows,
					meta: data.meta,
				}
			: null;
	}

	const result: QueryResult | undefined = $queryResults.get()[tab.id];

	if (result?.status !== "rows") {
		return null;
	}

	if (typeof result.edit === "string") {
		return result.edit;
	}

	return {
		table: result.edit.table,
		columns: result.columns,
		sources: result.edit.sources,
		rows: result.rows,
		meta: result.edit.meta,
	};
}

// Whether the active tab's rows can be opened in the editor, for the Edit
// buttons and menu items.
export function canEditRows(): boolean {
	const tab: Tab | null = $activeTab.get();
	const data: EditorData | string | null = tab === null ? null : tabRows(tab);

	return data !== null && typeof data !== "string";
}

// Opens a row of the active tab in the editor, focused on the column. The row
// the editor already has only moves the focus, keeping its edits, and another
// row asks first when the open one has unsaved changes. A query's rows that
// can't be edited say why in the footer.
export function editRow(row: number, column: string | null): void {
	const tab: Tab | null = $activeTab.get();
	const data: EditorData | string | null = tab === null ? null : tabRows(tab);
	const editing: EditorTarget | null = $editor.get();

	if (typeof data === "string") {
		$notice.set(data);

		return;
	}

	if (tab === null || data === null || !data.rows[row]) {
		return;
	}

	const target: EditorTarget = {
		tab: tab,
		table: data.table,
		rows: data.rows,
		row: row,
		column: column,
	};

	if (editing && isSameRow(editing, target)) {
		$editor.set(target);

		return;
	}

	// The grid showing the rows selects the row.
	confirmDiscard((): void => {
		$viewer.set(null);
		$editor.set(target);
	});
}

export function closeEditor(): void {
	$editorDirty.set(false);
	$editor.set(null);
}

// The editor's row index only means something for the rows it was opened on,
// so it stays open while its tab is shown with those same rows. A reload, a
// sort, a saved row, a query run again, closing the tab or the connection all
// replace them. Gives the rows while the target is current, or else null.
export function editorData(target: EditorTarget): EditorData | null {
	const data: EditorData | string | null =
		$activeTab.get() === target.tab ? tabRows(target.tab) : null;

	return typeof data === "object" && data?.rows === target.rows ? data : null;
}

function closeIfStale(): void {
	const target: EditorTarget | null = $editor.get();

	if (target && !editorData(target)) {
		closeEditor();
	}
}

$tableData.listen(closeIfStale);
$queryResults.listen(closeIfStale);
$activeTab.listen(closeIfStale);

// Closes the editor and runs an action that would leave its row, asking first
// when it has unsaved changes. Closing it first matters when it has none, since
// a sort keeps the old rows on screen while it loads, and edits typed meanwhile
// would be dropped without asking when the sorted rows arrive.
export function confirmDiscard(action: () => void = (): void => {}): void {
	if (!$editorDirty.get()) {
		closeEditor();
		action();

		return;
	}

	Confirmation.make({
		heading: "Discard changes?",
		description: "The row has unsaved changes.",
		confirmLabel: "Discard",
		onConfirm: (): void => {
			closeEditor();
			action();
		},
	});
}

// Runs an action, through confirmDiscard when it leaves the edited row.
export function confirmDiscardIf(leaves: boolean, action: () => void): void {
	if (leaves) {
		confirmDiscard(action);
	} else {
		action();
	}
}
