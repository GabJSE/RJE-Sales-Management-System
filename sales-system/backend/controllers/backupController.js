import BackupLog from "../models/BackupLog.js";

export const getBackupInfo = async (_req, res, next) => {
  try {
    const history = await BackupLog.find().sort({ createdAt: -1 }).limit(50).populate("createdBy", "name username").lean();
    res.json({
      automatedBackupsSupported: false,
      status: "MANUAL_REQUIRED",
      lastSuccessfulBackup: history.find((item) => item.status === "COMPLETED") || null,
      history,
      collections: ["products", "sales", "inventorymovements", "users", "systemsettings"],
      instructions: {
        backup: "Use MongoDB Atlas Cloud Backup, or run mongodump from a secure machine with the configured MONGODB_URI. Store the output outside the frontend directory.",
        restore: "Validate the dump, create a recovery copy first, then use mongorestore or Atlas Point-in-Time Recovery. Never paste credentials into the application.",
      },
    });
  } catch (error) { next(error); }
};
