"use strict";
/* =====================================================================
   NÚCLEO: utilidades, HTTP con límites de velocidad, reintentos, caché,
   procedencia de datos y definiciones institucionales de la UPR.
   Todos los módulos son scripts clásicos (funcionan con file://) que
   comparten el ámbito global.
   ===================================================================== */

const $ = id => document.getElementById(id);
const norm = s => (s||"").normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const uniq = arr => [...new Set(arr.filter(x => x !== undefined && x !== null && x !== ""))];
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const round2 = x => Math.round(x*100)/100;
const CURRENT_YEAR = new Date().getFullYear();
const nowISO = () => new Date().toISOString();
const yearsRange = ys => { const v = ys.filter(Boolean).map(Number); return v.length ? (Math.min(...v)===Math.max(...v) ? String(Math.min(...v)) : `${Math.min(...v)}-${Math.max(...v)}`) : ""; };

/* ---------------------------------------------------------------------
   Procedencia. Cada dato guarda su fuente y su naturaleza:
     declared       → declarado por el investigador (ORCID)
     bibliographic  → registro bibliográfico (OpenAlex; luego Crossref, PubMed…)
     institutional  → sistemas institucionales (VIVO, InfoEd, RR.HH.)
     funding        → bases de datos de financiamiento (NIH RePORTER, NSF Awards)
     inferred       → derivado por la Research Capacity Intelligence Layer
   --------------------------------------------------------------------- */
const KIND_LABEL = {declared:"Declarado (ORCID)", bibliographic:"Bibliográfico", institutional:"Institucional", funding:"Financiamiento", inferred:"Inferido"};
const prov = (source, kind, extra={}) => ({source, kind, retrieved: nowISO(), ...extra});

/* ---------------------------------------------------------------------
   HTTP: límite de velocidad por servidor + reintentos con backoff.
   --------------------------------------------------------------------- */
const NET = { requests:0, retries:0, errors:0, cacheHits:0 };
class Limiter {
  constructor(rps){ this.setRate(rps); this.next = 0; }
  setRate(rps){ this.gap = 1000/rps; }
  async wait(){ const now = Date.now(), t = Math.max(now, this.next); this.next = t + this.gap; if (t > now) await sleep(t - now); }
  pause(ms){ this.next = Math.max(this.next, Date.now() + ms); }
}
const LIMITERS = { "pub.orcid.org": new Limiter(12), "api.openalex.org": new Limiter(8), nih: new Limiter(1), nsf: new Limiter(3) };
const limiterFor = url => { const h = new URL(url).host; return LIMITERS[h] || (LIMITERS[h] = new Limiter(5)); };

class HttpError extends Error { constructor(status, url){ super(`HTTP ${status}`); this.status = status; this.url = url; } }

/** GET/POST JSON con reintentos. opts: {tries=5, allow404=false, method, body, limiter} → objeto, o null si 404 y allow404. */
async function getJSON(url, signal, opts={}){
  if (signal && !(signal instanceof AbortSignal)) { opts = signal; signal = opts.signal; }
  const tries = opts.tries ?? 5, lim = opts.limiter ? LIMITERS[opts.limiter] : limiterFor(url);
  const init = { method: opts.method || "GET", headers: {Accept:"application/json", ...(opts.headers || {})}, signal };
  if (opts.body !== undefined){ init.headers["Content-Type"] = "application/json"; init.body = typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body); }
  for (let i = 0; ; i++){
    await lim.wait();
    if (signal?.aborted) throw new DOMException("Aborted","AbortError");
    let r;
    try {
      NET.requests++;
      r = await fetch(url, init);
    } catch(e){
      if (signal?.aborted || i >= tries) { NET.errors++; throw e; }
      NET.retries++; await sleep(700 * 2**i); continue;
    }
    if (r.ok) return r.json();
    if (r.status === 404 && opts.allow404) return null;
    // Límite agotado o key inválida: no tiene sentido reintentar → error explicativo inmediato.
    if (r.status === 401 || r.status === 403 || r.status === 429){
      const body = await r.text().catch(() => "");
      const isBudget = r.status === 429 && (/budget|credit|daily|quota|exceed|api[_ ]?key|usd/i.test(body) || Number(r.headers.get("Retry-After")) > 120);
      if (r.status !== 429 || isBudget){
        NET.errors++;
        const e = new HttpError(r.status, url); e.body = body.slice(0, 300);
        if (isBudget) e.budget = true; else e.auth = true;
        throw e;
      }
    }
    if (r.status === 429 || r.status >= 500){
      if (i >= tries){ NET.errors++; throw new HttpError(r.status, url); }
      const ra = Number(r.headers.get("Retry-After"));
      const wait = (ra > 0 ? ra*1000 : 1000 * 2**i) + Math.random()*300;
      lim.pause(wait); NET.retries++; await sleep(wait); continue;
    }
    NET.errors++; throw new HttpError(r.status, url);
  }
}

