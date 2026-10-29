import * as core from "@opentui/core";
import { atom, type ReadableAtom, type WritableAtom } from "nanostores";
import { theme } from "../lib/config";
import {
	CHOICE_MAX_ROWS,
	EDITOR_WIDTH,
	INPUT_MAX_LENGTH,
	JSON_INDENT,
	KEY_ICON,
	TEXTAREA_MAX_ROWS,
	TEXTAREA_MIN_ROWS,
} from "../lib/consts";
import { ctx } from "../lib/context";
import {
	displayText,
	errorMessage,
	fitText,
	isJson,
	NULL_TEXT,
	reformatJson,
} from "../lib/format";
import { clamp } from "../lib/math";
import { type ColumnMeta, moveSelection, type Value } from "../lib/store";
import { List } from "./List";

// A field of the row editor, for one column of the row.
export interface Field {
	readonly column: string;
	readonly root: core.BoxRenderable;
	// What takes the focus, or null when the field can't be edited.
	readonly control: core.Renderable | null;
	// The value to save. An untouched field gives back the original exactly.
	value(): Value;
	changed(): boolean;
	// Shows and returns why the value can't be saved, or clears it.
	validate(): string | null;
	toggleNull(): void;
}

interface Options {
	column: string;
	// Undefined when the column wasn't described, which leaves it read only.
	meta: ColumnMeta | undefined;
	value: Value;
	index: number;
	// False when the row can't be saved, which leaves every field read only.
	editable: boolean;
	isKey: boolean;
	onChange: (field: Field) => void;
	onFocus: (field: Field) => void;
}

interface ChoiceOption {
	value: Value;
	label: string;
	detail: string;
}

// The editor's border, the scrollbar and the content's padding.
export const FIELD_WIDTH: number = EDITOR_WIDTH - 4;

const NULL_TOGGLE: string = " NULL ";

// Read only values are cut to this many characters, so a large value doesn't
// make the field the height of the screen.
const READ_ONLY_LENGTH: number = 500;

// Control characters other than tabs and newlines, which the edit buffer would
// draw raw.
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching them is the point.
const UNEDITABLE_CHARACTERS: RegExp = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/;

function prettyJson(value: string): string {
	return isJson(value) ? reformatJson(value, JSON_INDENT) : value;
}

// The rows a text takes when wrapped to the field, counted only up to the
// textarea's limit, since a large value would otherwise be measured whole.
function wrappedRows(text: string): number {
	let rows: number = 0;

	for (const line of text.split(/\r?\n/, TEXTAREA_MAX_ROWS)) {
		rows += Math.max(1, Math.ceil(Bun.stringWidth(line) / FIELD_WIDTH));

		if (rows >= TEXTAREA_MAX_ROWS) {
			break;
		}
	}

	return rows;
}

interface HeadingOptions {
	column: string;
	// The type as the database names it, or empty for none.
	typeLabel: string;
	isKey: boolean;
	// The room for the name and the type.
	width: number;
}

interface FieldHeading {
	root: core.BoxRenderable;
	name: core.TextRenderable;
}

// A field's name in bold, after a key icon for a primary key column, and its
// type in muted text when there's room.
export function fieldHeading({
	column,
	typeLabel,
	isKey,
	width,
}: HeadingOptions): FieldHeading {
	const key: string = isKey ? `${KEY_ICON} ` : "";
	const fitted: string = fitText(key + displayText(column), width);
	const typeWidth: number = width - Bun.stringWidth(fitted) - 1;
	const root: core.BoxRenderable = new core.BoxRenderable(ctx, {
		flexDirection: "row",
		columnGap: 1,
	});
	const name: core.TextRenderable = new core.TextRenderable(ctx, {
		content: fitted,
		fg: theme.fg,
		attributes: core.TextAttributes.BOLD,
		selectable: false,
	});

	root.add(name);

	if (typeLabel && typeWidth > 0) {
		root.add(
			new core.TextRenderable(ctx, {
				content: fitText(displayText(typeLabel), typeWidth),
				fg: theme.muted,
				selectable: false,
			}),
		);
	}

	return { root: root, name: name };
}

