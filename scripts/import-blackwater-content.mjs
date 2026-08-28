import fs from "node:fs/promises";
import path from "node:path";

async function readEnvFile(file) {
  try {
    const content = await fs.readFile(file, "utf8");
    return Object.fromEntries(
      content
        .split(/\r?\n/)
        .map((line) => line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/))
        .filter(Boolean)
        .map((match) => [match[1], match[2].trim().replace(/^['"]|['"]$/g, "")]),
    );
  } catch {
    return {};
  }
}

const EPISODES = [
  {
    id: "33333333-3333-4333-8333-333333333331",
    fileToken: "S1 E1",
    breakText: "Owen threw up his arms.",
  },
  {
    id: "33333333-3333-4333-8333-333333333332",
    fileToken: "S1 E2",
    breakText: "Owen held me up.",
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    fileToken: "S1 E3",
    breakText: "Then, a frail, reedy voice floated toward them.",
  },
  {
    id: "33333333-3333-4333-8333-333333333334",
    fileToken: "S1 E4",
    breakText: "Jules was now regretting her previous enthusiasm.",
  },
  {
    id: "33333333-3333-4333-8333-333333333335",
    fileToken: "S1 E5",
    breakText: "Laura made it to school with less than a minute to spare",
  },
];

function requireEnv(name, value) {
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function decodeHtml(value) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, number) => String.fromCodePoint(Number.parseInt(number, 10)))
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function normaliseText(value) {
  return decodeHtml(value)
    .replace(/<[^>]+>/g, "")
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractPageBody(html) {
  const match = html.match(/<div class="page-body">([\s\S]*?)<\/div>\s*<\/article>/i);
  if (!match) throw new Error("Could not find Notion page-body");
  return match[1];
}

function stripAttributes(html) {
  return html
    .replace(/<(\/?)(p|em|strong|span)\b[^>]*>/gi, "<$1$2>")
    .replace(/<span>/gi, "")
    .replace(/<\/span>/gi, "")
    .replace(/<p>\s*<\/p>/gi, "<p>&nbsp;</p>");
}

function stripRejectedPhrases(html) {
  return html.replace(
    " Someone had dragged an old sofa onto the beach. Someone else had acquired a shopping trolley. It was that sort of night.",
    "",
  );
}

function extractBlocks(pageBody) {
  return [...pageBody.matchAll(/<p\b[^>]*>[\s\S]*?<\/p>/gi)]
    .map((match) => stripAttributes(match[0]))
    .map((block) => stripRejectedPhrases(block))
    .filter(Boolean);
}

function isBlankBlock(block) {
  return normaliseText(block).length === 0;
}

function trimEdgeBlankBlocks(blocks) {
  const trimmed = [...blocks];

  while (trimmed.length && isBlankBlock(trimmed[0])) {
    trimmed.shift();
  }

  while (trimmed.length && isBlankBlock(trimmed[trimmed.length - 1])) {
    trimmed.pop();
  }

  return trimmed;
}

function defaultSecretKey(value) {
  if (!value) return "";
  try {
    return JSON.parse(value).default || "";
  } catch {
    return "";
  }
}

function splitEpisode(blocks, breakText) {
  const needle = normaliseText(breakText);
  const paidIndex = blocks.findIndex((block) => normaliseText(block).includes(needle));

  if (paidIndex === -1) {
    throw new Error(`Could not find paid break: ${breakText}`);
  }

  return {
    previewHtml: trimEdgeBlankBlocks(blocks.slice(0, paidIndex)).join("\n").trim(),
    paidHtml: trimEdgeBlankBlocks(blocks.slice(paidIndex)).join("\n").trim(),
  };
}

async function findEpisodeFile(folder, fileToken) {
  const files = await fs.readdir(folder);
  const found = files.find((file) => {
    return file.toLowerCase().includes(fileToken.toLowerCase()) && file.toLowerCase().endsWith(".html");
  });
  if (!found) throw new Error(`No HTML export found for ${fileToken}`);
  return path.join(folder, found);
}

async function updateEpisode(apiUrl, apiKey, episodeId, previewHtml, paidHtml) {
  const response = await fetch(`${apiUrl}/rest/v1/episodes?id=eq.${episodeId}`, {
    method: "PATCH",
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({
      preview_html: previewHtml,
      paid_html: paidHtml,
    }),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }
}

async function main() {
  const fileEnv = await readEnvFile(path.join(process.cwd(), "ENV.txt"));
  const apiUrl = requireEnv(
    "SUPABASE_URL",
    process.env.SUPABASE_URL || fileEnv.SUPABASE_URL || "https://setykcvlivqiuufjkjuu.supabase.co",
  );
  const apiKey = requireEnv(
    "SUPABASE_SECRET_KEY",
    process.env.SUPABASE_SECRET_KEY
      || process.env.SUPABASE_SERVICE_ROLE_KEY
      || defaultSecretKey(process.env.SUPABASE_SECRET_KEYS)
      || fileEnv.SUPABASE_SECRET_KEY
      || fileEnv.SUPABASE_SERVICE_ROLE_KEY
      || defaultSecretKey(fileEnv.SUPABASE_SECRET_KEYS),
  );
  const folder = path.join(process.cwd(), "BLACKWATER BAY_FINAL EPS");

  for (const episode of EPISODES) {
    const file = await findEpisodeFile(folder, episode.fileToken);
    const html = await fs.readFile(file, "utf8");
    const blocks = extractBlocks(extractPageBody(html));
    const { previewHtml, paidHtml } = splitEpisode(blocks, episode.breakText);

    await updateEpisode(apiUrl, apiKey, episode.id, previewHtml, paidHtml);
    console.log(`Imported ${episode.fileToken}: preview_blocks=${previewHtml.split("<p").length - 1}, paid_blocks=${paidHtml.split("<p").length - 1}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
