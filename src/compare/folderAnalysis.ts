/**
 * Splits mailbox path sets into intersection / symmetric difference for dual-server UI.
 */
export function analyzeFolderPaths(
  pathsA: string[],
  pathsB: string[]
): {
  inBoth: string[];
  onlyInA: string[];
  onlyInB: string[];
} {
  const setA = new Set(pathsA);
  const setB = new Set(pathsB);
  const inBoth = [...setA].filter((p) => setB.has(p)).sort((a, b) => a.localeCompare(b));
  const onlyInA = [...setA].filter((p) => !setB.has(p)).sort((a, b) => a.localeCompare(b));
  const onlyInB = [...setB].filter((p) => !setA.has(p)).sort((a, b) => a.localeCompare(b));
  return { inBoth, onlyInA, onlyInB };
}
