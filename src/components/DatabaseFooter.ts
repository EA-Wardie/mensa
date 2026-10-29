import * as core from "@opentui/core";
import { version } from "../../package.json";
import { truncateTableNamed } from "../lib/actions";
import { rowLimit, theme } from "../lib/config";
import { CLOSE_ICON, REFRESH_ICON, TRUNCATE_ICON } from "../lib/consts";
import { ctx } from "../lib/context";
import { plural } from "../lib/format";
import { unbindOnDestroy } from "../lib/lifetime";
import { SHORTCUTS } from "../lib/shortcuts";
import {
	$activeTab,
	$activeTable,
	$activeTableData,
	$queryResults,
	type QueryResult,
	type Tab,
	type TableData,
} from "../lib/store";
import { Divider } from "./Divider";
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

function describeActiveTab(): string {
	const tab: Tab | null = $activeTab.get();

	return tab?.kind === "query"
		? describeQuery($queryResults.get()[tab.id])
		: describeTable($activeTableData.get());
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

		// The buttons and their divider are one box, so they stay together, and
		// an empty box that follows its width on the right keeps the text
		// centred.
		const actions: core.BoxRenderable = new core.BoxRenderable(ctx, {
			flexDirection: "row",
			flexShrink: 0,
			onSizeChange: (): void => {
				spacer.width = actions.width;
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
		const spacer: core.BoxRenderable = new core.BoxRenderable(ctx, {
			flexShrink: 0,
		});

		actions.add(
			IconButton.make({
				icon: REFRESH_ICON,
				onClick: SHORTCUTS.refresh.run,
			}),
		);
		actions.add(truncate);
		actions.add(
			IconButton.make({
				icon: CLOSE_ICON,
				onClick: SHORTCUTS.closeTab.run,
			}),
		);
		actions.add(Divider.make({ vertical: true, joined: true }));

		this._component.add(actions);
		this._component.add(
			NoticeText.make({
				flexShrink: 1,
				fallback: describeActiveTab,
				redrawOn: [$activeTab, $activeTableData, $queryResults],
			}),
		);
		this._component.add(spacer);

		// With no tab open there is nothing to act on, so the text is centred
		// alone, kept off the edges.
		unbindOnDestroy(
			this._component,
			$activeTab.subscribe((tab: Tab | null): void => {
				actions.visible = tab !== null;
				spacer.visible = tab !== null;
				truncate.visible = tab?.kind === "table";
				this._component.justifyContent =
					tab === null ? "center" : "space-between";
				this._component.paddingX = tab === null ? 1 : 0;
			}),
		);
	}

	public static make(options: core.BoxOptions = {}): core.BoxRenderable {
		return new this(options)._component;
	}
}
