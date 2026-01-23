// scripts/cache-stock-logos.mjs
// Node 18+ (global fetch)

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const ROOT = process.cwd();
const TOKEN_CONFIG_PATH = path.join(ROOT, "lib", "tokenConfig.ts");

// Output
const OUT_DIR = path.join(ROOT, "public", "logos");
const PUBLIC_PREFIX = "/logos";

function safeName(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function extFromContentType(ct) {
  if (!ct) return null;
  const x = ct.toLowerCase();
  if (x.includes("image/png")) return "png";
  if (x.includes("image/jpeg")) return "jpg";
  if (x.includes("image/webp")) return "webp";
  if (x.includes("image/svg+xml")) return "svg";
  if (x.includes("image/avif")) return "avif";
  return null;
}

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function shortHash(input) {
  return crypto
    .createHash("sha1")
    .update(String(input))
    .digest("hex")
    .slice(0, 8);
}

async function download(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const ct = res.headers.get("content-type") || "";
  const buf = Buffer.from(await res.arrayBuffer());
  return { buf, ct };
}

/**
 * Find `export const <NAME> = [` array block.
 * Returns: { start, end, text } or null if not found.
 */
function findArrayBlock(tsText, constName) {
  const anchorRe = new RegExp(
    `export\\s+const\\s+${constName}\\b[\\s\\S]*?=\\s*\\[`,
    "g",
  );
  const m = anchorRe.exec(tsText);
  if (!m) return null;

  // Position at the first '[' in the match
  const matchText = m[0];
  const start = m.index + matchText.lastIndexOf("[");
  let i = start;
  let depth = 0;
  let inStr = null; // "'" | '"' | "`"
  let escape = false;

  for (; i < tsText.length; i++) {
    const ch = tsText[i];

    if (inStr) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === inStr) inStr = null;
      continue;
    }

    if (ch === "'" || ch === '"' || ch === "`") {
      inStr = ch;
      continue;
    }

    if (ch === "[") depth++;
    if (ch === "]") {
      depth--;
      if (depth === 0) {
        let end = i + 1;
        while (end < tsText.length && /\s/.test(tsText[end])) end++;
        if (tsText[end] === ";") end++;
        return { start, end, text: tsText.slice(start, end) };
      }
    }
  }

  return null;
}

/**
 * Extract entries from TS chunk:
 * Matches `{ ... logo: "http..." ... }` object blocks.
 */
function extractLogoEntriesFromChunk(textChunk) {
  const re = /\{[\s\S]*?\blogo\s*:\s*["'](https?:\/\/[^"']+)["'][\s\S]*?\}/g;

  const symbolRe = /\bsymbol\s*:\s*["']([^"']+)["']/;
  const nameRe = /\bname\s*:\s*["']([^"']+)["']/;
  const mintRe = /\bmainnet\s*:\s*["']([^"']+)["']/; // TokenMeta.mints.mainnet

  const out = [];
  let m;
  while ((m = re.exec(textChunk))) {
    const block = m[0];
    const url = m[1];

    const symbol = symbolRe.exec(block)?.[1] ?? "";
    const name = nameRe.exec(block)?.[1] ?? "";
    const mint = mintRe.exec(block)?.[1] ?? "";

    out.push({ url, symbol, name, mint, block });
  }
  return out;
}

/**
 * Fallback: scan whole file for remote `logo: "https://..."` that look like stocks.
 * (In case you rename consts later.)
 */
