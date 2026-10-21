# Aside for VS Code

Write Aside with compiler diagnostics, completion, hover documentation, signature help and definition navigation. Reel's built-in definitions are generated from Rust declarations and open as read-only Aside documents.

Install the VSIX with **Extensions: Install from VSIX**, then open an `.aside` file. The extension uses `reel-lsp` from PATH when installed; the Windows package also includes a server. Language queries run without starting a game. Use **Aside: New File** to create a scratch document. F12 opens a declaration, and Ctrl+Shift+Space shows the current call's named parameters.

To use another server build, set `aside.server.path` to the full path of `reel-lsp` or the standalone `aside-lsp`. The standalone server accepts Aside source without Reel's default environment.

Download and extract the Reel tool package, then add its `bin` directory to PATH. It contains `reel`, `reel-lsp` and the export player `reel-game`. Authors can share this installation across projects; Rust and Cargo are only needed to build the tools from source. Restart VS Code after changing PATH.

Use this layout for a project:

```text
my-game/
  src/main.aside
  src/ui/title.aside
  resources/
  build/
```

**Aside: Run Project** saves open Aside files in the project and runs `reel dev` from its root in a VS Code task. It finds the nearest ancestor containing `src/main.aside` and starts that file's `main` function. Use this command while editing any UI or story module in the project. In a workspace with several folders, the command can ask which folder to run. Build outputs stay in the project's `build/` directory.

The language server shares Reel's project discovery and resolves `game::ui::title` to `src/ui/title.aside`. Copy reusable source into `src/` and import it with ordinary `use` declarations. Scratch documents and files outside projects still provide language queries; running uses the selected project's fixed entry.

Run Project finds `reel` on PATH; `aside.reel.path` selects another executable. Resources default to the project's `resources/`; `aside.reel.assets` supplies an override relative to the workspace folder. The source and resources stay in the project; one tool installation serves multiple projects.

Aside files use this extension as their default formatter and format when saved. Override `[aside].editor.formatOnSave` or `[aside].editor.defaultFormatter` in VS Code settings to choose another preference. Formatting uses the Rust compiler's lossless syntax tree, including for documents whose imports or names are unresolved.

Compiler semantic highlighting uses the active theme's colors. Aside enables automatic code suggestions alongside inline suggestions; declaration and control-flow snippets use ordinary tab stops.

## Build

Use Node.js 22 or newer. From the Reel repository, build the server:

```sh
cargo build --release --locked -p reel-cli --bin reel-lsp
```

From this extension repository:

```sh
npm ci --ignore-scripts
npm run check
npm test
node scripts/bundle-server.mjs /path/to/reel/target/release/reel-lsp.exe /path/to/reel
npm run package -- --target win32-x64 --out aside-1.0.0-win32-x64.vsix
```

Server binaries and bundled JavaScript are generated artifacts. The client delegates language analysis and API definitions to the Rust server.
