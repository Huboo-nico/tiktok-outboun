import express from "express";
import path from "path";
import cors from "cors";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

// Handle unhandled Promise rejections and uncaught exceptions to prevent EPIPE/crashes
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

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

// Tracking usage for the 100 request limit
let requestCount = 0;
const MAX_REQUESTS = 100;

app.use(cors());
app.use(express.json());

// --- EchoTik Service Logic ---
let echotikToken: string | null = null;
let tokenExpiry: number = 0;

async function getEchoTikToken() {
  if (echotikToken && Date.now() < tokenExpiry) {
    return echotikToken;
  }

  const username = process.env.ECHOTIK_USERNAME || process.env.ECHOTIK_APP_KEY || '260513461052475983';
  const password = process.env.ECHOTIK_PASSWORD || process.env.ECHOTIK_APP_SECRET || '34dee8d9da1b43cab3796c55b27e8eda';

  if (!username || !password) {
    throw new Error(`EchoTik credentials missing.`);
  }

  console.log(`[SERVER] EchoTik Login Attempt: USERNAME=${username.slice(0, 4)}...`);

  const endpoints = [
    "https://api-openapi.echotik.live/api/v1/openapi/auth/login",
    "https://api-openapi.echotik.live/api/v1/auth/login",
    "https://api.echotik.live/api/v1/openapi/auth/login"
  ];

  for (const endpoint of endpoints) {
    // Only try the two most likely payloads
    const payloads = [
      { app_key: username, app_secret: password },
      { account: username, password: password }
    ];

    for (const payload of payloads) {
      try {
        const res = await axios.post(endpoint, payload, {
          headers: { 'Content-Type': 'application/json' },
          timeout: 5000
        });
        
        const body = res.data;
        const token = body?.data?.token || body?.token || body?.data?.accessToken;
        
        if (token) {
          echotikToken = token;
          tokenExpiry = Date.now() + 23 * 60 * 60 * 1000;
          console.log(`[SERVER] EchoTik Login Success: ${endpoint}`);
          return echotikToken;
        }
      } catch (e: any) {
        console.log(`[SERVER] Login attempt failed for ${endpoint}: ${e.message}`);
      }
    }
  }
  
  // Return null instead of throwing to allow headers-only fallback
  return null;
}