function extractStocksFallback(tsText) {
  const re = /\{[\s\S]*?\blogo\s*:\s*["'](https?:\/\/[^"']+)["'][\s\S]*?\}/g;

  const isStockMarker = (block) =>
    /\bkind\s*:\s*["']stock["']/.test(block) ||
    /\bcategories\s*:\s*\[[\s\S]*?["']Stocks["'][\s\S]*?\]/.test(block);

  const symbolRe = /\bsymbol\s*:\s*["']([^"']+)["']/;
  const nameRe = /\bname\s*:\s*["']([^"']+)["']/;
  const mintRe = /\bmainnet\s*:\s*["']([^"']+)["']/;

  const out = [];
  let m;
  while ((m = re.exec(tsText))) {
    const block = m[0];
    if (!isStockMarker(block)) continue;

    const url = m[1];
    const symbol = symbolRe.exec(block)?.[1] ?? "";
    const name = nameRe.exec(block)?.[1] ?? "";
    const mint = mintRe.exec(block)?.[1] ?? "";

    out.push({ url, symbol, name, mint, block });
  }
  return out;
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });

  const original = await fs.readFile(TOKEN_CONFIG_PATH, "utf8");

  // ✅ Your tokenConfig uses STOCK_TOKENS
  const stocksBlock = findArrayBlock(original, "STOCK_TOKENS");

  let targetChunk = null;
  let chunkStart = null;
  let chunkEnd = null;
  let entries = [];

  if (stocksBlock) {
    targetChunk = stocksBlock.text;
    chunkStart = stocksBlock.start;
    chunkEnd = stocksBlock.end;
    entries = extractLogoEntriesFromChunk(targetChunk);
    console.log(
      `Found STOCK_TOKENS block and ${entries.length} remote logo entries inside it.`,
    );
  } else {
    entries = extractStocksFallback(original);
    console.log(
      `No export const STOCK_TOKENS found. Fallback matched ${entries.length} stock-like remote logo entries.`,
    );
  }

  if (!entries.length) {
    console.log("No stock remote logo URLs found to cache.");
    return;
  }

  const urlToLocal = new Map();
  let ok = 0;
  let fail = 0;

  for (const e of entries) {
    if (urlToLocal.has(e.url)) continue;

    const baseParts = [
      safeName(e.symbol),
      safeName(e.name),
      safeName(e.mint?.slice(0, 6)),
      shortHash(e.url),
    ].filter(Boolean);

    const base = baseParts.join("-") || `logo-${shortHash(e.url)}`;

    try {
      const candidateExts = ["png", "jpg", "webp", "svg", "avif"];
      let existing = null;
      for (const ext of candidateExts) {
        const p = path.join(OUT_DIR, `${base}.${ext}`);
        if (await exists(p)) {
          existing = p;
          break;
        }
      }

      if (existing) {
        const rel = `${PUBLIC_PREFIX}/${path.basename(existing)}`;
        urlToLocal.set(e.url, rel);
        ok++;
        continue;
      }

      const { buf, ct } = await download(e.url);
      const ext = extFromContentType(ct) || "png";

      const outPath = path.join(OUT_DIR, `${base}.${ext}`);
      await fs.writeFile(outPath, buf);

      const rel = `${PUBLIC_PREFIX}/${path.basename(outPath)}`;
      urlToLocal.set(e.url, rel);

      ok++;
      console.log(`✅ ${e.symbol || e.name || e.mint || e.url} -> ${rel}`);
    } catch (err) {
      fail++;
      console.log(
        `❌ ${e.symbol || e.name || e.mint || e.url} failed: ${err?.message || err}`,
      );
    }
  }

  // Rewrite tokenConfig.ts: replace exact remote logo URLs with local paths
  let rewritten = original;

  if (stocksBlock) {
    let chunkRewritten = targetChunk;
    for (const [url, local] of urlToLocal.entries()) {
      chunkRewritten = chunkRewritten.split(url).join(local);
    }
    rewritten =
      original.slice(0, chunkStart) + chunkRewritten + original.slice(chunkEnd);
  } else {
    for (const [url, local] of urlToLocal.entries()) {
      rewritten = rewritten.split(url).join(local);
    }
  }

  const backupPath = TOKEN_CONFIG_PATH.replace(
    /\.ts$/,
    `.backup-${Date.now()}.ts`,
  );
  await fs.writeFile(backupPath, original, "utf8");
  await fs.writeFile(TOKEN_CONFIG_PATH, rewritten, "utf8");

  console.log("\n---");
  console.log(`Downloads: ok=${ok}, fail=${fail}`);
  console.log(`Logos saved to: ${OUT_DIR}`);
  console.log(`Backup saved to: ${backupPath}`);
  console.log(`Updated: ${TOKEN_CONFIG_PATH}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
