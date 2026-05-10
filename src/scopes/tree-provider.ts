import * as vscode from 'vscode';
import { ScopeManager } from './scope-manager';
import { ScopeDefinition } from './types';

export class ScopeListItem extends vscode.TreeItem {
  constructor(
    public readonly scope: ScopeDefinition,
    isActive: boolean
  ) {
    super(scope.name, vscode.TreeItemCollapsibleState.None);
    this.id = `${scope.id}:${isActive ? 1 : 0}`;
    this.contextValue = 'scope';

    this.iconPath =
      scope.storage === 'local'
        ? new vscode.ThemeIcon('record', isActive ? new vscode.ThemeColor('charts.red') : undefined)
        : new vscode.ThemeIcon(
            'broadcast',
            isActive ? new vscode.ThemeColor('charts.red') : undefined
          );

    if (isActive) {
      this.label = {
        label: scope.name,
        highlights: [[0, scope.name.length]],
      };
      this.description = 'active';
    } else {
      this.description = `${scope.patterns.length} pattern(s)`;
    }

    this.tooltip = `${scope.name}\n${scope.patterns.length} pattern(s)`;
    this.command = {
      command: 'scopesManager.selectScope',
      title: 'Select Scope',
      arguments: [scope.id],
    };
  }
}

export class ScopeCategoryItem extends vscode.TreeItem {
  constructor(
    public readonly storage: 'local' | 'shared',
    scopeCount: number
  ) {
    super(storage === 'shared' ? 'Shared' : 'Local', vscode.TreeItemCollapsibleState.Expanded);
    this.id = `category:${storage}`;
    this.contextValue = 'scopeCategory';
    this.description = `${scopeCount} scope(s)`;
    this.iconPath = new vscode.ThemeIcon(
      storage === 'shared' ? 'broadcast' : 'home',
      new vscode.ThemeColor('descriptionForeground')
    );
  }
}

type TreeNode = ScopeCategoryItem | ScopeListItem;

export class ScopesListProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private activeScopeId: string | undefined;
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly manager: ScopeManager) {
    manager.onDidChangeScopes(() => this.debouncedRefresh());
  }

  setActiveScope(id: string | undefined): void {
    this.activeScopeId = id;
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }
    this._onDidChangeTreeData.fire(undefined);
  }

  getActiveScopeId(): string | undefined {
    return this.activeScopeId;
  }

  private debouncedRefresh(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      this._onDidChangeTreeData.fire(undefined);
    }, 200);
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TreeNode): TreeNode[] {
    const allScopes = this.manager.getAllScopes();
    vscode.commands.executeCommand('setContext', 'scopesManager.hasScopes', allScopes.length > 0);

    const sort = (a: ScopeDefinition, b: ScopeDefinition) => a.name.localeCompare(b.name);

    // Root level — return category nodes
    if (!element) {
      const result: ScopeCategoryItem[] = [];
      const shared = allScopes.filter((s) => s.storage === 'shared');
      const local = allScopes.filter((s) => s.storage === 'local');
      if (shared.length) {
        result.push(new ScopeCategoryItem('shared', shared.length));
      }
      if (local.length) {
        result.push(new ScopeCategoryItem('local', local.length));
      }
      return result;
    }

    // Children of a category — return scopes
    if (element instanceof ScopeCategoryItem) {
      return allScopes
        .filter((s) => s.storage === element.storage)
        .sort(sort)
        .map((s) => new ScopeListItem(s, s.id === this.activeScopeId));
    }

    return [];
  }
}
