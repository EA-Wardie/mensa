import * as core from "@opentui/core";
import { ctx } from "./context";
import { errorMessage } from "./format";
import { logError } from "./log";

// Made on the first copy, since the renderer doesn't exist when this loads.
let clipboard: core.ClipboardService | null = null;

function service(): core.ClipboardService {
	clipboard ??= core.createClipboard({
		host: core.createHostClipboard(),
		terminal: core.createRendererClipboardAdapter(ctx),
	});

	return clipboard;
}

// Why the text couldn't be copied, or null once it was.
async function write(text: string): Promise<string | null> {
	try {
		const result: core.ClipboardWriteResult = await service().writeText(text, {
			destination: "best-available",
		});

		if (
			result.host.status === "written" ||
			(result.terminal.status === "attempted" &&
				result.terminal.capability !== "unsupported")
		) {
			return null;
		}

		if (result.host.status === "failed") {
			logError(result.host.error);

			return errorMessage(result.host.error);
		}

		return "no clipboard is available";
	} catch (error) {
		logError(error);

		return errorMessage(error);
	}
}

// Copies the text to the system clipboard, or through the terminal with OSC
// 52 when there is none, resolving to the error, or null once copied. A
// terminal that doesn't say whether it supports OSC 52 is trusted, since
// there is no way to tell it ignored the copy.
export async function copyText(text: string): Promise<string | null> {
	const reason: string | null = await write(text);

	return reason === null ? null : `Could not copy: ${reason}`;
}

// The service owns the host clipboard, so it is disposed before quitting.
export async function disposeClipboard(): Promise<void> {
	await clipboard?.dispose();
	clipboard = null;
}
