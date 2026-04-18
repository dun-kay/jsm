import { createReadStream, createWriteStream } from "node:fs";
import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BUILD_DIR = path.resolve(__dirname, "../seed-build");
const INPUT_JSONL = path.join(BUILD_DIR, "six_letter_combo_word_index.min75.jsonl");
const OUTPUT_JSONL = path.join(BUILD_DIR, "six_letter_combo_word_index.min75.common.jsonl");
const OUTPUT_COMBOS = path.join(BUILD_DIR, "six_letter_combos_randomized.min75.common.txt");
const OUTPUT_SUMMARY = path.join(BUILD_DIR, "six_letter_combo_word_index.min75.common.summary.json");
const WORDFREQ_CACHE = path.join(BUILD_DIR, "wordfreq-en-25000-log.json");
const WORDFREQ_URL = "https://raw.githubusercontent.com/aparrish/wordfreq-en-25000/main/wordfreq-en-25000-log.json";

async function ensureWordfreqList() {
  try {
    await access(WORDFREQ_CACHE);
    return { downloaded: false };
  } catch {
    // not cached
  }

  const response = await fetch(WORDFREQ_URL);
  if (!response.ok) {
    throw new Error(`Failed to download wordfreq list: ${response.status} ${response.statusText}`);
  }
  const text = await response.text();
  await writeFile(WORDFREQ_CACHE, text, "utf8");
  return { downloaded: true };
}

async function loadCommonSet() {
  const raw = await readFile(WORDFREQ_CACHE, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("wordfreq list has unexpected format");
  }

  const common = new Set();
  for (const row of parsed) {
    if (!Array.isArray(row) || typeof row[0] !== "string") continue;
    const word = row[0].trim().toLowerCase();
    if (!/^[a-z]+$/.test(word)) continue;
    if (word.length < 2 || word.length > 6) continue;
    common.add(word);
  }
  return common;
}

async function main() {
  const source = await ensureWordfreqList();
  const commonSet = await loadCommonSet();

  const rl = readline.createInterface({
    input: createReadStream(INPUT_JSONL, { encoding: "utf8" }),
    crlfDelay: Infinity
  });

  const out = createWriteStream(OUTPUT_JSONL, { encoding: "utf8" });

  let combosIn = 0;
  let combosOut = 0;
  let combosDropped = 0;
  let wordsIn = 0;
  let wordsOut = 0;
  let wordsRemoved = 0;
  const keptCombos = [];

  for await (const line of rl) {
    if (!line.trim()) continue;
    combosIn += 1;
    const row = JSON.parse(line);
    const letters = String(row.letters).toUpperCase();
    const words = Array.isArray(row.words) ? row.words : [];

    wordsIn += words.length;
    const filtered = words.filter((word) => commonSet.has(String(word).toLowerCase()));
    wordsOut += filtered.length;
    wordsRemoved += (words.length - filtered.length);

    if (filtered.length > 0) {
      combosOut += 1;
      keptCombos.push(letters);
      out.write(`${JSON.stringify({ letters, words: filtered })}\n`);
    } else {
      combosDropped += 1;
    }
  }

  await new Promise((resolve, reject) => {
    out.on("error", reject);
    out.end(resolve);
  });

  await writeFile(OUTPUT_COMBOS, `${keptCombos.join("\n")}\n`, "utf8");

  const summary = {
    generatedAt: new Date().toISOString(),
    source: INPUT_JSONL,
    commonWordsSource: {
      url: WORDFREQ_URL,
      cachePath: WORDFREQ_CACHE,
      downloadedThisRun: source.downloaded,
      commonWordCount: commonSet.size
    },
    totals: {
      combosIn,
      combosOut,
      combosDropped,
      wordsIn,
      wordsOut,
      wordsRemoved
    },
    outputs: {
      jsonl: OUTPUT_JSONL,
      combos: OUTPUT_COMBOS
    }
  };

  await writeFile(OUTPUT_SUMMARY, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
