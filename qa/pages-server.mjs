/**
 * GitHub Pages 동작을 흉내내는 정적 서버 (검증용).
 * - 프로젝트 사이트이므로 /rafine-voca-app/ 하위에서 dist/ 를 서빙
 * - 루트('/') 요청은 /rafine-voca-app/ 로 302 (GitHub Pages 와 동일)
 * - 없는 경로는 dist/404.html 을 HTTP 404 로 응답 (GitHub Pages 와 동일)
 *
 * 실행: node qa/pages-server.mjs [port]
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.argv[2] ?? 4180);
const PREFIX = '/rafine-voca-app';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? '/').split('?')[0]);

  if (url === '/' || url === '') {
    res.writeHead(302, { Location: `${PREFIX}/` });
    return res.end();
  }

  if (!url.startsWith(PREFIX)) {
    res.writeHead(404, { 'content-type': MIME['.html'] });
    return res.end('Not Found');
  }

  let rel = url.slice(PREFIX.length);
  if (rel.endsWith('/')) rel += 'index.html';

  const file = path.join(ROOT, rel);
  if (file.startsWith(ROOT) && fs.existsSync(file) && fs.statSync(file).isFile()) {
    res.writeHead(200, {
      'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    return fs.createReadStream(file).pipe(res);
  }

  // SPA 딥링크: 404.html(= index.html) 을 404 상태로 응답
  const fallback = path.join(ROOT, '404.html');
  res.writeHead(404, { 'content-type': MIME['.html'], 'cache-control': 'no-cache' });
  return fs.createReadStream(fallback).pipe(res);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`pages-like server: http://127.0.0.1:${PORT}${PREFIX}/`);
});
