# @salpakan/web

The Salpakan Digital Arbiter's mobile-first PWA (React + Vite). See the
[repo root README](../../README.md) for the full project overview, architecture,
and setup instructions — this package just needs:

```bash
npm run dev:web    # from the repo root
```

It expects the API server (`packages/server`) running at `:4000` in dev (proxied
via `/api`, see `vite.config.ts`), or set `VITE_API_BASE_URL` to point elsewhere.
