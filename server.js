require("dotenv").config();
const express = require("express");
const session = require("express-session");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const Database = require("better-sqlite3");
const nodemailer = require("nodemailer");
const ExcelJS = require("exceljs");
const PDFDocument = require("pdfkit");
const { Document: DocxDocument, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, ImageRun, AlignmentType } = require("docx");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, "data");
const UPLOAD_DIR = path.join(__dirname, "uploads");
const LOGO_PATH = path.join(__dirname, "public", "logo.png");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ---------- Database ----------
const db = new Database(path.join(DATA_DIR, "iqra.db"));
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS requisitions (
  id TEXT PRIMARY KEY,
  dateCreation TEXT,
  referenceDossier TEXT,
  clientNom TEXT, clientTelephone TEXT, clientEmail TEXT,
  mandantType TEXT, mandantNom TEXT, mandantTelephone TEXT,
  siteIndicatif TEXT, instructionsExpert TEXT,
  fichierRequisitionPath TEXT,
  assignedAgent TEXT,
  vuParAgentAt TEXT,
  statut TEXT DEFAULT 'en_attente'
);

CREATE TABLE IF NOT EXISTS dossiers (
  id TEXT PRIMARY KEY,
  requisitionId TEXT,
  agentName TEXT,
  dateVisite TEXT,
  numeroRapport TEXT, nomSite TEXT,
  typeMission TEXT, demandeur TEXT, clientNom TEXT, clientTelephone TEXT,
  mandantType TEXT, mandantNom TEXT, referenceDossier TEXT,
  equipeJson TEXT, moyenDeplacement TEXT,
  indicateurType TEXT, indicateurNom TEXT, indicateurPrenom TEXT, indicateurTelephone TEXT,
  commune TEXT, quartier TEXT, cercle TEXT, region TEXT, bamakoDistrict TEXT, adresse TEXT,
  lat REAL, lon REAL, utmJson TEXT,
  typeTitre TEXT, numeroTitre TEXT, numeroRequisitionCadastrale TEXT, titulaire TEXT,
  natureParcelleJson TEXT, etatTerrainJson TEXT, vrdJson TEXT, etatBatiment TEXT, difficultesRencontrees TEXT,
  longueurParcelle TEXT, largeurParcelle TEXT, hauteurMur TEXT, hauteurAcrotere TEXT,
  gpsAnglesJson TEXT,
  piecesJson TEXT,
  annexesJson TEXT,
  typeBien TEXT, superficie TEXT, description TEXT, observationsAgent TEXT,
  heureDebutMission TEXT, heureArriveeSite TEXT, heureFinMission TEXT,
  trackingPointsJson TEXT, distanceParcourue REAL DEFAULT 0,
  statut TEXT DEFAULT 'brouillon',
  expertNotes TEXT, prixReference TEXT, prixBase TEXT, prixChoisi TEXT, methodeEvaluation TEXT, conclusion TEXT,
  dateEnvoi TEXT, dernierModifiePar TEXT
);

