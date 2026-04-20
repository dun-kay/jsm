import fs from "node:fs";
import path from "node:path";

const themeSeedPath = path.resolve("src/games/theme-words/themeSeed.generated.json");
const dailySeedPath = path.resolve("src/games/theme-words/dailySeed.json");
const wordFreqPath = path.resolve("src/games/secret-words/seed-build/wordfreq-en-25000-log.json");

function parseArgs(argv) {
  const args = {
    write: false,
    topN: 6000
  };

  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--write") {
      args.write = true;
      continue;
    }
    if (token === "--topn") {
      const parsed = Number(argv[i + 1]);
      if (Number.isFinite(parsed) && parsed > 0) args.topN = Math.floor(parsed);
      i += 1;
      continue;
    }
  }

  return args;
}

function normalizeWord(word) {
  return String(word || "").toLowerCase().replace(/[^a-z]/g, "");
}

function titleCaseWord(word) {
  const safe = normalizeWord(word);
  return safe ? safe.charAt(0).toUpperCase() + safe.slice(1) : "Theme";
}

function hashText(input) {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function buildTopWordSet(topN) {
  const raw = fs.readFileSync(wordFreqPath, "utf8").replace(/^\uFEFF/, "");
  const rows = JSON.parse(raw);
  const out = new Set();
  for (let i = 0; i < Math.min(topN, rows.length); i += 1) {
    const w = normalizeWord(rows[i]?.[0]);
    if (w) out.add(w);
  }
  return out;
}

const RAW_PACKS = [
  { theme: "family", clues: ["family", "aunt", "uncle", "cousin", "mom", "dad", "baby", "home", "house", "kids", "child", "parent"] },
  { theme: "home", clues: ["home", "house", "yard", "room", "door", "kitchen", "table", "bed", "roof", "garage"] },
  { theme: "school", clues: ["school", "class", "grade", "study", "book", "math", "learn", "teacher", "exam", "quiz"], block: ["gun", "guns", "shot", "shots", "kill", "bomb", "crime"] },
  { theme: "work", clues: ["work", "job", "office", "boss", "team", "project", "email", "memo", "brief", "audit"] },
  { theme: "money", clues: ["money", "cash", "bank", "bill", "debt", "rent", "price", "sale", "budget", "paid"] },
  { theme: "food", clues: ["food", "meal", "cook", "kitchen", "lunch", "dinner", "snack", "bread", "sauce", "soup"] },
  { theme: "travel", clues: ["travel", "trip", "road", "route", "hotel", "plane", "train", "visit", "tour", "journey"] },
  { theme: "beach", clues: ["beach", "coast", "ocean", "shore", "sand", "wave", "surf", "island", "boat", "harbor"] },
  { theme: "weather", clues: ["weather", "rain", "storm", "wind", "snow", "cold", "heat", "sun", "cloud", "flood"] },
  { theme: "music", clues: ["music", "song", "band", "choir", "tune", "radio", "drum", "dance", "piano", "guitar"] },
  { theme: "sports", clues: ["sports", "sport", "team", "game", "score", "match", "coach", "field", "race", "ball"] },
  { theme: "health", clues: ["health", "doctor", "nurse", "heart", "sleep", "diet", "sick", "care", "pain", "body"] },
  { theme: "crime", clues: ["crime", "gun", "guns", "shot", "shots", "jail", "court", "judge", "police", "fraud", "theft", "trial"] },
  { theme: "law", clues: ["law", "legal", "court", "judge", "case", "trial", "proof", "rights", "police", "crime"] },
  { theme: "love", clues: ["love", "date", "heart", "kiss", "bride", "groom", "romance", "lover", "marry", "jealous"] },
  { theme: "news", clues: ["news", "media", "press", "story", "report", "radio", "public", "local", "city", "town"] },
  { theme: "city", clues: ["city", "town", "street", "market", "public", "local", "civic", "council", "mayor", "urban"] },
  { theme: "church", clues: ["church", "parish", "choir", "sunday", "prayer", "faith", "holy", "grace", "saint", "altar"] },
  { theme: "holiday", clues: ["holiday", "weekend", "vacation", "tour", "trip", "family", "travel", "summer", "winter", "party"] },
  { theme: "party", clues: ["party", "dance", "music", "friends", "night", "drink", "crowd", "event", "fun", "noise"] },
  { theme: "shopping", clues: ["shop", "store", "sale", "price", "cash", "coupon", "buy", "market", "retail", "cart"] },
  { theme: "kitchen", clues: ["kitchen", "cook", "pan", "pot", "plate", "knife", "meal", "bread", "salt", "sugar"] },
  { theme: "office", clues: ["office", "desk", "email", "memo", "manager", "meeting", "calendar", "paper", "work", "team"] },
  { theme: "garden", clues: ["garden", "yard", "plant", "tree", "seed", "soil", "grass", "leaf", "flower", "green"] },
  { theme: "nature", clues: ["nature", "forest", "river", "mountain", "ocean", "rain", "wind", "tree", "stone", "wild"] },
  { theme: "animals", clues: ["animal", "animals", "dog", "cat", "bird", "fish", "horse", "farm", "wild", "pet"] },
  { theme: "history", clues: ["history", "past", "war", "army", "king", "queen", "old", "ancient", "battle", "nation"] },
  { theme: "war", clues: ["war", "army", "troop", "drill", "guard", "rifle", "battle", "rank", "march", "medic"] },
  { theme: "safety", clues: ["safe", "safety", "secure", "guard", "alarm", "risk", "danger", "protect", "secure", "care"] },
  { theme: "fashion", clues: ["style", "dress", "shirt", "shoe", "coat", "look", "wear", "trend", "hair", "color"] },
  { theme: "beauty", clues: ["beauty", "hair", "nail", "face", "skin", "makeup", "salon", "style", "glow", "clean"] },
  { theme: "science", clues: ["science", "study", "test", "lab", "data", "proof", "theory", "math", "logic", "brain"] },
  { theme: "tech", clues: ["tech", "phone", "app", "code", "cloud", "stack", "screen", "data", "digital", "online"] },
  { theme: "business", clues: ["business", "market", "sales", "deal", "cost", "profit", "price", "team", "office", "work"] },
  { theme: "community", clues: ["community", "local", "public", "town", "city", "church", "school", "group", "neighbors", "street"] },
  { theme: "friends", clues: ["friend", "friends", "group", "party", "team", "chat", "social", "visit", "together", "shared"] },
  { theme: "people", clues: ["people", "person", "family", "friends", "group", "public", "local", "town", "community", "social"] },
  { theme: "life", clues: ["life", "daily", "home", "family", "work", "health", "money", "love", "town", "people"] },
  { theme: "daily", clues: ["daily", "today", "normal", "routine", "usual", "common", "simple", "local", "public", "work"] }
];

const FALLBACK_THEMES = ["Life", "People", "Daily", "Community", "Family", "Work", "Home", "Travel", "Food", "Money"];

function buildThemePacks(topWords) {
  const packs = RAW_PACKS
    .filter((pack) => topWords.has(pack.theme))
    .map((pack) => ({
      ...pack,
      clues: pack.clues.map(normalizeWord).filter(Boolean),
      block: (pack.block || []).map(normalizeWord).filter(Boolean)
    }));

  if (packs.length === 0) {
    throw new Error("No valid theme labels found in top-word list.");
  }
  return packs;
}

function scorePack(words, pack) {
  const wordSet = new Set(words);

  for (const blocked of pack.block || []) {
    if (wordSet.has(blocked)) return Number.NEGATIVE_INFINITY;
  }

  let score = 0;
  for (const word of words) {
    for (const clue of pack.clues) {
      if (word === clue) score += 3;
      else if (word.startsWith(clue) || clue.startsWith(word)) score += 0.9;
      else if (word.includes(clue) || clue.includes(word)) score += 0.35;
    }
  }
  return score;
}

function chooseFallback(words, rowKey, usageCounts, previousTheme, topWords) {
  const candidates = FALLBACK_THEMES
    .map((theme) => normalizeWord(theme))
    .filter((theme) => topWords.has(theme))
    .map((theme) => titleCaseWord(theme));

  let best = candidates[0] || "Life";
  let bestScore = Number.POSITIVE_INFINITY;
  for (const theme of candidates) {
    if (theme === previousTheme) continue;
    const used = usageCounts.get(theme) || 0;
    const jitter = (hashText(`${rowKey}|fallback|${theme}|${words.join("|")}`) % 1000) / 100000;
    const score = used + jitter;
    if (score < bestScore) {
      best = theme;
      bestScore = score;
    }
  }
  return best;
}

function chooseTheme(words, rowKey, packs, usageCounts, previousTheme, topWords) {
  const scored = packs
    .map((pack) => {
      const raw = scorePack(words, pack);
      const theme = titleCaseWord(pack.theme);
      const used = usageCounts.get(theme) || 0;
      const usagePenalty = used * 0.08;
      const jitter = (hashText(`${rowKey}|${pack.theme}`) % 1000) / 100000;
      return { theme, raw, score: raw - usagePenalty + jitter };
    })
    .filter((entry) => Number.isFinite(entry.raw))
    .sort((a, b) => b.score - a.score);

  const confident = scored.filter((entry) => entry.raw >= 1.2);
  const nonPrevAny = scored.find((entry) => entry.theme !== previousTheme);
  const nonPrevConfident = confident.find((entry) => entry.theme !== previousTheme);

  let chosen;
  if (confident.length > 0) {
    chosen = nonPrevConfident?.theme || nonPrevAny?.theme || confident[0].theme;
  } else {
    chosen = chooseFallback(words, rowKey, usageCounts, previousTheme, topWords);
  }

  usageCounts.set(chosen, (usageCounts.get(chosen) || 0) + 1);
  return chosen;
}

function summarize(rows) {
  const counts = new Map();
  let consecutive = 0;
  let prev = null;
  for (const row of rows) {
    const t = String(row.themeTitle || "");
    counts.set(t, (counts.get(t) || 0) + 1);
    if (prev && prev === t) consecutive += 1;
    prev = t;
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return {
    unique: counts.size,
    max: sorted[0]?.[1] || 0,
    consecutive,
    top: sorted.slice(0, 20)
  };
}

function main() {
  const args = parseArgs(process.argv);
  const topWords = buildTopWordSet(args.topN);
  const packs = buildThemePacks(topWords);

  const raw = fs.readFileSync(themeSeedPath, "utf8").replace(/^\uFEFF/, "");
  const rows = JSON.parse(raw);
  const usageCounts = new Map();

  let previousTheme = null;
  rows.forEach((row, index) => {
    const words = (row.targetWords || []).map(normalizeWord).filter(Boolean);
    const rowKey = `${row.date}|${row.letters}|${index}`;
    const picked = chooseTheme(words, rowKey, packs, usageCounts, previousTheme, topWords);
    row.themeTitle = picked;
    previousTheme = picked;
  });

  const summary = summarize(rows);

  if (args.write) {
    const text = `${JSON.stringify(rows, null, 2)}\n`;
    fs.writeFileSync(themeSeedPath, text, "utf8");
    fs.writeFileSync(dailySeedPath, text, "utf8");
  }

  console.log(`Rows: ${rows.length}`);
  console.log(`Theme labels available: ${packs.length}`);
  console.log(`Unique titles used: ${summary.unique}`);
  console.log(`Max repeat count: ${summary.max}`);
  console.log(`Consecutive duplicates: ${summary.consecutive}`);
  console.log("Top 20:");
  for (const [title, count] of summary.top) {
    console.log(`${String(count).padStart(4, " ")} ${title}`);
  }
}

main();
