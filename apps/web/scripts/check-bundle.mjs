#!/usr/bin/env node
/**
 * Bundle budget for the board route.
 *
 * Turbopack (Next 16's default) no longer writes `app-build-manifest.json`, so
 * this reads the two manifests it does write:
 *
 *   .next/build-manifest.json                     — root JS shared by every page
 *   .next/server/app/b/[id]/page_client-reference-manifest.js
 *                                                 — route JS + CSS
 *
 * Polyfill bundles are excluded on purpose: they are `nomodule` files that a
 * modern phone or laptop never downloads, so counting them would hide a real
 * regression behind bytes nobody pays for.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const BUDGET_BYTES = 220_000;
const NEXT_DIR = ".next";
const ROUTE = "/b/[id]/page";

function fail(message) {
  console.error(`check-bundle: ${message}`);
  process.exit(1);
}

function readJson(path) {
  if (!existsSync(path)) fail(`missing ${path}. Run \`pnpm --filter web build\` first.`);
  return JSON.parse(readFileSync(path, "utf8"));
}

const buildManifest = readJson(join(NEXT_DIR, "build-manifest.json"));
const files = new Set(buildManifest.rootMainFiles ?? []);
let routeChunks = [];

const clientRef = join(NEXT_DIR, "server", "app", "b", "[id]", "page_client-reference-manifest.js");
if (existsSync(clientRef)) {
  const source = readFileSync(clientRef, "utf8");
  // The file is `globalThis.__RSC_MANIFEST["..."] = {...};`. Take the final
  // `= {` assignment, not the `{}` on the preamble line above it.
  const start = source.lastIndexOf("= {");
  const end = source.lastIndexOf("}");
  if (start === -1 || end === -1) fail(`could not parse ${clientRef}`);

  const manifest = JSON.parse(source.slice(start + 2, end + 1));
  for (const entry of Object.values(manifest.entryJSFiles ?? {})) {
    for (const chunk of entry) files.add(chunk);
  }
  for (const entry of Object.values(manifest.entryCSSFiles ?? {})) {
    for (const chunk of entry) {
      if (chunk.inlined) continue;
      files.add(chunk.path);
      routeChunks.push(chunk.path);
    }
  }
} else {
  // Fallback for a webpack build, which still ships the old manifest.
  const appManifestPath = join(NEXT_DIR, "app-build-manifest.json");
  if (!existsSync(appManifestPath)) fail(`no client-reference manifest and no ${appManifestPath}`);
  const appManifest = JSON.parse(readFileSync(appManifestPath, "utf8"));
  for (const chunk of appManifest.pages?.[ROUTE] ?? []) files.add(chunk);
}

const sizes = [...files].map((file) => {
  const path = join(NEXT_DIR, ...file.replace(/^\//, "").split("/"));
  if (!existsSync(path)) return { file, bytes: 0, missing: true };
  const raw = readFileSync(path);
  return {
    file: file.split("/").pop(),
    bytes: gzipSync(raw, { level: 9 }).length,
    css: file.endsWith(".css"),
    missing: false,
  };
});

const missing = sizes.filter((size) => size.missing);
if (missing.length > 0) {
  fail(`manifest references ${missing.length} file(s) that do not exist, e.g. ${missing[0].file}`);
}

const total = sizes.reduce((sum, size) => sum + size.bytes, 0);
const jsTotal = sizes.filter((size) => !size.css).reduce((sum, size) => sum + size.bytes, 0);
const cssTotal = total - jsTotal;

const kib = (bytes) => `${(bytes / 1024).toFixed(1)} KiB`;
const largest = [...sizes].sort((a, b) => b.bytes - a.bytes).slice(0, 5);

console.log(`Board route ${ROUTE}`);
console.log(`  JS    ${sizes.filter((size) => !size.css).length} files  ${kib(jsTotal)} gz`);
console.log(`  CSS   ${sizes.filter((size) => size.css).length} files  ${kib(cssTotal)} gz`);
console.log(`  Total ${sizes.length} files  ${kib(total)} gz  (budget ${kib(BUDGET_BYTES)})`);
console.log("  Largest:");
for (const size of largest) console.log(`    ${kib(size.bytes).padStart(9)}  ${size.file}`);

if (total > BUDGET_BYTES) {
  fail(`over budget by ${kib(total - BUDGET_BYTES)} (${total} > ${BUDGET_BYTES} bytes)`);
}

console.log("PASS");
