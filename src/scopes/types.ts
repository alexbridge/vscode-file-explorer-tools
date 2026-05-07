export interface ScopeDefinition {
  id: string;
  name: string;
  storage: "local" | "shared";
  color?: string;
  patterns: string[];
}

export interface SharedScopesFile {
  scopes: Omit<ScopeDefinition, "storage">[];
}
