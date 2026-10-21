import * as vscode from "vscode";
import * as path from "node:path";
import { access } from "node:fs/promises";
import type { SpawnOptionsWithoutStdio } from "node:child_process";
import { LanguageClient, type LanguageClientOptions, type ServerOptions } from "vscode-languageclient/node";
import { containsFile, findProjectRoot } from "./project";

interface NativeDocument {
    text: string;
    languageId: string;
}

let client: LanguageClient | undefined;
let restart: Promise<void> = Promise.resolve();
let watcher: vscode.FileSystemWatcher | undefined;

async function findInstalledServer(): Promise<string | undefined> {
    const executable = process.platform === "win32" ? "reel-lsp.exe" : "reel-lsp";
    for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
        if (!directory) continue;
        const candidate = path.join(directory.replace(/^"|"$/g, ""), executable);
        try {
            await access(candidate);
            return candidate;
        } catch {
            // Continue looking through the executable search path.
        }
    }
    return undefined;
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const output = vscode.window.createOutputChannel("Aside");
    const nativeChanged = new vscode.EventEmitter<vscode.Uri>();
    context.subscriptions.push(output, nativeChanged);

    async function startServer(): Promise<void> {
        if (client) {
            await client.dispose();
            client = undefined;
        }
        watcher?.dispose();
        watcher = undefined;
        if (!vscode.workspace.isTrusted) return;
        const config = vscode.workspace.getConfiguration("aside");
        const configured = config.get<string>("server.path", "");
        const bundled = path.join(context.extensionPath, "server", process.platform === "win32" ? "reel-lsp.exe" : "reel-lsp");
        const installed = configured ? undefined : await findInstalledServer();
        const command = configured || installed || bundled;
        if (!configured && !installed) {
            try {
                await access(command);
            } catch {
                throw new Error("This extension package has no server for this platform. Set aside.server.path to your reel-lsp or aside-lsp executable.");
            }
        }
        const processOptions = {
            windowsHide: true,
            cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
        } satisfies SpawnOptionsWithoutStdio;
        const server: ServerOptions = { command, args: config.get<string[]>("server.args", []), options: processOptions };
        watcher = vscode.workspace.createFileSystemWatcher("**/*.aside");
        const options: LanguageClientOptions = {
            documentSelector: [{ scheme: "file", language: "aside" }, { scheme: "untitled", language: "aside" }],
            outputChannel: output,
            synchronize: { fileEvents: watcher },
        };
        const next = new LanguageClient("aside", "Aside", server, options);
        client = next;
        try {
            await next.start();
        } catch (error) {
            await next.dispose();
            client = undefined;
            watcher.dispose();
            watcher = undefined;
            throw error;
        }
        for (const document of vscode.workspace.textDocuments) {
            if (document.uri.scheme === "aside-native") nativeChanged.fire(document.uri);
        }
    }

    function queueRestart(): Promise<void> {
        restart = restart.then(startServer).catch(async (error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);
            output.appendLine(message);
            await vscode.window.showErrorMessage(`Aside: ${message}`);
        });
        return restart;
    }

    context.subscriptions.push(
        vscode.workspace.registerTextDocumentContentProvider("aside-native", {
            onDidChange: nativeChanged.event,
            async provideTextDocumentContent(uri, token): Promise<string> {
                if (!client) throw new Error("The Aside language server is not running.");
                const document = await client.sendRequest<NativeDocument>("aside/nativeDocument", { uri: uri.toString() }, token);
                return document.text;
            },
        }),
        vscode.commands.registerCommand("aside.restartServer", queueRestart),
        vscode.commands.registerCommand("aside.newFile", async () => {
            const document = await vscode.workspace.openTextDocument({ language: "aside", content: "fn main() {\n    \n}\n" });
            const editor = await vscode.window.showTextDocument(document);
            editor.selection = new vscode.Selection(1, 4, 1, 4);
        }),
        vscode.commands.registerCommand("aside.runProject", runProject),
        vscode.workspace.onDidGrantWorkspaceTrust(queueRestart),
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration("aside.server")) void queueRestart();
        }),
    );
    await queueRestart();
}

async function runProject(): Promise<void> {
    if (!vscode.workspace.isTrusted) {
        await vscode.window.showInformationMessage("Trust the workspace to run an Aside story.");
        return;
    }
    const document = vscode.window.activeTextEditor?.document;
    // Persist a new src/main buffer before locating its owning project.
    if (document?.languageId === "aside" && document.uri.scheme === "file"
        && document.isDirty && !(await document.save())) return;
    let root = document?.uri.scheme === "file"
        ? await findProjectRoot(path.dirname(document.uri.fsPath)) : undefined;
    let folder = document && vscode.workspace.getWorkspaceFolder(document.uri);
    if (!root) {
        const folders = vscode.workspace.workspaceFolders ?? [];
        if (folders.length === 0) {
            await vscode.window.showErrorMessage("Open a Reel project containing src/main.aside.");
            return;
        }
        folder = folders.length === 1 ? folders[0] : await vscode.window.showWorkspaceFolderPick({
            placeHolder: "Choose the Aside project to run",
        });
        if (!folder) return;
        root = await findProjectRoot(folder.uri.fsPath);
    }
    if (!root) {
        await vscode.window.showErrorMessage("Open a Reel project containing src/main.aside.");
        return;
    }
    for (const source of vscode.workspace.textDocuments) {
        if (source.languageId === "aside" && source.uri.scheme === "file"
            && source.isDirty && containsFile(root, source.uri.fsPath) && !(await source.save())) return;
    }
    const config = vscode.workspace.getConfiguration("aside", folder?.uri ?? vscode.Uri.file(root));
    const args = ["dev"];
    const configuredAssets = config.get<string>("reel.assets", "");
    if (configuredAssets) args.push("--assets", path.resolve(folder?.uri.fsPath ?? root, configuredAssets));
    const task = new vscode.Task(
        { type: "aside", project: root },
        folder ?? vscode.TaskScope.Global,
        `Run ${path.basename(root)}`,
        "Aside",
        new vscode.ProcessExecution(config.get<string>("reel.path", "reel"), args, { cwd: root }),
    );
    await vscode.tasks.executeTask(task);
}

export async function deactivate(): Promise<void> {
    await restart;
    await client?.dispose();
    client = undefined;
    watcher?.dispose();
    watcher = undefined;
}
