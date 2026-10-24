import * as core from "@opentui/core";
import { theme } from "../lib/config";
import {
	QUERY_EDITOR_HEIGHT,
	QUERY_EDITOR_MIN_ROWS,
	RUN_ICON,
} from "../lib/consts";
import { ctx } from "../lib/context";
import { displayText } from "../lib/format";
import { unbindOnDestroy } from "../lib/lifetime";
import { SHORTCUTS, shortcutLabel } from "../lib/shortcuts";
import {
	$activeTab,
	$dialogOpen,
	$queryResults,
	$querySql,
	$tabs,
	type QueryResult,
	type QueryTab,
	type Tab,
} from "../lib/store";
import { runQueryTab, setQuerySql } from "../lib/tabs";
import { Button } from "./Button";
import type { DataGrid } from "./DataGrid";
import { GridView } from "./GridView";
import { ResultGrid } from "./ResultGrid";

type ErrorResult = Extract<QueryResult, { status: "error" }>;

// A query tab: its SQL over the rows of its last run, or the error it ran
// into.
export class QueryView {
	// The active query tab's view.
	private static _shown: QueryView | null = null;

	private _id: string;
	private _runKey: string;
	private _root: core.BoxRenderable;
	private _textarea: core.TextareaRenderable;
	private _hint: core.TextRenderable;
	private _grid: ResultGrid;
	private _error: core.BoxRenderable;
	private _errorText: core.TextRenderable;
	private _result: QueryResult | undefined = undefined;
	// Whether the shown error is from SQL that has changed since.
	private _stale: boolean = false;

	constructor(tab: QueryTab) {
		this._id = tab.id;
		// Read here, since the shortcuts import this module.
		this._runKey = shortcutLabel(SHORTCUTS.runQuery);

		this._root = new core.BoxRenderable(ctx, {
			width: "100%",
			flexGrow: 1,
			flexDirection: "column",
		});

		// Under the tabs, the top border meets theirs.
		const editor: core.BoxRenderable = new core.BoxRenderable(ctx, {
			width: "100%",
			height: QUERY_EDITOR_HEIGHT,
			// The rows and the top border.
			minHeight: QUERY_EDITOR_MIN_ROWS + 1,
			flexShrink: 0,
			border: ["top"],
			borderColor: theme.border,
			paddingX: 1,
		});

		this._textarea = new core.TextareaRenderable(ctx, {
			width: "100%",
			flexGrow: 1,
			initialValue: $querySql.get()[tab.id] ?? "",
			placeholder: `Write SQL, then ${this._runKey} to run`,
			wrapMode: "none",
			textColor: theme.fg,
			focusedTextColor: theme.fg,
			cursorColor: theme.fg,
			placeholderColor: theme.muted,
			onContentChange: (): void => {
				this.onContentChange();
			},
		});

		editor.add(this._textarea);

		const toolbar: core.BoxRenderable = new core.BoxRenderable(ctx, {
			width: "100%",
			flexShrink: 0,
			flexDirection: "row",
			gap: 1,
			paddingX: 1,
		});

		this._hint = new core.TextRenderable(ctx, {
			content: `${this._runKey} to run`,
			fg: theme.muted,
			selectable: false,
		});

		toolbar.add(
			Button.make({
				label: `${RUN_ICON} Run`,
				variant: "success",
				onClick: (): void => {
					runQueryTab(this._id);
				},
			}),
		);
		toolbar.add(this._hint);

		this._grid = ResultGrid.make({
			runKey: this._runKey,
			onPress: (): void => {
				this._textarea.blur();
			},
		});

		this._errorText = new core.TextRenderable(ctx, {
			content: "",
			fg: theme.danger,
			wrapMode: "word",
		});

		this._error = new core.BoxRenderable(ctx, {
			width: "100%",
			flexGrow: 1,
			border: ["top"],
			borderColor: theme.border,
			paddingX: 1,
			visible: false,
		});

		this._error.add(this._errorText);
		this._root.add(editor);
		this._root.add(toolbar);
		this._root.add(this._grid);
		this._root.add(this._error);

		unbindOnDestroy(
			this._root,
			$queryResults.subscribe((): void => {
				this.update();
			}),
		);
	}

	// Focuses the active query tab's SQL, if a query tab is active.
	public static focusShown(): boolean {
		QueryView._shown?._textarea.focus();

		return QueryView._shown !== null;
	}

	private blur(): void {
		if (this._textarea.focused) {
			this._textarea.blur();
		}
	}

	// Blurs the SQL first, since destroying it would leave the renderer
	// pointing at it.
	private destroy(): void {
		this.blur();
		this._root.destroyRecursively();
	}

