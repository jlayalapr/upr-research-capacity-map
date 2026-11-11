"use strict";
/* =====================================================================
   FUENTE: OpenAlex (api.openalex.org)
   Rol: PRODUCCIÓN CIENTÍFICA, MÉTRICAS y TOPICS. Se vincula al investigador
   EXCLUSIVAMENTE por ORCID. Una coincidencia por nombre nunca se acepta
   automáticamente: se guarda como "candidato sin verificar".
   ===================================================================== */
const OA_BASE = "https://api.openalex.org";
// Desde el 13-feb-2026 OpenAlex usa API keys (gratuitas) con presupuesto diario en USD:
// sin key ≈ US$0.10/día, con key gratuita ≈ US$1/día. Consultas de un solo registro: gratis;
// listas/filtros ≈ US$0.0001; búsquedas por texto ≈ US$0.001. El parámetro mailto ya no se usa.
const OA_CFG = { apiKey: "", maxWorks: 500, nameCandidates: false };
const OA_SELECT = "id,doi,title,publication_year,publication_date,type,primary_location,cited_by_count,authorships,topics,primary_topic,keywords,open_access,abstract_inverted_index,language,awards,funders";
const MAX_AUTHORS_STORED = 60;     // autores por trabajo que se guardan (artículos de consorcio tienen miles)
const BIG_TEAM = 100;              // trabajos con más autores no cuentan para la red de colaboración

