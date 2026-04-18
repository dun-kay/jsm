import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BUILD_DIR = path.resolve(__dirname, "../seed-build");
const INPUT_JSONL = path.join(BUILD_DIR, "six_letter_combo_word_index.common.min50.secrets.jsonl");
const FALLBACK_JSONL = path.join(BUILD_DIR, "six_letter_combo_word_index.min75.jsonl");
const WORDFREQ_PATH = path.join(BUILD_DIR, "wordfreq-en-25000-log.json");
const OUTPUT_JSONL = path.join(BUILD_DIR, "six_letter_combo_word_index.common.min50.secrets.sanitized.jsonl");
const OUTPUT_SUMMARY = path.join(BUILD_DIR, "six_letter_combo_word_index.common.min50.secrets.sanitized.summary.json");

const NAME_SOURCE_URLS = [
  "https://raw.githubusercontent.com/arineng/arincli/master/lib/male-first-names.txt",
  "https://raw.githubusercontent.com/arineng/arincli/master/lib/female-first-names.txt"
];
const NAME_CACHE_FILES = [
  path.join(BUILD_DIR, "male-first-names.txt"),
  path.join(BUILD_DIR, "female-first-names.txt")
];

const RUDE_WORDS = new Set([
  "anal","anus","arse","ass","balls","bastard","bitch","bloody","blowjob","bollock","boob","boobs","boner",
  "butt","cock","coon","crap","cum","cunt","dick","dildo","dyke","fag","faggot","fcuk","fuck","fucked",
  "fucker","fucking","jizz","kike","labia","masturbate","milf","nazi","nigga","nigger","orgasm","penis","piss",
  "porn","prick","pube","pussy","queer","rape","raped","rapist","scrotum","sex","shit","shitty","slut","spunk",
  "suck","tits","titty","twat","vagina","wank","whore"
]);

const SHORT_NAME_BLOCKLIST = new Set(["mac", "sam"]);

