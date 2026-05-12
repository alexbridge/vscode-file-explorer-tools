import * as vscode from 'vscode';
import { ScopeManager } from './scope-manager';
import { ScopeListItem, ScopesListProvider } from './tree-provider';
import { ScopeDefinition } from './types';
import { findCommonRoot, generateId, patternForUri, uriToRelativePath } from './utils';

async function resolveUris(
  uri: vscode.Uri | undefined,
  selectedUris: vscode.Uri[] | undefined
): Promise<{ uris: vscode.Uri[]; fromExplorer: boolean }> {
  // Context menu passes multi-selection directly
  if (selectedUris && selectedUris.length > 0) {
    return { uris: selectedUris, fromExplorer: true };
  }
  // If uri is provided (e.g. from context menu but not multi-selected), use it
  if (uri) {
    return { uris: [uri], fromExplorer: true };
  }

  // Keybinding: VS Code doesn't pass selection.
  // Use clipboard workaround for explorer selection
  try {
    const prevClipboard = await vscode.env.clipboard.readText();
    await vscode.commands.executeCommand('copyFilePath');
    const paths = await vscode.env.clipboard.readText();
    await vscode.env.clipboard.writeText(prevClipboard);
    if (paths && paths !== prevClipboard) {
      const uris = paths
        .split(/\r?\n/)
        .filter((p) => p.trim())
        .map((p) => vscode.Uri.file(p));
      if (uris.length > 0) {
        return { uris, fromExplorer: true };
      }
    }
  } catch {
    // Fallback below
  }

  // Fallback: active editor
  const editor = vscode.window.activeTextEditor;
  if (editor) {
    return { uris: [editor.document.uri], fromExplorer: false };
  }
  return { uris: [], fromExplorer: false };
}

async function isDirectory(uri: vscode.Uri): Promise<boolean> {
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    return (stat.type & vscode.FileType.Directory) !== 0;
  } catch {
    return false;
  }
}

