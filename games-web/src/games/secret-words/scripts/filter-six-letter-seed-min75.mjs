import { createReadStream, createWriteStream } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const buildDir = path.resolve(__dirname, "../seed-build");
const inputPath = path.join(buildDir, "six_letter_combo_word_index.jsonl");
const minWords = 75;
const outJsonl = path.join(buildDir, `six_letter_combo_word_index.min${minWords}.jsonl`);
const outCombos = path.join(buildDir, `six_letter_combos_randomized.min${minWords}.txt`);
const outSummary = path.join(buildDir, `six_letter_combo_word_index.min${minWords}.summary.json`);

async function main() {
  const rl = readline.createInterface({
    input: createReadStream(inputPath, { encoding: "utf8" }),
    crlfDelay: Infinity
  });

  const out = createWriteStream(outJsonl, { encoding: "utf8" });

  let inputCombos = 0;
  let keptCombos = 0;
  let keptWordAssignments = 0;
  const keptComboLetters = [];

  for await (const line of rl) {
    if (!line.trim()) continue;
    inputCombos += 1;
    const row = JSON.parse(line);
    const words = Array.isArray(row.words) ? row.words : [];
    if (words.length >= minWords) {
      keptCombos += 1;
      keptWordAssignments += words.length;
      keptComboLetters.push(String(row.letters).toUpperCase());
      out.write(`${JSON.stringify({ letters: String(row.letters).toUpperCase(), words })}\n`);
    }
  }

  await new Promise((resolve, reject) => {
    out.on("error", reject);
    out.end(resolve);
  });

  await writeFile(outCombos, keptComboLetters.join("\n") + "\n", "utf8");

  const summary = {
    generatedAt: new Date().toISOString(),
    source: inputPath,
    minWordsThreshold: minWords,
    totals: {
      inputCombos,
      keptCombos,
      removedCombos: inputCombos - keptCombos,
      keptWordAssignments
    },
    outputs: {
      jsonl: outJsonl,
      combos: outCombos
    }
  };

  await writeFile(outSummary, JSON.stringify(summary, null, 2) + "\n", "utf8");

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
