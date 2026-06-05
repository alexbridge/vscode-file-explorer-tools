import * as vscode from 'vscode';
import { registerExpandCommand } from './expand/expand-recursively';
import { registerRenameCascade } from './rename-cascade/rename-cascade';
import { registerReverseRenameCascade } from './rename-cascade/reverse-rename';

export function activate(context: vscode.ExtensionContext): void {
  // --- Expand Recursively ---
  context.subscriptions.push(registerExpandCommand());

  // --- Rename Cascade ---
  context.subscriptions.push(registerRenameCascade());
  registerReverseRenameCascade(context);
}

export function deactivate(): void {
  // Cleanup handled by disposables
}
