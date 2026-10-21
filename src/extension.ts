import * as vscode from "vscode";
import * as path from "node:path";
import { access } from "node:fs/promises";
import type { SpawnOptionsWithoutStdio } from "node:child_process";
import { LanguageClient, type LanguageClientOptions, type ServerOptions } from "vscode-languageclient/node";

interface NativeDocument {
    text: string;
    languageId: string;
}

let client: LanguageClient | undefined;
let restart: Promise<void> = Promise.resolve();
let watcher: vscode.FileSystemWatcher | undefined;

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
        const command = configured || bundled;
        if (!configured) {
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
            initializationOptions: { modules: config.get<Record<string, string>>("modules", {}) },
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
        vscode.commands.registerCommand("aside.runFile", runFile),
        vscode.workspace.onDidGrantWorkspaceTrust(queueRestart),
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration("aside.server") || event.affectsConfiguration("aside.modules")) void queueRestart();
        }),
    );
    await queueRestart();
}

async function runFile(): Promise<void> {
    if (!vscode.workspace.isTrusted) {
        await vscode.window.showInformationMessage("Trust the workspace to run an Aside story.");
        return;
    }
    let document = vscode.window.activeTextEditor?.document;
    if (!document || document.languageId !== "aside" || document.uri.scheme === "aside-native") return;
    if (document.isUntitled) {
        await vscode.commands.executeCommand("workbench.action.files.save");
        document = vscode.window.activeTextEditor?.document;
        if (!document || document.languageId !== "aside" || document.uri.scheme !== "file") return;
    } else if (!(await document.save()) || document.uri.scheme !== "file") return;
    const config = vscode.workspace.getConfiguration("aside", document.uri);
    const directory = path.dirname(document.uri.fsPath);
    const configuredAssets = config.get<string>("reel.assets", "");
    const folder = vscode.workspace.getWorkspaceFolder(document.uri);
    const assets = configuredAssets ? path.resolve(folder?.uri.fsPath ?? directory, configuredAssets) : directory;
    const args = ["dev", document.uri.fsPath, "--assets", assets];
    for (const [prefix, root] of Object.entries(config.get<Record<string, string>>("modules", {}))) {
        args.push("--module", `${prefix}=${path.resolve(folder?.uri.fsPath ?? directory, root)}`);
    }
    const task = new vscode.Task(
        { type: "aside", file: document.uri.fsPath },
        folder ?? vscode.TaskScope.Global,
        `Run ${path.basename(document.uri.fsPath)}`,
        "Aside",
        new vscode.ProcessExecution(config.get<string>("reel.path", "reel"), args, { cwd: directory }),
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
