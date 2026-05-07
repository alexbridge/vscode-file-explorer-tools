import * as vscode from "vscode";
import { ScopeManager } from "./scope-manager";
import { ScopeDefinition } from "./types";
import { fileMatchesPattern } from "./utils";

export class ScopeExplorerFilter implements vscode.Disposable {
  private activeScopeId: string | undefined;
  private managedPatterns: string[] = [];
  private disposables: vscode.Disposable[] = [];

  constructor(private readonly manager: ScopeManager) {
    manager.onDidChangeScopes(() => {
      if (this.activeScopeId) {
        const scope = manager.getScope(this.activeScopeId);
        if (scope) {
          this.applyFilter(scope);
        } else {
          this.clearFilter();
        }
      }
    }, undefined, this.disposables);
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

    await this.removeExcludes();

    this.activeScopeId = scopeId;
    await vscode.commands.executeCommand("setContext", "scopesManager.activeScope", true);
    await this.applyFilter(scope);
  }

  async clearFilter(): Promise<void> {
    await this.removeExcludes();
    this.activeScopeId = undefined;
    await vscode.commands.executeCommand("setContext", "scopesManager.activeScope", false);
  }

  private async applyFilter(scope: ScopeDefinition): Promise<void> {
    const root = vscode.workspace.workspaceFolders?.[0];
    if (!root) {
      return;
    }

    await this.removeExcludes();

    if (scope.patterns.length === 0) {
      return;
    }

    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(root.uri);
    } catch {
      return;
    }

    const excludePatterns = await this.computeExcludes(root.uri, "", scope.patterns, entries);

    if (excludePatterns.length === 0) {
      return;
    }

    const config = vscode.workspace.getConfiguration("files");
    const currentExcludes: Record<string, boolean> = { ...config.get<Record<string, boolean>>("exclude") };

    this.managedPatterns = [];
    for (const pattern of excludePatterns) {
      currentExcludes[pattern] = true;
      this.managedPatterns.push(pattern);
    }

    await config.update("exclude", currentExcludes, vscode.ConfigurationTarget.Workspace);
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
            const base = p.replace(/\/\*\*$/, "");
            return base === relPath || p === relPath;
          });
          if (!dirGlobMatch) {
            try {
              const childUri = vscode.Uri.joinPath(dirUri, name);
              const childEntries = await vscode.workspace.fs.readDirectory(childUri);
              const childExcludes = await this.computeExcludes(childUri, relPath, scopePatterns, childEntries);
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
      if (pattern.startsWith(folderRelPath + "/") || pattern === folderRelPath) {
        return true;
      }
      const globIdx = pattern.indexOf("*");
      if (globIdx !== -1) {
        const base = pattern.slice(0, globIdx);
        if (
          folderRelPath.startsWith(base) ||
          base.startsWith(folderRelPath + "/") ||
          base === folderRelPath + "/"
        ) {
          return true;
        }
      }
    }
    return false;
  }

  private async removeExcludes(): Promise<void> {
    if (this.managedPatterns.length === 0) {
      return;
    }

    const config = vscode.workspace.getConfiguration("files");
    const currentExcludes: Record<string, boolean> = { ...config.get<Record<string, boolean>>("exclude") };

    for (const pattern of this.managedPatterns) {
      delete currentExcludes[pattern];
    }

    this.managedPatterns = [];
    await config.update("exclude", currentExcludes, vscode.ConfigurationTarget.Workspace);
  }

  dispose(): void {
    this.removeExcludes();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
