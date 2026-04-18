import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BUILD_DIR = path.resolve(__dirname, "../seed-build");
const INPUT_JSONL = path.join(BUILD_DIR, "six_letter_combo_word_index.common.min50.jsonl");
const WORDFREQ_PATH = path.join(BUILD_DIR, "wordfreq-en-25000-log.json");
const OUTPUT_JSONL = path.join(BUILD_DIR, "six_letter_combo_word_index.common.min50.secrets.jsonl");
const OUTPUT_SUMMARY = path.join(BUILD_DIR, "six_letter_combo_word_index.common.min50.secrets.summary.json");

const LENGTHS = [3, 4, 5, 6];
const TARGET_RATIO = { 3: 0.15, 4: 0.50, 5: 0.30, 6: 0.05 };

class MaxFlow {
  constructor(nodeCount) {
    this.n = nodeCount;
    this.graph = Array.from({ length: nodeCount }, () => []);
  }

  addEdge(from, to, cap) {
    const fwd = { to, rev: this.graph[to].length, cap };
    const rev = { to: from, rev: this.graph[from].length, cap: 0 };
    this.graph[from].push(fwd);
    this.graph[to].push(rev);
  }

  run(source, sink) {
    let flow = 0;
    while (true) {
      const parentNode = Array(this.n).fill(-1);
      const parentEdge = Array(this.n).fill(-1);
      const queue = [source];
      parentNode[source] = source;

      for (let qi = 0; qi < queue.length; qi += 1) {
        const node = queue[qi];
        if (node === sink) break;
        for (let ei = 0; ei < this.graph[node].length; ei += 1) {
          const edge = this.graph[node][ei];
          if (edge.cap <= 0 || parentNode[edge.to] !== -1) continue;
          parentNode[edge.to] = node;
          parentEdge[edge.to] = ei;
          queue.push(edge.to);
          if (edge.to === sink) break;
        }
      }

      if (parentNode[sink] === -1) break;

      let add = Infinity;
      for (let v = sink; v !== source; v = parentNode[v]) {
        const u = parentNode[v];
        const e = this.graph[u][parentEdge[v]];
        add = Math.min(add, e.cap);
      }

      for (let v = sink; v !== source; v = parentNode[v]) {
        const u = parentNode[v];
        const ei = parentEdge[v];
        const e = this.graph[u][ei];
        e.cap -= add;
        this.graph[v][e.rev].cap += add;
      }

      flow += add;
    }

    return flow;
  }
}

