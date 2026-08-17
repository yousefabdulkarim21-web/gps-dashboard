import { mkdir, readFile, writeFile } from 'node:fs/promises';

const [worker, html, css, app] = await Promise.all([
  readFile(new URL('../src/worker.js', import.meta.url), 'utf8'),
  readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../public/styles.css', import.meta.url), 'utf8'),
  readFile(new URL('../public/app.js', import.meta.url), 'utf8')
]);

const staticSource = `
const INDEX_HTML = ${JSON.stringify(html)};
const STYLES_CSS = ${JSON.stringify(css)};
const APP_JS = ${JSON.stringify(app)};
function serveStatic(pathname) {
  if (pathname === '/styles.css') return new Response(STYLES_CSS, { headers: { 'content-type': 'text/css; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
  if (pathname === '/app.js') return new Response(APP_JS, { headers: { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
  if (pathname === '/favicon.ico') return new Response(null, { status: 204 });
  return new Response(INDEX_HTML, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' } });
}
`;

const deployable = staticSource + worker.replace('return env.ASSETS.fetch(request);', 'return serveStatic(url.pathname);');
// Keep the upload payload ASCII-only so multipart transports cannot reinterpret
// Arabic UTF-8 bytes. JavaScript decodes these escapes back to the exact text.
const transportSafeDeployable = deployable.replace(/[^\x00-\x7F]/g, character =>
  `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`
);
await mkdir(new URL('../dist/', import.meta.url), { recursive: true });
await writeFile(new URL('../dist/worker.js', import.meta.url), transportSafeDeployable, 'ascii');
