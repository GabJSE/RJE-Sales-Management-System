import cors from "cors";
import dns from "node:dns";
import dotenv from "dotenv";
import express from "express";
import connectDatabase from "./config/database.js";
import productRoutes from "./routes/productRoutes.js";
import saleRoutes from "./routes/saleRoutes.js";
import reportRoutes from "./routes/reportRoutes.js";
import dashboardRoutes from "./routes/dashboardRoutes.js";
import inventoryRoutes from "./routes/inventoryRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import { authenticate } from "./middleware/auth.js";
import settingsRoutes from "./routes/settingsRoutes.js";
import exportRoutes from "./routes/exportRoutes.js";
import backupRoutes from "./routes/backupRoutes.js";

dns.setServers(["1.1.1.1", "8.8.8.8"]);
dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/exports", exportRoutes);
app.use("/api/backups", backupRoutes);
app.use(authenticate);
app.use("/api/products", productRoutes);
app.use("/api/sales", saleRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/inventory", inventoryRoutes);

app.use((error, _req, res, _next) => {
  if (error.code === 20 || error.message?.includes("Transaction numbers are only allowed")) {
    return res.status(503).json({ message: "Inventory updates require MongoDB transactions. Use MongoDB Atlas or a replica-set deployment." });
  }

  if (error.code === 11000) {
    const duplicateField = Object.keys(error.keyPattern || {})[0];
    return res.status(409).json({ message: duplicateField ? `A record with this ${duplicateField} already exists.` : "A record with the same unique value already exists." });
  }

  if (error.name === "ValidationError") {
    const messages = Object.values(error.errors).map((item) => item.message);
    return res.status(400).json({ message: messages.join(" ") });
  }

  if (error.statusCode) {
    return res.status(error.statusCode).json({ message: error.message });
  }

  console.error(error);
  res.status(500).json({ message: "Something went wrong on the server." });
});

const startServer = async () => {
  try {
    await connectDatabase();
    app.listen(port, () => {
      console.log(`Server running at http://localhost:${port}`);
    });
  } catch (error) {
    console.error(`Unable to start server: ${error.message}`);
    process.exit(1);
  }
};

startServer();
