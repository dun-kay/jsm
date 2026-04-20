export type ThemeWordDirection = "across" | "down";

export type ThemeWordPlacement = {
  word: string;
  row: number;
  col: number;
  direction: ThemeWordDirection;
};

type CellEntry = {
  word: string;
  direction: ThemeWordDirection;
};

type CellData = {
  letter: string;
  entries: CellEntry[];
};

type Score = {
  intersections: number;
  sideContacts: number;
  area: number;
  shapePenalty: number;
  maxSpan: number;
  placedWords: number;
};

function createRng(seed: number) {
  let value = seed >>> 0;
  return () => {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    return (value >>> 0) / 4294967296;
  };
}

function hashText(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function keyOf(row: number, col: number) {
  return `${row}:${col}`;
}

function parseKey(key: string) {
  const [rowText, colText] = key.split(":");
  return { row: Number(rowText), col: Number(colText) };
}

function buildCellMap(placements: ThemeWordPlacement[]) {
  const cells = new Map<string, CellData>();
  for (const placement of placements) {
    const chars = placement.word.split("");
    for (let index = 0; index < chars.length; index += 1) {
      const row = placement.row + (placement.direction === "down" ? index : 0);
      const col = placement.col + (placement.direction === "across" ? index : 0);
      const key = keyOf(row, col);
      const existing = cells.get(key);
      if (!existing) {
        cells.set(key, {
          letter: chars[index],
          entries: [{ word: placement.word, direction: placement.direction }]
        });
      } else {
        if (existing.letter !== chars[index]) {
          return null;
        }
        existing.entries.push({ word: placement.word, direction: placement.direction });
      }
    }
  }
  return cells;
}

function computeBoundsFromCells(cells: Map<string, CellData>) {
  if (cells.size === 0) {
    return { minRow: 0, maxRow: 0, minCol: 0, maxCol: 0, width: 1, height: 1, area: 1 };
  }
  let minRow = Number.POSITIVE_INFINITY;
  let minCol = Number.POSITIVE_INFINITY;
  let maxRow = Number.NEGATIVE_INFINITY;
  let maxCol = Number.NEGATIVE_INFINITY;

  for (const key of cells.keys()) {
    const { row, col } = parseKey(key);
    minRow = Math.min(minRow, row);
    minCol = Math.min(minCol, col);
    maxRow = Math.max(maxRow, row);
    maxCol = Math.max(maxCol, col);
  }

  const width = maxCol - minCol + 1;
  const height = maxRow - minRow + 1;
  return {
    minRow,
    maxRow,
    minCol,
    maxCol,
    width,
    height,
    area: width * height
  };
}

function evaluatePlacement(
  word: string,
  row: number,
  col: number,
  direction: ThemeWordDirection,
  cells: Map<string, CellData>
) {
  const chars = word.split("");
  const beforeRow = direction === "down" ? row - 1 : row;
  const beforeCol = direction === "across" ? col - 1 : col;
  const afterRow = direction === "down" ? row + chars.length : row;
  const afterCol = direction === "across" ? col + chars.length : col;

  if (cells.has(keyOf(beforeRow, beforeCol)) || cells.has(keyOf(afterRow, afterCol))) {
    return null;
  }

  let intersections = 0;
  for (let index = 0; index < chars.length; index += 1) {
    const r = row + (direction === "down" ? index : 0);
    const c = col + (direction === "across" ? index : 0);
    const key = keyOf(r, c);
    const existing = cells.get(key);

    if (existing) {
      if (existing.letter !== chars[index]) {
        return null;
      }
      if (existing.entries.some((entry) => entry.direction === direction)) {
        return null;
      }
      intersections += 1;
      continue;
    }

    if (direction === "across") {
      if (cells.has(keyOf(r - 1, c)) || cells.has(keyOf(r + 1, c))) {
        return null;
      }
    } else if (cells.has(keyOf(r, c - 1)) || cells.has(keyOf(r, c + 1))) {
      return null;
    }
  }

  if (cells.size > 0 && intersections === 0) {
    return null;
  }

  return { row, col, direction, intersections };
}

function generateCandidates(word: string, placements: ThemeWordPlacement[], rng: () => number) {
  const cells = buildCellMap(placements);
  if (!cells) {
    return [] as Array<{ word: string; row: number; col: number; direction: ThemeWordDirection; intersections: number }>;
  }

  const dedupe = new Set<string>();
  const candidates: Array<{ word: string; row: number; col: number; direction: ThemeWordDirection; intersections: number }> = [];

  if (placements.length === 0) {
    return [
      { word, row: 0, col: 0, direction: "across", intersections: 0 },
      { word, row: 0, col: 0, direction: "down", intersections: 0 }
    ];
  }

  for (const [cellKey, cell] of cells.entries()) {
    const { row: baseRow, col: baseCol } = parseKey(cellKey);
    for (let index = 0; index < word.length; index += 1) {
      if (word[index] !== cell.letter) continue;

      const across = evaluatePlacement(word, baseRow, baseCol - index, "across", cells);
      if (across) {
        const key = `${across.row}:${across.col}:${across.direction}`;
        if (!dedupe.has(key)) {
          dedupe.add(key);
          candidates.push({ word, ...across });
        }
      }

      const down = evaluatePlacement(word, baseRow - index, baseCol, "down", cells);
      if (down) {
        const key = `${down.row}:${down.col}:${down.direction}`;
        if (!dedupe.has(key)) {
          dedupe.add(key);
          candidates.push({ word, ...down });
        }
      }
    }
  }

  return candidates
    .map((candidate) => ({ candidate, sort: rng() }))
    .sort((a, b) => a.sort - b.sort)
    .map((entry) => entry.candidate);
}

function buildScore(placements: ThemeWordPlacement[]): Score | null {
  const cells = buildCellMap(placements);
  if (!cells) {
    return null;
  }

  const bounds = computeBoundsFromCells(cells);
  const totalLetters = placements.reduce((sum, placement) => sum + placement.word.length, 0);
  const intersections = totalLetters - cells.size;
  const maxSpan = Math.max(bounds.width, bounds.height);
  const shapePenalty = Math.abs(bounds.width - bounds.height);
  let sideContacts = 0;

  const directions = [
    { dr: 0, dc: 1 },
    { dr: 1, dc: 0 }
  ];

  for (const [key, cell] of cells.entries()) {
    const { row, col } = parseKey(key);
    for (const { dr, dc } of directions) {
      const neighbor = cells.get(keyOf(row + dr, col + dc));
      if (!neighbor) continue;
      const cellWords = new Set(cell.entries.map((entry) => entry.word));
      const sharedWord = neighbor.entries.some((entry) => cellWords.has(entry.word));
      if (!sharedWord) {
        sideContacts += 1;
      }
    }
  }

  return {
    intersections,
    sideContacts,
    area: bounds.area,
    shapePenalty,
    maxSpan,
    placedWords: placements.length
  };
}

function compareScores(a: Score, b: Score) {
  if (a.placedWords !== b.placedWords) return b.placedWords - a.placedWords;
  if (a.sideContacts !== b.sideContacts) return a.sideContacts - b.sideContacts;
  if (a.intersections !== b.intersections) return b.intersections - a.intersections;
  if (a.area !== b.area) return a.area - b.area;
  if (a.shapePenalty !== b.shapePenalty) return a.shapePenalty - b.shapePenalty;
  if (a.maxSpan !== b.maxSpan) return a.maxSpan - b.maxSpan;
  return b.placedWords - a.placedWords;
}

function normalizePlacements(placements: ThemeWordPlacement[]) {
  if (placements.length === 0) {
    return placements;
  }
  const cells = buildCellMap(placements);
  if (!cells) {
    return placements;
  }
  const bounds = computeBoundsFromCells(cells);
  return placements.map((placement) => ({
    ...placement,
    row: placement.row - bounds.minRow,
    col: placement.col - bounds.minCol
  }));
}

function countIntersectionsForPlacement(target: ThemeWordPlacement, placements: ThemeWordPlacement[]) {
  const cells = buildCellMap(placements);
  if (!cells) return 0;

  let intersections = 0;
  const chars = target.word.split("");
  for (let index = 0; index < chars.length; index += 1) {
    const row = target.row + (target.direction === "down" ? index : 0);
    const col = target.col + (target.direction === "across" ? index : 0);
    const cell = cells.get(keyOf(row, col));
    if (!cell) continue;
    if (cell.entries.length > 1) {
      intersections += 1;
    }
  }
  return intersections;
}

function findRemovablePlacement(placements: ThemeWordPlacement[], blockedWords: Set<string>) {
  if (placements.length <= 1) return -1;

  const removable = placements
    .map((placement, index) => ({ placement, index }))
    .filter(({ placement }) => !blockedWords.has(placement.word))
    .map(({ placement, index }) => ({
      placement,
      index,
      intersections: countIntersectionsForPlacement(placement, placements)
    }))
    .filter((entry) => entry.intersections === 1);

  if (removable.length === 0) return -1;

  removable.sort((a, b) => {
    if (a.placement.word.length !== b.placement.word.length) {
      return a.placement.word.length - b.placement.word.length;
    }
    return a.index - b.index;
  });
  return removable[0].index;
}

function tryPlaceWordWithPreference(
  word: string,
  placements: ThemeWordPlacement[],
  preferAcross: boolean,
  rng: () => number
) {
  const candidates = generateCandidates(word, placements, rng);
  if (candidates.length === 0) return null;

  const preferredDir: ThemeWordDirection = preferAcross ? "across" : "down";
  const preferred = candidates.filter((candidate) => candidate.direction === preferredDir);
  const fallback = candidates.filter((candidate) => candidate.direction !== preferredDir);
  const chosen = [...preferred, ...fallback][0];
  if (!chosen) return null;

  return {
    word,
    row: chosen.row,
    col: chosen.col,
    direction: chosen.direction
  } as ThemeWordPlacement;
}

function solveWithArrangementCore(words: string[], seedOffset: number) {
  const seed = hashText(`${words.join("|")}:${seedOffset}`);
  const rng = createRng(seed);

  const unplaced = [...words]
    .map((word) => ({ word, sort: rng() }))
    .sort((a, b) => b.word.length - a.word.length || a.sort - b.sort)
    .map((entry) => entry.word);

  const placements: ThemeWordPlacement[] = [];
  const blockedRemovals = new Set<string>();
  let wordsAddedSinceRemoval = 0;
  let nextAcross = true;

  if (unplaced.length > 0) {
    const first = unplaced.shift();
    if (first) {
      placements.push({ word: first, row: 0, col: 0, direction: "across" });
      nextAcross = false;
      wordsAddedSinceRemoval = 1;
    }
  }

  while (unplaced.length > 0) {
    let placedAny = false;

    for (let i = 0; i < unplaced.length; i += 1) {
      const word = unplaced[i];
      const placed = tryPlaceWordWithPreference(word, placements, nextAcross, rng);
      if (!placed) continue;
      placements.push(placed);
      unplaced.splice(i, 1);
      nextAcross = !nextAcross;
      wordsAddedSinceRemoval += 1;
      if (wordsAddedSinceRemoval >= 2) {
        blockedRemovals.clear();
      }
      placedAny = true;
      break;
    }

    if (placedAny) continue;

    const removableIndex = findRemovablePlacement(placements, blockedRemovals);
    if (removableIndex < 0) break;
    const [removed] = placements.splice(removableIndex, 1);
    blockedRemovals.add(removed.word);
    unplaced.push(removed.word);
    unplaced.sort((a, b) => b.length - a.length || a.localeCompare(b));
    wordsAddedSinceRemoval = 0;
  }

  return {
    placements: normalizePlacements(placements),
    unplacedCount: unplaced.length
  };
}

export function solveThemeLayout(words: string[], seedKey: string) {
  const normalizedWords = [...new Set(words.map((word) => String(word).toUpperCase()))];
  if (normalizedWords.length === 0) return [] as ThemeWordPlacement[];

  const restarts = 28;
  const masterSeed = hashText(`${seedKey}|${normalizedWords.join("|")}`);
  let best: { score: Score; placements: ThemeWordPlacement[]; unplacedCount: number } | null = null;

  for (let restart = 0; restart < restarts; restart += 1) {
    const run = solveWithArrangementCore(normalizedWords, masterSeed + restart * 7919);
    const score = buildScore(run.placements);
    if (!score) continue;

    if (!best || compareScores(score, best.score) < 0) {
      best = {
        score,
        placements: run.placements,
        unplacedCount: run.unplacedCount
      };
    }

    if (best && best.unplacedCount === 0) {
      break;
    }
  }

  if (!best) {
    return normalizedWords.map((word, index) => ({
      word,
      row: index * 2,
      col: 0,
      direction: "across" as const
    }));
  }

  const placementByWord = new Map(best.placements.map((placement) => [placement.word, placement]));
  const ordered: ThemeWordPlacement[] = [];
  let fallbackRow = 0;

  for (const word of normalizedWords) {
    const placement = placementByWord.get(word);
    if (placement) {
      ordered.push(placement);
      continue;
    }
    ordered.push({
      word,
      row: fallbackRow,
      col: 0,
      direction: "across"
    });
    fallbackRow += 2;
  }

  return normalizePlacements(ordered);
}
