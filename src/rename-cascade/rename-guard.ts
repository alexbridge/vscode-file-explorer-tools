// Track active renames to prevent recursion between forward and reverse cascades
export const pendingRenames = new Set<string>();

export function releaseRenameGuard(filePath: string, ms = 1000) {
  setTimeout(() => {
    pendingRenames.delete(filePath);
  }, ms);
}

// Internal flag to block re-triggers from language server renames
export let isInternalRename = false;
export function setIsInternalRename(value: boolean) {
  isInternalRename = value;
}
