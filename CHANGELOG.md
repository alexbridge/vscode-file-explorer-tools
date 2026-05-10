# Changelog

## [1.3.0]

### Added
- **Scope storage** - possibility to change storage of scope
- **Scopes view** - split shared / local scopes
### Improve
- **MCP Scopes** - MCP install to all mcp config files in project (.mcp.json, .gemini/settings.json)
- **MCP Scopes** - MCP tools handle JSONC format (comments, trailing commas)

## [1.2.0]

### Added
- **Switch active scope via `Shift+Alt+S` keyboard shortcut.**

## [1.1.1]

### Fixed
- **Scopes now work across multi-root workspaces.**

## [1.1.0]

### Added
- **MCP service for scopes** — bundled standalone MCP server exposing `list_scopes` and `get_scope_patterns` tools, allowing AI agents to discover and query scope definitions.
- **Install MCP command** — new *Scopes Manager: Install scopes MCP* command registers the server in `.mcp.json` (or `.gemini/settings.json`) at the workspace root.
