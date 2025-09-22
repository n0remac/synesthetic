# Synesthetic

## Demo  
[synesthetic.io](https://www.synesthetic.io)

A tiny audio-visual synth built with **Web Audio + OffscreenCanvas**, bundled by **Vite**, run with **Bun**.
Desktop = play with your QWERTY keyboard; Mobile = on-screen piano.

## Quick start

```bash
bun run dev         # Runs vite dev server
bun run build       # Builds production bundle to ./dist/
bun run preview     # Serves the site from ./dist locally
```

## Pages

* `index.html` — main synth
* `about.html` — info + favorite patches

## Production (static hosting)

* The build outputs to `dist/` (multi-page).
* Example Caddyfile:

```
www.synesthetic.io { redir https://synesthetic.io{uri} }

synesthetic.io {
  root * /var/www/synesthetic/current
  encode zstd gzip
  try_files {path} {path}.html /index.html
  file_server
}
```

## CI/CD (DigitalOcean)

The GitHub Action builds with Bun, rsyncs `dist/` to `/var/www/synesthetic/releases/$TS/`, and updates `current` symlink.

## Controls & tips

* Desktop: **A S D F G H J** (white) + **W E T Y U** (black).
* Mobile: bottom piano (multi-touch), plus an Audio Unlock button if needed.
* Envelopes are click-safe (min A/R, smooth ramps); visuals run in a worker.

---

Made with Bun v1.2.22 and Vite.