// The label row and error line every field has, around its control.
abstract class BaseField implements Field {
	public readonly column: string;
	public readonly root: core.BoxRenderable;
	public abstract readonly control: core.Renderable | null;
	protected _options: Options;
	protected _label: core.BoxRenderable;
	protected _name: core.TextRenderable;
	protected _error: core.TextRenderable;

	constructor(options: Options) {
		this._options = options;
		this.column = options.column;

		this.root = new core.BoxRenderable(ctx, {
			id: `editor-field-${options.index}`,
			width: "100%",
			flexDirection: "column",
			flexShrink: 0,
			marginBottom: 1,
		});

		this._label = new core.BoxRenderable(ctx, {
			width: "100%",
			flexDirection: "row",
			justifyContent: "space-between",
			onMouseDown: (): void => {
				this.focus();
			},
		});

		const heading: FieldHeading = fieldHeading({
			column: options.column,
			typeLabel: options.meta?.typeLabel ?? "",
			isKey: options.isKey,
			width: FIELD_WIDTH - NULL_TOGGLE.length - 1,
		});

		this._name = heading.name;
		this._label.add(heading.root);

		this._error = new core.TextRenderable(ctx, {
			content: "",
			fg: theme.danger,
			wrapMode: "word",
			visible: false,
		});

		this.root.add(this._label);
	}

	public abstract value(): Value;

	public changed(): boolean {
		return this.value() !== this._options.value;
	}

	public validate(): string | null {
		return null;
	}

	public toggleNull(): void {}

	// Adds the control under the label, with the error line under it.
	protected mount(control: core.Renderable): void {
		this.root.add(control);
		this.root.add(this._error);
	}

	protected focus(): void {
		this.control?.focus();
	}

	protected showError(error: string | null): void {
		this._error.content = displayText(error ?? "");
		this._error.visible = error !== null;
	}

	// The name is in the accent colour while the field has the focus.
	protected trackFocus(control: core.Renderable): void {
		control.on(core.RenderableEvents.FOCUSED, (): void => {
			this._name.fg = theme.accent;

			this._options.onFocus(this);
		});
		control.on(core.RenderableEvents.BLURRED, (): void => {
			this._name.fg = theme.fg;
		});
	}
}

// An input, or a textarea for long, multi-line and json values. NULL is a
// state of its own, so an empty text and the text NULL stay strings.
class TextField extends BaseField {
	public readonly control: core.TextareaRenderable;
	private _json: boolean;
	private _multiline: boolean;
	private _nullable: boolean;
	private _isNull: boolean;
	private _initialText: string;
	private _originalCompact: string | null = null;
	private _textBeforeNull: string = "";
	private _toggle: core.TextRenderable | null = null;

	constructor(options: Options, json: boolean, multiline: boolean) {
		super(options);

		const original: Value = options.value;
		const text: string =
			original === null ? "" : json ? prettyJson(original) : original;
		const placeholder: string = original === null ? NULL_TEXT : "";
		const shared: core.TextareaOptions = {
			width: "100%",
			backgroundColor: theme.input_bg,
			focusedBackgroundColor: theme.input_focused_bg,
			textColor: theme.fg,
			focusedTextColor: theme.fg,
			cursorColor: theme.fg,
			placeholderColor: theme.muted,
			onContentChange: (): void => {
				this.onContentChange();
			},
		};

		this._json = json;
		this._multiline = multiline;
		this._nullable = options.meta?.nullable ?? false;
		this._isNull = original === null;

		this.control = multiline
			? new core.TextareaRenderable(ctx, {
					...shared,
					placeholder: placeholder,
					initialValue: text,
					wrapMode: "word",
					height: clamp(
						wrappedRows(text),
						TEXTAREA_MIN_ROWS,
						TEXTAREA_MAX_ROWS,
					),
				})
			: new core.InputRenderable(ctx, {
					...shared,
					placeholder: placeholder,
					value: text,
					// The default of 1000 would cut longer values.
					maxLength: Number.MAX_SAFE_INTEGER,
				});

		// The buffer may normalise the text, such as \r\n, so the field counts as
		// untouched while it holds what it started with.
		this._initialText = this.control.plainText;

		if (this._nullable) {
			this.addToggle();
		}

		this.trackFocus(this.control);
		this.mount(this.control);
	}

