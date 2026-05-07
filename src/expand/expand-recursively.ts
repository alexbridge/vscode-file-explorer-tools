import * as vscode from 'vscode';
import * as path from 'path';
import { ScopeExplorerFilter } from '../scopes/explorer-filter';
import { ScopeManager } from '../scopes/scope-manager';

function getExcludePatterns(): string[] {
  const config = vscode.workspace.getConfiguration('fileExplorer.expandRecursively');
  return config.get<string[]>('excludePatterns') || [];
}

function shouldExclude(folderName: string, excludePatterns: string[]): boolean {
  return excludePatterns.some((pattern) => {
    if (pattern.includes('*')) {
      const regex = new RegExp(pattern.replace(/\*/g, '.*'), 'i');
      return regex.test(folderName);
    }
    return folderName.toLowerCase() === pattern.toLowerCase();
  });
}

/**
 * Checks if a folder (by relative path) is relevant to any of the scope patterns.
 * A folder is relevant if any scope pattern starts with it or a glob could match inside it.
 */
function folderIsRelevantToScope(folderRelPath: string, scopePatterns: string[]): boolean {
  for (const pattern of scopePatterns) {
    // Direct match or pattern is inside this folder
    if (pattern.startsWith(folderRelPath + '/') || pattern === folderRelPath) {
      return true;
    }
    // Glob pattern — check if the folder could contain matches
    const globIdx = pattern.indexOf('*');
    if (globIdx !== -1) {
      const base = pattern.slice(0, globIdx);
      if (
        folderRelPath.startsWith(base) ||
        base.startsWith(folderRelPath + '/') ||
        base === folderRelPath + '/'
      ) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Detects the currently selected folder in the file explorer via the clipboard.
 */
async function getExplorerSelection(): Promise<vscode.Uri | undefined> {
  try {
    const prevClipboard = await vscode.env.clipboard.readText();
    await vscode.commands.executeCommand('copyFilePath');
    const filePath = await vscode.env.clipboard.readText();
    await vscode.env.clipboard.writeText(prevClipboard);

    if (filePath && filePath !== prevClipboard) {
      const uri = vscode.Uri.file(filePath.trim());
      const stat = await vscode.workspace.fs.stat(uri);
      if (stat.type === vscode.FileType.Directory) {
        return uri;
      }
    }
  } catch {
    // fall through
  }
  return undefined;
}

/**
 * Collects all non-excluded folder URIs under a root, sorted by depth (parent first).
 * When scopePatterns is provided, only folders relevant to the scope are included.
 */
async function collectFolders(
  rootUri: vscode.Uri,
  excludePatterns: string[],
  scopePatterns: string[] | undefined,
  token: vscode.CancellationToken
): Promise<vscode.Uri[]> {
  const result: vscode.Uri[] = [];
  const queue: vscode.Uri[] = [rootUri];

  while (queue.length > 0) {
    if (token.isCancellationRequested) {
      return result;
    }

    const current = queue.shift()!;
    result.push(current);

    try {
      const entries = await vscode.workspace.fs.readDirectory(current);
      for (const [name, type] of entries) {
        if (type !== vscode.FileType.Directory) {
          continue;
        }
        if (shouldExclude(name, excludePatterns)) {
          continue;
        }
        const childUri = vscode.Uri.joinPath(current, name);
        // Check scope relevance if active — patterns are folder-prefixed
        if (scopePatterns) {
          const wsFolder = vscode.workspace.getWorkspaceFolder(childUri);
          if (!wsFolder) {
            continue;
          }
          const localRel = path.relative(wsFolder.uri.fsPath, childUri.fsPath).replace(/\\/g, '/');
          const prefixedRel = `${wsFolder.name}/${localRel}`;
          if (!folderIsRelevantToScope(prefixedRel, scopePatterns)) {
            continue;
          }
        }
        queue.push(childUri);
      }
    } catch {
      // skip inaccessible folders
    }
  }

  return result;
}

async function expandFolders(
  roots: vscode.Uri[],
  scopePatterns: string[] | undefined,
  progress: vscode.Progress<{ message?: string; increment?: number }>,
  token: vscode.CancellationToken
): Promise<void> {
  const excludePatterns = getExcludePatterns();

  // Collect all folders first (filesystem only, no UI)
  const allFolders: vscode.Uri[] = [];
  for (const root of roots) {
    if (token.isCancellationRequested) {
      return;
    }
    try {
      const stat = await vscode.workspace.fs.stat(root);
      if (stat.type !== vscode.FileType.Directory) {
        continue;
      }
      if (shouldExclude(path.basename(root.path), excludePatterns)) {
        continue;
      }
    } catch {
      continue;
    }
    progress.report({ message: 'Scanning folders...' });
    const folders = await collectFolders(root, excludePatterns, scopePatterns, token);
    allFolders.push(...folders);
  }

  if (token.isCancellationRequested || allFolders.length === 0) {
    return;
  }

  const total = allFolders.length;

  // Expand folders one by one, sorted parent-first (BFS order from collectFolders)
  for (let i = 0; i < allFolders.length; i++) {
    if (token.isCancellationRequested) {
      return;
    }

    const folder = allFolders[i];
    const folderName = path.basename(folder.path);
    progress.report({
      message: `${folderName} (${i + 1}/${total})`,
      increment: 100 / total,
    });

    try {
      await vscode.commands.executeCommand('revealInExplorer', folder);
      await new Promise((r) => setTimeout(r, 10));
      await vscode.commands.executeCommand('list.expand');
      await new Promise((r) => setTimeout(r, 10));
    } catch {
      // skip on failure
    }
  }
}

export function registerExpandCommand(
  filter: ScopeExplorerFilter,
  manager: ScopeManager
): vscode.Disposable {
  return vscode.commands.registerCommand(
    'fileExplorer.expandRecursively',
    async (uri?: vscode.Uri, selectedUris?: vscode.Uri[]) => {
      let foldersToExpand: vscode.Uri[] = [];

      if (selectedUris && selectedUris.length > 0) {
        foldersToExpand = selectedUris;
      } else if (uri) {
        foldersToExpand = [uri];
      } else {
        // Title bar button — try to detect the selected explorer item
        const selected = await getExplorerSelection();
        if (selected) {
          foldersToExpand = [selected];
        } else {
          const workspaceFolders = vscode.workspace.workspaceFolders;
          if (!workspaceFolders) {
            return;
          }
          foldersToExpand = workspaceFolders.map((f) => f.uri);
        }
      }

      // Get active scope patterns if a scope is selected
      let scopePatterns: string[] | undefined;
      const activeScopeId = filter.getActiveScopeId();
      if (activeScopeId) {
        const scope = manager.getScope(activeScopeId);
        if (scope && scope.patterns.length > 0) {
          scopePatterns = scope.patterns;
        }
      }

      await vscode.commands.executeCommand('workbench.files.action.focusFilesExplorer');

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: scopePatterns ? 'Expanding scope folders' : 'Expanding folders',
          cancellable: true,
        },
        (progress, token) => expandFolders(foldersToExpand, scopePatterns, progress, token)
      );
    }
  );
}