CREATE TABLE IF NOT EXISTS photos (
  id TEXT PRIMARY KEY,
  dossierId TEXT,
  filename TEXT,
  t TEXT,
  FOREIGN KEY(dossierId) REFERENCES dossiers(id)
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE,
  passwordHash TEXT,
  role TEXT,
  displayName TEXT,
  telephone TEXT,
  qualification TEXT,
  active INTEGER DEFAULT 1,
  createdAt TEXT
);
`);

// ---------- Migrations (ajout de colonnes sur une base déjà existante) ----------
function ensureColumn(table, column, def) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
}
ensureColumn("dossiers", "hauteurMur", "TEXT");
ensureColumn("dossiers", "hauteurAcrotere", "TEXT");
ensureColumn("dossiers", "prixBase", "TEXT");
ensureColumn("dossiers", "prixChoisi", "TEXT");
ensureColumn("dossiers", "etatBatiment", "TEXT");
ensureColumn("users", "telephone", "TEXT");
ensureColumn("users", "qualification", "TEXT");
ensureColumn("requisitions", "fichierRequisitionPath", "TEXT");
ensureColumn("requisitions", "assignedAgent", "TEXT");
ensureColumn("requisitions", "vuParAgentAt", "TEXT");

// ---------- Uploads (photos) ----------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || ".jpg";
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 15 * 1024 * 1024 } });

// Réquisitions : chaque fichier va dans son propre sous-dossier uploads/requisitions/<id>/
const requisitionStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(UPLOAD_DIR, "requisitions", req.reqId);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || ".pdf";
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
  },
});
const requisitionUpload = multer({ storage: requisitionStorage, limits: { fileSize: 15 * 1024 * 1024 } });

// ---------- Email (optional, requires .env credentials) ----------
let transporter = null;
if (process.env.SMTP_USER && process.env.SMTP_PASS) {
  transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}
async function notifyExpert(subject, text, attachments) {
  if (!transporter) {
    console.log("[email non configuré] Aurait envoyé:", subject);
    return;
  }
  try {
    await transporter.sendMail({
      from: process.env.SMTP_USER,
      to: process.env.EXPERT_EMAIL || "iqraexpertise@gmail.com",
      subject,
      text,
      attachments,
    });
  } catch (e) {
    console.error("Erreur envoi email:", e.message);
  }
}

// ---------- Auth helpers ----------
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  const [salt, hash] = (stored || "").split(":");
  if (!salt || !hash) return false;
  const hashBuffer = Buffer.from(hash, "hex");
  const suppliedBuffer = crypto.scryptSync(password, salt, 64);
  return hashBuffer.length === suppliedBuffer.length && crypto.timingSafeEqual(hashBuffer, suppliedBuffer);
}
function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: "Non connecté" });
  next();
}
function requireExpert(req, res, next) {
  if (req.session.role !== "expert") return res.status(403).json({ error: "Réservé à l'expert" });
  next();
}

// ---------- Middleware ----------
app.set("trust proxy", 1);
app.use(express.json({ limit: "10mb" }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev-secret-change-me-in-.env",
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 12 * 3600 * 1000 },
  })
);
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", requireAuth, express.static(UPLOAD_DIR));

// ---------- Helpers ----------
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const nowISO = () => new Date().toISOString();
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---------- Seed initial expert account ----------
(function seedExpertIfNeeded() {
  const count = db.prepare("SELECT COUNT(*) c FROM users WHERE role = 'expert'").get().c;
  if (count > 0) return;
  const username = process.env.EXPERT_USERNAME || "expert";
  let password = process.env.EXPERT_PASSWORD;
  const generated = !password;
  if (generated) password = crypto.randomBytes(6).toString("hex");
  db.prepare(
    "INSERT INTO users (id,username,passwordHash,role,displayName,active,createdAt) VALUES (?,?,?,?,?,1,?)"
  ).run(uid(), username, hashPassword(password), "expert", "Expert", nowISO());
  console.log("=".repeat(60));
  console.log(`Compte expert initial créé — identifiant : ${username}`);
  if (generated) console.log(`Mot de passe généré (à noter et changer) : ${password}`);
  else console.log("Mot de passe : celui défini dans EXPERT_PASSWORD (.env)");
  console.log("=".repeat(60));
})();

const COEFFICIENTS_ETAT_BATIMENT = {
  "Neuf": 1.0,
  "Bon état": 0.9,
  "État moyen": 0.75,
  "Mauvais état": 0.55,
  "Vétuste": 0.4,
  "En ruine": 0.2,
};
function coefficientEtatBatiment(etat) {
  return COEFFICIENTS_ETAT_BATIMENT[etat] != null ? COEFFICIENTS_ETAT_BATIMENT[etat] : 1.0;
}

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

function computeParcelGeometry(d) {
  const a = d.gpsAngles || {};
  const pts = ["P1", "P2", "P3", "P4"].map((k) => a[k]).filter(Boolean);
  if (pts.length < 3) return null;
  const latRef = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
  const lonRef = pts.reduce((s, p) => s + p.lon, 0) / pts.length;
  const toXY = (p) => [(p.lon - lonRef) * 111320 * Math.cos((latRef * Math.PI) / 180), -(p.lat - latRef) * 110540];
  const xy = pts.map(toXY);
  const xs = xy.map((p) => p[0]), ys = xy.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const centreSrc = a.Centre || (d.lat != null ? { lat: d.lat, lon: d.lon } : null);
  const centre = centreSrc ? toXY(centreSrc) : [(minX + maxX) / 2, (minY + maxY) / 2];
  const nomClient = (d.clientNom || d.mandantNom || d.demandeur || "CLIENT").toUpperCase().trim().replace(/\s+/g, "_");
  return {
    points: xy,
    bounds: { minX, maxX, minY, maxY },
    centre,
    label: `CONCESSION_${nomClient}`,
    titre: d.numeroTitre ? `${d.typeTitre || ""} n°${d.numeroTitre}` : "",
  };
}

function drawWatermark(doc) {
  if (!fs.existsSync(LOGO_PATH)) return;
  const pageWidth = doc.page.width, pageHeight = doc.page.height;
  doc.save();
  doc.opacity(0.06).image(LOGO_PATH, pageWidth / 2 - 150, pageHeight / 2 - 75, { width: 300 });
  doc.restore();
}
function drawHeaderFooterChrome(doc, pageNum, totalPages) {
  const pageWidth = doc.page.width, pageHeight = doc.page.height;
  const originalBottomMargin = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;
  doc.save();
  if (fs.existsSync(LOGO_PATH)) doc.image(LOGO_PATH, 40, 20, { height: 28 });
  doc.fillColor("#1b5e20").fontSize(13).font("Helvetica-Bold").text("IQRA EXPERT", 100, 22, { lineBreak: false });
  doc.fillColor("#666").fontSize(8).font("Helvetica").text("Ingénierie Qualité Recherche et Assistance en Expertise", 100, 38, { lineBreak: false });
  doc.moveTo(40, 58).lineTo(pageWidth - 40, 58).strokeColor("#2e7d32").lineWidth(1).stroke();
  doc.moveTo(40, pageHeight - 40).lineTo(pageWidth - 40, pageHeight - 40).strokeColor("#ddd").lineWidth(0.5).stroke();
  doc.fillColor("#666").fontSize(8).text(`Document généré le ${new Date().toLocaleDateString("fr-FR")}`, 40, pageHeight - 32, { lineBreak: false });
  doc.text(`Page ${pageNum} / ${totalPages}`, 40, pageHeight - 32, { align: "right", width: pageWidth - 80, lineBreak: false });
  doc.restore();
  doc.page.margins.bottom = originalBottomMargin;
}

function drawParcelDiagram(doc, geometry, x, y, boxSize) {
  const { points, bounds, centre, label, titre } = geometry;
  const w = Math.max(bounds.maxX - bounds.minX, 1), h = Math.max(bounds.maxY - bounds.minY, 1);
  const scale = (boxSize * 0.7) / Math.max(w, h);
  const project = ([px, py]) => [x + boxSize / 2 + (px - (bounds.minX + bounds.maxX) / 2) * scale, y + boxSize / 2 + (py - (bounds.minY + bounds.maxY) / 2) * scale];
  const poly = points.map(project);
  doc.save();
  doc.rect(x, y, boxSize, boxSize).fillColor("#f7f7f5").fill();
  doc.polygon(...poly).fillColor("#cfe8cf").fillOpacity(0.7).fill().fillOpacity(1);
  doc.polygon(...poly).strokeColor("#2e7d32").lineWidth(1.2).stroke();
  poly.forEach((p, i) => {
    doc.circle(p[0], p[1], 2.5).fillColor("#2e7d32").fill();
    doc.fillColor("#111").fontSize(8).text(`P${i + 1}`, p[0] - 8, p[1] - 14, { width: 16, align: "center" });
  });
  const c = project(centre);
  doc.circle(c[0], c[1], 2.5).fillColor("#b71c1c").fill();
  doc.fillColor("#b71c1c").fontSize(7).text(label, x, c[1] + 6, { width: boxSize, align: "center" });
  if (titre) doc.fillColor("#444").fontSize(7).text(titre, x, c[1] + 16, { width: boxSize, align: "center" });
  doc.restore();
}

function rowToRequisition(r) {
  return r;
}
function rowToDossier(row) {
  if (!row) return null;
  const photos = db.prepare("SELECT id, filename, t FROM photos WHERE dossierId = ? ORDER BY t").all(row.id);
  return {
    ...row,
    equipe: JSON.parse(row.equipeJson || "[]"),
    utm: row.utmJson ? JSON.parse(row.utmJson) : null,
    natureParcelle: JSON.parse(row.natureParcelleJson || "[]"),
    etatTerrain: JSON.parse(row.etatTerrainJson || "[]"),
    vrd: JSON.parse(row.vrdJson || "[]"),
    gpsAngles: JSON.parse(row.gpsAnglesJson || "{}"),
    pieces: JSON.parse(row.piecesJson || "[]"),
    annexes: JSON.parse(row.annexesJson || "{}"),
    trackingPoints: JSON.parse(row.trackingPointsJson || "[]"),
    photos: photos.map((p) => ({ id: p.id, url: `/uploads/${p.filename}`, t: p.t })),
  };
}

// ---------- UTM conversion (server-side, authoritative) ----------
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
function gpsPointsList(d) {
  const pts = [];
  if (d.lat != null && d.lon != null) pts.push({ label: "Position centrale du site", lat: d.lat, lon: d.lon });
  const a = d.gpsAngles || {};
  [["P1", "Point P1"], ["P2", "Point P2"], ["P3", "Point P3"], ["P4", "Point P4"], ["Centre", "Centre de la parcelle"]].forEach(([k, label]) => {
    if (a[k] && a[k].lat != null && a[k].lon != null) pts.push({ label, lat: a[k].lat, lon: a[k].lon });
  });
  return pts.map((p) => ({ ...p, utm: toUTM(p.lat, p.lon) }));
}

// =========================================================
// API: Authentification
// =========================================================
app.post("/api/login", (req, res) => {
  const { username, password } = req.body || {};
  const user = db.prepare("SELECT * FROM users WHERE username = ? AND active = 1").get(username || "");
  if (!user || !verifyPassword(password || "", user.passwordHash)) {
    return res.status(401).json({ error: "Identifiant ou mot de passe incorrect." });
  }
  req.session.userId = user.id;
  req.session.role = user.role;
  res.json({ id: user.id, username: user.username, role: user.role, displayName: user.displayName });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("/api/me", requireAuth, (req, res) => {
  const user = db.prepare("SELECT id, username, role, displayName FROM users WHERE id = ? AND active = 1").get(req.session.userId);
  if (!user) return res.status(401).json({ error: "Non connecté" });
  res.json(user);
});

app.use("/api", requireAuth);

// =========================================================
// API: Comptes utilisateurs (réservé à l'expert)
// =========================================================
app.get("/api/users", requireExpert, (req, res) => {
  const rows = db.prepare("SELECT id, username, role, displayName, telephone, qualification, active, createdAt FROM users ORDER BY createdAt DESC").all();
  res.json(rows);
});

app.post("/api/users", requireExpert, (req, res) => {
  const { username, password, displayName, telephone, qualification } = req.body || {};
  if (!username || !password || password.length < 6) {
    return res.status(400).json({ error: "Identifiant et mot de passe (6 caractères minimum) requis." });
  }
  const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
  if (existing) return res.status(400).json({ error: "Cet identifiant existe déjà." });
  const u = {
    id: uid(),
    username,
    passwordHash: hashPassword(password),
    role: "agent",
    displayName: displayName || username,
    telephone: telephone || "",
    qualification: qualification || "",
    active: 1,
    createdAt: nowISO(),
  };
  db.prepare(
    "INSERT INTO users (id,username,passwordHash,role,displayName,telephone,qualification,active,createdAt) VALUES (@id,@username,@passwordHash,@role,@displayName,@telephone,@qualification,@active,@createdAt)"
  ).run(u);
  res.json({ id: u.id, username: u.username, role: u.role, displayName: u.displayName, telephone: u.telephone, qualification: u.qualification, active: u.active, createdAt: u.createdAt });
});

app.patch("/api/users/:id", requireExpert, (req, res) => {
  const existing = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
  if (!existing) return res.status(404).json({ error: "Introuvable" });
  const b = req.body || {};
  const updated = {
    id: req.params.id,
    active: b.active != null ? (b.active ? 1 : 0) : existing.active,
    displayName: b.displayName != null ? b.displayName : existing.displayName,
    telephone: b.telephone != null ? b.telephone : existing.telephone,
    qualification: b.qualification != null ? b.qualification : existing.qualification,
    passwordHash: b.password ? hashPassword(b.password) : existing.passwordHash,
  };
  db.prepare("UPDATE users SET active = @active, displayName = @displayName, telephone = @telephone, qualification = @qualification, passwordHash = @passwordHash WHERE id = @id")
    .run(updated);
  const row = db.prepare("SELECT id, username, role, displayName, telephone, qualification, active, createdAt FROM users WHERE id = ?").get(req.params.id);
  res.json(row);
});

app.delete("/api/users/:id", requireExpert, (req, res) => {
  const existing = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
  if (!existing) return res.status(404).json({ error: "Introuvable" });
  if (existing.id === req.session.userId) return res.status(400).json({ error: "Vous ne pouvez pas supprimer votre propre compte." });
  db.prepare("DELETE FROM users WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// =========================================================
// API: Réquisitions
// =========================================================
app.get("/api/requisitions", (req, res) => {
  const rows = db.prepare("SELECT * FROM requisitions ORDER BY dateCreation DESC").all();
  res.json(rows);
});

app.post("/api/requisitions", requireExpert, (req, res, next) => { req.reqId = uid(); next(); }, requisitionUpload.single("fichierRequisition"), ah(async (req, res) => {
  const b = req.body;
  if (!req.file && (!b.siteIndicatif || (!b.clientTelephone && !b.mandantNom))) {
    return res.status(400).json({ error: "Le site à visiter et un contact (téléphone client ou nom du mandant) sont obligatoires, sauf si vous joignez le document de réquisition scanné." });
  }
  const r = {
    id: req.reqId,
    dateCreation: nowISO(),
    referenceDossier: b.referenceDossier || "",
    clientNom: b.clientNom || "",
    clientTelephone: b.clientTelephone || "",
    clientEmail: b.clientEmail || "",
    mandantType: b.mandantType || "",
    mandantNom: b.mandantNom || "",
    mandantTelephone: b.mandantTelephone || "",
    siteIndicatif: b.siteIndicatif,
    instructionsExpert: b.instructionsExpert || "",
    fichierRequisitionPath: req.file ? `requisitions/${req.reqId}/${req.file.filename}` : null,
    assignedAgent: b.assignedAgent || "",
    vuParAgentAt: null,
    statut: "en_attente",
  };
  db.prepare(
    `INSERT INTO requisitions (id,dateCreation,referenceDossier,clientNom,clientTelephone,clientEmail,mandantType,mandantNom,mandantTelephone,siteIndicatif,instructionsExpert,fichierRequisitionPath,assignedAgent,vuParAgentAt,statut)
     VALUES (@id,@dateCreation,@referenceDossier,@clientNom,@clientTelephone,@clientEmail,@mandantType,@mandantNom,@mandantTelephone,@siteIndicatif,@instructionsExpert,@fichierRequisitionPath,@assignedAgent,@vuParAgentAt,@statut)`
  ).run(r);
  res.json(r);
}));

app.patch("/api/requisitions/:id", requireExpert, (req, res) => {
  const existing = db.prepare("SELECT * FROM requisitions WHERE id = ?").get(req.params.id);
  if (!existing) return res.status(404).json({ error: "Introuvable" });
  if (existing.statut !== "en_attente") {
    return res.status(403).json({ error: "L'agent a déjà démarré cette mission : la réquisition ne peut plus être modifiée par l'expert." });
  }
  const b = req.body || {};
  const updated = {
    id: req.params.id,
    statut: b.statut != null ? b.statut : existing.statut,
    referenceDossier: b.referenceDossier != null ? b.referenceDossier : existing.referenceDossier,
    clientNom: b.clientNom != null ? b.clientNom : existing.clientNom,
    clientTelephone: b.clientTelephone != null ? b.clientTelephone : existing.clientTelephone,
    clientEmail: b.clientEmail != null ? b.clientEmail : existing.clientEmail,
    mandantType: b.mandantType != null ? b.mandantType : existing.mandantType,
    mandantNom: b.mandantNom != null ? b.mandantNom : existing.mandantNom,
    mandantTelephone: b.mandantTelephone != null ? b.mandantTelephone : existing.mandantTelephone,
    siteIndicatif: b.siteIndicatif != null ? b.siteIndicatif : existing.siteIndicatif,
    instructionsExpert: b.instructionsExpert != null ? b.instructionsExpert : existing.instructionsExpert,
    assignedAgent: b.assignedAgent != null ? b.assignedAgent : existing.assignedAgent,
  };
  db.prepare(
    `UPDATE requisitions SET statut=@statut, referenceDossier=@referenceDossier, clientNom=@clientNom, clientTelephone=@clientTelephone, clientEmail=@clientEmail, mandantType=@mandantType, mandantNom=@mandantNom, mandantTelephone=@mandantTelephone, siteIndicatif=@siteIndicatif, instructionsExpert=@instructionsExpert, assignedAgent=@assignedAgent WHERE id=@id`
  ).run(updated);
  res.json(db.prepare("SELECT * FROM requisitions WHERE id = ?").get(req.params.id));
});

app.delete("/api/requisitions/:id", requireExpert, (req, res) => {
  const existing = db.prepare("SELECT * FROM requisitions WHERE id = ?").get(req.params.id);
  if (!existing) return res.status(404).json({ error: "Introuvable" });
  if (existing.statut !== "en_attente") {
    return res.status(403).json({ error: "L'agent a déjà démarré cette mission : la réquisition ne peut plus être supprimée par l'expert." });
  }
  if (existing.fichierRequisitionPath) {
    try { fs.rmSync(path.join(UPLOAD_DIR, "requisitions", existing.id), { recursive: true, force: true }); } catch (e) {}
  }
  db.prepare("DELETE FROM requisitions WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

app.post("/api/requisitions/:id/vu", (req, res) => {
  const existing = db.prepare("SELECT * FROM requisitions WHERE id = ?").get(req.params.id);
  if (!existing) return res.status(404).json({ error: "Introuvable" });
  if (!existing.vuParAgentAt) {
    db.prepare("UPDATE requisitions SET vuParAgentAt = ? WHERE id = ?").run(nowISO(), req.params.id);
  }
  res.json(db.prepare("SELECT * FROM requisitions WHERE id = ?").get(req.params.id));
});

app.post("/api/requisitions/:id/demarrer", (req, res) => {
  const existing = db.prepare("SELECT * FROM requisitions WHERE id = ?").get(req.params.id);
  if (!existing) return res.status(404).json({ error: "Introuvable" });
  if (existing.statut === "en_attente") {
    db.prepare("UPDATE requisitions SET statut = 'demarree', vuParAgentAt = COALESCE(vuParAgentAt, ?) WHERE id = ?").run(nowISO(), req.params.id);
  }
  res.json(db.prepare("SELECT * FROM requisitions WHERE id = ?").get(req.params.id));
});

// =========================================================
// API: Dossiers
// =========================================================
app.get("/api/dossiers", (req, res) => {
  const rows = db.prepare("SELECT * FROM dossiers ORDER BY dateVisite DESC").all();
  res.json(rows.map(rowToDossier));
});

app.get("/api/dossiers/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM dossiers WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Introuvable" });
  res.json(rowToDossier(row));
});

app.delete("/api/dossiers/:id", (req, res) => {
  const dossier = db.prepare("SELECT * FROM dossiers WHERE id = ?").get(req.params.id);
  if (!dossier) return res.status(404).json({ error: "Introuvable" });
  if (req.session.role === "expert") {
    if (dossier.statut === "brouillon") {
      return res.status(403).json({ error: "Mission de terrain en cours : l'expert ne peut pas supprimer ce dossier tant que l'agent n'a pas envoyé son rapport." });
    }
  } else {
    const user = db.prepare("SELECT displayName FROM users WHERE id = ?").get(req.session.userId);
    if (!user || dossier.agentName !== user.displayName) {
      return res.status(403).json({ error: "Vous ne pouvez supprimer que vos propres fiches." });
    }
  }
  const photos = db.prepare("SELECT filename FROM photos WHERE dossierId = ?").all(req.params.id);
  photos.forEach((p) => { try { fs.unlinkSync(path.join(UPLOAD_DIR, p.filename)); } catch (e) {} });
  db.prepare("DELETE FROM photos WHERE dossierId = ?").run(req.params.id);
  db.prepare("DELETE FROM dossiers WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

app.get("/api/dossiers/:id/export.xlsx", ah(async (req, res) => {
  const row = db.prepare("SELECT * FROM dossiers WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Introuvable" });
  const d = rowToDossier(row);

  const workbook = new ExcelJS.Workbook();
  const piecesSheet = workbook.addWorksheet("Pièces");
  piecesSheet.columns = [
    { header: "N°", key: "n", width: 6 },
    { header: "Désignation", key: "designation", width: 26 },
    { header: "Niveau", key: "niveau", width: 12 },
    { header: "Quantité", key: "quantite", width: 10 },
    { header: "Superficie (m²)", key: "superficie", width: 16 },
    { header: "Prix unitaire (FCFA)", key: "prixUnitaire", width: 18 },
    { header: "Montant (FCFA)", key: "montant", width: 18 },
  ];
  piecesSheet.getRow(1).font = { bold: true };
  let totalSuperficie = 0, totalMontant = 0;
  d.pieces.forEach((p, i) => {
    const qte = parseFloat(p.quantite) || 0;
    const superficie = parseFloat(p.superficie) || 0;
    const prixUnitaire = parseFloat(p.prixUnitaire) || 0;
    const montant = qte * superficie * prixUnitaire;
    totalSuperficie += qte * superficie;
    totalMontant += montant;
    piecesSheet.addRow({ n: i + 1, designation: p.designation || "", niveau: p.niveau || "", quantite: qte, superficie, prixUnitaire, montant });
  });
  const totalRow = piecesSheet.addRow({ designation: "TOTAL", superficie: totalSuperficie, montant: totalMontant });
  totalRow.font = { bold: true };

  const coefficient = coefficientEtatBatiment(d.etatBatiment);
  const prixRetenu = parseFloat(d.prixChoisi) || parseFloat(d.prixBase) || 0;
  const valeurEstimee = totalSuperficie * prixRetenu * coefficient;
  const calcSheet = workbook.addWorksheet("Calcul global");
  calcSheet.columns = [{ header: "", key: "label", width: 34 }, { header: "", key: "value", width: 24 }];
  [
    ["Dossier", `${d.numeroRapport || "—"} — ${d.nomSite || d.commune || ""}`],
    ["Superficie bâtie totale (m²)", totalSuperficie],
    ["État du bâtiment", d.etatBatiment || "—"],
    ["Coefficient appliqué", coefficient],
    ["Prix de base (FCFA/m²)", d.prixBase || "—"],
    ["Prix choisi par l'expert (FCFA/m²)", d.prixChoisi || "—"],
    ["Prix retenu pour le calcul (FCFA/m²)", prixRetenu],
    ["Valeur estimée (FCFA)", valeurEstimee],
  ].forEach((r) => calcSheet.addRow({ label: r[0], value: r[1] }));
  calcSheet.getColumn(1).font = { bold: true };

  const gpsPoints = gpsPointsList(d);
  if (gpsPoints.length) {
    const gpsSheet = workbook.addWorksheet("Coordonnées GPS");
    gpsSheet.columns = [
      { header: "Point", key: "point", width: 26 },
      { header: "Latitude", key: "lat", width: 14 },
      { header: "Longitude", key: "lon", width: 14 },
      { header: "Zone UTM", key: "zone", width: 10 },
      { header: "Easting (m)", key: "easting", width: 14 },
      { header: "Northing (m)", key: "northing", width: 14 },
    ];
    gpsPoints.forEach((p) => gpsSheet.addRow({ point: p.label, lat: p.lat, lon: p.lon, zone: `${p.utm.zone}${p.utm.hemisphere}`, easting: p.utm.easting, northing: p.utm.northing }));
    gpsSheet.getRow(1).font = { bold: true };
  }

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="dossier-${(d.numeroRapport || d.id).replace(/[^a-zA-Z0-9-_]/g, "_")}.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
}));

function generateReportPdfBuffer(d) {
  const isExpertReport = d.statut === "rapport_genere" || d.statut === "en_traitement";
  return new Promise((resolve, reject) => {
  const doc = new PDFDocument({ bufferPages: true, size: "A4", margins: { top: 80, bottom: 60, left: 50, right: 50 } });
  const chunks = [];
  doc.on("data", (chunk) => chunks.push(chunk));
  doc.on("end", () => resolve(Buffer.concat(chunks)));
  doc.on("error", reject);
  doc.on("pageAdded", () => drawWatermark(doc));
  drawWatermark(doc);

  const row2 = (k, v) => {
    const y = doc.y;
    doc.fillColor("#666").fontSize(9).font("Helvetica").text(k, 50, y, { width: 150 });
    doc.fillColor("#111").fontSize(9).font("Helvetica").text(v || "—", 210, y, { width: doc.page.width - 260 });
    doc.moveDown(0.3);
  };

  doc.fillColor("#111").fontSize(15).font("Helvetica-Bold").text(isExpertReport ? "Rapport d'expertise" : "Fiche de visite terrain", { align: "left" });
  doc.fillColor("#666").fontSize(10).font("Helvetica").text(`N° ${d.numeroRapport || "—"} — ${d.nomSite || d.commune || "—"}`);
  doc.moveDown(0.8);

  row2("Mandant / Client", `${d.mandantType || ""} ${d.mandantNom || ""}${d.clientNom ? " · " + d.clientNom : ""}`);
  row2("Équipe", (d.equipe || []).map((e) => e.nom).filter(Boolean).join(", "));
  row2("Indicateur de terrain", d.indicateurNom ? `${d.indicateurNom} ${d.indicateurPrenom} — ${d.indicateurTelephone} (${d.indicateurType})` : "");
  row2("Localisation", `${d.quartier || ""}, ${d.commune || "—"} (${d.cercle || "—"}, ${d.region || "—"})`);
  row2("Coordonnées UTM", d.utm ? `Zone ${d.utm.zone}${d.utm.hemisphere} — E ${d.utm.easting}, N ${d.utm.northing}` : "");
  row2("Titre", `${d.typeTitre || "—"} n°${d.numeroTitre || "—"}`);
  row2("Nature / État / VRD", [...(d.natureParcelle || []), ...(d.etatTerrain || []), ...(d.vrd || [])].join(", "));
  row2("Description de l'état du terrain", litteratureEtatTerrain(d.etatTerrain));
  row2("Dimensions parcelle", `${d.longueurParcelle || "—"} m × ${d.largeurParcelle || "—"} m`);
  row2("Hauteur murs / acrotère", `${d.hauteurMur || "—"} m / ${d.hauteurAcrotere || "—"} m`);
  row2("État du bâtiment", d.etatBatiment || "—");
  if (isExpertReport) {
    row2("Prix de base", d.prixBase ? `${d.prixBase} FCFA/m²` : "");
    row2("Prix choisi par l'expert", d.prixChoisi ? `${d.prixChoisi} FCFA/m²` : "");
    row2("Méthode d'évaluation", d.methodeEvaluation || "");
    row2("Conclusion", d.conclusion || "");
  }

  const geometry = computeParcelGeometry(d);
  if (geometry) {
    doc.moveDown(0.5);
    doc.fillColor("#111").fontSize(10).font("Helvetica-Bold").text("Périmètre de la parcelle");
    doc.moveDown(0.3);
    const boxSize = 220;
    if (doc.y + boxSize > doc.page.height - doc.page.margins.bottom) doc.addPage();
    const diagramTop = doc.y;
    drawParcelDiagram(doc, geometry, 50, diagramTop, boxSize);
    doc.x = 50;
    doc.y = diagramTop + boxSize + 10;
  }

  const gpsPoints = gpsPointsList(d);
  if (gpsPoints.length) {
    doc.moveDown(0.5);
    doc.fillColor("#111").fontSize(10).font("Helvetica-Bold").text("Tableau des coordonnées GPS");
    doc.moveDown(0.3);
    gpsPoints.forEach((p) => {
      row2(p.label, `Lat/Lon ${p.lat.toFixed(6)}, ${p.lon.toFixed(6)} — UTM Zone ${p.utm.zone}${p.utm.hemisphere} E ${p.utm.easting} N ${p.utm.northing}`);
    });
  }

  if (d.pieces && d.pieces.length) {
    doc.moveDown(0.5);
    doc.fillColor("#111").fontSize(10).font("Helvetica-Bold").text("Relevé des pièces");
    doc.moveDown(0.2);
    d.pieces.forEach((p) => {
      row2(p.designation || "—", `${p.niveau || ""} · Qté ${p.quantite || "—"} · ${p.superficie || "—"} m²`);
    });
  }

  if (d.photos && d.photos.length) {
    doc.addPage();
    doc.fillColor("#111").fontSize(10).font("Helvetica-Bold").text("Photos");
    doc.moveDown(0.3);
    let x = 50, y = doc.y;
    const imgSize = 150;
    d.photos.forEach((p, i) => {
      const filePath = path.join(UPLOAD_DIR, path.basename(p.url));
      if (fs.existsSync(filePath)) {
        try { doc.image(filePath, x, y, { width: imgSize, height: imgSize, fit: [imgSize, imgSize] }); } catch (e) {}
      }
      x += imgSize + 15;
      if ((i + 1) % 3 === 0) { x = 50; y += imgSize + 15; }
      if (y + imgSize > doc.page.height - doc.page.margins.bottom && (i + 1) % 3 === 0) { doc.addPage(); y = doc.y; }
    });
  }

  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    drawHeaderFooterChrome(doc, i + 1, range.count);
  }
  doc.end();
  });
}

async function generateReportDocxBuffer(d) {
  const isExpertReport = d.statut === "rapport_genere" || d.statut === "en_traitement";
  const rows = [
    ["Mandant / Client", `${d.mandantType || ""} ${d.mandantNom || ""}${d.clientNom ? " · " + d.clientNom : ""}`],
    ["Équipe", (d.equipe || []).map((e) => e.nom).filter(Boolean).join(", ")],
    ["Indicateur de terrain", d.indicateurNom ? `${d.indicateurNom} ${d.indicateurPrenom} — ${d.indicateurTelephone} (${d.indicateurType})` : ""],
    ["Localisation", `${d.quartier || ""}, ${d.commune || "—"} (${d.cercle || "—"}, ${d.region || "—"})`],
    ["Coordonnées UTM", d.utm ? `Zone ${d.utm.zone}${d.utm.hemisphere} — E ${d.utm.easting}, N ${d.utm.northing}` : ""],
    ["Titre", `${d.typeTitre || "—"} n°${d.numeroTitre || "—"}`],
    ["Nature / État / VRD", [...(d.natureParcelle || []), ...(d.etatTerrain || []), ...(d.vrd || [])].join(", ")],
    ["Description de l'état du terrain", litteratureEtatTerrain(d.etatTerrain)],
    ["Dimensions parcelle", `${d.longueurParcelle || "—"} m × ${d.largeurParcelle || "—"} m`],
    ["Hauteur murs / acrotère", `${d.hauteurMur || "—"} m / ${d.hauteurAcrotere || "—"} m`],
    ["État du bâtiment", d.etatBatiment || "—"],
  ];
  if (isExpertReport) {
    rows.push(
      ["Prix de base", d.prixBase ? `${d.prixBase} FCFA/m²` : ""],
      ["Prix choisi par l'expert", d.prixChoisi ? `${d.prixChoisi} FCFA/m²` : ""],
      ["Méthode d'évaluation", d.methodeEvaluation || ""],
      ["Conclusion", d.conclusion || ""]
    );
  }
  const cell = (text, opts = {}) => new TableCell({
    ...(opts.width ? { width: { size: opts.width, type: WidthType.DXA } } : {}),
    children: [new Paragraph({ children: [new TextRun({ text: text || "—", bold: !!opts.bold, color: opts.color })] })],
  });
  const infoTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map(([k, v]) => new TableRow({ children: [cell(k, { bold: true, width: 3000 }), cell(v)] })),
  });
  const children = [
    new Paragraph({ children: [new TextRun({ text: "IQRA EXPERT", bold: true, size: 32, color: "1b5e20" })] }),
    new Paragraph({ children: [new TextRun({ text: isExpertReport ? "Rapport d'expertise" : "Fiche de visite terrain", bold: true, size: 28 })] }),
    new Paragraph({ children: [new TextRun({ text: `N° ${d.numeroRapport || "—"} — ${d.nomSite || d.commune || "—"}`, color: "666666" })] }),
    new Paragraph({ text: "" }),
    infoTable,
    new Paragraph({ text: "" }),
  ];
  const gpsPointsDocx = gpsPointsList(d);
  if (gpsPointsDocx.length) {
    children.push(new Paragraph({ children: [new TextRun({ text: "Tableau des coordonnées GPS", bold: true })] }));
    children.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({ children: ["Point", "Latitude / Longitude", "UTM (WGS84)"].map((h) => cell(h, { bold: true })) }),
          ...gpsPointsDocx.map((p) => new TableRow({ children: [cell(p.label), cell(`${p.lat.toFixed(6)}, ${p.lon.toFixed(6)}`), cell(`Zone ${p.utm.zone}${p.utm.hemisphere} — E ${p.utm.easting}, N ${p.utm.northing}`)] })),
        ],
      })
    );
    children.push(new Paragraph({ text: "" }));
  }
  if (d.pieces && d.pieces.length) {
    children.push(new Paragraph({ children: [new TextRun({ text: "Relevé des pièces", bold: true })] }));
    children.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({ children: ["Désignation", "Niveau", "Qté", "Superficie"].map((h) => cell(h, { bold: true })) }),
          ...d.pieces.map((p) => new TableRow({ children: [cell(p.designation), cell(p.niveau), cell(String(p.quantite || "")), cell(p.superficie ? `${p.superficie} m²` : "")] })),
        ],
      })
    );
    children.push(new Paragraph({ text: "" }));
  }
  if (d.photos && d.photos.length) {
    children.push(new Paragraph({ children: [new TextRun({ text: "Photos", bold: true })] }));
    for (const p of d.photos) {
      const filePath = path.join(UPLOAD_DIR, path.basename(p.url));
      if (fs.existsSync(filePath)) {
        try {
          const data = fs.readFileSync(filePath);
          children.push(new Paragraph({ children: [new ImageRun({ data, transformation: { width: 280, height: 210 } })], alignment: AlignmentType.LEFT }));
        } catch (e) {}
      }
    }
  }
  const docx = new DocxDocument({ sections: [{ children }] });
  return Packer.toBuffer(docx);
}

app.get("/api/dossiers/:id/report.docx", ah(async (req, res) => {
  const row = db.prepare("SELECT * FROM dossiers WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Introuvable" });
  const d = rowToDossier(row);
  const buffer = await generateReportDocxBuffer(d);
  const filename = `rapport-${(d.numeroRapport || d.id).replace(/[^a-zA-Z0-9-_]/g, "_")}.docx`;
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.end(buffer);
}));

app.get("/api/dossiers/:id/report.pdf", ah(async (req, res) => {
  const row = db.prepare("SELECT * FROM dossiers WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Introuvable" });
  const d = rowToDossier(row);
  const buffer = await generateReportPdfBuffer(d);
  const filename = `rapport-${(d.numeroRapport || d.id).replace(/[^a-zA-Z0-9-_]/g, "_")}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `${req.query.dl ? "attachment" : "inline"}; filename="${filename}"`);
  res.end(buffer);
}));

