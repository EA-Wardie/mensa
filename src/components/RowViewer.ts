import * as core from "@opentui/core";
import { copyToClipboard } from "../lib/actions";
import { theme } from "../lib/config";
import {
	CANCEL_ICON,
	CLOSE_ICON,
	COPY_ICON,
	EDIT_ICON,
	EDITOR_WIDTH,
	VIEW_ICON,
	VIEW_MAX_LENGTH,
} from "../lib/consts";
import { ctx } from "../lib/context";
import { editRow } from "../lib/editor";
import {
	displayLines,
	displayText,
	fitText,
	isJson,
	NULL_TEXT,
	reformatJson,
} from "../lib/format";
import type { GridSource } from "../lib/grid";
import { unbindOnDestroy } from "../lib/lifetime";
import {
	$viewer,
	type TypeKind,
	type Value,
	type ViewerTarget,
} from "../lib/store";
import { syntaxStyles } from "../lib/syntax";
import { tabLabel } from "../lib/tabs";
import { closeViewer, viewerSource } from "../lib/viewer";
import { Button } from "./Button";
import { FIELD_WIDTH, fieldHeading } from "./EditorField";
import { IconButton } from "./IconButton";

// The same width, so the label doesn't shift.
const COPY_LABEL: string = ` ${COPY_ICON} Copy `;

const COPIED_LABEL: string = " Copied ";

// How long a copy button says Copied, in milliseconds.
const COPIED_TIMEOUT: number = 1500;

// The title's room, beside the close button.
const TITLE_WIDTH: number = EDITOR_WIDTH - 8;

