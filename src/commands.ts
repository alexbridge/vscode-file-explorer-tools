import * as vscode from "vscode";
import { ScopeManager } from "./ScopeManager";
import { COLOR_PRESETS } from "./constants";
import { patternForUri, generateId, uriToRelativePath } from "./utils";
import { ScopeDefinition } from "./types";

async function resolveUris(
  uri: vscode.Uri | undefined,
  selectedUris: vscode.Uri[] | undefined
): Promise<vscode.Uri[]> {
  // Context menu passes multi-selection directly
  if (selectedUris && selectedUris.length > 0) {
    return selectedUris;
  }
  // Keybinding: VS Code doesn't pass multi-selection, use clipboard workaround
  try {
    const prevClipboard = await vscode.env.clipboard.readText();
    await vscode.commands.executeCommand("copyFilePath");
    const paths = await vscode.env.clipboard.readText();
    await vscode.env.clipboard.writeText(prevClipboard);
    if (paths && paths !== prevClipboard) {
      const uris = paths
        .split(/\r?\n/)
        .filter((p) => p.trim())
        .map((p) => vscode.Uri.file(p));
      if (uris.length > 0) {
        return uris;
      }
    }
  } catch {
    // Fallback below
  }
  if (uri) {
    return [uri];
  }
  // Fallback: active editor
  const editor = vscode.window.activeTextEditor;
  if (editor) {
    return [editor.document.uri];
  }
  return [];
}

async function isDirectory(uri: vscode.Uri): Promise<boolean> {
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    return (stat.type & vscode.FileType.Directory) !== 0;
  } catch {
    return false;
  }
}

