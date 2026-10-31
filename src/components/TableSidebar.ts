import * as core from "@opentui/core";
import {
	dropAllTables,
	dropTableNamed,
	switchTo,
	truncateAllTables,
	truncateTableNamed,
} from "../lib/actions";
import {
	type ConnectionConfig,
	connectionDot,
	connectionGroups,
	theme,
} from "../lib/config";
import {
	APP_TITLE,
	CLOSE_ICON,
	DATABASE_ICON,
	DELETE_ICON,
	MENU_ICON,
	QUERY_ICON,
	REFRESH_ICON,
	SIDEBAR_WIDTH,
	SWITCH_ICON,
	TRUNCATE_ICON,
} from "../lib/consts";
import { ctx } from "../lib/context";
import { confirmDiscard, confirmDiscardIf } from "../lib/editor";
import { displayText, fitText } from "../lib/format";
import type { Icon } from "../lib/icon";
import { unbindOnDestroy } from "../lib/lifetime";
import { copyNameItem } from "../lib/menuItems";
import { SHORTCUTS, shortcutLabel } from "../lib/shortcuts";
import {
	$activeTable,
	$connection,
	$connections,
	$openTables,
	$schema,
	$selectedTable,
	$tables,
} from "../lib/store";
import { newQuery, openTable, refreshTable } from "../lib/tabs";
import { Divider } from "./Divider";
import { IconButton } from "./IconButton";
import { List } from "./List";
import { Menu, type MenuEntry, type MenuItem } from "./Menu";
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
		this.addDatabaseHeader();
		this.addTables();
	}

	public static make(options: core.BoxOptions = {}): core.BoxRenderable {
		return new this(options)._component;
	}

	private addHeader(): void {
		const header: core.BoxRenderable = new core.BoxRenderable(ctx, {
			border: ["top"],
			borderColor: theme.border,
			flexDirection: "row",
			justifyContent: "space-between",
			flexShrink: 0,
			paddingLeft: 1,
		});

		header.add(
			new core.TextRenderable(ctx, {
				content: APP_TITLE,
				fg: theme.fg,
				attributes: core.TextAttributes.BOLD,
				selectable: false,
			}),
		);

		this._component.add(header);
	}

	private addDatabaseHeader(): void {
		const header: core.BoxRenderable = new core.BoxRenderable(ctx, {
			border: ["top", "bottom"],
			borderColor: theme.border,
			flexDirection: "row",
			justifyContent: "space-between",
			flexShrink: 0,
			paddingLeft: 1,
			onMouseDown: (event: core.MouseEvent): void => {
				if (event.button === core.MouseButton.RIGHT) {
					this.showConnectionMenu(event.x, event.y);
				}
			},
		});

		const connection: ConnectionConfig | null = $connection.get();
		const dot: Icon | null = connection ? connectionDot(connection) : null;
		const title: core.BoxRenderable = new core.BoxRenderable(ctx, {
			flexDirection: "row",
			gap: 1,
		});

		if (dot) {
			title.add(
				new core.TextRenderable(ctx, {
					content: dot.icon,
					fg: dot.color,
					selectable: false,
				}),
			);
		}

		// The name leaves room for the sidebar's borders, the padding, the dot
		// and its gap, a gap, the divider and the menu button.
		title.add(
			new core.TextRenderable(ctx, {
				content: fitText(
					`${DATABASE_ICON} ${displayText(connection?.name ?? "")}`,
					SIDEBAR_WIDTH - 8 - (dot ? Bun.stringWidth(dot.icon) + 1 : 0),
				),
				fg: theme.fg,
				attributes: core.TextAttributes.BOLD,
				selectable: false,
			}),
		);
		header.add(title);

		const buttons: core.BoxRenderable = new core.BoxRenderable(ctx, {
			flexDirection: "row",
			flexShrink: 0,
		});
		// The menu opens under the button.
		const menu: core.BoxRenderable = IconButton.make({
			icon: MENU_ICON,
			onClick: (): void => {
				this.showConnectionMenu(menu.screenX, menu.screenY);
			},
		});

		buttons.add(Divider.make({ vertical: true, joined: true }));
		buttons.add(menu);
		header.add(buttons);

		this._component.add(header);
	}

	// The message shows while there are no tables, such as after dropping them
	// all.
	private addTables(): void {
		const empty: core.BoxRenderable = new core.BoxRenderable(ctx, {
			paddingX: 1,
		});
		const schema: string = $schema.get();
		const list: List<string> = List.make<string>({
			flexGrow: 1,
			width: "100%",
			items: $tables,
			selected: $selectedTable,
			label: (table: string): string => `󰓫 ${table}`,
			bold: (table: string): boolean => $openTables.get().includes(table),
			redrawOn: [$openTables],
			// Another table's tab would close the row editor.
			onActivate: (table: string): void => {
				confirmDiscardIf(table !== $activeTable.get(), (): void =>
					openTable(table),
				);
			},
			onMenu: (table: string, x: number, y: number): void => {
				this.showTableMenu(table, x, y);
			},
		});

		empty.add(
			Message.make({
				content: schema
					? `No tables in ${displayText(schema)}`
					: "Could not list tables",
			}),
		);
		this._component.add(empty);
		this._component.add(list);

		unbindOnDestroy(
			this._component,
			$tables.subscribe((tables: readonly string[]): void => {
				empty.visible = !tables.length;
				list.visible = tables.length > 0;
			}),
		);
	}

	private showTableMenu(table: string, x: number, y: number): void {
		Menu.make({
			x: x,
			y: y,
			items: [
				// Reloading the table, or leaving the edited row for it, replaces
				// the row.
				{
					label: `${REFRESH_ICON} Refresh`,
					onSelect: (): void => {
						confirmDiscard((): void => refreshTable(table));
					},
				},
				copyNameItem(table),
				"divider",
				{
					label: `${TRUNCATE_ICON} Truncate`,
					danger: true,
					onSelect: (): void => {
						truncateTableNamed(table);
					},
				},
				{
					label: `${DELETE_ICON} Delete`,
					danger: true,
					onSelect: (): void => {
						dropTableNamed(table);
					},
				},
			],
		});
	}

	private showConnectionMenu(x: number, y: number): void {
		const others: ConnectionConfig[] = $connections
			.get()
			.filter(
				(connection: ConnectionConfig): boolean =>
					connection !== $connection.get(),
			);

		Menu.make({
			x: x,
			y: y,
			items: [
				{
					label: `${QUERY_ICON} New query`,
					shortcut: shortcutLabel(SHORTCUTS.newQuery),
					onSelect: (): void => {
						confirmDiscard(newQuery);
					},
				},
				{
					label: `${REFRESH_ICON} Refresh`,
					shortcut: shortcutLabel(SHORTCUTS.refreshSchema),
					onSelect: SHORTCUTS.refreshSchema.run,
				},
				"divider",
				...(others.length
					? [
							{
								label: `${SWITCH_ICON} Switch`,
								shortcut: "›",
								onSelect: (): void => {
									this.showConnectionsMenu(others, x, y);
								},
							},
						]
					: []),
				{
					label: `${CLOSE_ICON} Close`,
					shortcut: shortcutLabel(SHORTCUTS.disconnect),
					onSelect: SHORTCUTS.disconnect.run,
				},
				"divider",
				{
					label: `${TRUNCATE_ICON} Truncate all`,
					danger: true,
					onSelect: truncateAllTables,
				},
				{
					label: `${DELETE_ICON} Drop all`,
					danger: true,
					onSelect: dropAllTables,
				},
			],
		});
	}

	// A divider splits the production connections from the rest.
	private showConnectionsMenu(
		connections: ConnectionConfig[],
		x: number,
		y: number,
	): void {
		Menu.make({
			x: x,
			y: y,
			items: connectionGroups(connections).flatMap(
				(group: ConnectionConfig[], index: number): MenuEntry[] => [
					...(index > 0 ? ["divider" as const] : []),
					...group.map(
						(connection: ConnectionConfig): MenuItem => ({
							label: `${DATABASE_ICON} ${connection.name}`,
							icon: (highlighted: boolean): Icon =>
								connectionDot(connection, highlighted),
							onSelect: (): void => {
								switchTo(connection);
							},
						}),
					),
				],
			),
		});
	}
}
