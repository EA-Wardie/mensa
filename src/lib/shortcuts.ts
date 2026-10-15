import * as core from "@opentui/core";
import { ctx } from "./context";
import { $dialogOpen, $menuOpen } from "./store";

type Run = () => void;

interface Shortcut {
	key: string;
	alias?: string;
	description: string;
	run: Run;
}

export const SHORTCUTS = {
	quit: {
		key: "q",
		description: "Quit the application",
		run: (): void => {
			ctx.destroy();
		},
	},
} satisfies Record<string, Shortcut>;

const SHORTCUT_LIST: Shortcut[] = Object.values(SHORTCUTS);

const KEYMAP: Map<string, Run> = new Map<string, Run>();

for (const { key, alias, run } of SHORTCUT_LIST) {
	KEYMAP.set(key, run);

	if (alias) {
		KEYMAP.set(alias, run);
	}
}

export function shortcutLabel({ key }: Pick<Shortcut, "key">): string {
	return key
		.split("+")
		.map((part: string): string => part[0]?.toUpperCase() + part.slice(1))
		.join("+");
}

export function registerKeyboardShortcuts(): void {
	$dialogOpen.listen((open: boolean): void => {
		if (open) {
			ctx.currentFocusedRenderable?.blur();
		}
	});

	ctx.keyInput.on("keypress", (key: core.KeyEvent): void => {
		if (
			$dialogOpen.get() ||
			$menuOpen.get() ||
			ctx.currentFocusedRenderable instanceof core.InputRenderable ||
			key.meta ||
			key.option
		) {
			return;
		}

		const run: Run | undefined = KEYMAP.get(
			key.ctrl ? `ctrl+${key.name}` : key.name,
		);

		if (run) {
			key.preventDefault();
			run();
		}
	});
}
