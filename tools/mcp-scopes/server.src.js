#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const SETTINGS_FILE_PATH = path.join(process.cwd(), '.vscode', 'settings.json');
const SHARED_SCOPES_FILE_PATH = path.join(process.cwd(), '.vscode', 'scopes.json');

function parseJsonc(content) {
    return JSON.parse(
        content
            .replace(/\/\/.*$/gm, '')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/,\s*([}\]])/g, '$1')
    );
}

/**
 * Reads local scopes from .vscode/settings.json.
 */
function readLocalScopes() {
    const localExists = fs.existsSync(SETTINGS_FILE_PATH);
    if (!localExists) {
        return [];
    }
    try {
        const settings = parseJsonc(fs.readFileSync(SETTINGS_FILE_PATH, 'utf-8'));
        const scopes = settings['scopesManager.localScopes'];
        return Array.isArray(scopes) ? scopes : [];
    } catch (e) {
        return [];
    }
}

/**
 * Reads shared scopes from .vscode/scopes.json.
 */
function readSharedScopes() {
    if (!fs.existsSync(SHARED_SCOPES_FILE_PATH)) {
        return [];
    }
    try {
        const settings = parseJsonc(fs.readFileSync(SHARED_SCOPES_FILE_PATH, 'utf-8'));
        return Array.isArray(settings.scopes) ? settings.scopes : [];
    } catch (e) {
        return [];
    }
}

/**
 * Combines all local and shared scopes.
 */
function getAllScopes() {
    return [...readSharedScopes(), ...readLocalScopes()];
}

async function main() {
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
    const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
    const { z } = await import('zod');

    const server = new McpServer({
        name: 'scope-manager-mcp',
        version: '2.0.0',
    });

    server.tool('list_scopes', 'List all available scope names', {}, async () => {
        const scopes = getAllScopes();
        const names = scopes
            .filter(s => s && s.name)
            .map(s => s.name);
        return { content: [{ type: 'text', text: JSON.stringify(names, null, 2) }] };
    });

    server.tool(
        'get_scope_patterns',
        'Get file patterns for a specific scope by name',
        { scopeName: z.string().describe('The name of the scope') },
        async ({ scopeName }) => {
            const scopes = getAllScopes();
            const scope = scopes.find(s => s && s.name === scopeName);
            if (!scope) {
                return {
                    content: [{ type: 'text', text: `Scope '${scopeName}' not found.` }],
                    isError: true,
                };
            }
            const patterns = Array.isArray(scope.patterns) ? scope.patterns : [];
            return { content: [{ type: 'text', text: JSON.stringify(patterns, null, 2) }] };
        }
    );

    const transport = new StdioServerTransport();
    await server.connect(transport);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
