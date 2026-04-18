import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BUILD_DIR = path.resolve(__dirname, "../seed-build");
const INPUT_JSONL = path.join(BUILD_DIR, "six_letter_combo_word_index.common.min50.secrets.sanitized.jsonl");
const FALLBACK_JSONL = path.join(BUILD_DIR, "six_letter_combo_word_index.min75.jsonl");
const WORDFREQ_PATH = path.join(BUILD_DIR, "wordfreq-en-25000-log.json");
const OUTPUT_JSONL = path.join(BUILD_DIR, "six_letter_combo_word_index.common.min50.secrets.sanitized.commoner.jsonl");
const OUTPUT_SUMMARY = path.join(BUILD_DIR, "six_letter_combo_word_index.common.min50.secrets.sanitized.commoner.summary.json");

const MAX_RANK = 22000;

const RUDE_WORDS = new Set([
  "anal","anus","arse","ass","balls","bastard","bitch","bloody","blowjob","bollock","boob","boobs","boner",
  "butt","cock","coon","crap","cum","cunt","dick","dildo","dyke","fag","faggot","fcuk","fuck","fucked",
  "fucker","fucking","jizz","kike","labia","masturbate","milf","nazi","nigga","nigger","orgasm","penis","piss",
  "porn","prick","pube","pussy","queer","rape","raped","rapist","scrotum","sex","shit","shitty","slut","spunk",
  "suck","tits","titty","twat","vagina","wank","whore"
]);

const NAME_BLOCK = new Set(["mac","sam","mabel","adolf","louisa","sophia","dalton","truman","sergio","conrad","laurie","manuel","dwayne","markus"]);
const ODD_BLOCK = new Set(["gps","mph","mrs","hrs","lbs","pts","fbi","cpu","ios"]);

function hashString(input) {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function likelyPlural(word, vocabSet, rank) {
  if (word.length < 4 || !word.endsWith("s") || word.endsWith("ss")) return false;
  const candidates = new Set([word.slice(0, -1)]);
  if (word.endsWith("ies") && word.length > 4) candidates.add(`${word.slice(0, -3)}y`);
  if (word.endsWith("es") && word.length > 3) candidates.add(word.slice(0, -2));
  for (const base of candidates) {
    if (base.length < 3) continue;
    if (vocabSet.has(base) || rank.has(base)) return true;
  }
  return false;
}

function isOdd(word) {
  return ODD_BLOCK.has(word) || (word.length <= 3 && !/[aeiouy]/.test(word));
}

function isGoodSecret(word, vocabSet, rank) {
  if (!/^[a-z]{3,6}$/.test(word)) return false;
  if (RUDE_WORDS.has(word)) return false;
  if (NAME_BLOCK.has(word)) return false;
  if (isOdd(word)) return false;
  if (likelyPlural(word, vocabSet, rank)) return false;
  if (!/[aeiouy]/.test(word)) return false;
  if (!rank.has(word)) return false;
  if (rank.get(word) > MAX_RANK) return false;
  return true;
}

function parseJsonlMap(raw) {
  const map = new Map();
  for (const line of raw.split(/\r?\n/).filter(Boolean)) {
    const row = JSON.parse(line);
    map.set(String(row.letters).toUpperCase(), row);
  }
  return map;
}

function pickReplacement(letters, secretWord, wordsPrimary, wordsFallback, rank) {
  const merged = [];
  const seen = new Set();
  for (const raw of [...wordsPrimary, ...wordsFallback]) {
    const word = String(raw).toLowerCase();
    if (seen.has(word)) continue;
    seen.add(word);
    merged.push(word);
  }
  const vocabSet = new Set(merged);

  const mk = (len) => merged
    .filter((w) => w.length === len && w !== secretWord && isGoodSecret(w, vocabSet, rank))
    .map((w) => ({ w, r: rank.get(w) }))
    .sort((a, b) => a.r - b.r || a.w.localeCompare(b.w));

  const mkFallback = (len) => merged
    .filter((w) => {
      if (w.length !== len || w === secretWord) return false;
      if (!/^[a-z]{3,6}$/.test(w)) return false;
      if (RUDE_WORDS.has(w)) return false;
      if (NAME_BLOCK.has(w)) return false;
      if (isOdd(w)) return false;
      if (likelyPlural(w, vocabSet, rank)) return false;
      if (!/[aeiouy]/.test(w)) return false;
      return true;
    })
    .map((w) => ({ w, r: rank.has(w) ? rank.get(w) : 1_000_000 }))
    .sort((a, b) => a.r - b.r || a.w.localeCompare(b.w));

  const same = mk(secretWord.length);
  if (same.length) {
    const top = same.slice(0, Math.min(12, same.length));
    return top[hashString(`${letters}:${secretWord}:same`) % top.length].w;
  }

  if (secretWord.length - 1 >= 3) {
    const shorter = mk(secretWord.length - 1);
    if (shorter.length) {
      const top = shorter.slice(0, Math.min(12, shorter.length));
      return top[hashString(`${letters}:${secretWord}:short`) % top.length].w;
    }
  }

  const sameFallback = mkFallback(secretWord.length);
  if (sameFallback.length) {
    const top = sameFallback.slice(0, Math.min(12, sameFallback.length));
    return top[hashString(`${letters}:${secretWord}:same-fallback`) % top.length].w;
  }

  if (secretWord.length - 1 >= 3) {
    const shorterFallback = mkFallback(secretWord.length - 1);
    if (shorterFallback.length) {
      const top = shorterFallback.slice(0, Math.min(12, shorterFallback.length));
      return top[hashString(`${letters}:${secretWord}:short-fallback`) % top.length].w;
    }
  }

  return null;
}

async function main() {
  const [inputRaw, fallbackRaw, rankRaw] = await Promise.all([
    readFile(INPUT_JSONL, "utf8"),
    readFile(FALLBACK_JSONL, "utf8"),
    readFile(WORDFREQ_PATH, "utf8")
  ]);

  const rank = new Map(JSON.parse(rankRaw).map((row, i) => [String(row[0]).toLowerCase(), i]));
  const fallbackMap = parseJsonlMap(fallbackRaw);

  const rows = inputRaw.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));

  let flagged = 0;
  let replaced = 0;
  let unresolved = 0;

  const out = rows.map((row) => {
    const letters = String(row.letters).toUpperCase();
    const secretWord = String(row.secretWord).toLowerCase();
    const words = Array.isArray(row.words) ? row.words.map((w) => String(w).toLowerCase()) : [];
    const vocabSet = new Set(words);

    if (isGoodSecret(secretWord, vocabSet, rank)) {
      return { letters, secretWord, secretLength: secretWord.length, words };
    }

    flagged += 1;
    const fallbackWords = (fallbackMap.get(letters)?.words ?? []).map((w) => String(w).toLowerCase());
    const replacement = pickReplacement(letters, secretWord, words, fallbackWords, rank);

    if (!replacement) {
      unresolved += 1;
      return { letters, secretWord, secretLength: secretWord.length, words, unresolvedFlags: ["commonness"] };
    }

    replaced += 1;
    return { letters, secretWord: replacement, secretLength: replacement.length, words };
  });

  await writeFile(OUTPUT_JSONL, `${out.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");

  const summary = {
    generatedAt: new Date().toISOString(),
    source: INPUT_JSONL,
    fallbackSource: FALLBACK_JSONL,
    maxRankAllowed: MAX_RANK,
    totals: {
      combos: rows.length,
      flagged,
      replaced,
      unresolved
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


