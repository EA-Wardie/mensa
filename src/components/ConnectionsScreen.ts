import * as core from "@opentui/core";
import {
	type ConnectionConfig,
	describeConnection,
	theme,
} from "../lib/config";
import { APP_TITLE, CONNECTIONS_WIDTH, USER_CONFIG_PATH } from "../lib/consts";
import { ctx } from "../lib/context";
import { connect } from "../lib/session";
import { SHORTCUTS, shortcutLabel } from "../lib/shortcuts";
import { $connecting, $connections, $selectedConnection } from "../lib/store";
import { List } from "./List";
import { Message } from "./Message";
import { NoticeText } from "./NoticeText";

const HINT: string = `${shortcutLabel(SHORTCUTS.connect)} to connect · ${shortcutLabel(SHORTCUTS.quit)} to quit`;

const EMPTY_PANEL_HEIGHT: number = 8;

// The header, the footer and their borders.
const PANEL_CHROME_HEIGHT: number = 6;

export class ConnectionsScreen {
	private _component: core.BoxRenderable;
	private _panel: core.BoxRenderable;

	constructor() {
		this._component = new core.BoxRenderable(ctx, {
			width: "100%",
			height: "100%",
			alignItems: "center",
			justifyContent: "center",
			padding: 1,
		});

		this._panel = new core.BoxRenderable(ctx, {
			width: CONNECTIONS_WIDTH,
			maxWidth: "100%",
			height: $connections.get().length
				? $connections.get().length + PANEL_CHROME_HEIGHT
				: EMPTY_PANEL_HEIGHT,
			maxHeight: "100%",
			border: true,
			borderColor: theme.border,
			flexDirection: "column",
		});

		this.addHeader();
		this.addBody();
		this.addFooter();

		this._component.add(this._panel);
	}

	public static make(): core.BoxRenderable {
		return new this()._component;
	}

	private addHeader(): void {
		const header: core.BoxRenderable = new core.BoxRenderable(ctx, {
			border: ["bottom"],
			borderColor: theme.border,
			flexDirection: "row",
			justifyContent: "space-between",
			flexShrink: 0,
			paddingX: 1,
		});

		header.add(
			new core.TextRenderable(ctx, {
				content: APP_TITLE,
				fg: theme.fg,
				attributes: core.TextAttributes.BOLD,
				selectable: false,
			}),
		);

		header.add(
			new core.TextRenderable(ctx, {
				content: "Connections",
				fg: theme.muted,
				selectable: false,
			}),
		);

		this._panel.add(header);
	}

	private addBody(): void {
		if (!$connections.get().length) {
			const empty: core.BoxRenderable = new core.BoxRenderable(ctx, {
				flexGrow: 1,
				paddingX: 1,
			});

			empty.add(
				Message.make({
					content: `No connections. Add a [[connections]] entry to ${USER_CONFIG_PATH}`,
				}),
			);

			this._panel.add(empty);

			return;
		}

		this._panel.add(
			List.make<ConnectionConfig>({
				flexGrow: 1,
				flexShrink: 1,
				width: "100%",
				items: $connections,
				selected: $selectedConnection,
				label: (connection: ConnectionConfig): string => connection.name,
				detail: describeConnection,
				onActivate: (connection: ConnectionConfig): void => {
					connect(connection);
				},
			}),
		);
	}

	private addFooter(): void {
		const footer: core.BoxRenderable = new core.BoxRenderable(ctx, {
			border: ["top"],
			borderColor: theme.border,
			flexShrink: 0,
			paddingX: 1,
		});

		footer.add(
			NoticeText.make({
				fallback: (): string => {
					const connecting: ConnectionConfig | null = $connecting.get();

					return connecting ? `Connecting to ${connecting.name}…` : HINT;
				},
				fallbackColor: theme.muted,
				redrawOn: [$connecting],
			}),
		);
		this._panel.add(footer);
	}
}
