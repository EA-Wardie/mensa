import { version } from "../package.json";

interface Release {
	platform: string;
	format: "tar.xz" | "zip";
	// Each file in dist, by its name in the archive.
	files: Record<string, string>;
}

// The built binaries that are released, each with its platform's install script
// as install.sh. macOS gets Mensa.app, which holds the binary and the icon.
const RELEASES: readonly Release[] = [
	{
		platform: "darwin-arm64",
		format: "zip",
		files: { "Mensa.app": "Mensa.app", "install.sh": "minstall.sh" },
	},
	{
		platform: "linux-x64",
		format: "tar.xz",
		files: {
			"mensa-linux-x64": "mensa-linux-x64",
			"icon.png": "icon.png",
			"install.sh": "linstall.sh",
		},
	},
];

async function archive(release: Release): Promise<string> {
	const name: string = `Release-${release.platform} ${version}.${release.format}`;
	const stage: string = `./dist/.stage-${release.platform}`;
	const entries: [string, string][] = Object.entries(release.files);

	for (const [, file] of entries) {
		// test -e, since Mensa.app is a folder.
		if ((await Bun.$`test -e ${`./dist/${file}`}`.nothrow()).exitCode !== 0) {
			throw new Error(`dist/${file} not found. Run \`bun run build\` first.`);
		}
	}

	await Bun.$`rm -rf ${stage}`;
	await Bun.$`mkdir -p ${stage}`;

	try {
		for (const [archived, file] of entries) {
			await Bun.$`cp -R ${`./dist/${file}`} ${`${stage}/${archived}`}`;
		}

		const names: string[] = entries.map(
			([archived]: [string, string]): string => archived,
		);
		// Run from the stage, so the archive holds the files without its path.
		// Each argument is passed as is, so the space in the name needs no quoting.
		const output: string = `../${name}`;

		if (release.format === "zip") {
			// zip adds to an existing archive, so start a new one.
			await Bun.$`rm -f ${output}`.cwd(stage);
			await Bun.$`zip -qry ${output} ${names}`.cwd(stage);
		} else {
			await Bun.$`tar -cJf ${output} ${names}`.cwd(stage);
		}
	} finally {
		await Bun.$`rm -rf ${stage}`;
	}

	return name;
}

Promise.all(RELEASES.map(archive))
	.then((names: string[]): void => {
		for (const name of names) {
			console.log(`Archived dist/${name}`);
		}
	})
	.catch((error): void => {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	});
