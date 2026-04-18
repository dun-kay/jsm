import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BUILD_DIR = path.resolve(__dirname, "../seed-build");
const INPUT_JSONL = path.join(BUILD_DIR, "six_letter_combo_word_index.common.min50.secrets.sanitized.commoner.jsonl");
const WORDFREQ_PATH = path.join(BUILD_DIR, "wordfreq-en-25000-log.json");
const DATAMUSE_CACHE_PATH = path.join(BUILD_DIR, "datamuse-ml-cache.json");
const OUTPUT_JSONL = path.join(BUILD_DIR, "six_letter_combo_word_index.common.min50.secrets.sanitized.ranked.jsonl");
const OUTPUT_SUMMARY = path.join(BUILD_DIR, "six_letter_combo_word_index.common.min50.secrets.sanitized.ranked.summary.json");

const DATAMUSE_BASE = "https://api.datamuse.com/words";
const MAX_DATAMUSE = 1000;
const CONCURRENCY = 8;

// Similarity blend weights (sum to 1)
const WEIGHTS = {
  semantic: 0.65,
  letter: 0.35
};

const RUDE_WORDS = new Set([
  "anal","anus","arse","ass","balls","bastard","bitch","bloody","blowjob","bollock","boob","boobs","boner",
  "butt","cock","coon","crap","cum","cunt","dick","dildo","dyke","fag","faggot","fcuk","fuck","fucked",
  "fucker","fucking","jizz","kike","labia","masturbate","milf","nazi","nigga","nigger","orgasm","penis","piss",
  "porn","prick","pube","pussy","queer","rape","raped","rapist","scrotum","sex","shit","shitty","slut","spunk",
  "suck","tits","titty","twat","vagina","wank","whore"
]);

function parseArgs() {
  const args = process.argv.slice(2);
  const config = {
    limit: null,
    noNetwork: false
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--limit") {
      const value = Number(args[i + 1]);
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error("--limit must be a positive number");
      }
      config.limit = Math.floor(value);
      i += 1;
    } else if (arg === "--no-network") {
      config.noNetwork = true;
    }
  }

  return config;
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
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + cost
      );
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
  if (a.length < 2 || b.length < 2) {
    return a === b ? 1 : 0;
  }

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

function letterSimilarity(secretWord, candidateWord) {
  if (secretWord === candidateWord) return 1;

  const maxLen = Math.max(secretWord.length, candidateWord.length);
  const levSim = 1 - (levenshteinDistance(secretWord, candidateWord) / maxLen);
  const jw = jaroWinkler(secretWord, candidateWord);
  const dice = diceBigrams(secretWord, candidateWord);

  return clamp01((0.45 * levSim) + (0.35 * jw) + (0.20 * dice));
}

const ODD_TOP_WORDS = new Set(["ios", "gps", "mph", "mrs", "hrs", "lbs", "pts", "fbi", "cpu"]);

function isUndesirableForTop(word) {
  if (RUDE_WORDS.has(word)) {
    return true;
  }

  if (ODD_TOP_WORDS.has(word)) {
    return true;
  }

  // Push acronym-like tokens (e.g. mrs, gps, tsp, std) away from top ranks.
  if (word.length <= 3 && !/[aeiouy]/.test(word)) {
    return true;
  }

  return false;
}

function safeParseJson(content, fallback) {
  try {
    return JSON.parse(content);
  } catch {
    return fallback;
  }
}

async function loadWordfreqRank() {
  const raw = await readFile(WORDFREQ_PATH, "utf8");
  const parsed = JSON.parse(raw);
  const rank = new Map();

  for (let i = 0; i < parsed.length; i += 1) {
    const row = parsed[i];
    if (!Array.isArray(row) || typeof row[0] !== "string") continue;
    rank.set(row[0].toLowerCase(), i);
  }

  return rank;
}

async function loadDatamuseCache() {
  try {
    const raw = await readFile(DATAMUSE_CACHE_PATH, "utf8");
    return safeParseJson(raw, {});
  } catch {
    return {};
  }
}

async function saveDatamuseCache(cache) {
  await writeFile(DATAMUSE_CACHE_PATH, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
}

async function fetchDatamuseMl(secretWord) {
  const url = `${DATAMUSE_BASE}?ml=${encodeURIComponent(secretWord)}&max=${MAX_DATAMUSE}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Datamuse failed for ${secretWord}: ${response.status} ${response.statusText}`);
  }
  const data = await response.json();
  if (!Array.isArray(data)) return [];
  return data;
}

function buildSemanticMap(datamuseRows) {
  const semantic = new Map();
  let maxScore = 0;

  for (const row of datamuseRows) {
    if (!row || typeof row.word !== "string") continue;
    if (typeof row.score !== "number") continue;
    const word = row.word.toLowerCase();
    semantic.set(word, row.score);
    if (row.score > maxScore) maxScore = row.score;
  }

  if (maxScore <= 0) {
    return new Map();
  }

  const normalized = new Map();
  for (const [word, score] of semantic.entries()) {
    normalized.set(word, score / maxScore);
  }

  return normalized;
}

