import { copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

const source = process.argv[2];
const repository = process.argv[3];
if (!source || !repository || !["reel-lsp", "reel-lsp.exe"].includes(basename(source))) {
    throw new Error("Usage: node scripts/bundle-server.mjs /path/to/reel-lsp[.exe] /path/to/reel");
}
if (!(await stat(source)).isFile()) throw new Error("The server path must be a file.");
await mkdir("server", { recursive: true });
await copyFile(source, join("server", basename(source)));
const notices = [];
for (const name of ["aside-syntax", "reel-ui", "reel-text", "reel-audio"]) {
    const directory = join(repository, "crates", name);
    notices.push(name, "=".repeat(60));
    for (const file of (await readdir(directory)).filter(file => /^(LICENSE|NOTICE|PROVENANCE)(\.|-|$)/i.test(file))) {
        notices.push(await readFile(join(directory, file), "utf8"));
    }
}
await writeFile(join("server", "ThirdPartyNotices.txt"), notices.join("\n\n"));