function hashString(input) {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

async function ensureNameLists() {
  const results = [];

  for (let i = 0; i < NAME_SOURCE_URLS.length; i += 1) {
    const url = NAME_SOURCE_URLS[i];
    const cachePath = NAME_CACHE_FILES[i];

    let fetched = false;
    try {
      await readFile(cachePath, "utf8");
    } catch {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to download name list ${url}: ${response.status} ${response.statusText}`);
      }
      const text = await response.text();
      await writeFile(cachePath, text, "utf8");
      fetched = true;
    }

    const content = await readFile(cachePath, "utf8");
    results.push({ fetched, content, url, cachePath });
  }

  return results;
}

function buildNameSet(nameSources) {
  const set = new Set();

  for (const source of nameSources) {
    const lines = source.content.split(/\r?\n/);
    for (const line of lines) {
      const name = line.trim().toLowerCase();
      if (!/^[a-z]{3,12}$/.test(name)) continue;
      set.add(name);
    }
  }

  ["mabel", "adolf"].forEach((n) => set.add(n));

  return set;
}

function parseWordfreqRank(raw) {
  const parsed = JSON.parse(raw);
  const rank = new Map();

  for (let i = 0; i < parsed.length; i += 1) {
    const row = parsed[i];
    if (!Array.isArray(row) || typeof row[0] !== "string") continue;
    rank.set(row[0].toLowerCase(), i);
  }

  return rank;
}


function isAcronymLike(word) {
  if (word.length <= 3 && !/[aeiouy]/.test(word)) {
    return true;
  }

  const manual = new Set(["gps", "mph", "mrs", "hrs", "lbs", "pts", "fbi", "cpu", "ios"]);
  return manual.has(word);
}
function likelyPlural(word, vocabSet, commonRank) {
  if (word.length < 4) return false;
  if (!word.endsWith("s")) return false;
  if (word.endsWith("ss")) return false;

  const candidates = new Set();
  candidates.add(word.slice(0, -1));

  if (word.endsWith("ies") && word.length > 4) {
    candidates.add(`${word.slice(0, -3)}y`);
  }

  if (word.endsWith("es") && word.length > 3) {
    candidates.add(word.slice(0, -2));
  }

  for (const base of candidates) {
    if (base.length < 3) continue;
    if (vocabSet.has(base) || commonRank.has(base)) {
      return true;
    }
  }

  return false;
}

function isName(word, nameSet) {
  if (SHORT_NAME_BLOCKLIST.has(word)) return true;
  if (word.length <= 3) return false;
  return nameSet.has(word);
}

function classifyWord(word, vocabSet, nameSet, commonRank) {
  const reasons = [];

  if (RUDE_WORDS.has(word)) reasons.push("rude");
  if (isName(word, nameSet)) reasons.push("name");
  if (likelyPlural(word, vocabSet, commonRank)) reasons.push("plural");
  if (isAcronymLike(word)) reasons.push("odd");

  return reasons;
}

function pickFromCandidates(candidates, comboLetters, originalWord, suffix) {
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    return a.word.localeCompare(b.word);
  });

  const top = candidates.slice(0, Math.min(12, candidates.length));
  const index = hashString(`${comboLetters}:${originalWord}:${suffix}`) % top.length;
  return top[index].word;
}

function pickReplacement(row, fallbackWords, originalWord, nameSet, commonRank) {
  const primaryWords = Array.isArray(row.words) ? row.words.map((w) => String(w).toLowerCase()) : [];
  const fallback = Array.isArray(fallbackWords) ? fallbackWords : [];

  const merged = [];
  const seen = new Set();
  for (const word of [...primaryWords, ...fallback]) {
    const w = String(word).toLowerCase();
    if (!/^[a-z]{3,6}$/.test(w)) continue;
    if (seen.has(w)) continue;
    seen.add(w);
    merged.push(w);
  }

  const vocabSet = new Set(merged);
  const originalLength = originalWord.length;

  const candidatesByLength = (targetLen) => merged
    .filter((candidate) => {
      if (candidate.length !== targetLen) return false;
      if (candidate === originalWord) return false;
      return classifyWord(candidate, vocabSet, nameSet, commonRank).length === 0;
    })
    .map((word) => ({
      word,
      rank: commonRank.has(word) ? commonRank.get(word) : 1_000_000
    }));

  const same = pickFromCandidates(candidatesByLength(originalLength), row.letters, originalWord, "same");
  if (same) return same;

  if (originalLength - 1 >= 3) {
    const shorter = pickFromCandidates(candidatesByLength(originalLength - 1), row.letters, originalWord, "short");
    if (shorter) return shorter;
  }

  return null;
}

function parseJsonlMap(raw, keyField = "letters") {
  const map = new Map();
  const rows = raw.split(/\r?\n/).filter((line) => line.trim());
  for (const line of rows) {
    const row = JSON.parse(line);
    map.set(String(row[keyField]).toUpperCase(), row);
  }
  return map;
}

async function main() {
  const [inputRaw, fallbackRaw, rankRaw, nameSources] = await Promise.all([
    readFile(INPUT_JSONL, "utf8"),
    readFile(FALLBACK_JSONL, "utf8"),
    readFile(WORDFREQ_PATH, "utf8"),
    ensureNameLists()
  ]);

  const commonRank = parseWordfreqRank(rankRaw);
  const nameSet = buildNameSet(nameSources);

  const inputRows = inputRaw.split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line));
  const fallbackMap = parseJsonlMap(fallbackRaw);

  let flaggedSecrets = 0;
  let replacedSecrets = 0;
  let unresolved = 0;
  const removedReasonCounts = { rude: 0, name: 0, plural: 0, odd: 0 };
  const replacementLengthCounts = { same: 0, shorter: 0 };

  const outputRows = inputRows.map((row) => {
    const letters = String(row.letters).toUpperCase();
    const secretWord = String(row.secretWord).toLowerCase();
    const words = Array.isArray(row.words) ? row.words.map((w) => String(w).toLowerCase()) : [];
    const vocabSet = new Set(words);

    const reasons = classifyWord(secretWord, vocabSet, nameSet, commonRank);
    if (reasons.length === 0) {
      return { letters, secretWord, secretLength: secretWord.length, words };
    }

    flaggedSecrets += 1;
    reasons.forEach((reason) => {
      removedReasonCounts[reason] += 1;
    });

    const fallbackWords = fallbackMap.get(letters)?.words ?? [];
    const replacement = pickReplacement({ letters, words }, fallbackWords, secretWord, nameSet, commonRank);

    if (!replacement) {
      unresolved += 1;
      return {
        letters,
        secretWord,
        secretLength: secretWord.length,
        words,
        unresolvedFlags: reasons
      };
    }

    replacedSecrets += 1;
    if (replacement.length === secretWord.length) {
      replacementLengthCounts.same += 1;
    } else {
      replacementLengthCounts.shorter += 1;
    }

    return {
      letters,
      secretWord: replacement,
      secretLength: replacement.length,
      words
    };
  });

  await writeFile(OUTPUT_JSONL, `${outputRows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");

  const summary = {
    generatedAt: new Date().toISOString(),
    source: INPUT_JSONL,
    fallbackSource: FALLBACK_JSONL,
    nameSources: nameSources.map((source) => ({
      url: source.url,
      cachePath: source.cachePath,
      downloadedThisRun: source.fetched
    })),
    totals: {
      combos: inputRows.length,
      flaggedSecrets,
      replacedSecrets,
      unresolved,
      removedReasonCounts,
      replacementLengthCounts,
      wordsRemoved: replacedSecrets
    },
    outputs: {
      jsonl: OUTPUT_JSONL
    }
  };

  await writeFile(OUTPUT_SUMMARY, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

