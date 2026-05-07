import * as vscode from "vscode";
import { ScopeManager } from "./ScopeManager";
import { ScopeFileDecorationProvider } from "./ScopeFileDecorationProvider";
import { ScopesListProvider } from "./ScopesTreeDataProvider";
import { ScopeExplorerFilter } from "./ScopeExplorerFilter";
import { registerCommands } from "./commands";
import { registerExpandCommand } from "./expandRecursively";

export function activate(context: vscode.ExtensionContext): void {
  // --- Scopes Manager ---
  const manager = new ScopeManager();
  context.subscriptions.push(manager);

  const decorationProvider = new ScopeFileDecorationProvider(manager);
  context.subscriptions.push(
    vscode.window.registerFileDecorationProvider(decorationProvider),
    decorationProvider
  );

  // Explorer filter (files.exclude)
  const filter = new ScopeExplorerFilter(manager);
  context.subscriptions.push(filter);

  // Scopes list view
  const scopesListProvider = new ScopesListProvider(manager);
  const scopesListView = vscode.window.createTreeView("scopesListView", {
    treeDataProvider: scopesListProvider,
  });
  context.subscriptions.push(scopesListView);

  // Select scope — filters native Explorer via files.exclude
  context.subscriptions.push(
    vscode.commands.registerCommand("scopesManager.selectScope", async (scopeId: string) => {
      await filter.selectScope(scopeId);
      scopesListProvider.setActiveScope(filter.getActiveScopeId());
    })
  );

  // Deselect scope — clears filter
  context.subscriptions.push(
    vscode.commands.registerCommand("scopesManager.deselectScope", async () => {
      await filter.clearFilter();
      scopesListProvider.setActiveScope(undefined);
    })
  );

  // Scope CRUD commands
  context.subscriptions.push(...registerCommands(manager));

  // --- Expand Recursively ---
  context.subscriptions.push(registerExpandCommand());
}

export function deactivate(): void {
  // Cleanup handled by disposables
}
