import * as vscode from "vscode";
import * as path from "path";

function getExcludePatterns(): string[] {
  const config = vscode.workspace.getConfiguration("fileExplorer.expandRecursively");
  return config.get<string[]>("excludePatterns") || [];
}

function shouldExcludeFolder(folderName: string, excludePatterns: string[]): boolean {
  return excludePatterns.some((pattern) => {
    if (pattern.includes("*")) {
      const regex = new RegExp(pattern.replace(/\*/g, ".*"), "i");
      return regex.test(folderName);
    }
    return folderName.toLowerCase() === pattern.toLowerCase();
  });
}

async function expandAllFolders(targetUri?: vscode.Uri, selectedUris?: vscode.Uri[]): Promise<void> {
  try {
    await vscode.commands.executeCommand("workbench.files.action.focusFilesExplorer");
    await new Promise((resolve) => setTimeout(resolve, 100));

    let foldersToExpand: vscode.Uri[] = [];

    if (selectedUris && selectedUris.length > 0) {
      foldersToExpand = selectedUris;
      vscode.window.showInformationMessage(
        `Recursively expanding ${foldersToExpand.length} selected folders...`
      );
    } else if (targetUri) {
      foldersToExpand = [targetUri];
      vscode.window.showInformationMessage(
        `Recursively expanding folder: ${vscode.workspace.asRelativePath(targetUri)}`
      );
    } else {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders) {
        vscode.window.showInformationMessage("No workspace folder is open.");
        return;
      }
      foldersToExpand = workspaceFolders.map((folder) => folder.uri);
      vscode.window.showInformationMessage("Recursively expanding all workspace folders...");
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Recursively expanding folders...",
        cancellable: true,
      },
      async (progress, token) => {
        try {
          if (!targetUri && (!selectedUris || selectedUris.length === 0)) {
            await vscode.commands.executeCommand("workbench.files.action.collapseExplorerFolders");
            await new Promise((resolve) => setTimeout(resolve, 50));
          }

          let processed = 0;
          for (const folder of foldersToExpand) {
            if (token.isCancellationRequested) {
              vscode.window.showInformationMessage("Expansion cancelled by user.");
              return;
            }

            processed++;
            progress.report({
              message: `Processing ${processed}/${foldersToExpand.length}: ${vscode.workspace.asRelativePath(folder)}`,
              increment: (processed / foldersToExpand.length) * 100,
            });

            await fastExpandFolder(folder, token);
          }

          if (!token.isCancellationRequested) {
            vscode.window.showInformationMessage("Recursive expansion completed!");
          }
        } catch (error) {
          vscode.window.showErrorMessage(`Error during expansion: ${error}`);
        }
      }
    );
  } catch (error) {
    vscode.window.showErrorMessage(`Error: ${error}`);
  }
}

async function fastExpandFolder(folderUri: vscode.Uri, token: vscode.CancellationToken): Promise<void> {
  if (token.isCancellationRequested) {
    return;
  }

  try {
    const stat = await vscode.workspace.fs.stat(folderUri);
    if (stat.type !== vscode.FileType.Directory) {
      return;
    }

    const folderName = path.basename(folderUri.path);
    const excludePatterns = getExcludePatterns();
    if (shouldExcludeFolder(folderName, excludePatterns)) {
      return;
    }

    await vscode.commands.executeCommand("revealInExplorer", folderUri);
    await new Promise((resolve) => setTimeout(resolve, 30));

    await recursiveExpand(folderUri, token);
  } catch (error) {
    console.log(`Expand failed for ${folderUri.path}: ${error}`);
  }
}

async function recursiveExpand(folderUri: vscode.Uri, token: vscode.CancellationToken): Promise<void> {
  if (token.isCancellationRequested) {
    return;
  }

  try {
    const stat = await vscode.workspace.fs.stat(folderUri);
    if (stat.type !== vscode.FileType.Directory) {
      return;
    }

    const entries = await vscode.workspace.fs.readDirectory(folderUri);
    const excludePatterns = getExcludePatterns();

    const subFolders = entries
      .filter(([name, type]) => {
        if (type !== vscode.FileType.Directory) {
          return false;
        }
        return !shouldExcludeFolder(name, excludePatterns);
      })
      .map(([name]) => vscode.Uri.joinPath(folderUri, name));

    await vscode.commands.executeCommand("revealInExplorer", folderUri);
    await new Promise((resolve) => setTimeout(resolve, 15));
    await vscode.commands.executeCommand("list.expand");
    await new Promise((resolve) => setTimeout(resolve, 15));

    for (const subFolder of subFolders) {
      if (token.isCancellationRequested) {
        return;
      }
      await recursiveExpand(subFolder, token);
    }
  } catch (error) {
    if (error instanceof vscode.FileSystemError) {
      console.log(`FileSystem error for ${folderUri.path}: ${error.name} - ${error.message}`);
    } else {
      console.log(`Recursive expand failed for ${folderUri.path}: ${error}`);
    }
  }
}

export function registerExpandCommand(): vscode.Disposable {
  return vscode.commands.registerCommand(
    "fileExplorer.expandRecursively",
    async (uri?: vscode.Uri, selectedUris?: vscode.Uri[]) => {
      await expandAllFolders(uri, selectedUris);
    }
  );
}
