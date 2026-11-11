"use strict";
/* =====================================================================
   APLICACIÓN: conecta fuentes, capa de capacidades, interfaz y exportación.
   ===================================================================== */
const log = (id, m) => { const el = $(id); el.textContent += m + "\n"; el.scrollTop = el.scrollHeight; };
let searchAbort = null, oaAbort = null;

/* ---------- inicialización ---------- */
hydrateIcons();
$("campus").innerHTML = `<option value="all">Todo el sistema UPR</option>` + CAMPUSES.map(c => `<option value="${c.id}">${c.name}</option>`).join("");
$("examples").innerHTML = QUERY_EXAMPLES.map(q => `<button type="button" data-q="${esc(q)}">${esc(q)}</button>`).join("");
$("aggDim").innerHTML = Object.entries(DIMENSIONS).map(([k,v]) => `<option value="${k}">Agrupar por: ${esc(v.label)}</option>`).join("");
$("aggCat").innerHTML = `<option value="">Todas las categorías</option>` + CATEGORIES.map(c => `<option>${c}</option>`).join("");
$("fundSince").value = FUND_CFG.since;
$("mapMetric").innerHTML = Object.entries(MAP_METRICS).map(([k,v]) => `<option value="${k}">Tamaño: ${esc(v.label)}</option>`).join("");
$("mapCat").innerHTML = CATEGORIES.map(c => `<option ${c === "Expertise" ? "selected" : ""}>${c}</option>`).join("");
let fundAbort = null;
try { const s = JSON.parse(localStorage.getItem("uprcap:settings") || "{}"); if (s.key) $("oaKey").value = s.key; if (s.max) $("oaMax").value = s.max; if (s.remember === false) $("oaRemember").checked = false; } catch {}

function refreshCacheInfo(){ $("cacheInfo").textContent = `Caché local: ${CACHE.keys().length} entradas · ${CACHE.sizeKB()} KB`; }
function updateButtons(){
  const has = STATE.researchers.size > 0, enriched = researchers().some(R => R.capacity), light = STORE.isLight();
  $("oaBtn").disabled = !has || light; $("vivoBtn").disabled = !has; $("fundBtn").disabled = !has || light; $("dlCsv").disabled = !has; $("dlJson").disabled = !has;
  $("lightNote").hidden = !light;
  $("dlCap").disabled = !enriched;
  $("fundMode").textContent = Object.entries(FUND_MODE).filter(([,m]) => m).map(([k,m]) => `${k.toUpperCase()}: ${m === "proxy" ? "vía servidor.py" : "conexión directa"}`).join(" · ");
}
/** Guarda la copia de trabajo, publica en Supabase (admin) y refresca la interfaz. */
const setPub = m => { $("pubStatus").textContent = m; };
async function persistAndRefresh(){
  if (STATE.researchers.size && !STORE.isLight()){
    await STORE.saveLocal(APP_CONFIG.backend !== "local");
    if (APP_CONFIG.backend !== "local" && AUTH.isAdmin()){
      try {
        setPub("Publicando en la base de datos…");
        const r = await STORE.publish((n, t) => setPub(`Publicando en la base de datos: ${n} de ${t} investigadores…`));
        try { await STORE.mergePublished(); } catch(e){ console.warn(e); }
        setPub(`✓ Publicado ${r.scope}: ${r.count} investigadores · ${new Date().toLocaleString("es")}. Versión vigente: ${r.label} (${r.total} investigadores en total). Los visitantes ya la ven.`);
      } catch(e){
        setPub(`✗ No se pudo publicar: ${e.message} Tu copia de trabajo quedó guardada en este navegador; usa «Publicar ahora» para reintentar.`);
        if (e instanceof AuthError){ alert(e.message); }
      }
    }
  }
  refreshAll();
}
async function loadData(){
  const box = $("loadingBox"); box.hidden = false; box.textContent = "Cargando datos…";
  try { await STORE.load((n, t) => box.textContent = `Cargando datos: ${n} de ${t} investigadores…`); await PEOPLE.load(); await OUTREACH.load(); }
  catch(e){
    if (e instanceof AuthError){ await AUTH.logout(); }
    else alert("No se pudieron cargar los datos: " + e.message);
  } finally { box.hidden = true; invalidateSys(); updateButtons(); }
}
function refreshAll(){ updateButtons(); refreshCacheInfo(); campusButtons(); rerender(); }
function campusButtons(){
  const box = $("campusButtons"); box.innerHTML = "";
  if (uniq(researchers().flatMap(R => R.affiliation.campus.split(" | "))).length < 2) return;
  box.innerHTML = `<span class="note">CSV por recinto:</span>`;
  for (const c of [...CAMPUSES, GENERAL]){
    const list = researchers().filter(R => R.affiliation.campus.split(" | ").includes(c.name));
    if (!list.length) continue;
    const b = document.createElement("button"); b.textContent = `${c.name} (${list.length})`;
    b.onclick = () => downloadProfessorsCSV(list, c.name); box.appendChild(b);
  }
}

