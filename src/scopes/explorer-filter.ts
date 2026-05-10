import * as vscode from 'vscode';
import { CONFIG_KEY, MANAGED_PATTERNS_KEY } from './constants';
import { ScopeManager } from './scope-manager';
import { ScopeDefinition } from './types';
import { fileMatchesPattern } from './utils';

export class ScopeExplorerFilter implements vscode.Disposable {
  private activeScopeId: string | undefined;
  private managedPatterns: string[] = [];
  private disposables: vscode.Disposable[] = [];

  constructor(private readonly manager: ScopeManager) {
    // Restore state from configuration
    const config = vscode.workspace.getConfiguration(CONFIG_KEY);
    this.managedPatterns = config.get<string[]>(MANAGED_PATTERNS_KEY, []);

    this.clearFilter();
  }

  getActiveScopeId(): string | undefined {
    return this.activeScopeId;
  }

  async selectScope(scopeId: string): Promise<void> {
    if (this.activeScopeId === scopeId) {
      await this.clearFilter();
      return;
    }

    const scope = this.manager.getScope(scopeId);
    if (!scope) {
      return;
    }

    this.activeScopeId = scopeId;
    await vscode.commands.executeCommand('setContext', 'scopesManager.activeScope', true);
    await this.applyFilter(scope);

    // Automatically expand the relevant folder for the newly activated scope
    await vscode.commands.executeCommand('scopesManager.expandScope', scopeId);
  }

  async clearFilter(): Promise<void> {
    this.activeScopeId = undefined;
    await vscode.commands.executeCommand('setContext', 'scopesManager.activeScope', false);
    // Passing an empty scope definition to applyFilter will remove all managed patterns
    await this.applyFilter({ id: '', name: '', patterns: [], storage: 'local' });
  }

  private async persistManagedPatterns(patterns: string[]): Promise<void> {
    const config = vscode.workspace.getConfiguration(CONFIG_KEY);
    await config.update(MANAGED_PATTERNS_KEY, patterns, vscode.ConfigurationTarget.Workspace);
  }

  private async applyFilter(scope: ScopeDefinition): Promise<void> {
    const roots = vscode.workspace.workspaceFolders;
    if (!roots || roots.length === 0) {
      return;
    }

    // First, clear previously managed patterns from every workspace folder
    await this.clearManagedExcludesFromAllFolders(roots);

    const newManagedPatterns: string[] = [];

    if (scope.patterns.length > 0) {
      // Group patterns by workspace folder name (first path segment)
      const patternsByFolder = new Map<string, string[]>();
      for (const pattern of scope.patterns) {
        const slashIdx = pattern.indexOf('/');
        const folderName = slashIdx === -1 ? pattern : pattern.slice(0, slashIdx);
        const localPattern = slashIdx === -1 ? '' : pattern.slice(slashIdx + 1);
        if (!patternsByFolder.has(folderName)) {
          patternsByFolder.set(folderName, []);
        }
        if (localPattern) {
          patternsByFolder.get(folderName)!.push(localPattern);
        }
      }

      // For each workspace folder, apply only the patterns that target it
      for (const root of roots) {
        const localPatterns = patternsByFolder.get(root.name);
        const folderConfig = vscode.workspace.getConfiguration('files', root.uri);
        const currentExcludes = { ...folderConfig.get<Record<string, boolean>>('exclude') };

        if (!localPatterns || localPatterns.length === 0) {
          // This folder is not in the scope at all — exclude everything at the root
          let entries: [string, vscode.FileType][];
          try {
            entries = await vscode.workspace.fs.readDirectory(root.uri);
          } catch {
            continue;
          }
          for (const [name] of entries) {
            currentExcludes[name] = true;
            newManagedPatterns.push(`${root.name}/${name}`);
          }
        } else {
          let entries: [string, vscode.FileType][];
          try {
            entries = await vscode.workspace.fs.readDirectory(root.uri);
          } catch {
            continue;
          }
          const excludePatterns = await this.computeExcludes(root.uri, '', localPatterns, entries);
          for (const pattern of excludePatterns) {
            currentExcludes[pattern] = true;
            newManagedPatterns.push(`${root.name}/${pattern}`);
          }
        }

        await folderConfig.update(
          'exclude',
          currentExcludes,
          vscode.ConfigurationTarget.WorkspaceFolder
        );
      }
    }

    this.managedPatterns = newManagedPatterns;
    await this.persistManagedPatterns(newManagedPatterns);
  }

