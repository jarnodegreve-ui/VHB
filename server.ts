import express from "express";
import cors from "cors";
import { createServer as createViteServer } from "vite";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_FILE = path.join(__dirname, "planning_data.json");
const USERS_FILE = path.join(__dirname, "users_data.json");
const DIVERSIONS_FILE = path.join(__dirname, "diversions_data.json");

// Supabase Client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;

if (!supabase) {
  console.warn("Supabase configuration missing. Falling back to local JSON files.");
} else {
  console.log("Supabase client initialized.");
}

// Helper to read/write data
const getPlanningData = async () => {
  if (supabase) {
    const { data, error } = await supabase.from('planning').select('*');
    if (error) throw error;
    return data || [];
  }
  if (fs.existsSync(DATA_FILE)) {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
  }
  return [];
};

const savePlanningData = async (data: any) => {
  if (supabase) {
    // For simplicity in this demo, we'll delete and re-insert
    // In a real app, you'd want upserts or specific updates
    const { error: deleteError } = await supabase.from('planning').delete().neq('id', '0');
    if (deleteError) throw deleteError;
    const { error: insertError } = await supabase.from('planning').insert(data);
    if (insertError) throw insertError;
    return;
  }
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
};

const getUsersData = async () => {
  if (supabase) {
    const { data, error } = await supabase.from('users').select('*');
    if (error) throw error;
    return data && data.length > 0 ? data : null;
  }
  if (fs.existsSync(USERS_FILE)) {
    return JSON.parse(fs.readFileSync(USERS_FILE, "utf-8"));
  }
  return null;
};

const saveUsersData = async (data: any) => {
  if (supabase) {
    const { error: deleteError } = await supabase.from('users').delete().neq('id', '0');
    if (deleteError) throw deleteError;
    const { error: insertError } = await supabase.from('users').insert(data);
    if (insertError) throw insertError;
    return;
  }
  fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2));
};

const getDiversionsData = async () => {
  if (supabase) {
    const { data, error } = await supabase.from('diversions').select('*');
    if (error) throw error;
    return data || [];
  }
  if (fs.existsSync(DIVERSIONS_FILE)) {
    return JSON.parse(fs.readFileSync(DIVERSIONS_FILE, "utf-8"));
  }
  return [];
};

const saveDiversionsData = async (data: any) => {
  if (supabase) {
    const { error: deleteError } = await supabase.from('diversions').delete().neq('id', '0');
    if (deleteError) throw deleteError;
    const { error: insertError } = await supabase.from('diversions').insert(data);
    if (insertError) throw insertError;
    return;
  }
  fs.writeFileSync(DIVERSIONS_FILE, JSON.stringify(data, null, 2));
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
    res.json({ 
      status: "ok", 
      supabase: !!supabase,
      env: process.env.NODE_ENV, 
      time: new Date().toISOString() 
    });
  });

  // API Routes
  app.get("/api/planning", async (req, res) => {
    try {
      const data = await getPlanningData();
      res.json(data);
    } catch (err) {
      console.error("Error reading planning data:", err);
      res.status(500).json({ error: "Failed to read data" });
    }
  });

  app.post("/api/planning", async (req, res) => {
    try {
      const newData = req.body;
      if (Array.isArray(newData)) {
        await savePlanningData(newData);
        res.json({ success: true, count: newData.length });
      } else {
        res.status(400).json({ error: "Invalid data format. Expected an array." });
      }
    } catch (err: any) {
      const errorMessage = err.message || (typeof err === 'object' ? JSON.stringify(err) : String(err));
      console.error("Error saving planning data:", errorMessage);
      res.status(500).json({ error: "Failed to save data", details: errorMessage });
    }
  });

  app.get("/api/users", async (req, res) => {
    try {
      const users = await getUsersData();
      res.json(users);
    } catch (err) {
      console.error("Error reading users data:", err);
      res.status(500).json({ error: "Failed to read data" });
    }
  });

  app.post("/api/users", async (req, res) => {
    try {
      const newData = req.body;
      if (Array.isArray(newData)) {
        await saveUsersData(newData);
        res.json({ success: true, count: newData.length });
      } else {
        res.status(400).json({ error: "Invalid data format. Expected an array." });
      }
    } catch (err: any) {
      const errorMessage = err.message || (typeof err === 'object' ? JSON.stringify(err) : String(err));
      console.error("Error saving users data:", errorMessage);
      res.status(500).json({ error: "Failed to save data", details: errorMessage });
    }
  });
  
  app.get("/api/diversions", async (req, res) => {
    try {
      const data = await getDiversionsData();
      res.json(data);
    } catch (err) {
      console.error("Error reading diversions data:", err);
      res.status(500).json({ error: "Failed to read data" });
    }
  });

  app.post("/api/diversions", async (req, res) => {
    try {
      const newData = req.body;
      if (Array.isArray(newData)) {
        await saveDiversionsData(newData);
        res.json({ success: true, count: newData.length });
      } else {
        res.status(400).json({ error: "Invalid data format. Expected an array." });
      }
    } catch (err: any) {
      const errorMessage = err.message || (typeof err === 'object' ? JSON.stringify(err) : String(err));
      console.error("Error saving diversions data:", errorMessage);
      res.status(500).json({ error: "Failed to save data", details: errorMessage });
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