async function pool(items, n, fn, signal){
  let i = 0;
  const workers = Array.from({length: Math.min(n, items.length)}, async () => {
    while (i < items.length && !signal?.aborted){ const k = i++; await fn(items[k], k); }
  });
  await Promise.all(workers);
}

/* ---------------------------------------------------------------------
   Caché de sesión (Map) + persistente (localStorage, con caducidad).
   Claves basadas en ORCID u OpenAlex Author ID, p. ej.:
     oa:author:orcid:0000-0002-…   oa:works:A5023888391   orcid:record:0000-…
   --------------------------------------------------------------------- */
const CACHE = {
  mem: new Map(), prefix: "uprcap:v1:", ttlDays: 7, persist: true,
  get(key){
    if (this.mem.has(key)) return {hit:true, value:this.mem.get(key)};
    if (!this.persist) return {hit:false};
    try {
      const raw = localStorage.getItem(this.prefix + key); if (!raw) return {hit:false};
      const {t, v} = JSON.parse(raw);
      if (Date.now() - t > this.ttlDays*864e5){ localStorage.removeItem(this.prefix + key); return {hit:false}; }
      this.mem.set(key, v); return {hit:true, value:v};
    } catch { return {hit:false}; }
  },
  set(key, value, persist=true){
    this.mem.set(key, value);
    if (!this.persist || !persist) return;
    const payload = JSON.stringify({t:Date.now(), v:value});
    for (let attempt = 0; attempt < 2; attempt++){
      try { localStorage.setItem(this.prefix + key, payload); return; }
      catch { if (!this.evict(0.3)) break; }
    }
  },
  keys(){ try { return Object.keys(localStorage).filter(k => k.startsWith(this.prefix)); } catch { return []; } },
  evict(frac){ // elimina las entradas más antiguas
    const ks = this.keys().map(k => { try { return [k, JSON.parse(localStorage.getItem(k)).t]; } catch { return [k, 0]; } }).sort((a,b) => a[1]-b[1]);
    const n = Math.ceil(ks.length*frac); ks.slice(0, n).forEach(([k]) => localStorage.removeItem(k)); return n > 0;
  },
  clear(){ this.mem.clear(); this.keys().forEach(k => localStorage.removeItem(k)); },
  sizeKB(){ return Math.round(this.keys().reduce((s,k) => s + (localStorage.getItem(k)||"").length, 0)/1024); },
};
async function cached(key, fn, persist=true){
  const c = CACHE.get(key); if (c.hit){ NET.cacheHits++; return c.value; }
  const v = await fn(); CACHE.set(key, v, persist); return v;
}

/* ---------------------------------------------------------------------
   UPR: recintos y reconocimiento de instituciones
   --------------------------------------------------------------------- */
