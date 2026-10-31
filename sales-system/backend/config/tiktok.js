import crypto from "node:crypto";

const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
};

const getEncryptionKey = () => {
  const value = required("TIKTOK_TOKEN_ENCRYPTION_KEY");
  const key = Buffer.from(value, /^[a-f0-9]{64}$/i.test(value) ? "hex" : "base64");
  if (key.length !== 32) throw new Error("TIKTOK_TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes.");
  return key;
};

export const getTikTokConfig = () => ({
  appKey: required("TIKTOK_APP_KEY"),
  serviceId: required("TIKTOK_SERVICE_ID"),
  appSecret: required("TIKTOK_APP_SECRET"),
  redirectUri: required("TIKTOK_REDIRECT_URI"),
  frontendRedirectUri: process.env.TIKTOK_FRONTEND_REDIRECT_URI || "http://localhost:5173/settings/tiktok",
  authorizationUrl: process.env.TIKTOK_AUTHORIZATION_URL || "https://services.tiktokshop.com/open/authorize",
  tokenBaseUrl: process.env.TIKTOK_TOKEN_BASE_URL || "https://auth.tiktok-shops.com",
  apiBaseUrl: process.env.TIKTOK_API_BASE_URL || "https://open-api.tiktokglobalshop.com",
  tokenEncryptionKey: getEncryptionKey(),
});

export const encryptToken = (value) => {
  const key = getTikTokConfig().tokenEncryptionKey;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return {
    value: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
};

export const decryptToken = ({ value, iv, tag }) => {
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    getTikTokConfig().tokenEncryptionKey,
    Buffer.from(iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(value, "base64")),
    decipher.final(),
  ]).toString("utf8");
};
