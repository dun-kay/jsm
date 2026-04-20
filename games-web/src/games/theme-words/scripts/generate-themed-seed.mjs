import fs from "node:fs";
import path from "node:path";

const inputPath = path.resolve("src/games/theme-words/letterSeed.reversed.json");
const secretSeedPath = path.resolve("src/games/secret-words/dailySeed.json");
const comboIndexPath = path.resolve("src/games/secret-words/seed-build/six_letter_combo_word_index.min20.jsonl");
const wordFreqPath = path.resolve("src/games/secret-words/seed-build/wordfreq-en-25000-log.json");
const wordsAlphaPath = path.resolve("src/games/secret-words/seed-build/words_alpha.txt");
const maleNamesPath = path.resolve("src/games/secret-words/seed-build/male-first-names.txt");
const femaleNamesPath = path.resolve("src/games/secret-words/seed-build/female-first-names.txt");
const outputPath = path.resolve("src/games/theme-words/themeSeed.generated.json");

function parseArgs(argv) {
  const args = { write: false, limit: null };
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--write") {
      args.write = true;
      continue;
    }
    if (token === "--limit") {
      const parsed = Number(argv[i + 1]);
      if (Number.isFinite(parsed) && parsed > 0) {
        args.limit = Math.floor(parsed);
      }
      i += 1;
    }
  }
  return args;
}

function normalizeWord(word) {
  return String(word || "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

function hashText(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function readNameSet() {
  const set = new Set();
  for (const sourcePath of [maleNamesPath, femaleNamesPath]) {
    const raw = fs.readFileSync(sourcePath, "utf8").replace(/^\uFEFF/, "");
    for (const line of raw.split(/\r?\n/)) {
      const name = normalizeWord(line);
      if (name.length >= 3) {
        set.add(name);
      }
    }
  }
  return set;
}

function readWordFrequencyMap() {
  const raw = fs.readFileSync(wordFreqPath, "utf8").replace(/^\uFEFF/, "");
  const rows = JSON.parse(raw);
  const map = new Map();
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 2) continue;
    const word = normalizeWord(row[0]);
    const score = Number(row[1]);
    if (!word || !Number.isFinite(score)) continue;
    map.set(word, score);
  }
  return map;
}

function readComboWordsByLetters(lettersNeeded) {
  const raw = fs.readFileSync(comboIndexPath, "utf8").replace(/^\uFEFF/, "");
  const map = new Map();
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parsed = JSON.parse(line);
    const letters = String(parsed.letters || "").toUpperCase();
    if (!lettersNeeded.has(letters)) continue;
    map.set(
      letters,
      Array.isArray(parsed.words) ? parsed.words.map((word) => String(word)) : []
    );
  }
  return map;
}

function sortedChars(value) {
  return value.split("").sort().join("");
}

function hasRepeatedLetters(word) {
  const seen = new Set();
  for (const char of word) {
    if (seen.has(char)) return true;
    seen.add(char);
  }
  return false;
}

function buildDictionarySignatureMap() {
  const raw = fs.readFileSync(wordsAlphaPath, "utf8").replace(/^\uFEFF/, "");
  const map = new Map();
  for (const line of raw.split(/\r?\n/)) {
    const word = normalizeWord(line);
    if (word.length < 4 || word.length > 6) continue;
    if (hasRepeatedLetters(word)) continue;
    const signature = sortedChars(word);
    if (!map.has(signature)) {
      map.set(signature, []);
    }
    map.get(signature).push(word);
  }
  return map;
}

function subsetSignatures(letters) {
  const chars = letters.split("");
  const signatures = [];
  const total = 1 << chars.length;
  for (let mask = 0; mask < total; mask += 1) {
    const bits = mask.toString(2).replace(/0/g, "").length;
    if (bits < 4 || bits > 6) continue;
    let subset = "";
    for (let i = 0; i < chars.length; i += 1) {
      if ((mask & (1 << i)) !== 0) {
        subset += chars[i];
      }
    }
    signatures.push(sortedChars(subset));
  }
  return [...new Set(signatures)];
}

function dictionaryWordsForLetters(letters, signatureMap) {
  const signatures = subsetSignatures(letters.toLowerCase());
  const out = [];
  for (const signature of signatures) {
    const words = signatureMap.get(signature);
    if (!words) continue;
    out.push(...words);
  }
  return out;
}

function rankWord(word, index, freqScore) {
  const rareBonus = (word.match(/[jqxzvkw]/g) || []).length * 0.8;
  const lengthScore = Math.min(word.length, 8);
  const indexScore = Math.max(0, 3 - index * 0.12);
  const frequencyBonus = Number.isFinite(freqScore) ? Math.max(0, 8 + freqScore) : 0;
  return lengthScore + rareBonus + indexScore + frequencyBonus;
}

function themeKeywordScore(word, keywords) {
  let score = 0;
  for (const keyword of keywords) {
    if (word === keyword) {
      score += 3;
    } else if (word.includes(keyword) || keyword.includes(word)) {
      score += 1;
    }
  }
  return score;
}

