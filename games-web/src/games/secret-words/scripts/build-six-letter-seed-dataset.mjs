import { createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BUILD_DIR = path.resolve(__dirname, "../seed-build");
const DICT_PATH = path.join(BUILD_DIR, "words_alpha.txt");
const COMBOS_PATH = path.join(BUILD_DIR, "six_letter_combos_randomized.txt");
const INDEX_PATH = path.join(BUILD_DIR, "six_letter_combo_word_index.jsonl");
const SUMMARY_PATH = path.join(BUILD_DIR, "six_letter_combo_word_index.summary.json");
const SOURCE_PATH = path.join(BUILD_DIR, "dictionary_source.json");

const DICT_URL = "https://raw.githubusercontent.com/dwyl/english-words/master/words_alpha.txt";
const ALPHABET = "abcdefghijklmnopqrstuvwxyz";
const TOTAL_COMBOS = 230230; // C(26, 6)
const SHUFFLE_SEED = "secret-words-six-letter-combos-v1";

function hashSeed(input) {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
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

function hasUniqueLetters(word) {
  return new Set(word).size === word.length;
}

function normalizeLetters(word) {
  return [...word].sort();
}

function mergeSortedChars(left, right) {
  const merged = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] <= right[j]) {
      merged.push(left[i]);
      i += 1;
    } else {
      merged.push(right[j]);
      j += 1;
    }
  }
  while (i < left.length) {
    merged.push(left[i]);
    i += 1;
  }
  while (j < right.length) {
    merged.push(right[j]);
    j += 1;
  }
  return merged.join("");
}

function eachCombination(items, choose, onPick, start = 0, picked = []) {
  if (picked.length === choose) {
    onPick(picked);
    return;
  }

  const needed = choose - picked.length;
  for (let i = start; i <= items.length - needed; i += 1) {
    picked.push(items[i]);
    eachCombination(items, choose, onPick, i + 1, picked);
    picked.pop();
  }
}

function generateAllSixLetterCombos() {
  const combos = [];
  const letters = ALPHABET;

  for (let a = 0; a < 21; a += 1) {
    for (let b = a + 1; b < 22; b += 1) {
      for (let c = b + 1; c < 23; c += 1) {
        for (let d = c + 1; d < 24; d += 1) {
          for (let e = d + 1; e < 25; e += 1) {
            for (let f = e + 1; f < 26; f += 1) {
              combos.push(`${letters[a]}${letters[b]}${letters[c]}${letters[d]}${letters[e]}${letters[f]}`);
            }
          }
        }
      }
    }
  }

  return combos;
}

function shuffleInPlace(list, seedText) {
  const rng = mulberry32(hashSeed(seedText));
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
}

async function ensureDictionaryDownloaded() {
  try {
    await access(DICT_PATH);
    return { downloaded: false };
  } catch {
    // continue to download
  }

  console.log(`Downloading dictionary from ${DICT_URL} ...`);
  const response = await fetch(DICT_URL);
  if (!response.ok) {
    throw new Error(`Dictionary download failed: ${response.status} ${response.statusText}`);
  }
  const text = await response.text();
  await writeFile(DICT_PATH, text, "utf8");
  return { downloaded: true };
}

async function loadFilteredWords() {
  const raw = await readFile(DICT_PATH, "utf8");
  const seen = new Set();
  const words = [];

  for (const line of raw.split(/\r?\n/)) {
    const word = line.trim().toLowerCase();
    if (!word) continue;
    if (!/^[a-z]+$/.test(word)) continue;
    if (word.length < 2 || word.length > 6) continue;
    if (!hasUniqueLetters(word)) continue;
    if (seen.has(word)) continue;
    seen.add(word);
    words.push(word);
  }

  return words;
}

