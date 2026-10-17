import { Confirmation } from "../components/Confirmation";
import {
	$activeTable,
	$editor,
	$editorDirty,
	$tableData,
	type EditorTarget,
	type LoadedTable,
	type TableData,
} from "./store";
import { selectRow } from "./tabs";

export function isSameRow(a: EditorTarget, b: EditorTarget): boolean {
	return a.table === b.table && a.rows === b.rows && a.row === b.row;
}

// Opens a row of the active table in the editor, focused on the column. The
// row the editor already has only moves the focus, keeping its edits, and
// another row asks first when the open one has unsaved changes.
export function editRow(row: number, column: string | null): void {
	const table: string | null = $activeTable.get();
	const data: TableData | undefined =
		table === null ? undefined : $tableData.get()[table];
	const editing: EditorTarget | null = $editor.get();

	if (table === null || data?.status !== "loaded" || !data.rows[row]) {
		return;
	}

	const target: EditorTarget = {
		table: table,
		rows: data.rows,
		row: row,
		column: column,
	};

	if (editing && isSameRow(editing, target)) {
		$editor.set(target);

		return;
	}

	confirmDiscard((): void => {
		selectRow(row, table);
		$editor.set(target);
	});
}

export function closeEditor(): void {
	$editorDirty.set(false);
	$editor.set(null);
}

// The editor's row index only means something for the rows it was opened on,
// so it stays open while its table is shown with those same rows. A reload,
// a sort, a saved row, closing the tab or the connection all replace them.
// Gives the table's data while the target is current, or else null.
export function editorData(target: EditorTarget): LoadedTable | null {
	const data: TableData | undefined = $tableData.get()[target.table];

	return $activeTable.get() === target.table &&
		data?.status === "loaded" &&
		data.rows === target.rows
		? data
		: null;
}

function closeIfStale(): void {
	const target: EditorTarget | null = $editor.get();

	if (target && !editorData(target)) {
		closeEditor();
	}
}

$tableData.listen(closeIfStale);
$activeTable.listen(closeIfStale);

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
