"use strict";
/* =====================================================================
   FUENTES DE FINANCIAMIENTO: NIH RePORTER y NSF Awards
   Rol: FONDOS RECIBIDOS (kind:"funding"). Ninguna de las dos APIs expone
   ORCID, así que la vinculación es por NOMBRE + INSTITUCIÓN UPR (+ recinto):
     high      → apellido + primer nombre exactos + UPR + recinto compatible
     medium    → apellido + (nombre exacto en otro recinto | inicial en el mismo recinto)
     ambiguous → el investigador del proyecto encaja con 2+ profesores del conjunto (no se asigna)
   Nunca se vincula solo por nombre: el proyecto tiene que ser de la UPR.

   Estrategia: se descargan UNA vez todos los proyectos de Puerto Rico de la
   ventana de años y se emparejan localmente (pocas consultas, sin abusar de
   las APIs). Si el navegador bloquea la API (CORS), se usa el intermediario
   local servidor.py (/proxy/nih, /proxy/nsf).
   ===================================================================== */
const FUND_HOSTS = { nih: "https://api.reporter.nih.gov", nsf: "https://api.nsf.gov" };
const FUND_MODE = { nih: null, nsf: null };   // "direct" | "proxy", se decide en la primera llamada
const FUND_CFG = { since: CURRENT_YEAR - 15, includeMedium: false };

async function fundFetch(svc, path, signal, opts={}){
  const call = (mode, tries) => getJSON((mode === "direct" ? FUND_HOSTS[svc] : `${location.origin}/proxy/${svc}`) + path, signal,
    {...opts, limiter: svc, tries, headers: mode === "proxy" && typeof AUTH !== "undefined" && AUTH.token ? {"x-session": AUTH.token} : undefined});
  if (FUND_MODE[svc]) return call(FUND_MODE[svc], 5);
  try { const r = await call("direct", 0); FUND_MODE[svc] = "direct"; return r; }
  catch(e){
    if (e.name === "AbortError" || e instanceof HttpError) { if (e instanceof HttpError) FUND_MODE[svc] = "direct"; throw e; }
    if (location.protocol.startsWith("http")){
      try { const r = await call("proxy", 3); FUND_MODE[svc] = "proxy"; return r; } catch(e2){ if (e2.name === "AbortError") throw e2; }
    }
    const err = new Error(`El navegador no pudo conectarse directamente a ${FUND_HOSTS[svc]} (probable bloqueo CORS). ${location.protocol.startsWith("http") ? "El intermediario del servidor tampoco respondió." : "Usa la versión publicada en Vercel, o ejecuta \"python3 servidor.py\" y abre http://localhost:8000"}`);
    err.cors = true; throw err;
  }
}

const toks = s => norm(s).replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);
const yearOf = d => { const m = /(\d{4})/.exec(d||""); return m ? Number(m[1]) : null; };
const money = v => { const n = Number(String(v ?? "").replace(/[^0-9.]/g, "")); return isFinite(n) ? n : 0; };

/* ----------------------------- NIH RePORTER ----------------------------- */
const NIH_FIELDS = ["ApplId","CoreProjectNum","ProjectNum","ProjectTitle","FiscalYear","AwardAmount","PrincipalInvestigators","Organization",
                    "AgencyIcAdmin","ActivityCode","ProjectStartDate","ProjectEndDate","AbstractText","PrefTerms","IsActive","ProjectDetailUrl"];