const UPR = '("University of Puerto Rico" OR "Universidad de Puerto Rico")';
const CAMPUSES = [
  {id:"rp",  name:"Río Piedras",           q:`(${UPR} AND ("Rio Piedras" OR "Río Piedras"))`, kw:["rio piedras","uprrp"]},
  {id:"rum", name:"Mayagüez",              q:`((${UPR} AND (Mayaguez OR Mayagüez)) OR UPRM)`,  kw:["mayaguez","uprm"]},
  {id:"rcm", name:"Ciencias Médicas",      q:`(${UPR} AND ("Medical Sciences" OR "Ciencias Medicas" OR "Ciencias Médicas" OR "School of Medicine" OR "Escuela de Medicina" OR "School of Dental Medicine" OR "Public Health" OR "Salud Publica" OR "Salud Pública" OR Pharmacy OR Farmacia OR Nursing OR Enfermeria OR Enfermería))`,
                                            kw:["medical sciences","med sciences","med sci","ciencias medicas","school of medicine","escuela de medicina","dental","public health","salud publica","pharmacy","farmacia","nursing","enfermeria","comprehensive cancer","rcm"]},
  {id:"cay", name:"Cayey",                 q:`(${UPR} AND Cayey)`,      kw:["cayey"]},
  {id:"hum", name:"Humacao",               q:`(${UPR} AND Humacao)`,    kw:["humacao"]},
  {id:"bay", name:"Bayamón",               q:`(${UPR} AND (Bayamon OR Bayamón))`, kw:["bayamon"]},
  {id:"are", name:"Arecibo",               q:`(${UPR} AND Arecibo)`,    kw:["arecibo"]},
  {id:"agu", name:"Aguadilla",             q:`(${UPR} AND Aguadilla)`,  kw:["aguadilla"]},
  {id:"car", name:"Carolina",              q:`(${UPR} AND Carolina)`,   kw:["carolina"]},
  {id:"pon", name:"Ponce",                 q:`(${UPR} AND Ponce)`,      kw:["ponce"]},
  {id:"utu", name:"Utuado",                q:`(${UPR} AND Utuado)`,     kw:["utuado"]},
  {id:"ac",  name:"Administración Central",q:`(${UPR} AND ("Central Administration" OR "Administracion Central" OR "Administración Central"))`, kw:["central administration","administracion central"]},
];
const GENERAL = {id:"gen", name:"UPR (recinto no especificado)"};
const EXCLUDE = ["inter american","interamerican","interamericana","polytechnic","politecnica","catholic","catolica","pontific","ana g. mendez","ana g mendez","turabo","metropolitan","metropolitana","sagrado","central del caribe","ponce health sciences","ponce school of medicine","carlos albizu","caribbean university","american university of puerto rico","universidad del este"];

function isUPR(name){
  const n = norm(name);
  if (EXCLUDE.some(x => n.includes(x))) return false;
  return n.includes("university of puerto rico") || n.includes("universidad de puerto rico") || /\bupr/.test(n);
}
function detectCampus(name, city){
  const n = norm(name), c = norm(city);
  for (const cp of CAMPUSES) if (cp.kw.some(k => n.includes(k))) return cp;
  for (const cp of CAMPUSES) if (cp.id!=="rcm" && cp.id!=="ac" && cp.kw.some(k => c.includes(k))) return cp;
  return GENERAL;
}
/** Facultad/colegio a partir del departamento declarado (heurística; reemplazable por una tabla institucional). */
function deriveCollege(dept){
  const d = dept || "";
  const m = /(college|facultad|colegio|escuela|school)\s+(of|de)\s+[^,;|]+/i.exec(d);
  return m ? m[0].trim() : "";
}

/* ---------------------------------------------------------------------
   Estado de la aplicación: un registro por investigador, fuentes separadas.
   R = {
     orcid,
     identity:     {given, family, credit, emails, ...prov(ORCID, declared)},
     affiliation:  {campus, role, dept, college, org, city, start, end, ...prov(ORCID, declared)},
     affiliations: [...],                    // todos los empleos UPR que cumplieron el filtro
     sources: { orcid:{...}, openalex:{...} | null, crossref:null, pubmed:null, ... },
     discrepancies: [{field, orcid, openalex, note}],
     capacity: {...} | null                  // Research Capacity Intelligence Layer
   }
   --------------------------------------------------------------------- */
const STATE = { researchers: new Map(), label: "", createdAt: null };
const researchers = () => [...STATE.researchers.values()];

function slug(s){ return norm(s).replace(/[^a-z0-9]+/g,"_").replace(/^_|_$/g,""); }
function saveBlob(blob, name){
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}
function tableCSV(rows, cols){
  cols = cols || (rows[0] ? Object.keys(rows[0]) : []);
  const q = v => { const s = String(v ?? ""); return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s; };
  return "﻿" + [cols.map(q).join(","), ...rows.map(r => cols.map(c => q(r[c])).join(","))].join("\r\n");
}
