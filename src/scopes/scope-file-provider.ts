import * as vscode from 'vscode';
import { ScopeManager } from './scope-manager';
import { fileMatchesPattern } from './utils';

export class ScopeFileItem extends vscode.TreeItem {
  constructor(
    public readonly uri: vscode.Uri,
    public readonly isDirectory: boolean,
    collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(uri, collapsibleState);
    this.resourceUri = uri;
    this.contextValue = isDirectory ? 'scopeFolder' : 'scopeFile';
    if (!isDirectory) {
      this.command = { command: 'vscode.open', title: 'Open File', arguments: [uri] };
    }
  }
}

export class ScopeFileProvider
  implements vscode.TreeDataProvider<ScopeFileItem>, vscode.Disposable
{
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<ScopeFileItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private activeScopeId: string | undefined;
  private disposables: vscode.Disposable[] = [];

  constructor(private readonly manager: ScopeManager) {
    manager.onDidChangeScopes(
      () => this._onDidChangeTreeData.fire(undefined),
      undefined,
      this.disposables
    );
  }

  setActiveScope(id: string | undefined): void {
    this.activeScopeId = id;
    this._onDidChangeTreeData.fire(undefined);
  }

  getActiveScopeId(): string | undefined {
    return this.activeScopeId;
  }

  getTreeItem(element: ScopeFileItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: ScopeFileItem): Promise<ScopeFileItem[]> {
    if (!this.activeScopeId) {
      return [];
    }
    const scope = this.manager.getScope(this.activeScopeId);
    if (!scope || scope.patterns.length === 0) {
      return [];
    }
    const root = vscode.workspace.workspaceFolders?.[0];
    if (!root) {
      return [];
    }

    const dirUri = element ? element.uri : root.uri;
    const relPrefix = element ? vscode.workspace.asRelativePath(element.uri, false) : '';

    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(dirUri);
    } catch {
      return [];
    }

    const items: ScopeFileItem[] = [];
    for (const [name, type] of entries.sort(([a], [b]) => a.localeCompare(b))) {
      const relPath = relPrefix ? `${relPrefix}/${name}` : name;
      const childUri = vscode.Uri.joinPath(dirUri, name);
      const isDir = (type & vscode.FileType.Directory) !== 0;

      if (isDir) {
        if (this.folderIsRelevant(relPath, scope.patterns)) {
          items.push(new ScopeFileItem(childUri, true, vscode.TreeItemCollapsibleState.Collapsed));
        }
      } else {
        if (scope.patterns.some((p) => fileMatchesPattern(relPath, p))) {
          items.push(new ScopeFileItem(childUri, false, vscode.TreeItemCollapsibleState.None));
        }
      }
    }
    return items;
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

  dispose(): void {
    this._onDidChangeTreeData.dispose();
    for (const d of this.disposables) d.dispose();
  }
}