const shortId = u => String(u||"").replace(/^https?:\/\/openalex\.org\//,"");
const shortOrcid = u => String(u||"").replace(/^https?:\/\/orcid\.org\//,"");
const normDoi = d => String(d||"").toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//,"").replace(/^doi:\s*/,"");

function oaUrl(path, params={}){
  const u = new URL(OA_BASE + path);
  for (const [k,v] of Object.entries(params)) if (v !== undefined && v !== "") u.searchParams.set(k, v);
  if (OA_CFG.apiKey) u.searchParams.set("api_key", OA_CFG.apiKey);
  return u.toString();
}

function compactInst(i){ return i ? {id:shortId(i.id), name:i.display_name||"", ror:i.ror||"", cc:i.country_code||"", type:i.type||""} : null; }
function compactTopic(t){
  return t ? { id:shortId(t.id), name:t.display_name||"", score:t.score ?? null, count:t.count ?? null,
    subfield:t.subfield?.display_name||"", subfield_id:shortId(t.subfield?.id),
    field:t.field?.display_name||"", field_id:shortId(t.field?.id), domain:t.domain?.display_name||"" } : null;
}
function compactAuthor(a){
  return {
    id: shortId(a.id), url: a.id, orcid: shortOrcid(a.orcid), name: a.display_name||"",
    alternatives: (a.display_name_alternatives||[]).slice(0,10),
    works_count: a.works_count ?? null, cited_by_count: a.cited_by_count ?? null,
    h_index: a.summary_stats?.h_index ?? null, i10_index: a.summary_stats?.i10_index ?? null,
    mean_2yr_citedness: a.summary_stats?.["2yr_mean_citedness"] ?? null,
    last_known_institutions: (a.last_known_institutions || (a.last_known_institution ? [a.last_known_institution] : [])).map(compactInst).filter(Boolean),
    affiliations: (a.affiliations||[]).map(x => ({...compactInst(x.institution), years:x.years||[]})),
    topics: (a.topics||[]).slice(0,25).map(compactTopic),
    counts_by_year: (a.counts_by_year||[]).map(c => ({year:c.year, works:c.works_count, citations:c.cited_by_count})),
    updated: a.updated_date||"",
  };
}
function abstractFrom(inv){
  if (!inv) return "";
  const pos = [];
  for (const [w, idxs] of Object.entries(inv)) for (const i of idxs) pos[i] = w;
  return pos.filter(Boolean).join(" ").slice(0, 1500);
}
function compactWork(w, selfIds){
  const auths = w.authorships||[];
  const keep = auths.filter((a,i) => i < MAX_AUTHORS_STORED || selfIds.has(shortId(a.author?.id)));
  const src = w.primary_location?.source;
  return {
    id: shortId(w.id), doi: normDoi(w.doi), title: w.title || w.display_name || "",
    year: w.publication_year || null, date: w.publication_date || "", type: w.type || "",
    source: src ? {id:shortId(src.id), name:src.display_name||"", issn_l:src.issn_l||"", type:src.type||""} : null,
    cited_by_count: w.cited_by_count || 0,
    n_authors: auths.length,
    authors: keep.map(a => ({ id:shortId(a.author?.id), name:a.author?.display_name||a.raw_author_name||"", orcid:shortOrcid(a.author?.orcid),
      position:a.author_position||"", institutions:(a.institutions||[]).map(compactInst).filter(Boolean), countries:a.countries||[] })),
    topics: (w.topics||[]).map(compactTopic),
    primary_topic: compactTopic(w.primary_topic),
    keywords: (w.keywords||[]).map(k => ({name:k.display_name||k.keyword||"", score:k.score ?? null})),
    oa: { is_oa: !!w.open_access?.is_oa, status: w.open_access?.oa_status||"", url: w.open_access?.oa_url||"" },
    abstract: abstractFrom(w.abstract_inverted_index),
    language: w.language||"",
    // financiadores agradecidos (se omiten los consorcios con muchos financiadores, p. ej., CERN)
    awards: (w.funders||[]).length <= 10 ? (w.awards||[]).map(a => ({ funder: a.funder_display_name||"", award: a.funder_award_id||"" })).filter(a => a.funder) : [],
    n_funders: (w.funders||[]).length,
  };
}

/* ----- Ranking de candidatos (punto 13). Nunca acepta solo por nombre (punto 14). ----- */
const STOP = new Set("department departamento of de the and y la el del en para program programa school escuela college colegio facultad faculty science sciences ciencias".split(" "));
function scoreCandidate(c, R){
  let s = 0; const why = [];
  if (c.orcid === R.orcid){ s += 100; why.push("ORCID exacto"); }
  const insts = [...c.last_known_institutions, ...c.affiliations];
  const upr = insts.filter(i => isUPR(i.name));
  if (upr.length){ s += 20; why.push("institución UPR");
    if (upr.some(i => detectCampus(i.name,"").name === R.affiliation.campus)){ s += 10; why.push("mismo recinto"); } }
  const fam = norm(R.identity.family), giv = norm(R.identity.given), names = [c.name, ...c.alternatives].map(norm);
  if (fam && names.some(n => fam.split(/\s+/).some(f => f.length > 2 && n.includes(f)))){ s += 10; why.push("apellido"); }
  if (giv && names.some(n => n.startsWith(giv[0]) || n.includes(giv.split(/\s+/)[0]))){ s += 5; why.push("nombre"); }
  const deptTokens = norm(R.affiliation.dept).split(/[^a-z]+/).filter(t => t.length > 3 && !STOP.has(t));
  const topicText = norm(c.topics.map(t => `${t.name} ${t.subfield} ${t.field}`).join(" "));
  const hits = deptTokens.filter(t => topicText.includes(t.slice(0, 6)));
  if (hits.length){ s += Math.min(10, 3*hits.length); why.push("área coincide con departamento"); }
  s += Math.log10((c.works_count||0) + 1);
  return {score: round2(s), reasons: why};
}

const OPENALEX = {
  /** Localiza al autor por ORCID. Devuelve {author, alternates, match, unverified}. */
  async findAuthor(R, signal){
    // Consulta de un solo registro por ORCID: GRATIS en el esquema de precios de OpenAlex.
    const key = `oa:author:orcid:${R.orcid}`, c = CACHE.get(key);
    let raw;
    if (c.hit){ NET.cacheHits++; raw = c.value; }
    else {
      const one = await getJSON(oaUrl(`/authors/orcid:${R.orcid}`), signal, {allow404:true});
      raw = one ? [compactAuthor(one)] : [];
      CACHE.set(key, raw, raw.length > 0);   // "no encontrado" solo en memoria: se reintenta en otra sesión
    }
    const exact = raw.filter(c => c.orcid === R.orcid)
      .map(c => ({...c, ...scoreCandidate(c, R)})).sort((a,b) => b.score - a.score);
    if (exact.length){
      return { author: exact[0], alternates: exact.slice(1),
        match: { status: exact.length > 1 ? "orcid-exact-multiple" : "orcid-exact", method: "ORCID", score: exact[0].score, reasons: exact[0].reasons,
                 note: exact.length > 1 ? `OpenAlex tiene ${exact.length} perfiles con este ORCID; se combinan sus trabajos (mismo ORCID = misma persona).` : "" },
        unverified: [] };
    }
    // Sin ORCID en OpenAlex: candidatos por nombre SOLO para revisión manual; no se usan.
    let unverified = [];
    try {
      const q = `${R.identity.given} ${R.identity.family}`.trim();
      if (q && OA_CFG.nameCandidates){   // búsqueda por texto: la más cara; opcional
        const d = await cached(`oa:namesearch:${norm(q)}`, () => getJSON(oaUrl("/authors", {search:q, "per-page":"10"}), signal));
        unverified = (d?.results||[]).map(compactAuthor)
          .map(c => ({...c, ...scoreCandidate(c, R)}))
          .filter(c => [...c.last_known_institutions, ...c.affiliations].some(i => isUPR(i.name) || i.cc === "PR"))
          .sort((a,b) => b.score - a.score).slice(0,5)
          .map(c => ({id:c.id, name:c.name, orcid:c.orcid, works_count:c.works_count, score:c.score, reasons:c.reasons,
                      institutions:uniq(c.last_known_institutions.map(i=>i.name))}));
      }
    } catch(e){ if (e.name === "AbortError" || e.budget || e.auth) throw e; }
    return { author: null, alternates: [], unverified,
      match: { status: "not-found", method: "ORCID", note: unverified.length ? "OpenAlex no tiene este ORCID. Hay candidatos por nombre, pero no se aceptan sin verificación." : "OpenAlex no tiene este ORCID." } };
  },

  /** Trabajos de uno o más Author IDs (paginación por cursor). */
  async works(authorIds, signal, max){
    const key = `oa:works2:${authorIds.join("|")}:${max}`;
    const c = CACHE.get(key); if (c.hit){ NET.cacheHits++; return c.value; }
    const selfIds = new Set(authorIds);
    const out = []; let cursor = "*", useSelect = true, total = 0;
    while (cursor && out.length < max){
      const params = {filter:`author.id:${authorIds.join("|")}`, "per-page":"200", cursor, sort:"publication_year:desc"};
      if (useSelect) params.select = OA_SELECT;
      let d;
      try { d = await getJSON(oaUrl("/works", params), signal); }
      catch(e){ if (e.status === 400 && useSelect){ useSelect = false; continue; } throw e; }
      total = d?.meta?.count ?? total;
      for (const w of (d?.results||[])) out.push(compactWork(w, selfIds));
      cursor = d?.meta?.next_cursor;
      if (!d?.results?.length) break;
    }
    const v = { items: out.slice(0, max), total, truncated: total > max };
    CACHE.set(key, v, JSON.stringify(v).length < 300000);
    return v;
  },

  async enrich(R, signal){
    const m = await this.findAuthor(R, signal);
    const src = { ...prov("OpenAlex","bibliographic"), match: m.match, author: m.author, alternates: m.alternates,
                  unverified_candidates: m.unverified, works: [], works_total: 0, works_truncated: false, metrics: null };
    if (m.author){
      const ids = [m.author.id, ...m.alternates.map(a => a.id)];
      const w = await this.works(ids, signal, OA_CFG.maxWorks);
      src.works = w.items; src.works_total = w.total; src.works_truncated = w.truncated;
      src.metrics = computeMetrics(m.author, m.alternates, w.items);
      src.funding_ack = summarizeAcknowledged(w.items);
    }
    R.sources.openalex = src;
    R.discrepancies = compareSources(R);
    return R;
  },
};

function hIndex(cites){ const s = [...cites].sort((a,b) => b-a); let h = 0; while (h < s.length && s[h] >= h+1) h++; return h; }
/** Subvenciones agradecidas en sus publicaciones: una entrada por financiador + número de premio. */
function summarizeAcknowledged(works){
  const by = new Map();
  for (const w of works) for (const a of (w.awards || [])){
    const k = `${norm(a.funder)}|${normAwardId(a.award)}`;
    const x = by.get(k) || by.set(k, { funder: a.funder, award: a.award, works: 0, first: null, last: null, sample: [] }).get(k);
    x.works++; if (w.year){ x.first = Math.min(x.first ?? w.year, w.year); x.last = Math.max(x.last ?? w.year, w.year); }
    if (x.sample.length < 3) x.sample.push(w.id);
  }
  return [...by.values()].sort((a, b) => b.works - a.works).slice(0, 60);
}
function normAwardId(s){
  const n = String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const nih = /([A-Z]\d{2}[A-Z]{2}\d{6})/.exec(n); if (nih) return nih[1];
  return n;
}
function computeMetrics(a, alts, works){
  const years = works.map(w => w.year).filter(Boolean);
  const multi = alts.length > 0;
  return {
    publications: multi ? a.works_count + alts.reduce((s,x) => s + (x.works_count||0), 0) : a.works_count,
    citations: multi ? a.cited_by_count + alts.reduce((s,x) => s + (x.cited_by_count||0), 0) : a.cited_by_count,
    h_index: multi ? hIndex(works.map(w => w.cited_by_count)) : a.h_index,
    h_index_basis: multi ? "calculado sobre los trabajos combinados" : "OpenAlex summary_stats",
    i10_index: multi ? null : a.i10_index,
    works_count: a.works_count, cited_by_count: a.cited_by_count,
    first_year: years.length ? Math.min(...years) : null, last_year: years.length ? Math.max(...years) : null,
    years_active: yearsRange(years),
    works_retrieved: works.length,
  };
}

/* Punto 10: no sustituir información institucional de ORCID; registrar discrepancias. */
function compareSources(R){
  const out = [], oa = R.sources.openalex, a = oa?.author; if (!a) return out;
  const lki = a.last_known_institutions.map(i => i.name);
  const uprLki = lki.filter(isUPR);
  if (lki.length && !uprLki.length)
    out.push({field:"Institución", orcid:`${R.affiliation.org} (${R.affiliation.campus})`, openalex:lki.join(" | "),
              note:"La última institución conocida en OpenAlex no es la UPR. Se conservan ambas; ORCID prevalece para la afiliación."});
  else if (uprLki.length){
    const oaCampuses = uniq(uprLki.map(n => detectCampus(n,"").name)).filter(c => c !== GENERAL.name);
    const orcCampuses = R.affiliation.campus.split(" | ");
    if (oaCampuses.length && !oaCampuses.some(c => orcCampuses.includes(c)))
      out.push({field:"Recinto", orcid:R.affiliation.campus, openalex:uprLki.join(" | "), note:"Recinto distinto entre fuentes. Se conservan ambos."});
  }
  const fam = norm(R.identity.family).split(/\s+/).filter(x => x.length > 2);
  const names = [a.name, ...a.alternatives].map(norm);
  if (fam.length && !fam.some(f => names.some(n => n.includes(f))))
    out.push({field:"Nombre", orcid:`${R.identity.given} ${R.identity.family}`, openalex:a.name, note:"El nombre difiere; el vínculo se basa en el ORCID."});
  return out;
}