export function registerCommands(manager: ScopeManager): vscode.Disposable[] {
  const disposables: vscode.Disposable[] = [];

  // Add to Scope
  disposables.push(
    vscode.commands.registerCommand(
      "scopesManager.addToScope",
      async (uri?: vscode.Uri, selectedUris?: vscode.Uri[]) => {
        const uris = await resolveUris(uri, selectedUris);
        if (uris.length === 0) {
          vscode.window.showWarningMessage("No files selected.");
          return;
        }

        const scopes = manager.getAllScopes();
        const items: (vscode.QuickPickItem & { scopeId?: string })[] = scopes.map((s) => ({
          label: s.name,
          description: `${s.storage} - ${s.patterns.length} pattern(s)`,
          scopeId: s.id,
        }));
        items.push({ label: "$(add) Create New Scope...", scopeId: undefined });

        const picked = await vscode.window.showQuickPick(items, {
          placeHolder: "Select a scope to add files to",
        });
        if (!picked) {
          return;
        }

        let scopeId = picked.scopeId;
        if (!scopeId) {
          scopeId = await createScopeFlow(manager);
          if (!scopeId) {
            return;
          }
        }

        for (const u of uris) {
          const isDir = await isDirectory(u);
          const pattern = patternForUri(u, isDir);
          if (pattern) {
            await manager.addToScope(scopeId, pattern);
          }
        }
      }
    )
  );

  // Remove from Scope
  disposables.push(
    vscode.commands.registerCommand(
      "scopesManager.removeFromScope",
      async (uri?: vscode.Uri, selectedUris?: vscode.Uri[]) => {
        const uris = await resolveUris(uri, selectedUris);
        if (uris.length === 0) {
          vscode.window.showWarningMessage("No files selected.");
          return;
        }

        // For the first URI, find which scopes contain it
        const rel = uriToRelativePath(uris[0]);
        if (!rel) {
          return;
        }

        const matchingScopes = manager.getScopesForFile(rel);
        if (matchingScopes.length === 0) {
          vscode.window.showInformationMessage("This file is not in any scope.");
          return;
        }

        const picked = await vscode.window.showQuickPick(
          matchingScopes.map((s) => ({ label: s.name, scopeId: s.id })),
          { placeHolder: "Remove from which scope?" }
        );
        if (!picked) {
          return;
        }

        // Remove patterns matching each selected URI from the chosen scope
        for (const u of uris) {
          const isDir = await isDirectory(u);
          const pattern = patternForUri(u, isDir);
          if (pattern) {
            await manager.removeFromScope(picked.scopeId, pattern);
          }
        }
      }
    )
  );

  // Create Scope
  disposables.push(
    vscode.commands.registerCommand("scopesManager.createScope", async () => {
      await createScopeFlow(manager);
    })
  );

  // Delete Scope
  disposables.push(
    vscode.commands.registerCommand("scopesManager.deleteScope", async (item?: { scopeId?: string }) => {
      const scopeId = item?.scopeId ?? (await pickScope(manager, "Select scope to delete"));
      if (!scopeId) {
        return;
      }
      const scope = manager.getScope(scopeId);
      if (!scope) {
        return;
      }
      const confirm = await vscode.window.showWarningMessage(
        `Delete scope "${scope.name}"?`,
        { modal: true },
        "Delete"
      );
      if (confirm === "Delete") {
        await manager.deleteScope(scopeId);
      }
    })
  );

  // Rename Scope
  disposables.push(
    vscode.commands.registerCommand("scopesManager.renameScope", async (item?: { scopeId?: string }) => {
      const scopeId = item?.scopeId ?? (await pickScope(manager, "Select scope to rename"));
      if (!scopeId) {
        return;
      }
      const scope = manager.getScope(scopeId);
      if (!scope) {
        return;
      }
      const newName = await vscode.window.showInputBox({
        prompt: "New scope name",
        value: scope.name,
        validateInput: (v) => (v.trim() ? null : "Name cannot be empty"),
      });
      if (newName) {
        await manager.renameScope(scopeId, newName.trim());
      }
    })
  );

  // Edit Scope Color
  disposables.push(
    vscode.commands.registerCommand("scopesManager.editScopeColor", async (item?: { scopeId?: string }) => {
      const scopeId = item?.scopeId ?? (await pickScope(manager, "Select scope to recolor"));
      if (!scopeId) {
        return;
      }
      const color = await pickColor();
      if (color) {
        await manager.setColor(scopeId, color);
      }
    })
  );

  // Clear Scope
  disposables.push(
    vscode.commands.registerCommand("scopesManager.clearScope", async (item?: { scopeId?: string }) => {
      const scopeId = item?.scopeId ?? (await pickScope(manager, "Select scope to clear"));
      if (!scopeId) {
        return;
      }
      const scope = manager.getScope(scopeId);
      if (!scope) {
        return;
      }
      const confirm = await vscode.window.showWarningMessage(
        `Clear all patterns from "${scope.name}"?`,
        { modal: true },
        "Clear"
      );
      if (confirm === "Clear") {
        await manager.clearScope(scopeId);
      }
    })
  );

  // Remove Pattern from Scope (from tree node with a resourceUri)
  disposables.push(
    vscode.commands.registerCommand(
      "scopesManager.removePatternFromScope",
      async (item?: { scopeId?: string; pattern?: string; resourceUri?: vscode.Uri }) => {
        if (!item?.scopeId) {
          return;
        }
        // Legacy: direct pattern
        if (item.pattern) {
          await manager.removeFromScope(item.scopeId, item.pattern);
          return;
        }
        // File tree node: derive pattern from URI
        if (item.resourceUri) {
          const isDir = await isDirectory(item.resourceUri);
          const pattern = patternForUri(item.resourceUri, isDir);
          if (pattern) {
            await manager.removeFromScope(item.scopeId, pattern);
          }
        }
      }
    )
  );

  return disposables;
}

async function createScopeFlow(manager: ScopeManager): Promise<string | undefined> {
  const name = await vscode.window.showInputBox({
    prompt: "Scope name",
    placeHolder: "e.g. Tests, Config, Generated",
    validateInput: (v) => (v.trim() ? null : "Name cannot be empty"),
  });
  if (!name) {
    return undefined;
  }

  const colorId = await pickColor();
  if (colorId === undefined) {
    return undefined;
  }

  const scope: ScopeDefinition = {
    id: generateId(),
    name: name.trim(),
    storage: "local",
    color: colorId,
    patterns: [],
  };

  await manager.createScope(scope);
  return scope.id;
}

async function pickScope(manager: ScopeManager, placeholder: string): Promise<string | undefined> {
  const scopes = manager.getAllScopes();
  if (scopes.length === 0) {
    vscode.window.showInformationMessage("No scopes defined yet.");
    return undefined;
  }
  const picked = await vscode.window.showQuickPick(
    scopes.map((s) => ({ label: s.name, description: s.storage, scopeId: s.id })),
    { placeHolder: placeholder }
  );
  return picked?.scopeId;
}

async function pickColor(): Promise<string | undefined> {
  const picked = await vscode.window.showQuickPick(
    COLOR_PRESETS.map((c) => ({ label: c.label, colorId: c.id })),
    { placeHolder: "Pick a color" }
  );
  return picked?.colorId;
}