const NIH = {
  async harvest(since, signal, onProgress){
    const key = `nih:pr:${since}`, c = CACHE.get(key); if (c.hit){ NET.cacheHits++; return c.value; }
    const rows = []; let useFields = true;
    for (let y0 = since; y0 <= CURRENT_YEAR + 1; y0 += 4){
      const years = []; for (let y = y0; y < y0 + 4 && y <= CURRENT_YEAR + 1; y++) years.push(y);
      let offset = 0, total = 1;
      while (offset < total && offset < 14500){
        const body = { criteria: { org_states: ["PR"], fiscal_years: years }, offset, limit: 500, sort_field: "fiscal_year", sort_order: "desc" };
        if (useFields) body.include_fields = NIH_FIELDS;
        let d;
        try { d = await fundFetch("nih", "/v2/projects/search", signal, {method:"POST", body}); }
        catch(e){ if (e.status === 400 && useFields){ useFields = false; continue; } throw e; }
        total = d?.meta?.total ?? 0;
        rows.push(...(d?.results || []));
        offset += 500;
        onProgress && onProgress(rows.length, `NIH ${years[0]}–${years[years.length-1]}`);
        if (!(d?.results||[]).length) break;
      }
    }
    const v = this.group(rows.filter(r => isUPR(r.organization?.org_name)));
    CACHE.set(key, v, false);
    return v;
  },
  /** Agrupa los años fiscales de un mismo proyecto (core project number). */
  group(rows){
    const by = new Map();
    for (const r of rows){
      const k = r.core_project_num || r.project_num || String(r.appl_id);
      const g = by.get(k) || by.set(k, { id: k, source: "NIH RePORTER", agency: "NIH", records: [] }).get(k);
      g.records.push(r);
    }
    return [...by.values()].map(g => {
      const recs = g.records.sort((a,b) => (b.fiscal_year||0) - (a.fiscal_year||0)), L = recs[0];
      const fys = uniq(recs.map(r => r.fiscal_year)).sort();
      const pis = new Map();
      for (const r of recs) for (const p of (r.principal_investigators||[])){
        const k = p.profile_id || norm(p.full_name || `${p.first_name} ${p.last_name}`);
        if (!pis.has(k)) pis.set(k, { name: p.full_name || `${p.first_name||""} ${p.last_name||""}`.trim(), first: p.first_name||"", middle: p.middle_name||"",
          last: p.last_name||"", profile_id: p.profile_id||null, role: p.is_contact_pi ? "Contact PI" : "PI" });
      }
      return {
        id: g.id, source: "NIH RePORTER", agency: "NIH", unit: L.agency_ic_admin?.abbreviation || "", unit_name: L.agency_ic_admin?.name || "",
        mechanism: L.activity_code || "", title: L.project_title || "", first_year: fys[0] || null, last_year: fys[fys.length-1] || null,
        start: (L.project_start_date||"").slice(0,10), end: (L.project_end_date||"").slice(0,10),
        amount: recs.reduce((s,r) => s + money(r.award_amount), 0), is_active: recs.some(r => r.is_active) || yearOf(L.project_end_date) >= CURRENT_YEAR,
        org: L.organization?.org_name || "", city: L.organization?.org_city || "",
        pis: [...pis.values()], terms: String(L.pref_terms || L.terms || "").split(/[;\n]/).map(s => s.trim()).filter(Boolean).slice(0,25),
        abstract: (L.abstract_text || "").slice(0, 1500),
        url: L.project_detail_url || (L.appl_id ? `https://reporter.nih.gov/project-details/${L.appl_id}` : ""),
      };
    });
  },
};

