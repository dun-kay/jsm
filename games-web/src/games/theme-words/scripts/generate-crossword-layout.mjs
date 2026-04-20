import fs from "node:fs";
import path from "node:path";

const defaultSeedPath = path.resolve("src/games/theme-words/dailySeed.json");

function parseArgs(argv) {
  const args = {
    write: false,
    date: null,
    restarts: 80,
    beam: 20,
    budgetMs: 15000,
    checkThresholds: false,
    maxWidth: 12,
    maxHeight: 15,
    thresholdMode: "and",
    seedFile: null
  };

  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--write") {
      args.write = true;
      continue;
    }
    if (token === "--date") {
      args.date = argv[i + 1] || null;
      i += 1;
      continue;
    }
    if (token === "--restarts") {
      args.restarts = Math.max(1, Number(argv[i + 1]) || args.restarts);
      i += 1;
      continue;
    }
    if (token === "--beam") {
      args.beam = Math.max(1, Number(argv[i + 1]) || args.beam);
      i += 1;
      continue;
    }
    if (token === "--budget-ms") {
      args.budgetMs = Math.max(1000, Number(argv[i + 1]) || args.budgetMs);
      i += 1;
      continue;
    }
    if (token === "--check-thresholds") {
      args.checkThresholds = true;
      continue;
    }
    if (token === "--max-width") {
      args.maxWidth = Math.max(1, Number(argv[i + 1]) || args.maxWidth);
      i += 1;
      continue;
    }
    if (token === "--max-height") {
      args.maxHeight = Math.max(1, Number(argv[i + 1]) || args.maxHeight);
      i += 1;
      continue;
    }
    if (token === "--threshold-mode") {
      const next = String(argv[i + 1] || "").toLowerCase();
      if (next === "and" || next === "or") {
        args.thresholdMode = next;
      }
      i += 1;
      continue;
    }
    if (token === "--seed-file") {
      args.seedFile = argv[i + 1] || null;
      i += 1;
      continue;
    }
  }

  return args;
}