// --- Google Sheets Service Logic ---
async function syncToSheets(data: any[]) {
  try {
    await loadGoogleLibs();
    
    const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
    const sheetId = process.env.GOOGLE_SHEET_ID;

    const missing = [
      !serviceAccountEmail && "GOOGLE_SERVICE_ACCOUNT_EMAIL",
      !process.env.GOOGLE_PRIVATE_KEY && "GOOGLE_PRIVATE_KEY",
      !sheetId && "GOOGLE_SHEET_ID"
    ].filter(Boolean);

    if (missing.length > 0) {
      throw new Error(`Google Sheets configuration is incomplete. Missing: ${missing.join(", ")}`);
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
    if (requestCount >= MAX_REQUESTS) {
      console.log("[SERVER] Request limit reached:", requestCount);
      return res.status(429).json({ error: "Monthly request limit reached (100/100). Please contact administrator." });
    }

    const { region = "ES" } = req.query;
    console.log(`[SERVER] Fetching shop leads for region: ${region}`);
    
    let token: string | null = null;
    try {
      token = await getEchoTikToken();
      console.log(`[SERVER] EchoTik Token: ${token ? 'AVAILABLE' : 'NULL'}`);
    } catch (e: any) {
      console.warn("[SERVER] Token acquisition warning:", e.message);
    }
    
    const username = process.env.ECHOTIK_USERNAME || process.env.ECHOTIK_APP_KEY || '260513461052475983';
    const password = process.env.ECHOTIK_PASSWORD || process.env.ECHOTIK_APP_SECRET || '34dee8d9da1b43cab3796c55b27e8eda';

    const endpoints = [
      "https://api-openapi.echotik.live/api/v1/openapi/shop/search",
      "https://openapi.echotik.live/api/v1/openapi/shop/search",
      "https://api-openapi.echotik.live/api/v1/shop/search",
      "https://api-openapi.echotik.live/api/v1/shop/list",
      "https://api.echotik.live/api/v1/openapi/shop/search"
    ];

    let lastError: any = null;
    let success = false;

    for (const endpoint of endpoints) {
      if (success) break;
      
      const methods = ["POST", "GET"];
      for (const method of methods) {
        if (success) break;

        try {
          console.log(`[SERVER] Attempting EchoTik Request: ${method} -> ${endpoint}`);
          const headers: any = { 
            'Content-Type': 'application/json',
            'x-echotik-app-key': username,
            'x-echotik-app-secret': password
          };
          if (token) {
            headers['Authorization'] = `Bearer ${token}`;
          }

          const paramsPayload = { 
            region, 
            platform: 'TikTok', 
            page_size: 20, 
            pageSize: 20, 
            page_num: 1, 
            pageNo: 1, 
            page_no: 1,
            keyword: '', 
            q: ''
          };

          const requestConfig: any = {
            url: endpoint,
            method: method,
            headers: headers,
            timeout: 10000
          };

          if (method === "GET") {
            requestConfig.params = paramsPayload;
          } else {
            requestConfig.data = paramsPayload;
          }

          const response = await axios(requestConfig);
          console.log(`[SERVER] Response status ${response.status} from ${endpoint}`);
          
          if (response.data?.code !== 0 && response.data?.code !== undefined) {
             console.warn(`[SERVER] API Logic Info (Code ${response.data.code}): ${response.data.msg}`);
             if (response.data?.msg === "Oops, we've got a problem, please try again later.") {
                continue;
             }
          }

          if (response.data && (response.data.data || response.data.list)) {
            console.log(`[SERVER] Successful data extraction from ${endpoint}`);
            requestCount++;
            success = true;
            return res.json(response.data);
          }
        } catch (err: any) {
          lastError = err;
          const diag = err.response ? `HTTP ${err.response.status}: ${JSON.stringify(err.response.data)}` : err.message;
          console.error(`[SERVER] Request failure on ${method} ${endpoint}: ${diag}`);
        }
      }
    }

    if (lastError) {
      const errorDetail = handleLeadsError(lastError);
      return res.status(500).json({ 
        error: "Failed to connect to EchoTik clusters. Verify credentials or check server logs.", 
        detail: errorDetail 
      });
    }

    res.status(500).json({ error: "No data returned from any EchoTik endpoint after exhaustive attempts." });
  } catch (error: any) {
    console.error("[SERVER] Leads search critical failure:", error.message);
    res.status(500).json({ error: error.message, detail: handleLeadsError(error) });
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
  const gEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const gKey = process.env.GOOGLE_PRIVATE_KEY;
  const gSheet = process.env.GOOGLE_SHEET_ID;
  const eKey = process.env.ECHOTIK_APP_KEY || process.env.ECHOTIK_USERNAME;
  const eSecret = process.env.ECHOTIK_APP_SECRET || process.env.ECHOTIK_PASSWORD;

  const missing = [];
  if (!gEmail) missing.push('GOOGLE_SERVICE_ACCOUNT_EMAIL');
  if (!gKey) missing.push('GOOGLE_PRIVATE_KEY');
  if (!gSheet) missing.push('GOOGLE_SHEET_ID');
  if (!eKey) missing.push('ECHOTIK_APP_KEY/USERNAME');
  if (!eSecret) missing.push('ECHOTIK_APP_SECRET/PASSWORD');

  res.json({
    echotik: !!(eKey || '260513461052475983'),
    googleSheets: !!(gEmail && gKey && gSheet),
    missingSecrets: missing,
    serviceAccountEmail: gEmail || (missing.includes('GOOGLE_SERVICE_ACCOUNT_EMAIL') ? null : 'Configured but empty'),
    requests: requestCount,
    maxRequests: MAX_REQUESTS
  });
});

function handleLeadsError(error: any) {
  if (error.response) {
    return {
      status: error.response.status,
      data: error.response.data,
      message: error.message
    };
  }
  return { message: error.message };
}

// Global error handler
app.use((err: any, req: any, res: any, next: any) => {
  console.error('[CRITICAL SERVER ERROR]', err);
  res.status(500).json({ 
    error: 'Internal Server Error', 
    message: err.message,
    path: req.path
  });
});


export default app; // Export for Vercel

async function start() {
  const isProd = process.env.NODE_ENV === "production";

  console.log(`[SERVER] Mode: ${isProd ? "production" : "development"}`);
  
  // Start listening IMMEDIATELY to avoid gateway timeouts
  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`[SERVER] Listening on 0.0.0.0:${PORT}`);
  });

  if (!isProd) {
    try {
      console.log("[SERVER] Initializing Vite...");
      const { createServer } = await import("vite");
      const vite = await createServer({
        server: { middlewareMode: true },
        appType: "spa",
        root: process.cwd(),
      });
      app.use(vite.middlewares);
      console.log("[SERVER] Vite middleware ready");
    } catch (e: any) {
      console.error("[SERVER] Vite initialization failed:", e.message);
    }
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }
}

start();
