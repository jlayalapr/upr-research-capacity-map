// Paso de build en Vercel: descarga el sitio minificado guardado en Supabase (RPC public.site_bundle)
// y lo escribe en dist/. Solo usa la clave PUBLICABLE.
import { mkdirSync, writeFileSync } from "node:fs";
const URL_ = process.env.SUPABASE_URL || "https://zqgvadsakaluvxohrlka.supabase.co";
const KEY = process.env.SUPABASE_PUBLISHABLE_KEY || "sb_publishable_frAej55K7p7K_qj_GTPIlw_kdx699B_";
const r = await fetch(`${URL_}/rest/v1/rpc/site_bundle`, {
  method: "POST", headers: { apikey: KEY, "Content-Type": "application/json" }, body: "{}",
});
if (!r.ok) { console.error("site_bundle HTTP", r.status, await r.text()); process.exit(1); }
const files = await r.json();
mkdirSync("dist", { recursive: true });
for (const need of ["index.html", "app.css", "app.js"]) {
  if (!files[need]) { console.error("Falta", need); process.exit(1); }
}
for (const [path, content] of Object.entries(files)) {
  if (path.includes("..") || path.startsWith("/")) continue;
  writeFileSync(`dist/${path}`, content);
  console.log("dist/" + path, content.length, "chars");
}
