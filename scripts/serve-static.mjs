import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const mirror = process.env.STATIC_ROOT === 'dist-cn';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', mirror ? 'dist-cn' : 'public');
const port = Number(process.env.PORT || 4173);
const basePath = (process.env.SITE_BASE_PATH || '').replace(/\/$/, '');
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8',
  '.mjs':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8',
  '.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png'};
createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  let pathname = url.pathname;
  if (basePath) {
    if (pathname !== basePath && !pathname.startsWith(`${basePath}/`)) {
      response.writeHead(404); response.end('Not found'); return;
    }
    pathname = pathname.slice(basePath.length) || '/';
  }
  if (pathname === '/') pathname = '/index.html';
  if (mirror) {
    if (!path.posix.extname(pathname)) pathname = `${pathname.replace(/\/$/, '')}/index.html`;
  } else {
    if (pathname === '/daily-games') pathname = '/daily-games.html';
    if (pathname === '/advanced-guide') pathname = '/advanced-guide.html';
    if (/^\/game\/\d{10}$/.test(pathname)) pathname = '/game.html';
    if (/^\/player\/[^/]+$/.test(pathname)) pathname = '/player.html';
  }
  const file = path.resolve(root, `.${pathname}`);
  if (!file.startsWith(`${root}${path.sep}`)) {response.writeHead(403); response.end(); return;}
  try {const body = await readFile(file); response.writeHead(200, {'Content-Type':types[path.extname(file)] || 'application/octet-stream'}); response.end(body);}
  catch {response.writeHead(404); response.end('Not found');}
}).listen(port, '127.0.0.1', () => console.log(`Static preview at http://127.0.0.1:${port}/daily-games`));
