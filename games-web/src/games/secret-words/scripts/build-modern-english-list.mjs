import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BUILD_DIR = path.resolve(__dirname, "../seed-build");
const WORDS_ALPHA_PATH = path.join(BUILD_DIR, "words_alpha.txt");
const WORDFREQ_PATH = path.join(BUILD_DIR, "wordfreq-en-25000-log.json");

const OUTPUT_TXT = path.join(BUILD_DIR, "modern_english_3to6_words.txt");
const OUTPUT_JSON = path.join(BUILD_DIR, "modern_english_3to6_words.json");
const OUTPUT_SUMMARY = path.join(BUILD_DIR, "modern_english_3to6_words.summary.json");

const MIN_LEN = 3;
const MAX_LEN = 6;
const MAX_RANK = 22000;

const RUDE_WORDS = new Set([
  "anal", "anus", "arse", "ass", "balls", "bastard", "bitch", "bloody", "blowjob", "bollock", "boob", "boobs", "boner",
  "butt", "cock", "coon", "crap", "cum", "cunt", "dick", "dildo", "dyke", "fag", "faggot", "fcuk", "fuck", "fucked",
  "fucker", "fucking", "jizz", "kike", "labia", "masturbate", "milf", "nazi", "nigga", "nigger", "orgasm", "penis", "piss",
  "porn", "prick", "pube", "pussy", "queer", "rape", "raped", "rapist", "scrotum", "sex", "shit", "shitty", "slut", "spunk",
  "suck", "tits", "titty", "twat", "vagina", "wank", "whore"
]);

const NAME_BLOCK = new Set([
  "gary", "mary", "amir", "amy", "ira", "mia", "sam", "mac"
]);

const NON_GAME_WORD_BLOCK = new Set([
  "paso"
]);

function hasVowel(word) {
  return /[aeiouy]/.test(word);
}

function isLikelyAcronym(word) {
  return word.length <= 3 && !hasVowel(word);
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

async function main() {
  const [wordsAlphaRaw, wordfreqRaw] = await Promise.all([
    readFile(WORDS_ALPHA_PATH, "utf8"),
    readFile(WORDFREQ_PATH, "utf8")
  ]);

  const rank = parseWordfreqRank(wordfreqRaw);

  const alphaCandidates = wordsAlphaRaw
    .split(/\r?\n/)
    .map((line) => line.trim().toLowerCase())
    .filter((word) => /^[a-z]+$/.test(word))
    .filter((word) => word.length >= MIN_LEN && word.length <= MAX_LEN);

  const uniqueAlpha = Array.from(new Set(alphaCandidates));

  const modern = uniqueAlpha
    .filter((word) => rank.has(word))
    .filter((word) => rank.get(word) <= MAX_RANK)
    .filter((word) => !RUDE_WORDS.has(word))
    .filter((word) => !NAME_BLOCK.has(word))
    .filter((word) => !NON_GAME_WORD_BLOCK.has(word))
    .filter((word) => hasVowel(word))
    .filter((word) => !isLikelyAcronym(word))
    .sort((a, b) => rank.get(a) - rank.get(b) || a.localeCompare(b));

  await writeFile(OUTPUT_TXT, `${modern.join("\n")}\n`, "utf8");
  await writeFile(OUTPUT_JSON, `${JSON.stringify(modern, null, 2)}\n`, "utf8");

  const len3 = modern.filter((word) => word.length === 3).length;
  const len4 = modern.filter((word) => word.length === 4).length;
  const len5 = modern.filter((word) => word.length === 5).length;
  const len6 = modern.filter((word) => word.length === 6).length;

  const summary = {
    generatedAt: new Date().toISOString(),
    inputs: {
      wordsAlphaPath: WORDS_ALPHA_PATH,
      wordfreqPath: WORDFREQ_PATH
    },
    rules: {
      minLength: MIN_LEN,
      maxLength: MAX_LEN,
      maxWordfreqRank: MAX_RANK,
      excludesRudeWords: true,
      excludesNameBlock: true,
      excludesNonGameWordBlock: true,
      excludesLikelyAcronyms: true
    },
    totals: {
      alphaCandidates: alphaCandidates.length,
      alphaUnique: uniqueAlpha.length,
      modernTotal: modern.length,
      len3,
      len4,
      len5,
      len6
    },
    spotChecks: {
      paso: modern.includes("paso"),
      doable: modern.includes("doable")
    },
    outputs: {
      txt: OUTPUT_TXT,
      json: OUTPUT_JSON
    }
  };

  await writeFile(OUTPUT_SUMMARY, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
