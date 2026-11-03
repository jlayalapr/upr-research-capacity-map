"use strict";
/* =====================================================================
   MAPA VISUAL POR RECINTO (UPR Research Capacity Map)
   - Mapa (Leaflet + OpenStreetMap) con una burbuja por recinto, cuyo tamaño
     depende de la métrica elegida, y líneas de coautoría entre recintos.
   - Panel del recinto: indicadores, capacidades principales, investigadores
     y colaboraciones.
   - Matriz de calor capacidades × recintos.
   Si Leaflet no carga (sin Internet), se dibuja un esquema SVG equivalente.
   ===================================================================== */
const CAMPUS_GEO = { // coordenadas aproximadas de cada recinto
  rp:[18.4037,-66.0504], rum:[18.2110,-67.1410], rcm:[18.3972,-66.0750], cay:[18.1105,-66.1660], hum:[18.1490,-65.8180],
  bay:[18.4030,-66.1820], are:[18.4660,-66.7050], agu:[18.4720,-67.1070], car:[18.3790,-65.9590], pon:[18.0150,-66.5800],
  utu:[18.2690,-66.6930], ac:[18.4020,-66.0440],
};
const CAMPUS_SHORT = { rp:"Río Piedras", rum:"Mayagüez", rcm:"RCM", cay:"Cayey", hum:"Humacao", bay:"Bayamón", are:"Arecibo", agu:"Aguadilla", car:"Carolina", pon:"Ponce", utu:"Utuado", ac:"Adm. Central" };
const MAP_METRICS = {
  researchers: {label:"Profesores (o con la capacidad filtrada)", fmt: v => fmt(v)},
  pubs:        {label:"Publicaciones (OpenAlex)", fmt: v => fmt(v)},
  cites:       {label:"Citas (OpenAlex)", fmt: v => fmt(v)},
  funding:     {label:"Fondos NIH + NSF (USD)", fmt: v => money$(v)},
  active:      {label:"Investigadores activos", fmt: v => fmt(v)},
};
const MAPV = { map: null, layer: null, selected: null, heatSel: null };

function campusStats(category, filter){
  const f = norm(filter || ""), stats = new Map();
  const get = name => stats.get(name) || stats.set(name, { name, campus: CAMPUSES.find(c => c.name === name) || GENERAL,
    researchers: new Set(), enriched: 0, pubs: 0, cites: 0, active: 0, funding: 0, awards: 0, matching: new Set(), collab: new Map(), people: [] }).get(name);
  for (const R of researchers()){
    const P = R.capacity, m = R.sources.openalex?.metrics;
    for (const c of R.affiliation.campus.split(" | ")){
      const S = get(c); S.researchers.add(R.orcid); S.people.push(R);
      if (m){ S.enriched++; S.pubs += m.publications || 0; S.cites += m.citations || 0; }
      if (P?.activity?.status?.startsWith("Active")) S.active++;
      if (P?.funding_record){ S.funding += P.funding_record.total_amount; S.awards += P.funding_record.total_awards; }
      for (const x of (P?.collaboration?.upr_campuses || [])) if (!x.own && x.campus !== c && x.campus !== GENERAL.name) S.collab.set(x.campus, (S.collab.get(x.campus)||0) + x.works);
    }
  }
  if (f) for (const fact of capacityFacts()){
    if (category && fact.category !== category) continue;
    if (fact.confidence < 0.4 || !norm(`${fact.capacity} ${fact.subfield} ${fact.field}`).includes(f)) continue;
    for (const c of fact.campus.split(" | ")) get(c).matching.add(fact.orcid);
  }
  return stats;
}
function metricValue(S, metric, filtered){
  if (metric === "researchers") return filtered ? S.matching.size : S.researchers.size;
  return S[metric] || 0;
}

