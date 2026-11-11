"use strict";
/* =====================================================================
   FUENTE: USAspending.gov (todas las agencias federales)
   Rol: FONDOS OTORGADOS A LA INSTITUCIÓN (subvenciones federales a la UPR).
   No trae el nombre del investigador, así que NO se vincula a profesores:
   es una vista institucional por agencia, recinto, año y tipo de fondo.
   El recinto se deduce del nombre del recipiente, la descripción o el lugar
   donde se realiza el proyecto. Los fondos de emergencia (COVID-19) y los de
   educación/apoyo estudiantil se separan de investigación y otros proyectos.
   ===================================================================== */
FUND_HOSTS.usa = "https://api.usaspending.gov";
FUND_MODE.usa = null;
LIMITERS.usa = new Limiter(4);
const USA_FIELDS = ["Award ID","Recipient Name","Award Amount","Awarding Agency","Awarding Sub Agency","Start Date","End Date","Description",
  "CFDA Number","generated_internal_id","pop_city_name","Place of Performance Zip5","def_codes"];
const COVID_DEF = new Set(["L","M","N","O","P","U","V"]);
const ZIP_CAMPUS = { "00931": "Río Piedras", "00925": "Río Piedras", "00680": "Mayagüez", "00681": "Mayagüez", "00682": "Mayagüez" };
function usaCampus(a){
  const n = norm(`${a.recipient} ${a.desc}`);
  if (n.includes("estacion experimental agricola") || n.includes("agricultural experiment station")) return "Mayagüez";
  const byName = detectCampus(`${a.recipient} ${a.desc}`, "");
  if (byName !== GENERAL) return byName.name;
  if (ZIP_CAMPUS[a.zip]) return ZIP_CAMPUS[a.zip];
  const byCity = detectCampus("", a.city || "");
  return byCity.name;
}
function usaCategory(a){
  if ((a.def || []).some(c => COVID_DEF.has(c)) || a.cfda === "84.425") return "Emergencia (COVID-19)";
  if (a.agency === "Department of Education" && !String(a.cfda).startsWith("84.305")) return "Educación y apoyo estudiantil";
  return "Investigación, extensión y otros proyectos";
}
const FEDERAL = {
  data: null,
  async harvest(since, signal, onProgress){
    const body = { filters: { award_type_codes: ["02","03","04","05"], recipient_search_text: ["University of Puerto Rico", "Universidad de Puerto Rico"],
      time_period: [{ start_date: `${Math.max(2008, since)}-01-01`, end_date: nowISO().slice(0, 10) }] },
      fields: USA_FIELDS, limit: 100, page: 1, sort: "Award Amount", order: "desc", subawards: false };
    const out = [];
    for (let page = 1; page <= 200; page++){
      body.page = page;
      const d = await fundFetch("usa", "/api/v2/search/spending_by_award/", signal, { method: "POST", body });
      out.push(...(d?.results || []));
      onProgress && onProgress(out.length);
      if (!d?.page_metadata?.hasNext) break;
    }
    const seen = new Set(), awards = [];
    for (const x of out){
      if (!isUPR(x["Recipient Name"]) || seen.has(x.generated_internal_id)) continue;
      seen.add(x.generated_internal_id);
      const a = { id: x["Award ID"], uid: x.generated_internal_id, recipient: x["Recipient Name"] || "", amount: Number(x["Award Amount"]) || 0,
        agency: x["Awarding Agency"] || "", sub: x["Awarding Sub Agency"] || "", start: x["Start Date"] || "", end: x["End Date"] || "",
        desc: String(x.Description || "").slice(0, 280), cfda: x["CFDA Number"] || "", city: x.pop_city_name || "", zip: x["Place of Performance Zip5"] || "",
        def: x.def_codes || [] };
      a.campus = usaCampus(a); a.cat = usaCategory(a); a.year = yearOf(a.start);
      delete a.def; awards.push(a);
    }
    return { source: "USAspending.gov", since, generated: nowISO(), awards };
  },
  async load(){
    if (this.data) return this.data;
    if (APP_CONFIG.backend === "local"){ this.data = await IDB.get("federal"); return this.data; }
    this.data = await SB.rpc("api_get_federal", { p_session: AUTH.token });
    return this.data;
  },
  async save(data){
    this.data = data;
    if (APP_CONFIG.backend === "local"){ await IDB.put("federal", data); return nowISO(); }
    return SB.rpc("api_set_federal", { p_session: AUTH.token, p_data: data });
  },
  url: a => `https://www.usaspending.gov/award/${encodeURIComponent(a.uid)}`,
};
