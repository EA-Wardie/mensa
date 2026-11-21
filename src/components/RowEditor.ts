import * as core from "@opentui/core";
import { theme } from "../lib/config";
import { CANCEL_ICON, EDIT_ICON, SAVE_ICON, VIEW_ICON } from "../lib/consts";
import { ctx } from "../lib/context";
import { type RowChange, updateRow } from "../lib/database";
import {
	closeEditor,
	confirmDiscard,
	type EditorData,
	editorData,
	isSameRow,
} from "../lib/editor";
import { displayText, fitText } from "../lib/format";
import { afterLayout, unbindOnDestroy } from "../lib/lifetime";
import {
	$dialogOpen,
	$editor,
	$editorDirty,
	$notice,
	clearNotice,
	type EditorTarget,
	type Value,
} from "../lib/store";
import { reloadTable } from "../lib/tabs";
import { viewRow } from "../lib/viewer";
import { Button } from "./Button";
import { type Field, makeField } from "./EditorField";
import { Sidebar, type SidebarParts, TITLE_WIDTH } from "./Sidebar";

// A sidebar that edits one row of the active table, or of a query's results
// from one table, with a field per column.
// Its keys are its own while it's open, so the global shortcuts pause.
export class RowEditor {
	private _target: EditorTarget;
	private _data: EditorData;
	private _readOnly: string | null;
	private _component: core.BoxRenderable;
	private _title: core.TextRenderable;
	private _scroll: core.ScrollBoxRenderable;
	private _footer: core.BoxRenderable;
	private _status: core.TextRenderable;
	private _statusBox: core.BoxRenderable;
	private _fields: Field[] = [];
	// The fields whose value differs from the row's, kept as each one changes,
	// so a keystroke only checks its own field.
	private _changed: Set<Field> = new Set<Field>();
	private _lastFocused: Field | null = null;
	private _saving: boolean = false;

	constructor(target: EditorTarget, data: EditorData) {
		this._target = target;
		this._data = data;
		this._readOnly = data.meta.readOnly;

		this._title = new core.TextRenderable(ctx, {
			content: "",
			fg: theme.fg,
			attributes: core.TextAttributes.BOLD,
			selectable: false,
		});

		const sidebar: SidebarParts = Sidebar.make({
			title: this._title,
			onClose: (): void => {
				this.cancel();
			},
		});

		this._component = sidebar.root;
		this._scroll = sidebar.scroll;
		this._footer = sidebar.footer;

		this._status = new core.TextRenderable(ctx, {
			content: "",
			fg: theme.danger,
			wrapMode: "word",
		});

		this._statusBox = new core.BoxRenderable(ctx, {
			flexShrink: 0,
			paddingX: 1,
			visible: false,
		});

		this._statusBox.add(this._status);

		// Under the fields, above the footer.
		this._component.add(this._statusBox, 2);
		this.addFields();
		this.addFooter();
		this.updateTitle();
		this.registerEvents();
		this.focusColumn(target.column);
	}

	// A box beside the grid that holds the editor while a row is open. The
	// editor module closes it once the row is gone, such as after a reload.
	public static host(): core.BoxRenderable {
		const host: core.BoxRenderable = new core.BoxRenderable(ctx, {
			height: "100%",
			flexShrink: 0,
		});
		let editor: RowEditor | null = null;

		const sync: (target: EditorTarget | null) => void = (
			target: EditorTarget | null,
		): void => {
			// The same row asked for again, by a double click or E, only moves the
			// focus.
			if (editor && target && isSameRow(editor._target, target)) {
				editor._target = target;
				editor.focusColumn(target.column);

				return;
			}

			const data: EditorData | null =
				target === null ? null : editorData(target);

			editor?.close();
			editor = null;

			if (target && data) {
				editor = new RowEditor(target, data);
				host.add(editor._component);
			}
		};

		unbindOnDestroy(host, $editor.subscribe(sync));

		return host;
	}

	private addFields(): void {
		const row: Value[] = this._data.rows[this._target.row] ?? [];
		const primaryKey: string[] = this._data.meta.primaryKey;

		if (this._readOnly) {
			this._scroll.add(
				new core.TextRenderable(ctx, {
					content: displayText(this._readOnly),
					fg: theme.muted,
					wrapMode: "word",
					marginBottom: 1,
				}),
			);
		}

		this._fields = this._data.columns.map(
			(column: string, index: number): Field => {
				const source: string | null = this._data.sources[index] ?? null;
				const shown: string | null = this._data.shown[index] ?? null;
				const field: Field = makeField({
					column: column,
					meta:
						source === null ? undefined : this._data.meta.columns.get(source),
					value: row[index] ?? null,
					index: index,
					editable: this._readOnly === null,
					isKey: source !== null && primaryKey.includes(source),
					...(source === null
						? {
								readOnly:
									shown === null
										? "Not a column of the table, so it isn't saved."
										: `Shows ${displayText(shown)} again, which is saved in its first field.`,
							}
						: {}),
					onChange: (changed: Field): void => {
						this.updateDirty(changed);
					},
					onFocus: (focused: Field): void => {
						this._lastFocused = focused;

						this.reveal(focused);
					},
				});

				this._scroll.add(field.root);

				return field;
			},
		);
	}