function renderCampusMap(){
  const metric = $("mapMetric").value, category = $("mapCat").value, filter = $("mapFilter").value.trim();
  const stats = campusStats(category, filter), filtered = !!filter;
  const onMap = [...stats.values()].filter(S => CAMPUS_GEO[S.campus.id]);
  const max = Math.max(1, ...onMap.map(S => metricValue(S, metric, filtered)));
  const radius = v => v ? 6 + 26*Math.sqrt(v/max) : 4;
  const showLinks = $("mapLinks").checked;
  const pairs = new Map();
  if (showLinks) for (const S of onMap) for (const [other, w] of S.collab){
    const B = CAMPUSES.find(c => c.name === other); if (!B || !CAMPUS_GEO[B.id]) continue;
    const k = [S.campus.id, B.id].sort().join("|"); pairs.set(k, (pairs.get(k)||0) + w);
  }
  const maxLink = Math.max(1, ...pairs.values());
  const unspecified = stats.get(GENERAL.name);
  $("mapNote").innerHTML = `Tamaño de la burbuja: <b>${esc(MAP_METRICS[metric].label)}</b>${filtered ? ` · filtro: «${esc(filter)}»` : ""}${showLinks && pairs.size ? " · líneas: coautorías entre recintos (OpenAlex)" : ""}`
    + (unspecified?.researchers.size ? ` · ${unspecified.researchers.size} profesor(es) con recinto no especificado no aparecen en el mapa` : "")
    + ". Coordenadas aproximadas.";

  if (window.L){
    if (!MAPV.map){
      MAPV.map = L.map("cmap", {scrollWheelZoom: false, zoomSnap: 0.25}).setView([18.22, -66.45], 9);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {maxZoom: 16, attribution: "© OpenStreetMap"}).addTo(MAPV.map);
      MAPV.layer = L.layerGroup().addTo(MAPV.map);
    }
    MAPV.layer.clearLayers();
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#b5121b";
    for (const [k, w] of pairs){
      const [a, b] = k.split("|");
      L.polyline([CAMPUS_GEO[a], CAMPUS_GEO[b]], {color: "#3b4bc8", weight: 1 + 7*w/maxLink, opacity: 0.45})
        .bindTooltip(`${CAMPUSES.find(c=>c.id===a).name} ↔ ${CAMPUSES.find(c=>c.id===b).name}: ${w} trabajo(s) en coautoría`).addTo(MAPV.layer);
    }
    for (const S of onMap.sort((a,b) => metricValue(b,metric,filtered) - metricValue(a,metric,filtered))){
      const v = metricValue(S, metric, filtered);
      L.circleMarker(CAMPUS_GEO[S.campus.id], {radius: radius(v), color: accent, weight: MAPV.selected === S.name ? 3 : 1.5, fillColor: accent, fillOpacity: v ? 0.5 : 0.1})
        .bindTooltip(`<b>${esc(S.name)}</b><br>${esc(MAP_METRICS[metric].fmt(v))} · ${S.researchers.size} profesores`)
        .on("add", function(){ if (S.researchers.size) L.tooltip({permanent:true, direction:"right", offset:[radius(v), 0], className:"camp-label", interactive:false})
            .setLatLng(CAMPUS_GEO[S.campus.id]).setContent(`${esc(CAMPUS_SHORT[S.campus.id])} · ${esc(MAP_METRICS[metric].fmt(v))}`).addTo(MAPV.layer); })
        .on("click", () => { MAPV.selected = S.name; renderCampusPanel(); renderCampusMap(); })
        .addTo(MAPV.layer);
    }
    setTimeout(() => MAPV.map.invalidateSize(), 0);
  } else {
    // Esquema SVG (sin conexión a Internet)
    const W = 800, H = 330, X = lon => (lon + 67.35) / 1.8 * W, Y = lat => (18.62 - lat) / 0.75 * H;
    let svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Esquema de recintos UPR"><rect width="${W}" height="${H}" rx="10" fill="var(--soft)"/>`;
    for (const [k, w] of pairs){ const [a,b] = k.split("|"), A = CAMPUS_GEO[a], B = CAMPUS_GEO[b];
      svg += `<line x1="${X(A[1])}" y1="${Y(A[0])}" x2="${X(B[1])}" y2="${Y(B[0])}" stroke="#3b4bc8" stroke-opacity=".45" stroke-width="${1 + 7*w/maxLink}"/>`; }
    for (const S of onMap){ const [la, lo] = CAMPUS_GEO[S.campus.id], v = metricValue(S, metric, filtered);
      svg += `<g data-campus="${esc(S.name)}" style="cursor:pointer"><circle cx="${X(lo)}" cy="${Y(la)}" r="${radius(v)}" fill="var(--accent)" fill-opacity="${v ? .5 : .1}" stroke="var(--accent)"/>
        <text x="${X(lo)}" y="${Y(la) - radius(v) - 4}" text-anchor="middle" font-size="11" fill="var(--ink)">${esc(S.name)} (${esc(MAP_METRICS[metric].fmt(v))})</text></g>`; }
    $("cmap").innerHTML = svg + `</svg>`;
  }
  if (!MAPV.selected){ const top = onMap.filter(S => S.researchers.size).sort((a,b) => b.researchers.size - a.researchers.size)[0]; if (top){ MAPV.selected = top.name; } }
  renderCampusPanel(stats);
  renderHeatmap();
}

