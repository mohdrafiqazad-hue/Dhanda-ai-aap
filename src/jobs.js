// Automatic kaam: har 30 minute reviews check + roz ek post.
import crypto from "node:crypto";
import cron from "node-cron";
import { getDb, save, log } from "./store.js";
import * as google from "./google.js";
import * as ai from "./ai.js";

const TZ = () => process.env.TZ_NAME || "Asia/Kolkata";
const MAX_AI_DRAFTS_PER_SYNC = 20;

let syncing = false;
let posting = false;

// ---------- Reviews ----------

export async function syncReviews() {
  if (!google.isConnected()) return { notConnected: true };
  if (syncing) return { busy: true };
  syncing = true;
  try {
    const db = getDb();
    const s = db.settings;
    const remote = await google.listReviews();
    let drafted = 0;
    let autoReplied = 0;

    for (const r of remote) {
      const rec = (db.reviews[r.id] ||= { id: r.id, status: "new", draft: "", repliedBy: null });
      Object.assign(rec, { name: r.name, author: r.author, stars: r.stars, comment: r.comment, createTime: r.createTime });

      if (r.reply) {
        if (rec.status !== "replied") rec.repliedBy ||= "pehle se";
        rec.status = "replied";
        rec.reply = r.reply;
        continue;
      }
      if (rec.status === "skipped") continue;

      if (!rec.draft) {
        if (drafted >= MAX_AI_DRAFTS_PER_SYNC) continue;
        try {
          rec.draft = await ai.draftReviewReply(s, rec);
          drafted++;
        } catch (e) {
          log(`${rec.author} ke review ka draft nahi bana: ${e.message}`);
          continue;
        }
      }

      if (s.autoReplyEnabled && rec.stars >= s.autoReplyMinStars) {
        try {
          await google.replyToReview(rec.name, rec.draft);
          Object.assign(rec, { status: "replied", reply: rec.draft, repliedBy: "auto", repliedAt: new Date().toISOString() });
          autoReplied++;
          log(`Auto-reply bheja: ${rec.author} (${rec.stars}★)`);
        } catch (e) {
          rec.status = "pending";
          log(`${rec.author} ko reply nahi gaya: ${e.message}`);
        }
      } else {
        rec.status = "pending";
      }
      save();
    }
    save();
    const pending = Object.values(db.reviews).filter((r) => r.status === "pending").length;
    if (drafted || autoReplied) log(`Reviews sync: ${drafted} naye draft, ${autoReplied} auto-reply, ${pending} aapki approval ka intezaar.`);
    return { total: remote.length, drafted, autoReplied, pending };
  } finally {
    syncing = false;
  }
}

export async function redraftReview(id) {
  const db = getDb();
  const rec = db.reviews[id];
  if (!rec) throw new Error("Review nahi mila.");
  rec.draft = await ai.draftReviewReply(db.settings, rec);
  if (rec.status === "skipped" || rec.status === "new") rec.status = "pending";
  save();
  return rec;
}

export async function sendReply(id, text) {
  const db = getDb();
  const rec = db.reviews[id];
  if (!rec) throw new Error("Review nahi mila.");
  const comment = String(text || rec.draft || "").trim();
  if (!comment) throw new Error("Reply khaali hai.");
  if (comment.length > 4000) throw new Error("Reply bahut lamba hai (4000 characters max).");
  await google.replyToReview(rec.name, comment);
  Object.assign(rec, { status: "replied", reply: comment, draft: comment, repliedBy: "aap", repliedAt: new Date().toISOString() });
  save();
  log(`Reply bheja: ${rec.author} (${rec.stars}★)`);
  return rec;
}

export function skipReview(id) {
  const rec = getDb().reviews[id];
  if (!rec) throw new Error("Review nahi mila.");
  rec.status = "skipped";
  save();
  return rec;
}

// ---------- Posts ----------

function todayParts() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: TZ(), year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

export async function generatePost() {
  const db = getDb();
  const text = await ai.draftPost(db.settings, db.posts.filter((p) => p.status === "published"));
  const post = { id: crypto.randomUUID(), text, status: "draft", createdAt: new Date().toISOString() };
  db.posts.unshift(post);
  db.posts = db.posts.slice(0, 100);
  save();
  return post;
}

export async function publishPost(id, text) {
  const db = getDb();
  const post = db.posts.find((p) => p.id === id);
  if (!post) throw new Error("Post nahi mili.");
  if (post.status === "published") throw new Error("Ye post pehle hi publish ho chuki hai.");
  const summary = String(text ?? post.text).trim();
  if (!summary) throw new Error("Post khaali hai.");
  if (summary.length > 1500) throw new Error("Google post 1500 characters se lambi nahi ho sakti.");
  const res = await google.createPost(summary);
  Object.assign(post, { text: summary, status: "published", publishedAt: new Date().toISOString(), googleName: res.name, url: res.searchUrl });
  save();
  log("Post Google par publish ho gayi.");
  return post;
}

export function deletePost(id) {
  const db = getDb();
  db.posts = db.posts.filter((p) => !(p.id === id && p.status !== "published"));
  save();
}

export async function dailyPostTick() {
  const db = getDb();
  const s = db.settings;
  if (!s.dailyPostEnabled || !google.isConnected() || posting) return;
  const { date, time } = todayParts();
  if (db.lastPostDate === date || time < s.postTime) return;

  posting = true;
  try {
    db.lastPostDate = date; // ek din me ek hi baar try
    save();
    const post = await generatePost();
    if (s.postApproval) {
      log("Aaj ki post ka draft taiyaar hai, Posts tab me approve karein.");
    } else {
      await publishPost(post.id);
    }
  } catch (e) {
    log(`Aaj ki post nahi gayi: ${e.message}`);
  } finally {
    posting = false;
  }
}

// ---------- Scheduler ----------

export function startScheduler() {
  cron.schedule("*/30 * * * *", () => syncReviews().catch((e) => log(`Review sync fail: ${e.message}`)));
  cron.schedule("* * * * *", () => dailyPostTick());
  // App start hote hi ek baar check
  setTimeout(() => syncReviews().catch((e) => log(`Review sync fail: ${e.message}`)), 5000);
}
