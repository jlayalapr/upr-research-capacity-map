"use strict";
/* =====================================================================
   FUENTE: ORCID (pub.orcid.org, API pública v3.0)
   Rol: IDENTIDAD y AFILIACIÓN DECLARADA. Fuente principal: identifica al
   investigador sin ambigüedad. Nada de aquí se sobrescribe con otra fuente.
   ===================================================================== */
const API = "https://pub.orcid.org/v3.0";
const ORCID = {
  ROWS: 1000, MAX_START: 10000,

  /** Búsqueda expandida por afiliación; agrega resultados a `people` (Map). */
  async search(query, signal, people, onProgress){
    let start = 0, total = 0;
    while (true){
      const url = `${API}/expanded-search/?q=${encodeURIComponent("affiliation-org-name:"+query)}&start=${start}&rows=${this.ROWS}`;
      const data = await getJSON(url, signal);
      total = data["num-found"] || 0;
      for (const p of (data["expanded-result"]||[])) if (!people.has(p["orcid-id"])) people.set(p["orcid-id"], p);
      onProgress && onProgress(people.size);
      start += this.ROWS;
      if (start >= total) break;
      if (start >= this.MAX_START) { total = -total; break; }  // negativo = truncado
    }
    return total;
  },

  async employments(id, signal){
    const data = await cached(`orcid:emp:${id}`, () => getJSON(`${API}/${id}/employments`, signal), false);
    const out = [];
    for (const g of (data?.["affiliation-group"]||[]))
      for (const s of (g.summaries||[])){
        const e = s["employment-summary"]; if (!e) continue;
        out.push({ putcode: e["put-code"], org: e.organization?.name||"", city: e.organization?.address?.city||"",
          dept: e["department-name"]||"", role: e["role-title"]||"", start: ymd(e["start-date"]), end: ymd(e["end-date"]) });
      }
    return out;
  },

  /** Registro completo (persona + actividades). Caché solo de sesión: puede ser grande. */
  record(id, signal){ return cached(`orcid:record:${id}`, () => getJSON(`${API}/${id}/record`, signal), false); },
};
function ymd(d){ if(!d) return ""; const y=d.year?.value||"", m=d.month?.value||"", dd=d.day?.value||""; return [y,m,dd].filter(Boolean).join("-"); }

/** Crea el registro canónico del investigador a partir de ORCID. */
function makeResearcher(p, campusName, emps, orgs){
  const j = (k) => uniq((emps||[]).map(e => e[k])).join(" | ");
  const first = (emps||[])[0] || {};
  return {
    orcid: p["orcid-id"],
    identity: { given: p["given-names"]||"", family: p["family-names"]||"", credit: p["credit-name"]||"",
                emails: p.email||[], ...prov("ORCID","declared") },
    affiliation: { campus: campusName, role: j("role"), dept: j("dept"), college: deriveCollege(first.dept),
                   org: emps ? j("org") : (orgs||[]).join(" | "), city: j("city"), start: j("start"), end: j("end"),
                   ...prov("ORCID","declared", {verified: !!emps}) },
    affiliations: emps || [],
    sources: { orcid: { search: p, ...prov("ORCID","declared") }, openalex: null },
    discrepancies: [],
    capacity: null,
  };
}