function topCaps(campus, category, n=8){
  const m = new Map();
  for (const f of capacityFacts()){
    if (f.category !== category || f.confidence < 0.4 || !f.campus.split(" | ").includes(campus)) continue;
    const e = m.get(f.capacity) || m.set(f.capacity, {capacity: f.capacity, researchers: new Set(), conf: 0}).get(f.capacity);
    if (!e.researchers.has(f.orcid)){ e.researchers.add(f.orcid); e.conf += f.confidence; }
  }
  return [...m.values()].sort((a,b) => b.researchers.size - a.researchers.size || b.conf - a.conf).slice(0, n);
}
function renderCampusPanel(stats){
  const name = MAPV.selected, box = $("campusPanel");
  if (!name){ box.innerHTML = `<p class="note">Selecciona un recinto en el mapa.</p>`; return; }
  stats = stats || campusStats($("mapCat").value, $("mapFilter").value);
  const S = stats.get(name); if (!S){ box.innerHTML = ""; return; }
  const capRow = (cat, label) => { const l = topCaps(name, cat); return l.length ? `<div class="cap-sec"><h4>${esc(label)}</h4><div class="chips">${l.map(c =>
    `<button class="chip" data-mapq="${esc(c.capacity)}" data-mapcat="${esc(cat)}" data-mapcampus="${esc(name)}" title="Ver investigadores">${esc(c.capacity)}<span class="c">${c.researchers.size}</span></button>`).join("")}</div></div>` : ""; };
  const tops = S.people.filter(R => R.sources.openalex?.metrics).sort((a,b) => (b.sources.openalex.metrics.citations||0) - (a.sources.openalex.metrics.citations||0)).slice(0,8);
  box.innerHTML = `<h3 style="margin-top:0">${esc(name)}</h3>
    <div class="tiles"><div class="tile"><b>${S.researchers.size}</b><span>Profesores</span></div><div class="tile"><b>${S.enriched}</b><span>Con OpenAlex</span></div>
      <div class="tile"><b>${fmt(S.pubs)}</b><span>Publicaciones</span></div><div class="tile"><b>${fmt(S.cites)}</b><span>Citas</span></div>
      <div class="tile"><b>${S.active}</b><span>Activos</span></div><div class="tile"><b>${money$(S.funding)}</b><span>Fondos NIH/NSF</span></div>
      <div class="tile"><b>${S.awards}</b><span>Proyectos</span></div><div class="tile"><b>${S.matching.size || "—"}</b><span>Con el filtro</span></div></div>
    ${capRow("Expertise","Expertise")}${capRow("Method","Methods")}${capRow("Technology","Technologies")}${capRow("Problem","Research Problems")}
    ${capRow("Funding Track Record","Funding Track Record")}${capRow("Funding Area","Potential Funding Areas (inferido)")}
    ${tops.length ? `<div class="cap-sec"><h4>Investigadores más citados</h4><ul class="pubs">${tops.map(R => `<li><button class="link" data-goto="${esc(R.orcid)}">${esc(fullName(R))}</button>
      <span class="m">· ${esc(R.affiliation.dept || "")} · ${fmt(R.sources.openalex.metrics.citations)} citas</span></li>`).join("")}</ul></div>` : ""}
    ${S.collab.size ? `<div class="cap-sec"><h4>Colabora con otros recintos</h4><p class="note" style="margin:0">${[...S.collab.entries()].sort((a,b) => b[1]-a[1]).map(([c,w]) => `${esc(c)} (${w})`).join(" · ")}</p></div>` : ""}`;
}

