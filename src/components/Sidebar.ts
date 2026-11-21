import * as core from "@opentui/core";
import { theme } from "../lib/config";
import { CLOSE_ICON, EDITOR_WIDTH } from "../lib/consts";
import { ctx } from "../lib/context";
import { IconButton } from "./IconButton";
import { RuleScrollBar } from "./RuleScrollBar";

// The title's room, beside the close button and a marker after the title.
export const TITLE_WIDTH: number = EDITOR_WIDTH - 8;

interface Options {
	title: core.Renderable;
	onClose: () => void;
}

export interface SidebarParts {
	root: core.BoxRenderable;
	scroll: core.ScrollBoxRenderable;
	footer: core.BoxRenderable;
}

// The frame the row editor and the row view share beside the grid: a header
// with the title and a close button, a body that scrolls, and a footer for
// buttons. The body never takes the focus, so clicking around it leaves the
// focus where it is.
export class Sidebar {
	private _parts: SidebarParts;

	constructor({ title, onClose }: Options) {
		const root: core.BoxRenderable = new core.BoxRenderable(ctx, {
			width: EDITOR_WIDTH,
			height: "100%",
			flexShrink: 0,
			flexDirection: "column",
			border: ["left"],
			borderColor: theme.border,
		});

		const header: core.BoxRenderable = new core.BoxRenderable(ctx, {
			border: ["bottom"],
			borderColor: theme.border,
			flexDirection: "row",
			justifyContent: "space-between",
			flexShrink: 0,
			paddingLeft: 1,
		});

		header.add(title);
		header.add(
			IconButton.make({
				icon: CLOSE_ICON,
				flexShrink: 0,
				onClick: onClose,
			}),
		);

		const scroll: core.ScrollBoxRenderable = new core.ScrollBoxRenderable(ctx, {
			flexGrow: 1,
			scrollY: true,
			scrollX: false,
			contentOptions: {
				flexDirection: "column",
				paddingX: 1,
				paddingTop: 1,
			},
		});

		scroll.focusable = false;
		scroll.verticalScrollBar.focusable = false;
		scroll.horizontalScrollBar.focusable = false;
		// Set by hand, so the box never shows it again. The rule scrollbar
		// takes its sizes instead.
		scroll.verticalScrollBar.visible = false;

		// The body holds the scroll box, and the scrollbar on the window's
		// right border beside it, as the grid's is.
		const body: core.BoxRenderable = new core.BoxRenderable(ctx, {
			flexGrow: 1,
			flexShrink: 1,
		});

		body.add(scroll);
		body.add(
			RuleScrollBar.make({
				orientation: "vertical",
				position: "absolute",
				top: 0,
				right: -1,
				height: "100%",
				follow: scroll.verticalScrollBar,
				onChange: (position: number): void => {
					scroll.scrollTop = position;
				},
			}),
		);

		const footer: core.BoxRenderable = new core.BoxRenderable(ctx, {
			border: ["top"],
			borderColor: theme.border,
			flexDirection: "row",
			columnGap: 1,
			flexShrink: 0,
			paddingX: 1,
		});

		root.add(header);
		root.add(body);
		root.add(footer);

		this._parts = { root, scroll, footer };
	}

	public static make(options: Options): SidebarParts {
		return new this(options)._parts;
	}

	// Pushes the buttons after it to the footer's right.
	public static spacer(): core.BoxRenderable {
		return new core.BoxRenderable(ctx, { flexGrow: 1 });
	}
}
