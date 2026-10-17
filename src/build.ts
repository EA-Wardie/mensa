import { version } from "../package.json";

const TARGETS: readonly Bun.Build.CompileTarget[] = [
	"bun-linux-x64",
	"bun-linux-arm64",
	"bun-darwin-x64",
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

Promise.all(TARGETS.map(build))
	.then(async (): Promise<void> => {
		await Bun.write("./dist/install.sh", Bun.file("./scripts/install.sh"));
		await Bun.$`chmod +x ./dist/install.sh`;

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