/* ---------- 1. ORCID ---------- */
$("start").onclick = async () => {
  const target = CAMPUSES.find(c => c.id === $("campus").value) || null;
  const verify = $("verify").checked, onlyFac = $("onlyFaculty").checked, includeNoRole = $("includeNoRole").checked;
  const onlyCurrent = $("onlyCurrent").checked, broad = $("broad").checked && target;
  let roleRe; try { roleRe = new RegExp($("roleRegex").value, "i"); } catch(e){ alert("Expresión regular inválida: " + e.message); return; }
  if (broad && !verify){ alert("La búsqueda amplia requiere verificar el empleo."); return; }

  searchAbort = new AbortController(); const signal = searchAbort.signal;
  // Solo se reemplaza el alcance de este harvest; los demás recintos publicados se conservan.
  const scope = target ? target.name : "Sistema UPR";
  // Los añadidos manualmente de este alcance se conservan (si solo está la versión de consulta, se baja la completa).
  for (const R of researchers()){
    if (R.manual && inScope(R, scope)){ if (R.light){ try { await STORE.fullRecord(R.orcid); } catch {} } continue; }
    if (!R.light || inScope(R, scope)) STATE.researchers.delete(R.orcid);
  }
  STATE.scope = scope; if (!target) STATE.label = scope; STATE.createdAt = nowISO();
  $("log").textContent = ""; $("bar").style.width = "0";
  ["sFound","sChecked","sKept"].forEach(k => $(k).textContent = "0");
  $("start").disabled = true; $("stop").disabled = false; refreshAll();
  const setBar = f => $("bar").style.width = Math.round(Math.min(1,f)*100) + "%";

  try {
    const people = new Map();
    const queries = target ? [[target.name, target.q], ...(broad ? [["UPR general", UPR]] : [])]
                           : [...CAMPUSES.map(c => [c.name, c.q]), ["UPR general", UPR]];
    for (const [i, [label, q]] of queries.entries()){
      if (signal.aborted) break;
      const before = people.size;
      const total = await ORCID.search(q, signal, people, n => $("sFound").textContent = n);
      log("log", `Búsqueda «${label}»: ${Math.abs(total)} resultados (${people.size - before} nuevos)` + (total < 0 ? ` ⚠ ORCID solo permite paginar ${ORCID.MAX_START}` : ""));
      setBar(verify ? 0.1*(i+1)/queries.length : (i+1)/queries.length);
    }
    const list = [...people.values()];
    log("log", `Perfiles únicos: ${list.length}`);

    if (!verify){
      for (const p of list){
        const upr = (p["institution-name"]||[]).filter(isUPR);
        if (!upr.length) continue;
        const camps = uniq(upr.map(n => detectCampus(n,"").name));
        if (target && !camps.includes(target.name)) continue;
        STATE.researchers.set(p["orcid-id"], makeResearcher(p, target ? target.name : camps.join(" | "), null, upr));
      }
      $("sChecked").textContent = list.length;
    } else {
      let done = 0;
      await pool(list, 8, async p => {
        try {
          let keep = (await ORCID.employments(p["orcid-id"], signal)).filter(e => isUPR(e.org));
          if (onlyCurrent) keep = keep.filter(e => !e.end);
          if (onlyFac) keep = keep.filter(e => e.role ? roleRe.test(e.role) : includeNoRole);
          keep = keep.map(e => ({...e, campus: detectCampus(e.org, e.city).name}));
          if (target) keep = keep.filter(e => e.campus === target.name);
          if (keep.length){
            STATE.researchers.set(p["orcid-id"], makeResearcher(p, uniq(keep.map(e => e.campus)).join(" | "), keep));
            $("sKept").textContent = working().length;
          }
        } catch(e){ if (!signal.aborted) log("log", `  ✗ ${p["orcid-id"]}: ${e.message}`); }
        done++; $("sChecked").textContent = done; setBar(0.1 + 0.9*done/list.length);
      }, signal);
    }
    setBar(1);
    log("log", signal.aborted ? "Detenido. Puedes trabajar con lo obtenido." : `✓ Terminado: ${working().length} profesores.`);
  } catch(e){
    if (!signal.aborted){ log("log", "✗ Error: " + e.message); if (e instanceof TypeError) log("log", "  Posible bloqueo de red/CORS. Verifica la conexión."); }
  } finally {
    $("sKept").textContent = working().length;
    $("start").disabled = false; $("stop").disabled = true; await persistAndRefresh();
  }
};
$("stop").onclick = () => searchAbort?.abort();

