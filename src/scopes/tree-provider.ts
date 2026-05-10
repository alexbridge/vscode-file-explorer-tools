import * as vscode from 'vscode';
import { ScopeManager } from './scope-manager';
import { ScopeDefinition } from './types';

export class ScopeListItem extends vscode.TreeItem {
  constructor(
    public readonly scope: ScopeDefinition,
    isActive: boolean
  ) {
    super(scope.name, vscode.TreeItemCollapsibleState.None);
    // Changing id forces VS Code to re-render the item
    this.id = `${scope.id}:${isActive ? 1 : 0}`;
    this.contextValue = 'scope';

    if (isActive) {
      this.label = {
        label: scope.name,
        highlights: [[0, scope.name.length]],
      };
      this.description = 'active';
      this.iconPath = new vscode.ThemeIcon('pass-filled');
    } else {
      this.description = `${scope.patterns.length} pattern(s)`;
      this.iconPath = new vscode.ThemeIcon('circle-outline');
    }

    this.tooltip = `${scope.name}\n${scope.patterns.length} pattern(s)`;
    this.command = {
      command: 'scopesManager.selectScope',
      title: 'Select Scope',
      arguments: [scope.id],
    };
  }
}

export class ScopesListProvider implements vscode.TreeDataProvider<ScopeListItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<ScopeListItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private activeScopeId: string | undefined;
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly manager: ScopeManager) {
    manager.onDidChangeScopes(() => this.debouncedRefresh());
  }

  setActiveScope(id: string | undefined): void {
    this.activeScopeId = id;
    // Immediate refresh — cancels any pending debounced refresh
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

  getTreeItem(element: ScopeListItem): vscode.TreeItem {
    return element;
  }

  getChildren(): ScopeListItem[] {
    const scopes = this.manager.getAllScopes().sort((a, b) => a.name.localeCompare(b.name));
    vscode.commands.executeCommand('setContext', 'scopesManager.hasScopes', scopes.length > 0);
    return scopes.map((s) => new ScopeListItem(s, s.id === this.activeScopeId));
  }
}
