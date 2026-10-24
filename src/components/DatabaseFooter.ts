import * as core from "@opentui/core";
import { version } from "../../package.json";
import { rowLimit, theme } from "../lib/config";
import { ctx } from "../lib/context";
import { plural } from "../lib/format";
import {
	$activeTab,
	$activeTableData,
	$queryResults,
	type QueryResult,
	type Tab,
	type TableData,
} from "../lib/store";
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

		this._component = new core.BoxRenderable(ctx, {
			border: ["top", "bottom"],
			borderColor: theme.border,
			bottomTitle: ` v${version} `,
			bottomTitleAlignment: "right",
			flexDirection: "row",
			justifyContent: "center",
			flexShrink: 0,
			paddingX: 1,
			...this._options,
		});

		this._component.add(
			NoticeText.make({
				fallback: describeActiveTab,
				redrawOn: [$activeTab, $activeTableData, $queryResults],
			}),
		);
	}

	public static make(options: core.BoxOptions = {}): core.BoxRenderable {
		return new this(options)._component;
	}
}
