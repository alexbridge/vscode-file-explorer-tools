import * as vscode from 'vscode';
import * as path from 'path';
import { toPascalCase } from './naming-conventions';
import {
  pendingRenames,
  isInternalRename,
  setIsInternalRename,
  releaseRenameGuard,
} from './rename-guard';

export function registerReverseRenameCascade(context: vscode.ExtensionContext) {
  const selector = { language: 'typescript', scheme: 'file' };

  context.subscriptions.push(
    vscode.languages.registerRenameProvider(selector, {
      async provideRenameEdits(
        document: vscode.TextDocument,
        position: vscode.Position,
        newName: string,
        token: vscode.CancellationToken
      ) {
        if (isInternalRename) {
          return undefined;
        }

        const filePath = document.uri.fsPath;
        if (pendingRenames.has(filePath)) {
          return undefined;
        }

        setIsInternalRename(true);
        let edit: vscode.WorkspaceEdit | undefined;
        try {
          edit = await vscode.commands.executeCommand<vscode.WorkspaceEdit>(
            'vscode.executeDocumentRenameProvider',
            document.uri,
            position,
            newName
          );
        } finally {
          setIsInternalRename(false);
        }

        if (!edit) return undefined;

        const wordRange = document.getWordRangeAtPosition(position);
        if (!wordRange) return edit;

        const oldSymbolName = document.getText(wordRange);
        const fileName = path.basename(document.fileName, path.extname(document.fileName));

        const normalize = (str: string) => str.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

        if (normalize(oldSymbolName) === normalize(fileName)) {
          const newFileName = toKebabCase(newName);
          const newUri = vscode.Uri.file(
            path.join(
              path.dirname(document.fileName),
              `${newFileName}${path.extname(document.fileName)}`
            )
          );

          pendingRenames.add(filePath);
          try {
            edit.renameFile(document.uri, newUri);
          } finally {
            releaseRenameGuard(filePath, 500);
          }
        }

        return edit;
      },
    })
  );
}

function toKebabCase(str: string): string {
  return str
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase();
}
