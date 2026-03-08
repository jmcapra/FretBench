#!/usr/bin/env tsx

/**
 * FretBench Test Case Editor — local-only visual editor for test-cases JSON files.
 *
 * Usage:
 *   npx tsx tools/editor.ts                          # opens ./test-cases.json
 *   npx tsx tools/editor.ts --file my-cases.json     # opens a custom file
 *   npx tsx tools/editor.ts --port 4444              # custom port
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- CLI args ---
const args = process.argv.slice(2);
function flag(name: string, fallback: string): string {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const FILE_PATH = resolve(flag('file', './test-cases.json'));
const PORT = parseInt(flag('port', '3333'), 10);
const HTML_PATH = join(__dirname, 'editor.html');

// Ensure file exists (create empty array if not)
if (!existsSync(FILE_PATH)) {
  writeFileSync(FILE_PATH, '[\n]\n');
}

function readCases(): string {
  return readFileSync(FILE_PATH, 'utf-8');
}

function writeCases(json: string): void {
  // Validate JSON before writing
  JSON.parse(json);
  writeFileSync(FILE_PATH, json);
}

function serveHtml(_req: IncomingMessage, res: ServerResponse): void {
  const html = readFileSync(HTML_PATH, 'utf-8');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function body(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

const server = createServer(async (req, res) => {
  const url = req.url ?? '/';

  // CORS (not needed for same-origin but harmless)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    if (url === '/' && req.method === 'GET') {
      serveHtml(req, res);
    } else if (url === '/api/test-cases' && req.method === 'GET') {
      const data = readCases();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ file: FILE_PATH, cases: JSON.parse(data) }));
    } else if (url === '/api/test-cases' && req.method === 'PUT') {
      const raw = await body(req);
      const parsed = JSON.parse(raw);
      writeCases(JSON.stringify(parsed.cases, null, 2) + '\n');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, count: parsed.cases.length }));
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: msg }));
  }
});

server.listen(PORT, () => {
  console.log(`\n  FretBench Editor`);
  console.log(`  ────────────────`);
  console.log(`  File:  ${FILE_PATH}`);
  console.log(`  URL:   http://localhost:${PORT}\n`);
});
