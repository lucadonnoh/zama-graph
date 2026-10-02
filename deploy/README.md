# Deployment

The UI is static and lives on GitHub Pages. The API and the indexer run on one
machine next to the SQLite file and are reached through a Cloudflare tunnel,
so the machine itself is never exposed.

```
<owner>.github.io/<repo>/  GitHub Pages     dist/web, built by .github/workflows/pages.yml
stillnot.slashveto.me      cloudflared  ->  127.0.0.1:3021  (zama-graph-serve)
                                            zama-graph-sync writes the same SQLite file
```

## Services

Sync and serve are separate units so that the sync failing (an RPC being
down) restarts only the sync and the API stays up. The sync derives bounds,
traces and the scoreboard every ten minutes; a run takes under a minute and
about 2 GB of memory at the current size.

```sh
pnpm install && pnpm build
pnpm sync                           # first time only, see below
cp deploy/zama-graph-*.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now zama-graph-sync zama-graph-serve
sudo loginctl enable-linger $USER   # keep them running without a login session
journalctl --user -u zama-graph-serve -f
```

On a fresh machine, build the database once before enabling the units:
`pnpm sync` indexes the full history and derives (about 20 minutes). The
sync unit derives every ten minutes from the start, so on an empty database
the API would serve numbers from partial history until it caught up.

`.env` needs, besides the RPC urls:

```
HOST=127.0.0.1
PORT=3021
CORS_ORIGIN=https://<owner>.github.io
```

The CORS origin is the scheme and host of the Pages site, without the
`/<repo>` path.

After pulling changes: `pnpm build && systemctl --user restart zama-graph-sync zama-graph-serve`.

## Cloudflare

- Tunnel public hostname `stillnot.slashveto.me` to `http://127.0.0.1:3021`.
- Cache rule: hostname equals `stillnot.slashveto.me` → eligible for cache,
  edge TTL "use cache-control header if present". The API sends `max-age` of 15 s (live)
  to an hour (ENS names).
- Rate limiting rule on the same hostname, per IP, e.g. 60 requests per 10 s.
  Every uncached request runs on the single SQLite connection.

## GitHub Pages

- Settings → Pages → Source: GitHub Actions. The workflow builds on every
  push to `main`.
- The UI calls `https://stillnot.slashveto.me` unless the repository variable
  `API_URL` says otherwise.
