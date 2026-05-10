#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const SETTINGS_FILE_PATH = path.join(process.cwd(), '.vscode', 'settings.json');
const SHARED_SCOPES_FILE_PATH = path.join(process.cwd(), '.vscode', 'scopes.json');

// State-machine JSONC parser — no external deps, handles comments and
// trailing commas without touching string contents (e.g. "//" in glob patterns).
function parseJsonc(content) {
    let result = '';
    let i = 0;
    let inString = false;
    while (i < content.length) {
        if (content[i] === '"' && (i === 0 || content[i - 1] !== '\\')) {
            inString = !inString;
            result += content[i++];
            continue;
        }
        if (inString) { result += content[i++]; continue; }
        if (content[i] === '/' && content[i + 1] === '*') {
            const end = content.indexOf('*/', i + 2);
            i = end === -1 ? content.length : end + 2;
            continue;
        }
        if (content[i] === '/' && content[i + 1] === '/') {
            const end = content.indexOf('\n', i + 2);
            i = end === -1 ? content.length : end;
            continue;
        }
        if (content[i] === ',') {
            if (content.slice(i + 1).match(/^\s*([}\]])/)) { i++; continue; }
        }
        result += content[i++];
    }
    return JSON.parse(result);
}

// Strip the leading workspace folder name from patterns
// e.g. "my-project/src/**" -> "src/**"
function normalizePatterns(patterns) {
    const folderName = path.basename(process.cwd());
    const prefix = folderName + '/';
    return (patterns || []).map(p => p.startsWith(prefix) ? p.slice(prefix.length) : p);
}

function readLocalScopes() {
    if (!fs.existsSync(SETTINGS_FILE_PATH)) {
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

function readSharedScopes() {
    if (!fs.existsSync(SHARED_SCOPES_FILE_PATH)) {
        return [];
    }
    try {
        const data = parseJsonc(fs.readFileSync(SHARED_SCOPES_FILE_PATH, 'utf-8'));
        return Array.isArray(data.scopes) ? data.scopes : [];
    } catch (e) {
        return [];
    }
}

function getAllScopes() {
    const scopes = [...readSharedScopes(), ...readLocalScopes()];
    return scopes.map(s => ({ ...s, patterns: normalizePatterns(s.patterns) }));
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
        const names = scopes.filter(s => s && s.name).map(s => s.name);
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
