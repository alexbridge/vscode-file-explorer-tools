import * as vscode from 'vscode';
import picomatch from 'picomatch';

const matcherCache = new Map<string, picomatch.Matcher>();

export function getOrCreateMatcher(pattern: string): picomatch.Matcher {
  let matcher = matcherCache.get(pattern);
  if (!matcher) {
    matcher = picomatch(pattern, { dot: true });
    matcherCache.set(pattern, matcher);
  }
  return matcher;
}

export function clearMatcherCache(): void {
  matcherCache.clear();
}

export function fileMatchesPattern(relativePath: string, pattern: string): boolean {
  const matcher = getOrCreateMatcher(pattern);
  return matcher(relativePath);
}

export function uriToRelativePath(uri: vscode.Uri): string | undefined {
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  if (!folder) {
    return undefined;
  }
  const rootPath = folder.uri.fsPath;
  const filePath = uri.fsPath;
  if (filePath === rootPath) {
    return folder.name;
  }
  if (!filePath.startsWith(rootPath + '/') && !filePath.startsWith(rootPath + '\\')) {
    return undefined;
  }
  const rel = filePath.slice(rootPath.length + 1).replace(/\\/g, '/');
  return `${folder.name}/${rel}`;
}

/**
 * Given a stored scope pattern like "folderName/path/**", returns the workspace folder
 * (matched by name) and the path part inside that folder ("path/**").
 */
export function splitFolderPattern(
  pattern: string
): { folder: vscode.WorkspaceFolder; localPattern: string } | undefined {
  const slashIdx = pattern.indexOf('/');
  const folderName = slashIdx === -1 ? pattern : pattern.slice(0, slashIdx);
  const localPattern = slashIdx === -1 ? '' : pattern.slice(slashIdx + 1);
  const folder = vscode.workspace.workspaceFolders?.find((f) => f.name === folderName);
  if (!folder) {
    return undefined;
  }
  return { folder, localPattern };
}

export function patternForUri(uri: vscode.Uri, isDirectory: boolean): string | undefined {
  const rel = uriToRelativePath(uri);
  if (!rel) {
    return undefined;
  }
  return isDirectory ? `${rel}/**` : rel;
}

export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function findCommonRoot(patterns: string[]): string | undefined {
  if (patterns.length === 0) {
    return undefined;
  }

  // Get directory parts for each pattern (strip glob stars)
  const paths = patterns.map((p) => p.replace(/\/\*\*$/, '').split('/'));

  if (paths.length === 1) {
    // If only one pattern, return its parent if it's a file, or itself if it's a folder
    const parts = paths[0];
    const original = patterns[0];
    if (original.endsWith('/**')) {
      return parts.join('/');
    }
    return parts.slice(0, -1).join('/');
  }

  // Find common prefix
  let common: string[] = [];
  const first = paths[0];

  for (let i = 0; i < first.length; i++) {
    const part = first[i];
    if (paths.every((p) => p[i] === part)) {
      common.push(part);
    } else {
      break;
    }
  }

  return common.length > 0 ? common.join('/') : undefined;
}
