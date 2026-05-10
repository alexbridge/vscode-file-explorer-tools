import * as vscode from 'vscode';
import * as path from 'path';
import { ScopeDefinition, SharedScopesFile } from './types';
import { CONFIG_KEY, LOCAL_SCOPES_KEY, SHARED_SCOPES_FILENAME } from './constants';
import { clearMatcherCache } from './utils';

export class ScopeManager implements vscode.Disposable {
  private scopes = new Map<string, ScopeDefinition>();
  private disposables: vscode.Disposable[] = [];
  private suppressReload = false;

  private readonly _onDidChangeScopes = new vscode.EventEmitter<void>();
  readonly onDidChangeScopes = this._onDidChangeScopes.event;

  constructor() {
    this.load();

    const folder = vscode.workspace.workspaceFolders?.[0];
    if (folder) {
      const pattern = new vscode.RelativePattern(folder, `.vscode/${SHARED_SCOPES_FILENAME}`);
      const watcher = vscode.workspace.createFileSystemWatcher(pattern);
      watcher.onDidChange(() => this.reload());
      watcher.onDidCreate(() => this.reload());
      watcher.onDidDelete(() => this.reload());
      this.disposables.push(watcher);
    }

    vscode.workspace.onDidChangeConfiguration(
      (e) => {
        if (e.affectsConfiguration(`${CONFIG_KEY}.${LOCAL_SCOPES_KEY}`)) {
          this.reload();
        }
      },
      undefined,
      this.disposables
    );
  }

  private reload(): void {
    if (this.suppressReload) {
      return;
    }
    this.load();
    clearMatcherCache();
    this._onDidChangeScopes.fire();
  }

  private load(): void {
    this.scopes.clear();
    this.loadSharedScopes();
    this.loadLocalScopes();
  }

