import fs from "node:fs";
import path from "node:path";

const secretSeedPath = path.resolve("src/games/secret-words/dailySeed.json");
const comboIndexPath = path.resolve("src/games/secret-words/seed-build/six_letter_combo_word_index.min20.jsonl");
const outPath = path.resolve("src/games/theme-words/letterSeed.reversed.json");

function parseArgs(argv) {
  const args = {
    write: false,
    from: "2021-04-20",
    to: "2046-04-20"
  };

  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--write") {
      args.write = true;
      continue;
    }
    if (token === "--from") {
      args.from = argv[i + 1] || args.from;
      i += 1;
      continue;
    }
    if (token === "--to") {
      args.to = argv[i + 1] || args.to;
      i += 1;
      continue;
    }
  }
  return args;
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function normalizeWord(word) {
  return String(word || "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

function derangeEntries(originalLetters, candidateEntries) {
  const arranged = [...candidateEntries];

  for (let i = 0; i < arranged.length; i += 1) {
    if (arranged[i].letters !== originalLetters[i]) {
      continue;
    }

    let swapIndex = -1;
    for (let j = i + 1; j < arranged.length; j += 1) {
      if (
        arranged[j].letters !== originalLetters[i]
        && arranged[i].letters !== originalLetters[j]
      ) {
        swapIndex = j;
        break;
      }
    }

    if (swapIndex === -1) {
      for (let j = 0; j < i; j += 1) {
        if (
          arranged[j].letters !== originalLetters[i]
          && arranged[i].letters !== originalLetters[j]
        ) {
          swapIndex = j;
          break;
        }
      }
    }

    if (swapIndex !== -1) {
      [arranged[i], arranged[swapIndex]] = [arranged[swapIndex], arranged[i]];
    }
  }

  const unresolved = arranged.findIndex((entry, index) => entry.letters === originalLetters[index]);
  if (unresolved !== -1) {
    throw new Error(`Could not fully derange letters at index ${unresolved}.`);
  }

  return arranged;
}

function readComboWordsByLetters() {
  const raw = fs.readFileSync(comboIndexPath, "utf8").replace(/^\uFEFF/, "");
  const map = new Map();
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parsed = JSON.parse(line);
    const letters = String(parsed.letters || "").toUpperCase();
    map.set(letters, Array.isArray(parsed.words) ? parsed.words.map((word) => String(word)) : []);
  }
  return map;
}

function hasTenLongWords(letters, ownWords, wordsByLetters, comboWordsByLetters) {
  const comboWords = comboWordsByLetters.get(letters) || [];
  const seedWords = wordsByLetters.get(letters) || [];
  const merged = [...comboWords, ...seedWords, ...ownWords]
    .map(normalizeWord)
    .filter((word) => word.length > 3);
  return new Set(merged).size >= 10;
}

function main() {
  const args = parseArgs(process.argv);

  if (!isIsoDate(args.from) || !isIsoDate(args.to)) {
    throw new Error("--from and --to must be ISO dates YYYY-MM-DD");
  }

  const raw = fs.readFileSync(secretSeedPath, "utf8").replace(/^\uFEFF/, "");
  const secretSeed = JSON.parse(raw);
  const comboWordsByLetters = readComboWordsByLetters();

  const windowed = secretSeed
    .map((entry) => ({
      date: String(entry.date),
      letters: String(entry.letters).toUpperCase(),
      words: Array.isArray(entry.words) ? entry.words.map((word) => String(word).toLowerCase()) : []
    }))
    .filter((entry) => entry.date >= args.from && entry.date <= args.to)
    .sort((a, b) => a.date.localeCompare(b.date));

  const wordsByLetters = new Map();
  for (const entry of secretSeed) {
    const letters = String(entry.letters || "").toUpperCase();
    if (!wordsByLetters.has(letters)) {
      wordsByLetters.set(letters, []);
    }
    wordsByLetters.get(letters).push(
      ...(Array.isArray(entry.words) ? entry.words.map((word) => String(word)) : [])
    );
  }

  if (windowed.length === 0) {
    throw new Error(`No Secret Words dates found between ${args.from} and ${args.to}.`);
  }

  const originalLetters = windowed.map((entry) => entry.letters);
  const reversedEntries = [...windowed]
    .reverse()
    .map((entry) => ({ letters: entry.letters, words: entry.words }));
  const safeEntries = derangeEntries(originalLetters, reversedEntries);
  const validEntries = safeEntries.filter((entry) => hasTenLongWords(
    entry.letters,
    entry.words,
    wordsByLetters,
    comboWordsByLetters
  ));

  const dateSlice = windowed.slice(0, validEntries.length);
  const shiftedEntries = derangeEntries(
    dateSlice.map((entry) => entry.letters),
    validEntries
  );

  const output = dateSlice.map((entry, index) => ({
    date: entry.date,
    letters: shiftedEntries[index].letters,
    words: shiftedEntries[index].words
  }));

  if (args.write) {
    fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  }

  console.log(`Secret words source range: ${windowed[0].date} -> ${windowed[windowed.length - 1].date}`);
  console.log(`Total days: ${windowed.length}`);
  console.log(`Eligible days after 10x >3-char filter: ${validEntries.length}`);
  console.log(`Dropped days: ${windowed.length - validEntries.length}`);
  console.log(`Output file: ${outPath}`);
  const sample = output.find((entry) => entry.date === "2026-04-20") || output[Math.floor(output.length / 2)];
  console.log(`Sample mapping: ${sample.date} -> ${sample.letters}`);
}

main();