/* ------------------------------ NSF Awards ------------------------------ */
const NSF_FIELDS = "id,title,agency,awardeeName,awardeeCity,awardeeStateCode,piFirstName,piLastName,pdPIName,coPDPI,startDate,expDate,estimatedTotalAmt,fundsObligatedAmt,fundProgramName,dirAbbr,divAbbr,abstractText";
const NSF = {
  async harvest(since, signal, onProgress){
    const key = `nsf:pr:${since}`, c = CACHE.get(key); if (c.hit){ NET.cacheHits++; return c.value; }
    const all = []; let useFields = true;
    for (let y = since; y <= CURRENT_YEAR; y++){
      for (let offset = 1; offset < 3000; offset += 25){
        const q = new URLSearchParams({ awardeeStateCode: "PR", startDateStart: `01/01/${y}`, startDateEnd: `12/31/${y}`, offset: String(offset), rpp: "25" });
        if (useFields) q.set("printFields", NSF_FIELDS);
        const d = await fundFetch("nsf", `/services/v1/awards.json?${q}`, signal);
        const list = d?.response?.award || [];
        if (!list.length && d?.response?.serviceNotification && useFields){ useFields = false; offset -= 25; continue; }
        all.push(...list);
        onProgress && onProgress(all.length, `NSF ${y}`);
        if (list.length < 25) break;
      }
    }
    const v = all.filter(a => isUPR(a.awardeeName)).map(a => this.normalize(a));
    CACHE.set(key, v, false);
    return v;
  },
  normalize(a){
    const parseName = (s, role) => { const t = String(s||"").replace(/~\s*\d+/g, "").trim().split(/\s+/).filter(Boolean);
      return { name: t.join(" "), first: t[0]||"", middle: t.length > 2 ? t.slice(1,-1).join(" ") : "", last: t.length > 1 ? t.slice(1).join(" ") : "", role }; };
    const pi = a.piLastName ? { name: `${a.piFirstName||""} ${a.piLastName}`.trim(), first: a.piFirstName||"", middle: "", last: a.piLastName, role: "PI" } : parseName(a.pdPIName, "PI");
    const co = (Array.isArray(a.coPDPI) ? a.coPDPI : a.coPDPI ? String(a.coPDPI).split(/;|\|/) : []).map(s => parseName(s, "Co-PI")).filter(p => p.name);
    const sy = yearOf(a.startDate), ey = yearOf(a.expDate);
    const exp = a.expDate ? new Date(a.expDate) : null;
    return {
      id: String(a.id), source: "NSF Awards", agency: "NSF", unit: [a.dirAbbr, a.divAbbr].filter(Boolean).join("/"), unit_name: a.fundProgramName || "",
      mechanism: "", title: a.title || "", first_year: sy, last_year: ey, start: a.startDate || "", end: a.expDate || "",
      amount: money(a.estimatedTotalAmt) || money(a.fundsObligatedAmt), is_active: !!(exp && !isNaN(exp) && exp >= new Date()),
      org: a.awardeeName || "", city: a.awardeeCity || "", pis: [pi, ...co].filter(p => p.name),
      terms: [a.fundProgramName].filter(Boolean), abstract: (a.abstractText || "").slice(0, 1500),
      url: `https://www.nsf.gov/awardsearch/showAward?AWD_ID=${a.id}`,
    };
  },
};

/* ------------------------------ Vinculación ------------------------------ */
function matchPerson(R, pi, award){
  const fam = toks(R.identity.family), giv = toks(R.identity.given);
  const gl = toks(pi.last), gf = toks(`${pi.first} ${pi.middle}`);
  if (!fam.length || !gl.length || !giv.length || !gf.length) return null;
  const lastOK = fam.some(f => f.length >= 3 && gl.includes(f)) && (gl.includes(fam[0]) || fam.includes(gl[0]));
  if (!lastOK) return null;
  const firstExact = giv[0] === gf[0] || (giv.includes(gf[0]) && gf[0].length > 1);
  const firstInitial = !firstExact && giv[0][0] === gf[0][0] && (giv[0].length === 1 || gf[0].length === 1);
  if (!firstExact && !firstInitial) return null;
  const gCampus = detectCampus(award.org, award.city).name, rCampus = R.affiliation.campus.split(" | ");
  const campusKnown = gCampus !== GENERAL.name && !rCampus.every(c => c === GENERAL.name);
  const sameCampus = rCampus.includes(gCampus);
  const reasons = ["apellido", firstExact ? "nombre" : "inicial del nombre", "institución UPR"];
  let level = null;
  if (firstExact && (sameCampus || !campusKnown)) level = "high";
  else if (firstExact || (firstInitial && sameCampus)) level = "medium";
  if (sameCampus) reasons.push("mismo recinto"); else if (campusKnown) reasons.push(`otro recinto (${gCampus})`);
  // corroboración temática (no cambia el nivel; solo se informa)
  const topicText = norm((R.capacity?.evidence||[]).map(e => e.capacity).join(" ") + " " + R.affiliation.dept);
  const overlap = toks(award.title + " " + award.terms.join(" ")).filter(t => t.length > 5 && topicText.includes(t));
  if (overlap.length >= 2) reasons.push("tema coherente con su producción");
  return level ? { level, confidence: level === "high" ? 0.95 : 0.7, reasons, role: pi.role, pi_name: pi.name } : null;
}

