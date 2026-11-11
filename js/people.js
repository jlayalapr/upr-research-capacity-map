"use strict";
/* =====================================================================
   SEGUIMIENTO DE PERSONAS
   Tipo automático según el cargo declarado en ORCID:
     Docente → el cargo coincide con FACULTY_RE (profesor, catedrático, instructor…)
     Otro    → director, investigador, researcher, scientist, sin cargo, etc. (por verificar)
   El administrador puede fijar un ESTADO por persona (que corrige el tipo),
   añadir correos y notas. Todo se guarda en Supabase por ORCID, así que se
   conserva entre cosechas. Los visitantes solo reciben el estado.
   ===================================================================== */
const FACULTY_RE = /profes|prof\.|catedr|instructor|lecturer|conferenciante|faculty|docente|teacher|maestr/i;
const ESTADOS = ["Pendiente","Docente confirmado","Investigador (no docente)","Estudiante / postdoc","Administrativo","Ya no está en la UPR"];
const PEOPLE = {
  notes: new Map(), loaded: false,
  async load(){
    this.notes.clear(); this.loaded = false;
    try {
      const rows = APP_CONFIG.backend === "local" ? (await IDB.get("people") || []) : (await SB.rpc("api_get_people", { p_session: AUTH.token }) || []);
      for (const r of rows) this.notes.set(r.orcid, r);
      this.loaded = true;
    } catch(e){ console.warn("people", e); }
  },
  async set(orcid, patch){
    const cur = this.notes.get(orcid) || { orcid, estado: null, emails: [], note: "" };
    const n = { ...cur, ...patch };
    if (APP_CONFIG.backend === "local"){ this.notes.set(orcid, n); await IDB.put("people", [...this.notes.values()]); return n; }
    const r = await SB.rpc("api_set_person", { p_session: AUTH.token, p_orcid: orcid, p_estado: n.estado || "", p_emails: n.emails || [], p_note: n.note || "" });
    this.notes.set(orcid, { ...n, ...r }); return this.notes.get(orcid);
  },
};
function autoType(R){ return FACULTY_RE.test(R.affiliation?.role || "") ? "docente" : "otro"; }
function personType(R){
  const e = PEOPLE.notes.get(R.orcid)?.estado;
  if (e === "Docente confirmado") return "docente";
  if (e && e !== "Pendiente") return "otro";
  return autoType(R);
}
const TYPE_LABEL = { docente: "Docente", otro: "Otro (por verificar)" };
function emailsOf(R){ return uniq([...(R.identity?.emails || []), ...(PEOPLE.notes.get(R.orcid)?.emails || [])].map(s => String(s).trim().toLowerCase()).filter(Boolean)); }

