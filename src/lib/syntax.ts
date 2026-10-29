import * as core from "@opentui/core";
import { type ThemeType, theme } from "./config";
import { ctx } from "./context";

let styles: core.SyntaxStyle | undefined;

// JSON is highlighted with the JavaScript grammar, since OpenTUI has no JSON
// one, which names its parts as strings, numbers, constants and punctuation.
function createStyles(): core.SyntaxStyle {
	const { string, number, constant }: ThemeType["syntax"] = theme.syntax;

	// Owned by the renderer's scene, so it lives as long as the app.
	return core.SyntaxStyle.fromStyles(
		{
			string: { fg: string },
			number: { fg: number },
			constant: { fg: constant },
			"constant.builtin": { fg: constant },
			punctuation: { fg: theme.fg },
			"punctuation.bracket": { fg: theme.fg },
			"punctuation.delimiter": { fg: theme.muted },
			default: { fg: theme.fg },
		},
		ctx.nativeScene,
	);
}

export function syntaxStyles(): core.SyntaxStyle {
	styles ??= createStyles();

	return styles;
}