/* ---------- 2. OpenAlex ---------- */
$("oaBtn").onclick = async () => {
  OA_CFG.apiKey = $("oaKey").value.trim(); OA_CFG.nameCandidates = $("oaNames").checked;
  OA_CFG.maxWorks = clamp(Number($("oaMax").value) || 500, 25, 5000);
  CACHE.persist = $("persistCache").checked;
  const remember = $("oaRemember").checked;
  try { localStorage.setItem("uprcap:settings", JSON.stringify({key: remember ? OA_CFG.apiKey : "", max: OA_CFG.maxWorks, remember})); } catch {}
  const pending = working().filter(R => !CACHE.get(`oa:works:${R.sources.openalex?.author?.id}:${OA_CFG.maxWorks}`).hit).length;
  const estCalls = pending * Math.max(1, Math.ceil(Math.min(OA_CFG.maxWorks, 150) / 200)) + (OA_CFG.nameCandidates ? pending * 10 * 0.3 : 0);
  if (!OA_CFG.apiKey && estCalls > 700 && !confirm(`Sin API key, OpenAlex permite unas 1,000 consultas al día y esta corrida necesita aproximadamente ${Math.round(estCalls)}. Es probable que se agote el presupuesto a mitad de camino.\n\nRecomendado: crea una key gratuita en openalex.org/settings/api y pégala en el campo.\n\n¿Continuar de todos modos?`)) return;
  oaAbort = new AbortController(); const signal = oaAbort.signal;
  const list = working();
  $("oalog").textContent = ""; $("oabar").style.width = "0";
  $("oaBtn").disabled = true; $("oaStop").disabled = false; $("start").disabled = true;
  const net0 = {...NET};
  const stats = () => {
    const done = list.filter(R => R.sources.openalex);
    $("oDone").textContent = done.length;
    $("oMatched").textContent = done.filter(R => R.sources.openalex.author).length;
    $("oMissing").textContent = done.filter(R => !R.sources.openalex.author).length;
    $("oDisc").textContent = done.filter(R => R.discrepancies?.length).length;
    $("oCache").textContent = NET.cacheHits - net0.cacheHits; $("oRetry").textContent = NET.retries - net0.retries;
  };
  try {
    log("oalog", `Consultando OpenAlex para ${list.length} profesores (${OA_CFG.apiKey ? "con API key" : "SIN API key: presupuesto diario muy limitado"})…`);
    let fatal = null;
    let n = 0;
    await pool(list, 4, async R => {
      try { await OPENALEX.enrich(R, signal); }
      catch(e){
        if (signal.aborted) return;
        if (e.budget || e.auth){
          if (!fatal){
            fatal = e;
            log("oalog", e.budget
              ? `✗ OpenAlex: se agotó el presupuesto diario de consultas${OA_CFG.apiKey ? " de tu API key" : " sin API key"}. ${OA_CFG.apiKey ? "Se renueva a medianoche UTC (8:00 p.m. en Puerto Rico); lo ya descargado queda en caché." : "Crea una key gratuita en openalex.org/settings/api, pégala arriba y vuelve a pulsar «Enriquecer». Lo ya descargado queda en caché."}`
              : `✗ OpenAlex rechazó la API key (HTTP ${e.status}). Verifica que la copiaste completa en openalex.org/settings/api.`);
            if (e.body) log("oalog", `  Respuesta de OpenAlex: ${e.body}`);
            oaAbort.abort();
          }
          return;
        }
        log("oalog", `  ✗ ${R.orcid} (${fullName(R)}): ${e.message}`);
      }
      n++; $("oabar").style.width = Math.round(85*n/list.length) + "%"; stats();
    }, signal);
    log("oalog", "Generando perfiles de capacidad…");
    await buildAllProfiles(list, i => $("oabar").style.width = Math.round(85 + 15*i/list.length) + "%");
    $("oabar").style.width = "100%"; stats();
    log("oalog", (signal.aborted ? "Detenido. " : "✓ ") + `${$("oMatched").textContent} vinculados por ORCID · ${$("oMissing").textContent} sin perfil · ${$("oDisc").textContent} con discrepancias.`);
  } catch(e){ log("oalog", "✗ Error: " + e.message); console.error(e); }
  finally { $("oaStop").disabled = true; $("start").disabled = false; await persistAndRefresh(); }
};
$("oaStop").onclick = () => oaAbort?.abort();
$("oaClear").onclick = () => { CACHE.clear(); refreshCacheInfo(); log("oalog", "Caché vaciada."); };

