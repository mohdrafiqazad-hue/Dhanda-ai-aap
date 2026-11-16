// Google profile ka score (100 me se) aur sudhaar ke tips.

const SEVEN_DAYS = 7 * 864e5;

export function computeAudit(profile, db) {
  const checks = [];
  const add = (label, points, max, tip, extra = {}) =>
    checks.push({ label, points, max, status: points >= max ? "ok" : points > 0 ? "partial" : "fail", tip: points >= max ? "" : tip, ...extra });

  const descLen = profile.description.trim().length;
  add(
    "Business ki description",
    descLen >= 250 ? 10 : descLen > 0 ? 5 : 0,
    10,
    descLen ? `Description chhoti hai (${descLen} akshar). 250-750 akshar ki achhi description se Google aur customer dono aapko behtar samajhte hain.` : "Description khaali hai. Neeche button se AI se likhwa kar seedha Google par daal sakte hain.",
    { action: "description" },
  );
  add("Phone number", profile.phone ? 8 : 0, 8, "Phone number daalein, taaki customer seedha call kar sakein.");
  add("Website ya online link", profile.website ? 7 : 0, 7, "Website, online store ya Instagram page ka link daalein.");
  add("Khulne-band hone ka time", profile.hasHours ? 10 : 0, 10, "Opening hours daalein. Bina timing ke Google aapko 'abhi khula hai' search me kam dikhata hai.");
  add("Main category", profile.primaryCategory ? 5 : 0, 5, "Sahi main category chunein (jaise 'Grocery store').");
  add("Extra categories", profile.extraCategories > 0 ? 5 : 0, 5, "1-3 extra categories jodein jo aapke kaam se mile (jaise 'Dry fruit store'). Isse zyada searches me aate hain.");
  add("Address ya service area", profile.hasAddress ? 5 : 0, 5, "Dukaan ka poora pata ya service area daalein.");

  if (profile.photoCount === null) {
    add("Photos", 0, 15, "Photos ki ginti Google se nahi mil paayi. Kam se kam 10 achhi photos (dukaan, products, andar-bahar) zaroor rakhein.");
  } else {
    add("Photos", profile.photoCount >= 10 ? 15 : profile.photoCount > 0 ? 7 : 0, 15, `Abhi ${profile.photoCount} photos hain. Kam se kam 10 asli photos rakhein. Photo wali posts se bhi photos badhti hain.`);
  }

  const total = db.reviewSummary?.total ?? Object.keys(db.reviews).length;
  const avg = db.reviewSummary?.average ?? 0;
  add("Reviews ki ginti", total >= 30 ? 10 : total >= 10 ? 6 : total > 0 ? 3 : 0, 10, `Abhi ${total} reviews hain. Har khush customer se review maangein (counter par QR code laga sakte hain).`);
  add("Rating", avg >= 4.5 ? 10 : avg >= 4 ? 7 : avg >= 3.5 ? 4 : 0, 10, `Average rating ${avg ? avg.toFixed(1) : "-"}★ hai. Bure reviews ka jaldi aur achha jawab dein aur shikayat door karein.`);

  const local = Object.values(db.reviews);
  const replied = local.filter((r) => r.status === "replied").length;
  const rate = local.length ? replied / local.length : 0;
  add("Reviews ka jawab", rate >= 0.9 ? 10 : rate >= 0.5 ? 5 : 0, 10, `${Math.round(rate * 100)}% reviews ka reply hua hai. Har review ka jawab dein, auto-reply on rakhein.`);

  const lastPost = db.posts.find((p) => p.status === "published");
  const recent = lastPost && Date.now() - new Date(lastPost.publishedAt).getTime() < SEVEN_DAYS;
  add("Pichhle 7 din me post", recent ? 5 : 0, 5, "Har hafte kam se kam ek post daalein. Roz ki auto-post on rakhein.");

  const score = checks.reduce((n, c) => n + c.points, 0);
  return { score, checks, profile };
}
