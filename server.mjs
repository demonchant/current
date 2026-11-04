import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || '0.0.0.0';
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

http.createServer((req, res) => {
  const pathname = new URL(req.url || '/', 'http://localhost').pathname;
  if (pathname === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
    res.end('ok');
    return;
  }
  let decodedPath;
  try { decodedPath = decodeURIComponent(pathname); }
  catch { res.writeHead(400); res.end('Bad request'); return; }
  const route = pathname === '/app' || pathname === '/app/' ? '/dashboard.html' : pathname;
  let target = route === '/' ? path.join(root, 'index.html') : path.resolve(root, `.${decodeURIComponent(route)}`);
  if (pathname !== '/' && !target.startsWith(root + path.sep)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  if (!existsSync(target) || !statSync(target).isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('Not found'); return;
  }
  res.writeHead(200, {
    'content-type': types[path.extname(target)] || 'application/octet-stream',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' https://api.v3.aave.com https://polygon-rpc.com https://polygon-bor-rpc.publicnode.com; img-src 'self' data:; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'; form-action 'self'",
    'cache-control': pathname === '/' || route === '/dashboard.html' ? 'no-cache' : 'public, max-age=300',
  });
  createReadStream(target).pipe(res);
}).listen(port, host, () => process.stdout.write(`Current Earn server listening on ${host}:${port}\n`));
