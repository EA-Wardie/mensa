import { version } from "../package.json";

// The released platforms, each with its install script.
const TARGETS: readonly Bun.Build.CompileTarget[] = [
	"bun-linux-x64",
	"bun-darwin-arm64",
];

async function build(target: Bun.Build.CompileTarget): Promise<void> {
	await Bun.build({
		entrypoints: ["./src/main.ts"],
		compile: {
			target,
			outfile: `./dist/mensa-${target.replace("bun-", "")}`,
			autoloadDotenv: false,
			autoloadBunfig: false,
		},
		minify: true,
		bytecode: true,
		splitting: true,
		format: "esm",
		define: {
			"process.env.NODE_ENV": JSON.stringify("production"),
			VERSION: JSON.stringify(version),
		},
	});
}

// Versions roll over at 9, so this rises by one with every release.
function buildNumber(version: string): number {
	const [major = 0, minor = 0, patch = 0] = version.split(".").map(Number);

	return major * 100 + minor * 10 + patch;
}

// Wraps the macOS binary in Mensa.app, whose launcher opens it in a terminal.
async function buildMacApp(): Promise<void> {
	const app: string = "./dist/Mensa.app/Contents";
	const plist: string = await Bun.file("./assets/Info.plist").text();

	await Bun.$`rm -rf ./dist/Mensa.app`;
	await Bun.$`mkdir -p ${app}/MacOS ${app}/Resources`;
	await Bun.write(`${app}/MacOS/Mensa`, Bun.file("./dist/mensa-darwin-arm64"));
	await Bun.write(`${app}/MacOS/launcher`, Bun.file("./scripts/launcher.sh"));
	await Bun.$`chmod 755 ${app}/MacOS/Mensa ${app}/MacOS/launcher`;
	await Bun.write(
		`${app}/Resources/AppIcon.icns`,
		Bun.file("./assets/icon.icns"),
	);
	await Bun.write(
		`${app}/Info.plist`,
		plist
			.replaceAll("{{VERSION}}", version)
			.replaceAll("{{BUILD}}", String(buildNumber(version))),
	);
}

Promise.all(TARGETS.map(build))
	.then(async (): Promise<void> => {
		for (const script of ["linstall.sh", "minstall.sh"]) {
			await Bun.write(`./dist/${script}`, Bun.file(`./scripts/${script}`));
			await Bun.$`chmod +x ${`./dist/${script}`}`;
		}

		await buildMacApp();

		const icon = Bun.file("./assets/icon.png");

		if (await icon.exists()) {
			await Bun.write("./dist/icon.png", icon);
		}

		console.log("Build successful.");
	})
	.catch((error): void => {
		console.error(error);
		console.error(
			'If a native package is missing, run `bun install --os="*" --cpu="*"`.',
		);
		process.exit(1);
	});