const THEME_PACKS = [
  {
    id: "war_homefront",
    keywords: ["army", "troop", "drill", "grunt", "rifle", "march", "medic", "war", "rank", "barrack", "guard", "radio", "rally", "rivet"],
    titles: [
      "It's 1965. Your husband got drafted and everyone acts like it's normal.",
      "You wait by the radio while the neighborhood argues about the war.",
      "Your draft board letter arrived during Sunday dinner."
    ]
  },
  {
    id: "office_meltdown",
    keywords: ["email", "memo", "paper", "audit", "quota", "boss", "merge", "reply", "legal", "brief", "excel", "asset", "tax", "agent"],
    titles: [
      "Your office team-building exercise has become an HR case file.",
      "The quarterly review became a public trial in the break room.",
      "Your manager says this is normal. Nobody else agrees."
    ]
  },
  {
    id: "small_town_scandal",
    keywords: ["mayor", "parish", "bingo", "choir", "aunt", "uncle", "gossip", "salon", "garden", "bakery", "church", "civic", "fair", "lawn"],
    titles: [
      "Your small-town rumor now has its own committee meeting.",
      "The parish raffle ended in a family feud and a council vote.",
      "Everyone at bingo knows your business before you do."
    ]
  },
  {
    id: "travel_crossing",
    keywords: ["ship", "sail", "port", "coast", "ocean", "spain", "storm", "route", "harbor", "journey", "cross"],
    titles: [
      "You are making the painful ocean crossing to Spain.",
      "Weeks at sea and still no sign of the right coastline.",
      "The crossing took longer than promised and morale collapsed."
    ]
  },
  {
    id: "romance_disaster",
    keywords: ["lover", "ex", "fling", "marry", "heart", "kiss", "date", "bride", "groom", "affair", "rival", "secret", "jealous", "petal"],
    titles: [
      "Your ex reappeared at brunch with terrible timing and great gossip.",
      "Your wedding invite situation just got legally complicated.",
      "A secret relationship became group chat evidence."
    ]
  },
  {
    id: "domestic_absurd",
    keywords: ["couch", "dryer", "pantry", "fridge", "spice", "mop", "vacuum", "laundry", "kettle", "towel", "supper", "recipe", "plate", "fork"],
    titles: [
      "Your apartment maintenance issue now involves three neighbors.",
      "Game night ended with a landlord phone call.",
      "Domestic peace lasted seven minutes."
    ]
  },
  {
    id: "startup_chaos",
    keywords: ["app", "pitch", "angel", "founder", "token", "stack", "cloud", "brand", "viral", "scale", "launch", "beta", "code", "cache"],
    titles: [
      "Your startup pivot sounded brilliant until investors asked questions.",
      "The product launch became a cautionary tale by lunch.",
      "Your cofounder says this is still on-brand."
    ]
  }
];

const FALLBACK_TITLES = [
  "Your neighborhood group chat now qualifies as public record.",
  "Your family scandal is now the main topic at brunch.",
  "Your side hustle has become a local cautionary tale.",
  "Your small-town drama now has a waiting list.",
  "Your life decisions are now a committee agenda item.",
  "This week you became a very specific cautionary tale.",
  "The story got retold so many times it became local history."
];

const FALLBACK_ANCHOR_TEMPLATES = [
  "The {w1} incident became the only topic at town hall.",
  "Your {w1} decision somehow became a neighborhood referendum.",
  "At Sunday lunch, everyone asked about the {w1} problem.",
  "Nobody expected the {w1} situation to reach city council.",
  "The {w1} rumor spread faster than the official update.",
  "Your {w1} saga is now local folklore.",
  "The committee called an emergency meeting about the {w1} mess.",
  "Your family says the {w1} episode should never be mentioned again.",
  "The {w1} story got stranger every time it was retold.",
  "Your {w1} plan sounded smart right up until witnesses got involved."
];

const TITLE_OVERRIDES_BY_LETTERS = {
  AHINPS: "You are making the painful ocean crossing to Spain."
};

const BLOCKED_WORDS = new Set([
  "cunt",
  "cunts",
  "slut",
  "sluts",
  "nazi",
  "nazis",
  "whore",
  "whores",
  "faggot",
  "faggots",
  "nigger",
  "niggers"
]);

function pickTheme(words) {
  const unique = new Set(words);
  let best = null;

  for (const pack of THEME_PACKS) {
    let score = 0;
    for (const keyword of pack.keywords) {
      if (unique.has(keyword)) {
        score += 2;
      }
      for (const word of words) {
        if (word.includes(keyword) || keyword.includes(word)) {
          score += 0.35;
        }
      }
    }

    if (!best || score > best.score) {
      best = { pack, score };
    }
  }

  return best && best.score >= 1.5 ? best.pack : null;
}

function sanitizeTitle(raw) {
  const noEmDash = raw.replace(/[—–]/g, " ");
  const compact = noEmDash.replace(/\s+/g, " ").trim();
  if (compact.length <= 75) {
    return compact;
  }

  const truncated = compact.slice(0, 75).replace(/\s+\S*$/, "").trim();
  if (truncated.length > 0) {
    return truncated;
  }
  return compact.slice(0, 75);
}