	public value(): Value {
		const original: Value = this._options.value;
		const text: string = this.control.plainText;

		if (this._isNull) {
			return null;
		}

		if (original !== null && text === this._initialText) {
			return original;
		}

		if (!this._json) {
			return text;
		}

		// Only reindenting isn't a change.
		const compact: string = reformatJson(text, "");

		this._originalCompact ??=
			original === null ? null : reformatJson(original, "");

		return compact === this._originalCompact ? original : compact;
	}

	public override validate(): string | null {
		let error: string | null = null;

		if (this._json && !this._isNull) {
			try {
				JSON.parse(this.control.plainText);
			} catch (exception) {
				error = `Invalid JSON: ${errorMessage(exception)}`;
			}
		}

		this.showError(error);

		return error;
	}

	// Emptying the field for NULL keeps its text, so toggling back restores it.
	public override toggleNull(): void {
		if (!this._nullable) {
			return;
		}

		if (this._isNull) {
			this._isNull = false;
			this.control.setText(this._textBeforeNull);
		} else {
			this._textBeforeNull = this.control.plainText;
			this._isNull = true;
			this.control.setText("");
		}

		this.update();
	}

	private addToggle(): void {
		this._toggle = new core.TextRenderable(ctx, {
			content: NULL_TOGGLE,
			selectable: false,
			onMouseDown: (event: core.MouseEvent): void => {
				// The label would focus the field before the toggle.
				event.stopPropagation();

				this.toggleNull();
				this.focus();
			},
		});

		this._label.add(this._toggle);
		this.updateToggle();
	}

	private onContentChange(): void {
		// Typing into a NULL field makes it a value again.
		if (this._isNull && this.control.plainText !== "") {
			this._isNull = false;
		}

		this.update();
	}

	private update(): void {
		this.control.placeholder = this._isNull ? NULL_TEXT : "";

		// A textarea grows with its text, up to a limit.
		if (this._multiline) {
			this.control.height = clamp(
				this.control.virtualLineCount,
				TEXTAREA_MIN_ROWS,
				TEXTAREA_MAX_ROWS,
			);
		}

		this.updateToggle();
		this._options.onChange(this);
	}

	private updateToggle(): void {
		if (!this._toggle) {
			return;
		}

		this._toggle.fg = this._isNull ? theme.fg_inverse : theme.muted;
		this._toggle.bg = this._isNull ? theme.accent : theme.input_bg;
	}
}

// A list of a bool's or an enum's values, which a click or the arrow keys
// pick from. A nullable column also has NULL.
class ChoiceField extends BaseField {
	public readonly control: core.BoxRenderable;
	private _items: ReadableAtom<readonly ChoiceOption[]>;
	private _selected: WritableAtom<ChoiceOption | null>;