function stableHash(input) {
  let h = 5381;
  for (let i = 0; i < input.length; i += 1) {
    h = ((h << 5) + h + input.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

function makeRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function cellKey(row, col) {
  return `${row}:${col}`;
}

function decodeCellKey(key) {
  const [rowText, colText] = key.split(":");
  return { row: Number(rowText), col: Number(colText) };
}

function buildBoard(placements) {
  const board = new Map();
  for (const placement of placements) {
    const chars = placement.word.split("");
    for (let i = 0; i < chars.length; i += 1) {
      const row = placement.row + (placement.direction === "down" ? i : 0);
      const col = placement.col + (placement.direction === "across" ? i : 0);
      const key = cellKey(row, col);
      const hit = board.get(key);
      if (!hit) {
        board.set(key, {
          ch: chars[i],
          directions: new Set([placement.direction]),
          words: new Set([placement.word])
        });
        continue;
      }
      if (hit.ch !== chars[i]) {
        return null;
      }
      hit.directions.add(placement.direction);
      hit.words.add(placement.word);
    }
  }
  return board;
}

function getBounds(board) {
  if (!board || board.size === 0) {
    return { minRow: 0, maxRow: 0, minCol: 0, maxCol: 0, width: 1, height: 1, area: 1 };
  }
  let minRow = Number.POSITIVE_INFINITY;
  let maxRow = Number.NEGATIVE_INFINITY;
  let minCol = Number.POSITIVE_INFINITY;
  let maxCol = Number.NEGATIVE_INFINITY;

  for (const key of board.keys()) {
    const { row, col } = decodeCellKey(key);
    minRow = Math.min(minRow, row);
    maxRow = Math.max(maxRow, row);
    minCol = Math.min(minCol, col);
    maxCol = Math.max(maxCol, col);
  }

  const width = maxCol - minCol + 1;
  const height = maxRow - minRow + 1;
  return { minRow, maxRow, minCol, maxCol, width, height, area: width * height };
}

function checkFit(word, row, col, direction, board) {
  const letters = word.split("");
  const beforeRow = direction === "down" ? row - 1 : row;
  const beforeCol = direction === "across" ? col - 1 : col;
  const afterRow = direction === "down" ? row + letters.length : row;
  const afterCol = direction === "across" ? col + letters.length : col;

  if (board.has(cellKey(beforeRow, beforeCol)) || board.has(cellKey(afterRow, afterCol))) {
    return null;
  }

  let overlapCount = 0;
  for (let i = 0; i < letters.length; i += 1) {
    const r = row + (direction === "down" ? i : 0);
    const c = col + (direction === "across" ? i : 0);
    const key = cellKey(r, c);
    const existing = board.get(key);

    if (existing) {
      if (existing.ch !== letters[i]) {
        return null;
      }
      if (existing.directions.has(direction)) {
        return null;
      }
      overlapCount += 1;
      continue;
    }

    if (direction === "across") {
      if (board.has(cellKey(r - 1, c)) || board.has(cellKey(r + 1, c))) {
        return null;
      }
    } else if (board.has(cellKey(r, c - 1)) || board.has(cellKey(r, c + 1))) {
      return null;
    }
  }

  if (board.size > 0 && overlapCount === 0) {
    return null;
  }

  return { row, col, direction, overlapCount };
}

function listCandidates(word, placements, rng) {
  const board = buildBoard(placements);
  if (!board) return [];

  if (placements.length === 0) {
    return [
      { word, row: 0, col: 0, direction: "across", overlapCount: 0 },
      { word, row: 0, col: 0, direction: "down", overlapCount: 0 }
    ];
  }

  const dedupe = new Set();
  const out = [];
  for (const [key, hit] of board.entries()) {
    const anchor = decodeCellKey(key);
    for (let i = 0; i < word.length; i += 1) {
      if (word[i] !== hit.ch) continue;

      const across = checkFit(word, anchor.row, anchor.col - i, "across", board);
      if (across) {
        const uniqueKey = `${across.row}:${across.col}:A`;
        if (!dedupe.has(uniqueKey)) {
          dedupe.add(uniqueKey);
          out.push({ word, ...across });
        }
      }

      const down = checkFit(word, anchor.row - i, anchor.col, "down", board);
      if (down) {
        const uniqueKey = `${down.row}:${down.col}:D`;
        if (!dedupe.has(uniqueKey)) {
          dedupe.add(uniqueKey);
          out.push({ word, ...down });
        }
      }
    }
  }

  return out
    .map((candidate) => ({ candidate, jitter: rng() }))
    .sort((a, b) => a.jitter - b.jitter)
    .map((entry) => entry.candidate);
}

function scorePlacements(placements) {
  const board = buildBoard(placements);
  if (!board) return null;
  const bounds = getBounds(board);
  const lettersPlaced = placements.reduce((sum, item) => sum + item.word.length, 0);
  const intersections = lettersPlaced - board.size;
  const shapePenalty = Math.abs(bounds.width - bounds.height);

  let sideContacts = 0;
  for (const [key, hit] of board.entries()) {
    const { row, col } = decodeCellKey(key);
    const right = board.get(cellKey(row, col + 1));
    const down = board.get(cellKey(row + 1, col));

    if (right) {
      const shared = [...hit.words].some((word) => right.words.has(word));
      if (!shared) sideContacts += 1;
    }
    if (down) {
      const shared = [...hit.words].some((word) => down.words.has(word));
      if (!shared) sideContacts += 1;
    }
  }

  return {
    intersections,
    sideContacts,
    area: bounds.area,
    width: bounds.width,
    height: bounds.height,
    shapePenalty,
    maxSpan: Math.max(bounds.width, bounds.height),
    placedWords: placements.length
  };
}

function compareScores(a, b) {
  if (a.placedWords !== b.placedWords) return b.placedWords - a.placedWords;
  if (a.sideContacts !== b.sideContacts) return a.sideContacts - b.sideContacts;
  if (a.intersections !== b.intersections) return b.intersections - a.intersections;
  if (a.area !== b.area) return a.area - b.area;
  if (a.shapePenalty !== b.shapePenalty) return a.shapePenalty - b.shapePenalty;
  if (a.maxSpan !== b.maxSpan) return a.maxSpan - b.maxSpan;
  return 0;
}

function normalizeToTopLeft(placements) {
  const board = buildBoard(placements);
  if (!board || board.size === 0) return placements;
  const bounds = getBounds(board);
  return placements.map((p) => ({
    ...p,
    row: p.row - bounds.minRow,
    col: p.col - bounds.minCol
  }));
}

function countWordIntersections(target, placements) {
  const board = buildBoard(placements);
  if (!board) return 0;
  let count = 0;
  for (let i = 0; i < target.word.length; i += 1) {
    const row = target.row + (target.direction === "down" ? i : 0);
    const col = target.col + (target.direction === "across" ? i : 0);
    const hit = board.get(cellKey(row, col));
    if (hit && hit.words.size > 1) count += 1;
  }
  return count;
}

function pruneSingleBridge(placements, blockedWords) {
  if (placements.length <= 1) return -1;
  const choices = placements
    .map((p, idx) => ({ p, idx }))
    .filter(({ p }) => !blockedWords.has(p.word))
    .map(({ p, idx }) => ({ idx, p, intersections: countWordIntersections(p, placements) }))
    .filter((item) => item.intersections === 1);

  if (choices.length === 0) return -1;
  choices.sort((a, b) => a.p.word.length - b.p.word.length || a.idx - b.idx);
  return choices[0].idx;
}

function choosePlacementForWord(word, placements, preferAcross, rng) {
  const candidates = listCandidates(word, placements, rng);
  if (candidates.length === 0) return null;

  const desired = preferAcross ? "across" : "down";
  const ordered = [
    ...candidates.filter((c) => c.direction === desired),
    ...candidates.filter((c) => c.direction !== desired)
  ];

  let best = null;
  for (const candidate of ordered.slice(0, 16)) {
    const trial = [...placements, {
      word,
      row: candidate.row,
      col: candidate.col,
      direction: candidate.direction
    }];
    const score = scorePlacements(trial);
    if (!score) continue;
    if (!best || compareScores(score, best.score) < 0) {
      best = {
        placement: {
          word,
          row: candidate.row,
          col: candidate.col,
          direction: candidate.direction
        },
        score
      };
    }
  }

  return best ? best.placement : {
    word,
    row: ordered[0].row,
    col: ordered[0].col,
    direction: ordered[0].direction
  };
}

function solveOneRun(words, seed) {
  const rng = makeRng(seed);
  const remaining = [...words]
    .map((w) => ({ w, salt: rng() }))
    .sort((a, b) => b.w.length - a.w.length || a.salt - b.salt)
    .map((x) => x.w);

  const placements = [];
  const blocked = new Set();
  let preferAcross = true;
  let progressSincePrune = 0;

  const first = remaining.shift();
  if (first) {
    placements.push({ word: first, row: 0, col: 0, direction: "across" });
    preferAcross = false;
    progressSincePrune = 1;
  }

  while (remaining.length > 0) {
    let placedSomething = false;

    for (let i = 0; i < remaining.length; i += 1) {
      const word = remaining[i];
      const picked = choosePlacementForWord(word, placements, preferAcross, rng);
      if (!picked) continue;
      placements.push(picked);
      remaining.splice(i, 1);
      preferAcross = !preferAcross;
      progressSincePrune += 1;
      if (progressSincePrune >= 2) blocked.clear();
      placedSomething = true;
      break;
    }

    if (placedSomething) continue;

    const dropIdx = pruneSingleBridge(placements, blocked);
    if (dropIdx < 0) break;
    const [removed] = placements.splice(dropIdx, 1);
    blocked.add(removed.word);
    remaining.push(removed.word);
    remaining.sort((a, b) => b.length - a.length || a.localeCompare(b));
    progressSincePrune = 0;
  }

  return {
    placements: normalizeToTopLeft(placements),
    unplacedCount: remaining.length
  };
}

function solveLayout(words, options) {
  const startedAt = Date.now();
  const baseSeed = stableHash(words.join("|"));
  let best = null;
  let budgetExceeded = false;

  for (let i = 0; i < options.restarts; i += 1) {
    if (Date.now() - startedAt > options.budgetMs) {
      budgetExceeded = true;
      break;
    }
    const run = solveOneRun(words, baseSeed + i * 104729);
    const score = scorePlacements(run.placements);
    if (!score) continue;
    if (!best || compareScores(score, best.score) < 0) {
      best = {
        score,
        placements: run.placements,
        unplacedCount: run.unplacedCount
      };
    }
    if (best && best.unplacedCount === 0 && Date.now() - startedAt > options.budgetMs * 0.25) {
      break;
    }
  }

  return {
    best,
    budgetExceeded,
    elapsedMs: Date.now() - startedAt
  };
}

function solveEntry(entry, options) {
  const words = [...new Set((entry.targetWords || []).map((w) => String(w).toUpperCase()))];
  if (words.length === 0) return null;
  return solveLayout(words, options);
}

function main() {
  const args = parseArgs(process.argv);
  const seedPath = args.seedFile ? path.resolve(args.seedFile) : defaultSeedPath;
  const raw = fs.readFileSync(seedPath, "utf8").replace(/^\uFEFF/, "");
  const data = JSON.parse(raw);

  if (args.checkThresholds) {
    const flagged = [];
    const startedAt = Date.now();

    for (const entry of data) {
      const solve = solveEntry(entry, { restarts: args.restarts, beam: args.beam, budgetMs: args.budgetMs });
      if (!solve || !solve.best) continue;
      const { score } = solve.best;

      const widthHit = score.width > args.maxWidth;
      const heightHit = score.height > args.maxHeight;
      const match = args.thresholdMode === "or" ? (widthHit || heightHit) : (widthHit && heightHit);
      if (!match) continue;

      flagged.push({
        date: entry.date,
        width: score.width,
        height: score.height
      });
    }

    console.log(`Checked: ${data.length}`);
    console.log(`Threshold: width>${args.maxWidth} ${args.thresholdMode.toUpperCase()} height>${args.maxHeight}`);
    console.log(`Matches: ${flagged.length}`);
    for (const hit of flagged) {
      console.log(`${hit.date}: ${hit.width}x${hit.height}`);
    }
    console.log(`Elapsed: ${Date.now() - startedAt}ms`);
    return;
  }

  const targetDate = args.date || data[0]?.date;
  const entry = data.find((item) => item.date === targetDate);
  if (!entry) {
    throw new Error(`No theme words entry found for date ${targetDate}`);
  }

  const words = [...new Set((entry.targetWords || []).map((word) => String(word).toUpperCase()))];
  const solve = solveLayout(words, { restarts: args.restarts, beam: args.beam, budgetMs: args.budgetMs });
  const result = solve.best;
  if (!result) {
    throw new Error("Unable to generate a crossword layout for the selected words.");
  }

  const byWord = new Map(result.placements.map((placement) => [placement.word, placement]));
  entry.targetWords = words;
  entry.placements = words.map((word) => {
    const placement = byWord.get(word);
    if (!placement) {
      throw new Error(`Missing placement for word ${word}`);
    }
    return {
      word,
      row: placement.row,
      col: placement.col,
      direction: placement.direction
    };
  });

  if (args.write) {
    fs.writeFileSync(seedPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  }

  console.log(`${entry.date} ${result.score.width}x${result.score.height}`);
}

main();