/* ---------- 3. Financiamiento (NIH RePORTER, NSF Awards) ---------- */
$("fundBtn").onclick = async () => {
  FUND_CFG.since = clamp(Number($("fundSince").value) || CURRENT_YEAR - 15, 1985, CURRENT_YEAR);
  FUND_CFG.includeMedium = $("fundMedium").checked;
  const svcs = [["nih", NIH, "fNih"], ["nsf", NSF, "fNsf"]].filter(([k]) => $(k === "nih" ? "fundNih" : "fundNsf").checked);
  if (!svcs.length){ alert("Selecciona al menos una fuente."); return; }
  fundAbort = new AbortController(); const signal = fundAbort.signal, list = working();
  $("flog").textContent = ""; $("fbar").style.width = "0";
  $("fundBtn").disabled = true; $("fundStop").disabled = false;
  try {
    for (const [i, [k, mod, statId]] of svcs.entries()){
      if (signal.aborted) break;
      log("flog", `Descargando proyectos ${k.toUpperCase()} de Puerto Rico desde ${FUND_CFG.since}…`);
      try {
        const awards = await mod.harvest(FUND_CFG.since, signal, (n, label) => { $("fbar").style.width = Math.round(100*(i + 0.5)/svcs.length) + "%"; $("fundMode").textContent = `${label}: ${n} registros`; });
        $(statId).textContent = awards.length;
        STATE.fundingTotals = { ...(STATE.fundingTotals || {}), [k]: fundingTotals(awards, FUND_CFG.since) };
        const r = matchAwards(k, awards, list);
        log("flog", `  ${awards.length} proyectos de la UPR · ${r.matched} vínculos únicos · ${r.ambiguous} ambiguos`);
      } catch(e){
        if (signal.aborted) break;
        log("flog", `  ✗ ${k.toUpperCase()}: ${e.message}`);
      }
      $("fbar").style.width = Math.round(100*(i+1)/svcs.length) + "%";
    }
    const all = list.flatMap(R => ["nih","nsf"].flatMap(k => R.sources[k]?.awards || []));
    $("fMatched").textContent = all.filter(a => a.match.level === "high").length;
    $("fMedium").textContent = all.filter(a => a.match.level === "medium").length;
    $("fAmb").textContent = all.filter(a => a.match.level === "ambiguous").length;
    log("flog", "Actualizando perfiles de capacidad…");
    await buildAllProfiles(list);
    $("fPeople").textContent = list.filter(R => R.capacity?.funding_record?.total_awards).length;
    log("flog", signal.aborted ? "Detenido." : "✓ Listo. Revisa en cada ficha los vínculos marcados como \"verificar\".");
  } catch(e){ log("flog", "✗ Error: " + e.message); console.error(e); }
  finally { $("fundStop").disabled = true; await persistAndRefresh(); }
};
$("fundStop").onclick = () => fundAbort?.abort();
$("fundMedium").addEventListener("change", async () => { FUND_CFG.includeMedium = $("fundMedium").checked; if (!STORE.isLight() && working().some(R => R.sources.nih || R.sources.nsf)){ await buildAllProfiles(working()); await persistAndRefresh(); } });

/* ---------- Mapa por recinto ---------- */
["mapMetric","mapCat","mapFilter","mapLinks"].forEach(id => $(id).addEventListener("input", () => { $("heatList").innerHTML = ""; renderCampusMap(); }));

