import express from "express";
import path from "path";
import cors from "cors";
import { createServer as createViteServer } from "vite";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

// Lazily load Google libraries to avoid issues during startup/bundling
let GoogleSpreadsheet: any;
let JWT: any;

async function loadGoogleLibs() {
  if (!GoogleSpreadsheet || !JWT) {
    const { createRequire } = await import("module");
    const require = createRequire(import.meta.url);
    const gs = require("google-spreadsheet");
    const gal = require("google-auth-library");
    GoogleSpreadsheet = gs.GoogleSpreadsheet;
    JWT = gal.JWT;
  }
}

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

// --- EchoTik Service Logic --- (unchanged but using axios)
let echotikToken: string | null = null;
let tokenExpiry: number = 0;

async function getEchoTikToken() {
  if (echotikToken && Date.now() < tokenExpiry) {
    return echotikToken;
  }

  const username = process.env.ECHOTIK_USERNAME;
  const password = process.env.ECHOTIK_PASSWORD;

  if (!username || !password) {
    throw new Error("EchoTik credentials missing");
  }

  try {
    const endpoints = [
      "https://api-openapi.echotik.live/api/v1/openapi/auth/login",
      "https://api-openapi.echotik.live/api/v1/auth/login",
      "https://api-openapi.echotik.live/auth/login",
      "https://api-openapi.echotik.live/open/v1/auth/login",
      "https://openapi.echotik.live/api/v1/auth/login",
      "https://api.echotik.live/api/v1/openapi/auth/login"
    ];

    let lastError: any = null;
    let failedEndpoints: string[] = [];
    for (const endpoint of endpoints) {
      try {
        console.log(`Trying EchoTik login at: ${endpoint}`);
        const response = await axios.post(endpoint, { username, password }, {
          headers: { 'Content-Type': 'application/json' },
          timeout: 5000
        });
        
        if (response.data && response.data.data && response.data.data.token) {
          echotikToken = response.data.data.token;
          tokenExpiry = Date.now() + 23 * 60 * 60 * 1000;
          console.log(`Successfully logged in via: ${endpoint}`);
          return echotikToken;
        } else {
          console.warn(`Endpoint ${endpoint} returned success status but no token:`, response.data);
          failedEndpoints.push(`${endpoint} (no token)`);
        }
      } catch (error: any) {
        lastError = error;
        const status = error.response?.status;
        console.warn(`Failed endpoint ${endpoint}: ${error.message}${status ? ` (status: ${status})` : ''}`);
        failedEndpoints.push(`${endpoint} (${status || error.message})`);
      }
    }
    
    throw new Error(`EchoTik login failed on all endpoints: ${failedEndpoints.join(', ')}`);
  } catch (error: any) {
    console.error("EchoTik login failed:", error.message);
    throw error;
  }
}

// --- Google Sheets Service Logic ---
async function syncToSheets(data: any[]) {
  await loadGoogleLibs();
  
  const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  const sheetId = process.env.GOOGLE_SHEET_ID;

  if (!serviceAccountEmail || !privateKey || !sheetId) {
    console.warn("Google Sheets config missing, skipping sync.");
    return;
  }

  const auth = new JWT({
    email: serviceAccountEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  const doc = new GoogleSpreadsheet(sheetId, auth);
  await doc.loadInfo();
  
  const sheet = doc.sheetsByIndex[0];
  
  const rows = data.map(item => ({
    "Nombre": item.name,
    "Handle": item.handle,
    "URL": `https://www.tiktok.com/@${item.handle}`,
    "País": item.country,
    "Followers": item.followers || 0,
    "Revenue": item.revenue || 0,
    "Categoría": item.category || "N/A",
    "Email": item.email || "N/A",
    "Última Actualización": new Date().toISOString()
  }));

  await sheet.addRows(rows);
}

// ... rest of API routes ...
app.get("/api/leads", async (req, res) => {
  try {
    const { region = "ES", type = "shop" } = req.query;
    const token = await getEchoTikToken();
    
    const endpoints = type === "shop" 
      ? [
          "https://api-openapi.echotik.live/api/v1/openapi/shop/search",
          "https://api-openapi.echotik.live/api/v1/shop/search",
          "https://api-openapi.echotik.live/open/v1/shop/search"
        ]
      : [
          "https://api-openapi.echotik.live/api/v1/openapi/creator/search",
          "https://api-openapi.echotik.live/api/v1/creator/search",
          "https://api-openapi.echotik.live/open/v1/creator/search"
        ];

    let lastError: any = null;
    for (const endpoint of endpoints) {
      try {
        console.log(`Searching EchoTik at: ${endpoint}`);
        const response = await axios.get(endpoint, {
          headers: { Authorization: `Bearer ${token}` },
          params: { region, page_size: 20 },
          timeout: 10000
        });
        return res.json(response.data);
      } catch (err: any) {
        lastError = err;
        console.warn(`Search failed on ${endpoint}: ${err.message}`);
      }
    }

    throw lastError;
  } catch (error: any) {
    console.error("Leads search failed:", error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/sync", async (req, res) => {
  try {
    const { leads } = req.body;
    await syncToSheets(leads);
    res.json({ status: "ok" });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/config-status", (req, res) => {
  res.json({
    echotik: !!(process.env.ECHOTIK_USERNAME && process.env.ECHOTIK_PASSWORD),
    googleSheets: !!(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY && process.env.GOOGLE_SHEET_ID),
    serviceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || null
  });
});

async function start() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

start();
