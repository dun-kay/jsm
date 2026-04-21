import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BUILD_DIR = path.resolve(__dirname, "../seed-build");
const WORDFREQ_PATH = path.join(BUILD_DIR, "wordfreq-en-25000-log.json");
const DATAMUSE_CACHE_PATH = path.join(BUILD_DIR, "datamuse-ml-cache.json");

const OUTPUT_JSONL = path.join(BUILD_DIR, "top7000_len4_len5_len6_neighbors_top6.jsonl");
const OUTPUT_TXT = path.join(BUILD_DIR, "top7000_len4_len5_len6_neighbors_top6.txt");
const OUTPUT_SUMMARY = path.join(BUILD_DIR, "top7000_len4_len5_len6_neighbors_top6.summary.json");
const DATAMUSE_BASE = "https://api.datamuse.com/words";
const DATAMUSE_MAX = 1000;
const FETCH_CONCURRENCY = 10;

const WEIGHTS = {
  semantic: 0.65,
  letter: 0.35
};

const TOP_N = 7000;
const K_NEIGHBORS = 6;
const LENGTHS = new Set([4, 5, 6]);

function normalizeWord(word) {
  return String(word || "").toLowerCase().replace(/[^a-z]/g, "");
}

function safeParseJson(content, fallback) {
  try {
    return JSON.parse(content);
  } catch {
    return fallback;
  }
}

async function saveDatamuseCache(cache) {
  await writeFile(DATAMUSE_CACHE_PATH, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
}

async function fetchDatamuseMl(word) {
  const url = `${DATAMUSE_BASE}?ml=${encodeURIComponent(word)}&max=${DATAMUSE_MAX}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Datamuse failed for ${word}: ${response.status} ${response.statusText}`);
  }
  const data = await response.json();
  return Array.isArray(data) ? data : [];
}

async function runPool(items, concurrency, worker) {
  let index = 0;
  async function runner() {
    while (true) {
      const current = index;
      index += 1;
      if (current >= items.length) return;
      await worker(items[current], current);
    }
  }
  const workers = Array.from({ length: Math.max(1, concurrency) }, () => runner());
  await Promise.all(workers);
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function levenshteinDistance(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const prev = new Array(n + 1);
  const curr = new Array(n + 1);
  for (let j = 0; j <= n; j += 1) prev[j] = j;

  for (let i = 1; i <= m; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= n; j += 1) prev[j] = curr[j];
  }
  return prev[n];
}

function jaroWinkler(a, b) {
  if (a === b) return 1;
  const aLen = a.length;
  const bLen = b.length;
  if (aLen === 0 || bLen === 0) return 0;

  const matchDistance = Math.max(0, Math.floor(Math.max(aLen, bLen) / 2) - 1);
  const aMatches = new Array(aLen).fill(false);
  const bMatches = new Array(bLen).fill(false);

  let matches = 0;
  for (let i = 0; i < aLen; i += 1) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, bLen);
    for (let j = start; j < end; j += 1) {
      if (bMatches[j]) continue;
      if (a[i] !== b[j]) continue;
      aMatches[i] = true;
      bMatches[j] = true;
      matches += 1;
      break;
    }
  }

  if (matches === 0) return 0;

  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < aLen; i += 1) {
    if (!aMatches[i]) continue;
    while (!bMatches[k]) k += 1;
    if (a[i] !== b[k]) transpositions += 1;
    k += 1;
  }
  transpositions /= 2;

  const jaro = (
    matches / aLen +
    matches / bLen +
    (matches - transpositions) / matches
  ) / 3;

  let prefix = 0;
  for (let i = 0; i < Math.min(4, aLen, bLen); i += 1) {
    if (a[i] === b[i]) prefix += 1;
    else break;
  }

  return jaro + prefix * 0.1 * (1 - jaro);
}

function diceBigrams(a, b) {
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;

  const map = new Map();
  for (let i = 0; i < a.length - 1; i += 1) {
    const bg = a.slice(i, i + 2);
    map.set(bg, (map.get(bg) || 0) + 1);
  }

  let overlap = 0;
  for (let i = 0; i < b.length - 1; i += 1) {
    const bg = b.slice(i, i + 2);
    const count = map.get(bg) || 0;
    if (count > 0) {
      overlap += 1;
      map.set(bg, count - 1);
    }
  }

  return (2 * overlap) / ((a.length - 1) + (b.length - 1));
}

function letterSimilarity(a, b) {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  const lev = 1 - (levenshteinDistance(a, b) / maxLen);
  const jw = jaroWinkler(a, b);
  const dice = diceBigrams(a, b);
  return clamp01((0.45 * lev) + (0.35 * jw) + (0.2 * dice));
}

