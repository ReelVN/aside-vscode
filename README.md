# Aside for VS Code

Write Aside with compiler diagnostics, completion, hover documentation, signature help and definition navigation. Reel's built-in definitions are generated from Rust declarations and open as read-only Aside documents.

Install the VSIX with **Extensions: Install from VSIX**, then open an `.aside` file. The Windows package includes `reel-lsp`; language queries run without starting a game. Use **Aside: New File** to create a scratch document. F12 opens a declaration, and Ctrl+Shift+Space shows the current call's named parameters.

To use another server build, set `aside.server.path` to the full path of `reel-lsp` or the standalone `aside-lsp`. The standalone server accepts Aside source without Reel's default environment. `aside.modules` maps external import prefixes to source directories relative to the workspace folder.

**Aside: Run Current File** saves the file and runs `reel dev` in a VS Code task. Set `aside.reel.path` to the Reel CLI executable. `aside.reel.assets` selects the asset directory; its default is the current file's directory.

## Build

Use Node.js 22 or newer. From the Reel repository, build the server:

```sh
cargo build --release --locked -p reel-cli --bin reel-lsp
```

From this extension repository:

```sh
npm ci --ignore-scripts
node scripts/bundle-server.mjs /path/to/reel/target/release/reel-lsp.exe /path/to/reel
npm run package -- --target win32-x64 --out aside-1.0.0-win32-x64.vsix
```

Server binaries and bundled JavaScript are generated artifacts. The client delegates language analysis and API definitions to the Rust server.
