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
      if (Number.isFinite(parsed) && parsed > 0) {
        args.topN = Math.floor(parsed);
      }
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
  if (!safe) return "Theme";
  return safe.charAt(0).toUpperCase() + safe.slice(1);
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
  const top = new Set();
  for (let i = 0; i < Math.min(topN, rows.length); i += 1) {
    const w = normalizeWord(rows[i]?.[0]);
    if (w) top.add(w);
  }
  return top;
}

function buildThemePacks(topWords) {
  const packs = [
    {
      theme: "family",
      clues: ["aunt", "uncle", "mom", "dad", "baby", "kids", "home", "house", "yard", "family", "child", "school"],
      weight: 1
    },
    {
      theme: "work",
      clues: ["office", "boss", "job", "work", "memo", "email", "audit", "sales", "brief", "legal", "team", "deal"],
      weight: 1
    },
    {
      theme: "food",
      clues: ["cook", "meal", "food", "kitchen", "snack", "plate", "bread", "sauce", "soup", "cafe", "lunch", "dinner"],
      weight: 1
    },
    {
      theme: "travel",
      clues: ["trip", "train", "plane", "coast", "road", "hotel", "port", "tour", "visit", "beach", "ocean", "route"],
      weight: 1
    },
    {
      theme: "money",
      clues: ["cash", "bank", "cost", "price", "sale", "store", "bill", "debt", "rent", "paid", "budget", "cheap"],
      weight: 1
    },
    {
      theme: "town",
      clues: ["town", "mayor", "civic", "council", "local", "church", "fair", "public", "street", "market", "news", "city"],
      weight: 1
    },
    {
      theme: "weather",
      clues: ["rain", "storm", "wind", "snow", "cold", "heat", "sun", "cloud", "flood", "winter", "summer", "weather"],
      weight: 0.9
    },
    {
      theme: "sports",
      clues: ["team", "score", "game", "ball", "match", "coach", "field", "player", "win", "race", "sport", "fight"],
      weight: 0.85
    },
    {
      theme: "music",
      clues: ["song", "band", "radio", "sound", "tune", "drum", "choir", "music", "voice", "dance", "piano", "guitar"],
      weight: 0.85
    },
    {
      theme: "health",
      clues: ["health", "doctor", "nurse", "care", "pain", "heart", "sleep", "diet", "sick", "cure", "medic", "body"],
      weight: 0.8
    },
    {
      theme: "school",
      clues: ["school", "class", "grade", "study", "test", "book", "paper", "math", "teach", "learn", "exam", "quiz"],
      weight: 0.8
    },
    {
      theme: "crime",
      clues: ["crime", "court", "judge", "police", "case", "trial", "jail", "law", "legal", "fraud", "theft", "proof"],
      weight: 0.75
    },
    {
      theme: "love",
      clues: ["love", "date", "heart", "kiss", "bride", "groom", "affair", "romance", "lover", "marry", "fling", "jealous"],
      weight: 0.75
    }
  ];

  const filtered = packs.filter((pack) => topWords.has(pack.theme));
  if (filtered.length === 0) {
    throw new Error("No valid theme labels found in top-word list.");
  }
  return filtered;
}

function scorePack(words, pack) {
  let score = 0;
  for (const word of words) {
    for (const clue of pack.clues) {
      if (word === clue) score += 2.5;
      else if (word.includes(clue) || clue.includes(word)) score += 0.4;
    }
  }
  return score * pack.weight;
}

function chooseTheme(words, rowKey, packs, usageCounts) {
  let bestTheme = "life";
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const pack of packs) {
    const rawScore = scorePack(words, pack);
    const used = usageCounts.get(pack.theme) || 0;
    const usagePenalty = used * 0.03;
    const jitter = (hashText(`${rowKey}|${pack.theme}`) % 1000) / 100000;
    const score = rawScore - usagePenalty + jitter;
    if (score > bestScore) {
      bestScore = score;
      bestTheme = pack.theme;
    }
  }

  usageCounts.set(bestTheme, (usageCounts.get(bestTheme) || 0) + 1);
  return titleCaseWord(bestTheme);
}

function summarize(rows) {
  const counts = new Map();
  for (const row of rows) {
    counts.set(row.themeTitle, (counts.get(row.themeTitle) || 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return {
    unique: counts.size,
    max: sorted[0]?.[1] || 0,
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

  rows.forEach((row, index) => {
    const words = (row.targetWords || []).map(normalizeWord);
    const rowKey = `${row.date}|${row.letters}|${index}`;
    row.themeTitle = chooseTheme(words, rowKey, packs, usageCounts);
  });

  const summary = summarize(rows);

  if (args.write) {
    const text = `${JSON.stringify(rows, null, 2)}\n`;
    fs.writeFileSync(themeSeedPath, text, "utf8");
    fs.writeFileSync(dailySeedPath, text, "utf8");
  }

  console.log(`Rows: ${rows.length}`);
  console.log(`Theme labels: ${packs.map((p) => p.theme).join(", ")}`);
  console.log(`Unique titles: ${summary.unique}`);
  console.log(`Max repeat count: ${summary.max}`);
  console.log("Top 20:");
  for (const [title, count] of summary.top) {
    console.log(`${String(count).padStart(4, " ")} ${title}`);
  }
}

main();

