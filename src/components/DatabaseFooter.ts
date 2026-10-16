import * as core from "@opentui/core";
import { version } from "../../package.json";
import { rowLimit, theme } from "../lib/config";
import { ctx } from "../lib/context";
import { $activeTableData, type TableData } from "../lib/store";
import { NoticeText } from "./NoticeText";

function describeActiveTable(): string {
	const data: TableData | undefined = $activeTableData.get();

	if (data?.status !== "loaded") {
		return "";
	}

	const limited: string = data.truncated ? ` (first ${rowLimit})` : "";

	return `${plural(data.rows.length, "row")}${limited} · ${plural(data.columns.length, "column")}`;
}

function plural(count: number, noun: string): string {
	return `${count} ${noun}${count === 1 ? "" : "s"}`;
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
				fallback: describeActiveTable,
				redrawOn: [$activeTableData],
			}),
		);
	}

	public static make(options: core.BoxOptions = {}): core.BoxRenderable {
		return new this(options)._component;
	}
}
