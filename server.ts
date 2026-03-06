import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

console.log("Server starting in environment:", process.env.NODE_ENV);
console.log("Supabase URL present:", !!process.env.SUPABASE_URL);
console.log("Supabase Key present:", !!process.env.SUPABASE_ANON_KEY);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Use /tmp for local files on Vercel if needed, but for reading we use process.cwd()
const DATA_FILE = path.join(process.cwd(), "planning_data.json");
const USERS_FILE = path.join(process.cwd(), "users_data.json");
const DIVERSIONS_FILE = path.join(process.cwd(), "diversions_data.json");

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
    try {
      const { data, error } = await supabase.from('planning').select('*');
      if (error) {
        console.error("Supabase error fetching planning:", error);
      } else if (data && data.length > 0) {
        return data;
      }
    } catch (e) {
      console.error("Unexpected error fetching planning:", e);
    }
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
    try {
      const { data, error } = await supabase.from('users').select('*');
      if (error) {
        console.error("Supabase error fetching users:", error);
      } else if (data && data.length > 0) {
        return data;
      }
    } catch (e) {
      console.error("Unexpected error fetching users:", e);
    }
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
    try {
      const { data, error } = await supabase.from('diversions').select('*');
      if (error) {
        console.error("Supabase error fetching diversions:", error);
      } else if (data && data.length > 0) {
        return data;
      }
    } catch (e) {
      console.error("Unexpected error fetching diversions:", e);
    }
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

app.get("/api/test", (req, res) => {
  res.send("VHB Portaal API is active");
});

// Admin endpoint to sync local JSON to Supabase
app.post("/api/admin/sync", async (req, res) => {
  if (!supabase) {
    return res.status(400).json({ error: "Supabase not configured. Cannot sync." });
  }

  try {
    const results: any = {};

    // Sync Planning
    if (fs.existsSync(DATA_FILE)) {
      const localPlanning = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
      if (localPlanning.length > 0) {
        const { error } = await supabase.from('planning').upsert(localPlanning);
        results.planning = error ? `Error: ${error.message}` : `Synced ${localPlanning.length} items`;
      }
    }

    // Sync Users
    if (fs.existsSync(USERS_FILE)) {
      const localUsers = JSON.parse(fs.readFileSync(USERS_FILE, "utf-8"));
      if (localUsers.length > 0) {
        const { error } = await supabase.from('users').upsert(localUsers);
        results.users = error ? `Error: ${error.message}` : `Synced ${localUsers.length} items`;
      }
    }

    // Sync Diversions
    if (fs.existsSync(DIVERSIONS_FILE)) {
      const localDiversions = JSON.parse(fs.readFileSync(DIVERSIONS_FILE, "utf-8"));
      if (localDiversions.length > 0) {
        const { error } = await supabase.from('diversions').upsert(localDiversions);
        results.diversions = error ? `Error: ${error.message}` : `Synced ${localDiversions.length} items`;
      }
    }

    res.json({ success: true, results });
  } catch (err: any) {
    res.status(500).json({ error: "Sync failed", details: err.message });
  }
});

// Vite middleware for development
if (process.env.NODE_ENV !== "production" && !process.env.VERCEL) {
  const startVite = async () => {
    const { createServer: createViteServer } = await import("vite");
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
  };
  startVite();
}

export default app;