	// The SQL is kept as it's typed. Nothing redraws for it, and an error
	// only redraws when it goes stale or back.
	private onContentChange(): void {
		const sql: string = this._textarea.plainText;

		setQuerySql(this._id, sql);

		if (
			this._result?.status === "error" &&
			this._stale !== (sql !== this._result.sql)
		) {
			this.showError(this._result, false);
		}
	}

	// Takes the keys before the SQL does, while it has the focus. Escape gives
	// the focus back, so the other shortcuts work again. Ctrl+Return is also a
	// shortcut, for when the SQL isn't focused, and Alt+Return is for terminals
	// that send Ctrl+Return as Return.
	private handleKey(key: core.KeyEvent): void {
		if ($dialogOpen.get() || !this._textarea.focused) {
			return;
		}

		if (key.name === "escape") {
			key.preventDefault();
			this._textarea.blur();
		} else if (key.name === "return" && (key.ctrl || key.meta || key.option)) {
			key.preventDefault();
			runQueryTab(this._id);
		}
	}

	// An error shows in place of the rows.
	private update(): void {
		const result: QueryResult | undefined = $queryResults.get()[this._id];

		if (result === this._result) {
			return;
		}

		this._result = result;
		this._hint.content =
			result?.status === "running" ? "Running…" : `${this._runKey} to run`;
		this._grid.show(result);

		if (result?.status === "error") {
			this.showError(result, true);
		} else {
			this._error.visible = false;
			this._grid.visible = true;
		}
	}

	// Muted once the SQL has changed since the run. A new error moves the cursor
	// to where Postgres says it is, unless a dialog has the focus.
	private showError(result: ErrorResult, fresh: boolean): void {
		const at: string = result.at
			? `Line ${result.at.line}, column ${result.at.column}: `
			: "";

		this._stale = this._textarea.plainText !== result.sql;
		this._errorText.content = displayText(
			`${at}${result.message}${this._stale ? " (from the last run)" : ""}`,
		);
		this._errorText.fg = this._stale ? theme.muted : theme.danger;
		this._error.visible = true;
		this._grid.visible = false;

		if (fresh && result.at && this._root.visible && !$dialogOpen.get()) {
			this._textarea.setCursor(result.at.line - 1, result.at.column - 1);
			this._textarea.focus();
		}
	}

	// Holds a view for each open query tab, so each keeps its cursor, its undo
	// history and where its rows are scrolled. It shows the active one, or the
	// table grid when a table or no tab is active, and makes that the grid the
	// shortcuts scroll.
	public static host(tableGrid: DataGrid): core.BoxRenderable {
		const host: core.BoxRenderable = new core.BoxRenderable(ctx, {
			width: "100%",
			flexGrow: 1,
			flexDirection: "column",
			visible: false,
		});
		const views: Map<QueryTab, QueryView> = new Map<QueryTab, QueryView>();
		// Views not shown yet. A new query is for typing in, so an empty one
		// takes the focus the first time it shows.
		const unseen: Set<QueryTab> = new Set<QueryTab>();

		const sync: () => void = (): void => {
			const tabs: readonly Tab[] = $tabs.get();
			const active: Tab | null = $activeTab.get();

			for (const [tab, view] of views) {
				if (!tabs.includes(tab)) {
					view.destroy();
					views.delete(tab);
					unseen.delete(tab);
				}
			}

			for (const tab of tabs) {
				if (tab.kind === "query" && !views.has(tab)) {
					const view: QueryView = new QueryView(tab);

					views.set(tab, view);
					unseen.add(tab);
					host.add(view._root);
				}
			}

			// A hidden view gives up the focus, so its SQL doesn't take keys.
			for (const [tab, view] of views) {
				view._root.visible = tab === active;

				if (tab !== active) {
					view.blur();
				}
			}

			const shown: QueryView | null =
				active?.kind === "query" ? (views.get(active) ?? null) : null;

			QueryView._shown = shown;
			host.visible = shown !== null;
			tableGrid.visible = shown === null;
			GridView.current = shown?._grid ?? tableGrid;

			if (
				shown &&
				active?.kind === "query" &&
				unseen.delete(active) &&
				shown._textarea.plainText === ""
			) {
				shown._textarea.focus();
			}
		};

		const onKeypress: (key: core.KeyEvent) => void = (
			key: core.KeyEvent,
		): void => {
			QueryView._shown?.handleKey(key);
		};

		ctx.keyInput.on("keypress", onKeypress);

		unbindOnDestroy(
			host,
			$tabs.listen(sync),
			$activeTab.subscribe(sync),
			(): void => {
				ctx.keyInput.off("keypress", onKeypress);
				QueryView._shown = null;
			},
		);

		return host;
	}
}
