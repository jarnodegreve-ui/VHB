import express from "express";
// Build trigger: Environment variables updated in Vercel
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
const SERVICES_FILE = path.join(process.cwd(), "services_data.json");

// Supabase Client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;

if (!supabase) {
  console.warn("Supabase configuration missing. Falling back to local JSON files.");
} else {
  console.log("Supabase client initialized.");
}

// Default Mock Data
const DEFAULT_USERS = [
  { id: '1', name: 'Jan de Vries', role: 'chauffeur', employeeId: 'CH-4492', password: '123', phone: '0470 12 34 56', isActive: true },
  { id: '2', name: 'Sarah de Groot', role: 'planner', employeeId: 'PL-1102', password: '123', phone: '0480 98 76 54', isActive: true },
  { id: '3', name: 'Mark Admin', role: 'admin', employeeId: 'AD-0001', password: '123', phone: '0490 55 44 33', isActive: true },
];

const DEFAULT_SERVICES = [
  { id: '1', serviceNumber: 'D-101', startTime: '05:30', endTime: '13:45' },
  { id: '2', serviceNumber: 'D-102', startTime: '06:15', endTime: '14:30' },
  { id: '3', serviceNumber: 'D-201', startTime: '13:30', endTime: '21:45' },
  { id: '4', serviceNumber: 'D-202', startTime: '14:15', endTime: '22:30' },
  { id: '5', serviceNumber: 'D-301', startTime: '21:30', endTime: '05:45' },
  { id: '6', serviceNumber: 'D-103', startTime: '07:00', endTime: '15:15' },
  { id: '7', serviceNumber: 'D-104', startTime: '08:30', endTime: '16:45' },
];

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
    const { error } = await supabase.from('planning').upsert(data);
    if (error) throw error;
    return;
  }
  if (process.env.VERCEL) {
    throw new Error("Supabase is niet geconfigureerd op Vercel.");
  }
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
};

const getUsersData = async () => {
  console.log("getUsersData called. Supabase configured:", !!supabase);
  if (supabase) {
    try {
      const { data, error } = await supabase.from('users').select('*');
      if (error) {
        console.error("Supabase error fetching users:", error);
      } else if (data) {
        console.log(`Supabase returned ${data.length} users`);
        // If we have a connection to Supabase, it's the source of truth.
        // We only fall back to local/defaults if Supabase is empty AND we have local data.
        if (data.length > 0) return data;
        
        // If Supabase is empty, check if we have local data to "bootstrap" from
        if (fs.existsSync(USERS_FILE)) {
          const content = fs.readFileSync(USERS_FILE, "utf-8");
          if (content.trim()) {
            const localData = JSON.parse(content);
            if (Array.isArray(localData) && localData.length > 0) {
              console.log("Supabase empty, using local file data");
              return localData;
            }
          }
        }
        // If both are empty, return empty array (don't force defaults if we're connected)
        return [];
      }
    } catch (e) {
      console.error("Unexpected error fetching users:", e);
    }
  }
  
  // Fallback for non-Supabase environments
  if (fs.existsSync(USERS_FILE)) {
    try {
      const content = fs.readFileSync(USERS_FILE, "utf-8");
      if (content.trim()) {
        const data = JSON.parse(content);
        if (Array.isArray(data) && data.length > 0) return data;
      }
    } catch (e) {
      console.error("Error reading users file:", e);
    }
  }
  console.log("No data found, returning DEFAULT_USERS");
  return DEFAULT_USERS;
};

const saveUsersData = async (data: any) => {
  console.log(`saveUsersData called with ${data.length} items. Supabase:`, !!supabase);
  if (supabase) {
    const { error } = await supabase.from('users').upsert(data);
    if (error) {
      console.error("Supabase upsert error:", error);
      throw error;
    }
    console.log("Supabase upsert successful");
    return;
  }
  
  if (process.env.VERCEL) {
    throw new Error("Supabase is niet geconfigureerd op Vercel. Controleer de omgevingsvariabelen (SUPABASE_URL en SUPABASE_ANON_KEY) in het Vercel dashboard.");
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
    const { error } = await supabase.from('diversions').upsert(data);
    if (error) throw error;
    return;
  }
  if (process.env.VERCEL) {
    throw new Error("Supabase is niet geconfigureerd op Vercel.");
  }
  fs.writeFileSync(DIVERSIONS_FILE, JSON.stringify(data, null, 2));
};

