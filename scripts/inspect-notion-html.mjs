import fs from "node:fs/promises";
import path from "node:path";

const folder = path.join(process.cwd(), "BLACKWATER BAY_FINAL EPS");
const files = (await fs.readdir(folder)).filter((file) => file.endsWith(".html")).sort();

for (const file of files) {
  const html = await fs.readFile(path.join(folder, file), "utf8");
  const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? html;
  const sample = body
    .replace(/\s+/g, " ")
    .slice(0, 1800);

  console.log(`\n--- ${file} ---`);
  console.log(sample);
  const tags = [...body.matchAll(/<([a-z0-9-]+)(\s|>)/gi)].map((match) => match[1].toLowerCase());
  const counts = new Map();
  for (const tag of tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  console.log([...counts.entries()].map(([tag, count]) => `${tag}:${count}`).join(", "));
}