function rankWordsForCombo(row, semanticMap, wordfreqRank) {
  const secretWord = String(row.secretWord).toLowerCase();
  const words = Array.isArray(row.words) ? row.words.map((w) => String(w).toLowerCase()) : [];

  const deduped = [];
  const seen = new Set();
  for (const word of words) {
    if (!/^[a-z]{2,}$/.test(word)) continue;
    if (seen.has(word)) continue;
    seen.add(word);
    deduped.push(word);
  }

  if (!seen.has(secretWord)) {
    deduped.push(secretWord);
    seen.add(secretWord);
  }

  const scored = deduped.map((word) => {
    const semantic = semanticMap.has(word) ? semanticMap.get(word) : 0;
    const letter = letterSimilarity(secretWord, word);

    // Secret must remain #1.
    if (word === secretWord) {
      return {
        word,
        score: 1,
        semantic: 1,
        letter: 1,
        freqRank: wordfreqRank.has(word) ? wordfreqRank.get(word) : 1_000_000,
      undesirable: isUndesirableForTop(word),
        undesirable: false
      };
    }

    const score = (WEIGHTS.semantic * semantic) + (WEIGHTS.letter * letter);

    return {
      word,
      score,
      semantic,
      letter,
      freqRank: wordfreqRank.has(word) ? wordfreqRank.get(word) : 1_000_000,
      undesirable: isUndesirableForTop(word)
    };
  });

  scored.sort((a, b) => {
    if (a.undesirable !== b.undesirable) return a.undesirable ? 1 : -1;
    if (b.score !== a.score) return b.score - a.score;
    if (b.semantic !== a.semantic) return b.semantic - a.semantic;
    if (b.letter !== a.letter) return b.letter - a.letter;
    if (a.freqRank !== b.freqRank) return a.freqRank - b.freqRank;
    return a.word.localeCompare(b.word);
  });

  // Guarantee secret is rank 1
  const secretIndex = scored.findIndex((entry) => entry.word === secretWord);
  if (secretIndex > 0) {
    const [secret] = scored.splice(secretIndex, 1);
    scored.unshift(secret);
  }

  return {
    wordsOrdered: scored.map((entry) => entry.word),
    scoreDebug: scored.map((entry) => ({
      word: entry.word,
      score: Number(entry.score.toFixed(6)),
      semantic: Number(entry.semantic.toFixed(6)),
      letter: Number(entry.letter.toFixed(6))
    }))
  };
}

async function runPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let index = 0;

  async function runner() {
    while (true) {
      const current = index;
      index += 1;
      if (current >= items.length) return;
      results[current] = await worker(items[current], current);
    }
  }

  const workers = Array.from({ length: Math.max(1, concurrency) }, () => runner());
  await Promise.all(workers);
  return results;
}

async function main() {
  const args = parseArgs();
  const [inputRaw, wordfreqRank, datamuseCache] = await Promise.all([
    readFile(INPUT_JSONL, "utf8"),
    loadWordfreqRank(),
    loadDatamuseCache()
  ]);

  const rows = inputRaw
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));

  const selectedRows = args.limit ? rows.slice(0, args.limit) : rows;

  const uniqueSecrets = Array.from(new Set(selectedRows.map((row) => String(row.secretWord).toLowerCase())));
  let cacheHits = 0;
  let fetched = 0;

  await runPool(uniqueSecrets, CONCURRENCY, async (secretWord) => {
    if (datamuseCache[secretWord]) {
      cacheHits += 1;
      return;
    }
    if (args.noNetwork) {
      datamuseCache[secretWord] = [];
      return;
    }

    const rows = await fetchDatamuseMl(secretWord);
    datamuseCache[secretWord] = rows;
    fetched += 1;

    if (fetched % 200 === 0) {
      console.log(`Fetched semantic rows for ${fetched}/${uniqueSecrets.length} secrets...`);
    }
  });

  await saveDatamuseCache(datamuseCache);

  const outRows = selectedRows.map((row) => {
    const secretWord = String(row.secretWord).toLowerCase();
    const semanticMap = buildSemanticMap(datamuseCache[secretWord] ?? []);
    const ranked = rankWordsForCombo(row, semanticMap, wordfreqRank);

    return {
      letters: String(row.letters).toUpperCase(),
      secretWord,
      words: ranked.wordsOrdered
    };
  });

  await writeFile(OUTPUT_JSONL, `${outRows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");

  const summary = {
    generatedAt: new Date().toISOString(),
    source: INPUT_JSONL,
    semanticSource: {
      provider: "Datamuse /words?ml=",
      baseUrl: DATAMUSE_BASE,
      maxResultsPerSecret: MAX_DATAMUSE,
      cachePath: DATAMUSE_CACHE_PATH,
      cacheHits,
      fetched,
      uniqueSecrets: uniqueSecrets.length,
      noNetworkMode: args.noNetwork
    },
    scoring: {
      semanticWeight: WEIGHTS.semantic,
      letterWeight: WEIGHTS.letter,
      letterSimilarity: "0.45 Levenshtein + 0.35 Jaro-Winkler + 0.20 Dice bigrams"
    },
    totals: {
      combosProcessed: selectedRows.length,
      combosAvailable: rows.length
    },
    output: OUTPUT_JSONL
  };

  await writeFile(OUTPUT_SUMMARY, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});



