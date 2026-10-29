import * as core from "@opentui/core";
import { copyToClipboard } from "../lib/actions";
import { theme } from "../lib/config";
import {
	CANCEL_ICON,
	COPY_ICON,
	EDIT_ICON,
	JSON_INDENT,
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
import { afterLayout, unbindOnDestroy } from "../lib/lifetime";
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
import { Sidebar, type SidebarParts, TITLE_WIDTH } from "./Sidebar";

// The same width, so the label doesn't shift.
const COPY_LABEL: string = ` ${COPY_ICON} Copy `;

const COPIED_LABEL: string = " Copied ";

// How long a copy button says Copied, in milliseconds.
const COPIED_TIMEOUT: number = 1500;

// JSON is pretty printed and highlighted: a json column's values, which the
// database has checked, and text that holds an object or an array.
function isJsonValue(value: string, kind: TypeKind): boolean {
	return kind === "json" || (/^\s*[[{]/.test(value) && isJson(value));
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
				content: displayLines(reformatJson(value, JSON_INDENT)),
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

// A column's field, built once and refilled for each row: its label, with a
// copy button for the value, and the value under it.
interface ViewerField {
	copy: core.TextRenderable;
	value: core.BoxRenderable;
	kind: TypeKind;
	// The value shown, so an unchanged one isn't drawn again.
	shown: Value | undefined;
}

function showCopy(button: core.TextRenderable, copied: boolean): void {
	button.content = copied ? COPIED_LABEL : COPY_LABEL;
	button.fg = copied ? theme.fg_inverse : theme.muted;
	button.bg = copied ? theme.accent : theme.input_bg;
}

// Copies the field's value as the database gave it, and says so for a moment.
// Drawn like the editor's NULL toggles, and hidden while the value is NULL.
function copyButton(field: () => ViewerField): core.TextRenderable {
	let timer: Timer | undefined;
	const button: core.TextRenderable = new core.TextRenderable(ctx, {
		content: COPY_LABEL,
		fg: theme.muted,
		bg: theme.input_bg,
		selectable: false,
		onMouseDown: (event: core.MouseEvent): void => {
			const value: Value | undefined = field().shown;

			if (event.button !== core.MouseButton.LEFT || typeof value !== "string") {
				return;
			}

			copyToClipboard(value, (): void => {
				if (button.isDestroyed) {
					return;
				}

				showCopy(button, true);

				clearTimeout(timer);
				timer = setTimeout((): void => {
					if (!button.isDestroyed) {
						showCopy(button, false);
					}
				}, COPIED_TIMEOUT);
			});
		},
	});

	unbindOnDestroy(button, (): void => {
		clearTimeout(timer);
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
	private _fields: ViewerField[];

	constructor(target: ViewerTarget, source: GridSource) {
		this._target = target;
		this._source = source;

		const sidebar: SidebarParts = Sidebar.make({
			title: new core.TextRenderable(ctx, {
				content: fitText(
					`${VIEW_ICON} ${displayText(tabLabel(target.tab))}`,
					TITLE_WIDTH,
				),
				fg: theme.fg,
				attributes: core.TextAttributes.BOLD,
				selectable: false,
			}),
			onClose: closeViewer,
		});

		this._component = sidebar.root;
		this._scroll = sidebar.scroll;
		this._fields = this.addFields();
		this.addFooter(sidebar.footer);
		this.fill();
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
			// only refills the values.
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

	private addFields(): ViewerField[] {
		const { columns, kinds, meta }: GridSource = this._source;

		return columns.map((column: string, index: number): ViewerField => {
			const root: core.BoxRenderable = new core.BoxRenderable(ctx, {
				id: `viewer-field-${index}`,
				width: "100%",
				flexDirection: "column",
				flexShrink: 0,
				marginBottom: 1,
			});
			const label: core.BoxRenderable = new core.BoxRenderable(ctx, {
				width: "100%",
				flexDirection: "row",
				justifyContent: "space-between",
			});
			const field: ViewerField = {
				copy: copyButton((): ViewerField => field),
				value: new core.BoxRenderable(ctx, {
					width: "100%",
					flexDirection: "column",
				}),
				kind: kinds[index] ?? "other",
				shown: undefined,
			};

			label.add(
				fieldHeading({
					column: column,
					typeLabel: meta?.columns.get(column)?.typeLabel ?? "",
					isKey: meta?.primaryKey.includes(column) ?? false,
					width: FIELD_WIDTH - Bun.stringWidth(COPY_LABEL) - 1,
				}).root,
			);
			label.add(field.copy);
			root.add(label);
			root.add(field.value);
			this._scroll.add(root);

			return field;
		});
	}

	// Only a table's rows can be edited.
	private addFooter(footer: core.BoxRenderable): void {
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

		footer.add(Sidebar.spacer());
		footer.add(
			Button.make({
				label: `${CANCEL_ICON} Close`,
				onClick: closeViewer,
			}),
		);
	}

	// Draws the target row's values that differ from those shown.
	private fill(): void {
		const row: Value[] = this._target.rows[this._target.row] ?? [];

		this._fields.forEach((field: ViewerField, index: number): void => {
			const value: Value = row[index] ?? null;

			if (value === field.shown) {
				return;
			}

			for (const view of field.value.getChildren()) {
				view.destroyRecursively();
			}

			for (const view of valueView(value, field.kind)) {
				field.value.add(view);
			}

			field.shown = value;
			field.copy.visible = value !== null;
			showCopy(field.copy, false);
		});
	}

	// Shows another row, or the same one at another column. A new row keeps
	// the scroll position unless it names a column.
	private show(target: ViewerTarget): void {
		const moved: boolean = target.row !== this._target.row;

		this._target = target;

		if (moved) {
			this.fill();
		}

		this.reveal(target.column);
	}

	private reveal(column: string | null): void {
		const index: number =
			column === null ? -1 : this._source.columns.indexOf(column);

		if (index >= 0) {
			afterLayout(this._component, (): void => {
				this._scroll.scrollChildIntoView(`viewer-field-${index}`);
			});
		}
	}
}
