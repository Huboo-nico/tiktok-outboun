import express from "express";
import path from "path";
import cors from "cors";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

// Lazily load libraries to avoid issues during startup/bundling or in Vercel
let GoogleSpreadsheet: any;
let JWT: any;
let createViteServer: any;

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

  const username = process.env.ECHOTIK_USERNAME || process.env.ECHOTIK_APP_KEY;
  const password = process.env.ECHOTIK_PASSWORD || process.env.ECHOTIK_APP_SECRET;

  if (!username || !password) {
    throw new Error(`EchoTik credentials missing. ECHOTIK_APP_KEY/SECRET or ECHOTIK_USERNAME/PASSWORD needed.`);
  }

  // Basic validation: EchoTik app secrets are typically hex strings or base64 and usually have a minimum length
  if (password.length < 16) {
    console.warn(`Warning: EchoTik secret seems suspiciously short (${password.length} chars).`);
  }

  console.log(`Attempting EchoTik login: USERNAME/KEY=${username.slice(0, 4)}... (Length: ${username.length}), SECRET_LENGTH=${password.length}`);

  try {
    const endpoints = [
      "https://api-openapi.echotik.live/api/v1/openapi/auth/login",
      "https://openapi.echotik.live/api/v1/openapi/auth/login",
      "https://api-openapi.echotik.live/api/v1/auth/login",
      "https://openapi.echotik.live/api/v1/auth/login",
      "https://api.echotik.live/api/v1/openapi/auth/login",
      "https://api.echotik.live/api/v1/auth/login",
      "https://echotik.live/api/v1/openapi/auth/login",
      "https://echotik.live/api/v1/auth/login",
      "https://api-openapi.echotik.live/v1/openapi/auth/login",
      "https://openapi.echotik.live/v1/openapi/auth/login"
    ];

    let lastError: any = null;
    
    for (const endpoint of endpoints) {
      try {
        console.log(`Trying EchoTik login at: ${endpoint}`);
        // Attempting multiple payload shapes based on docs and common variations
        const payloads = [
          { app_key: username, app_secret: password },
          { account: username, password: password },
          { username, password },
          { appKey: username, appSecret: password }
        ];

        let response: any = null;
        for (const payload of payloads) {
          try {
            console.log(`Payload: ${JSON.stringify({ ...payload, app_secret: '***', password: '***', appSecret: '***' })}`);
            const res = await axios.post(endpoint, payload, {
              headers: { 
                'Content-Type': 'application/json',
                'x-echotik-app-key': username,
                'x-echotik-app-secret': password
              },
              timeout: 10000
            });
            
            // Handle various successful response structures
            const token = res.data?.data?.token || res.data?.token || res.data?.data?.accessToken;
            if (token) {
              response = res;
              break;
            } else {
              console.log(`Payload failed structure for ${Object.keys(payload).join(', ')}: ${JSON.stringify(res.data).slice(0, 100)}`);
            }
          } catch (e: any) {
            const detail = e.response?.data ? JSON.stringify(e.response.data) : e.message;
            console.log(`Payload error for ${Object.keys(payload).join(', ')}: ${detail}`);
          }
        }
    
        if (response) {
          const data = response.data.data || response.data;
          echotikToken = data.token || data.accessToken;
          tokenExpiry = Date.now() + 23 * 60 * 60 * 1000;
          console.log(`Successfully logged in via: ${endpoint}`);
          return echotikToken;
        }
      } catch (error: any) {
        lastError = error;
        console.warn(`Failed endpoint ${endpoint}: ${error.message}`);
      }
    }
    
    throw new Error(`EchoTik login failed on all endpoints. Last error: ${lastError?.message}`);
  } catch (error: any) {
    console.error("EchoTik login failed:", error.message);
    throw error;
  }
}

