import { Hono } from 'hono'
import { jsx } from 'hono/jsx'
import { serve } from 'bun'
import path from 'path'


const transpiler = new Bun.Transpiler({ loader: 'ts' })


const Page = () => (
  <html lang="en">
    <head>
      <meta charSet="utf-8" />
      <meta name="viewport" content="width=device-width,initial-scale=1" />
      <title>AV Mini Synth (Registry)</title>
      <style>{`
:root{color-scheme:dark}
body{margin:0;font-family:system-ui,sans-serif;background:#0b0b0b;color:#eee}
.wrap{display:grid;grid-template-columns:1fr 340px;gap:16px;height:100vh}
canvas{width:100%;height:100%;display:block;background:#000}
.panel{padding:12px;overflow:auto;background:#121212;border-left:1px solid #222}
.row{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center;margin:8px 0}
input[type=range]{width:160px}
select,input,button{background:#1a1a1a;color:#eee;border:1px solid #2a2a2a;border-radius:8px;padding:6px}
.label{opacity:.8}
header{display:flex;align-items:center;gap:8px;position:sticky;top:0;background:#121212;padding:8px 0 12px}
header h2{margin:0;font-size:18px}
.spacer{flex:1}
.sec-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; }
`}</style>
    </head>
    <body>
      <div className="wrap">
        <canvas id="view" width="1280" height="720"></canvas>
        <div className="panel">
          <header>
            <h2>AV Mini Synth</h2>
            <span className="spacer" />
            <button id="start" type="button">Start</button>
          </header>
          <div className="row">
            <span className="label">Effect</span>
            <select id="effect"></select>
          </div>
          <form id="controls" className="panel"></form>
        </div>
      </div>
      <script type="module" src="/src/client.ts"></script>
    </body>
  </html>
)


const app = new Hono()


app.get('/', (c) => c.html(<Page />))

// Serve TypeScript from /src with extensionless + index resolution
app.get('/src/*', async (c) => {
  // 1) Parse & normalize
  const url = new URL(c.req.url);
  // e.g. "/src/effects/keyboardADSR/dsp/chain"
  const urlPath = decodeURI(url.pathname);

  const projectRoot = process.cwd();

  // IMPORTANT: remove leading slash so path.join doesn't drop projectRoot
  // urlPath is like "/src/..." -> relPath "src/..."
  const relPath = urlPath.replace(/^\/+/, '');           // "src/effects/..."
  const absBase = path.join(projectRoot, relPath);       // "<cwd>/src/effects/..."

  // Security: must live under <projectRoot>/src
  const normalized = path.normalize(absBase);
  const srcRoot = path.join(projectRoot, 'src') + path.sep; // ensure trailing sep
  if (!normalized.startsWith(srcRoot)) {
    return c.text('Forbidden', 403);
  }

  // 2) Candidate files
  const tryPaths = [
    normalized,                               // exact
    normalized + '.ts',                       // foo.ts
    normalized + '.tsx',                      // foo.tsx
    normalized + '.js',                       // (optional) foo.js
    path.join(normalized, 'index.ts'),        // foo/index.ts
    path.join(normalized, 'index.tsx'),       // foo/index.tsx
    path.join(normalized, 'index.js'),        // (optional) foo/index.js
  ];

  // 3) Tiny transpile cache (path -> {mtime, code})
  type CacheEntry = { mtimeMs: number; code: string };
  const cache: Map<string, CacheEntry> = (globalThis as any).__tsCache ?? new Map();
  (globalThis as any).__tsCache = cache;

  for (const p of tryPaths) {
    const f = Bun.file(p);
    if (!(await f.exists())) continue;

    const stat = await f.stat();
    const hit = cache.get(p);
    if (hit && hit.mtimeMs === stat.mtimeMs) {
      return c.newResponse(hit.code, 200, { 'content-type': 'application/javascript; charset=utf-8' });
    }

    let code: string;
    const src = await f.text();
    // Transpile only TS/TSX; pass-through JS
    if (p.endsWith('.ts') || p.endsWith('.tsx')) {
      code = transpiler.transformSync(src);
    } else {
      code = src;
    }
    cache.set(p, { mtimeMs: stat.mtimeMs, code });
    return c.newResponse(code, 200, { 'content-type': 'application/javascript; charset=utf-8' });
  }

  return c.text('Not found', 404);
});



serve({ fetch: app.fetch, port: 3000 })
console.log('http://localhost:3000')
