// Intermediario de Vercel hacia APIs externas que pueden bloquear llamadas desde el navegador (CORS).
// Reenvía SOLO a los servicios permitidos y exige una sesión válida emitida por Supabase:
//   nih, nsf  → rol admin (se usan durante el harvest)
//   grants    → cualquier sesión (visitante o admin)
// La URL y la clave de Supabase son las PUBLICABLES (las mismas que usa el navegador).
const SUPABASE_URL = process.env.SUPABASE_URL || "https://zqgvadsakaluvxohrlka.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || "sb_publishable_frAej55K7p7K_qj_GTPIlw_kdx699B_";
const UPSTREAM = {
  nih:    { base: "https://api.reporter.nih.gov", role: "admin" },
  nsf:    { base: "https://api.nsf.gov",          role: "admin" },
  grants: { base: "https://api.grants.gov",       role: "viewer" },
};
const MAX_BODY = 1_000_000;

async function sessionRole(token) {
  if (!token || token.length < 32) return null;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/api_session`, {
    method: "POST", headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ p_session: token }),
  });
  if (!r.ok) return null;
  return await r.json();
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", c => { size += c.length; if (size > MAX_BODY) { reject(new Error("too_large")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "private, no-store");
  try {
    const url = new URL(req.url, "http://x");
    const svc = url.searchParams.get("svc");
    const cfg = UPSTREAM[svc];
    if (!cfg) { res.statusCode = 404; return res.end(JSON.stringify({ error: "servicio no permitido" })); }
    if (!["GET", "POST"].includes(req.method)) { res.statusCode = 405; return res.end(); }

    const role = await sessionRole(req.headers["x-session"]);
    if (!role || (cfg.role === "admin" && role !== "admin")) {
      res.statusCode = 401; res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ error: "unauthorized" }));
    }

    let path = url.searchParams.get("path") || "";
    path = path.split("/").filter(p => p && p !== ".." && p !== ".").join("/");
    const qs = new URLSearchParams(url.searchParams); qs.delete("svc"); qs.delete("path");
    const target = `${cfg.base}/${path}${qs.toString() ? "?" + qs.toString() : ""}`;

    const init = { method: req.method, headers: { Accept: "application/json", "User-Agent": "UPR-Research-Capacity-Map/1.0" } };
    if (req.method === "POST") { init.body = await readBody(req); init.headers["Content-Type"] = "application/json"; }
    const up = await fetch(target, init);
    const buf = Buffer.from(await up.arrayBuffer());
    res.statusCode = up.status;
    res.setHeader("Content-Type", up.headers.get("content-type") || "application/json");
    return res.end(buf);
  } catch (e) {
    res.statusCode = e.message === "too_large" ? 413 : 502;
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ error: String(e.message || e) }));
  }
};
