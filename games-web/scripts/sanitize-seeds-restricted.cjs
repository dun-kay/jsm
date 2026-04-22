const fs = require('fs');
const path = require('path');

const DAY_MS = 24 * 60 * 60 * 1000;
const banned = new Set([
  'adult',
  'drug',
  'drugs',
  'sex',
  'sexual',
  'nude',
  'porn',
  'rape',
  'murder',
  'kill',
  'killed',
  'gun',
  'guns',
  'alcohol',
  'beer',
  'wine',
  'vodka',
  'whiskey',
  'drunk',
]);

const files = [
  'src/games/one-away/dailySeed.json',
  'src/games/order-me/dailySeed.json',
  'src/games/secret-words/dailySeed.json',
  'src/games/theme-words/dailySeed.json',
  'src/games/theme-words/themeSeed.generated.json',
];

function hasBanned(entry) {
  const words = [];
  if (typeof entry.target === 'string') words.push(entry.target);
  if (Array.isArray(entry.words)) words.push(...entry.words);
  if (Array.isArray(entry.targetWords)) words.push(...entry.targetWords);

  for (const word of words) {
    if (typeof word !== 'string') continue;
    const normalized = word.trim().toLowerCase();
    if (banned.has(normalized)) return true;
  }
  return false;
}

function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  return new Date(d.getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

function run() {
  const root = path.resolve(__dirname, '..');
  for (const rel of files) {
    const filePath = path.join(root, rel);
    const raw = fs.readFileSync(filePath, 'utf8');
    const entries = JSON.parse(raw);
    if (!Array.isArray(entries) || entries.length === 0) {
      console.log(`${rel}: skipped (empty/non-array)`);
      continue;
    }

    const startDate = entries[0].date;
    const kept = entries.filter((entry) => !hasBanned(entry));
    for (let i = 0; i < kept.length; i += 1) {
      kept[i].date = addDays(startDate, i);
    }

    const removed = entries.length - kept.length;
    fs.writeFileSync(filePath, `${JSON.stringify(kept, null, 2)}\n`, 'utf8');
    console.log(`${rel}: removed ${removed}, kept ${kept.length}, start ${startDate} -> end ${kept[kept.length - 1].date}`);
  }
}

run();