// =========================================================
// API: Base de prix de référence (expertises terminées)
// =========================================================
app.get("/api/prix-reference", requireExpert, (req, res) => {
  const { commune, typeBien } = req.query;
  let sql = `SELECT id, commune, quartier, region, typeBien, superficie, prixReference, methodeEvaluation, dateVisite, numeroRapport
             FROM dossiers WHERE statut = 'rapport_genere' AND prixReference IS NOT NULL AND prixReference != ''`;
  const params = [];
  if (commune) { sql += " AND commune = ?"; params.push(commune); }
  if (typeBien) { sql += " AND typeBien = ?"; params.push(typeBien); }
  sql += " ORDER BY dateVisite DESC LIMIT 50";
  const rows = db.prepare(sql).all(...params);
  res.json(rows);
});

function upsertDossier(b) {
  const id = b.id || uid();
  const existing = db.prepare("SELECT id FROM dossiers WHERE id = ?").get(id);
  const utm = b.lat != null && b.lon != null ? toUTM(b.lat, b.lon) : null;
  const row = {
    id,
    requisitionId: b.requisitionId || null,
    agentName: b.agentName || "",
    dateVisite: b.dateVisite || nowISO().slice(0, 10),
    numeroRapport: b.numeroRapport || "",
    nomSite: b.nomSite || "",
    typeMission: b.typeMission || "",
    demandeur: b.demandeur || "",
    clientNom: b.clientNom || "",
    clientTelephone: b.clientTelephone || "",
    mandantType: b.mandantType || "",
    mandantNom: b.mandantNom || "",
    referenceDossier: b.referenceDossier || "",
    equipeJson: JSON.stringify(b.equipe || []),
    moyenDeplacement: b.moyenDeplacement || "",
    indicateurType: b.indicateurType || "",
    indicateurNom: b.indicateurNom || "",
    indicateurPrenom: b.indicateurPrenom || "",
    indicateurTelephone: b.indicateurTelephone || "",
    commune: b.commune || "",
    quartier: b.quartier || "",
    cercle: b.cercle || "",
    region: b.region || "",
    bamakoDistrict: b.bamakoDistrict || "",
    adresse: b.adresse || "",
    lat: b.lat != null ? b.lat : null,
    lon: b.lon != null ? b.lon : null,
    utmJson: utm ? JSON.stringify(utm) : null,
    typeTitre: b.typeTitre || "",
    numeroTitre: b.numeroTitre || "",
    numeroRequisitionCadastrale: b.numeroRequisitionCadastrale || "",
    titulaire: b.titulaire || "",
    natureParcelleJson: JSON.stringify(b.natureParcelle || []),
    etatTerrainJson: JSON.stringify(b.etatTerrain || []),
    etatBatiment: b.etatBatiment || "",
    vrdJson: JSON.stringify(b.vrd || []),
    difficultesRencontrees: b.difficultesRencontrees || "",
    longueurParcelle: b.longueurParcelle || "",
    largeurParcelle: b.largeurParcelle || "",
    hauteurMur: b.hauteurMur || "",
    hauteurAcrotere: b.hauteurAcrotere || "",
    gpsAnglesJson: JSON.stringify(b.gpsAngles || {}),
    piecesJson: JSON.stringify(b.pieces || []),
    annexesJson: JSON.stringify(b.annexes || {}),
    typeBien: b.typeBien || "",
    superficie: b.superficie || "",
    description: b.description || "",
    observationsAgent: b.observationsAgent || "",
    heureDebutMission: b.heureDebutMission || null,
    heureArriveeSite: b.heureArriveeSite || null,
    heureFinMission: b.heureFinMission || null,
    trackingPointsJson: JSON.stringify(b.trackingPoints || []),
    distanceParcourue: b.distanceParcourue || 0,
    statut: b.statut || "brouillon",
    expertNotes: b.expertNotes || "",
    prixReference: b.prixReference || "",
    prixBase: b.prixBase || "",
    prixChoisi: b.prixChoisi || "",
    methodeEvaluation: b.methodeEvaluation || "",
    conclusion: b.conclusion || "",
    dateEnvoi: b.dateEnvoi || null,
    dernierModifiePar: b.dernierModifiePar || b.agentName || "",
  };
  if (existing) {
    const cols = Object.keys(row).filter((k) => k !== "id");
    db.prepare(`UPDATE dossiers SET ${cols.map((c) => `${c} = @${c}`).join(", ")} WHERE id = @id`).run(row);
  } else {
    const cols = Object.keys(row);
    db.prepare(`INSERT INTO dossiers (${cols.join(",")}) VALUES (${cols.map((c) => `@${c}`).join(",")})`).run(row);
  }
  return id;
}

