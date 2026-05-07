export const CMD = {
  ADD_TO_SCOPE: 'scopesManager.addToScope',
  REMOVE_FROM_SCOPE: 'scopesManager.removeFromScope',
  CREATE_SCOPE: 'scopesManager.createScope',
  DELETE_SCOPE: 'scopesManager.deleteScope',
  RENAME_SCOPE: 'scopesManager.renameScope',
  EDIT_SCOPE_COLOR: 'scopesManager.editScopeColor',
  CLEAR_SCOPE: 'scopesManager.clearScope',
  REMOVE_PATTERN: 'scopesManager.removePatternFromScope',
} as const;

export const CONFIG_KEY = 'scopesManager';
export const LOCAL_SCOPES_KEY = 'localScopes';
export const ACTIVE_SCOPE_KEY = 'activeScopeId';
export const MANAGED_PATTERNS_KEY = 'managedPatterns';
export const SHARED_SCOPES_FILENAME = 'scopes.json';
