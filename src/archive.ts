import { version } from "../package.json";

// The built binaries that are released, each archived with the install script
// and the icon.
const PLATFORMS: readonly string[] = ["darwin-arm64", "linux-x64"];

const SHARED_FILES: readonly string[] = ["install.sh", "icon.png"];

async function archive(platform: string): Promise<string> {
	const binary: string = `mensa-${platform}`;
	const name: string = `Release-${platform} ${version}.tar.xz`;

	for (const file of [binary, ...SHARED_FILES]) {
		if (!(await Bun.file(`./dist/${file}`).exists())) {
			throw new Error(`dist/${file} not found. Run \`bun run build\` first.`);
		}
	}

	// Each argument is passed as is, so the space in the name needs no quoting.
	await Bun.$`tar -cJf ${`./dist/${name}`} -C ./dist ${binary} ${SHARED_FILES}`;

	return name;
}

Promise.all(PLATFORMS.map(archive))
	.then((names: string[]): void => {
		for (const name of names) {
			console.log(`Archived dist/${name}`);
		}
	})
	.catch((error): void => {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	});
