import express from "express";
import cors from "cors";
import { createServer as createViteServer } from "vite";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_FILE = path.join(__dirname, "planning_data.json");
const USERS_FILE = path.join(__dirname, "users_data.json");

// Helper to read/write data
const getPlanningData = () => {
  if (fs.existsSync(DATA_FILE)) {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
  }
  return [];
};

const savePlanningData = (data: any) => {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
};

const getUsersData = () => {
  if (fs.existsSync(USERS_FILE)) {
    return JSON.parse(fs.readFileSync(USERS_FILE, "utf-8"));
  }
  return null; // Return null if no custom users yet
};

const saveUsersData = (data: any) => {
  fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2));
};

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json({ limit: '10mb' }));

  app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
  });

  // Health check
  app.get("/api/health", (req, res) => {
    console.log("Health check requested");
    res.json({ status: "ok", env: process.env.NODE_ENV, time: new Date().toISOString() });
  });

  app.get("/test", (req, res) => {
    console.log("Test route hit");
    res.send("Server is reachable and active!");
  });

  // API Routes
  app.get("/api/planning", (req, res) => {
    try {
      console.log("Fetching planning data");
      res.json(getPlanningData());
    } catch (err) {
      console.error("Error reading planning data:", err);
      res.status(500).json({ error: "Failed to read data" });
    }
  });

  app.post("/api/planning", (req, res) => {
    try {
      const newData = req.body;
      if (Array.isArray(newData)) {
        savePlanningData(newData);
        res.json({ success: true, count: newData.length });
      } else {
        res.status(400).json({ error: "Invalid data format. Expected an array." });
      }
    } catch (err) {
      console.error("Error saving planning data:", err);
      res.status(500).json({ error: "Failed to save data" });
    }
  });

  app.get("/api/users", (req, res) => {
    try {
      const users = getUsersData();
      res.json(users);
    } catch (err) {
      console.error("Error reading users data:", err);
      res.status(500).json({ error: "Failed to read data" });
    }
  });

  app.post("/api/users", (req, res) => {
    try {
      const newData = req.body;
      if (Array.isArray(newData)) {
        saveUsersData(newData);
        res.json({ success: true, count: newData.length });
      } else {
        res.status(400).json({ error: "Invalid data format. Expected an array." });
      }
    } catch (err) {
      console.error("Error saving users data:", err);
      res.status(500).json({ error: "Failed to save data" });
    }
  });

  app.get("/", (req, res, next) => {
    console.log("Root route hit");
    // If it's a browser request, let Vite handle it
    if (req.headers.accept?.includes("text/html")) {
      return next();
    }
    res.send("VHB Portaal API is active");
  });

  // Use Vite middleware for everything else (SPA fallback, static assets, etc.)
  console.log("Starting with Vite middleware...");
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: "spa",
    optimizeDeps: {
      include: ['react', 'react-dom']
    }
  });
  app.use(vite.middlewares);

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
