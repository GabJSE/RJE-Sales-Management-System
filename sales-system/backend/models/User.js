import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    username: { type: String, required: true, unique: true, trim: true, lowercase: true, maxlength: 50 },
    email: { type: String, required: true, unique: true, trim: true, lowercase: true, maxlength: 160 },
    password: { type: String, required: true, select: false },
    role: { type: String, enum: ["admin", "staff"], default: "staff", required: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

userSchema.methods.comparePassword = function comparePassword(value) {
  return bcrypt.compare(value, this.password);
};

export default mongoose.model("User", userSchema);
