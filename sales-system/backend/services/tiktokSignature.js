import crypto from "node:crypto";

export const createTikTokSignature = ({ appSecret, path, query = {}, body = "" }) => {
  const canonicalQuery = Object.entries(query)
    .filter(([key, value]) => key !== "sign" && value !== undefined && value !== null)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}${value}`)
    .join("");
  const payload = `${appSecret}${path}${canonicalQuery}${body}${appSecret}`;
  return crypto.createHmac("sha256", appSecret).update(payload).digest("hex");
};
