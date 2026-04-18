import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SECRET_WORDS_DIR = path.resolve(__dirname, "..");
const BUILD_DIR = path.resolve(SECRET_WORDS_DIR, "seed-build");
const RANKED_INPUT = path.join(BUILD_DIR, "six_letter_combo_word_index.common.min50.secrets.sanitized.ranked.jsonl");
const OUTPUT_DAILY_SEED = path.join(SECRET_WORDS_DIR, "dailySeed.json");
const OUTPUT_SUMMARY = path.join(BUILD_DIR, "dailySeed.generated.summary.json");

const SHUFFLE_SEED = "secret-words-daily-seed-25y-v1";

function hashSeed(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return function rand() {
    t += 0x6D2B79F5;
    let n = t;
    n = Math.imul(n ^ (n >>> 15), n | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

function toIsoLocal(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addYears(date, years) {
  const next = new Date(date.getTime());
  next.setFullYear(next.getFullYear() + years);
  return next;
}

function daysInclusive(start, end) {
  const out = [];
  const cursor = new Date(start.getTime());
  while (cursor <= end) {
    out.push(new Date(cursor.getTime()));
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

function shuffle(items, seedText) {
  const arr = [...items];
  const rand = mulberry32(hashSeed(seedText));
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

async function main() {
  const rowsRaw = await readFile(RANKED_INPUT, "utf8");
  const combos = rowsRaw
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line))
    .map((row) => ({
      letters: String(row.letters).toUpperCase(),
      words: Array.isArray(row.words) ? row.words.map((w) => String(w).toLowerCase()) : []
    }))
    .filter((row) => row.letters.length === 6 && row.words.length > 0);

  const today = new Date();
  const start = addYears(today, -5);
  const end = addYears(today, 20);
  const dateList = daysInclusive(start, end);

  if (combos.length === 0) {
    throw new Error("No combos available in ranked dataset.");
  }

  const shuffledCombos = shuffle(combos, SHUFFLE_SEED);

  const entriesAsc = dateList.map((date, index) => {
    const combo = shuffledCombos[index % shuffledCombos.length];
    return {
      date: toIsoLocal(date),
      letters: combo.letters,
      words: combo.words
    };
  });

  // Preserve existing visual convention (latest date first)
  const entriesDesc = [...entriesAsc].sort((a, b) => b.date.localeCompare(a.date));

  await writeFile(OUTPUT_DAILY_SEED, `${JSON.stringify(entriesDesc, null, 2)}\n`, "utf8");

  const summary = {
    generatedAt: new Date().toISOString(),
    source: RANKED_INPUT,
    output: OUTPUT_DAILY_SEED,
    window: {
      startDate: toIsoLocal(start),
      endDate: toIsoLocal(end),
      totalDays: entriesAsc.length
    },
    combos: {
      available: combos.length,
      uniqueUsedInWindow: Math.min(entriesAsc.length, combos.length),
      shuffleSeed: SHUFFLE_SEED
    }
  };

  await writeFile(OUTPUT_SUMMARY, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