function buildSemanticMap(rows) {
  const raw = new Map();
  let maxScore = 0;
  for (const row of rows || []) {
    if (!row || typeof row.word !== "string" || typeof row.score !== "number") continue;
    const w = normalizeWord(row.word);
    if (!w) continue;
    raw.set(w, row.score);
    if (row.score > maxScore) maxScore = row.score;
  }

  if (maxScore <= 0) return new Map();

  const normalized = new Map();
  for (const [word, score] of raw.entries()) {
    normalized.set(word, score / maxScore);
  }
  return normalized;
}

async function main() {
  const [wordfreqRaw, cacheRaw] = await Promise.all([
    readFile(WORDFREQ_PATH, "utf8"),
    readFile(DATAMUSE_CACHE_PATH, "utf8")
  ]);

  const wordfreq = JSON.parse(wordfreqRaw);
  const cache = safeParseJson(cacheRaw, {});

  const selected = [];
  const seen = new Set();
  for (let i = 0; i < Math.min(TOP_N, wordfreq.length); i += 1) {
    const w = normalizeWord(wordfreq[i]?.[0]);
    if (!w || !/^[a-z]+$/.test(w)) continue;
    if (!LENGTHS.has(w.length)) continue;
    if (seen.has(w)) continue;
    seen.add(w);
    selected.push(w);
  }

  const missing = selected.filter((word) => !Array.isArray(cache[word]));
  if (missing.length > 0) {
    console.log(`Fetching Datamuse semantic rows for ${missing.length} missing targets...`);
    let fetched = 0;
    await runPool(missing, FETCH_CONCURRENCY, async (word) => {
      try {
        cache[word] = await fetchDatamuseMl(word);
      } catch {
        cache[word] = [];
      }
      fetched += 1;
      if (fetched % 200 === 0 || fetched === missing.length) {
        console.log(`Fetched ${fetched}/${missing.length}`);
      }
    });
    await saveDatamuseCache(cache);
  }

  const semanticByTarget = new Map();
  let cacheHits = 0;
  for (const word of selected) {
    const rows = cache[word];
    if (Array.isArray(rows)) cacheHits += 1;
    semanticByTarget.set(word, buildSemanticMap(Array.isArray(rows) ? rows : []));
  }

  const neighborsByWord = [];
  const startedAt = Date.now();

  for (let i = 0; i < selected.length; i += 1) {
    const target = selected[i];
    const semanticMap = semanticByTarget.get(target) || new Map();
    const scored = [];

    for (let j = 0; j < selected.length; j += 1) {
      if (i === j) continue;
      const candidate = selected[j];
      const semantic = semanticMap.get(candidate) || 0;
      const letter = letterSimilarity(target, candidate);
      const score = (WEIGHTS.semantic * semantic) + (WEIGHTS.letter * letter);

      scored.push({ word: candidate, score, semantic, letter });
    }

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.semantic !== a.semantic) return b.semantic - a.semantic;
      if (b.letter !== a.letter) return b.letter - a.letter;
      return a.word.localeCompare(b.word);
    });

    const top = scored.slice(0, K_NEIGHBORS).map((entry, idx) => ({
      rank: idx + 1,
      word: entry.word,
      score: Number(entry.score.toFixed(6))
    }));

    neighborsByWord.push({
      target,
      neighbors: top
    });

    if ((i + 1) % 250 === 0) {
      console.log(`Processed ${i + 1}/${selected.length} targets...`);
    }
  }

  const jsonl = neighborsByWord.map((row) => JSON.stringify(row)).join("\n") + "\n";
  await writeFile(OUTPUT_JSONL, jsonl, "utf8");

  const txtLines = [];
  txtLines.push(`TOP ${TOP_N} (length 4/5/6) semantic neighbors`);
  txtLines.push(`Targets: ${selected.length}`);
  txtLines.push(`Neighbors per target: ${K_NEIGHBORS}`);
  txtLines.push("");
  for (const row of neighborsByWord) {
    txtLines.push(`Target: ${row.target.toUpperCase()}`);
    for (const n of row.neighbors) {
      txtLines.push(`${n.rank}) ${n.word.toUpperCase()} (${n.score})`);
    }
    txtLines.push("");
  }
  await writeFile(OUTPUT_TXT, txtLines.join("\n"), "utf8");

  const summary = {
    generatedAt: new Date().toISOString(),
    source: {
      wordfreqPath: WORDFREQ_PATH,
      datamuseCachePath: DATAMUSE_CACHE_PATH,
      datamuseEndpoint: `${DATAMUSE_BASE}?ml=<word>&max=${DATAMUSE_MAX}`
    },
    config: {
      topN: TOP_N,
      lengths: [...LENGTHS].sort((a, b) => a - b),
      neighborsPerTarget: K_NEIGHBORS,
      weights: WEIGHTS
    },
    totals: {
      targets: selected.length,
      cacheHits,
      cacheMisses: selected.length - cacheHits
    },
    outputs: {
      jsonl: OUTPUT_JSONL,
      txt: OUTPUT_TXT
    },
    elapsedMs: Date.now() - startedAt
  };
  await writeFile(OUTPUT_SUMMARY, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
