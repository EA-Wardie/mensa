import { App } from "./components/App";
import { makeApp } from "./lib/context";
import { registerKeyboardShortcuts } from "./lib/shortcuts";

function main() {
	makeApp((): void => {
		registerKeyboardShortcuts();

		App.make({
			components: [],
		});
	});
}

main();
