import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || '0.0.0.0';
const goalsApiOrigin = new URL(process.env.GOALS_API_ORIGIN || 'https://current.oladapodamiey.workers.dev').origin;
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function requestBody(req, maxBytes = 8192) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error('Request body is too large.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

http.createServer(async (req, res) => {
  const pathname = new URL(req.url || '/', 'http://localhost').pathname;
  if (pathname === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
    res.end('ok');
    return;
  }
  if (pathname === '/api/goals/nonce' || pathname === '/api/goals/access') {
    if (req.method !== 'POST') {
      json(res, 405, { error: 'Method not allowed.' });
      return;
    }
    try {
      const body = await requestBody(req);
      const upstream = await fetch(`${goalsApiOrigin}${pathname}`, {
        method: 'POST',
        headers: { 'content-type': req.headers['content-type'] || 'application/json', accept: 'application/json' },
        body,
        signal: AbortSignal.timeout(15000),
      });
      const responseBody = await upstream.text();
      res.writeHead(upstream.status, {
        'content-type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      });
      res.end(responseBody);
    } catch (error) {
      const status = error.message === 'Request body is too large.' ? 413 : 502;
      json(res, status, { error: status === 413 ? error.message : 'Savings goal service is temporarily unavailable.' });
    }
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
    'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' https://api.v3.aave.com https://open.er-api.com https://polygon-rpc.com https://polygon-bor-rpc.publicnode.com; img-src 'self' data:; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'; form-action 'self'",
    'cache-control': pathname === '/' || route === '/dashboard.html' ? 'no-cache' : 'public, max-age=300',
  });
  createReadStream(target).pipe(res);
}).listen(port, host, () => process.stdout.write(`Current Earn server listening on ${host}:${port}\n`));