  private loadSharedScopes(): void {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      return;
    }
    const filePath = path.join(folder.uri.fsPath, '.vscode', SHARED_SCOPES_FILENAME);
    try {
      const fs = require('fs');
      const content = fs.readFileSync(filePath, 'utf-8');
      const data: SharedScopesFile = JSON.parse(content);
      if (Array.isArray(data.scopes)) {
        for (const s of data.scopes) {
          this.scopes.set(s.id, { ...s, storage: 'shared' });
        }
      }
    } catch {
      // File doesn't exist or is invalid
    }
  }

  private loadLocalScopes(): void {
    const config = vscode.workspace.getConfiguration(CONFIG_KEY);
    const localScopes = config.get<Omit<ScopeDefinition, 'storage'>[]>(LOCAL_SCOPES_KEY, []);
    for (const s of localScopes) {
      this.scopes.set(s.id, { ...s, storage: 'local' });
    }
  }

  getAllScopes(): ScopeDefinition[] {
    return Array.from(this.scopes.values());
  }

  getScope(id: string): ScopeDefinition | undefined {
    return this.scopes.get(id);
  }

  async createScope(scope: ScopeDefinition): Promise<void> {
    this.scopes.set(scope.id, scope);
    await this.persist(scope.storage);
    this._onDidChangeScopes.fire();
  }

  async deleteScope(id: string): Promise<void> {
    const scope = this.scopes.get(id);
    if (!scope) {
      return;
    }
    this.scopes.delete(id);
    clearMatcherCache();
    await this.persist(scope.storage);
    this._onDidChangeScopes.fire();
  }

  async renameScope(id: string, newName: string): Promise<void> {
    const scope = this.scopes.get(id);
    if (!scope) {
      return;
    }
    scope.name = newName;
    await this.persist(scope.storage);
    this._onDidChangeScopes.fire();
  }

  async changeStorage(id: string, newStorage: 'local' | 'shared'): Promise<void> {
    const scope = this.scopes.get(id);
    if (!scope || scope.storage === newStorage) {
      return;
    }

    const oldStorage = scope.storage;
    scope.storage = newStorage; // flip in-memory; persist* methods derive state from this.scopes

    // Suppress reload so that config change events fired by persistLocal()
    // don't overwrite this.scopes before persistShared() runs.
    this.suppressReload = true;
    try {
      await this.persist(oldStorage); // remove from old store (scope no longer filtered in)
      await this.persist(newStorage); // add to new store (scope now filtered in)
    } finally {
      this.suppressReload = false;
    }

    this._onDidChangeScopes.fire();
  }

  async addToScope(id: string, pattern: string): Promise<void> {
    const scope = this.scopes.get(id);
    if (!scope) {
      return;
    }

    // 1. If we already have a pattern that covers this new one, do nothing
    const isAlreadyCovered = scope.patterns.some((p) => {
      if (p === pattern) {
        return true;
      }
      if (p.endsWith('/**')) {
        const base = p.slice(0, -3);
        return pattern.startsWith(base + '/') || pattern === base;
      }
      return false;
    });

    if (isAlreadyCovered) {
      return;
    }

    // 2. If the new pattern covers existing patterns, remove the redundant ones
    if (pattern.endsWith('/**')) {
      const base = pattern.slice(0, -3);
      scope.patterns = scope.patterns.filter((p) => {
        // Keep if it's NOT a subpath of the new recursive pattern
        const isSubpath = p.startsWith(base + '/') || p === base;
        return !isSubpath;
      });
    }

    scope.patterns.push(pattern);
    clearMatcherCache();
    await this.persist(scope.storage);
    this._onDidChangeScopes.fire();
  }

  async removeFromScope(id: string, pattern: string): Promise<void> {
    const scope = this.scopes.get(id);
    if (!scope) {
      return;
    }
    const idx = scope.patterns.indexOf(pattern);
    if (idx !== -1) {
      scope.patterns.splice(idx, 1);
      clearMatcherCache();
      await this.persist(scope.storage);
      this._onDidChangeScopes.fire();
    }
  }

  async clearScope(id: string): Promise<void> {
    const scope = this.scopes.get(id);
    if (!scope) {
      return;
    }
    scope.patterns = [];
    clearMatcherCache();
    await this.persist(scope.storage);
    this._onDidChangeScopes.fire();
  }

  getScopesForFile(relativePath: string): ScopeDefinition[] {
    const { fileMatchesPattern } = require('./utils');
    return this.getAllScopes().filter((scope) =>
      scope.patterns.some((pattern) => fileMatchesPattern(relativePath, pattern))
    );
  }

  private async persist(storage: 'local' | 'shared'): Promise<void> {
    if (storage === 'shared') {
      await this.persistShared();
    } else {
      await this.persistLocal();
    }
  }

  private async persistShared(): Promise<void> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      return;
    }
    const sharedScopes = this.getAllScopes()
      .filter((s) => s.storage === 'shared')
      .map(({ storage: _, ...rest }) => rest);

    const data: SharedScopesFile = { scopes: sharedScopes };
    const dirUri = vscode.Uri.joinPath(folder.uri, '.vscode');
    const fileUri = vscode.Uri.joinPath(dirUri, SHARED_SCOPES_FILENAME);

    try {
      await vscode.workspace.fs.stat(dirUri);
    } catch {
      await vscode.workspace.fs.createDirectory(dirUri);
    }

    const jsonString = JSON.stringify(data, null, 2);
    const finalContent = jsonString + '\n';
    await vscode.workspace.fs.writeFile(fileUri, Buffer.from(finalContent, 'utf-8'));
  }

  private async persistLocal(): Promise<void> {
    const localScopes = this.getAllScopes()
      .filter((s) => s.storage === 'local')
      .map(({ storage: _, ...rest }) => rest);

    const config = vscode.workspace.getConfiguration(CONFIG_KEY);
    await config.update(LOCAL_SCOPES_KEY, localScopes, vscode.ConfigurationTarget.Workspace);
  }

  dispose(): void {
    this._onDidChangeScopes.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
