import express from "express";
import path from "path";
import cors from "cors";
import { createServer as createViteServer } from "vite";
import axios from "axios";
import { GoogleSpreadsheet } from "google-spreadsheet";
import { JWT } from "google-auth-library";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

// --- EchoTik Service Logic ---

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
    // Note: Assuming login endpoint based on common patterns. 
    // In a real scenario, this would be the actual EchoTik login URL.
    const response = await axios.post("https://api-openapi.echotik.live/api/v1/auth/login", {
      username,
      password
    });
    
    echotikToken = response.data.data.token;
    // Set expiry to 23 hours later (or whatever the API specifies)
    tokenExpiry = Date.now() + 23 * 60 * 60 * 1000;
    return echotikToken;
  } catch (error) {
    console.error("EchoTik login failed:", error);
    throw error;
  }
}

// --- Google Sheets Service Logic ---

async function syncToSheets(data: any[]) {
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
  
  // Clear and add headers if empty, or just append
  const rows = data.map(item => ({
    "Nombre": item.nickname || item.name,
    "Handle": item.unique_id || item.handle,
    "URL": `https://www.tiktok.com/@${item.unique_id || item.handle}`,
    "País": item.region || item.country,
    "Followers": item.follower_count || 0,
    "Engagement Rate": item.engagement_rate || 0,
    "Ventas Estimadas": item.monthly_sales || 0,
    "Revenue": item.monthly_revenue || 0,
    "Categoría": item.category || "N/A",
    "Email": item.email || "N/A",
    "Última Actualización": new Date().toISOString()
  }));

  await sheet.addRows(rows);
}

// --- API Routes ---

app.get("/api/leads", async (req, res) => {
  try {
    const { region = "ES", type = "shop" } = req.query;
    const token = await getEchoTikToken();
    
    // Example endpoint for shops or creators
    const endpoint = type === "shop" 
      ? "https://api-openapi.echotik.live/api/v1/shop/search"
      : "https://api-openapi.echotik.live/api/v1/creator/search";

    const response = await axios.get(endpoint, {
      headers: { Authorization: `Bearer ${token}` },
      params: { region, page_size: 20 }
    });

    res.json(response.data);
  } catch (error: any) {
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

// --- Vite Middleware ---

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
