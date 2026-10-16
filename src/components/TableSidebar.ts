import * as core from "@opentui/core";
import { theme } from "../lib/config";
import { CLOSE_ICON, DATABASE_ICON, SIDEBAR_WIDTH } from "../lib/consts";
import { ctx } from "../lib/context";
import { fitText } from "../lib/format";
import { SHORTCUTS } from "../lib/shortcuts";
import {
	$connection,
	$openTables,
	$selectedTable,
	$tables,
} from "../lib/store";
import { openTable } from "../lib/tabs";
import { IconButton } from "./IconButton";
import { List } from "./List";
import { Message } from "./Message";

export class TableSidebar {
	private _options: core.BoxOptions;
	private _component: core.BoxRenderable;

	constructor(options: core.BoxOptions) {
		this._options = options;

		this._component = new core.BoxRenderable(ctx, {
			width: SIDEBAR_WIDTH,
			height: "100%",
			flexShrink: 0,
			border: ["left", "right"],
			borderColor: theme.border,
			...this._options,
		});

		this.addHeader();
		this.addTables();
	}

	public static make(options: core.BoxOptions = {}): core.BoxRenderable {
		return new this(options)._component;
	}

	private addHeader(): void {
		const header: core.BoxRenderable = new core.BoxRenderable(ctx, {
			border: ["top", "bottom"],
			borderColor: theme.border,
			flexDirection: "row",
			justifyContent: "space-between",
			flexShrink: 0,
			paddingLeft: 1,
		});

		header.add(
			new core.TextRenderable(ctx, {
				content: fitText(
					`${DATABASE_ICON} ${$connection.get()?.name ?? ""}`,
					SIDEBAR_WIDTH - 7,
				),
				fg: theme.fg,
				attributes: core.TextAttributes.BOLD,
				selectable: false,
			}),
		);

		header.add(
			IconButton.make({
				icon: CLOSE_ICON,
				flexShrink: 0,
				onClick: SHORTCUTS.disconnect.run,
			}),
		);

		this._component.add(header);
	}

	private addTables(): void {
		if (!$tables.get().length) {
			const empty: core.BoxRenderable = new core.BoxRenderable(ctx, {
				paddingX: 1,
			});

			empty.add(Message.make({ content: "No tables in public" }));
			this._component.add(empty);

			return;
		}

		this._component.add(
			List.make<string>({
				flexGrow: 1,
				width: "100%",
				items: $tables,
				selected: $selectedTable,
				label: (table: string): string => `󰓫 ${table}`,
				bold: (table: string): boolean => $openTables.get().includes(table),
				redrawOn: [$openTables],
				onActivate: openTable,
			}),
		);
	}
}