function chooseTargetWords(sourceWords, blockedNames, freqMap) {
  const normalized = sourceWords
    .map(normalizeWord)
    .filter((word) => word.length > 3 && !BLOCKED_WORDS.has(word));

  const unique = [];
  const seen = new Set();
  for (let i = 0; i < normalized.length; i += 1) {
    const word = normalized[i];
    if (seen.has(word)) continue;
    seen.add(word);
    unique.push({ word, index: i, score: rankWord(word, i, freqMap.get(word)) });
  }

  const nonNames = unique.filter((entry) => !blockedNames.has(entry.word));
  const pool = nonNames.length >= 10 ? nonNames : unique;
  const overThree = pool.filter((entry) => entry.word.length > 3);
  const theme = pickTheme(unique.map((entry) => entry.word));

  const ranked = [...overThree].sort((a, b) => {
    const themeA = theme ? themeKeywordScore(a.word, theme.keywords) : 0;
    const themeB = theme ? themeKeywordScore(b.word, theme.keywords) : 0;
    if (themeA !== themeB) return themeB - themeA;
    if (a.score !== b.score) return b.score - a.score;
    return a.index - b.index;
  });

  const selected = ranked.slice(0, 10).map((entry) => entry.word);
  if (selected.length < 10) {
    const fill = overThree
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .map((entry) => entry.word)
      .filter((word) => !selected.includes(word));
    selected.push(...fill.slice(0, 10 - selected.length));
  }

  return selected.slice(0, 10);
}

function buildThemeTitle(letters, targetWords, freqMap) {
  const override = TITLE_OVERRIDES_BY_LETTERS[String(letters).toUpperCase()];
  if (override) {
    return sanitizeTitle(override);
  }

  const theme = pickTheme(targetWords);
  const hash = hashText(`${letters}|${targetWords.join("|")}`);
  const options = theme ? theme.titles : FALLBACK_TITLES;
  const selected = options[hash % options.length];

  if (!theme) {
    const anchors = targetWords.filter(
      (word) => /^[a-z]+$/.test(word)
        && Number.isFinite(freqMap.get(word))
        && freqMap.get(word) >= -12
        && word.length >= 4
    );
    if (anchors.length > 0) {
      const anchor = anchors[hash % anchors.length];
      const template = FALLBACK_ANCHOR_TEMPLATES[hash % FALLBACK_ANCHOR_TEMPLATES.length];
      const anchored = sanitizeTitle(template.replace("{w1}", anchor));
      if (anchored.length > 0 && anchored.length <= 75) {
        return anchored;
      }
    }
  }

  return sanitizeTitle(selected);
}

function main() {
  const args = parseArgs(process.argv);
  const raw = fs.readFileSync(inputPath, "utf8").replace(/^\uFEFF/, "");
  const secretRaw = fs.readFileSync(secretSeedPath, "utf8").replace(/^\uFEFF/, "");
  const source = JSON.parse(raw);
  const secret = JSON.parse(secretRaw);
  const blockedNames = readNameSet();
  const freqMap = readWordFrequencyMap();
  const lettersNeeded = new Set(source.map((entry) => String(entry.letters || "").toUpperCase()));
  const comboWordsByLetters = readComboWordsByLetters(lettersNeeded);
  const dictionarySignatureMap = buildDictionarySignatureMap();

  const wordsByLetters = new Map();
  for (const entry of secret) {
    const letters = String(entry.letters || "").toUpperCase();
    if (!wordsByLetters.has(letters)) {
      wordsByLetters.set(letters, []);
    }
    const bucket = wordsByLetters.get(letters);
    for (const word of entry.words || []) {
      bucket.push(String(word));
    }
  }

  const rows = (args.limit ? source.slice(0, args.limit) : source).map((entry) => {
    const letters = String(entry.letters).toUpperCase();
    const comboPool = comboWordsByLetters.get(letters) || [];
    const seedPool = wordsByLetters.get(letters) || [];
    const ownPool = Array.isArray(entry.words) ? entry.words : [];
    const dictionaryPool = dictionaryWordsForLetters(letters, dictionarySignatureMap);
    const pool = [...seedPool, ...ownPool, ...comboPool, ...dictionaryPool];
    const targetWords = chooseTargetWords(pool, blockedNames, freqMap);

    if (targetWords.length < 10) {
      throw new Error(`Date ${entry.date} has fewer than 10 eligible words (>3 chars).`);
    }

    const themeTitle = buildThemeTitle(letters, targetWords, freqMap);

    return {
      date: String(entry.date),
      letters: String(entry.letters).toUpperCase(),
      themeTitle,
      targetWords
    };
  });

  if (args.write) {
    fs.writeFileSync(outputPath, `${JSON.stringify(rows, null, 2)}\n`, "utf8");
  }

  console.log(`Input rows: ${source.length}`);
  console.log(`Output rows: ${rows.length}`);
  console.log(`Output file: ${outputPath}`);
  console.log(`Sample:`);
  console.log(JSON.stringify(rows[Math.floor(rows.length / 2)], null, 2));
}

main();
