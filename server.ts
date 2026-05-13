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
    throw new Error(`EchoTik credentials missing. ECHOTIK_APP_KEY/SECRET or ECHOTIK_USERNAME/PASSWORD needed.`);
  }

  // Basic validation: EchoTik app secrets are typically hex strings or base64 and usually have a minimum length
  if (password.length < 16) {
    console.warn(`Warning: EchoTik secret seems suspiciously short (${password.length} chars).`);
  }

  console.log(`Attempting EchoTik login: USERNAME/KEY=${username.slice(0, 4)}... (Length: ${username.length})`);

  try {
    const endpoints = [
      "https://api-openapi.echotik.live/api/v1/openapi/auth/login",
      "https://openapi.echotik.live/api/v1/openapi/auth/login",
      "https://api-openapi.echotik.live/api/v1/auth/login",
      "https://openapi.echotik.live/api/v1/auth/login",
      "https://api.echotik.live/api/v1/openapi/auth/login",
      "https://api.echotik.live/api/v1/auth/login",
      "https://echotik.live/api/v1/openapi/auth/login",
      "https://echotik.live/api/v1/auth/login"
    ];

    let lastErrorDetails: string = "All attempts failed without specific error";
    
    for (const endpoint of endpoints) {
      console.log(`Trying EchoTik login at: ${endpoint}`);
      // Attempting multiple payload shapes based on docs and common variations
      const payloads = [
        { app_key: username, app_secret: password },
        { account: username, password: password },
        { username, password },
        { appKey: username, appSecret: password }
      ];

      for (const payload of payloads) {
        try {
          const res = await axios.post(endpoint, payload, {
            headers: { 
              'Content-Type': 'application/json',
              'x-echotik-app-key': username,
              'x-echotik-app-secret': password
            },
            timeout: 10000
          });
          
          const body = res.data;
          // Handle various successful response structures
          const token = body?.data?.token || body?.token || body?.data?.accessToken || body?.accessToken;
          
          if (token) {
            echotikToken = token;
            tokenExpiry = Date.now() + 23 * 60 * 60 * 1000;
            console.log(`Successfully logged in via: ${endpoint} with payload ${Object.keys(payload).join(', ')}`);
            return echotikToken;
          } else {
            const msg = body?.msg || body?.message || "No token in response";
            lastErrorDetails = `Endpoint ${endpoint} (${Object.keys(payload).join(', ')}): ${msg} (Code: ${body?.code})`;
            console.log(`Payload failed for ${Object.keys(payload).join(', ')}: ${msg}`);
          }
        } catch (e: any) {
          const detail = e.response?.data ? JSON.stringify(e.response.data) : e.message;
          lastErrorDetails = `Endpoint ${endpoint} (${Object.keys(payload).join(', ')}): ${detail}`;
          console.log(`Payload error for ${Object.keys(payload).join(', ')}: ${detail}`);
        }
      }
    }
    
    throw new Error(`EchoTik login failed on all endpoints and payloads. Last attempt: ${lastErrorDetails}`);
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
      return res.status(429).json({ error: "Monthly request limit reached (100/100). Please contact administrator." });
    }

    const { region = "ES", type = "shop" } = req.query;
    let token: string | null = null;
    
    try {
      token = await getEchoTikToken();
    } catch (e: any) {
      console.warn("Could not get EchoTik token, will try headers-only fallback.");
    }
    
    const username = process.env.ECHOTIK_USERNAME || process.env.ECHOTIK_APP_KEY || '260513461052475983';
    const password = process.env.ECHOTIK_PASSWORD || process.env.ECHOTIK_APP_SECRET || '34dee8d9da1b43cab3796c55b27e8eda';

    const endpoints = type === "shop" 
      ? [
          "https://api-openapi.echotik.live/api/v1/openapi/shop/search",
          "https://openapi.echotik.live/api/v1/openapi/shop/search",
          "https://api-openapi.echotik.live/api/v1/shop/search",
          "https://api-openapi.echotik.live/api/v1/shop/list",
          "https://api.echotik.live/api/v1/openapi/shop/search"
        ]
      : [
          "https://api-openapi.echotik.live/api/v1/openapi/creator/search",
          "https://openapi.echotik.live/api/v1/openapi/creator/search",
          "https://api-openapi.echotik.live/api/v1/influencer/search",
          "https://api-openapi.echotik.live/api/v1/creator/list",
          "https://api.echotik.live/api/v1/openapi/creator/search"
        ];

    let lastError: any = null;
    for (const endpoint of endpoints) {
      // Try both POST and GET for each endpoint as EchoTik versions vary
      const methods = ["POST", "GET"];
      
      for (const method of methods) {
        try {
          console.log(`Searching EchoTik (${method}) at: ${endpoint} (Region: ${region}, Type: ${type})`);
          const headers: any = { 
            'Content-Type': 'application/json',
            'x-echotik-app-key': username,
            'x-echotik-app-secret': password
          };
          if (token) {
            headers['Authorization'] = `Bearer ${token}`;
          }

          const requestConfig: any = {
            url: endpoint,
            method: method,
            headers: headers,
            timeout: 10000
          };

          if (method === "GET") {
            requestConfig.params = { region, platform: 'TikTok', page_size: 20, pageSize: 20, page_num: 1, pageNo: 1, page_no: 1 };
          } else {
            requestConfig.data = { region, platform: 'TikTok', page_size: 20, pageSize: 20, page_num: 1, pageNo: 1, page_no: 1 };
          }

          const response = await axios(requestConfig);
          
          if (response.data?.code !== 0 && response.data?.code !== undefined) {
             console.warn(`API returned code ${response.data.code} on ${endpoint} (${method}):`, response.data);
             // 40001 or similar might mean wrong parameters or method
             if (response.data?.msg === "Oops, we've got a problem, please try again later.") {
                continue;
             }
          }

          if (response.data && (response.data.data || response.data.list)) {
            requestCount++; // Increment successful request count
            return res.json(response.data);
          }
        } catch (err: any) {
          lastError = err;
          console.warn(`${method} Search failed on ${endpoint}: ${err.message}`);
          if (err.response?.data) {
            console.warn("Response body:", JSON.stringify(err.response.data));
          }
        }
      }
    }

    if (lastError) {
      const errorDetail = handleLeadsError(lastError);
      return res.status(500).json({ 
        error: "Failed to get response from EchoTik", 
        detail: errorDetail 
      });
    }
    throw new Error("Failed to get a valid response from any EchoTik endpoint.");
  } catch (error: any) {
    console.error("Leads search failed:", error.message);
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
  res.json({
    echotik: !!(process.env.ECHOTIK_USERNAME || process.env.ECHOTIK_APP_KEY || '260513461052475983'),
    googleSheets: !!(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY && process.env.GOOGLE_SHEET_ID),
    missingSecrets: [
      !process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && 'GOOGLE_SERVICE_ACCOUNT_EMAIL',
      !process.env.GOOGLE_PRIVATE_KEY && 'GOOGLE_PRIVATE_KEY',
      !process.env.GOOGLE_SHEET_ID && 'GOOGLE_SHEET_ID',
      !process.env.ECHOTIK_APP_KEY && !process.env.ECHOTIK_USERNAME && 'ECHOTIK_APP_KEY',
      !process.env.ECHOTIK_APP_SECRET && !process.env.ECHOTIK_PASSWORD && 'ECHOTIK_APP_SECRET'
    ].filter(Boolean),
    serviceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || null,
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


export default app; // Export for Vercel

async function start() {
  const isProd = process.env.NODE_ENV === "production";

  console.log(`Starting server in ${isProd ? "production" : "development"} mode...`);
  console.log(`Environment variables check:
    ECHOTIK_APP_KEY=${process.env.ECHOTIK_APP_KEY ? 'Set (' + process.env.ECHOTIK_APP_KEY.slice(0, 3) + '...)' : 'Missing'}
    ECHOTIK_USERNAME=${process.env.ECHOTIK_USERNAME ? 'Set (' + process.env.ECHOTIK_USERNAME.slice(0, 3) + '...)' : 'Missing'}
    GOOGLE_SERVICE_ACCOUNT_EMAIL=${process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ? 'Set (' + process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL.slice(0, 5) + '...)' : 'Missing'}
    GOOGLE_SHEET_ID=${process.env.GOOGLE_SHEET_ID ? 'Set' : 'Missing'}
  `);

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