	constructor(options: Options, values: string[], labels: string[]) {
		super(options);

		const choices: ChoiceOption[] = values.map(
			(value: string, index: number): ChoiceOption => ({
				value: value,
				label: value,
				detail: labels[index] ?? "",
			}),
		);

		if (options.meta?.nullable) {
			choices.push({ value: null, label: NULL_TEXT, detail: "" });
		}

		this._items = atom<readonly ChoiceOption[]>(choices);
		this._selected = atom<ChoiceOption | null>(
			choices.find(
				(choice: ChoiceOption): boolean => choice.value === options.value,
			) ?? null,
		);

		this.control = new core.BoxRenderable(ctx, {
			width: "100%",
			height: Math.min(choices.length, CHOICE_MAX_ROWS),
			backgroundColor: theme.input_bg,
			onKeyDown: (key: core.KeyEvent): void => {
				this.handleKey(key);
			},
		});

		this.control.focusable = true;

		this.control.on(core.RenderableEvents.FOCUSED, (): void => {
			this.control.backgroundColor = theme.input_focused_bg;
		});
		this.control.on(core.RenderableEvents.BLURRED, (): void => {
			this.control.backgroundColor = theme.input_bg;
		});

		this.control.add(
			List.make<ChoiceOption>({
				width: "100%",
				height: "100%",
				items: this._items,
				selected: this._selected,
				label: (choice: ChoiceOption): string => choice.label,
				detail: (choice: ChoiceOption): string => choice.detail,
				bold: (): boolean => false,
				onActivate: (): void => {},
			}),
		);

		this._selected.listen((): void => {
			this._options.onChange(this);
		});

		this.trackFocus(this.control);
		this.mount(this.control);
	}

	public value(): Value {
		const selected: ChoiceOption | null = this._selected.get();

		// The NULL option's value is null, so only no selection keeps the original.
		return selected ? selected.value : this._options.value;
	}

	public override toggleNull(): void {
		const option: ChoiceOption | undefined = this._items
			.get()
			.find((choice: ChoiceOption): boolean => choice.value === null);

		if (option) {
			this._selected.set(option);
		}
	}

	private handleKey(key: core.KeyEvent): void {
		const count: number = this._items.get().length;
		const step: number | undefined = {
			up: -1,
			k: -1,
			down: 1,
			j: 1,
			home: -count,
			end: count,
		}[key.name];

		if (step === undefined) {
			return;
		}

		key.preventDefault();
		moveSelection(this._items, this._selected, step);
	}
}

// The value as text, with why it can't be edited.
class ReadOnlyField extends BaseField {
	public readonly control: null = null;

	constructor(options: Options, reason: string) {
		super(options);

		const value: Value = options.value;

		this.root.add(
			new core.TextRenderable(ctx, {
				content:
					value === null
						? NULL_TEXT
						: // Sliced first, so a large value isn't escaped whole.
							fitText(
								displayText(value.slice(0, READ_ONLY_LENGTH * 2)),
								READ_ONLY_LENGTH,
							),
				fg: value === null ? theme.muted : theme.fg,
				attributes:
					value === null
						? core.TextAttributes.ITALIC
						: core.TextAttributes.NONE,
				wrapMode: "char",
			}),
		);

		if (reason) {
			this.root.add(
				new core.TextRenderable(ctx, {
					content: reason,
					fg: theme.muted,
					wrapMode: "word",
				}),
			);
		}
	}

	public value(): Value {
		return this._options.value;
	}
}

// Picks the field for a column from its metadata and its value.
export function makeField(options: Options): Field {
	const { meta, value }: Options = options;

	if (!options.editable || !meta) {
		return new ReadOnlyField(options, "");
	}

	if (meta.edit.as === "readonly") {
		return new ReadOnlyField(options, meta.edit.reason);
	}

	if (value !== null && UNEDITABLE_CHARACTERS.test(value)) {
		return new ReadOnlyField(
			options,
			"Contains control characters, which can't be edited here.",
		);
	}

	if (meta.edit.as === "choice") {
		// A value outside the choices, such as 5 in a MySQL tinyint(1), is
		// edited as text instead.
		if (value === null || meta.edit.options.includes(value)) {
			return new ChoiceField(options, meta.edit.options, meta.edit.labels);
		}

		return new TextField(options, false, false);
	}

	if (meta.edit.as === "json") {
		return new TextField(options, true, true);
	}

	const multiline: boolean =
		meta.edit.long ||
		(value !== null &&
			(/[\r\n]/.test(value) || value.length > INPUT_MAX_LENGTH));

	return new TextField(options, false, multiline);
}
