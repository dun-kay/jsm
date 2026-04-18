import { createReadStream, createWriteStream } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BUILD_DIR = path.resolve(__dirname, "../seed-build");
const INPUT_JSONL = path.join(BUILD_DIR, "six_letter_combo_word_index.min75.common.jsonl");
const MIN_WORDS = 50;
const OUTPUT_JSONL = path.join(BUILD_DIR, `six_letter_combo_word_index.common.min${MIN_WORDS}.jsonl`);
const OUTPUT_COMBOS = path.join(BUILD_DIR, `six_letter_combos_randomized.common.min${MIN_WORDS}.txt`);
const OUTPUT_SUMMARY = path.join(BUILD_DIR, `six_letter_combo_word_index.common.min${MIN_WORDS}.summary.json`);

async function main() {
  const rl = readline.createInterface({
    input: createReadStream(INPUT_JSONL, { encoding: "utf8" }),
    crlfDelay: Infinity
  });

  const out = createWriteStream(OUTPUT_JSONL, { encoding: "utf8" });

  let inputCombos = 0;
  let keptCombos = 0;
  let keptWordAssignments = 0;
  const keptLetters = [];

  for await (const line of rl) {
    if (!line.trim()) continue;
    inputCombos += 1;
    const row = JSON.parse(line);
    const words = Array.isArray(row.words) ? row.words : [];
    if (words.length >= MIN_WORDS) {
      keptCombos += 1;
      keptWordAssignments += words.length;
      const letters = String(row.letters).toUpperCase();
      keptLetters.push(letters);
      out.write(`${JSON.stringify({ letters, words })}\n`);
    }
  }

  await new Promise((resolve, reject) => {
    out.on("error", reject);
    out.end(resolve);
  });

  await writeFile(OUTPUT_COMBOS, `${keptLetters.join("\n")}\n`, "utf8");

  const summary = {
    generatedAt: new Date().toISOString(),
    source: INPUT_JSONL,
    minWordsThreshold: MIN_WORDS,
    totals: {
      inputCombos,
      keptCombos,
      removedCombos: inputCombos - keptCombos,
      keptWordAssignments
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