function hashString(input) {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function chooseCounts(total) {
  const raw = LENGTHS.map((length) => ({ length, exact: total * TARGET_RATIO[length] }));
  const counts = Object.fromEntries(raw.map((r) => [r.length, Math.floor(r.exact)]));
  let assigned = Object.values(counts).reduce((a, b) => a + b, 0);
  const byRemainder = raw
    .map((r) => ({ length: r.length, remainder: r.exact - Math.floor(r.exact) }))
    .sort((a, b) => b.remainder - a.remainder);

  let i = 0;
  while (assigned < total) {
    counts[byRemainder[i % byRemainder.length].length] += 1;
    assigned += 1;
    i += 1;
  }
  return counts;
}

function cloneCounts(counts) {
  return { 3: counts[3], 4: counts[4], 5: counts[5], 6: counts[6] };
}

function totalCounts(counts) {
  return counts[3] + counts[4] + counts[5] + counts[6];
}

function normalizeWordList(words) {
  const seen = new Set();
  const out = [];
  for (const value of words) {
    const word = String(value).toLowerCase().trim();
    if (!/^[a-z]{3,6}$/.test(word)) continue;
    if (seen.has(word)) continue;
    seen.add(word);
    out.push(word);
  }
  return out;
}

function buildAndRun(combos, quotas, returnAssignments = false) {
  const total = combos.length;
  const source = 0;
  const comboStart = 1;
  const lengthStart = comboStart + total;
  const sink = lengthStart + LENGTHS.length;

  const mf = new MaxFlow(sink + 1);

  for (let i = 0; i < total; i += 1) {
    mf.addEdge(source, comboStart + i, 1);
    const byLen = combos[i].byLen;
    for (let li = 0; li < LENGTHS.length; li += 1) {
      const L = LENGTHS[li];
      if (byLen[L].length > 0) {
        mf.addEdge(comboStart + i, lengthStart + li, 1);
      }
    }
  }

  for (let li = 0; li < LENGTHS.length; li += 1) {
    const L = LENGTHS[li];
    mf.addEdge(lengthStart + li, sink, quotas[L]);
  }

  const flow = mf.run(source, sink);

  if (!returnAssignments || flow !== total) {
    return { flow };
  }

  const assignedLength = new Map();
  for (let i = 0; i < total; i += 1) {
    const node = comboStart + i;
    for (const edge of mf.graph[node]) {
      if (edge.to < lengthStart || edge.to >= lengthStart + LENGTHS.length) continue;
      const reverseEdge = mf.graph[edge.to][edge.rev];
      if (reverseEdge.cap > 0) {
        const length = LENGTHS[edge.to - lengthStart];
        assignedLength.set(i, length);
      }
    }
  }

  return { flow, assignedLength };
}

function sumAbsDiff(a, b) {
  return LENGTHS.reduce((sum, L) => sum + Math.abs(a[L] - b[L]), 0);
}

async function main() {
  const [rowsRaw, wordfreqRaw] = await Promise.all([
    readFile(INPUT_JSONL, "utf8"),
    readFile(WORDFREQ_PATH, "utf8")
  ]);

  const freqPairs = JSON.parse(wordfreqRaw);
  const rank = new Map();
  for (let i = 0; i < freqPairs.length; i += 1) {
    const row = freqPairs[i];
    if (!Array.isArray(row) || typeof row[0] !== "string") continue;
    rank.set(row[0].toLowerCase(), i);
  }

  const combos = rowsRaw
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line))
    .map((row) => {
      const letters = String(row.letters).toUpperCase();
      const words = normalizeWordList(Array.isArray(row.words) ? row.words : []).filter((w) => rank.has(w));

      const byLen = { 3: [], 4: [], 5: [], 6: [] };
      for (const word of words) {
        byLen[word.length].push(word);
      }

      for (const L of LENGTHS) {
        byLen[L].sort((a, b) => rank.get(a) - rank.get(b));
      }

      return { letters, words, byLen };
    });

  const total = combos.length;
  const target = chooseCounts(total);

  const availability = { 3: 0, 4: 0, 5: 0, 6: 0 };
  for (const combo of combos) {
    for (const L of LENGTHS) {
      if (combo.byLen[L].length > 0) availability[L] += 1;
    }
  }

  let quotas = cloneCounts(target);
  let overflow = 0;
  for (const L of LENGTHS) {
    if (quotas[L] > availability[L]) {
      overflow += quotas[L] - availability[L];
      quotas[L] = availability[L];
    }
  }

  if (overflow > 0) {
    const order = [4, 5, 3, 6];
    for (const L of order) {
      if (overflow === 0) break;
      const spare = availability[L] - quotas[L];
      if (spare <= 0) continue;
      const add = Math.min(spare, overflow);
      quotas[L] += add;
      overflow -= add;
    }
  }

  if (totalCounts(quotas) !== total) {
    throw new Error("Quota redistribution failed to match total combos.");
  }

  let result = buildAndRun(combos, quotas, false);

  while (result.flow < total) {
    let best = null;
    for (const from of LENGTHS) {
      if (quotas[from] <= 0) continue;
      for (const to of LENGTHS) {
        if (from === to) continue;
        if (quotas[to] >= availability[to]) continue;

        const trial = cloneCounts(quotas);
        trial[from] -= 1;
        trial[to] += 1;

        const trialResult = buildAndRun(combos, trial, false);
        const trialDiff = sumAbsDiff(trial, target);

        if (!best || trialResult.flow > best.flow || (trialResult.flow === best.flow && trialDiff < best.diff)) {
          best = { quotas: trial, flow: trialResult.flow, diff: trialDiff };
        }
      }
    }

    if (!best || best.flow <= result.flow) {
      throw new Error(`Could not find feasible quota adjustment. bestFlow=${best ? best.flow : "none"}, currentFlow=${result.flow}`);
    }

    quotas = best.quotas;
    result = { flow: best.flow };
  }

  const final = buildAndRun(combos, quotas, true);
  if (final.flow !== total || !final.assignedLength || final.assignedLength.size !== total) {
    throw new Error("Failed to compute final assignments.");
  }

  const assignedByLength = { 3: 0, 4: 0, 5: 0, 6: 0 };
  const rowsOut = [];

  for (let i = 0; i < total; i += 1) {
    const combo = combos[i];
    const L = final.assignedLength.get(i);
    const candidates = combo.byLen[L];
    const topSlice = candidates.slice(0, Math.min(7, candidates.length));
    const pickIndex = hashString(`${combo.letters}:${L}`) % topSlice.length;
    const secretWord = topSlice[pickIndex];

    assignedByLength[L] += 1;
    rowsOut.push({
      letters: combo.letters,
      secretWord,
      secretLength: L,
      words: combo.words
    });
  }

  await writeFile(OUTPUT_JSONL, `${rowsOut.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");

  const summary = {
    generatedAt: new Date().toISOString(),
    source: INPUT_JSONL,
    constraints: {
      secretLengthMin: 3,
      requestedDistribution: TARGET_RATIO,
      selectionRule: "Secret picked from top-7 highest-frequency candidates for assigned length (deterministic hash)"
    },
    totals: {
      combos: total,
      availableByLength: availability,
      targetByLength: target,
      assignedByLength,
      absoluteDifferenceFromTarget: sumAbsDiff(assignedByLength, target)
    },
    outputs: {
      jsonl: OUTPUT_JSONL
    }
  };

  await writeFile(OUTPUT_SUMMARY, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

