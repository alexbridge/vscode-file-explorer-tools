#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const SETTINGS_FILE_PATH = path.join(process.cwd(), '.vscode', 'settings.json');

function readLocalScopes() {
    if (!fs.existsSync(SETTINGS_FILE_PATH)) {
        return [];
    }
    const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE_PATH, 'utf-8'));
    const scopes = settings['scopesManager.localScopes'];
    return Array.isArray(scopes) ? scopes : [];
}

async function main() {
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
    const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
    const { z } = await import('zod');

    const server = new McpServer({
        name: 'vscode-scopes',
        version: '1.0.0',
    });

    server.tool('list_scopes', 'List all available scope names', {}, async () => {
        const scopes = readLocalScopes();
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
            const scopes = readLocalScopes();
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
