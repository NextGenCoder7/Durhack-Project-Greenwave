// Zero-dependency static file server for offline use.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT) || 8080;
// Loopback only by default: on shared (hackathon) Wi-Fi nobody else can reach the repo.
// Set HOST=0.0.0.0 deliberately to present from another device.
const HOST = process.env.HOST || '127.0.0.1';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json' };

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path === '/') { res.writeHead(302, { Location: '/src/display/index.html' }); return res.end(); }
  if (path.includes('..')) { res.writeHead(400); return res.end('bad path'); }
  try {
    const body = await readFile(join(ROOT, normalize(path)));
    res.writeHead(200, { 'Content-Type': MIME[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404); res.end('not found');
  }
}).listen(PORT, HOST, () => console.log(`Greenwave: http://${HOST === '127.0.0.1' ? 'localhost' : HOST}:${PORT}/`));