function nextNumeroRapport() {
  const year = new Date().getFullYear();
  const prefix = `RPT-${year}-`;
  const row = db.prepare("SELECT numeroRapport FROM dossiers WHERE numeroRapport LIKE ? ORDER BY numeroRapport DESC LIMIT 1").get(prefix + "%");
  let seq = 1;
  if (row && row.numeroRapport) {
    const match = row.numeroRapport.match(/(\d+)$/);
    if (match) seq = parseInt(match[1], 10) + 1;
  }
  return prefix + String(seq).padStart(4, "0");
}

app.post("/api/dossiers", ah(async (req, res) => {
  const b = req.body;
  if (req.session.role === "expert" && b.id) {
    const existing = db.prepare("SELECT statut FROM dossiers WHERE id = ?").get(b.id);
    if (existing && existing.statut === "brouillon") {
      return res.status(403).json({ error: "Mission de terrain en cours : l'expert ne peut pas modifier ce dossier tant que l'agent n'a pas envoyé son rapport." });
    }
  }
  if (b.statut === "envoye" && !b.numeroRapport) {
    b.numeroRapport = nextNumeroRapport();
  }
  const id = upsertDossier(b);
  if (b.statut === "envoye" && b.requisitionId) {
    db.prepare("UPDATE requisitions SET statut = 'visitee' WHERE id = ?").run(b.requisitionId);
  }
  if (b.statut === "envoye") {
    await notifyExpert(
      `Nouveau dossier reçu — ${b.numeroRapport || "sans n°"} (${b.nomSite || b.commune || ""})`,
      `Un agent (${b.agentName}) vient d'envoyer un dossier de visite terrain.\n\nSite : ${b.nomSite || b.commune}\nIndicateur de terrain : ${b.indicateurNom} ${b.indicateurPrenom} (${b.indicateurTelephone})\n\nConsultez l'application pour le traiter.`
    );
  }
  if (b.statut === "rapport_genere") {
    const savedDossier = rowToDossier(db.prepare("SELECT * FROM dossiers WHERE id = ?").get(id));
    try {
      const pdfBuffer = await generateReportPdfBuffer(savedDossier);
      await notifyExpert(
        `Rapport généré — ${savedDossier.numeroRapport || "sans n°"} (${savedDossier.nomSite || savedDossier.commune || ""})`,
        `Le rapport d'expertise ${savedDossier.numeroRapport || ""} a été généré et est joint à ce message en PDF.`,
        [{ filename: `rapport-${(savedDossier.numeroRapport || savedDossier.id).replace(/[^a-zA-Z0-9-_]/g, "_")}.pdf`, content: pdfBuffer }]
      );
    } catch (e) {
      console.error("Erreur envoi PDF du rapport:", e.message);
    }
  }
  const row = db.prepare("SELECT * FROM dossiers WHERE id = ?").get(id);
  res.json(rowToDossier(row));
}));