function renderHeatmap(){
  const cat = $("mapCat").value || "Expertise", facts = capacityFacts().filter(f => f.category === cat && f.confidence >= 0.4);
  if (!facts.length){ $("heatmap").innerHTML = `<p class="note">Sin capacidades de tipo «${esc(cat)}» todavía.</p>`; $("heatList").innerHTML = ""; return; }
  const cols = [...CAMPUSES, GENERAL].map(c => c.name).filter(n => facts.some(f => f.campus.split(" | ").includes(n)));
  const cell = new Map(), totals = new Map();
  for (const f of facts) for (const c of f.campus.split(" | ")){
    const k = f.capacity + "||" + c;
    (cell.get(k) || cell.set(k, new Set()).get(k)).add(f.orcid);
    (totals.get(f.capacity) || totals.set(f.capacity, new Set()).get(f.capacity)).add(f.orcid);
  }
  const rows = [...totals.entries()].sort((a,b) => b[1].size - a[1].size).slice(0, 15).map(([k]) => k);
  const max = Math.max(1, ...[...cell.values()].map(s => s.size));
  $("heatmap").innerHTML = `<div class="tablewrap" style="max-height:none"><table class="heat"><thead><tr><th>${esc(cat)}</th>${cols.map(c => `<th class="num">${esc(c)}</th>`).join("")}<th class="num">Total</th></tr></thead><tbody>
    ${rows.map(r => `<tr><td>${esc(r)}</td>${cols.map(c => { const n = cell.get(r + "||" + c)?.size || 0;
      return `<td class="num hc" ${n ? `data-heat="${esc(r)}||${esc(c)}"` : ""} style="background:color-mix(in srgb, var(--accent) ${n ? Math.round(12 + 70*n/max) : 0}%, transparent);${n/max > .55 ? "color:#fff" : ""}">${n || ""}</td>`; }).join("")}
      <td class="num"><b>${totals.get(r).size}</b></td></tr>`).join("")}</tbody></table></div>
    <p class="note">Cada celda = número de profesores con esa capacidad (confianza ≥ 0.4). Haz clic en una celda para ver quiénes son.</p>`;
}
function renderHeatList(capacity, campus, cat){
  cat = cat || $("mapCat").value || "Expertise";
  const list = capacityFacts().filter(f => f.category === cat && f.capacity === capacity && f.confidence >= 0.4 && (!campus || f.campus.split(" | ").includes(campus)))
    .sort((a,b) => b.confidence - a.confidence);
  $("heatList").innerHTML = `<h3>${esc(capacity)}${campus ? " · " + esc(campus) : ""}</h3><ul class="pubs">${list.map(f => `<li><button class="link" data-goto="${esc(f.orcid)}">${esc(f.name)}</button>
    <span class="m">· ${esc(f.campus)} · ${esc(f.department)} · confianza ${f.confidence} · ${f.supporting_works} evidencia(s) · ${esc(f.years)} · ${esc(f.source)}</span></li>`).join("")}</ul>`;
}
