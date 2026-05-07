import * as vscode from 'vscode';
import * as path from 'path';
import { toPascalCase, deriveNewSymbolName } from './naming-conventions';

const SUPPORTED_EXTENSIONS = [
  '.tsx',
  '.jsx', // multi-char first so longer match wins
  '.ts',
  '.js',
  '.java',
  '.kt',
  '.cs',
  '.py',
  '.go',
];

type RenameCascadeMode = 'always' | 'prompt' | 'never';

function getMode(): RenameCascadeMode {
  return vscode.workspace
    .getConfiguration('fileExplorer.renameCascade')
    .get<RenameCascadeMode>('mode', 'prompt');
}

function stripLangExt(fileName: string, extensions: string[]): string | undefined {
  const ext = extensions.find((e) => fileName.endsWith(e));
  if (!ext) {
    return undefined;
  }
  return fileName.slice(0, -ext.length);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function handleRename(
  oldUri: vscode.Uri,
  newUri: vscode.Uri,
  mode: RenameCascadeMode
): Promise<void> {
  // Strip the language extension to get the semantic name
  // e.g. bar-entity.component.ts -> bar-entity.component
  //      FooEntity.java          -> FooEntity
  const oldFileName = path.basename(oldUri.fsPath);
  const newFileName = path.basename(newUri.fsPath);

  const langExt = SUPPORTED_EXTENSIONS.find((ext) => newFileName.endsWith(ext));
  if (!langExt) {
    return;
  }

  // Everything before the language extension, with dots treated as separators
  // e.g. bar-entity.component.ts -> "bar-entity.component" -> PascalCase -> BarEntityComponent
  const oldSemantic = stripLangExt(oldFileName, SUPPORTED_EXTENSIONS);
  const newSemantic = newFileName.slice(0, -langExt.length);

  if (!oldSemantic || !newSemantic) {
    return;
  }

  if (oldSemantic === newSemantic) {
    return; // file was moved, not renamed
  }

  const oldSymbol = toPascalCase(oldSemantic);
  const newSymbol = deriveNewSymbolName(newSemantic);

  if (oldSymbol === newSymbol) {
    return;
  }

  // Read file content and search for the old symbol
  const document = await vscode.workspace.openTextDocument(newUri);
  const text = document.getText();
  const regex = new RegExp(`\\b${oldSymbol}\\b`);
  const match = regex.exec(text);
  if (!match) {
    return;
  }

  if (mode === 'prompt') {
    const answer = await vscode.window.showInformationMessage(
      `Rename "${oldSymbol}" \u2192 "${newSymbol}"?`,
      { modal: false },
      'Yes',
      'No'
    );
    if (answer !== 'Yes') {
      return;
    }
  }

  // Wait for the language server to process the file rename
  await delay(500);

  // Find the position of the symbol in the document
  const offset = match.index;
  const position = document.positionAt(offset);

  try {
    const edit = await vscode.commands.executeCommand<vscode.WorkspaceEdit>(
      'vscode.executeDocumentRenameProvider',
      newUri,
      position,
      newSymbol
    );
    if (edit) {
      await vscode.workspace.applyEdit(edit);
    }
  } catch {
    // Language server may not support rename for some files — fail silently
  }
}

export function registerRenameCascade(): vscode.Disposable {
  return vscode.workspace.onDidRenameFiles(async (event) => {
    const mode = getMode();
    if (mode === 'never') {
      return;
    }

    for (const { oldUri, newUri } of event.files) {
      await handleRename(oldUri, newUri, mode);
    }
  });
}
