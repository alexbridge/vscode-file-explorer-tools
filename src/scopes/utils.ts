import * as vscode from "vscode";
import picomatch from "picomatch";
import { COLOR_PRESETS } from "./constants";

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
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    return undefined;
  }
  const rootPath = folder.uri.fsPath;
  const filePath = uri.fsPath;
  if (!filePath.startsWith(rootPath)) {
    return undefined;
  }
  return filePath.slice(rootPath.length + 1).replace(/\\/g, "/");
}

export function patternForUri(uri: vscode.Uri, isDirectory: boolean): string | undefined {
  const rel = uriToRelativePath(uri);
  if (!rel) {
    return undefined;
  }
  return isDirectory ? `${rel}/**` : rel;
}

export function getThemeColor(colorId: string | undefined): vscode.ThemeColor | undefined {
  if (!colorId) {
    return undefined;
  }
  const preset = COLOR_PRESETS.find((c) => c.id === colorId);
  return preset ? new vscode.ThemeColor(preset.themeColor) : undefined;
}

export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
