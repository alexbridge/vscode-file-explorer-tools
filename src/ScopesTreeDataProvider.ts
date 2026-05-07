import * as vscode from "vscode";
import { ScopeManager } from "./ScopeManager";
import { ScopeDefinition } from "./types";
import { getThemeColor } from "./utils";

class ScopeListItem extends vscode.TreeItem {
  constructor(public readonly scope: ScopeDefinition, isActive: boolean) {
    super(scope.name, vscode.TreeItemCollapsibleState.None);
    this.id = `scope-${scope.id}-${isActive ? "active" : "inactive"}`;
    this.contextValue = "scope";
    this.description = isActive ? "● active" : `${scope.patterns.length} pattern(s) · ${scope.storage}`;
    this.tooltip = `${scope.name} (${scope.storage})\n${scope.patterns.length} pattern(s)`;
    this.iconPath = new vscode.ThemeIcon(
      isActive ? "pass-filled" : "symbol-namespace",
      getThemeColor(scope.color)
    );
    this.command = {
      command: "scopesManager.selectScope",
      title: "Select Scope",
      arguments: [scope.id],
    };
    (this as any).scopeId = scope.id;
  }
}

export class ScopesListProvider implements vscode.TreeDataProvider<ScopeListItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private activeScopeId: string | undefined;

  constructor(private readonly manager: ScopeManager) {
    manager.onDidChangeScopes(() => this._onDidChangeTreeData.fire());
  }

  setActiveScope(id: string | undefined): void {
    this.activeScopeId = id;
    this._onDidChangeTreeData.fire();
  }

  getActiveScopeId(): string | undefined {
    return this.activeScopeId;
  }

  getTreeItem(element: ScopeListItem): vscode.TreeItem {
    return element;
  }

  getChildren(): ScopeListItem[] {
    return this.manager
      .getAllScopes()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((s) => new ScopeListItem(s, s.id === this.activeScopeId));
  }
}