/* ---------- navegación y eventos globales ---------- */
document.addEventListener("click", e => {
  const t = e.target.closest("[data-goto],[data-q],[data-heat],[data-mapq],[data-campus]"); if (!t) return;
  if (t.dataset.heat){ const [cap, campus] = t.dataset.heat.split("||"); renderHeatList(cap, campus); $("heatList").scrollIntoView({behavior:"smooth", block:"nearest"}); return; }
  if (t.dataset.mapq){ renderHeatList(t.dataset.mapq, t.dataset.mapcampus, t.dataset.mapcat); $("heatList").scrollIntoView({behavior:"smooth", block:"nearest"}); return; }
  if (t.dataset.campus){ MAPV.selected = t.dataset.campus; renderCampusMap(); return; }
  if (t.dataset.q){ $("q").value = t.dataset.q; renderQuery(t.dataset.q); return; }
  if (t.dataset.goto) location.hash = `#/investigador/${encodeURIComponent(t.dataset.goto)}/capacidades`;
});
$("qBtn").onclick = () => renderQuery($("q").value);
$("q").addEventListener("keydown", e => { if (e.key === "Enter") renderQuery($("q").value); });
["aggDim","aggCat","aggMin"].forEach(id => $(id).addEventListener("input", renderAgg));
$("topSearch").addEventListener("submit", e => { e.preventDefault(); const q = $("topQ").value.trim(); if (q) location.hash = `#/buscar?q=${encodeURIComponent(q)}`; });
$("heroSearch").addEventListener("submit", e => { e.preventDefault(); const q = $("heroQ").value.trim(); location.hash = q ? `#/buscar?q=${encodeURIComponent(q)}` : "#/inicio"; });
$("burger").onclick = () => $("app").classList.toggle("nav-open");
$("logout").onclick = async () => { await AUTH.logout(); STATE.researchers.clear(); invalidateSys(); location.hash = "#/"; };
$("reqAccess").onclick = () => alert(APP_CONFIG.accessContact
  ? `Para solicitar la contraseña de acceso escribe a ${APP_CONFIG.accessContact}.`
  : "Para obtener la contraseña de acceso, solicítala al administrador de la plataforma.");
$("viewerForm").addEventListener("submit", async e => {
  e.preventDefault(); $("gateErr").textContent = "Verificando…"; const r = await AUTH.viewer($("viewerPw").value); $("viewerPw").value = "";
  if (!r.ok){ $("gateErr").textContent = r.msg; return; }
  $("gateErr").textContent = ""; await loadData(); location.hash = $("gate").dataset.next || "#/inicio";
});
$("adminForm").addEventListener("submit", async e => {
  e.preventDefault(); $("gateErr").textContent = "Verificando…"; const r = await AUTH.admin($("admUser").value.trim(), $("admPass").value); $("admPass").value = "";
  if (!r.ok){ $("gateErr").textContent = r.msg; return; }
  $("gateErr").textContent = ""; await loadData(); location.hash = $("gate").dataset.next || "#/admin";
});
window.addEventListener("hashchange", route);
let resizeT; window.addEventListener("resize", () => { clearTimeout(resizeT); resizeT = setTimeout(() => { const r = parseHash().name; if (["inicio","analitica"].includes(r)) route(); }, 250); });

/* ---------- exportar / importar / datos guardados ---------- */
$("dlCsv").onclick = () => downloadProfessorsCSV(researchers(), STATE.label);
$("dlCap").onclick = () => downloadCapacitiesCSV(researchers(), STATE.label);
$("dlJson").onclick = () => downloadCapacityJSON(researchers(), STATE.label);
$("impBtn").onclick = () => $("impFile").click();
$("impFile").onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const obj = JSON.parse(await f.text());
    if (APP_CONFIG.backend !== "local" && !confirm(`Se cargarán ${obj.researchers?.length ?? 0} investigadores desde «${f.name}»${obj.label ? ` (${obj.label})` : ""} y se publicarán como la versión vigente${CAMPUSES.some(c => c.name === obj.label) ? ` del recinto ${obj.label}` : ", reemplazando la versión publicada completa"}.\n\n¿Continuar?`)){ e.target.value = ""; return; }
    const n = importCapacityJSON(obj); log("log", `Importados ${n} profesores desde ${f.name}.`); await persistAndRefresh(); }
  catch(err){ alert("No se pudo importar: " + err.message); }
  e.target.value = "";
};
$("saveNow").onclick = async () => {
  if (STORE.isLight()){ alert("Los datos cargados son la versión publicada. Para publicar una versión nueva, ejecuta primero la búsqueda en ORCID (paso 1)."); return; }
  if (!STATE.researchers.size){ alert("No hay datos para publicar."); return; }
  await persistAndRefresh();
};
$("clearData").onclick = async () => {
  if (!confirm("¿Borrar la copia de trabajo guardada en este navegador? Los datos publicados en la base de datos no se borran.")) return;
  await STORE.clear(); refreshAll();
};