export function registerScopeCommands(
  manager: ScopeManager,
  treeProvider: ScopesListProvider
): vscode.Disposable[] {
  const disposables: vscode.Disposable[] = [];

  // Add to Scope
  disposables.push(
    vscode.commands.registerCommand(
      'scopesManager.addToScope',
      async (uri?: vscode.Uri, selectedUris?: vscode.Uri[]) => {
        const { uris, fromExplorer } = await resolveUris(uri, selectedUris);
        if (uris.length === 0) {
          vscode.window.showWarningMessage('No files selected.');
          return;
        }

        const activeScopeId = treeProvider.getActiveScopeId();
        // Only use active scope silently if NOT from explorer
        let scopeId: string | undefined = fromExplorer ? undefined : activeScopeId;
        const wasSilentlyAdded = !!scopeId;

        if (!scopeId) {
          const scopes = manager.getAllScopes();
          const items: (vscode.QuickPickItem & { scopeId?: string })[] = scopes.map((s) => ({
            label: s.name,
            description: `${s.storage} - ${s.patterns.length} pattern(s)`,
            scopeId: s.id,
          }));
          items.push({ label: '$(add) Create New Scope...', scopeId: undefined });

          const picked = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select a scope to add files to',
          });
          if (!picked) {
            return;
          }

          scopeId = picked.scopeId;
          if (!scopeId) {
            scopeId = await createScopeFlow(manager);
            if (!scopeId) {
              return;
            }
          }
        }

        const scope = manager.getScope(scopeId);
        if (!scope) {
          return;
        }

        for (const u of uris) {
          const isDir = await isDirectory(u);
          const pattern = patternForUri(u, isDir);
          if (pattern) {
            await manager.addToScope(scopeId, pattern);
          }
        }

        if (wasSilentlyAdded) {
          vscode.window.showInformationMessage(`Added to scope: ${scope.name}`);
        }
      }
    )
  );

  // Remove from Scope
  disposables.push(
    vscode.commands.registerCommand(
      'scopesManager.removeFromScope',
      async (uri?: vscode.Uri, selectedUris?: vscode.Uri[]) => {
        const { uris } = await resolveUris(uri, selectedUris);
        if (uris.length === 0) {
          vscode.window.showWarningMessage('No files selected.');
          return;
        }

        let scopeId = treeProvider.getActiveScopeId();
        if (!scopeId) {
          const rel = uriToRelativePath(uris[0]);
          if (!rel) {
            return;
          }

          const matchingScopes = manager.getScopesForFile(rel);
          if (matchingScopes.length === 0) {
            vscode.window.showInformationMessage('This file is not in any scope.');
            return;
          }

          scopeId = matchingScopes[0].id;
          if (matchingScopes.length > 1) {
            const picked = await vscode.window.showQuickPick(
              matchingScopes.map((s) => ({ label: s.name, scopeId: s.id })),
              { placeHolder: 'Remove from which scope?' }
            );
            if (!picked) {
              return;
            }
            scopeId = picked.scopeId;
          }
        }

        const scope = manager.getScope(scopeId);
        if (!scope) {
          return;
        }

        for (const u of uris) {
          const isDir = await isDirectory(u);
          const pattern = patternForUri(u, isDir);
          if (pattern) {
            await manager.removeFromScope(scopeId, pattern);
          }
        }

        vscode.window.showInformationMessage(`Removed from scope: ${scope.name}`);
      }
    )
  );

  // Create Scope
  disposables.push(
    vscode.commands.registerCommand('scopesManager.createScope', async () => {
      await createScopeFlow(manager);
    })
  );

  // Delete Scope
  disposables.push(
    vscode.commands.registerCommand('scopesManager.deleteScope', async (item?: ScopeListItem) => {
      let scope = item?.scope;
      if (!scope || !scope.id) {
        const scopeId = await pickScope(manager, 'Select scope to delete');
        scope = scopeId ? manager.getScope(scopeId) : undefined;
      }
      if (!scope || !scope.id) {
        return;
      }
      const confirm = await vscode.window.showWarningMessage(
        `Delete scope "${scope.name}"?`,
        { modal: true },
        'Delete'
      );
      if (confirm === 'Delete') {
        if (treeProvider.getActiveScopeId() === scope.id) {
          await vscode.commands.executeCommand('scopesManager.deselectScope');
        }
        await manager.deleteScope(scope.id);
      }
    })
  );

  // Rename Scope
  disposables.push(
    vscode.commands.registerCommand('scopesManager.renameScope', async (item?: ScopeListItem) => {
      let scope = item?.scope;
      if (!scope || !scope.id) {
        const scopeId = await pickScope(manager, 'Select scope to rename');
        scope = scopeId ? manager.getScope(scopeId) : undefined;
      }
      if (!scope || !scope.id) {
        return;
      }
      const newName = await vscode.window.showInputBox({
        prompt: 'New scope name',
        value: scope.name,
        validateInput: (v) => (v.trim() ? null : 'Name cannot be empty'),
      });
      if (newName) {
        await manager.renameScope(scope.id, newName.trim());
      }
    })
  );

  // Change Visibility
  disposables.push(
    vscode.commands.registerCommand('scopesManager.changeStorage', async (item?: ScopeListItem) => {
      let scope = item?.scope;
      if (!scope || !scope.id) {
        const scopeId = await pickScope(manager, 'Select scope to change visibility');
        scope = scopeId ? manager.getScope(scopeId) : undefined;
      }
      if (!scope || !scope.id) {
        return;
      }

      const storageItems: (vscode.QuickPickItem & { storage: 'local' | 'shared' })[] = [
        {
          label: 'Local',
          description: 'Stored in workspace settings (not committed)',
          picked: scope.storage === 'local',
          storage: 'local',
        },
        {
          label: 'Shared',
          description: 'Stored in .vscode/scopes.json (can be committed)',
          picked: scope.storage === 'shared',
          storage: 'shared',
        },
      ];

      const storagePicked = await vscode.window.showQuickPick(storageItems, {
        placeHolder: `Change visibility for "${scope.name}"`,
      });

      if (storagePicked && storagePicked.storage !== scope.storage) {
        await manager.changeStorage(scope.id, storagePicked.storage);
      }
    })
  );

  // Clear Scope
  disposables.push(
    vscode.commands.registerCommand('scopesManager.clearScope', async (item?: ScopeListItem) => {
      let scope = item?.scope;
      if (!scope || !scope.id) {
        const scopeId = await pickScope(manager, 'Select scope to clear');
        scope = scopeId ? manager.getScope(scopeId) : undefined;
      }
      if (!scope || !scope.id) {
        return;
      }
      const confirm = await vscode.window.showWarningMessage(
        `Clear all patterns from "${scope.name}"?`,
        { modal: true },
        'Clear'
      );
      if (confirm === 'Clear') {
        await manager.clearScope(scope.id);
      }
    })
  );

  // Remove Pattern from Scope
  disposables.push(
    vscode.commands.registerCommand(
      'scopesManager.removePatternFromScope',
      async (item?: { scopeId?: string; pattern?: string; resourceUri?: vscode.Uri }) => {
        if (!item?.scopeId) {
          return;
        }
        if (item.pattern) {
          await manager.removeFromScope(item.scopeId, item.pattern);
          return;
        }
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

  // Copy Scope Name
  disposables.push(
    vscode.commands.registerCommand(
      'scopesManager.copyScopeName',
      async (item?: { scope?: ScopeDefinition }) => {
        const name = item?.scope?.name;
        if (name) {
          await vscode.env.clipboard.writeText(name);
        }
      }
    )
  );

  // Switch Scope (keyboard-driven picker)
  disposables.push(
    vscode.commands.registerCommand('scopesManager.switchScope', async () => {
      const scopes = manager.getAllScopes();
      const activeId = treeProvider.getActiveScopeId();

      type Item = vscode.QuickPickItem & { scopeId?: string | null };
      const items: Item[] = [
        {
          label: `${!activeId ? '$(check) ' : ''}Project`,
          description: 'No active scope',
          scopeId: null,
        },
        { label: 'Scopes', kind: vscode.QuickPickItemKind.Separator },
        ...scopes.map<Item>((s) => ({
          label: `${s.id === activeId ? '$(check) ' : ''}${s.name}`,
          description: `${s.storage} - ${s.patterns.length} pattern(s)`,
          scopeId: s.id,
        })),
      ];

      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: 'Switch active scope',
      });
      if (!picked || picked.scopeId === undefined) {
        return;
      }

      if (picked.scopeId === null) {
        await vscode.commands.executeCommand('scopesManager.deselectScope');
      } else {
        await vscode.commands.executeCommand('scopesManager.selectScope', picked.scopeId);
      }

      // Always surface the File Explorer so the user sees the new scope applied
      await vscode.commands.executeCommand('workbench.view.explorer');
    })
  );

  // Expand Scope
  disposables.push(
    vscode.commands.registerCommand('scopesManager.expandScope', async (scopeId?: string) => {
      const id = scopeId ?? treeProvider.getActiveScopeId();
      if (!id) {
        return;
      }
      const scope = manager.getScope(id);
      if (!scope || scope.patterns.length === 0) {
        return;
      }

      const commonRoot = findCommonRoot(scope.patterns);
      if (commonRoot) {
        // commonRoot starts with workspace folder name — resolve it
        const slashIdx = commonRoot.indexOf('/');
        const folderName = slashIdx === -1 ? commonRoot : commonRoot.slice(0, slashIdx);
        const remaining = slashIdx === -1 ? '' : commonRoot.slice(slashIdx + 1);
        const folder = vscode.workspace.workspaceFolders?.find((f) => f.name === folderName);
        if (folder) {
          const uri = remaining ? vscode.Uri.joinPath(folder.uri, remaining) : folder.uri;
          await vscode.commands.executeCommand('workbench.files.action.focusFilesExplorer');
          await vscode.commands.executeCommand('revealInExplorer', uri);
          await new Promise((r) => setTimeout(r, 100));
          await vscode.commands.executeCommand('list.expand');
        }
      }
    })
  );

  return disposables;
}

async function createScopeFlow(manager: ScopeManager): Promise<string | undefined> {
  const name = await vscode.window.showInputBox({
    prompt: 'Scope name',
    placeHolder: 'e.g. Tests, Config, Generated',
    validateInput: (v) => (v.trim() ? null : 'Name cannot be empty'),
  });
  if (!name) {
    return undefined;
  }

  const scope: ScopeDefinition = {
    id: generateId(),
    name: name.trim(),
    storage: 'local',
    patterns: [],
  };

  await manager.createScope(scope);
  return scope.id;
}

async function pickScope(manager: ScopeManager, placeholder: string): Promise<string | undefined> {
  const scopes = manager.getAllScopes();
  if (scopes.length === 0) {
    vscode.window.showInformationMessage('No scopes defined yet.');
    return undefined;
  }
  const picked = await vscode.window.showQuickPick(
    scopes.map((s) => ({ label: s.name, description: s.storage, scopeId: s.id })),
    { placeHolder: placeholder }
  );
  return picked?.scopeId;
}
