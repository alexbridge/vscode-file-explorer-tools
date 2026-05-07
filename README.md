# File Explorer Tools

VS Code extension combining **Scopes Manager** (color-coded file scopes) and **Expand Recursively** (expand all folders in Explorer).

## Build and Publish

```bash
make pack
```

This produces `file-explorer-tools-<version>.vsix`. To publish to the marketplace:

```bash
npx @vscode/vsce publish
```

## Build and Install

```bash
make install-ext
```

This builds the extension, packages the `.vsix`, and installs it into VS Code. Alternatively, install a pre-built `.vsix` manually:

```bash
code --install-extension file-explorer-tools-0.1.0.vsix
```

Or in VS Code: Extensions → `...` menu → "Install from VSIX..."