/** Empareja proyectos con investigadores. Escribe R.sources[svc] en TODOS (aunque no tengan fondos). */
function matchAwards(svc, awards, list){
  const index = new Map();
  for (const R of list) for (const t of toks(R.identity.family)) if (t.length >= 3) (index.get(t) || index.set(t, []).get(t)).push(R);
  const label = svc === "nih" ? "NIH RePORTER" : "NSF Awards";
  for (const R of list) R.sources[svc] = { ...prov(label, "funding"), window_since: FUND_CFG.since, awards: [] };
  let matched = 0, ambiguous = 0;
  for (const a of awards){
    for (const pi of a.pis){
      const cands = uniq(toks(pi.last).flatMap(t => index.get(t) || []));
      let hits = cands.map(R => ({R, m: matchPerson(R, pi, a)})).filter(x => x.m);
      if (!hits.length) continue;
      // Un único vínculo de confianza alta prevalece sobre los de confianza media; empates → ambiguo.
      const highs = hits.filter(x => x.m.level === "high");
      if (highs.length === 1) hits = highs;
      const amb = hits.length > 1;
      if (amb) ambiguous++; else matched++;
      for (const {R, m} of hits){
        const match = amb ? {...m, level: "ambiguous", confidence: 0.3, reasons: [...m.reasons, `también encaja con ${hits.length-1} profesor(es) más`]} : m;
        const list2 = R.sources[svc].awards, prev = list2.find(x => x.id === a.id);
        if (!prev) list2.push({...a, match});
        else if (match.confidence > prev.match.confidence) prev.match = match;
      }
    }
  }
  return { matched, ambiguous };
}

/** Fondos aceptados para un investigador (high; medium si se permite). */
function acceptedAwards(R, includeMedium = FUND_CFG.includeMedium){
  return ["nih","nsf"].flatMap(s => R.sources[s]?.awards || [])
    .filter(a => a.match.level === "high" || (includeMedium && a.match.level === "medium"));
}

/* ------------------------------ Cobertura ------------------------------ */
/** Totales de TODOS los proyectos de la UPR descargados (denominador de la cobertura), por recinto. */
function fundingTotals(awards, since){
  const byCampus = {}; let total = 0;
  for (const a of awards){
    const c = detectCampus(a.org || "", a.city || "").name, x = byCampus[c] || (byCampus[c] = { count: 0, total: 0 });
    x.count++; x.total += a.amount || 0; total += a.amount || 0;
  }
  return { since, count: awards.length, total, byCampus, generated: nowISO() };
}
/** Fondos vinculados a profesores identificados vs. otorgados a la UPR (por agencia). */
function coverageRows(S){
  const T = STATE.fundingTotals || {}, rows = [];
  const scopes = STATE.summary?.scopes || [], all = scopes.includes("Sistema UPR") || STATE.label === "Sistema UPR";
  const loaded = [...S.campuses];
  for (const k of ["nsf", "nih"]){
    const t = T[k]; if (!t) continue;
    const ag = k.toUpperCase();
    const linked = S.awards.filter(a => a.agency === ag && (all || loaded.includes(detectCampus(a.org || "", "").name)));
    const lt = linked.reduce((s, a) => s + (a.amount || 0), 0);
    const denom = all ? t.total : loaded.reduce((s, c) => s + (t.byCampus?.[c]?.total || 0), 0);
    const dcount = all ? t.count : loaded.reduce((s, c) => s + (t.byCampus?.[c]?.count || 0), 0);
    rows.push({ ag, since: t.since, linked: lt, linkedN: linked.length, denom, dcount, total: t.total, count: t.count, all,
      pct: denom ? Math.min(100, Math.round(100 * lt / denom)) : null });
  }
  return rows;
}
function coverageNote(S){
  const rows = coverageRows(S);
  if (!rows.length) return S.awards.length ? `<p class="note">Para ver qué parte de los fondos de la UPR está capturada, un administrador debe ejecutar de nuevo el paso 3 (financiamiento).</p>` : "";
  return `<div class="notice coverage">${rows.map(r => `<div><b>${r.ag} desde ${r.since}:</b> ${money$(r.linked)} vinculados a profesores identificados (${fmt(r.linkedN)} proyectos), de ${money$(r.denom)} otorgados a la UPR${r.all ? "" : " en los recintos cargados"} (${fmt(r.dcount)} proyectos) · <b>${r.pct ?? "—"}% de cobertura</b>${r.all ? "" : ` · Total UPR, todos los recintos: ${money$(r.total)}`}</div>`).join("")}
    <small>Lo no vinculado corresponde a proyectos cuyo investigador no tiene ORCID, no apareció en la búsqueda o no coincidió con suficiente confianza. Montos: NSF = total estimado del premio; NIH = suma de los años fiscales.</small></div>`;
}
