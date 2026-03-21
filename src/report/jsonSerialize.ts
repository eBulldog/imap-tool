/** JSON.stringify replacer: BigInt → string, Map/Set if encountered → array. */

export function jsonReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (value instanceof Map) {
    return Object.fromEntries(value);
  }
  if (value instanceof Set) {
    return [...value];
  }
  return value;
}

export function stringifyReport(value: unknown, pretty = false): string {
  return JSON.stringify(value, jsonReplacer, pretty ? 2 : undefined) + "\n";
}
