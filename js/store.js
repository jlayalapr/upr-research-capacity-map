"use strict";
/* =====================================================================
   ALMACENAMIENTO Y ACCESO
   backend "supabase" (por defecto): los datos publicados viven en Supabase.
     - AUTH: la base de datos verifica las contraseñas (bcrypt) y emite una
       sesión temporal con rol (viewer | admin). Nada secreto vive en el código.
     - STORE.load(): baja la versión vigente (registros "ligeros") por páginas
       y la guarda en caché en IndexedDB por id de versión.
     - STORE.fullRecord(): baja el registro completo (con publicaciones) al abrir un perfil.
     - STORE.publish(): el administrador sube una nueva versión por lotes.
   backend "local": todo queda en IndexedDB de este navegador (sin verificación real).
   La clave de Supabase de abajo es la clave PUBLICABLE (pensada para el navegador);
   las tablas están cerradas y solo se accede con una sesión válida.
   ===================================================================== */
const APP_CONFIG = {
  backend: new URLSearchParams(location.search).has("local") ? "local" : "supabase",
  supabaseUrl: "https://zqgvadsakaluvxohrlka.supabase.co",
  supabaseKey: "sb_publishable_frAej55K7p7K_qj_GTPIlw_kdx699B_",
  accessContact: "",
};