function buildComboWordMap(words) {
  const comboToWords = new Map();
  const alphabetChars = [...ALPHABET];
  let processed = 0;

  for (const word of words) {
    const letters = normalizeLetters(word);
    const inWord = new Set(letters);
    const remaining = alphabetChars.filter((ch) => !inWord.has(ch));
    const needed = 6 - letters.length;

    if (needed === 0) {
      const key = letters.join("");
      const bucket = comboToWords.get(key);
      if (bucket) {
        bucket.push(word);
      } else {
        comboToWords.set(key, [word]);
      }
    } else {
      eachCombination(remaining, needed, (extras) => {
        const key = mergeSortedChars(letters, extras);
        const bucket = comboToWords.get(key);
        if (bucket) {
          bucket.push(word);
        } else {
          comboToWords.set(key, [word]);
        }
      });
    }

    processed += 1;
    if (processed % 5000 === 0) {
      console.log(`Processed ${processed} / ${words.length} words...`);
    }
  }

  return comboToWords;
}

async function writeIndexJsonl(randomizedCombos, comboToWords) {
  const stream = createWriteStream(INDEX_PATH, { encoding: "utf8" });

  await new Promise((resolve, reject) => {
    stream.on("error", reject);
    stream.on("finish", resolve);

    for (const combo of randomizedCombos) {
      const words = comboToWords.get(combo) ?? [];
      const payload = { letters: combo.toUpperCase(), words };
      stream.write(`${JSON.stringify(payload)}\n`);
    }

    stream.end();
  });
}

async function main() {
  await mkdir(BUILD_DIR, { recursive: true });

  const dictStatus = await ensureDictionaryDownloaded();

  console.log("Generating all six-letter unique combinations...");
  const combos = generateAllSixLetterCombos();
  if (combos.length !== TOTAL_COMBOS) {
    throw new Error(`Expected ${TOTAL_COMBOS} combos, got ${combos.length}`);
  }

  console.log("Randomizing combination order...");
  shuffleInPlace(combos, SHUFFLE_SEED);
  await writeFile(COMBOS_PATH, combos.map((combo) => combo.toUpperCase()).join("\n"), "utf8");

  console.log("Loading and filtering dictionary words...");
  const words = await loadFilteredWords();
  console.log(`Filtered words count: ${words.length}`);

  console.log("Building combo -> words map...");
  const comboToWords = buildComboWordMap(words);

  console.log("Writing JSONL index...");
  await writeIndexJsonl(combos, comboToWords);

  let nonEmpty = 0;
  let totalAssignedWords = 0;
  let maxWords = 0;
  let maxCombo = "";

  for (const combo of combos) {
    const list = comboToWords.get(combo) ?? [];
    if (list.length > 0) {
      nonEmpty += 1;
      totalAssignedWords += list.length;
      if (list.length > maxWords) {
        maxWords = list.length;
        maxCombo = combo.toUpperCase();
      }
    }
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    dictionary: {
      source: DICT_URL,
      path: DICT_PATH,
      downloadedThisRun: dictStatus.downloaded,
      filteredWordsCount: words.length,
      constraints: [
        "letters only a-z",
        "length 2-6",
        "no repeated letters"
      ]
    },
    combos: {
      total: combos.length,
      randomizedSeed: SHUFFLE_SEED,
      randomizedOutputPath: COMBOS_PATH
    },
    index: {
      outputPath: INDEX_PATH,
      nonEmptyCombos: nonEmpty,
      emptyCombos: combos.length - nonEmpty,
      totalWordAssignments: totalAssignedWords,
      maxWordsInSingleCombo: maxWords,
      maxWordsCombo: maxCombo
    }
  };

  await writeFile(SUMMARY_PATH, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  await writeFile(
    SOURCE_PATH,
    `${JSON.stringify({ source: DICT_URL, retrievedAt: new Date().toISOString() }, null, 2)}\n`,
    "utf8"
  );

  console.log("Done.");
  console.log(`Combos file: ${COMBOS_PATH}`);
  console.log(`Index file: ${INDEX_PATH}`);
  console.log(`Summary file: ${SUMMARY_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
