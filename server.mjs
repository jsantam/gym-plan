// Local preview only. Not deployed - GitHub Pages serves the files directly.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, normalize, join } from 'node:path';

const TYPES = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css',
  '.json':'application/json', '.jpg':'image/jpeg', '.png':'image/png', '.webmanifest':'application/manifest+json' };
const ROOT = new URL('.', import.meta.url).pathname;

createServer(async (req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/, ''));
  try {
    const buf = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream',
      'cache-control': 'no-store' });
    res.end(buf);
  } catch { res.writeHead(404).end('not found'); }
}).listen(5180, () => console.log('http://localhost:5180'));