const getServicesData = async () => {
  if (supabase) {
    try {
      const { data, error } = await supabase.from('services').select('*');
      if (error) {
        // If it's a missing table error (42P01 in Postgres), we just log a warning and fallback
        if (error.code === '42P01') {
          console.warn("Supabase 'services' table not found. Falling back to local/mock data.");
        } else {
          console.error("Supabase error fetching services:", error);
        }
      } else if (data && data.length > 0) {
        return data;
      }
    } catch (e) {
      console.error("Unexpected error fetching services:", e);
    }
  }
  if (fs.existsSync(SERVICES_FILE)) {
    try {
      const content = fs.readFileSync(SERVICES_FILE, "utf-8");
      if (content.trim()) {
        const data = JSON.parse(content);
        if (Array.isArray(data) && data.length > 0) return data;
      }
    } catch (e) {
      console.error("Error reading services file:", e);
    }
  }
  return DEFAULT_SERVICES;
};

const saveServicesData = async (data: any) => {
  if (supabase) {
    const { error } = await supabase.from('services').upsert(data);
    if (error) throw error;
    return;
  }
  if (process.env.VERCEL) {
    throw new Error("Supabase is niet geconfigureerd op Vercel.");
  }
  fs.writeFileSync(SERVICES_FILE, JSON.stringify(data, null, 2));
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
app.get("/api/health", async (req, res) => {
  let supabaseStatus = "not configured";
  let tables: any = {};
  
  if (supabase) {
    supabaseStatus = "configured";
    try {
      const checkTable = async (name: string) => {
        try {
          const { error } = await supabase.from(name).select('*').limit(0);
          return error ? `Error: ${error.message}` : "OK";
        } catch (e: any) {
          return `Exception: ${e.message}`;
        }
      };
      
      tables.users = await checkTable('users');
      tables.planning = await checkTable('planning');
      tables.diversions = await checkTable('diversions');
      tables.services = await checkTable('services');
    } catch (e: any) {
      supabaseStatus = `Error: ${e.message}`;
    }
  }

  res.json({ 
    status: "ok", 
    supabase: supabaseStatus,
    tables,
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

app.get("/api/services", async (req, res) => {
  try {
    const data = await getServicesData();
    res.json(data);
  } catch (err) {
    console.error("Error reading services data:", err);
    res.status(500).json({ error: "Failed to read data" });
  }
});

app.post("/api/services", async (req, res) => {
  try {
    const newData = req.body;
    if (Array.isArray(newData)) {
      await saveServicesData(newData);
      res.json({ success: true, count: newData.length });
    } else {
      res.status(400).json({ error: "Invalid data format. Expected an array." });
    }
  } catch (err: any) {
    const errorMessage = err.message || (typeof err === 'object' ? JSON.stringify(err) : String(err));
    console.error("Error saving services data:", errorMessage);
    res.status(500).json({ error: "Failed to save data", details: errorMessage });
  }
});

app.get("/api/test", (req, res) => {
  res.send("VHB Portaal API is active");
});

// Admin endpoint to sync local JSON to Supabase
app.post("/api/admin/sync", async (req, res) => {
  console.log("Sync request received");
  if (!supabase) {
    console.error("Sync failed: Supabase not configured");
    return res.status(400).json({ error: "Supabase not configured. Cannot sync." });
  }

  try {
    const results: any = {};
    const cwd = process.cwd();
    console.log("Current working directory:", cwd);
    
    try {
      console.log("Files in CWD:", fs.readdirSync(cwd).join(", "));
    } catch (e) {
      console.error("Error reading CWD:", e);
    }

    // Sync Planning
    try {
      console.log("Checking planning file:", DATA_FILE);
      if (fs.existsSync(DATA_FILE)) {
        const localPlanning = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
        console.log(`Found ${localPlanning.length} planning items`);
        if (localPlanning.length > 0) {
          const { error } = await supabase.from('planning').upsert(localPlanning);
          if (error) console.error("Planning sync error:", error);
          results.planning = error ? `Error: ${error.message}` : `Synced ${localPlanning.length} items`;
        } else {
          results.planning = "Empty file";
        }
      } else {
        console.warn("Planning file not found");
        results.planning = "File not found";
      }
    } catch (e: any) {
      results.planning = `Exception: ${e.message}`;
    }

    // Sync Users
    try {
      console.log("Checking users file:", USERS_FILE);
      if (fs.existsSync(USERS_FILE)) {
        const localUsers = JSON.parse(fs.readFileSync(USERS_FILE, "utf-8"));
        console.log(`Found ${localUsers.length} users`);
        if (localUsers.length > 0) {
          const { error } = await supabase.from('users').upsert(localUsers);
          if (error) console.error("Users sync error:", error);
          results.users = error ? `Error: ${error.message}` : `Synced ${localUsers.length} items`;
        } else {
          results.users = "Empty file";
        }
      } else {
        console.warn("Users file not found");
        results.users = "File not found";
      }
    } catch (e: any) {
      results.users = `Exception: ${e.message}`;
    }

    // Sync Diversions
    try {
      console.log("Checking diversions file:", DIVERSIONS_FILE);
      if (fs.existsSync(DIVERSIONS_FILE)) {
        const localDiversions = JSON.parse(fs.readFileSync(DIVERSIONS_FILE, "utf-8"));
        console.log(`Found ${localDiversions.length} diversions`);
        if (localDiversions.length > 0) {
          const { error } = await supabase.from('diversions').upsert(localDiversions);
          if (error) console.error("Diversions sync error:", error);
          results.diversions = error ? `Error: ${error.message}` : `Synced ${localDiversions.length} items`;
        } else {
          results.diversions = "Empty file";
        }
      } else {
        console.warn("Diversions file not found");
        results.diversions = "File not found";
      }
    } catch (e: any) {
      results.diversions = `Exception: ${e.message}`;
    }

    // Sync Services
    try {
      console.log("Checking services file:", SERVICES_FILE);
      if (fs.existsSync(SERVICES_FILE)) {
        const localServices = JSON.parse(fs.readFileSync(SERVICES_FILE, "utf-8"));
        console.log(`Found ${localServices.length} services`);
        if (localServices.length > 0) {
          const { error } = await supabase.from('services').upsert(localServices);
          if (error) console.error("Services sync error:", error);
          results.services = error ? `Error: ${error.message}` : `Synced ${localServices.length} items`;
        } else {
          results.services = "Empty file";
        }
      } else {
        console.warn("Services file not found");
        results.services = "File not found";
      }
    } catch (e: any) {
      results.services = `Exception: ${e.message}`;
    }

    console.log("Sync completed with results:", results);
    res.json({ success: true, results });
  } catch (err: any) {
    console.error("Global sync error:", err);
    res.status(500).json({ error: "Sync failed", details: err.message });
  }
});

// Catch-all for API routes to ensure JSON response
app.all("/api/*", (req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.url} not found on server` });
});

// Global error handler
app.use((err: any, req: any, res: any, next: any) => {
  console.error("GLOBAL ERROR:", err);
  res.status(500).json({ 
    error: "Internal Server Error", 
    details: err.message || String(err),
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
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
} else {
  // Production mode
  console.log("Starting in production mode...");
  const distPath = path.join(process.cwd(), "dist");
  
  if (fs.existsSync(distPath)) {
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  } else {
    console.warn("Dist folder not found. Static serving disabled.");
    app.get("*", (req, res) => {
      res.status(404).send("Production build not found. Please run 'npm run build'.");
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

export default app;
