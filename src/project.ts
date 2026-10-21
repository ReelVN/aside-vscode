import * as path from "node:path";
import { stat } from "node:fs/promises";

async function isFile(file: string): Promise<boolean> {
    try {
        const info = await stat(file);
        return info.isFile();
    } catch (error: unknown) {
        if (typeof error === "object" && error !== null && "code" in error
            && (error.code === "ENOENT" || error.code === "ENOTDIR")) return false;
        throw error;
    }
}

/** Find the nearest conventional project without scanning its resource tree. */
export async function findProjectRoot(directory: string): Promise<string | undefined> {
    let current = path.resolve(directory);
    while (true) {
        if (await isFile(path.join(current, "src", "main.aside"))) return current;
        const parent = path.dirname(current);
        if (parent === current) return undefined;
        current = parent;
    }
}

/** Select saved file buffers owned by a project, including nested source files. */
export function containsFile(root: string, file: string): boolean {
    const relative = path.relative(root, file);
    return !path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`);
}