  /**
   * Removes previously managed patterns from every workspace folder's files.exclude.
   * Patterns are stored as "${folderName}/${localPattern}" — we strip the prefix and
   * remove from the matching folder's config.
   */
  private async clearManagedExcludesFromAllFolders(
    roots: readonly vscode.WorkspaceFolder[]
  ): Promise<void> {
    if (this.managedPatterns.length === 0) {
      return;
    }

    const byFolder = new Map<string, string[]>();
    for (const prefixed of this.managedPatterns) {
      const slashIdx = prefixed.indexOf('/');
      if (slashIdx === -1) {
        continue;
      }
      const folderName = prefixed.slice(0, slashIdx);
      const localPattern = prefixed.slice(slashIdx + 1);
      if (!byFolder.has(folderName)) {
        byFolder.set(folderName, []);
      }
      byFolder.get(folderName)!.push(localPattern);
    }

    for (const root of roots) {
      const patterns = byFolder.get(root.name);
      if (!patterns || patterns.length === 0) {
        continue;
      }
      const folderConfig = vscode.workspace.getConfiguration('files', root.uri);
      const currentExcludes = { ...folderConfig.get<Record<string, boolean>>('exclude') };
      for (const p of patterns) {
        delete currentExcludes[p];
      }
      await folderConfig.update(
        'exclude',
        currentExcludes,
        vscode.ConfigurationTarget.WorkspaceFolder
      );
    }
  }

  private async computeExcludes(
    dirUri: vscode.Uri,
    relPrefix: string,
    scopePatterns: string[],
    entries: [string, vscode.FileType][]
  ): Promise<string[]> {
    const excludes: string[] = [];

    for (const [name, type] of entries) {
      const relPath = relPrefix ? `${relPrefix}/${name}` : name;
      const isDir = (type & vscode.FileType.Directory) !== 0;

      if (isDir) {
        const folderMatches = this.folderIsRelevant(relPath, scopePatterns);
        if (!folderMatches) {
          excludes.push(relPath);
        } else {
          const dirGlobMatch = scopePatterns.some((p) => {
            const base = p.replace(/\/\*\*$/, '');
            return base === relPath || p === relPath;
          });
          if (!dirGlobMatch) {
            try {
              const childUri = vscode.Uri.joinPath(dirUri, name);
              const childEntries = await vscode.workspace.fs.readDirectory(childUri);
              const childExcludes = await this.computeExcludes(
                childUri,
                relPath,
                scopePatterns,
                childEntries
              );
              excludes.push(...childExcludes);
            } catch {
              // Skip unreadable folders
            }
          }
        }
      } else {
        const matches = scopePatterns.some((p) => fileMatchesPattern(relPath, p));
        if (!matches) {
          excludes.push(relPath);
        }
      }
    }

    return excludes;
  }

  private folderIsRelevant(folderRelPath: string, patterns: string[]): boolean {
    for (const pattern of patterns) {
      if (pattern.startsWith(folderRelPath + '/') || pattern === folderRelPath) {
        return true;
      }
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

  private async removeExcludes(): Promise<void> {
    const roots = vscode.workspace.workspaceFolders;
    if (!roots || roots.length === 0 || this.managedPatterns.length === 0) {
      return;
    }
    await this.clearManagedExcludesFromAllFolders(roots);
    this.managedPatterns = [];
  }

  dispose(): void {
    this.removeExcludes();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
