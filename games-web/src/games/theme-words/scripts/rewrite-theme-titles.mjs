import fs from "node:fs";
import path from "node:path";

const themeSeedPath = path.resolve("src/games/theme-words/themeSeed.generated.json");
const dailySeedPath = path.resolve("src/games/theme-words/dailySeed.json");

function parseArgs(argv) {
  const args = {
    write: false,
    source: "theme"
  };

  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--write") {
      args.write = true;
      continue;
    }
    if (token === "--source") {
      const value = String(argv[i + 1] || "").toLowerCase();
      if (value === "theme" || value === "daily") {
        args.source = value;
      }
      i += 1;
      continue;
    }
  }

  return args;
}

function normalizeWord(word) {
  return String(word || "").toLowerCase().replace(/[^a-z]/g, "");
}

function titleCase(input) {
  const text = String(input || "").trim().replace(/\s+/g, " ");
  return text
    .split(" ")
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1).toLowerCase())
    .join(" ");
}

function hashText(input) {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function classifyTheme(targetWords) {
  const words = (targetWords || []).map(normalizeWord);

  const buckets = {
    family: ["aunt", "uncle", "cousin", "mom", "dad", "baby", "home", "house", "yard", "kids", "family"],
    work: ["office", "boss", "work", "job", "memo", "email", "tax", "deal", "audit", "legal", "sales", "brief"],
    food: ["cook", "meal", "dine", "food", "kitchen", "snack", "taste", "plate", "bread", "sauce", "soup", "cafe", "lunch", "dinner"],
    travel: ["trip", "train", "plane", "coast", "route", "road", "hotel", "port", "map", "tour", "visit", "beach", "ocean", "shore"],
    town: ["town", "mayor", "parish", "civic", "council", "local", "church", "fair", "public", "street", "market", "block"],
    money: ["cash", "bank", "cost", "price", "sale", "store", "bill", "debt", "rent", "cheap", "paid", "budget", "wallet", "coupon"]
  };

  let bestBucket = "default";
  let bestScore = 0;

  for (const [bucket, keywords] of Object.entries(buckets)) {
    let score = 0;
    for (const word of words) {
      for (const keyword of keywords) {
        if (word === keyword) score += 2;
        else if (word.includes(keyword) || keyword.includes(word)) score += 0.25;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestBucket = bucket;
    }
  }

  return bestScore > 0 ? bestBucket : "default";
}

const BANK = {
  family: [
    "American Family", "Family Drama", "Family Secrets", "Family Gossip", "Family Trouble", "Family Tension",
    "Family Politics", "Family Weekend", "Family Shopping", "Sunday Dinner", "Sunday Drama", "Sunday Trouble",
    "Kitchen Drama", "Kitchen Gossip", "Kitchen Trouble", "Porch Gossip", "Porch Drama", "Backyard Drama",
    "Backyard Trouble", "Wedding Drama", "Wedding Trouble", "Wedding Gossip", "Reunion Drama", "Reunion Trouble",
    "School Gossip", "School Drama", "Church Gossip", "Church Drama", "Neighborhood Drama", "Neighborhood Gossip",
    "Suburban Drama", "Suburban Trouble", "Domestic Drama", "Domestic Trouble", "Domestic Gossip", "Household Drama",
    "Household Trouble", "Driveway Drama", "Garage Drama", "Cousin Drama", "Parlor Gossip", "Family Feud"
  ],
  work: [
    "Office Politics", "Office Drama", "Office Gossip", "Office Trouble", "Office Tension", "Office Panic",
    "Corporate Drama", "Corporate Trouble", "Legal Trouble", "Legal Drama", "Budget Panic", "Budget Trouble",
    "Monday Meeting", "Meeting Trouble", "Meeting Drama", "Team Drama", "Team Trouble", "Manager Drama",
    "Manager Trouble", "Deadline Panic", "Deadline Drama", "Policy Debate", "Policy Trouble", "Audit Panic",
    "Audit Trouble", "Sales Drama", "Sales Trouble", "Memo Drama", "Memo Trouble", "Boardroom Drama",
    "Boardroom Trouble", "Finance Trouble", "Finance Drama", "Quarterly Panic", "Quarterly Drama", "Pitch Drama",
    "Review Trouble", "Review Drama", "Calendar Panic", "Compliance Trouble", "Workday Drama", "Workplace Gossip"
  ],
  food: [
    "Legal Lunch", "Kitchen Drama", "Kitchen Trouble", "Kitchen Gossip", "Dinner Drama", "Dinner Trouble",
    "Brunch Drama", "Brunch Trouble", "Lunch Gossip", "Lunch Drama", "Menu Debate", "Menu Drama",
    "Recipe Trouble", "Recipe Drama", "Grocery Drama", "Grocery Trouble", "Pantry Panic", "Pantry Drama",
    "Cafe Drama", "Cafe Trouble", "Bakery Drama", "Bakery Trouble", "Potluck Politics", "Potluck Drama",
    "Supper Drama", "Supper Trouble", "Table Drama", "Table Gossip", "Snack Drama", "Snack Trouble",
    "Dessert Drama", "Cookout Drama", "Bistro Gossip", "Bistro Drama", "Sunday Brunch", "Sunday Dinner",
    "Kitchen Debate", "Grocery Gossip", "Lunch Trouble", "Dinner Gossip", "Meal Drama", "Food Trouble"
  ],
  travel: [
    "Beach Holiday", "Roadtrip Trouble", "Roadtrip Drama", "Roadtrip Gossip", "Airport Drama", "Airport Trouble",
    "Airport Delay", "Motel Mystery", "Motel Trouble", "Vacation Drama", "Vacation Trouble", "Transit Trouble",
    "Transit Drama", "Flight Delay", "Flight Trouble", "Tourist Trouble", "Tourist Drama", "Scenic Detour",
    "Scenic Trouble", "Weekend Getaway", "Holiday Drama", "Holiday Trouble", "Coastal Drama", "Coastal Trouble",
    "Seaside Drama", "Seaside Trouble", "Harbor Trouble", "Harbor Drama", "Hotel Trouble", "Hotel Drama",
    "Passport Trouble", "Luggage Trouble", "Island Trouble", "Island Drama", "Travel Drama", "Travel Trouble",
    "Journey Trouble", "Journey Drama", "Route Trouble", "Route Drama", "Highway Drama", "Highway Trouble"
  ],
  town: [
    "Smalltown Drama", "Town Gossip", "Town Rumors", "Town Drama", "Town Trouble", "Town Politics",
    "Local Gossip", "Local Rumors", "Local Drama", "Civic Drama", "Civic Trouble", "Council Drama",
    "Council Trouble", "Parish Gossip", "Parish Drama", "Street Rumors", "Street Drama", "Market Drama",
    "Market Trouble", "Neighborhood Gossip", "Neighborhood Drama", "Community Drama", "Community Trouble",
    "Community Gossip", "Block Gossip", "Block Drama", "County Rumors", "County Drama", "Village Gossip",
    "Village Drama", "District Drama", "District Trouble", "Regional Gossip", "Regional Drama", "Public Drama",
    "Public Trouble", "Urban Gossip", "Urban Drama", "Corner Gossip", "Corner Drama", "Municipal Drama", "Mainstreet Gossip"
  ],
  money: [
    "Budget Panic", "Budget Trouble", "Budget Drama", "Money Trouble", "Money Panic", "Wallet Panic",
    "Wallet Trouble", "Rent Trouble", "Rent Panic", "Retail Regret", "Retail Drama", "Retail Trouble",
    "Bill Panic", "Bill Trouble", "Price Shock", "Price Trouble", "Coupon Drama", "Coupon Trouble",
    "Credit Trouble", "Credit Panic", "Cash Trouble", "Cash Panic", "Dollar Drama", "Dollar Trouble",
    "Invoice Trouble", "Invoice Drama", "Savings Trouble", "Savings Panic", "Mortgage Trouble", "Salary Trouble",
    "Tax Trouble", "Tax Panic", "Market Trouble", "Market Panic", "Checkout Drama", "Checkout Trouble",
    "Penny Panic", "Banking Trouble", "Finance Panic", "Payment Trouble", "Budget Crunch", "Money Crunch"
  ],
  default: [
    "Weekend Drama", "Weekend Trouble", "Weekend Gossip", "American Drama", "American Trouble", "Local Trouble",
    "Local Drama", "Neighborhood Gossip", "Neighborhood Trouble", "Kitchen Trouble", "Kitchen Gossip", "Holiday Drama",
    "Holiday Trouble", "Sunday Drama", "Sunday Trouble", "Public Drama", "Public Trouble", "Community Trouble",
    "Community Drama", "Family Trouble", "Family Gossip", "Town Trouble", "Town Drama", "Backyard Drama",
    "Backyard Trouble", "Roadtrip Trouble", "Roadtrip Drama", "Office Trouble", "Office Drama", "Grocery Trouble",
    "Grocery Drama", "Apartment Drama", "Apartment Trouble", "School Drama", "School Trouble", "Civic Drama",
    "Civic Trouble", "Mainstreet Drama", "Mainstreet Trouble", "Domestic Drama", "Domestic Trouble", "Daily Drama"
  ]
};

const BANNED_TITLES = new Set([]);
const BANNED_WORDS = new Set([]);

function buildCandidates() {
  const byBucket = new Map();
  for (const [bucket, titles] of Object.entries(BANK)) {
    const phrases = [];
    for (const item of titles) {
      const phrase = titleCase(item);
      if (!/^[A-Za-z]+ [A-Za-z]+$/.test(phrase)) continue;
      if (phrase.length > 25) continue;
      if (BANNED_TITLES.has(phrase)) continue;
      const [a, b] = phrase.split(" ");
      if (BANNED_WORDS.has(normalizeWord(a)) || BANNED_WORDS.has(normalizeWord(b))) continue;
      phrases.push(phrase);
    }
    byBucket.set(bucket, [...new Set(phrases)]);
  }
  return byBucket;
}

function pickTitleForRow(row, index, usageCounts, candidatesByBucket) {
  const bucket = classifyTheme(row.targetWords || []);
  const targetSet = new Set((row.targetWords || []).map(normalizeWord));

  const rankedPools = [
    ...(bucket === "default"
      ? [
          { name: "default", penalty: 0 },
          { name: "family", penalty: 2 },
          { name: "town", penalty: 2 },
          { name: "work", penalty: 2 },
          { name: "food", penalty: 2 },
          { name: "travel", penalty: 2 },
          { name: "money", penalty: 2 }
        ]
      : [
          { name: bucket, penalty: 0 },
          { name: "default", penalty: 1.25 }
        ])
  ];

  const merged = [];
  for (const pool of rankedPools) {
    for (const title of candidatesByBucket.get(pool.name) || []) {
      const [a, b] = title.split(" ");
      if (targetSet.has(normalizeWord(a)) || targetSet.has(normalizeWord(b))) continue;
      merged.push({ title, penalty: pool.penalty });
    }
  }

  const deduped = new Map();
  for (const item of merged) {
    const existing = deduped.get(item.title);
    if (!existing || item.penalty < existing.penalty) {
      deduped.set(item.title, item);
    }
  }
  const candidates = [...deduped.values()];
  if (candidates.length === 0) return "Daily Drama";

  let bestTitle = candidates[0].title;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const used = usageCounts.get(candidate.title) || 0;
    const jitter = (hashText(`${row.date}|${row.letters}|${candidate.title}|${index}`) % 1000) / 100000;
    const score = used + candidate.penalty + jitter;
    if (score < bestScore) {
      bestScore = score;
      bestTitle = candidate.title;
    }
  }

  usageCounts.set(bestTitle, (usageCounts.get(bestTitle) || 0) + 1);
  return bestTitle;
}

function summarizeTitleCounts(rows) {
  const counts = new Map();
  for (const row of rows) {
    const title = String(row.themeTitle || "");
    counts.set(title, (counts.get(title) || 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return {
    uniqueTitles: counts.size,
    maxCount: sorted[0]?.[1] || 0,
    top20: sorted.slice(0, 20)
  };
}

function main() {
  const args = parseArgs(process.argv);
  const sourcePath = args.source === "daily" ? dailySeedPath : themeSeedPath;
  const raw = fs.readFileSync(sourcePath, "utf8").replace(/^\uFEFF/, "");
  const rows = JSON.parse(raw);

  const usageCounts = new Map();
  const candidatesByBucket = buildCandidates();

  rows.forEach((row, index) => {
    row.themeTitle = pickTitleForRow(row, index, usageCounts, candidatesByBucket);
  });

  const summary = summarizeTitleCounts(rows);

  if (args.write) {
    const text = `${JSON.stringify(rows, null, 2)}\n`;
    fs.writeFileSync(themeSeedPath, text, "utf8");
    fs.writeFileSync(dailySeedPath, text, "utf8");
  }

  console.log(`Rows: ${rows.length}`);
  console.log(`Unique titles: ${summary.uniqueTitles}`);
  console.log(`Max repeat count: ${summary.maxCount}`);
  console.log("Top 20 repeats:");
  for (const [title, count] of summary.top20) {
    console.log(`${String(count).padStart(4, " ")} ${title}`);
  }
}

main();
