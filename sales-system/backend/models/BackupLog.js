import mongoose from "mongoose";

const backupLogSchema = new mongoose.Schema(
  {
    backupType: { type: String, enum: ["ATLAS", "MONGODUMP", "MANUAL"], required: true },
    status: { type: String, enum: ["PENDING", "COMPLETED", "FAILED"], required: true },
    startedAt: { type: Date, required: true },
    completedAt: Date,
    backupReference: { type: String, trim: true, maxlength: 300 },
    fileSize: { type: Number, min: 0 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    errorMessage: { type: String, maxlength: 500 },
  },
  { timestamps: true }
);

export default mongoose.model("BackupLog", backupLogSchema);
