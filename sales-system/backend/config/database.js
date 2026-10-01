import dns from "node:dns";
import mongoose from "mongoose";

dns.setServers(["1.1.1.1", "8.8.8.8"]);

const connectDatabase = async () => {
  const mongoUri = process.env.MONGODB_URI;

  if (!mongoUri) {
    throw new Error("MONGODB_URI is not configured.");
  }

  await mongoose.connect(mongoUri);
  console.log("Connected to MongoDB");
};

export default connectDatabase;