/* ---------------- vista Seguimiento (solo admin) ---------------- */
const SEG = { tab: "docente", campus: "", q: "", estado: "", noEmail: false, page: 0, per: 50 };
function viewSeguimiento(el){
  const list = researchers(), n = { docente: 0, otro: 0 };
  for (const R of list) n[personType(R)]++;
  const campuses = uniq(list.flatMap(campusOf)).sort();
  el.innerHTML = head(`${icon("users")} Seguimiento`, "Seguimiento de docentes y otros investigadores",
    "Docentes para dar seguimiento a sus propuestas, y otros perfiles para verificar con los recintos. Los correos, estados y notas solo los ve el administrador.",
    `<span class="seg" id="segTab"><button data-t="docente" class="${SEG.tab === "docente" ? "on" : ""}">Docentes (${fmt(n.docente)})</button><button data-t="otro" class="${SEG.tab === "otro" ? "on" : ""}">Otros por verificar (${fmt(n.otro)})</button></span>`)
    + (!list.length ? emptyState() : `
    <div class="filters">
      <input type="search" id="segQ" placeholder="Buscar por nombre, departamento, cargo o correo…" value="${esc(SEG.q)}">
      <select id="segCampus"><option value="">Todos los recintos</option>${campuses.map(c => `<option ${c === SEG.campus ? "selected" : ""}>${esc(c)}</option>`).join("")}</select>
      <select id="segEstado"><option value="">Cualquier estado</option><option value="__none" ${SEG.estado === "__none" ? "selected" : ""}>Sin revisar</option>${ESTADOS.map(s => `<option ${s === SEG.estado ? "selected" : ""}>${esc(s)}</option>`).join("")}</select>
      <label class="note"><input type="checkbox" id="segNoEmail" ${SEG.noEmail ? "checked" : ""}> Solo sin correo</label>
      <button type="button" id="segCopy">Copiar correos</button><button type="button" id="segCsv">Descargar CSV</button>
    </div>
    ${PEOPLE.loaded ? "" : `<div class="notice">No se pudieron cargar los estados y correos guardados. Recarga la página.</div>`}
    <p class="note" id="segCount"></p><div id="segList" class="tablewrap" style="max-height:none"></div><div class="pager" id="segPager"></div>
    <p class="note">El tipo es automático según el cargo en ORCID (Docente: profesor, catedrático, instructor, lecturer, faculty…). Al elegir un estado se corrige: «Docente confirmado» lo pasa a Docentes; cualquier otro estado lo deja en Otros. Los cambios se guardan solos y se conservan aunque vuelvas a cosechar.</p>`);
  $("segTab").onclick = e => { const b = e.target.closest("button"); if (!b) return; SEG.tab = b.dataset.t; SEG.page = 0; viewSeguimiento(el); };
  if (!list.length) return;
  const bind = (id, k, ev = "input", get = e => e.target.value) => $(id).addEventListener(ev, e => { SEG[k] = get(e); SEG.page = 0; drawSeg(); });
  bind("segQ", "q"); bind("segCampus", "campus"); bind("segEstado", "estado"); bind("segNoEmail", "noEmail", "change", e => e.target.checked);
  $("segCopy").onclick = async () => { const mails = uniq(segFiltered().flatMap(emailsOf));
    try { await navigator.clipboard.writeText(mails.join("; ")); $("segCount").textContent = `✓ ${fmt(mails.length)} correos copiados (separados por «;»), listos para pegar en CCO.`; }
    catch { prompt("Copia los correos:", mails.join("; ")); } };
  $("segCsv").onclick = () => segCSV(segFiltered());
  $("segPager").onclick = e => { const b = e.target.closest("[data-pg]"); if (!b) return; SEG.page = Number(b.dataset.pg); drawSeg(); window.scrollTo({ top: 0, behavior: "smooth" }); };
  drawSeg();
}
function segFiltered(){
  const q = norm(SEG.q);
  return researchers().filter(R => personType(R) === SEG.tab && (!SEG.campus || campusOf(R).includes(SEG.campus))
    && (!SEG.estado || (SEG.estado === "__none" ? !PEOPLE.notes.get(R.orcid)?.estado : PEOPLE.notes.get(R.orcid)?.estado === SEG.estado))
    && (!SEG.noEmail || !emailsOf(R).length)
    && (!q || norm([fullName(R), R.affiliation.dept, R.affiliation.role, R.affiliation.campus, R.orcid, ...emailsOf(R), PEOPLE.notes.get(R.orcid)?.note || ""].join(" ")).includes(q)))
    .sort((a, b) => a.affiliation.campus.localeCompare(b.affiliation.campus, "es") || (a.identity.family + a.identity.given).localeCompare(b.identity.family + b.identity.given, "es"));
}
function drawSeg(){
  const list = segFiltered(), pages = Math.max(1, Math.ceil(list.length / SEG.per)); SEG.page = Math.min(SEG.page, pages - 1);
  const slice = list.slice(SEG.page * SEG.per, (SEG.page + 1) * SEG.per);
  const withMail = list.filter(R => emailsOf(R).length).length;
  $("segCount").textContent = `${fmt(list.length)} persona(s) · ${fmt(withMail)} con correo · ${fmt(list.length - withMail)} sin correo`;
  $("segList").innerHTML = !slice.length ? `<div class="empty"><b>Nadie coincide con los filtros.</b></div>` : `<table class="mini seg-table"><thead><tr>
    <th>Persona</th><th>Recinto</th><th>Cargo y departamento (ORCID)</th><th>Correos</th><th>Estado</th><th>Nota</th></tr></thead><tbody>
    ${slice.map(R => { const N = PEOPLE.notes.get(R.orcid) || {}, orc = R.identity.emails || [], m = R.sources.openalex?.metrics;
      return `<tr data-o="${esc(R.orcid)}"><td><a href="#/investigador/${esc(R.orcid)}"><b>${esc(fullName(R))}</b></a><br><small><a href="https://orcid.org/${esc(R.orcid)}" target="_blank" rel="noopener">${esc(R.orcid)}</a>${m ? ` · ${fmt(m.publications)} pubs` : ""}${R.manual ? " · añadido a mano" : ""}</small></td>
        <td>${esc(R.affiliation.campus)}</td><td>${esc(R.affiliation.role || "—")}<br><small>${esc(R.affiliation.dept || "")}</small></td>
        <td>${orc.length ? `<small title="Correo público en ORCID">${orc.map(esc).join("<br>")}</small><br>` : ""}<input type="text" class="seg-mail" placeholder="añadir correo(s)" value="${esc((N.emails || []).join(", "))}"></td>
        <td><select class="seg-estado"><option value="">— Sin revisar (${TYPE_LABEL[autoType(R)]}) —</option>${ESTADOS.map(s => `<option ${s === N.estado ? "selected" : ""}>${esc(s)}</option>`).join("")}</select></td>
        <td><input type="text" class="seg-note" placeholder="nota" value="${esc(N.note || "")}"><small class="seg-st"></small></td></tr>`; }).join("")}</tbody></table>`;
  $("segList").querySelectorAll("tr[data-o]").forEach(tr => {
    const o = tr.dataset.o, st = tr.querySelector(".seg-st");
    const save = async () => {
      const emails = tr.querySelector(".seg-mail").value.split(/[,;\s]+/).filter(Boolean);
      const bad = emails.find(x => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x));
      if (bad){ st.textContent = ` ✗ correo inválido: ${bad}`; return; }
      st.textContent = " guardando…";
      try { await PEOPLE.set(o, { estado: tr.querySelector(".seg-estado").value || null, emails, note: tr.querySelector(".seg-note").value });
        st.textContent = " ✓ guardado"; invalidateSys(); }
      catch(e){ st.textContent = ` ✗ ${e.message}`; }
    };
    tr.querySelectorAll("input, select").forEach(x => x.addEventListener("change", save));
  });
  $("segPager").innerHTML = pages > 1 ? `<button data-pg="${SEG.page-1}" ${SEG.page ? "" : "disabled"}>‹ Anterior</button><span class="note">Página ${SEG.page+1} de ${pages}</span><button data-pg="${SEG.page+1}" ${SEG.page < pages-1 ? "" : "disabled"}>Siguiente ›</button>` : "";
}
function segCSV(list){
  const q = v => { const s = String(v ?? ""); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const h = ["nombre","orcid","tipo","estado","recinto","departamento","cargo_orcid","correos","nota","publicaciones","citas","h_index","fondos_nih_nsf","añadido_a_mano"];
  const lines = [h.join(",")].concat(list.map(R => { const N = PEOPLE.notes.get(R.orcid) || {}, m = R.sources.openalex?.metrics || {};
    return [fullName(R), R.orcid, TYPE_LABEL[personType(R)], N.estado || "Sin revisar", R.affiliation.campus, R.affiliation.dept, R.affiliation.role, emailsOf(R).join("; "),
      N.note || "", m.publications ?? "", m.citations ?? "", m.h_index ?? "", Math.round(R.capacity?.funding_record?.total_amount || 0), R.manual ? "sí" : ""].map(q).join(","); }));
  saveBlob(new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" }),
    `upr_${SEG.tab === "docente" ? "docentes" : "otros_por_verificar"}${SEG.campus ? "_" + slug(SEG.campus) : ""}_${new Date().toISOString().slice(0,10)}.csv`);
}
ROUTES.seguimiento = viewSeguimiento;
