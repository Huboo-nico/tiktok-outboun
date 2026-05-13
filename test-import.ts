
import { createRequire } from "module";
const require = createRequire(import.meta.url);
try {
  const { JWT } = require("google-auth-library");
  console.log("JWT imported successfully");
} catch (e) {
  console.error("Import failed:", e);
}
