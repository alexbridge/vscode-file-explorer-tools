# Changelog

All notable changes to File Explorer Tools will be documented here.

## [1.1.1] - 2026-04-28

### Fixed
- **Scopes now work across multi-root workspaces.**

## [1.1.0] - 2026-04-21

### Added
- **MCP service for scopes** — bundled standalone MCP server exposing `list_scopes` and `get_scope_patterns` tools, allowing AI agents to discover and query scope definitions.
- **Install MCP command** — new *Scopes Manager: Install scopes MCP* command registers the server in `.mcp.json` (or `.gemini/settings.json`) at the workspace root.
