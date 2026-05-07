/**
 * Converts a file base name (kebab-case, snake_case, camelCase, or PascalCase)
 * to PascalCase.
 *
 * Examples:
 *   foo-entity            -> FooEntity
 *   foo_entity            -> FooEntity
 *   fooEntity             -> FooEntity
 *   FooEntity             -> FooEntity
 *   foo-bar.component     -> FooBarComponent
 */
export function toPascalCase(baseName: string): string {
  // Split on hyphens, underscores, dots, or camelCase boundaries
  const segments = baseName
    .replace(/[-_.]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/\s+/)
    .filter(Boolean);

  return segments.map((s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()).join('');
}

export function deriveNewSymbolName(newBaseName: string): string {
  return toPascalCase(newBaseName);
}
