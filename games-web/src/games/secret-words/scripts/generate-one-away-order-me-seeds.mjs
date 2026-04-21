import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, "..", "..");
const SOURCE_JSONL = path.resolve(
  __dirname,
  "..",
  "seed-build",
  "top7000_len4_len5_len6_neighbors_top6.jsonl"
);

const ONE_AWAY_DIR = path.resolve(ROOT, "one-away");
const ORDER_ME_DIR = path.resolve(ROOT, "order-me");

const ONE_AWAY_OUTPUT = path.join(ONE_AWAY_DIR, "dailySeed.json");
const ORDER_ME_OUTPUT = path.join(ORDER_ME_DIR, "dailySeed.json");
const SUMMARY_OUTPUT = path.resolve(
  __dirname,
  "..",
  "seed-build",
  "one-away-order-me.dailySeed.summary.json"
);

const START_DATE = "2024-04-21";
const ONE_AWAY_SEED = "one-away-v1-3080";
const ORDER_ME_SEED = "order-me-v1-3080";

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
    t += 0x6d2b79f5;
    let n = t;
    n = Math.imul(n ^ (n >>> 15), n | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
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

function toIsoLocal(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildDates(startIso, count) {
  const start = new Date(`${startIso}T00:00:00`);
  const out = [];
  const cursor = new Date(start.getTime());
  for (let i = 0; i < count; i += 1) {
    out.push(toIsoLocal(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

function normalizeRows(jsonlRaw) {
  return jsonlRaw
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line))
    .map((row) => {
      const target = String(row.target || "").toLowerCase().trim();
      const neighbors = Array.isArray(row.neighbors)
        ? row.neighbors
            .map((n) => String(n.word || "").toLowerCase().trim())
            .filter(Boolean)
        : [];

      const deduped = [];
      const seen = new Set();
      for (const word of neighbors) {
        if (word === target) continue;
        if (seen.has(word)) continue;
        seen.add(word);
        deduped.push(word);
      }

      return { target, neighbors: deduped };
    })
    .filter((row) => row.target && row.neighbors.length >= 6);
}

function buildDailySeed(dates, rowsShuffled, neighborCount) {
  return dates.map((date, idx) => {
    const row = rowsShuffled[idx];
    const words = [row.target, ...row.neighbors.slice(0, neighborCount)];
    return { date, target: row.target, words };
  });
}

async function main() {
  const sourceRaw = await readFile(SOURCE_JSONL, "utf8");
  const rows = normalizeRows(sourceRaw);

  if (rows.length < 3080) {
    throw new Error(`Expected at least 3080 usable rows, got ${rows.length}.`);
  }

  // Keep exactly 3080 to match requested game count.
  const baseRows = rows.slice(0, 3080);
  const dates = buildDates(START_DATE, baseRows.length);

  const oneAwayRows = shuffle(baseRows, ONE_AWAY_SEED);
  const orderMeRows = shuffle(baseRows, ORDER_ME_SEED);

  const oneAway = buildDailySeed(dates, oneAwayRows, 3);
  const orderMe = buildDailySeed(dates, orderMeRows, 6);

  await mkdir(ONE_AWAY_DIR, { recursive: true });
  await mkdir(ORDER_ME_DIR, { recursive: true });

  await writeFile(ONE_AWAY_OUTPUT, `${JSON.stringify(oneAway, null, 2)}\n`, "utf8");
  await writeFile(ORDER_ME_OUTPUT, `${JSON.stringify(orderMe, null, 2)}\n`, "utf8");

  const summary = {
    generatedAt: new Date().toISOString(),
    source: SOURCE_JSONL,
    outputs: {
      oneAway: ONE_AWAY_OUTPUT,
      orderMe: ORDER_ME_OUTPUT
    },
    config: {
      startDate: START_DATE,
      totalDays: dates.length,
      oneAwayNeighbors: 3,
      orderMeNeighbors: 6,
      oneAwayShuffleSeed: ONE_AWAY_SEED,
      orderMeShuffleSeed: ORDER_ME_SEED
    },
    window: {
      startDate: dates[0],
      endDate: dates[dates.length - 1]
    }
  };

  await writeFile(SUMMARY_OUTPUT, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

