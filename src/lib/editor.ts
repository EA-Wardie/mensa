import { Confirmation } from "../components/Confirmation";
import { CHECKING_NOTICE_DELAY } from "./consts";
import { knownResultEdit, readResultEditOf } from "./database";
import {
	$activeTab,
	$checkingEdit,
	$dialogOpen,
	$editor,
	$editorDirty,
	$notice,
	$queryResults,
	$tableData,
	$viewer,
	clearNotice,
	type EditorTarget,
	type QueryResult,
	type ResultEdit,
	type ResultOrigin,
	type Tab,
	type TableData,
	type TableMeta,
	type Value,
	type ViewerTarget,
} from "./store";

// The rows the editor edits: a table's loaded rows, or a query's results that
// come from one table.
export interface EditorData {
	// The table the rows are saved to.
	table: string;
	// The rows' column names, which label the fields.
	columns: string[];
	// The table column each saves to, or null for one that isn't saved, such
	// as an expression in a query or a column shown again.
	sources: (string | null)[];
	// The table column each shows, or null for an expression.
	shown: (string | null)[];
	rows: Value[][];
	meta: TableMeta;
}

export function isSameRow(a: EditorTarget, b: EditorTarget): boolean {
	return a.tab === b.tab && a.rows === b.rows && a.row === b.row;
}

// A query tab's rows' origin, while its result can be edited.
function originOf(tab: Tab): ResultOrigin | null {
	const result: QueryResult | undefined =
		tab.kind === "query" ? $queryResults.get()[tab.id] : undefined;

	return result?.status === "rows" && typeof result.edit !== "string"
		? result.edit
		: null;
}

// A query tab's rows' origin, until it's read whether they can be edited.
function unreadOrigin(tab: Tab): ResultOrigin | null {
	const origin: ResultOrigin | null = originOf(tab);

	return origin !== null && knownResultEdit(origin) === undefined
		? origin
		: null;
}

// The tab's rows the editor can open, or why a query's can't be edited, or
// null while there are none, or it's yet to be read whether they can be.
function tabRows(tab: Tab): EditorData | string | null {
	if (tab.kind === "table") {
		const data: TableData | undefined = $tableData.get()[tab.table];

		return data?.status === "loaded"
			? {
					table: tab.table,
					columns: data.columns,
					sources: data.columns,
					shown: data.columns,
					rows: data.rows,
					meta: data.meta,
				}
			: null;
	}

	const result: QueryResult | undefined = $queryResults.get()[tab.id];

	if (result?.status !== "rows") {
		return null;
	}

	const edit: ResultEdit | string | undefined =
		typeof result.edit === "string"
			? result.edit
			: knownResultEdit(result.edit);

	if (edit === undefined || typeof edit === "string") {
		return edit ?? null;
	}

	return {
		table: edit.table,
		columns: result.columns,
		sources: edit.sources,
		shown: edit.shown,
		rows: result.rows,
		meta: edit.meta,
	};
}

// Whether the active tab's rows can be opened in the editor, for the Edit
// buttons and menu items. A query's rows count until a row is edited and
// they're found not to be.
export function canEditRows(): boolean {
	const tab: Tab | null = $activeTab.get();
	const data: EditorData | string | null = tab === null ? null : tabRows(tab);

	return (
		tab !== null &&
		typeof data !== "string" &&
		(data !== null || unreadOrigin(tab) !== null)
	);
}

// Counts the edits, so only the latest one waiting on a check opens its row.
let edits: number = 0;

// Says in the footer that the latest edit is still checking.
let checkingTimer: Timer | undefined;

// Opens a row of the active tab in the editor, focused on the column at the
// index. The row the editor already has only moves the focus, keeping its
// edits, and another row asks first when the open one has unsaved changes. The
// first edit of a query's rows reads whether they can be edited, saying so in
// the footer once it takes a moment, then opens the row if nothing happened
// meanwhile, or says why not.
export function editRow(row: number, column: number | null): void {
	const tab: Tab | null = $activeTab.get();
	const origin: ResultOrigin | null = tab === null ? null : unreadOrigin(tab);
	const edit: number = ++edits;

	clearTimeout(checkingTimer);
	$checkingEdit.set(false);

	if (tab === null) {
		return;
	}

	if (origin === null) {
		openRow(tab, row, column);

		return;
	}

	const viewer: ViewerTarget | null = $viewer.get();
	const editor: EditorTarget | null = $editor.get();
	// The footer's notice would hide that it's checking.
	clearNotice();
	checkingTimer = setTimeout((): void => {
		$checkingEdit.set(true);
	}, CHECKING_NOTICE_DELAY);

	readResultEditOf(origin).then((read: ResultEdit | string): void => {
		if (edit !== edits) {
			return;
		}

		clearTimeout(checkingTimer);
		$checkingEdit.set(false);

		if (
			$activeTab.get() !== tab ||
			originOf(tab) !== origin ||
			$dialogOpen.get() ||
			$viewer.get() !== viewer ||
			$editor.get() !== editor
		) {
			return;
		}

		if (typeof read === "string") {
			$notice.set(read);
		} else {
			openRow(tab, row, column);
		}
	});
}

function openRow(tab: Tab, row: number, column: number | null): void {
	const data: EditorData | string | null = tabRows(tab);
	const editing: EditorTarget | null = $editor.get();

	if (typeof data === "string") {
		$notice.set(data);

		return;
	}

	if (data === null || !data.rows[row]) {
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
