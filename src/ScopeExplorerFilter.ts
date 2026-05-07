import * as vscode from "vscode";
import { ScopeManager } from "./ScopeManager";
import { ScopeDefinition } from "./types";

/**
 * Prefix added to files.exclude keys managed by us, so we can identify and clean them up.
 * We use a unique comment-like suffix in the glob key to avoid collisions with user patterns.
 */
const MANAGED_MARKER = "##scopesManager";

export class ScopeExplorerFilter implements vscode.Disposable {
  private activeScopeId: string | undefined;
  private managedPatterns: string[] = [];
  private disposables: vscode.Disposable[] = [];

  constructor(private readonly manager: ScopeManager) {
    manager.onDidChangeScopes(() => {
      // If active scope was modified, re-apply filter
      if (this.activeScopeId) {
        const scope = manager.getScope(this.activeScopeId);
        if (scope) {
          this.applyFilter(scope);
        } else {
          // Scope was deleted
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
      // Toggle off
      await this.clearFilter();
      return;
    }

    const scope = this.manager.getScope(scopeId);
    if (!scope) {
      return;
    }

    // Clear previous filter first
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

    // Remove old managed excludes
    await this.removeExcludes();

    if (scope.patterns.length === 0) {
      return;
    }

    // Read workspace root entries
    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(root.uri);
    } catch {
      return;
    }

    // Build set of top-level items that should be VISIBLE
    const visibleTopLevel = new Set<string>();
    for (const pattern of scope.patterns) {
      // Extract the top-level segment from each pattern
      const firstSegment = pattern.split("/")[0];
      // If the pattern itself is just a filename at root level
      if (!pattern.includes("/")) {
        visibleTopLevel.add(pattern);
      } else {
        // Remove glob chars to get the actual folder name
        const clean = firstSegment.replace(/\*.*$/, "");
        if (clean) {
          visibleTopLevel.add(clean);
        }
      }
    }

    // For deeper filtering, we need to recursively determine visibility
    const excludePatterns = await this.computeExcludes(root.uri, "", scope.patterns, entries);

    if (excludePatterns.length === 0) {
      return;
    }

    // Write to files.exclude
    const config = vscode.workspace.getConfiguration("files");
    const currentExcludes: Record<string, boolean> = { ...config.get<Record<string, boolean>>("exclude") };

    this.managedPatterns = [];
    for (const pattern of excludePatterns) {
      const key = pattern;
      currentExcludes[key] = true;
      this.managedPatterns.push(key);
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
    const { fileMatchesPattern } = await import("./utils");

    for (const [name, type] of entries) {
      const relPath = relPrefix ? `${relPrefix}/${name}` : name;
      const isDir = (type & vscode.FileType.Directory) !== 0;

      if (isDir) {
        // Check if this folder or anything inside it matches any scope pattern
        const folderMatches = this.folderIsRelevant(relPath, scopePatterns);
        if (!folderMatches) {
          excludes.push(relPath);
        } else {
          // Folder is relevant — check if we need to filter inside it
          const dirGlobMatch = scopePatterns.some((p) => {
            // Pattern like "src/**" means show everything inside src
            const base = p.replace(/\/\*\*$/, "");
            return base === relPath || p === relPath;
          });
          if (!dirGlobMatch) {
            // Need to recurse and filter within this folder
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
        // File: exclude if it doesn't match any scope pattern
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
      // Pattern starts with this folder path
      if (pattern.startsWith(folderRelPath + "/") || pattern === folderRelPath) {
        return true;
      }
      // Glob pattern whose base includes this folder
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
    // Clean up on deactivation — remove our excludes so we don't leave garbage
    this.removeExcludes();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
