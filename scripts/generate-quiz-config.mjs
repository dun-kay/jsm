import { readFile, writeFile } from "node:fs/promises";

const source = await readFile(new URL("../ENV.txt", import.meta.url), "utf8");
const values = Object.fromEntries(source.split(/\r?\n/).map((line) => {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  return match ? [match[1], match[2].replace(/^['"]|['"]$/g, "")] : [];
}).filter(([key]) => key));
const supabaseUrl = values.SUPABASE_URL;
const publishableKey = values.SUPABASE_PUBLISHABLE_KEY;
if (!supabaseUrl || !publishableKey) throw new Error("SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are required in ENV.txt.");
const output = `// Browser-safe configuration. Generated from ENV.txt; no secrets are included.\nwindow.QUIZ_CONFIG = ${JSON.stringify({ supabaseUrl, supabaseAnonKey: publishableKey, functionsUrl: `${supabaseUrl}/functions/v1`, mockPayments: false }, null, 2)};\n`;
await writeFile(new URL("../quiz/ismyboyfriendstupid/quiz-config.js", import.meta.url), output);
