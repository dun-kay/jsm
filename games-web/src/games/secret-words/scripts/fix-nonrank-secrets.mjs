import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BUILD_DIR = path.resolve(__dirname, "../seed-build");
const INPUT_JSONL = path.join(BUILD_DIR, "six_letter_combo_word_index.common.min50.secrets.sanitized.commoner.jsonl");
const FALLBACK_JSONL = path.join(BUILD_DIR, "six_letter_combo_word_index.min75.jsonl");
const WORDFREQ_PATH = path.join(BUILD_DIR, "wordfreq-en-25000-log.json");
const OUTPUT_JSONL = path.join(BUILD_DIR, "six_letter_combo_word_index.common.min50.secrets.sanitized.commoner.jsonl");
const OUTPUT_SUMMARY = path.join(BUILD_DIR, "six_letter_combo_word_index.common.min50.secrets.nonrankfix.summary.json");

const RUDE_WORDS = new Set(["anal","anus","arse","ass","balls","bastard","bitch","bloody","blowjob","bollock","boob","boobs","boner","butt","cock","coon","crap","cum","cunt","dick","dildo","dyke","fag","faggot","fcuk","fuck","fucked","fucker","fucking","jizz","kike","labia","masturbate","milf","nazi","nigga","nigger","orgasm","penis","piss","porn","prick","pube","pussy","queer","rape","raped","rapist","scrotum","sex","shit","shitty","slut","spunk","suck","tits","titty","twat","vagina","wank","whore"]);
const ODD = new Set(["gps","mph","mrs","hrs","lbs","pts","fbi","cpu","ios"]);

function hashString(input) {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function isClean(word) {
  if (!/^[a-z]{3,6}$/.test(word)) return false;
  if (RUDE_WORDS.has(word)) return false;
  if (ODD.has(word)) return false;
  if (word.length <= 3 && !/[aeiouy]/.test(word)) return false;
  if (!/[aeiouy]/.test(word)) return false;
  return true;
}

function parseMap(raw) {
  const map = new Map();
  for (const line of raw.split(/\r?\n/).filter(Boolean)) {
    const row = JSON.parse(line);
    map.set(String(row.letters).toUpperCase(), row);
  }
  return map;
}

async function main() {
  const [inputRaw, fallbackRaw, rankRaw] = await Promise.all([
    readFile(INPUT_JSONL, "utf8"),
    readFile(FALLBACK_JSONL, "utf8"),
    readFile(WORDFREQ_PATH, "utf8")
  ]);

  const rank = new Map(JSON.parse(rankRaw).map((r, i) => [String(r[0]).toLowerCase(), i]));
  const fallback = parseMap(fallbackRaw);
  const rows = inputRaw.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));

  let fixed = 0;
  let stillMissing = 0;

  const out = rows.map((row) => {
    const letters = String(row.letters).toUpperCase();
    const secret = String(row.secretWord).toLowerCase();
    const wordsPrimary = (row.words ?? []).map((w) => String(w).toLowerCase());

    if (rank.has(secret) && isClean(secret)) {
      return { letters, secretWord: secret, secretLength: secret.length, words: wordsPrimary };
    }

    const wordsFallback = (fallback.get(letters)?.words ?? []).map((w) => String(w).toLowerCase());
    const all = Array.from(new Set([...wordsPrimary, ...wordsFallback]));

    const pick = (len) => all
      .filter((w) => w !== secret && w.length === len && rank.has(w) && isClean(w))
      .sort((a, b) => rank.get(a) - rank.get(b) || a.localeCompare(b));

    let replacement = null;
    const same = pick(secret.length);
    if (same.length) {
      const top = same.slice(0, Math.min(14, same.length));
      replacement = top[hashString(`${letters}:${secret}:nr-same`) % top.length];
    } else if (secret.length - 1 >= 3) {
      const shorter = pick(secret.length - 1);
      if (shorter.length) {
        const top = shorter.slice(0, Math.min(14, shorter.length));
        replacement = top[hashString(`${letters}:${secret}:nr-short`) % top.length];
      }
    }

    if (replacement) {
      fixed += 1;
      return { letters, secretWord: replacement, secretLength: replacement.length, words: wordsPrimary };
    }

    stillMissing += 1;
    return { letters, secretWord: secret, secretLength: secret.length, words: wordsPrimary };
  });

  await writeFile(OUTPUT_JSONL, `${out.map((r) => JSON.stringify(r)).join("\n")}\n`, "utf8");

  const verifyMissing = out.filter((r) => !rank.has(r.secretWord) || !isClean(r.secretWord)).length;

  const summary = {
    generatedAt: new Date().toISOString(),
    source: INPUT_JSONL,
    totals: {
      combos: rows.length,
      fixed,
      stillMissing,
      verifyMissingAfterWrite: verifyMissing
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