	private addFooter(): void {
		const footer: core.BoxRenderable = this._footer;

		// Viewing the row asks first when it has unsaved changes.
		footer.add(
			Button.make({
				label: `${VIEW_ICON} View`,
				onClick: (): void => {
					viewRow(
						this._target.row,
						this._lastFocused === null
							? null
							: this._fields.indexOf(this._lastFocused),
					);
				},
			}),
		);
		footer.add(Sidebar.spacer());
		footer.add(
			Button.make({
				label: `${CANCEL_ICON} ${this._readOnly === null ? "Cancel" : "Close"}`,
				onClick: (): void => {
					this.cancel();
				},
			}),
		);

		if (this._readOnly === null) {
			footer.add(
				Button.make({
					label: `${SAVE_ICON} Save`,
					variant: "success",
					onClick: (): void => {
						this.save();
					},
				}),
			);
		}
	}

	private registerEvents(): void {
		ctx.keyInput.on("keypress", this.onKeypress);

		unbindOnDestroy(this._component, (): void => {
			ctx.keyInput.off("keypress", this.onKeypress);
		});
	}

	// Runs before the focused field, so these keys never reach it.
	private onKeypress = (key: core.KeyEvent): void => {
		if ($dialogOpen.get()) {
			return;
		}

		if (key.name === "escape") {
			key.preventDefault();
			this.cancel();
		} else if (key.name === "tab") {
			key.preventDefault();
			this.cycleFocus(key.shift ? -1 : 1);
		} else if (key.ctrl && key.name === "s") {
			key.preventDefault();
			this.save();
		} else if (key.ctrl && key.name === "n") {
			key.preventDefault();
			this._lastFocused?.toggleNull();
		}
	};

	private editableFields(): Field[] {
		return this._fields.filter(
			(field: Field): boolean => field.control !== null,
		);
	}

	// Focuses the field of the column at the index, or the first editable one.
	private focusColumn(column: number | null): void {
		const field: Field | undefined =
			column === null ? undefined : this._fields[column];

		(field?.control ?? this.editableFields()[0]?.control)?.focus();
	}

	private cycleFocus(step: number): void {
		const editable: Field[] = this.editableFields();
		const index: number =
			this._lastFocused === null ? -1 : editable.indexOf(this._lastFocused);
		const next: number =
			index < 0 && step < 0
				? editable.length - 1
				: (index + step + editable.length) % editable.length;

		editable[next]?.control?.focus();
	}

	private reveal(field: Field): void {
		afterLayout(this._component, (): void => {
			this._scroll.scrollChildIntoView(field.root.id);
		});
	}

	// In column order, named as the table names them.
	private changes(): RowChange[] {
		return this._fields.flatMap((field: Field, index: number): RowChange[] =>
			this._changed.has(field)
				? [
						{
							column: this._data.sources[index] ?? field.column,
							value: field.value(),
						},
					]
				: [],
		);
	}

	private updateDirty(field: Field): void {
		const dirty: boolean = this._changed.size > 0;

		if (field.changed()) {
			this._changed.add(field);
		} else {
			this._changed.delete(field);
		}

		if (dirty !== this._changed.size > 0) {
			$editorDirty.set(!dirty);
			this.updateTitle();
		}
	}

	private updateTitle(): void {
		const dirty: string = $editorDirty.get() ? " •" : "";

		this._title.content = `${fitText(`${EDIT_ICON} ${displayText(this._target.table)}`, TITLE_WIDTH)}${dirty}`;
	}

	private showStatus(text: string): void {
		this._status.content = displayText(text);
		this._statusBox.visible = text !== "";
	}

	private cancel(): void {
		confirmDiscard();
	}

	private async save(): Promise<void> {
		if (this._saving || this._readOnly !== null) {
			return;
		}

		// Every field shows its error, and the first takes the focus.
		const invalid: Field | undefined = this._fields
			.filter((field: Field): boolean => field.validate() !== null)
			.at(0);

		if (invalid) {
			invalid.control?.focus();
			this.reveal(invalid);

			return;
		}

		const changes: RowChange[] = this.changes();

		if (!changes.length) {
			closeEditor();

			return;
		}

		this._saving = true;
		this.showStatus("");
		clearNotice();

		const error: string | null = await updateRow(this._target, changes);

		this._saving = false;

		// The editor closed while saving, so the footer reports the failure.
		if (this._component.isDestroyed) {
			if (error) {
				$notice.set(`Could not save the row: ${error}`);
			}

			return;
		}

		if (error) {
			this.showStatus(error);

			return;
		}

		closeEditor();

		// A query's row was saved to a table, which may be open in a tab.
		if (this._target.tab.kind === "query") {
			reloadTable(this._target.table);
		}
	}

	// Blurs the focused field first, since destroying it would leave the
	// renderer pointing at it.
	private close(): void {
		if (this._component.hasFocusedDescendant) {
			ctx.currentFocusedRenderable?.blur();
		}

		this._component.destroyRecursively();
	}
}