// JSON is pretty printed and highlighted: a json column's values, and text
// that holds an object or an array.
function isJsonValue(value: string, kind: TypeKind): boolean {
	return (kind === "json" || /^\s*[[{]/.test(value)) && isJson(value);
}

// A value in full, wrapped, or its start when it's very long.
function valueView(value: Value, kind: TypeKind): core.Renderable[] {
	if (value === null) {
		return [
			new core.TextRenderable(ctx, {
				content: NULL_TEXT,
				fg: theme.muted,
				attributes: core.TextAttributes.ITALIC,
			}),
		];
	}

	if (value.length > VIEW_MAX_LENGTH) {
		return [
			new core.TextRenderable(ctx, {
				content: displayLines(value.slice(0, VIEW_MAX_LENGTH)),
				fg: theme.fg,
				wrapMode: "word",
			}),
			new core.TextRenderable(ctx, {
				content: `Showing the first ${VIEW_MAX_LENGTH.toLocaleString()} of ${value.length.toLocaleString()} characters.`,
				fg: theme.muted,
				wrapMode: "word",
				selectable: false,
			}),
		];
	}

	if (isJsonValue(value, kind)) {
		// Highlighted once the tree-sitter worker has parsed it, and drawn plain
		// until then.
		return [
			new core.CodeRenderable(ctx, {
				width: "100%",
				content: displayLines(reformatJson(value, "  ")),
				filetype: "javascript",
				syntaxStyle: syntaxStyles(),
				fg: theme.fg,
				wrapMode: "word",
			}),
		];
	}

	return [
		new core.TextRenderable(ctx, {
			content: displayLines(value),
			fg: theme.fg,
			wrapMode: "word",
		}),
	];
}

// Copies a value as the database gave it, and says so for a moment. Drawn
// like the editor's NULL toggles.
function copyButton(value: string): core.TextRenderable {
	let timer: Timer | undefined;
	const button: core.TextRenderable = new core.TextRenderable(ctx, {
		content: COPY_LABEL,
		fg: theme.muted,
		bg: theme.input_bg,
		selectable: false,
		onMouseDown: (event: core.MouseEvent): void => {
			if (event.button !== core.MouseButton.LEFT) {
				return;
			}

			copyToClipboard(value, (): void => {
				if (button.isDestroyed) {
					return;
				}

				button.content = COPIED_LABEL;
				button.fg = theme.fg_inverse;
				button.bg = theme.accent;

				clearTimeout(timer);
				timer = setTimeout((): void => {
					if (!button.isDestroyed) {
						button.content = COPY_LABEL;
						button.fg = theme.muted;
						button.bg = theme.input_bg;
					}
				}, COPIED_TIMEOUT);
			});
		},
	});

	return button;
}

// A read only sidebar that shows one row of the active tab, a table's or a
// query's, with each value in full. It leaves the keys to the shortcuts, so
// the view follows the grid's selection.
export class RowViewer {
	private _target: ViewerTarget;
	private _source: GridSource;
	private _component: core.BoxRenderable;
	private _scroll: core.ScrollBoxRenderable;

	constructor(target: ViewerTarget, source: GridSource) {
		this._target = target;
		this._source = source;

		this._component = new core.BoxRenderable(ctx, {
			width: EDITOR_WIDTH,
			height: "100%",
			flexShrink: 0,
			flexDirection: "column",
			border: ["right"],
			borderColor: theme.border,
		});

		this._scroll = new core.ScrollBoxRenderable(ctx, {
			flexGrow: 1,
			scrollY: true,
			scrollX: false,
			contentOptions: {
				flexDirection: "column",
				paddingX: 1,
				paddingTop: 1,
			},
			verticalScrollbarOptions: {
				trackOptions: {
					foregroundColor: theme.scrollbar_thumb,
					backgroundColor: theme.scrollbar_track,
				},
			},
		});

		// The view never takes the focus, so the shortcuts keep working.
		this._scroll.focusable = false;
		this._scroll.verticalScrollBar.focusable = false;
		this._scroll.horizontalScrollBar.focusable = false;

		this.addHeader();
		this.addFields();
		this._component.add(this._scroll);
		this.addFooter();
		this.reveal(target.column);
	}

	// A box beside the grid that holds the view while a row is shown. The
	// viewer module closes it once the row is gone, such as after a reload.
	public static host(): core.BoxRenderable {
		const host: core.BoxRenderable = new core.BoxRenderable(ctx, {
			height: "100%",
			flexShrink: 0,
		});
		let viewer: RowViewer | null = null;

		const sync: (target: ViewerTarget | null) => void = (
			target: ViewerTarget | null,
		): void => {
			// Another row of the same rows, as the view follows the selection,
			// only refills the fields.
			if (
				viewer &&
				target &&
				viewer._target.tab === target.tab &&
				viewer._target.rows === target.rows
			) {
				viewer.show(target);

				return;
			}

			const source: GridSource | null =
				target === null ? null : viewerSource(target);

			viewer?._component.destroyRecursively();
			viewer = null;

			if (target && source) {
				viewer = new RowViewer(target, source);
				host.add(viewer._component);
			}
		};

		unbindOnDestroy(host, $viewer.subscribe(sync));

		return host;
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
					`${VIEW_ICON} ${displayText(tabLabel(this._target.tab))}`,
					TITLE_WIDTH,
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
				onClick: closeViewer,
			}),
		);

		this._component.add(header);
	}

	private addFields(): void {
		const { columns, kinds, meta }: GridSource = this._source;
		const row: Value[] = this._target.rows[this._target.row] ?? [];

		columns.forEach((column: string, index: number): void => {
			const field: core.BoxRenderable = new core.BoxRenderable(ctx, {
				id: `viewer-field-${index}`,
				width: "100%",
				flexDirection: "column",
				flexShrink: 0,
				marginBottom: 1,
			});

			const value: Value = row[index] ?? null;
			const label: core.BoxRenderable = new core.BoxRenderable(ctx, {
				width: "100%",
				flexDirection: "row",
				justifyContent: "space-between",
			});

			label.add(
				fieldHeading({
					column: column,
					typeLabel: meta?.columns.get(column)?.typeLabel ?? "",
					isKey: meta?.primaryKey.includes(column) ?? false,
					width: FIELD_WIDTH - Bun.stringWidth(COPY_LABEL) - 1,
				}).root,
			);

			if (value !== null) {
				label.add(copyButton(value));
			}

			field.add(label);

			for (const view of valueView(value, kinds[index] ?? "other")) {
				field.add(view);
			}

			this._scroll.add(field);
		});
	}

	// Only a table's rows can be edited.
	private addFooter(): void {
		const footer: core.BoxRenderable = new core.BoxRenderable(ctx, {
			border: ["top", "bottom"],
			borderColor: theme.border,
			flexDirection: "row",
			columnGap: 1,
			flexShrink: 0,
			paddingX: 1,
		});

		if (this._target.tab.kind === "table") {
			footer.add(
				Button.make({
					label: `${EDIT_ICON} Edit`,
					onClick: (): void => {
						editRow(this._target.row, this._target.column);
					},
				}),
			);
		}

		footer.add(new core.BoxRenderable(ctx, { flexGrow: 1 }));
		footer.add(
			Button.make({
				label: `${CANCEL_ICON} Close`,
				onClick: closeViewer,
			}),
		);

		this._component.add(footer);
	}

	// Shows another row, or the same one at another column. A new row keeps
	// the scroll position unless it names a column.
	private show(target: ViewerTarget): void {
		const moved: boolean = target.row !== this._target.row;
		const top: number = this._scroll.scrollTop;

		this._target = target;

		if (moved) {
			for (const field of this._scroll.content.getChildren()) {
				field.destroyRecursively();
			}

			this.addFields();
		}

		if (target.column !== null) {
			this.reveal(target.column);
		} else if (moved) {
			this.afterLayout((): void => {
				this._scroll.scrollTop = top;
			});
		}
	}

	private reveal(column: string | null): void {
		const index: number =
			column === null ? -1 : this._source.columns.indexOf(column);

		if (index >= 0) {
			this.afterLayout((): void => {
				this._scroll.scrollChildIntoView(`viewer-field-${index}`);
			});
		}
	}

	// Runs now and after the next frame, since new fields have no layout until
	// they have been rendered.
	private afterLayout(action: () => void): void {
		const run: () => void = (): void => {
			if (!this._component.isDestroyed) {
				action();
			}
		};

		run();
		ctx.once(core.CliRenderEvents.FRAME, run);
		ctx.requestRender();
	}
}
