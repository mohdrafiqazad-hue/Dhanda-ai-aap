// Simple JSON-file storage. Ek chhote business ke liye kaafi hai.
import fs from "node:fs";
import path from "node:path";

const FILE = process.env.DATA_FILE || path.resolve("data", "db.json");

const DEFAULT_SETTINGS = {
  businessName: "",
  businessType: "",
  city: "",
  about: "",
  // Review reply settings
  autoReplyEnabled: true,
  autoReplyMinStars: 4, // isse kam star wale reviews pehle aapki approval ke liye rukenge
  replyLanguage: "auto", // auto | hinglish | hindi | english
  replyTone: "friendly", // friendly | professional
  // Daily post settings
  dailyPostEnabled: true,
  postApproval: false, // true = post publish hone se pehle aap approve karenge
  postTime: "10:00",
  postLanguage: "hinglish",
  postTopics: "naye products, offers, customer tips, business ki khaasiyat",
};

function fresh() {
  return {
    settings: { ...DEFAULT_SETTINGS },
    google: { tokens: null, accountName: null, locationName: null, locationTitle: null },
    reviews: {}, // reviewId -> review record
    posts: [], // newest first
    lastPostDate: null,
    log: [],
  };
}

let db;

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, "utf8"));
    const base = fresh();
    db = { ...base, ...raw, settings: { ...base.settings, ...(raw.settings || {}) } };
  } catch {
    db = fresh();
  }
}

load();

export function getDb() {
  return db;
}

export function save() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, FILE);
}

export function log(message) {
  db.log.unshift({ at: new Date().toISOString(), message });
  db.log = db.log.slice(0, 200);
  save();
  console.log(`[dhandha] ${message}`);
}

export function updateSettings(patch) {
  const s = db.settings;
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (!(key in patch)) continue;
    const def = DEFAULT_SETTINGS[key];
    let v = patch[key];
    if (typeof def === "boolean") v = v === true || v === "true";
    else if (typeof def === "number") v = Math.min(5, Math.max(1, Number(v) || def));
    else v = String(v ?? "").slice(0, 2000);
    s[key] = v;
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s.postTime)) s.postTime = DEFAULT_SETTINGS.postTime;
  save();
  return s;
}
