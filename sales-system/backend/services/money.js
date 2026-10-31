export const toMinor = value => {
  const source = String(value ?? "0").trim();
  if (!/^-?\d+(\.\d+)?$/.test(source)) return 0n;
  const negative = source.startsWith("-"); const clean = negative ? source.slice(1) : source;
  const [whole, fraction = ""] = clean.split(".");
  const result = BigInt(whole) * 100n + BigInt((fraction + "00").slice(0, 2));
  return negative ? -result : result;
};
export const minorString = value => BigInt(value || 0).toString();
export const fromMinor = value => Number(BigInt(value || 0)) / 100;
export const sumMinorLeaves = value => {
  if (value == null) return 0n;
  if (typeof value !== "object") return toMinor(value);
  return Object.values(value).reduce((sum, child) => sum + sumMinorLeaves(child), 0n);
};
