import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Builds the MCP server definition with the absolute path to the server script.
 */
function buildMcpServerDefinition(extensionPath: string) {
  const serverScript = path.join(extensionPath, 'tools', 'mcp-scopes', 'server.js');
  return {
    description: 'MCP server for managing VSCode scope patterns',
    command: 'node',
    args: [serverScript],
  };
}

/**
 * Finds the appropriate configuration file for MCP servers.
 * Prioritizes .mcp.json, then .gemini/settings.json at the project root.
 * If neither exists, it returns the path for a new .mcp.json file.
 * @returns {string | null} The absolute path to the config file, or null if project root is not found.
 */
function findMcpConfigFile(): string | null {
  const rootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!rootPath) {
    vscode.window.showErrorMessage(
      'Could not determine project root. MCP server configuration requires a workspace.'
    );
    return null; // Not in a workspace
  }

  const mcpJsonPath = path.join(rootPath, '.mcp.json');
  const geminiSettingsPath = path.join(rootPath, '.gemini', 'settings.json');

  if (fs.existsSync(mcpJsonPath)) {
    return mcpJsonPath;
  } else if (fs.existsSync(geminiSettingsPath)) {
    return geminiSettingsPath;
  } else {
    // Default to creating .mcp.json if neither exists
    return mcpJsonPath;
  }
}

/**
 * Reads a JSON file. If it doesn't exist, creates it with an empty JSON object.
 * @param {string} filePath The path to the JSON file.
 * @returns {Promise<any | null>} The parsed JSON content, or null if an error occurs.
 */
async function readOrCreateJsonFile(filePath: string): Promise<any | null> {
  if (!fs.existsSync(filePath)) {
    try {
      // Ensure directory exists before creating file
      const dirPath = path.dirname(filePath);
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }
      fs.writeFileSync(filePath, JSON.stringify({}, null, 2), 'utf-8'); // Create empty JSON file
      return {};
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to create JSON file ${filePath}: ${error.message}`);
      return null;
    }
  }

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (error: any) {
    vscode.window.showErrorMessage(
      `Failed to read or parse JSON file ${filePath}: ${error.message}`
    );
    return null;
  }
}

/**
 * Writes JSON data to a file.
 * @param {string} filePath The path to the JSON file.
 * @param {any} data The data to write.
 * @returns {Promise<boolean>} True if successful, false otherwise.
 */
async function writeJsonFile(filePath: string, data: any): Promise<boolean> {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (error: any) {
    vscode.window.showErrorMessage(`Failed to write JSON file ${filePath}: ${error.message}`);
    return false;
  }
}

/**
 * Registers the "Scopes Manager: install MCP" command handler.
 * This command finds/creates the MCP server config file, adds the scope-manager-mcp definition, and saves it.
 * @param {vscode.ExtensionContext} context The extension context.
 */
export function registerInstallMcpCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('scopesManager.installMcpServer', async () => {
      const configFilePath = findMcpConfigFile();
      if (!configFilePath) {
        return;
      }

      const currentConfig = await readOrCreateJsonFile(configFilePath);
      if (currentConfig === null) {
        return;
      }

      if (!currentConfig.mcpServers) {
        currentConfig.mcpServers = {};
      }

      currentConfig.mcpServers['scope-manager-mcp'] = buildMcpServerDefinition(
        context.extensionPath
      );

      const success = await writeJsonFile(configFilePath, currentConfig);
      if (success) {
        const configFileName = path.basename(configFilePath);
        vscode.window.showInformationMessage(
          `MCP server 'scope-manager-mcp' configuration ${fs.existsSync(configFilePath) ? 'updated' : 'created'} in ${configFileName}.`
        );
      }
    })
  );
}
