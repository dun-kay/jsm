import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BUILD_DIR = path.resolve(__dirname, "../seed-build");
const INPUT_JSONL = path.join(BUILD_DIR, "six_letter_combo_word_index.jsonl");
const OUTPUT_JSONL = path.join(BUILD_DIR, "six_letter_combo_word_index.min20.jsonl");
const OUTPUT_COMBOS = path.join(BUILD_DIR, "six_letter_combos_randomized.min20.txt");
const OUTPUT_SUMMARY = path.join(BUILD_DIR, "six_letter_combo_word_index.min20.summary.json");
const MIN_WORDS = 20;

async function main() {
  await mkdir(BUILD_DIR, { recursive: true });

  const input = createReadStream(INPUT_JSONL, { encoding: "utf8" });
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  const out = createWriteStream(OUTPUT_JSONL, { encoding: "utf8" });

  const keptCombos = [];
  let total = 0;
  let kept = 0;
  let removed = 0;
  let keptAssignments = 0;

  for await (const line of rl) {
    if (!line.trim()) continue;
    total += 1;
    const row = JSON.parse(line);
    const words = Array.isArray(row.words) ? row.words : [];

    if (words.length >= MIN_WORDS) {
      kept += 1;
      keptAssignments += words.length;
      keptCombos.push(String(row.letters).toUpperCase());
      out.write(`${JSON.stringify({ letters: String(row.letters).toUpperCase(), words })}\n`);
    } else {
      removed += 1;
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
    minWordsThreshold: MIN_WORDS,
    totals: {
      inputCombos: total,
      keptCombos: kept,
      removedCombos: removed,
      keptWordAssignments: keptAssignments
    },
    outputs: {
      jsonl: OUTPUT_JSONL,
      combos: OUTPUT_COMBOS
    }
  };

  await writeFile(OUTPUT_SUMMARY, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  console.log(`Kept combos: ${kept}`);
  console.log(`Removed combos: ${removed}`);
  console.log(`Filtered jsonl: ${OUTPUT_JSONL}`);
  console.log(`Filtered combos: ${OUTPUT_COMBOS}`);
  console.log(`Summary: ${OUTPUT_SUMMARY}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
