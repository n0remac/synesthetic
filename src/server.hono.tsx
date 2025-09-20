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
  const url = new URL(c.req.url);
  const originalPath = decodeURI(url.pathname); // e.g. "/src/visuals/circleLine" or "/src/index"

  const projectRoot = process.cwd();

  // Build a filesystem path from the URL (we'll try extensions and index.*)
  const relPath = originalPath.replace(/^\/+/, '');     // "src/visuals/circleLine"
  const absBase  = path.join(projectRoot, relPath);     // "<cwd>/src/visuals/circleLine"
  const normalized = path.normalize(absBase);

  // Security: must be under "<cwd>/src/"
  const srcRoot = path.join(projectRoot, 'src') + path.sep;
  if (!normalized.startsWith(srcRoot)) {
    return c.text('Forbidden', 403);
  }

  // Candidate resolutions
  const candidates = [
    normalized,                                // exact
    normalized + '.ts',
    normalized + '.tsx',
    normalized + '.js',
    path.join(normalized, 'index.ts'),         // directory index
    path.join(normalized, 'index.tsx'),
    path.join(normalized, 'index.js'),
  ];

  // Transpile cache
  type CacheEntry = { mtimeMs: number; code: string };
  const cache: Map<string, CacheEntry> =
    ((globalThis as any).__tsCache ??= new Map<string, CacheEntry>());

  // Helper to serve file (TS/TSX transpiled)
  const serveFile = async (p: string) => {
    const f = Bun.file(p);
    const stat = await f.stat();
    const hit = cache.get(p);
    if (hit && hit.mtimeMs === stat.mtimeMs) {
      return c.newResponse(hit.code, 200, {
        'content-type': 'application/javascript; charset=utf-8',
        'cache-control': 'no-cache',
      });
    }
    const src = await f.text();
    const isTS = p.endsWith('.ts') || p.endsWith('.tsx');
    const code = isTS ? transpiler.transformSync(src) : src;
    cache.set(p, { mtimeMs: stat.mtimeMs, code });
    return c.newResponse(code, 200, {
      'content-type': 'application/javascript; charset=utf-8',
      'cache-control': 'no-cache',
    });
  };

  // Try to resolve a real file
  for (const p of candidates) {
    const f = Bun.file(p);
    if (!(await f.exists())) continue;

    const isIndexFile =
      p.endsWith(path.sep + 'index.ts') ||
      p.endsWith(path.sep + 'index.tsx') ||
      p.endsWith(path.sep + 'index.js');

    const incomingIsExplicitFile = /\.[tj]sx?$/.test(originalPath); // user asked for a file path
    const incomingLooksLikeDir   = !incomingIsExplicitFile;         // bare import / folder path

    if (isIndexFile && incomingLooksLikeDir) {
      // Serve a tiny re-export stub instead of redirecting.
      // Determine which index.* we actually found to point the stub there.
      const indexSuffix = p.slice(p.lastIndexOf('/index.')); // "index.ts" | "index.tsx" | "index.js"
      const targetUrl = originalPath.replace(/\/+$/, '') + '/' + indexSuffix; // "/src/dir/index.ts"

      const stub = `export * from '${targetUrl}';
export { default } from '${targetUrl}';`;

      return c.newResponse(stub, 200, {
        'content-type': 'application/javascript; charset=utf-8',
        'cache-control': 'no-cache',
      });
    }

    // Otherwise, just serve the actual file
    return await serveFile(p);
  }

  return c.text('Not found', 404);
});


serve({ fetch: app.fetch, port: 3000 })
console.log('http://localhost:3000')
