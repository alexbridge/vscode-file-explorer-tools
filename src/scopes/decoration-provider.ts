import * as vscode from 'vscode';
import { ScopeManager } from './scope-manager';
import { uriToRelativePath, fileMatchesPattern } from './utils';

export class ScopeFileDecorationProvider
  implements vscode.FileDecorationProvider, vscode.Disposable
{
  private readonly _onDidChangeFileDecorations = new vscode.EventEmitter<
    vscode.Uri | vscode.Uri[] | undefined
  >();
  readonly onDidChangeFileDecorations = this._onDidChangeFileDecorations.event;

  private disposable: vscode.Disposable;

  constructor(private readonly manager: ScopeManager) {
    this.disposable = manager.onDidChangeScopes(() => {
      this._onDidChangeFileDecorations.fire(undefined);
    });
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    const rel = uriToRelativePath(uri);
    if (!rel) {
      return undefined;
    }

    const scopes = this.manager.getAllScopes();
    for (const scope of scopes) {
      for (const pattern of scope.patterns) {
        if (fileMatchesPattern(rel, pattern)) {
          return {
            badge: scope.name.slice(0, 2).toUpperCase(),
            tooltip: `Scope: ${scope.name}`,
          };
        }
      }
    }

    return undefined;
  }

  dispose(): void {
    this._onDidChangeFileDecorations.dispose();
    this.disposable.dispose();
  }
}
