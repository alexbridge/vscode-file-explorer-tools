export const CMD = {
  ADD_TO_SCOPE: "scopesManager.addToScope",
  REMOVE_FROM_SCOPE: "scopesManager.removeFromScope",
  CREATE_SCOPE: "scopesManager.createScope",
  DELETE_SCOPE: "scopesManager.deleteScope",
  RENAME_SCOPE: "scopesManager.renameScope",
  EDIT_SCOPE_COLOR: "scopesManager.editScopeColor",
  CLEAR_SCOPE: "scopesManager.clearScope",
  REMOVE_PATTERN: "scopesManager.removePatternFromScope",
} as const;

export const CONFIG_KEY = "scopesManager";
export const LOCAL_SCOPES_KEY = "localScopes";
export const SHARED_SCOPES_FILENAME = "scopes.json";

export const COLOR_PRESETS: { label: string; id: string; themeColor: string }[] = [
  { label: "Red", id: "red", themeColor: "charts.red" },
  { label: "Blue", id: "blue", themeColor: "charts.blue" },
  { label: "Green", id: "green", themeColor: "charts.green" },
  { label: "Yellow", id: "yellow", themeColor: "charts.yellow" },
  { label: "Orange", id: "orange", themeColor: "charts.orange" },
  { label: "Purple", id: "purple", themeColor: "charts.purple" },
];