/* ---------- llamadas RPC a Supabase ---------- */
class AuthError extends Error {}
const SB = {
  async rpc(fn, args){
    let r;
    try {
      r = await fetch(`${APP_CONFIG.supabaseUrl}/rest/v1/rpc/${fn}`, { method: "POST",
        headers: { apikey: APP_CONFIG.supabaseKey, "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(args || {}) });
    } catch(e){ throw new Error("No se pudo conectar con la base de datos. Verifica tu conexión a Internet."); }
    const text = await r.text(); let body = null; try { body = text ? JSON.parse(text) : null; } catch {}
    if (!r.ok){
      const msg = body?.message || text || `HTTP ${r.status}`;
      if (/unauthorized/.test(msg)) throw new AuthError("La sesión expiró o no es válida. Vuelve a entrar.");
      if (/invalid_credentials/.test(msg)) throw new AuthError("Usuario o contraseña incorrectos.");
      if (/too_many_attempts/.test(msg)) throw new AuthError("Demasiados intentos fallidos. Espera unos minutos.");
      throw new Error(`Error de la base de datos: ${msg}`);
    }
    return body;
  },
};

/* ---------- IndexedDB (caché local y modo local) ---------- */
const IDB = {
  db: null,
  open(){
    if (this.db) return Promise.resolve(this.db);
    return new Promise((res, rej) => {
      let req; try { req = indexedDB.open("upr-capacity-map", 1); } catch(e){ return rej(e); }
      req.onupgradeneeded = () => req.result.createObjectStore("snapshots");
      req.onsuccess = () => res(this.db = req.result); req.onerror = () => rej(req.error);
    });
  },
  async run(mode, fn){
    const db = await this.open();
    return new Promise((res, rej) => { const t = db.transaction("snapshots", mode), s = t.objectStore("snapshots"); const r = fn(s);
      t.oncomplete = () => res(r?.result); t.onerror = () => rej(t.error); });
  },
  get(k){ return this.run("readonly", s => s.get(k)).catch(() => null); },
  put(k, v){ return this.run("readwrite", s => s.put(v, k)).then(() => true).catch(() => false); },
  del(k){ return this.run("readwrite", s => s.delete(k)).catch(() => null); },
  async keys(){ try { return await this.run("readonly", s => s.getAllKeys()); } catch { return []; } },
};

/* ---------- versiones "ligera" (consulta) y "completa" (perfil) ---------- */
function lightRecord(R){
  const out = JSON.parse(JSON.stringify(R, (k, v) => {
    if (k === "supporting_work_ids" && Array.isArray(v)) return v.slice(0, 10);
    if (k === "abstract" || k === "search" || k === "unverified_candidates") return undefined;
    if (k === "works" && Array.isArray(v)) return [];
    if (k === "topics" && Array.isArray(v) && v.length > 10 && v[0]?.count !== undefined) return v.slice(0, 10);
    return v;
  }));
  out.light = true;
  return out;
}
function fullRecord(R){
  return JSON.parse(JSON.stringify(R, (k, v) => {
    if (k === "abstract" && typeof v === "string") return v.slice(0, 600);
    if (k === "authors" && Array.isArray(v) && v.length > 15) return v.slice(0, 15);
    if (k === "light") return undefined;
    return v;
  }));
}
function harvestSummary(list){
  const works = new Map();
  for (const R of list) for (const w of (R.sources.openalex?.works || [])) if (!works.has(w.id)) works.set(w.id, w.year);
  const pubsByYear = {}; for (const y of works.values()) if (y) pubsByYear[y] = (pubsByYear[y]||0) + 1;
  return { uniqueWorks: works.size, pubsByYear, generated: nowISO() };
}

const STORE = {
  savedAt: null, harvestId: null, publishing: false,
  isLight(){ return !working().length; },
  published: null, // { label, count } de la versión vigente en Supabase

  /** Carga los datos al abrir la aplicación. */
  async load(onProgress){
    if (APP_CONFIG.backend === "local") return this.loadLocal();
    const cur = await SB.rpc("api_get_current", { p_session: AUTH.token });
    if (!cur){ // sin datos publicados: si es admin, usar su copia local de trabajo
      this.published = null;
      return AUTH.isAdmin() ? this.loadLocal() : 0;
    }
    this.published = { label: cur.label, count: cur.researchers };
    // copia de trabajo completa del admin (un recinto o todo el sistema), si corresponde a la versión vigente o no se ha publicado
    let w = null;
    if (AUTH.isAdmin()){ w = await IDB.get("current"); if (!(w?.researchers?.length && (w.harvestId === cur.id || w.unpublished))) w = null; }
    let snap = await IDB.get(`hosted:${cur.id}`);
    if (!snap){
      const rows = [];
      for (let off = 0; off < (cur.researchers || 0); off += 200){
        rows.push(...(await SB.rpc("api_get_researchers", { p_session: AUTH.token, p_harvest: cur.id, p_offset: off, p_limit: 200 }) || []));
        onProgress && onProgress(rows.length, cur.researchers);
      }
      snap = { harvestId: cur.id, label: cur.label, savedAt: cur.saved_at, summary: cur.summary, researchers: rows };
      for (const k of await IDB.keys()) if (String(k).startsWith("hosted:")) await IDB.del(k);
      await IDB.put(`hosted:${cur.id}`, snap);
    }
    if (!w) return this.apply(snap);
    // admin: su copia de trabajo + los demás recintos de la versión publicada (en modo consulta)
    const scope = w.scope || w.label;
    const others = snap.researchers.filter(R => !w.researchers.some(x => x.orcid === R.orcid) && !inScope(R, scope));
    const n = this.apply({ ...w, researchers: [...w.researchers, ...others] });
    STATE.label = cur.label || w.label; STATE.summary = cur.summary || w.summary; this.harvestId = cur.id;
    STATE.fundingTotals = { ...(cur.summary?.funding || {}), ...(w.fundingTotals || {}) };
    return n;
  },
  async loadLocal(){ const s = await IDB.get("current"); return s?.researchers?.length ? this.apply(s) : 0; },
  apply(snap){
    STATE.researchers.clear(); for (const R of snap.researchers) STATE.researchers.set(R.orcid, R);
    STATE.label = snap.label || ""; STATE.scope = snap.scope || snap.label || ""; STATE.createdAt = snap.createdAt || null; STATE.summary = snap.summary || null;
    STATE.fundingTotals = snap.fundingTotals || snap.summary?.funding || null;
    this.savedAt = snap.savedAt || null; this.harvestId = snap.harvestId || null;
    return snap.researchers.length;
  },

  /** Registro completo (con publicaciones) para el perfil. */
  async fullRecord(orcid){
    const R = STATE.researchers.get(orcid);
    if (!R?.light || APP_CONFIG.backend === "local" || !this.harvestId) return R;
    const full = await SB.rpc("api_get_researcher", { p_session: AUTH.token, p_harvest: this.harvestId, p_orcid: orcid });
    if (full){ STATE.researchers.set(orcid, full); invalidateSys(); }
    return full || R;
  },

  /** Guarda la copia de trabajo (admin) en este navegador. */
  async saveLocal(unpublished = true){
    if (this.isLight()) return false;
    const list = working();
    const ok = await IDB.put("current", { label: STATE.scope || STATE.label, scope: STATE.scope || STATE.label, createdAt: STATE.createdAt, savedAt: nowISO(),
      harvestId: this.harvestId, unpublished, summary: harvestSummary(list), fundingTotals: STATE.fundingTotals || null, researchers: list });
    if (ok && APP_CONFIG.backend === "local") this.savedAt = nowISO();
    return ok;
  },
  async save(){ return this.saveLocal(APP_CONFIG.backend !== "local"); },

  /** Publica una nueva versión en Supabase (solo admin, con datos completos). */
  async publish(onProgress){
    if (APP_CONFIG.backend === "local") return { ok: await this.saveLocal(false) };
    if (this.isLight()) throw new Error("Los datos cargados son la versión de consulta. Ejecuta un harvest para publicar una versión nueva.");
    if (this.publishing) throw new Error("Ya hay una publicación en curso.");
    this.publishing = true;
    try {
      const list = working(), scope = STATE.scope || STATE.label || "Sistema UPR", summary = { ...harvestSummary(list), scope, ...(STATE.fundingTotals ? { funding: STATE.fundingTotals } : {}) }, S = AUTH.token;
      const id = await SB.rpc("api_begin_harvest", { p_session: S, p_label: scope, p_meta: { engine: CAPACITY_ENGINE_VERSION, createdAt: STATE.createdAt, scope } });
      const CHUNK = 15;
      for (let i = 0; i < list.length; i += CHUNK){
        const part = list.slice(i, i + CHUNK), orcids = part.map(R => R.orcid);
        const rows = part.map(R => { const m = R.sources.openalex?.metrics, P = R.capacity;
          return { orcid: R.orcid, name: fullName(R), campus: R.affiliation.campus, department: R.affiliation.dept, college: R.affiliation.college,
            primary_field: P?.primary_field?.capacity || null, openalex_id: R.sources.openalex?.author?.id || null,
            publications: m?.publications ?? null, citations: m?.citations ?? null, h_index: m?.h_index ?? null,
            funding_total: P?.funding_record?.total_amount ?? 0, active_awards: P?.funding_record?.active_awards ?? 0,
            activity: P?.activity?.status || null, light: lightRecord(R), full: fullRecord(R) }; });
        await SB.rpc("api_put_researchers", { p_session: S, p_harvest: id, p_rows: rows });
        const facts = capacityFacts(part).map(f => ({ orcid: f.orcid, name: f.name, campus: f.campus, department: f.department, college: f.college,
          discipline: f.discipline, category: f.category, capacity: f.capacity, tier: f.tier, confidence: f.confidence, supporting_works: f.supporting_works,
          years: f.years, source: f.source, kind: f.kind, method: f.method, agencies: f.agencies, amount: f.amount || null, validated: f.validated === "sí" }));
        await SB.rpc("api_put_facts", { p_session: S, p_harvest: id, p_orcids: orcids, p_rows: facts });
        const awards = part.flatMap(R => ["nih","nsf"].flatMap(k => (R.sources[k]?.awards || []).map(a => ({ orcid: R.orcid, agency: a.agency, award_id: a.id,
          title: a.title, unit: a.unit, unit_name: a.unit_name, mechanism: a.mechanism, first_year: a.first_year, last_year: a.last_year,
          amount: a.amount, is_active: !!a.is_active, role: a.match?.role, match_level: a.match?.level, url: a.url }))));
        await SB.rpc("api_put_awards", { p_session: S, p_harvest: id, p_orcids: orcids, p_rows: awards });
        onProgress && onProgress(Math.min(i + CHUNK, list.length), list.length);
      }
      const c = await SB.rpc("api_commit_harvest", { p_session: S, p_harvest: id, p_summary: summary });
      this.harvestId = id; this.savedAt = nowISO(); STATE.summary = c?.summary || summary;
      if (c?.label) STATE.label = c.label;
      if (c?.summary?.funding) STATE.fundingTotals = c.summary.funding;
      this.published = { label: c?.label || scope, count: c?.researchers ?? list.length };
      await this.saveLocal(false);
      return { ok: true, id, count: list.length, total: this.published.count, label: this.published.label, scope };
    } finally { this.publishing = false; }
  },
  /** Tras publicar un recinto: añade (en modo consulta) los demás recintos de la versión vigente. */
  async mergePublished(){
    const total = this.published?.count || 0, have = new Set(working().map(R => R.orcid));
    if (APP_CONFIG.backend === "local" || !this.harvestId || total <= have.size) return 0;
    for (const R of researchers()) if (R.light) STATE.researchers.delete(R.orcid);
    let added = 0;
    for (let off = 0; off < total; off += 200){
      const rows = await SB.rpc("api_get_researchers", { p_session: AUTH.token, p_harvest: this.harvestId, p_offset: off, p_limit: 200 }) || [];
      for (const R of rows) if (!have.has(R.orcid) && !inScope(R, STATE.scope)){ STATE.researchers.set(R.orcid, R); added++; }
    }
    return added;
  },
  /** Respaldo completo de la versión publicada (registros completos), para restaurarla con «Importar JSON». */
  async backup(onProgress){
    const cur = await SB.rpc("api_get_current", { p_session: AUTH.token });
    if (!cur) throw new Error("Todavía no hay una versión publicada.");
    const rows = [];
    for (let off = 0; off < (cur.researchers || 0); off += 100){
      rows.push(...(await SB.rpc("api_export_researchers", { p_session: AUTH.token, p_harvest: cur.id, p_offset: off, p_limit: 100 }) || []));
      onProgress && onProgress(rows.length, cur.researchers);
    }
    return { schema: "upr-capacity-backup/1", generated: nowISO(), label: cur.label, saved_at: cur.saved_at, harvest_id: cur.id,
      scopes: cur.summary?.scopes || [cur.label], summary: cur.summary || null, fundingTotals: cur.summary?.funding || null,
      engine_version: CAPACITY_ENGINE_VERSION, researchers: rows.map(R => { const { light, ...r } = R; return r; }) };
  },
  async clear(){ await IDB.del("current"); if (APP_CONFIG.backend === "local") this.savedAt = null; },
};

/* ---------- acceso ---------- */
const AUTH = {
  get token(){ try { return sessionStorage.getItem("uprcap:session") || ""; } catch { return ""; } },
  get role(){ try { return sessionStorage.getItem("uprcap:role") || ""; } catch { return ""; } },
  set(token, role){ try { if (token){ sessionStorage.setItem("uprcap:session", token); sessionStorage.setItem("uprcap:role", role); }
                          else { sessionStorage.removeItem("uprcap:session"); sessionStorage.removeItem("uprcap:role"); } } catch {} },
  canView(){ return this.role === "viewer" || this.role === "admin"; },
  isAdmin(){ return this.role === "admin"; },
  async login(kind, user, password){
    if (!password) return { ok:false, msg:"Escribe la contraseña." };
    if (APP_CONFIG.backend === "local"){ this.set("local", kind === "admin" ? "admin" : (this.isAdmin() ? "admin" : "viewer")); return { ok:true }; }
    try {
      const r = await SB.rpc("api_login", { p_kind: kind, p_user: user || null, p_password: password });
      this.set(r.token, r.role); return { ok:true };
    } catch(e){ return { ok:false, msg: e.message }; }
  },
  viewer(pw){ return this.login("viewer", null, pw); },
  admin(user, pw){ if (!user) return Promise.resolve({ ok:false, msg:"Escribe el usuario." }); return this.login("admin", user, pw); },
  /** Confirma con el servidor que la sesión guardada sigue válida. */
  async validate(){
    if (APP_CONFIG.backend === "local" || !this.token) return this.canView();
    try { const role = await SB.rpc("api_session", { p_session: this.token }); if (role) { this.set(this.token, role); return true; } } catch {}
    this.set("", ""); return false;
  },
  async logout(){ const t = this.token; this.set("", ""); if (APP_CONFIG.backend !== "local" && t) try { await SB.rpc("api_logout", { p_session: t }); } catch {} },
};
