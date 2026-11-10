// Only an explicit line ID proves duplication. Equal names/SKUs can be real units.
export function uniqueOrderLines(lines, idField = "lineItemId") {
  const seen = new Map();
  return lines.filter(line => {
    const id = line[idField];
    if (id == null || id === "") return true;
    const key = String(id);
    const signature = JSON.stringify(Object.fromEntries(Object.entries(line).sort(([a], [b]) => a.localeCompare(b))));
    if (!seen.has(key)) { seen.set(key, signature); return true; }
    if (seen.get(key) !== signature) throw new Error(`Conflicting order line records for line ID ${key}. Refresh the original order before reconciliation.`);
    return false;
  });
}
