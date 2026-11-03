"use strict";
/* =====================================================================
   FUENTE: Grants.gov (API pública search2, sin clave)
   Rol: CONVOCATORIAS abiertas y anunciadas (posted | forecasted).
   Se consulta por área de capacidad: cada regla de FUNDING_RULES tiene
   palabras clave (GRANTS_QUERIES) y las convocatorias encontradas se
   asocian a los investigadores UPR con esa capacidad.
   Docs: https://grants.gov/api/common/search2
   ===================================================================== */
const GRANTS_QUERIES = {
  "AI & Data Science Research": "artificial intelligence",
  "AI in Education & Learning Technologies": "artificial intelligence education",
  "STEM Education & Broadening Participation": "STEM education",
  "Student Success & Higher Education": "student success",
  "K-12 Education Research": "K-12 education research",
  "Cancer Research": "cancer",
  "Precision Medicine & Genomics": "genomics",
  "Health Disparities & Minority Health": "health disparities",
  "Infectious & Vector-Borne Diseases": "infectious disease",
  "Mental Health & Substance Use": "mental health",
  "Neuroscience & Aging": "neuroscience aging",
  "Cardiometabolic Health": "diabetes obesity cardiovascular",
  "Environmental Health": "environmental health",
  "Climate Change & Resilience": "climate resilience",
  "Natural Hazards & Disaster Research": "natural hazards",
  "Marine & Coastal Science": "coastal ocean",
  "Biodiversity, Ecology & Conservation": "biodiversity conservation",
  "Renewable Energy & Energy Systems": "renewable energy",
  "Advanced Materials & Nanotechnology": "materials research",
  "Agriculture & Food Systems": "agriculture food",
  "Water Resources": "water resources",
  "Cybersecurity & Advanced Computing": "cybersecurity",
  "Social, Behavioral & Economic Sciences": "social behavioral sciences",
  "Humanities & Cultural Heritage": "humanities",
  "Entrepreneurship, Innovation & Workforce": "workforce innovation",
  "Space & Astronomy": "astronomy space",
  "Public Health & Epidemiology": "public health",
  "Maternal & Child Health": "maternal child health",
  "Biomedical & Molecular Life Sciences": "biomedical research",
  "Engineering & Infrastructure": "engineering infrastructure",
};
FUND_HOSTS.grants = "https://api.grants.gov";
FUND_MODE.grants = null;
LIMITERS.grants = new Limiter(3);

const GRANTS = {
  /** Busca convocatorias abiertas/anunciadas para una palabra clave. Caché 6 h. */
  async search(keyword, signal, rows = 15){
    const key = `grants:${norm(keyword)}:${rows}`, c = CACHE.get(key);
    if (c.hit && Date.now() - (c.value.t || 0) < 6 * 3600e3){ NET.cacheHits++; return c.value.items; }
    const body = { keyword, oppStatuses: "forecasted|posted", rows };
    const d = await fundFetch("grants", "/v1/api/search2", signal, { method: "POST", body });
    const hits = d?.data?.oppHits || d?.oppHits || [];
    const items = hits.map(h => ({
      id: String(h.id ?? h.opportunityId ?? ""), number: h.number || h.opportunityNumber || "", title: h.title || h.opportunityTitle || "",
      agencyCode: h.agencyCode || h.agency_code || "", agency: h.agency || h.agencyName || h.agencyCode || "",
      openDate: h.openDate || "", closeDate: h.closeDate || "", status: (h.oppStatus || h.opportunityStatus || "").toLowerCase(),
      docType: h.docType || "", aln: Array.isArray(h.alnist) ? h.alnist : (h.cfdaList || []),
    })).filter(o => o.id && o.title);
    CACHE.set(key, { t: Date.now(), items }, true);
    return items;
  },
  url: o => `https://www.grants.gov/search-results-detail/${encodeURIComponent(o.id)}`,
  /** Fecha MM/DD/YYYY → Date (o null). */
  date(s){ const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s || ""); return m ? new Date(+m[3], +m[1] - 1, +m[2]) : null; },
  /** Sigla corta para la insignia (NIH, NSF, DOE, NOAA, NASA, USDA…). */
  badge(o){
    const c = (o.agencyCode || "").toUpperCase();
    if (c.startsWith("HHS-NIH")) return "NIH"; if (c.startsWith("NSF")) return "NSF"; if (c.startsWith("DOC-NOAA") || /NOAA/.test(o.agency)) return "NOAA";
    if (c.startsWith("NASA")) return "NASA"; if (c.startsWith("USDA")) return "USDA"; if (c.startsWith("DOE") || c.startsWith("PAMS")) return "DOE";
    if (c.startsWith("ED")) return "ED"; if (c.startsWith("HHS-CDC")) return "CDC"; if (c.startsWith("EPA")) return "EPA"; if (c.startsWith("DOD") || c.startsWith("DARPA")) return "DOD";
    if (c.startsWith("NEH")) return "NEH"; if (c.startsWith("HHS")) return "HHS";
    return (c.split("-")[0] || "GOV").slice(0, 5);
  },
};
