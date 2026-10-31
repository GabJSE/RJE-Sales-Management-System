import mongoose from "mongoose";

const encryptedTokenSchema = new mongoose.Schema(
  {
    value: { type: String, required: true },
    iv: { type: String, required: true },
    tag: { type: String, required: true },
  },
  { _id: false }
);

const tikTokShopSchema = new mongoose.Schema(
  {
    key: { type: String, default: "singleton", unique: true, immutable: true },
    shopId: { type: String, trim: true },
    shopName: { type: String, trim: true },
    shopCipher: { type: String, select: false }, shopInfoSyncedAt: Date, lastProductSyncAt: Date, syncLeaseUntil: Date, syncOwner: String,
    lastSettlementSyncAt: Date, settlementSyncLeaseUntil: Date, settlementSyncOwner: String,
    lastOrderSyncAt: Date, orderSyncLeaseUntil: Date, orderSyncOwner: String,
    region: { type: String, trim: true },
    accessToken: { type: encryptedTokenSchema, select: false },
    refreshToken: { type: encryptedTokenSchema, select: false },
    accessTokenExpiresAt: { type: Date },
    refreshTokenExpiresAt: { type: Date },
    scopes: { type: [String], default: [] },
    connectedAt: { type: Date },
    lastRefreshedAt: { type: Date },
    disconnectedAt: { type: Date },
    status: { type: String, enum: ["connected", "disconnected"], default: "disconnected" },
  },
  { timestamps: true }
);

export default mongoose.model("TikTokShop", tikTokShopSchema);

