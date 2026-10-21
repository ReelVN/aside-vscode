import { build } from "esbuild";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

await build({
  entryPoints: ["src/extension.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  outfile: "dist/extension.js",
  external: ["vscode"],
  sourcemap: false,
  minify: false,
  legalComments: "eof",
});

const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
const notices = [];
for (const [directory, entry] of Object.entries(lock.packages)) {
  if (!directory || entry.dev) continue;
  const files = (await readdir(directory)).filter(name => /^(licen[cs]e|copying|notice)(\.|$|-)/i.test(name));
  if (files.length === 0) throw new Error(`Missing dependency license: ${directory}`);
  const packageInfo = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
  notices.push(`${packageInfo.name} ${entry.version}\n${"=".repeat(60)}`);
  for (const file of files) notices.push(await readFile(join(directory, file), "utf8"));
}
await writeFile("ThirdPartyNotices.txt", notices.join("\n\n"));
