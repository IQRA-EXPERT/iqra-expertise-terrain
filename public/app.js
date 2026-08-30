const API = "/api";
const state = { user: null, role: null, agentName: "", dossiers: [], requisitions: [], users: [], activeDossierId: null, editing: null, previewMode: false, watchId: null, tickInterval: null, newRequisition: null, managingUsers: false, filterAgent: "", filterStatut: "", editingUserId: null, openMaps: {} };

function showConfirm(message) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `<div class="modal-box">
      <div class="modal-msg"></div>
      <div class="btn-row" style="margin-top:14px;justify-content:flex-end">
        <button type="button" class="modal-cancel">Annuler</button>
        <button type="button" class="accent modal-ok">Confirmer</button>
      </div>
    </div>`;
    overlay.querySelector(".modal-msg").textContent = message;
    document.body.appendChild(overlay);
    const cleanup = (result) => { document.body.removeChild(overlay); resolve(result); };
    overlay.querySelector(".modal-cancel").onclick = () => cleanup(false);
    overlay.querySelector(".modal-ok").onclick = () => cleanup(true);
    overlay.onclick = (e) => { if (e.target === overlay) cleanup(false); };
  });
}
function showAlert(message) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `<div class="modal-box">
      <div class="modal-msg"></div>
      <div class="btn-row" style="margin-top:14px;justify-content:flex-end">
        <button type="button" class="accent modal-ok">OK</button>
      </div>
    </div>`;
    overlay.querySelector(".modal-msg").textContent = message;
    document.body.appendChild(overlay);
    const cleanup = () => { document.body.removeChild(overlay); resolve(); };
    overlay.querySelector(".modal-ok").onclick = cleanup;
    overlay.onclick = (e) => { if (e.target === overlay) cleanup(); };
  });
}
function esc(s) {
  return (s == null ? "" : String(s)).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const nowISO = () => new Date().toISOString();
const fmtTime = (iso) => (iso ? new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—");
function fmtDuration(ms) {
  if (!ms || ms < 0) return "0 min";
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), s = Math.floor((ms % 60000) / 1000);
  return h > 0 ? `${h} h ${m} min` : m > 0 ? `${m} min ${s} s` : `${s} s`;
}
function locateWithFallback(onSuccess, onError) {
  navigator.geolocation.getCurrentPosition(
    onSuccess,
    (e) => {
      if (e.code === e.TIMEOUT) {
        navigator.geolocation.getCurrentPosition(onSuccess, onError, { enableHighAccuracy: false, timeout: 30000, maximumAge: 60000 });
      } else {
        onError(e);
      }
    },
    { enableHighAccuracy: true, timeout: 15000 }
  );
}
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000, toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
// Miroir client de toUTM() côté serveur (server.js) — permet un affichage immédiat sans aller-retour serveur.
function toUTM(lat, lon) {
  const a = 6378137.0, eccSq = 0.00669438, k0 = 0.9996;
  const radLat = (lat * Math.PI) / 180, radLon = (lon * Math.PI) / 180;
  const zone = Math.floor((lon + 180) / 6) + 1;
  const radLonOrigin = (((zone - 1) * 6 - 180 + 3) * Math.PI) / 180;
  const eccP = eccSq / (1 - eccSq);
  const N = a / Math.sqrt(1 - eccSq * Math.sin(radLat) ** 2);
  const T = Math.tan(radLat) ** 2, C = eccP * Math.cos(radLat) ** 2, A = Math.cos(radLat) * (radLon - radLonOrigin);
  const M =
    a *
    ((1 - eccSq / 4 - (3 * eccSq * eccSq) / 64 - (5 * Math.pow(eccSq, 3)) / 256) * radLat -
      ((3 * eccSq) / 8 + (3 * eccSq * eccSq) / 32 + (45 * Math.pow(eccSq, 3)) / 1024) * Math.sin(2 * radLat) +
      ((15 * eccSq * eccSq) / 256 + (45 * Math.pow(eccSq, 3)) / 1024) * Math.sin(4 * radLat) -
      ((35 * Math.pow(eccSq, 3)) / 3072) * Math.sin(6 * radLat));
  let easting = k0 * N * (A + ((1 - T + C) * Math.pow(A, 3)) / 6 + ((5 - 18 * T + T * T + 72 * C - 58 * eccP) * Math.pow(A, 5)) / 120) + 500000;
  let northing =
    k0 *
    (M +
      N *
        Math.tan(radLat) *
        ((A * A) / 2 + ((5 - T + 9 * C + 4 * C * C) * Math.pow(A, 4)) / 24 + ((61 - 58 * T + T * T + 600 * C - 330 * eccP) * Math.pow(A, 6)) / 720));
  if (lat < 0) northing += 10000000;
  return { zone, hemisphere: lat >= 0 ? "N" : "S", easting: Math.round(easting), northing: Math.round(northing) };
}
function utmString(pt) {
  if (!pt || pt.lat == null) return "";
  const u = toUTM(pt.lat, pt.lon);
  return `Zone ${u.zone}${u.hemisphere} — E ${u.easting} m, N ${u.northing} m`;
}
function mapEmbed(key, lat, lon) {
  if (!state.openMaps[key]) return "";
  const d = 0.003;
  const bbox = `${(lon - d).toFixed(6)}%2C${(lat - d).toFixed(6)}%2C${(lon + d).toFixed(6)}%2C${(lat + d).toFixed(6)}`;
  const src = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat}%2C${lon}`;
  return `<iframe class="osm-embed" src="${src}" style="width:100%;height:220px;border:0;border-radius:8px;margin:8px 0" loading="lazy"></iframe>`;
}
function gpsCoordsTable(d) {
  const pts = [];
  if (d.lat != null) pts.push({ label: "Position centrale du site", lat: d.lat, lon: d.lon });
  const a = d.gpsAngles || {};
  [["P1", "Point P1"], ["P2", "Point P2"], ["P3", "Point P3"], ["P4", "Point P4"], ["Centre", "Centre de la parcelle"]].forEach(([k, label]) => {
    if (a[k]) pts.push({ label, lat: a[k].lat, lon: a[k].lon });
  });
  if (!pts.length) return "";
  const rows = pts
    .map((p) => {
      const u = toUTM(p.lat, p.lon);
      return `<tr><td>${esc(p.label)}</td><td>${p.lat.toFixed(6)}, ${p.lon.toFixed(6)}</td><td>Zone ${u.zone}${u.hemisphere} — E ${u.easting} m, N ${u.northing} m</td></tr>`;
    })
    .join("");
  return `<div class="card"><div style="font-weight:600;font-size:13px;margin-bottom:6px">Tableau des coordonnées GPS</div>
    <table class="info-table gps-coords-table"><tr><td style="font-weight:600">Point</td><td style="font-weight:600">Latitude / Longitude</td><td style="font-weight:600">UTM (WGS84)</td></tr>${rows}</table>
  </div>`;
}

async function api(path, opts) {
  const res = await fetch(API + path, { headers: { "Content-Type": "application/json" }, ...opts });
  if (res.status === 401 && path !== "/login") {
    state.user = null; state.role = null; state.agentName = "";
    render();
    throw new Error("Session expirée, veuillez vous reconnecter.");
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Erreur serveur" }));
    throw new Error(err.error || "Erreur serveur");
  }
  return res.json();
}
async function loadAll() {
  state.requisitions = await api("/requisitions");
  state.dossiers = await api("/dossiers");
  if (state.role === "expert") state.users = await api("/users");
}
async function saveDossier(d) {
  const saved = await api("/dossiers", { method: "POST", body: JSON.stringify(d) });
  const idx = state.dossiers.findIndex((x) => x.id === saved.id);
  if (idx >= 0) state.dossiers[idx] = saved; else state.dossiers.push(saved);
  return saved;
}

function emptyRequisition() {
  return { referenceDossier: "", clientNom: "", clientTelephone: "", clientEmail: "", mandantType: "Banque", mandantNom: "", mandantTelephone: "", siteIndicatif: "", instructionsExpert: "" };
}
function emptyDossier(req) {
  return {
    requisitionId: req ? req.id : null, agentName: state.agentName, dateVisite: new Date().toISOString().slice(0, 10),
    numeroRapport: "", nomSite: req ? req.siteIndicatif : "",
    typeMission: req && req.mandantType === "Banque" ? "Garantie bancaire" : "Autre",
    demandeur: req ? (req.mandantNom || req.clientNom) : "", clientNom: req ? req.clientNom : "", clientTelephone: req ? req.clientTelephone : "",
    mandantType: req ? req.mandantType : "", mandantNom: req ? req.mandantNom : "", referenceDossier: req ? req.referenceDossier : "",
    equipe: [{ role: "Chef de mission", nom: state.agentName }], moyenDeplacement: "Véhicule",
    indicateurType: "Personne désignée par le client", indicateurNom: "", indicateurPrenom: "", indicateurTelephone: "",
    commune: "", quartier: "", cercle: "", region: "", bamakoDistrict: "", adresse: "",
    lat: null, lon: null, utm: null,
    typeTitre: "Titre Foncier", numeroTitre: "", numeroRequisitionCadastrale: "", titulaire: "",
    natureParcelle: [], etatTerrain: [], vrd: [], etatBatiment: "Bon état", difficultesRencontrees: "",
    longueurParcelle: "", largeurParcelle: "", hauteurMur: "", hauteurAcrotere: "",
    gpsAngles: { P1: null, P2: null, P3: null, P4: null, Centre: null },
    pieces: [], annexes: { fosseSeptiqueQte: "", lavoirM2: "", paveBetonM2: "", dalleBetonM2: "", devanture: "", clotureHauteurMl: "", regardsQte: "" },
    typeBien: "Terrain bâti", superficie: "", description: "", observationsAgent: "", photos: [],
    heureDebutMission: nowISO(), heureArriveeSite: null, heureFinMission: null,
    trackingPoints: [], distanceParcourue: 0,
    statut: "brouillon", expertNotes: "", prixReference: "", prixBase: "", prixChoisi: "", methodeEvaluation: "", conclusion: "",
    dateEnvoi: null, dernierModifiePar: state.agentName,
  };
}

const REGIONS_MALI = ["", "District de Bamako", "Kayes", "Koulikoro", "Sikasso", "Ségou", "Mopti", "Tombouctou", "Gao", "Kidal", "Taoudénit", "Ménaka", "Nioro", "Kita", "Dioïla", "Nara", "Bougouni", "Koutiala", "San", "Douentza", "Bandiagara"];
function uniqueValues(prop) {
  return Array.from(new Set(state.dossiers.map((d) => d[prop]).filter(Boolean))).sort();
}
function fieldWithDatalist(label, id, value, suggestions, opts = {}) {
  const listId = id + "-list";
  const tagHtml = opts.required ? ' <span class="required">*</span>' : opts.showOptional ? ' <span class="optional">(facultatif)</span>' : "";
  return `<label class="field"><span class="field-label">${label}${tagHtml}</span>
    <input id="${id}" list="${listId}" value="${esc(value)}" />
    <datalist id="${listId}">${suggestions.map((s) => `<option value="${esc(s)}"></option>`).join("")}</datalist>
  </label>`;
}
function field(label, id, value, opts = {}) {
  const tag = opts.textarea ? "textarea" : "input";
  const type = opts.type || "text";
  const rows = opts.textarea ? 'rows="3"' : "";
  let tagHtml = "";
  if (opts.required) tagHtml = ' <span class="required">*</span>';
  else if (opts.showOptional) tagHtml = ' <span class="optional">(facultatif)</span>';
  const val = esc(value);
  const input = opts.select
    ? `<select id="${id}">${opts.select.map((o) => `<option ${o === value ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`
    : tag === "textarea"
    ? `<textarea id="${id}" ${rows}>${val}</textarea>`
    : `<input id="${id}" type="${type}" value="${val}" />`;
  return `<label class="field"><span class="field-label">${label}${tagHtml}</span>${input}</label>`;
}
function checkboxGroup(label, cls, options, selected = []) {
  return `<div class="field"><span class="field-label">${label}</span><div class="checkbox-group">
    ${options.map((o) => `<label class="checkbox-pill"><input type="checkbox" class="${cls}" value="${o}" ${selected.includes(o) ? "checked" : ""}/>${o}</label>`).join("")}
  </div></div>`;
}
const collectChecked = (cls) => Array.from(document.querySelectorAll("." + cls + ":checked")).map((el) => el.value);

const ETAT_TERRAIN_LITTERATURE = {
  "Bâtie": "le terrain comporte des constructions existantes",
  "Vide": "le terrain ne comporte aucune construction et se présente vide",
  "Terrain bâti": "il s'agit d'un terrain bâti",
  "Incendié": "des traces d'incendie ont été constatées sur le site",
  "Effondré": "des effondrements de structures sont visibles sur le site",
  "Plat": "le relief du terrain est plat, sans dénivelé notable",
  "Accidenté": "le terrain présente un relief accidenté",
  "Rocheux": "le sol est de nature rocheuse",
  "Inondé": "le terrain est actuellement inondé ou reconnu sujet aux inondations",
};
function litteratureEtatTerrain(list) {
  if (!list || !list.length) return "";
  const phrases = list.map((v) => ETAT_TERRAIN_LITTERATURE[v] || v.toLowerCase());
  if (phrases.length === 1) return `Sur le plan de l'état du terrain, il est à noter que ${phrases[0]}.`;
  const last = phrases[phrases.length - 1];
  const firstOnes = phrases.slice(0, -1);
  return `Sur le plan de l'état du terrain, il est à noter que ${firstOnes.join(", ")} et que ${last}.`;
}

function statusBadge(statut) {
  const map = {
    brouillon: ["Brouillon", "badge-muted"], envoye: ["Envoyé", "badge-accent"],
    en_traitement: ["En traitement", "badge-warn"], rapport_genere: ["Rapport généré", "badge-ok"],
    en_attente: ["En attente d'agent", "badge-warn"], visitee: ["Visite effectuée", "badge-ok"],
  };
  const [label, cls] = map[statut] || map.brouillon;
  return `<span class="badge ${cls}">${label}</span>`;
}

// ---------------- Screens ----------------
function screenLogin() {
  return `<div style="max-width:360px;margin:2rem auto">
    <img src="/logo.png" alt="IQRA-E" style="display:block;max-width:220px;margin:0 auto 12px" />
    <h1 style="font-size:20px;margin-bottom:4px;text-align:center">IQRA EXPERT</h1>
    <div class="muted" style="margin-bottom:24px;text-align:center">Application unique — collecte terrain et traitement expert</div>
    ${field("Identifiant", "login-username", "", { required: true })}
    <label class="field"><span class="field-label">Mot de passe <span class="required">*</span></span><input id="login-password" type="password" /></label>
    <div id="login-error" class="error-text" style="display:none"></div>
    <button class="accent" id="btn-login" style="width:100%;margin-top:8px">Se connecter</button>
  </div>`;
}

function screenRequisitionForm(r) {
  return `<div>
    <button id="btn-cancel-req" style="margin-bottom:1rem">← Retour</button>
    <h2 style="font-size:17px;margin-bottom:4px">Réquisition à Expert (Ordre de mission)</h2>
    <div class="muted" style="margin-bottom:16px" id="req-hint">Déclenche la mission de l'agent. Seuls le site et un contact (client ou mandant) sont obligatoires — sauf si vous joignez le document de réquisition scanné ci-dessous, auquel cas ces champs deviennent facultatifs.</div>
    ${field("Référence du dossier", "r-referenceDossier", r.referenceDossier, { showOptional: true })}
    <div class="section-title">Client</div>
    ${field("Nom du client", "r-clientNom", r.clientNom, { showOptional: true })}
    ${field("Téléphone du client", "r-clientTelephone", r.clientTelephone, { showOptional: true })}
    ${field("Email du client", "r-clientEmail", r.clientEmail, { showOptional: true })}
    <div class="section-title">Mandant</div>
    ${field("Type de mandant", "r-mandantType", r.mandantType, { select: ["Banque", "Particulier", "Institution", "Autre"] })}
    ${field("Nom du mandant", "r-mandantNom", r.mandantNom, { showOptional: true })}
    ${field("Téléphone du mandant", "r-mandantTelephone", r.mandantTelephone, { showOptional: true })}
    <div class="section-title">Mission</div>
    ${field("Site à visiter (commune / quartier)", "r-siteIndicatif", r.siteIndicatif, { required: true })}
    ${field("Instructions pour l'agent", "r-instructionsExpert", r.instructionsExpert, { textarea: true, showOptional: true })}
    ${field("Agent assigné", "r-assignedAgent", r.assignedAgent, { select: ["", ...Array.from(new Set(state.users.filter((u) => u.role === "agent").map((u) => u.displayName)))], showOptional: true })}
    <label class="field"><span class="field-label">Document de réquisition original (scanné, facultatif — dispense des champs ci-dessus si joint)</span>
      <input type="file" id="r-fichierRequisition" accept="image/*,.pdf" /></label>
    ${r.fichierRequisitionPath ? `<div class="muted" style="margin-bottom:12px"><a class="link" href="/uploads/${esc(r.fichierRequisitionPath)}" target="_blank">📎 Voir le document déjà joint ↗</a></div>` : ""}
    <div id="req-error" class="error-text" style="display:none"></div>
    <div class="btn-row">
      <button type="button" id="btn-download-req-pdf">⬇ Télécharger la fiche (PDF)</button>
      <button class="accent" id="btn-send-requisition">${r.id ? "Enregistrer les modifications" : "Émettre la réquisition"}</button>
    </div>
  </div>`;
}
function printRequisition(r) {
  const rows = [
    ["Référence du dossier", r.referenceDossier || "—"],
    ["Client", r.clientNom || "—"],
    ["Téléphone du client", r.clientTelephone || "—"],
    ["Email du client", r.clientEmail || "—"],
    ["Type de mandant", r.mandantType || "—"],
    ["Nom du mandant", r.mandantNom || "—"],
    ["Téléphone du mandant", r.mandantTelephone || "—"],
    ["Site à visiter", r.siteIndicatif || "—"],
    ["Instructions pour l'agent", r.instructionsExpert || "—"],
  ];
  const html = `<html><head><title>Fiche de réquisition</title><style>body{font-family:sans-serif;padding:24px;color:#111}h1{font-size:18px}table{width:100%;border-collapse:collapse;font-size:13px;margin-top:16px}td{padding:6px 0;vertical-align:top;border-bottom:1px solid #eee}td:first-child{color:#666;width:40%}</style></head>
    <body><h1>Réquisition à Expert (Ordre de mission) — IQRA Expertise</h1>
    <table>${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join("")}</table></body></html>`;
  const w = window.open("", "_blank");
  if (!w) { showAlert("Le navigateur a bloqué l'ouverture de la fenêtre d'impression. Autorisez les pop-ups pour ce site puis réessayez."); return; }
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 300);
}
function collectRequisitionForm(base) {
  const g = (id) => document.getElementById(id).value;
  return { ...base, referenceDossier: g("r-referenceDossier"), clientNom: g("r-clientNom"), clientTelephone: g("r-clientTelephone"), clientEmail: g("r-clientEmail"), mandantType: g("r-mandantType"), mandantNom: g("r-mandantNom"), mandantTelephone: g("r-mandantTelephone"), siteIndicatif: g("r-siteIndicatif"), instructionsExpert: g("r-instructionsExpert"), assignedAgent: g("r-assignedAgent") };
}

function screenAgentHome() {
  const pending = state.requisitions.filter((r) => r.statut === "en_attente" && (!r.assignedAgent || r.assignedAgent === state.agentName));
  const mine = state.dossiers.filter((d) => d.agentName === state.agentName);
  const counts = {
    envoye: mine.filter((d) => d.statut === "envoye").length,
    en_traitement: mine.filter((d) => d.statut === "en_traitement").length,
    rapport_genere: mine.filter((d) => d.statut === "rapport_genere").length,
  };
  return `<div>
    <div class="row-between" style="margin-bottom:20px">
      <div><div style="font-weight:600;font-size:17px">Agent : ${esc(state.agentName)}</div><div class="muted">Mode saisie terrain</div></div>
      <button id="btn-logout">Se déconnecter</button></div>
    <div class="metrics">
      <div class="metric-card"><div class="label">Réq. en attente</div><div class="value">${pending.length}</div></div>
      <div class="metric-card"><div class="label">Nouveaux (envoyés)</div><div class="value">${counts.envoye}</div></div>
      <div class="metric-card"><div class="label">En traitement</div><div class="value">${counts.en_traitement}</div></div>
      <div class="metric-card"><div class="label">Rapports générés</div><div class="value">${counts.rapport_genere}</div></div>
    </div>
    <div class="section-title" style="margin-top:0">Réquisitions en attente (${pending.length})</div>
    ${pending.length === 0 ? '<div class="muted">Aucune réquisition en attente. L\'expert doit émettre un ordre de mission avant toute visite.</div>' : pending.map((r) => `
      <div class="list-row req-row" data-id="${r.id}"><div><div style="font-weight:600">${esc(r.siteIndicatif)}</div>
      <div class="muted">${esc(r.mandantType)} ${r.mandantNom ? "— " + esc(r.mandantNom) : ""} ${r.clientNom ? "· Client : " + esc(r.clientNom) : ""}</div>
      ${r.fichierRequisitionPath ? `<a class="link req-attachment-link" href="/uploads/${esc(r.fichierRequisitionPath)}" target="_blank">📎 Document joint ↗</a>` : ""}</div>
      <button style="pointer-events:none">Démarrer</button></div>`).join("")}
    <div class="section-title">Mes fiches (${mine.length})</div>
    ${mine.length === 0 ? '<div class="muted">Aucune fiche pour le moment.</div>' : mine.map((d) => `
      <div class="list-row mine-row" data-id="${d.id}" style="cursor:${d.statut === "brouillon" || d.statut === "envoye" ? "pointer" : "default"}">
      <div><div style="font-weight:600">${esc(d.numeroRapport) || "(sans n°)"} — ${esc(d.nomSite || d.commune) || "?"}</div>
      <div class="muted">${d.dateVisite} · ${d.photos.length} photo(s) · ${(d.distanceParcourue / 1000).toFixed(2)} km</div></div>
      <div style="display:flex;align-items:center;gap:8px">${statusBadge(d.statut)}<button type="button" class="btn-delete-mine" data-id="${d.id}" aria-label="Supprimer">✕</button></div></div>`).join("")}
  </div>`;
}

function photoGallery(photos) {
  const body = !photos.length ? '<div class="muted" style="margin-bottom:4px">Aucune photo pour le moment.</div>' :
    `<div class="photo-grid">${photos.map((p) => `<div class="photo-thumb"><img src="${p.url}" />
      <button class="photo-del" data-pid="${p.id}" aria-label="Supprimer">✕</button></div>`).join("")}</div>`;
  return body + '<div class="muted" style="font-style:italic;margin-bottom:8px">Images IQRA-EXPERT</div>';
}
function gpsPointRow(label, key, pt) {
  return `<div class="gps-point-row"><div>${label}${pt ? `<div class="muted">${pt.lat.toFixed(6)}, ${pt.lon.toFixed(6)}</div><div class="muted">${utmString(pt)}</div>` : ""}</div>
    <div class="btn-row" style="gap:6px;margin-top:0">
      ${pt ? `<button type="button" class="btn-toggle-map" data-key="${key}">${state.openMaps[key] ? "Masquer la carte" : "Voir sur la carte"}</button>` : ""}
      <button type="button" class="btn-cap-angle" data-key="${key}">${pt ? "Reprendre" : "Capturer"}</button>
    </div></div>
    ${pt ? mapEmbed(key, pt.lat, pt.lon) : ""}`;
}
function locBlock(d) {
  const hasLoc = d.lat != null;
  const u = hasLoc ? toUTM(d.lat, d.lon) : null;
  return `<div class="card">
    <div class="row-between" style="margin-bottom:8px"><div style="font-weight:600;font-size:13px">Position centrale du site</div>
    <button type="button" id="btn-capture-gps">${hasLoc ? "Actualiser" : "Capturer ma position"}</button></div>
    <div id="gps-error" class="error-text" style="display:none"></div>
    ${hasLoc ? `<table class="info-table">
      <tr><td>Latitude / Longitude</td><td>${d.lat.toFixed(6)}, ${d.lon.toFixed(6)}</td></tr>
      <tr><td>UTM (WGS84)</td><td>Zone ${u.zone}${u.hemisphere} — E ${u.easting} m, N ${u.northing} m</td></tr></table>
      <div class="btn-row" style="gap:6px;margin-top:6px">
        <button type="button" class="btn-toggle-map" data-key="site">${state.openMaps.site ? "Masquer la carte" : "Voir sur la carte"}</button>
        <a class="link" href="https://www.google.com/maps/@${d.lat},${d.lon},400m/data=!3m1!1e3" target="_blank">Voir la vue satellite (Google Maps) ↗</a>
      </div>
      ${mapEmbed("site", d.lat, d.lon)}`
      : '<div class="muted">Aucune position capturée.</div>'}
  </div>`;
}
function anglesBlock(d) {
  const a = d.gpsAngles;
  return `<div class="card"><div style="font-weight:600;font-size:13px;margin-bottom:6px">Coordonnées GPS des angles de la parcelle</div>
    ${gpsPointRow("Point P1", "P1", a.P1)}${gpsPointRow("Point P2", "P2", a.P2)}${gpsPointRow("Point P3", "P3", a.P3)}${gpsPointRow("Point P4", "P4", a.P4)}${gpsPointRow("Centre", "Centre", a.Centre)}
    <div style="margin-top:10px">${parcelSVG(d)}</div>
  </div>`;
}
function parcelSVG(d) {
  const a = d.gpsAngles || {};
  const pts = ["P1", "P2", "P3", "P4"].map((k) => a[k]).filter(Boolean);
  if (pts.length < 3) return '<div class="muted">Capturez au moins 3 points d\'angle (P1 à P4) pour tracer le périmètre de la parcelle.</div>';
  const latRef = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
  const lonRef = pts.reduce((s, p) => s + p.lon, 0) / pts.length;
  const toXY = (p) => [(p.lon - lonRef) * 111320 * Math.cos((latRef * Math.PI) / 180), -(p.lat - latRef) * 110540];
  const xy = pts.map(toXY);
  const xs = xy.map((p) => p[0]), ys = xy.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const w = Math.max(maxX - minX, 1), h = Math.max(maxY - minY, 1);
  const pad = Math.max(w, h) * 0.3 + 2;
  const viewW = w + pad * 2, viewH = h + pad * 2, unit = Math.max(viewW, viewH);
  const project = ([x, y]) => [x - minX + pad, y - minY + pad];
  const poly = xy.map(project);
  const centreSrc = a.Centre || { lat: d.lat, lon: d.lon };
  const centreProj = centreSrc.lat != null ? project(toXY(centreSrc)) : project([(minX + maxX) / 2, (minY + maxY) / 2]);
  const nomClient = (d.clientNom || d.mandantNom || d.demandeur || "CLIENT").toUpperCase().trim().replace(/\s+/g, "_");
  const label = `CONCESSION_${nomClient}`;
  const titre = d.numeroTitre ? `${d.typeTitre || ""} n°${d.numeroTitre}` : "";
  return `<svg viewBox="0 0 ${viewW.toFixed(1)} ${viewH.toFixed(1)}" style="width:100%;max-width:380px;background:#f7f7f5;border:1px solid #ddd;border-radius:8px;display:block" xmlns="http://www.w3.org/2000/svg">
    <polygon points="${poly.map((p) => p.join(",")).join(" ")}" fill="#cfe8cf" stroke="#2e7d32" stroke-width="${(unit * 0.008).toFixed(2)}" />
    ${poly.map((p, i) => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${(unit * 0.014).toFixed(2)}" fill="#2e7d32" /><text x="${p[0].toFixed(1)}" y="${(p[1] - unit * 0.02).toFixed(1)}" font-size="${(unit * 0.035).toFixed(1)}" text-anchor="middle">P${i + 1}</text>`).join("")}
    <circle cx="${centreProj[0].toFixed(1)}" cy="${centreProj[1].toFixed(1)}" r="${(unit * 0.012).toFixed(2)}" fill="#b71c1c" />
    <text x="${centreProj[0].toFixed(1)}" y="${(centreProj[1] + unit * 0.045).toFixed(1)}" font-size="${(unit * 0.03).toFixed(1)}" text-anchor="middle" fill="#b71c1c">${esc(label)}</text>
    ${titre ? `<text x="${centreProj[0].toFixed(1)}" y="${(centreProj[1] + unit * 0.08).toFixed(1)}" font-size="${(unit * 0.026).toFixed(1)}" text-anchor="middle" fill="#444">${esc(titre)}</text>` : ""}
  </svg>`;
}
function piecesBlock(d) {
  const rows = d.pieces.map((p) => `<div class="piece-row" data-id="${p.id}">
    <select class="pc-niveau"><option ${p.niveau === "RDC" ? "selected" : ""}>RDC</option><option ${p.niveau === "Étage 1" ? "selected" : ""}>Étage 1</option><option ${p.niveau === "Étage 2" ? "selected" : ""}>Étage 2</option></select>
    <input class="pc-designation" placeholder="ex. Chambre 1" value="${esc(p.designation)}" />
    <input class="pc-longueur" placeholder="Long. (m)" value="${p.longueur || ""}" />
    <input class="pc-largeur" placeholder="Larg. (m)" value="${p.largeur || ""}" />
    <input class="pc-quantite" placeholder="Qté" value="${p.quantite || ""}" />
    <input class="pc-superficie" placeholder="m²" value="${p.superficie || ""}" readonly />
    <button type="button" class="btn-del-piece" data-pid="${p.id}" aria-label="Supprimer">✕</button></div>`).join("");
  return `<div class="card"><div style="font-weight:600;font-size:13px;margin-bottom:8px">Relevé des pièces (par niveau)</div>
    ${d.pieces.length ? `<div class="piece-header"><div>Niveau</div><div>Désignation</div><div>Longueur</div><div>Largeur</div><div>Qté</div><div>Superficie</div><div></div></div>` : ""}
    <div>${rows || '<div class="muted" style="margin-bottom:6px">Aucune pièce ajoutée.</div>'}</div>
    <button type="button" id="btn-add-piece">+ Ajouter une pièce</button>
    <div style="margin-top:14px;display:grid;grid-template-columns:1fr 1fr;gap:10px">
      ${field("Hauteur des murs (m)", "f-hauteurMur", d.hauteurMur, { showOptional: true })}
      ${field("Hauteur de l'acrotère (m)", "f-hauteurAcrotere", d.hauteurAcrotere, { showOptional: true })}
    </div>
  </div>`;
}
function indicateurBlock(d) {
  return `<div class="card accent-border">
    <div style="font-weight:600;font-size:13px;margin-bottom:2px">Indicateur de terrain <span class="required">*</span></div>
    <div class="muted" style="margin-bottom:10px">Personne ayant accompagné l'agent pour montrer les limites du terrain (désignée par le client, ou géomètre). Obligatoire avant l'envoi à l'expert.</div>
    ${field("Qualité de l'indicateur", "f-indicateurType", d.indicateurType, { select: ["Personne désignée par le client", "Géomètre"] })}
    ${field("Nom", "f-indicateurNom", d.indicateurNom, { required: true })}
    ${field("Prénom", "f-indicateurPrenom", d.indicateurPrenom, { required: true })}
    ${field("Numéro de téléphone", "f-indicateurTelephone", d.indicateurTelephone, { required: true, type: "tel" })}
  </div>`;
}
function trackingBlock(d) {
  const elapsed = d.heureDebutMission ? Date.now() - new Date(d.heureDebutMission).getTime() : 0;
  return `<div class="card"><div style="font-weight:600;font-size:13px;margin-bottom:8px">Suivi de mission</div>
    <table class="info-table" style="margin-bottom:10px">
      <tr><td>Date</td><td>${d.dateVisite}</td></tr>
      <tr><td>Début de mission</td><td>${fmtTime(d.heureDebutMission)}</td></tr>
      <tr><td>Arrivée sur site</td><td>${fmtTime(d.heureArriveeSite)}</td></tr>
      <tr><td>Fin de mission</td><td>${fmtTime(d.heureFinMission)}</td></tr>
      <tr><td>Distance tracée</td><td>${(d.distanceParcourue / 1000).toFixed(2)} km (${d.trackingPoints.length} pts)</td></tr>
      <tr><td style="font-weight:600">Temps total écoulé</td><td id="temps-total-live" style="font-weight:600">${fmtDuration(elapsed)}</td></tr>
    </table>
    <div id="tracking-error" class="error-text" style="display:none"></div>
    <div class="btn-row" style="margin-top:0">
      ${!d.trackingActif ? `<button type="button" id="btn-start-tracking">Démarrer le suivi du trajet</button>` : `<button type="button" id="btn-stop-tracking">Arrêter le suivi</button>`}
      <button type="button" id="btn-mark-arrival" ${d.heureArriveeSite ? "disabled" : ""}>Marquer arrivée sur site</button>
    </div></div>`;
}

function screenFicheForm(d) {
  return `<div id="fiche-form-wrap">
    <div class="btn-row" style="margin-bottom:1rem">
      <button type="button" id="btn-nav-refresh">⟳ Actualiser</button>
      <button type="button" id="btn-nav-prev">← Précédent</button>
      <button type="button" id="btn-nav-next">Suivant →</button>
      <button type="button" id="btn-nav-quit" style="margin-left:auto">Quitter (enregistrer)</button>
    </div>
    <h2 style="font-size:17px;margin-bottom:2px">Mission de terrain</h2>
    <div class="muted" style="margin-bottom:16px">Réquisition liée : ${esc(d.mandantType) || "—"} ${d.mandantNom ? "— " + esc(d.mandantNom) : ""} ${d.clientNom ? "· Client " + esc(d.clientNom) : ""}</div>

    ${trackingBlock(d)}

    <div class="section-title" style="margin-top:16px">Identification du rapport</div>
    ${field("N° du rapport de visite", "f-numeroRapport", d.numeroRapport)}
    ${field("Nom du site", "f-nomSite", d.nomSite)}
    ${field("Référence dossier", "f-referenceDossier", d.referenceDossier)}
    ${field("Date de visite", "f-dateVisite", d.dateVisite, { type: "date" })}
    ${field("Moyen de déplacement", "f-moyenDeplacement", d.moyenDeplacement, { select: ["Motocycle", "Véhicule"] })}
    ${field("Membres de l'équipe (outre le chef de mission)", "f-equipeAutres", (d.equipe || []).slice(1).map((e) => e.nom).join(", "), { showOptional: true })}

    ${indicateurBlock(d)}

    <div class="section-title">Relevés de terrain</div>
    ${fieldWithDatalist("Commune", "f-commune", d.commune, uniqueValues("commune"))}
    ${fieldWithDatalist("Quartier / Localité", "f-quartier", d.quartier, uniqueValues("quartier"))}
    ${fieldWithDatalist("Cercle", "f-cercle", d.cercle, uniqueValues("cercle"), { showOptional: true })}
    ${field("Région", "f-region", d.region, { select: REGIONS_MALI, showOptional: true })}
    ${field("Bamako District (si applicable)", "f-bamakoDistrict", d.bamakoDistrict, { showOptional: true })}
    ${field("Adresse / repère", "f-adresse", d.adresse)}
    ${locBlock(d)}
    ${anglesBlock(d)}
    ${gpsCoordsTable(d)}
    ${field("Longueur de la parcelle (m)", "f-longueurParcelle", d.longueurParcelle, { showOptional: true })}
    ${field("Largeur de la parcelle (m)", "f-largeurParcelle", d.largeurParcelle, { showOptional: true })}

    <div class="section-title">Photos prises sur le site</div>
    ${photoGallery(d.photos)}
    <input type="file" id="f-photo-input" accept="image/*" capture="environment" style="display:none" />
    <button type="button" id="btn-take-photo" style="margin-bottom:16px">📷 Prendre une photo</button>

    <div class="section-title">Identification de la parcelle</div>
    ${field("Type de titre", "f-typeTitre", d.typeTitre, { select: ["Titre Foncier (TF)", "Permis d'Occuper (PO)", "Titre Provisoire de Vente (TPV)", "Lettre d'Attribution (LA)", "Non titré"] })}
    ${field("Numéro du titre", "f-numeroTitre", d.numeroTitre, { showOptional: true })}
    ${field("N° de réquisition cadastrale (immatriculation, si applicable)", "f-numeroRequisitionCadastrale", d.numeroRequisitionCadastrale, { showOptional: true })}
    ${field("Titulaire (nom sur le titre)", "f-titulaire", d.titulaire, { showOptional: true })}

    ${checkboxGroup("Nature de la parcelle", "cb-nature", ["Habitation", "Champ", "Usine", "Ferme Agro"], d.natureParcelle)}
    ${checkboxGroup("État du terrain", "cb-etat", ["Bâtie", "Vide", "Terrain bâti", "Incendié", "Effondré", "Plat", "Accidenté", "Rocheux", "Inondé"], d.etatTerrain)}
    <div id="etat-terrain-litterature" class="muted" style="margin:2px 0 14px;font-style:italic">${esc(litteratureEtatTerrain(d.etatTerrain))}</div>
    ${checkboxGroup("Voirie et réseaux divers (VRD)", "cb-vrd", ["Piste", "Goudron", "Pavé", "Collecteur", "Caniveau", "EDM", "SOMAGEP", "Forage"], d.vrd)}
    ${field("État du bâtiment", "f-etatBatiment", d.etatBatiment, { select: ["Neuf", "Bon état", "État moyen", "Mauvais état", "Vétuste", "En ruine"] })}
    ${field("Difficultés rencontrées sur le site", "f-difficultesRencontrees", d.difficultesRencontrees, { textarea: true, showOptional: true })}

    ${piecesBlock(d)}

    <div class="section-title">Annexes et cours</div>
    ${field("Fosse septique (quantité)", "f-fosseSeptiqueQte", d.annexes.fosseSeptiqueQte, { showOptional: true })}
    ${field("Lavoir (m²)", "f-lavoirM2", d.annexes.lavoirM2, { showOptional: true })}
    ${field("Pavé de béton (m²)", "f-paveBetonM2", d.annexes.paveBetonM2, { showOptional: true })}
    ${field("Dalle de béton (m²)", "f-dalleBetonM2", d.annexes.dalleBetonM2, { showOptional: true })}
    ${field("Devanture", "f-devanture", d.annexes.devanture, { showOptional: true })}
    ${field("Clôture — hauteur (ml)", "f-clotureHauteurMl", d.annexes.clotureHauteurMl, { showOptional: true })}
    ${field("Regards (quantité)", "f-regardsQte", d.annexes.regardsQte, { showOptional: true })}

    <div class="section-title">Description générale</div>
    ${field("Type de bien", "f-typeBien", d.typeBien, { select: ["Terrain nu", "Terrain bâti", "Appartement", "Local commercial"] })}
    ${field("Superficie totale (m²)", "f-superficie", d.superficie, { showOptional: true })}
    ${field("Description (construction, matériaux, état)", "f-description", d.description, { textarea: true, showOptional: true })}
    ${field("Observations de l'agent", "f-observationsAgent", d.observationsAgent, { textarea: true, showOptional: true })}

    <div id="fiche-error" class="error-text" style="display:none"></div>
    <div class="btn-row">
      <button id="btn-save-draft">Enregistrer brouillon</button>
      <button type="button" id="btn-mark-end" ${d.heureFinMission ? "disabled" : ""}>Confirmer fin de mission</button>
      <button class="accent" id="btn-preview" ${!d.heureFinMission ? "disabled" : ""}>📄 Aperçu avant envoi</button>
    </div>
    ${!d.heureFinMission ? '<div class="muted" style="margin-top:6px">Confirmez la fin de mission pour débloquer l\'aperçu et l\'envoi.</div>' : ""}
  </div>`;
}

function collectFicheForm(base) {
  const g = (id) => document.getElementById(id).value;
  const equipeAutres = (g("f-equipeAutres") || "").split(",").map((s) => s.trim()).filter(Boolean).map((nom) => ({ role: "Agent", nom }));
  return {
    ...base,
    numeroRapport: g("f-numeroRapport"), nomSite: g("f-nomSite"), referenceDossier: g("f-referenceDossier"),
    dateVisite: g("f-dateVisite"), moyenDeplacement: g("f-moyenDeplacement"),
    equipe: [{ role: "Chef de mission", nom: state.agentName }, ...equipeAutres],
    indicateurType: g("f-indicateurType"), indicateurNom: g("f-indicateurNom"), indicateurPrenom: g("f-indicateurPrenom"), indicateurTelephone: g("f-indicateurTelephone"),
    commune: g("f-commune"), quartier: g("f-quartier"), cercle: g("f-cercle"), region: g("f-region"), bamakoDistrict: g("f-bamakoDistrict"), adresse: g("f-adresse"),
    longueurParcelle: g("f-longueurParcelle"), largeurParcelle: g("f-largeurParcelle"),
    hauteurMur: g("f-hauteurMur"), hauteurAcrotere: g("f-hauteurAcrotere"),
    typeTitre: g("f-typeTitre"), numeroTitre: g("f-numeroTitre"), numeroRequisitionCadastrale: g("f-numeroRequisitionCadastrale"), titulaire: g("f-titulaire"),
    natureParcelle: collectChecked("cb-nature"), etatTerrain: collectChecked("cb-etat"), vrd: collectChecked("cb-vrd"), etatBatiment: g("f-etatBatiment"),
    difficultesRencontrees: g("f-difficultesRencontrees"),
    annexes: { fosseSeptiqueQte: g("f-fosseSeptiqueQte"), lavoirM2: g("f-lavoirM2"), paveBetonM2: g("f-paveBetonM2"), dalleBetonM2: g("f-dalleBetonM2"), devanture: g("f-devanture"), clotureHauteurMl: g("f-clotureHauteurMl"), regardsQte: g("f-regardsQte") },
    typeBien: g("f-typeBien"), superficie: g("f-superficie"), description: g("f-description"), observationsAgent: g("f-observationsAgent"),
  };
}

function previewHTML(d, mode) {
  const title = mode === "agent" ? "Aperçu de la fiche (avant envoi)" : "Aperçu du rapport";
  const pieces = d.pieces.length ? `<table class="info-table" style="margin-top:6px"><tr class="muted"><td>Niveau</td><td>Désignation</td><td>Qté</td><td>m²</td></tr>${d.pieces.map((p) => `<tr><td>${esc(p.niveau)}</td><td>${esc(p.designation)}</td><td>${esc(p.quantite)}</td><td>${esc(p.superficie)}</td></tr>`).join("")}</table>` : "";
  return `<div id="printable-preview" class="card" style="padding:20px">
    <div style="font-weight:600;font-size:15px;margin-bottom:2px">${title}</div>
    <div class="muted" style="margin-bottom:16px">N° ${esc(d.numeroRapport) || "—"} · ${esc(d.nomSite || d.commune) || "—"}</div>
    <table class="info-table">
      <tr><td>Mandant / Client</td><td>${esc(d.mandantType) || "—"} ${esc(d.mandantNom)} ${d.clientNom ? "· " + esc(d.clientNom) : ""}</td></tr>
      <tr><td>Équipe</td><td>${esc((d.equipe || []).map((e) => e.nom).filter(Boolean).join(", ")) || "—"}</td></tr>
      <tr><td>Indicateur de terrain</td><td>${d.indicateurNom ? `${esc(d.indicateurNom)} ${esc(d.indicateurPrenom)} — ${esc(d.indicateurTelephone)} (${esc(d.indicateurType)})` : "—"}</td></tr>
      <tr><td>Localisation</td><td>${esc(d.quartier)}, ${esc(d.commune) || "—"} (${esc(d.cercle) || "—"}, ${esc(d.region) || "—"})</td></tr>
      <tr><td>Coordonnées UTM</td><td>${d.utm ? `Zone ${d.utm.zone}${d.utm.hemisphere} — E ${d.utm.easting}, N ${d.utm.northing}` : "—"}</td></tr>
      <tr><td>Titre</td><td>${esc(d.typeTitre) || "—"} n°${esc(d.numeroTitre) || "—"}</td></tr>
      <tr><td>Nature / État / VRD</td><td>${esc([...d.natureParcelle, ...d.etatTerrain, ...d.vrd].join(", ")) || "—"}</td></tr>
      <tr><td>Description de l'état du terrain</td><td>${esc(litteratureEtatTerrain(d.etatTerrain)) || "—"}</td></tr>
      <tr><td>Dimensions parcelle</td><td>${esc(d.longueurParcelle) || "—"} m × ${esc(d.largeurParcelle) || "—"} m</td></tr>
      <tr><td>Début / arrivée / fin</td><td>${fmtTime(d.heureDebutMission)} · ${fmtTime(d.heureArriveeSite)} · ${fmtTime(d.heureFinMission)}</td></tr>
      <tr><td>Distance tracée</td><td>${(d.distanceParcourue / 1000).toFixed(2)} km</td></tr>
      <tr><td>Photos jointes</td><td>${d.photos.length}</td></tr>
      ${mode === "expert" ? `<tr><td colspan="2" style="padding-top:10px;font-weight:600">Traitement expert</td></tr>
      <tr><td>Prix de référence</td><td>${esc(d.prixReference) || "—"} FCFA/m²</td></tr>
      <tr><td>Méthode</td><td>${esc(d.methodeEvaluation) || "—"}</td></tr>
      <tr><td>Conclusion</td><td>${esc(d.conclusion) || "—"}</td></tr>` : ""}
    </table>${pieces}
    ${d.photos.length ? `<div class="photo-grid" style="margin-top:10px">${d.photos.map((p) => `<img src="${p.url}" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:6px" />`).join("")}</div><div class="muted" style="font-style:italic;margin-top:4px">Images IQRA-EXPERT</div>` : ""}
  </div>`;
}
function screenPreview(d) {
  return `<div><h2 style="font-size:17px;margin-bottom:16px">Aperçu avant envoi</h2>${previewHTML(d, "agent")}
    <div class="btn-row">
      <button id="btn-back-to-edit">✎ Corriger des informations</button>
      <button id="btn-print-pdf">⬇ Enregistrer en PDF (aperçu rapide)</button>
      <button id="btn-download-report-pdf">⬇ Rapport PDF officiel (numéroté)</button>
      <button id="btn-download-report-docx">⬇ Rapport Word (.docx)</button>
      <button type="button" id="btn-share-whatsapp">📤 Partager par WhatsApp</button>
      <button class="accent" id="btn-confirm-send">Confirmer l'envoi à l'expert</button>
      <span id="send-confirm-check" class="badge badge-ok" style="display:none">✓ Envoyé</span>
    </div></div>`;
}

function screenExpertHome() {
  const counts = { envoye: state.dossiers.filter((d) => d.statut === "envoye").length, en_traitement: state.dossiers.filter((d) => d.statut === "en_traitement").length, rapport_genere: state.dossiers.filter((d) => d.statut === "rapport_genere").length };
  const reqPending = state.requisitions.filter((r) => r.statut === "en_attente");
  const agentNames = Array.from(new Set(state.users.filter((u) => u.role === "agent").map((u) => u.displayName)));
  const metricCard = (label, value, statut) => `<button type="button" class="metric-card metric-card-link" data-statut="${statut}"><div class="label">${label}</div><div class="value">${value}</div></button>`;

  const enCours = state.dossiers.filter((d) => d.statut === "brouillon" && d.heureDebutMission);

  let body;
  if (state.filterStatut === "req_attente") {
    body = reqPending.length === 0 ? '<div class="muted">Aucune réquisition en attente.</div>' : reqPending.map((r) => `
      <div class="list-row req-pending-row" data-id="${r.id}"><div><div style="font-weight:600">${esc(r.siteIndicatif)}</div>
      <div class="muted">${esc(r.mandantType)} ${r.mandantNom ? "— " + esc(r.mandantNom) : ""} ${r.clientNom ? "· Client : " + esc(r.clientNom) : ""}${r.assignedAgent ? " · Assignée à " + esc(r.assignedAgent) : ""}</div></div>
      <div style="display:flex;align-items:center;gap:6px">${r.vuParAgentAt ? `<span class="badge badge-ok" title="Vue le ${new Date(r.vuParAgentAt).toLocaleString("fr-FR")}">✓ Vue par l'agent</span>` : `<span class="badge badge-muted">Pas encore vue</span>`}
      <button type="button" class="btn-edit-req" data-id="${r.id}">Éditer</button>
      <button type="button" class="btn-delete-req" data-id="${r.id}">Supprimer</button></div></div>`).join("");
  } else {
    let visible = state.dossiers.filter((d) => d.statut !== "brouillon");
    if (state.filterAgent) visible = visible.filter((d) => d.agentName === state.filterAgent);
    if (state.filterStatut) visible = visible.filter((d) => d.statut === state.filterStatut);
    body = visible.length === 0 ? '<div class="muted">Aucun dossier reçu pour le moment.</div>' : visible.map((d) => `
      <div class="list-row dossier-row" data-id="${d.id}"><div><div style="font-weight:600">N° ${esc(d.numeroRapport) || "—"} — ${esc(d.nomSite || d.commune) || "?"}</div>
      <div class="muted">Agent : ${esc(d.agentName)} · Indicateur : ${esc(d.indicateurNom) || "—"} · ${d.photos.length} photo(s)</div></div>
      <div style="display:flex;align-items:center;gap:6px">${statusBadge(d.statut)}
      <button type="button" class="btn-edit-dossier" data-id="${d.id}">Éditer</button>
      <button type="button" class="btn-delete-dossier" data-id="${d.id}">Supprimer</button></div></div>`).join("");
  }

  return `<div>
    <div class="row-between" style="margin-bottom:20px">
      <div><div style="font-weight:600;font-size:17px">Espace expert</div><div class="muted">Réquisitions et dossiers reçus</div></div>
      <div style="display:flex;gap:8px"><button id="btn-manage-users">Gérer les agents</button><button id="btn-logout">Se déconnecter</button></div></div>
    <button class="accent" id="btn-new-requisition" style="margin-bottom:20px">+ Nouvelle réquisition à expert</button>
    <div class="metrics">
      ${metricCard("Réq. en attente", reqPending.length, "req_attente")}
      ${metricCard("Nouveaux", counts.envoye, "envoye")}
      ${metricCard("En traitement", counts.en_traitement, "en_traitement")}
      ${metricCard("Rapports générés", counts.rapport_genere, "rapport_genere")}
    </div>
    <div class="card" style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap">
      <label class="field" style="flex:1;min-width:200px;margin-bottom:0"><span class="field-label">Aller directement à la session d'un agent</span>
        <select id="f-filter-agent"><option value="">— Tous les agents —</option>${agentNames.map((n) => `<option ${n === state.filterAgent ? "selected" : ""}>${esc(n)}</option>`).join("")}</select>
      </label>
      <button type="button" id="btn-go-agent">Voir ses dossiers</button>
      ${state.filterAgent || state.filterStatut ? `<button type="button" id="btn-clear-agent-filter">Réinitialiser les filtres</button>` : ""}
    </div>
    ${enCours.length ? `<div class="card accent-border" style="margin-bottom:16px">
      <div style="font-weight:600;font-size:13px;margin-bottom:6px">Missions de terrain en cours (${enCours.length})</div>
      <div class="muted" style="margin-bottom:8px">Visite en cours par l'agent — non modifiable ni supprimable tant qu'elle n'est pas envoyée.</div>
      ${enCours.map((d) => `<div class="list-row"><div><div style="font-weight:600">${esc(d.nomSite || d.commune) || "Site non renseigné"}</div>
      <div class="muted">Agent : ${esc(d.agentName)} · Débutée à ${fmtTime(d.heureDebutMission)}</div></div></div>`).join("")}
    </div>` : ""}
    <div class="section-title" style="margin-top:0">${state.filterStatut === "req_attente" ? "Réquisitions en attente" : "Dossiers reçus des agents"}${state.filterAgent ? ` — ${esc(state.filterAgent)}` : ""}</div>
    ${body}
  </div>`;
}

function screenManageUsers() {
  const editing = state.editingUserId ? state.users.find((u) => u.id === state.editingUserId) : null;
  return `<div>
    <button id="btn-back-users" style="margin-bottom:1rem">← Retour</button>
    <h2 style="font-size:17px;margin-bottom:16px">Gérer les comptes agents</h2>
    ${editing ? `<div class="card accent-border">
      <div style="font-weight:600;font-size:13px;margin-bottom:8px">Modifier l'agent — ${esc(editing.displayName)}</div>
      ${field("Nom affiché", "eu-displayName", editing.displayName, { showOptional: true })}
      ${field("Numéro de téléphone", "eu-telephone", editing.telephone, { showOptional: true, type: "tel" })}
      ${field("Qualification", "eu-qualification", editing.qualification, { showOptional: true })}
      <label class="field"><span class="field-label">Nouveau mot de passe (laisser vide pour ne pas changer)</span><input id="eu-password" type="text" placeholder="6 caractères minimum" /></label>
      <div id="eu-error" class="error-text" style="display:none"></div>
      <div class="btn-row">
        <button type="button" id="btn-cancel-edit-user">Annuler</button>
        <button class="accent" type="button" id="btn-save-edit-user">Enregistrer</button>
      </div>
    </div>` : `<div class="card">
      <div style="font-weight:600;font-size:13px;margin-bottom:8px">Nouveau compte agent</div>
      ${field("Identifiant de connexion", "nu-username", "", { required: true })}
      ${field("Nom affiché", "nu-displayName", "", { showOptional: true })}
      ${field("Numéro de téléphone", "nu-telephone", "", { showOptional: true, type: "tel" })}
      ${field("Qualification", "nu-qualification", "", { showOptional: true })}
      <label class="field"><span class="field-label">Mot de passe temporaire <span class="required">*</span></span><input id="nu-password" type="text" placeholder="6 caractères minimum" /></label>
      <div id="nu-error" class="error-text" style="display:none"></div>
      <button class="accent" id="btn-create-user">Créer le compte</button>
    </div>`}
    <div class="section-title">Comptes agents existants (${state.users.filter((u) => u.role === "agent").length})</div>
    ${state.users.filter((u) => u.role === "agent").length === 0 ? '<div class="muted">Aucun agent créé pour le moment.</div>' : state.users.filter((u) => u.role === "agent").map((u) => `
      <div class="list-row" data-id="${u.id}"><div><div style="font-weight:600">${esc(u.displayName)}</div>
      <div class="muted">Identifiant : ${esc(u.username)}${u.telephone ? " · " + esc(u.telephone) : ""}${u.qualification ? " · " + esc(u.qualification) : ""}</div></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
      <button type="button" class="btn-edit-user" data-id="${u.id}">Modifier</button>
      <button type="button" class="btn-toggle-user" data-id="${u.id}" data-active="${u.active}">${u.active ? "Désactiver" : "Réactiver"}</button>
      <button type="button" class="btn-delete-user" data-id="${u.id}">Supprimer</button>
      </div></div>`).join("")}
  </div>`;
}

const COEFFICIENTS_ETAT_BATIMENT = { "Neuf": 1.0, "Bon état": 0.9, "État moyen": 0.75, "Mauvais état": 0.55, "Vétuste": 0.4, "En ruine": 0.2 };
function expertPiecesBlock(d) {
  let totalSuperficie = 0, totalMontant = 0;
  const rows = d.pieces.map((p, i) => {
    const qte = parseFloat(p.quantite) || 0, superficie = parseFloat(p.superficie) || 0, prixUnitaire = parseFloat(p.prixUnitaire) || 0;
    const montant = qte * superficie * prixUnitaire;
    totalSuperficie += qte * superficie; totalMontant += montant;
    return `<div class="ep-piece-row" data-id="${p.id}">
      <div>${i + 1}</div><div>${esc(p.designation) || "—"}</div><div>${esc(p.quantite) || "—"}</div><div>${esc(p.superficie) || "—"}</div>
      <input class="ep-prixUnitaire" value="${p.prixUnitaire || ""}" placeholder="FCFA/m²" />
      <div class="ep-montant">${montant ? montant.toLocaleString("fr-FR") : "—"}</div></div>`;
  }).join("");
  const coefficient = coefficientEtatBatiment(d.etatBatiment);
  return `<div class="card">
    <div style="font-weight:600;font-size:13px;margin-bottom:8px">Calcul des pièces (prix unitaire)</div>
    ${d.pieces.length ? `<div class="ep-piece-header"><div>N°</div><div>Désignation</div><div>Qté</div><div>Superficie</div><div>Prix unitaire</div><div>Montant</div></div>
      <div>${rows}</div>
      <div class="ep-piece-row" style="font-weight:600;margin-top:6px"><div></div><div>TOTAL</div><div></div><div id="ep-total-superficie">${totalSuperficie.toLocaleString("fr-FR")} m²</div><div></div><div id="ep-total-montant">${totalMontant.toLocaleString("fr-FR")}</div></div>`
      : '<div class="muted">Aucune pièce renseignée par l\'agent.</div>'}
    <button type="button" id="btn-download-excel" style="margin-top:12px">⬇ Télécharger le tableau Excel (pièces + calcul global)</button>
    <div class="muted" style="margin-top:6px">Coefficient appliqué selon l'état du bâtiment (${esc(d.etatBatiment) || "—"}) : ${coefficient}</div>
  </div>`;
}
function coefficientEtatBatiment(etat) {
  return COEFFICIENTS_ETAT_BATIMENT[etat] != null ? COEFFICIENTS_ETAT_BATIMENT[etat] : 1.0;
}
function screenExpertDetail(d) {
  return `<div>
    <div class="btn-row" style="margin-bottom:1rem">
      <button type="button" id="btn-nav-prev-expert">← Précédent</button>
      <button type="button" id="btn-nav-next-expert">Suivant →</button>
      <button type="button" id="btn-nav-quit-expert" style="margin-left:auto">Quitter (enregistrer)</button>
    </div>
    <button id="btn-back-expert" style="margin-bottom:1rem">← Retour à la liste</button>
    <div class="row-between" style="margin-bottom:10px"><div style="font-weight:600;font-size:17px">N° ${esc(d.numeroRapport) || "—"} — ${esc(d.nomSite)}</div>${statusBadge(d.statut)}</div>
    <div class="muted" style="margin-bottom:16px">Toutes les informations restent modifiables par l'expert après réception.</div>
    ${previewHTML(d, "agent")}
    <div class="section-title">Traitement de l'expert</div>
    ${field("Notes d'analyse", "e-expertNotes", d.expertNotes, { textarea: true, showOptional: true })}
    ${field("Prix de référence (comparables, FCFA/m²)", "e-prixReference", d.prixReference, { showOptional: true })}
    <button type="button" id="btn-prix-reference" style="margin-bottom:16px">Consulter les prix de référence (dossiers similaires)</button>
    <div id="prix-reference-result" style="margin-bottom:16px"></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      ${field("Prix de base (FCFA/m²)", "e-prixBase", d.prixBase, { showOptional: true })}
      ${field("Prix au choix de l'expert (FCFA/m²)", "e-prixChoisi", d.prixChoisi, { required: true })}
    </div>
    ${expertPiecesBlock(d)}
    ${field("Méthode d'évaluation", "e-methodeEvaluation", d.methodeEvaluation, { showOptional: true })}
    ${field("Conclusion", "e-conclusion", d.conclusion, { textarea: true, required: true })}
    <div id="expert-error" class="error-text" style="display:none"></div>
    <div class="btn-row">
      <button id="btn-save-expert">Enregistrer les modifications</button>
      <button class="accent" id="btn-generate-report">Générer le rapport</button>
      <button type="button" id="btn-delete-expert" style="margin-left:auto;color:#b00">Supprimer ce dossier</button>
    </div>
    <div id="report-preview" style="margin-top:20px"></div></div>`;
}
function collectExpertForm(base) {
  const g = (id) => document.getElementById(id).value;
  return { ...base, expertNotes: g("e-expertNotes"), prixReference: g("e-prixReference"), prixBase: g("e-prixBase"), prixChoisi: g("e-prixChoisi"), methodeEvaluation: g("e-methodeEvaluation"), conclusion: g("e-conclusion"), dernierModifiePar: "Expert" };
}

function shareReportViaWhatsApp(d) {
  const text = `Rapport IQRA EXPERT — N° ${d.numeroRapport || "sans n°"} (${d.nomSite || d.commune || "site non renseigné"}).\nMerci de joindre le fichier PDF/Word téléchargé depuis l'application à ce message.`;
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
}
function printPreview() {
  const node = document.getElementById("printable-preview");
  if (!node) return;
  const w = window.open("", "_blank");
  if (!w) { showAlert("Le navigateur a bloqué l'ouverture de la fenêtre d'impression. Autorisez les pop-ups pour ce site puis réessayez."); return; }
  w.document.write(`<html><head><title>Aperçu fiche</title><style>body{font-family:sans-serif;padding:24px;color:#111}table{width:100%;border-collapse:collapse;font-size:13px}td{padding:6px 0;vertical-align:top}td:first-child{color:#666;width:40%}img{border-radius:6px}</style></head><body>${node.innerHTML}</body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 300);
}
function stopTracking() {
  if (state.watchId != null && navigator.geolocation) { navigator.geolocation.clearWatch(state.watchId); state.watchId = null; }
  if (state.tickInterval) { clearInterval(state.tickInterval); state.tickInterval = null; }
}

// ---------------- Event wiring ----------------
function attachFicheHandlers(d) {
  document.querySelectorAll(".cb-etat").forEach((cb) => {
    cb.onchange = () => {
      document.getElementById("etat-terrain-litterature").textContent = litteratureEtatTerrain(collectChecked("cb-etat"));
    };
  });
  document.getElementById("btn-nav-refresh").onclick = async () => {
    if (d.id) { state.editing = await api(`/dossiers/${d.id}`); }
    render();
  };
  document.getElementById("btn-nav-quit").onclick = async () => {
    const nd = collectFicheForm(d);
    await saveDossier(nd);
    stopTracking();
    state.editing = null;
    await loadAll();
    render();
  };
  const editableList = () => state.dossiers.filter((x) => x.agentName === state.agentName && (x.statut === "brouillon" || x.statut === "envoye"));
  document.getElementById("btn-nav-prev").onclick = async () => {
    const nd = collectFicheForm(d);
    const saved = await saveDossier(nd);
    await loadAll();
    const list = editableList();
    const idx = list.findIndex((x) => x.id === saved.id);
    stopTracking();
    state.editing = idx > 0 ? list[idx - 1] : saved;
    render();
  };
  document.getElementById("btn-nav-next").onclick = async () => {
    const nd = collectFicheForm(d);
    const saved = await saveDossier(nd);
    await loadAll();
    const list = editableList();
    const idx = list.findIndex((x) => x.id === saved.id);
    stopTracking();
    state.editing = idx >= 0 && idx < list.length - 1 ? list[idx + 1] : saved;
    render();
  };

  document.getElementById("btn-capture-gps").onclick = (ev) => {
    const nd = collectFicheForm(d);
    const err = document.getElementById("gps-error");
    const btn = ev.currentTarget;
    err.style.display = "none";
    if (!navigator.geolocation) { err.textContent = "Géolocalisation non disponible sur cet appareil/navigateur."; err.style.display = "block"; return; }
    btn.disabled = true;
    const prevLabel = btn.textContent;
    btn.textContent = "Localisation en cours…";
    locateWithFallback(
      (pos) => { nd.lat = pos.coords.latitude; nd.lon = pos.coords.longitude; state.editing = nd; render(); },
      (e) => { btn.disabled = false; btn.textContent = prevLabel; err.textContent = "Position indisponible (" + e.message + "). Vérifiez que la localisation est activée et autorisée pour ce site."; err.style.display = "block"; }
    );
  };
  document.querySelectorAll(".btn-cap-angle").forEach((btn) => {
    btn.onclick = (ev) => {
      const nd = collectFicheForm(d);
      const key = btn.getAttribute("data-key");
      if (!navigator.geolocation) return;
      const b = ev.currentTarget;
      b.disabled = true;
      const prevLabel = b.textContent;
      b.textContent = "…";
      locateWithFallback(
        (pos) => { nd.gpsAngles[key] = { lat: pos.coords.latitude, lon: pos.coords.longitude }; state.editing = nd; render(); },
        () => { b.disabled = false; b.textContent = prevLabel; }
      );
    };
  });
  document.querySelectorAll(".btn-toggle-map").forEach((btn) => {
    btn.onclick = () => {
      const key = btn.getAttribute("data-key");
      state.openMaps[key] = !state.openMaps[key];
      state.editing = collectFicheForm(d);
      render();
    };
  });
  document.getElementById("btn-add-piece").onclick = () => {
    const nd = collectFicheForm(d);
    nd.pieces.push({ id: uid(), niveau: "RDC", designation: "", longueur: "", largeur: "", quantite: "1", superficie: "" });
    state.editing = nd; render();
  };
  document.querySelectorAll(".btn-del-piece").forEach((btn) => {
    btn.onclick = () => { const nd = collectFicheForm(d); nd.pieces = nd.pieces.filter((p) => p.id !== btn.getAttribute("data-pid")); state.editing = nd; render(); };
  });
  document.querySelectorAll(".piece-row").forEach((row) => {
    const p = d.pieces.find((x) => x.id === row.getAttribute("data-id"));
    if (!p) return;
    const recalcSuperficie = () => {
      const l = parseFloat(p.longueur) || 0, w = parseFloat(p.largeur) || 0;
      p.superficie = l && w ? (l * w).toFixed(2) : "";
      row.querySelector(".pc-superficie").value = p.superficie;
    };
    row.querySelector(".pc-niveau").onchange = (e) => (p.niveau = e.target.value);
    row.querySelector(".pc-designation").oninput = (e) => (p.designation = e.target.value);
    row.querySelector(".pc-longueur").oninput = (e) => { p.longueur = e.target.value; recalcSuperficie(); };
    row.querySelector(".pc-largeur").oninput = (e) => { p.largeur = e.target.value; recalcSuperficie(); };
    row.querySelector(".pc-quantite").oninput = (e) => (p.quantite = e.target.value);
  });

  document.getElementById("btn-take-photo").onclick = () => {
    document.getElementById("f-photo-input").click();
  };
  document.getElementById("f-photo-input").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    let nd = collectFicheForm(d);
    if (!nd.id) nd = await saveDossier(nd);
    const fd = new FormData();
    fd.append("photo", file);
    const photo = await fetch(`${API}/dossiers/${nd.id}/photos`, { method: "POST", body: fd }).then((r) => r.json());
    nd.photos = [...nd.photos, photo];
    state.editing = nd; render();
  };
  document.querySelectorAll(".photo-del").forEach((btn) => {
    btn.onclick = async () => {
      const nd = collectFicheForm(d);
      const pid = btn.getAttribute("data-pid");
      await fetch(`${API}/photos/${pid}`, { method: "DELETE" });
      nd.photos = nd.photos.filter((p) => p.id !== pid);
      state.editing = nd; render();
    };
  });

  const startBtn = document.getElementById("btn-start-tracking");
  if (startBtn) startBtn.onclick = () => {
    const nd = collectFicheForm(d);
    const err = document.getElementById("tracking-error");
    err.style.display = "none";
    if (!navigator.geolocation) { err.textContent = "Suivi GPS non disponible."; err.style.display = "block"; return; }
    nd.trackingActif = true; state.editing = nd;
    state.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const pt = { lat: pos.coords.latitude, lon: pos.coords.longitude, t: nowISO() };
        const pts = nd.trackingPoints;
        if (pts.length) nd.distanceParcourue += haversine(pts[pts.length - 1].lat, pts[pts.length - 1].lon, pt.lat, pt.lon);
        pts.push(pt);
      },
      (e) => { err.textContent = "Suivi interrompu (" + e.message + ")."; err.style.display = "block"; },
      { enableHighAccuracy: true }
    );
    render();
  };
  const stopBtn = document.getElementById("btn-stop-tracking");
  if (stopBtn) stopBtn.onclick = () => { const nd = collectFicheForm(d); stopTracking(); nd.trackingActif = false; state.editing = nd; render(); };
  document.getElementById("btn-mark-arrival").onclick = () => { const nd = collectFicheForm(d); nd.heureArriveeSite = nowISO(); state.editing = nd; render(); };
  document.getElementById("btn-mark-end").onclick = () => { const nd = collectFicheForm(d); stopTracking(); nd.trackingActif = false; nd.heureFinMission = nowISO(); state.editing = nd; render(); };

  document.getElementById("btn-save-draft").onclick = async () => {
    const nd = collectFicheForm(d); nd.statut = "brouillon";
    await saveDossier(nd);
    stopTracking(); state.editing = null; render();
  };
  const previewBtn = document.getElementById("btn-preview");
  if (previewBtn) previewBtn.onclick = () => {
    const nd = collectFicheForm(d);
    const err = document.getElementById("fiche-error");
    if (!nd.commune || !nd.numeroRapport) { err.textContent = "Renseignez au moins le n° de rapport et la commune."; err.style.display = "block"; return; }
    if (!nd.indicateurNom || !nd.indicateurPrenom || !nd.indicateurTelephone) {
      err.textContent = "L'envoi est bloqué : renseignez le nom, le prénom et le téléphone de l'indicateur de terrain avant de continuer.";
      err.style.display = "block";
      state.editing = nd; render();
      document.getElementById("f-indicateurNom").scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    state.editing = nd; state.previewMode = true; render();
  };
  if (d.trackingActif && !state.tickInterval) {
    state.tickInterval = setInterval(() => {
      const el = document.getElementById("temps-total-live");
      if (el && state.editing) el.textContent = fmtDuration(Date.now() - new Date(state.editing.heureDebutMission).getTime());
    }, 1000);
  }
}

async function doLogout() {
  stopTracking();
  try { await fetch(`${API}/logout`, { method: "POST" }); } catch (e) {}
  state.user = null; state.role = null; state.agentName = "";
  state.dossiers = []; state.requisitions = []; state.users = [];
  state.editing = null; state.activeDossierId = null; state.newRequisition = null; state.managingUsers = false;
  render();
}

function updateQuitButton() {
  const btn = document.getElementById("btn-quit-anywhere");
  if (!btn) return;
  if (!state.role) { btn.style.display = "none"; return; }
  btn.style.display = "block";
  btn.onclick = async () => {
    if (state.editing && !state.previewMode && document.getElementById("f-numeroRapport")) {
      const nd = collectFicheForm(state.editing);
      await saveDossier(nd);
      stopTracking();
    } else if (state.activeDossierId && document.getElementById("e-conclusion")) {
      const d = state.dossiers.find((x) => x.id === state.activeDossierId);
      if (d) {
        const updated = collectExpertForm(d);
        if (updated.statut === "envoye") updated.statut = "en_traitement";
        await saveDossier(updated);
      }
    }
    state.editing = null; state.previewMode = false; state.activeDossierId = null;
    state.newRequisition = null; state.managingUsers = false; state.editingUserId = null;
    await loadAll();
    render();
  };
}

async function render() {
  const app = document.getElementById("app");
  updateQuitButton();

  if (!state.role) {
    app.innerHTML = screenLogin();
    const doLogin = async () => {
      const username = document.getElementById("login-username").value.trim();
      const password = document.getElementById("login-password").value;
      const err = document.getElementById("login-error");
      err.style.display = "none";
      if (!username || !password) { err.textContent = "Identifiant et mot de passe requis."; err.style.display = "block"; return; }
      try {
        const user = await api("/login", { method: "POST", body: JSON.stringify({ username, password }) });
        state.user = user; state.role = user.role; state.agentName = user.displayName;
        await loadAll();
        render();
      } catch (e) {
        err.textContent = e.message; err.style.display = "block";
      }
    };
    document.getElementById("btn-login").onclick = doLogin;
    document.getElementById("login-password").onkeydown = (e) => { if (e.key === "Enter") doLogin(); };
    return;
  }

  if (state.role === "agent") {
    if (state.editing && state.previewMode) {
      app.innerHTML = screenPreview(state.editing);
      document.getElementById("btn-back-to-edit").onclick = () => { state.previewMode = false; render(); };
      document.getElementById("btn-print-pdf").onclick = printPreview;
      document.getElementById("btn-download-report-pdf").onclick = async () => {
        const nd = collectFicheForm(state.editing);
        const saved = await saveDossier(nd);
        state.editing = saved;
        window.open(`${API}/dossiers/${saved.id}/report.pdf`, "_blank");
      };
      document.getElementById("btn-download-report-docx").onclick = async () => {
        const nd = collectFicheForm(state.editing);
        const saved = await saveDossier(nd);
        state.editing = saved;
        window.open(`${API}/dossiers/${saved.id}/report.docx`, "_blank");
      };
      document.getElementById("btn-share-whatsapp").onclick = () => shareReportViaWhatsApp(state.editing);
      document.getElementById("btn-confirm-send").onclick = async (ev) => {
        const d = state.editing;
        d.statut = "envoye"; d.dateEnvoi = nowISO(); d.dernierModifiePar = state.agentName;
        await saveDossier(d);
        ev.currentTarget.disabled = true;
        document.getElementById("send-confirm-check").style.display = "inline-block";
        await loadAll();
        setTimeout(() => { state.editing = null; state.previewMode = false; render(); }, 1200);
      };
      return;
    }
    if (state.editing) { app.innerHTML = screenFicheForm(state.editing); attachFicheHandlers(state.editing); return; }
    app.innerHTML = screenAgentHome();
    document.getElementById("btn-logout").onclick = doLogout;
    state.requisitions
      .filter((r) => r.statut === "en_attente" && !r.vuParAgentAt && (!r.assignedAgent || r.assignedAgent === state.agentName))
      .forEach((r) => { api(`/requisitions/${r.id}/vu`, { method: "POST" }).catch(() => {}); });
    document.querySelectorAll(".req-row").forEach((row) => {
      row.onclick = async () => {
        const r = state.requisitions.find((x) => x.id === row.getAttribute("data-id"));
        if (!r) return;
        const saved = await saveDossier(emptyDossier(r));
        await api(`/requisitions/${r.id}/demarrer`, { method: "POST" });
        await loadAll();
        state.editing = saved;
        render();
      };
      const link = row.querySelector(".req-attachment-link");
      if (link) link.onclick = (e) => e.stopPropagation();
    });
    document.querySelectorAll(".mine-row").forEach((row) => {
      row.onclick = () => {
        const d = state.dossiers.find((x) => x.id === row.getAttribute("data-id"));
        if (d && (d.statut === "brouillon" || d.statut === "envoye")) { state.editing = d; render(); }
      };
      const delBtn = row.querySelector(".btn-delete-mine");
      if (delBtn) delBtn.onclick = async (e) => {
        e.stopPropagation();
        const d = state.dossiers.find((x) => x.id === row.getAttribute("data-id"));
        if (!(await showConfirm(`Supprimer définitivement la fiche ${d && d.numeroRapport ? d.numeroRapport : ""} ? Cette action est irréversible.`))) return;
        try {
          await api(`/dossiers/${row.getAttribute("data-id")}`, { method: "DELETE" });
          await loadAll(); render();
        } catch (err) {
          showAlert(err.message);
        }
      };
    });
    return;
  }

  if (state.role === "expert") {
    if (state.managingUsers) {
      app.innerHTML = screenManageUsers();
      document.getElementById("btn-back-users").onclick = () => { state.managingUsers = false; state.editingUserId = null; render(); };
      const createBtn = document.getElementById("btn-create-user");
      if (createBtn) createBtn.onclick = async () => {
        const username = document.getElementById("nu-username").value.trim();
        const displayName = document.getElementById("nu-displayName").value.trim();
        const telephone = document.getElementById("nu-telephone").value.trim();
        const qualification = document.getElementById("nu-qualification").value.trim();
        const password = document.getElementById("nu-password").value;
        const err = document.getElementById("nu-error");
        err.style.display = "none";
        try {
          await api("/users", { method: "POST", body: JSON.stringify({ username, password, displayName, telephone, qualification }) });
          state.users = await api("/users");
          render();
        } catch (e) {
          err.textContent = e.message; err.style.display = "block";
        }
      };
      const cancelEditBtn = document.getElementById("btn-cancel-edit-user");
      if (cancelEditBtn) cancelEditBtn.onclick = () => { state.editingUserId = null; render(); };
      const saveEditBtn = document.getElementById("btn-save-edit-user");
      if (saveEditBtn) saveEditBtn.onclick = async () => {
        const displayName = document.getElementById("eu-displayName").value.trim();
        const telephone = document.getElementById("eu-telephone").value.trim();
        const qualification = document.getElementById("eu-qualification").value.trim();
        const password = document.getElementById("eu-password").value;
        const err = document.getElementById("eu-error");
        err.style.display = "none";
        try {
          const body = { displayName, telephone, qualification };
          if (password) body.password = password;
          await api(`/users/${state.editingUserId}`, { method: "PATCH", body: JSON.stringify(body) });
          state.editingUserId = null;
          state.users = await api("/users");
          render();
        } catch (e) {
          err.textContent = e.message; err.style.display = "block";
        }
      };
      document.querySelectorAll(".btn-edit-user").forEach((btn) => {
        btn.onclick = () => { state.editingUserId = btn.getAttribute("data-id"); render(); };
      });
      document.querySelectorAll(".btn-toggle-user").forEach((btn) => {
        btn.onclick = async () => {
          const id = btn.getAttribute("data-id");
          const active = btn.getAttribute("data-active") === "1";
          await api(`/users/${id}`, { method: "PATCH", body: JSON.stringify({ active: !active }) });
          state.users = await api("/users");
          render();
        };
      });
      document.querySelectorAll(".btn-delete-user").forEach((btn) => {
        btn.onclick = async () => {
          const id = btn.getAttribute("data-id");
          const u = state.users.find((x) => x.id === id);
          if (!(await showConfirm(`Supprimer définitivement le compte de ${u ? u.displayName : "cet agent"} ? Cette action est irréversible.`))) return;
          try {
            await api(`/users/${id}`, { method: "DELETE" });
            state.users = await api("/users");
            render();
          } catch (e) {
            showAlert(e.message);
          }
        };
      });
      return;
    }
    if (state.newRequisition) {
      app.innerHTML = screenRequisitionForm(state.newRequisition);
      document.getElementById("btn-cancel-req").onclick = () => { state.newRequisition = null; render(); };
      document.getElementById("r-fichierRequisition").onchange = (e) => {
        const hasFile = e.target.files.length > 0;
        const marker = document.getElementById("r-siteIndicatif").closest("label").querySelector(".required, .optional");
        if (marker) {
          marker.textContent = hasFile ? "(facultatif — document joint)" : "*";
          marker.className = hasFile ? "optional" : "required";
        }
      };
      document.getElementById("btn-download-req-pdf").onclick = () => {
        printRequisition(collectRequisitionForm(state.newRequisition));
      };
      document.getElementById("btn-send-requisition").onclick = async () => {
        const r = collectRequisitionForm(state.newRequisition);
        const err = document.getElementById("req-error");
        const file = document.getElementById("r-fichierRequisition").files[0];
        try {
          if (r.id) {
            await api(`/requisitions/${r.id}`, { method: "PATCH", body: JSON.stringify(r) });
          } else {
            const fd = new FormData();
            Object.entries(r).forEach(([k, v]) => fd.append(k, v == null ? "" : v));
            if (file) fd.append("fichierRequisition", file);
            const res = await fetch(`${API}/requisitions`, { method: "POST", body: fd });
            if (!res.ok) { const body = await res.json().catch(() => ({})); throw new Error(body.error || "Erreur serveur"); }
          }
          state.newRequisition = null;
          await loadAll(); render();
        } catch (e) {
          err.textContent = e.message; err.style.display = "block";
        }
      };
      return;
    }
    if (state.activeDossierId) {
      const d = state.dossiers.find((x) => x.id === state.activeDossierId);
      app.innerHTML = screenExpertDetail(d);
      document.getElementById("btn-back-expert").onclick = () => { state.activeDossierId = null; render(); };
      const expertVisibleList = () => {
        let list = state.dossiers.filter((x) => x.statut !== "brouillon");
        if (state.filterAgent) list = list.filter((x) => x.agentName === state.filterAgent);
        if (state.filterStatut && state.filterStatut !== "req_attente") list = list.filter((x) => x.statut === state.filterStatut);
        return list;
      };
      document.getElementById("btn-nav-quit-expert").onclick = async () => {
        const updated = collectExpertForm(d);
        if (updated.statut === "envoye") updated.statut = "en_traitement";
        await saveDossier(updated);
        state.activeDossierId = null;
        await loadAll(); render();
      };
      document.getElementById("btn-nav-prev-expert").onclick = async () => {
        let updated = collectExpertForm(d);
        if (updated.statut === "envoye") updated.statut = "en_traitement";
        const saved = await saveDossier(updated);
        await loadAll();
        const list = expertVisibleList();
        const idx = list.findIndex((x) => x.id === saved.id);
        state.activeDossierId = idx > 0 ? list[idx - 1].id : saved.id;
        render();
      };
      document.getElementById("btn-nav-next-expert").onclick = async () => {
        let updated = collectExpertForm(d);
        if (updated.statut === "envoye") updated.statut = "en_traitement";
        const saved = await saveDossier(updated);
        await loadAll();
        const list = expertVisibleList();
        const idx = list.findIndex((x) => x.id === saved.id);
        state.activeDossierId = idx >= 0 && idx < list.length - 1 ? list[idx + 1].id : saved.id;
        render();
      };
      document.getElementById("btn-prix-reference").onclick = async () => {
        const box = document.getElementById("prix-reference-result");
        box.innerHTML = '<div class="muted">Recherche…</div>';
        try {
          const params = new URLSearchParams();
          if (d.commune) params.set("commune", d.commune);
          if (d.typeBien) params.set("typeBien", d.typeBien);
          const rows = await api(`/prix-reference?${params.toString()}`);
          const others = rows.filter((r) => r.id !== d.id);
          box.innerHTML = others.length === 0
            ? '<div class="muted">Aucun dossier comparable trouvé (même commune / type de bien).</div>'
            : `<div class="card">${others.map((r) => `
              <div class="list-row"><div>
                <div style="font-weight:600">${esc(r.numeroRapport) || "—"} — ${esc(r.commune)}${r.quartier ? ", " + esc(r.quartier) : ""}</div>
                <div class="muted">${esc(r.typeBien)} · ${esc(r.superficie) || "?"} m² · ${esc(r.methodeEvaluation) || "—"}</div>
              </div><div style="font-weight:600">${esc(r.prixReference)} FCFA/m²</div></div>`).join("")}</div>`;
        } catch (e) {
          box.innerHTML = `<div class="error-text" style="display:block">${esc(e.message)}</div>`;
        }
      };
      document.querySelectorAll(".ep-piece-row[data-id]").forEach((row) => {
        const p = d.pieces.find((x) => x.id === row.getAttribute("data-id"));
        if (!p) return;
        row.querySelector(".ep-prixUnitaire").oninput = (e) => {
          p.prixUnitaire = e.target.value;
          const qte = parseFloat(p.quantite) || 0, superficie = parseFloat(p.superficie) || 0, prixUnitaire = parseFloat(p.prixUnitaire) || 0;
          const montant = qte * superficie * prixUnitaire;
          row.querySelector(".ep-montant").textContent = montant ? montant.toLocaleString("fr-FR") : "—";
          const totalMontant = d.pieces.reduce((sum, x) => sum + (parseFloat(x.quantite) || 0) * (parseFloat(x.superficie) || 0) * (parseFloat(x.prixUnitaire) || 0), 0);
          const totalEl = document.getElementById("ep-total-montant");
          if (totalEl) totalEl.textContent = totalMontant.toLocaleString("fr-FR");
        };
      });
      document.getElementById("btn-download-excel").onclick = async () => {
        const updated = collectExpertForm(d);
        const saved = await saveDossier(updated);
        window.open(`${API}/dossiers/${saved.id}/export.xlsx`, "_blank");
      };
      document.getElementById("btn-save-expert").onclick = async () => {
        let updated = collectExpertForm(d);
        if (updated.statut === "envoye") updated.statut = "en_traitement";
        await saveDossier(updated);
        await loadAll(); render();
      };
      document.getElementById("btn-generate-report").onclick = async () => {
        let updated = collectExpertForm(d);
        const err = document.getElementById("expert-error");
        if (!updated.prixChoisi || !updated.conclusion) {
          err.textContent = "Impossible de générer le rapport : renseignez le prix choisi et la conclusion avant de continuer.";
          err.style.display = "block";
          document.getElementById("e-conclusion").scrollIntoView({ behavior: "smooth", block: "center" });
          return;
        }
        err.style.display = "none";
        updated.statut = "rapport_genere";
        const saved = await saveDossier(updated);
        document.getElementById("report-preview").innerHTML = previewHTML(saved, "expert") +
          `<div class="badge badge-ok" style="margin-top:10px;display:inline-block">✓ Rapport généré et envoyé par email à l'expert</div><div class="btn-row" style="margin-top:10px">
          <button type="button" id="btn-download-final-report">⬇ Rapport PDF officiel (numéroté)</button>
          <button type="button" id="btn-download-final-report-docx">⬇ Rapport Word (.docx)</button>
          <button type="button" id="btn-share-whatsapp-final">📤 Partager par WhatsApp</button>
          </div>`;
        document.getElementById("btn-download-final-report").onclick = () => {
          window.open(`${API}/dossiers/${saved.id}/report.pdf`, "_blank");
        };
        document.getElementById("btn-share-whatsapp-final").onclick = () => shareReportViaWhatsApp(saved);
        document.getElementById("btn-download-final-report-docx").onclick = () => {
          window.open(`${API}/dossiers/${saved.id}/report.docx`, "_blank");
        };
      };
      document.getElementById("btn-delete-expert").onclick = async () => {
        if (!(await showConfirm(`Supprimer définitivement le dossier ${d.numeroRapport || ""} de l'agent ${d.agentName} ? Cette action est irréversible.`))) return;
        await api(`/dossiers/${d.id}`, { method: "DELETE" });
        state.activeDossierId = null;
        await loadAll(); render();
      };
      return;
    }
    app.innerHTML = screenExpertHome();
    document.getElementById("btn-logout").onclick = doLogout;
    document.getElementById("btn-manage-users").onclick = async () => { state.users = await api("/users"); state.managingUsers = true; render(); };
    document.getElementById("btn-new-requisition").onclick = () => { state.newRequisition = emptyRequisition(); render(); };
    document.getElementById("btn-go-agent").onclick = () => { state.filterAgent = document.getElementById("f-filter-agent").value; render(); };
    const clearBtn = document.getElementById("btn-clear-agent-filter");
    if (clearBtn) clearBtn.onclick = () => { state.filterAgent = ""; state.filterStatut = ""; render(); };
    document.querySelectorAll(".metric-card-link").forEach((btn) => {
      btn.onclick = () => {
        const statut = btn.getAttribute("data-statut");
        state.filterStatut = state.filterStatut === statut ? "" : statut;
        render();
      };
    });
    document.querySelectorAll(".dossier-row").forEach((row) => {
      row.onclick = () => { state.activeDossierId = row.getAttribute("data-id"); render(); };
      const editBtn = row.querySelector(".btn-edit-dossier");
      if (editBtn) editBtn.onclick = (e) => { e.stopPropagation(); state.activeDossierId = row.getAttribute("data-id"); render(); };
      const delBtn = row.querySelector(".btn-delete-dossier");
      if (delBtn) delBtn.onclick = async (e) => {
        e.stopPropagation();
        const id = row.getAttribute("data-id");
        const dd = state.dossiers.find((x) => x.id === id);
        if (!(await showConfirm(`Supprimer définitivement le dossier ${dd && dd.numeroRapport ? dd.numeroRapport : ""} de l'agent ${dd ? dd.agentName : ""} ? Cette action est irréversible.`))) return;
        await api(`/dossiers/${id}`, { method: "DELETE" });
        await loadAll(); render();
      };
    });
    document.querySelectorAll(".btn-edit-req").forEach((btn) => {
      btn.onclick = () => {
        const r = state.requisitions.find((x) => x.id === btn.getAttribute("data-id"));
        state.newRequisition = { ...r };
        render();
      };
    });
    document.querySelectorAll(".btn-delete-req").forEach((btn) => {
      btn.onclick = async () => {
        const id = btn.getAttribute("data-id");
        const r = state.requisitions.find((x) => x.id === id);
        if (!(await showConfirm(`Supprimer définitivement la réquisition "${r ? r.siteIndicatif : ""}" ? Cette action est irréversible.`))) return;
        await api(`/requisitions/${id}`, { method: "DELETE" });
        await loadAll(); render();
      };
    });
    return;
  }
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/service-worker.js").catch(() => {}));
}

(async function init() {
  document.getElementById("app").innerHTML = '<div class="muted">Chargement…</div>';
  try {
    const res = await fetch(`${API}/me`);
    if (res.ok) {
      const user = await res.json();
      state.user = user; state.role = user.role; state.agentName = user.displayName;
      await loadAll();
    }
  } catch (e) {
    console.error(e);
  }
  render();
})();