// --- Google Sheets Service Logic ---
async function syncToSheets(data: any[]) {
  try {
    await loadGoogleLibs();
    
    const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
    const sheetId = process.env.GOOGLE_SHEET_ID;

    if (!serviceAccountEmail || !privateKey || !sheetId) {
      throw new Error("Google Sheets configuration is incomplete (serviceAccountEmail, privateKey, or sheetId is missing).");
    }

    const auth = new JWT({
      email: serviceAccountEmail,
      key: privateKey,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    const doc = new GoogleSpreadsheet(sheetId, auth);
    await doc.loadInfo();
    
    const sheet = doc.sheetsByIndex[0];
    if (!sheet) {
      throw new Error("No sheets found in the Google Spreadsheet.");
    }
    
    const rows = data.map(item => ({
      "Nombre": item.name || 'N/A',
      "Handle": item.handle || 'N/A',
      "URL": `https://www.tiktok.com/@${item.handle}`,
      "País": item.country || 'N/A',
      "Followers": item.followers || 0,
      "Revenue": item.revenue || 0,
      "Categoría": item.category || "N/A",
      "Email": item.email || "N/A",
      "Última Actualización": new Date().toISOString()
    }));

    await sheet.addRows(rows);
    console.log(`Successfully synced ${rows.length} rows to Google Sheets.`);
  } catch (error: any) {
    console.error("Google Sheets sync failed:", error.message);
    throw error;
  }
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
          "https://api-openapi.echotik.live/open/v1/shop/search",
          "https://openapi.echotik.live/api/v1/openapi/shop/search",
          "https://openapi.echotik.live/api/v1/shop/search",
          "https://api.echotik.live/api/v1/openapi/shop/search",
          "https://echotik.live/api/v1/openapi/shop/search",
          "https://api-openapi.echotik.live/openapi/v1/shop/search",
          "https://openapi.echotik.live/openapi/v1/shop/search"
        ]
      : [
          "https://api-openapi.echotik.live/api/v1/openapi/creator/search",
          "https://api-openapi.echotik.live/api/v1/creator/search",
          "https://api-openapi.echotik.live/open/v1/creator/search",
          "https://openapi.echotik.live/api/v1/openapi/creator/search",
          "https://openapi.echotik.live/api/v1/creator/search",
          "https://api.echotik.live/api/v1/openapi/creator/search",
          "https://echotik.live/api/v1/openapi/creator/search",
          "https://api-openapi.echotik.live/openapi/v1/creator/search",
          "https://openapi.echotik.live/openapi/v1/creator/search"
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

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.get("/api/config-status", (req, res) => {
  res.json({
    echotik: !!(process.env.ECHOTIK_USERNAME || process.env.ECHOTIK_APP_KEY) && !!(process.env.ECHOTIK_PASSWORD || process.env.ECHOTIK_APP_SECRET),
    googleSheets: !!(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY && process.env.GOOGLE_SHEET_ID),
    serviceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || null
  });
});function handleLeadsError(error: any) {
  if (error.response) {
    return `API Error ${error.response.status}: ${JSON.stringify(error.response.data)}`;
  }
  return error.message;
}


export default app; // Export for Vercel

async function start() {
  const isProd = process.env.NODE_ENV === "production";

  console.log(`Starting server in ${isProd ? "production" : "development"} mode...`);
  console.log(`Environment variables check: ECHOTIK_APP_KEY=${process.env.ECHOTIK_APP_KEY ? 'Set' : 'Missing'}, ECHOTIK_USERNAME=${process.env.ECHOTIK_USERNAME ? 'Set' : 'Missing'}`);

  if (!isProd) {
    try {
      const { createServer } = await import("vite");
      const vite = await createServer({
        server: { middlewareMode: true },
        appType: "spa",
        root: process.cwd(),
      });
      app.use(vite.middlewares);
      console.log("Vite middleware initialized");
    } catch (e: any) {
      console.error("Failed to load Vite middleware:", e.message);
    }
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server listening on 0.0.0.0:${PORT}`);
  });
}

start();
