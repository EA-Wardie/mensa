import * as core from "@opentui/core";
import * as nanostores from "nanostores";
import {
	type ConnectionConfig,
	connectionDot,
	connectionGroups,
	connectionLabel,
	describeConnection,
	theme,
} from "../lib/config";
import {
	APP_LOGO,
	APP_TITLE,
	CONNECTIONS_WIDTH,
	USER_CONFIG_PATH,
} from "../lib/consts";
import { ctx } from "../lib/context";
import { unbindOnDestroy } from "../lib/lifetime";
import { connect } from "../lib/session";
import { SHORTCUTS, shortcutLabel } from "../lib/shortcuts";
import { $connecting, $connections, $selectedConnection } from "../lib/store";
import { Divider } from "./Divider";
import { List } from "./List";
import { Message } from "./Message";
import { NoticeText } from "./NoticeText";

const HINT: string = `${shortcutLabel(SHORTCUTS.connect)} to connect · ${shortcutLabel(SHORTCUTS.quit)} to quit`;

const EMPTY_PANEL_HEIGHT: number = 8;

// The header, the footer and their borders.
const PANEL_CHROME_HEIGHT: number = 6;

// The screen's padding on each side.
const SCREEN_PADDING: number = 1;

// The rows between the logo and the panel.
const LOGO_GAP: number = 1;

const LOGO_LINES: string[] = APP_LOGO.split("\n");

const LOGO_HEIGHT: number = LOGO_LINES.length;

const LOGO_WIDTH: number = Math.max(
	...LOGO_LINES.map((line: string): number => Bun.stringWidth(line)),
);

export class ConnectionsScreen {
	private _component: core.BoxRenderable;
	private _panel: core.BoxRenderable;
	private _logo: core.TextRenderable;
	private _groups: nanostores.ReadableAtom<ConnectionConfig[]>[];

	constructor() {
		// The config lists the groups in this order too, so the selection steps
		// through them as they're shown.
		this._groups = connectionGroups($connections.get()).map(
			(
				group: ConnectionConfig[],
			): nanostores.ReadableAtom<ConnectionConfig[]> =>
				nanostores.atom<ConnectionConfig[]>(group),
		);

		this._component = new core.BoxRenderable(ctx, {
			width: "100%",
			height: "100%",
			flexDirection: "column",
			alignItems: "center",
			justifyContent: "center",
			padding: SCREEN_PADDING,
		});

		this._logo = new core.TextRenderable(ctx, {
			content: APP_LOGO,
			fg: theme.fg,
			flexShrink: 0,
			marginBottom: LOGO_GAP,
			selectable: false,
		});

		this._panel = new core.BoxRenderable(ctx, {
			width: CONNECTIONS_WIDTH,
			maxWidth: "100%",
			height: this.panelHeight(),
			maxHeight: "100%",
			border: true,
			borderColor: theme.border,
			flexDirection: "column",
		});

		this.addHeader();
		this.addBody();
		this.addFooter();

		this._component.add(this._logo);
		this._component.add(this._panel);

		this.registerResize();
	}

	public static make(): core.BoxRenderable {
		return new this()._component;
	}

	// A row per connection, and one for the divider between the groups.
	private panelHeight(): number {
		const count: number = $connections.get().length;

		return count
			? count + this._groups.length - 1 + PANEL_CHROME_HEIGHT
			: EMPTY_PANEL_HEIGHT;
	}

	// The logo shows only while the whole panel fits under it.
	private registerResize(): void {
		const fit: (width: number, height: number) => void = (
			width: number,
			height: number,
		): void => {
			this._logo.visible =
				width >= LOGO_WIDTH + SCREEN_PADDING * 2 &&
				height >=
					LOGO_HEIGHT + LOGO_GAP + this.panelHeight() + SCREEN_PADDING * 2;
		};

		fit(ctx.width, ctx.height);
		ctx.on(core.CliRenderEvents.RESIZE, fit);

		unbindOnDestroy(this._component, (): void => {
			ctx.off(core.CliRenderEvents.RESIZE, fit);
		});
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

		this._groups.forEach(
			(
				group: nanostores.ReadableAtom<ConnectionConfig[]>,
				index: number,
			): void => {
				if (index > 0) {
					this._panel.add(Divider.make());
				}

				// Both lists share the selection, so it shows in one of them.
				this._panel.add(
					List.make<ConnectionConfig>({
						height: group.get().length,
						minHeight: 1,
						flexShrink: 1,
						width: "100%",
						items: group,
						selected: $selectedConnection,
						label: (connection: ConnectionConfig): string => connection.name,
						icon: connectionDot,
						detail: describeConnection,
						onActivate: (connection: ConnectionConfig): void => {
							connect(connection);
						},
					}),
				);
			},
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

					return connecting
						? `Connecting to ${connectionLabel(connecting)}…`
						: HINT;
				},
				fallbackColor: theme.muted,
				redrawOn: [$connecting],
			}),
		);
		this._panel.add(footer);
	}
}
