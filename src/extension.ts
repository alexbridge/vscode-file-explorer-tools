import * as vscode from 'vscode';
// Import the command registration function from the new dedicated file
import { registerInstallMcpCommand } from './mcp/installMcp';

import { ScopeManager } from './scopes/scope-manager';
import { ScopesListProvider } from './scopes/tree-provider';
import { ScopeExplorerFilter } from './scopes/explorer-filter';
import { registerScopeCommands } from './scopes/commands';
import { registerExpandCommand } from './expand/expand-recursively';
import { registerRenameCascade } from './rename-cascade/rename-cascade';
import { registerReverseRenameCascade } from './rename-cascade/reverse-rename';

export function activate(context: vscode.ExtensionContext): void {
  // --- Scopes Manager ---
  const manager = new ScopeManager();
  context.subscriptions.push(manager);

  // Explorer filter (files.exclude)
  const filter = new ScopeExplorerFilter(manager);
  context.subscriptions.push(filter);

  // Scopes list view
  const scopesListProvider = new ScopesListProvider(manager);
  const scopesListView = vscode.window.createTreeView('scopesListView', {
    treeDataProvider: scopesListProvider,
  });
  context.subscriptions.push(scopesListView);

  // Restore active scope state
  const activeScopeId = filter.getActiveScopeId();
  if (activeScopeId) {
    scopesListProvider.setActiveScope(activeScopeId);
    vscode.commands.executeCommand('setContext', 'scopesManager.activeScope', true);
  }

  // Select scope — filters native Explorer via files.exclude
  context.subscriptions.push(
    vscode.commands.registerCommand('scopesManager.selectScope', async (scopeId: string) => {
      await filter.selectScope(scopeId);
      scopesListProvider.setActiveScope(filter.getActiveScopeId());
    })
  );

  // Deselect scope — clears filter
  context.subscriptions.push(
    vscode.commands.registerCommand('scopesManager.deselectScope', async () => {
      await filter.clearFilter();
      scopesListProvider.setActiveScope(undefined);
    })
  );

  // Scope CRUD commands
  context.subscriptions.push(...registerScopeCommands(manager, scopesListProvider));

  // --- Expand Recursively ---
  context.subscriptions.push(registerExpandCommand(filter, manager));

  // --- Rename Cascade ---
  context.subscriptions.push(registerRenameCascade());
  registerReverseRenameCascade(context);

  // --- Register the new MCP installation command ---
  registerInstallMcpCommand(context);
}

export function deactivate(): void {
  // Cleanup handled by disposables
}