app.post("/api/dossiers/:id/photos", upload.single("photo"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Aucun fichier reçu" });
  const photo = { id: uid(), dossierId: req.params.id, filename: req.file.filename, t: nowISO() };
  db.prepare("INSERT INTO photos (id, dossierId, filename, t) VALUES (@id,@dossierId,@filename,@t)").run(photo);
  res.json({ id: photo.id, url: `/uploads/${photo.filename}`, t: photo.t });
});

app.delete("/api/photos/:id", (req, res) => {
  const photo = db.prepare("SELECT * FROM photos WHERE id = ?").get(req.params.id);
  if (photo) {
    try {
      fs.unlinkSync(path.join(UPLOAD_DIR, photo.filename));
    } catch (e) {}
    db.prepare("DELETE FROM photos WHERE id = ?").run(req.params.id);
  }
  res.json({ ok: true });
});

app.use((err, req, res, next) => {
  console.error("Erreur serveur:", err);
  res.status(500).json({ error: "Erreur serveur" });
});

app.listen(PORT, () => {
  console.log(`IQRA Expertise Terrain — serveur démarré sur http://localhost:${PORT}`);
  console.log(transporter ? "Email expert : configuré (SMTP actif)" : "Email expert : NON configuré (voir .env.example) — les envois seront seulement journalisés dans la console");
});