/* ---------- arranque ---------- */
(async () => {
  if (APP_CONFIG.backend !== "local") await AUTH.validate();
  if (AUTH.canView()) await loadData();
  updateButtons(); refreshCacheInfo(); campusButtons();
  route();
})();

/* ---------- Respaldo completo ---------- */
$("backupBtn").onclick = async () => {
  if (APP_CONFIG.backend === "local"){ downloadCapacityJSON(researchers(), STATE.label); return; }
  const b = $("backupBtn"); b.disabled = true;
  try {
    const data = await STORE.backup((n, t) => setPub(`Preparando respaldo: ${n} de ${t} investigadores…`));
    saveBlob(new Blob([JSON.stringify(data)], { type: "application/json" }), `upr_respaldo_${slug(data.label || "upr")}_${new Date().toISOString().slice(0,10)}.json`);
    setPub(`✓ Respaldo descargado: ${data.researchers.length} investigadores (${data.label}). Para restaurarlo usa «Restaurar / importar JSON…».`);
  } catch(e){ setPub(`✗ No se pudo generar el respaldo: ${e.message}`); if (e instanceof AuthError) alert(e.message); }
  finally { b.disabled = false; }
};

/* ---------- Diagnóstico y adición manual por ORCID iD ---------- */
let DIAG = null;
$("diagBtn").onclick = async () => {
  const out = $("diagOut"), id = ($("diagId").value.match(/\d{4}-\d{4}-\d{4}-\d{3}[\dXx]/) || [])[0]?.toUpperCase();
  if (!id){ out.innerHTML = `<p class="note" style="color:#c0352f">Escribe un ORCID iD válido (por ejemplo 0000-0003-4787-2239).</p>`; return; }
  out.innerHTML = `<p class="note">Consultando ORCID…</p>`;
  try {
    const [srch, emps] = await Promise.all([getJSON(`${API}/expanded-search/?q=${encodeURIComponent("orcid:" + id)}`), ORCID.employments(id)]);
    let p = srch?.["expanded-result"]?.[0];
    if (!p){ const rec = await ORCID.record(id); const n = rec?.person?.name || {};
      p = { "orcid-id": id, "given-names": n["given-names"]?.value || "", "family-names": n["family-names"]?.value || "", "institution-name": [] }; }
    let roleRe = null; try { roleRe = new RegExp($("roleRegex").value, "i"); } catch {}
    const onlyFac = $("onlyFaculty").checked, includeNoRole = $("includeNoRole").checked, onlyCurrent = $("onlyCurrent").checked;
    const rows = emps.map(e => { const upr = isUPR(e.org); return { ...e, upr, campus: upr ? detectCampus(e.org, e.city).name : "",
      roleOK: !onlyFac || (e.role ? !!roleRe?.test(e.role) : includeNoRole), currentOK: !onlyCurrent || !e.end }; });
    const upr = rows.filter(r => r.upr), passing = upr.filter(r => r.roleOK && r.currentOK);
    const reasons = [];
    if (!emps.length) reasons.push("No tiene empleos <b>públicos</b> en ORCID (no declaró empleos o los tiene como privados). La plataforma solo puede usar lo que es público.");
    else if (!upr.length) reasons.push(`Ninguno de sus empleos públicos es de la UPR: ${rows.map(r => esc(r.org)).join("; ")}.`);
    for (const r of upr){
      if (onlyCurrent && r.end) reasons.push(`Su empleo en <b>${esc(r.org)}</b> tiene fecha de terminación (${esc(r.end)}) y está marcado «Solo empleos actuales».`);
      if (onlyFac && !r.role && !includeNoRole) reasons.push(`Su empleo en <b>${esc(r.org)}</b> no indica cargo y «Incluir empleos UPR sin cargo» está desmarcado.`);
      if (onlyFac && r.role && !r.roleOK) reasons.push(`Su cargo «${esc(r.role)}» no coincide con la expresión de cargos docentes.`);
      if (r.campus === GENERAL.name) reasons.push(`La organización es «${esc(r.org)}» sin recinto${r.city ? ` (ciudad: ${esc(r.city)})` : ""}: queda como «${GENERAL.name}» y la búsqueda por recinto no lo incluye. Usa «Todo el sistema UPR» o la búsqueda amplia.`);
    }
    const inst = p["institution-name"] || [];
    if (upr.length && !inst.some(isUPR)) reasons.push("El índice de búsqueda de ORCID no lo asocia a la UPR, así que la búsqueda por afiliación no lo devuelve aunque su empleo sea de la UPR.");
    const already = STATE.researchers.get(id);
    const camp = uniq(passing.map(r => r.campus))[0] || uniq(upr.map(r => r.campus))[0] || GENERAL.name;
    DIAG = { p, id, emps: (passing.length ? passing : upr) };
    out.innerHTML = `<div class="card" style="box-shadow:none;margin-top:10px">
      <h3 style="margin-top:0">${esc(`${p["given-names"] || ""} ${p["family-names"] || ""}`.trim() || id)} <a class="note" href="https://orcid.org/${id}" target="_blank" rel="noopener">${id}</a></h3>
      ${already ? `<p class="note">✓ Ya está en la plataforma (${esc(already.affiliation.campus)}).</p>` : ""}
      <table class="mini"><thead><tr><th>Organización</th><th>Cargo</th><th>Fechas</th><th>UPR / recinto</th><th>Pasa filtros</th></tr></thead><tbody>
      ${rows.map(r => `<tr><td>${esc(r.org)}${r.dept ? `<br><small>${esc(r.dept)}</small>` : ""}</td><td>${esc(r.role || "—")}</td><td>${esc(r.start || "?")} – ${esc(r.end || "actual")}</td>
        <td>${r.upr ? esc(r.campus) : "no"}</td><td>${r.upr && r.roleOK && r.currentOK ? "✓" : "✗"}</td></tr>`).join("") || `<tr><td colspan="5" class="note">Sin empleos públicos</td></tr>`}</tbody></table>
      <p class="note"><b>Índice de búsqueda de ORCID:</b> ${inst.length ? inst.map(esc).join("; ") : "sin instituciones"}</p>
      ${reasons.length ? `<div class="notice"><b>Por qué no aparece:</b><ul>${uniq(reasons).map(r => `<li>${r}</li>`).join("")}</ul></div>` : (already ? "" : `<p class="note">Pasa todos los filtros; debería aparecer al cosechar su recinto (${esc(camp)}).</p>`)}
      ${AUTH.isAdmin() || APP_CONFIG.backend === "local" ? `<div class="row" style="margin-top:10px"><label class="note">Recinto: <select id="diagCampus">${[...CAMPUSES, GENERAL].map(c => `<option ${c.name === (already?.affiliation.campus || camp) ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label>
        <button class="primary" id="diagAdd" type="button">${already ? "Actualizar en la plataforma" : "Añadir a la plataforma"}</button></div>
        <p class="note">Se publica de inmediato y se conserva en futuras cosechas de su recinto. Después ejecuta los pasos 2 y 3 para completar su perfil.</p>` : ""}
    </div>`;
    const add = $("diagAdd"); if (add) add.onclick = addManual;
  } catch(e){ out.innerHTML = `<p class="note" style="color:#c0352f">No se pudo consultar ORCID: ${esc(e.message)}</p>`; }
};
async function addManual(){
  if (!DIAG) return;
  const campus = $("diagCampus").value, { p, id } = DIAG;
  const emps = DIAG.emps.map(e => ({ ...e, campus }));
  const R = makeResearcher(p, campus, emps.length ? emps : null, emps.length ? null : ["University of Puerto Rico"]);
  R.manual = { added: nowISO(), by: "admin" };
  if (!working().length) STATE.scope = "Adición manual";
  STATE.researchers.set(id, R);
  $("diagOut").insertAdjacentHTML("beforeend", `<p class="note">Añadiendo y publicando…</p>`);
  await persistAndRefresh();
  $("diagOut").insertAdjacentHTML("beforeend", `<p class="note">✓ ${esc(fullName(R))} quedó en la plataforma (${esc(campus)}). Ejecuta el paso 2 (OpenAlex) y el 3 (financiamiento) para completar su perfil.</p>`);
}
