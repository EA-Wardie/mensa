import * as core from "@opentui/core";
import { version } from "../../package.json";
import { truncateTableNamed } from "../lib/actions";
import { rowLimit, theme } from "../lib/config";
import {
	CLOSE_ICON,
	PRODUCTION_LABEL,
	REFRESH_ICON,
	TRUNCATE_ICON,
} from "../lib/consts";
import { ctx } from "../lib/context";
import { plural } from "../lib/format";
import { unbindOnDestroy } from "../lib/lifetime";
import { markedIndexes } from "../lib/marks";
import { SHORTCUTS } from "../lib/shortcuts";
import {
	$activeTab,
	$activeTable,
	$activeTableData,
	$connection,
	$markedRows,
	$queryResults,
	type QueryResult,
	type Tab,
	type TableData,
	type Value,
} from "../lib/store";
import { IconButton } from "./IconButton";
import { NoticeText } from "./NoticeText";

// A count of rows, with a note when only some are shown, and of columns.
function describeRows(rows: number, limited: string, columns: number): string {
	return `${plural(rows, "row")}${limited} · ${plural(columns, "column")}`;
}

function describeTable(data: TableData | undefined): string {
	if (data?.status !== "loaded") {
		return "";
	}

	return describeRows(
		data.rows.length,
		data.truncated ? ` (first ${rowLimit})` : "",
		data.columns.length,
	);
}

function describeQuery(result: QueryResult | undefined): string {
	switch (result?.status) {
		case "rows": {
			const rows: number = result.rows.length;
			const limited: string =
				result.total > rows ? ` (first ${rows} of ${result.total})` : "";

			return `${describeRows(rows, limited, result.columns.length)} · ${result.ms} ms`;
		}
		// The grid says what the statement did.
		case "done":
			return `${result.ms} ms`;
		default:
			return "";
	}
}

// The marked rows, when the active tab's rows have any.
function describeMarks(rows: Value[][] | undefined): string {
	const count: number = markedIndexes(rows).length;

	return count ? ` · ${count} marked` : "";
}

function describeActiveTab(): string {
	const tab: Tab | null = $activeTab.get();

	if (tab?.kind === "query") {
		const result: QueryResult | undefined = $queryResults.get()[tab.id];

		return `${describeQuery(result)}${describeMarks(result?.status === "rows" ? result.rows : undefined)}`;
	}

	const data: TableData | undefined = $activeTableData.get();

	return `${describeTable(data)}${describeMarks(data?.status === "loaded" ? data.rows : undefined)}`;
}

export class DatabaseFooter {
	private _options: core.BoxOptions;
	private _component: core.BoxRenderable;

	constructor(options: core.BoxOptions) {
		this._options = options;

		// The grid above draws the top border, joined to its columns.
		this._component = new core.BoxRenderable(ctx, {
			border: ["bottom"],
			borderColor: theme.border,
			bottomTitle: ` v${version} `,
			bottomTitleAlignment: "right",
			flexDirection: "row",
			flexShrink: 0,
			...this._options,
		});

		// The buttons are one box, so they stay together, and the box on the
		// right, which holds the production mark, is as wide as they are, so
		// the text stays centred. The buttons' box is at least as wide as the
		// mark. Nothing divides them from the text, so the rule above stays the
		// grid's, joined to its columns. The screen is made for each connection,
		// so the mark is set once.
		const production: boolean = $connection.get()?.production ?? false;
		const labelWidth: number = production
			? Bun.stringWidth(PRODUCTION_LABEL) + 2
			: 0;
		const actions: core.BoxRenderable = new core.BoxRenderable(ctx, {
			flexDirection: "row",
			flexShrink: 0,
			minWidth: labelWidth,
			onSizeChange: (): void => {
				right.width = actions.width;
			},
		});
		// A query tab has no table to truncate.
		const truncate: core.BoxRenderable = IconButton.make({
			icon: TRUNCATE_ICON,
			onClick: (): void => {
				const table: string | null = $activeTable.get();

				if (table !== null) {
					truncateTableNamed(table);
				}
			},
		});
		const refresh: core.BoxRenderable = IconButton.make({
			icon: REFRESH_ICON,
			onClick: SHORTCUTS.refresh.run,
		});
		const close: core.BoxRenderable = IconButton.make({
			icon: CLOSE_ICON,
			onClick: SHORTCUTS.closeTab.run,
		});
		const right: core.BoxRenderable = new core.BoxRenderable(ctx, {
			flexDirection: "row",
			justifyContent: "flex-end",
			flexShrink: 0,
		});

		if (production) {
			right.add(
				new core.TextRenderable(ctx, {
					content: PRODUCTION_LABEL,
					fg: theme.danger,
					attributes: core.TextAttributes.BOLD,
					marginX: 1,
					selectable: false,
				}),
			);
		}

		actions.add(refresh);
		actions.add(truncate);
		actions.add(close);

		this._component.add(actions);
		this._component.add(
			NoticeText.make({
				flexShrink: 1,
				fallback: describeActiveTab,
				redrawOn: [$activeTab, $activeTableData, $queryResults, $markedRows],
			}),
		);
		this._component.add(right);

		// With no tab open there is nothing to act on, so the buttons hide, and
		// without the mark the text is centred alone, kept off the edges. The
		// boxes stay, so the mark keeps the text centred.
		unbindOnDestroy(
			this._component,
			$activeTab.subscribe((tab: Tab | null): void => {
				const empty: boolean = tab === null && !production;

				refresh.visible = tab !== null;
				truncate.visible = tab?.kind === "table";
				close.visible = tab !== null;
				this._component.justifyContent = empty ? "center" : "space-between";
				this._component.paddingX = empty ? 1 : 0;
			}),
		);
	}

	public static make(options: core.BoxOptions = {}): core.BoxRenderable {
		return new this(options)._component;
	}
}
