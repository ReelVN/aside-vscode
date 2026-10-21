import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { build } from "esbuild";

const result = await build({ entryPoints: ["src/project.ts"], bundle: true, write: false, platform: "node", format: "esm" });
const { findProjectRoot, containsFile } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);

async function fixture(t) {
    const parent = path.resolve(tmpdir());
    const root = await mkdtemp(path.join(parent, "aside-project-"));
    t.after(async () => {
        assert.equal(path.dirname(root), parent);
        assert.ok(path.basename(root).startsWith("aside-project-"));
        await rm(root, { recursive: true });
    });
    return root;
}

test("nested source files belong to the ancestor with src/main.aside", async t => {
    const root = await fixture(t);
    await mkdir(path.join(root, "src", "ui"), { recursive: true });
    await mkdir(path.join(root, "resources"));
    await writeFile(path.join(root, "src", "main.aside"), "fn main(){}\n");
    await writeFile(path.join(root, "src", "ui", "main.aside"), "fn main(){}\n");
    assert.equal(await findProjectRoot(path.join(root, "src", "ui")), root);
    assert.equal(await findProjectRoot(path.join(root, "src")), root);
    assert.equal(await findProjectRoot(root), root);
    assert.ok(containsFile(root, path.join(root, "src", "ui", "page.aside")));
    assert.ok(!containsFile(root, path.join(`${root}-other`, "main.aside")));
});

test("root-level main files do not establish projects and nearest src entries win", async t => {
    const root = await fixture(t);
    await writeFile(path.join(root, "main.aside"), "fn main(){}\n");
    assert.equal(await findProjectRoot(root), undefined);
    const nested = path.join(root, "作品 with spaces");
    await mkdir(path.join(nested, "src", "story"), { recursive: true });
    await writeFile(path.join(nested, "src", "main.aside"), "fn main(){}\n");
    assert.equal(await findProjectRoot(path.join(nested, "src", "story")), nested);
    await mkdir(path.join(root, "src"));
    await writeFile(path.join(root, "src", "main.aside"), "fn main(){}\n");
    assert.equal(await findProjectRoot(root), root);
    assert.equal(await findProjectRoot(path.join(nested, "src", "story")), nested);
});

test("standalone files do not create a project or scan neighboring source trees", async t => {
    const root = await fixture(t);
    await mkdir(path.join(root, "other", "src"), { recursive: true });
    await writeFile(path.join(root, "other", "src", "main.aside"), "fn main(){}\n");
    assert.equal(await findProjectRoot(root), undefined);
    assert.equal(await findProjectRoot(path.join(root, "other", "src")), path.join(root, "other"));
});
