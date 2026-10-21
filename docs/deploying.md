# Deploying

The production build is a static site: `pnpm build` writes `dist/` (about 2 MB), and `pnpm preview` serves
it locally. It contains no game content; players import their own ROM in the browser. The landing page builds
separately with `pnpm site:build` (`site/dist`, see `site/README.md`).

**Vercel:** import the repository; `vercel.json` sets the pnpm install, the build, the `dist` output and cache
headers, and `package.json` pins Node 24. `.vercelignore` keeps ROMs and anything derived from them out of
CLI uploads (`vercel deploy` from a local folder).

**Error reports (optional).** Set these environment variables; without them the build sends nothing and makes
no source maps:

- `VITE_SENTRY_DSN`: the Sentry project's DSN (build time, ends up in the client bundle; a DSN is public).
- `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`: for source-map upload. Read at build time only, never
  shipped. With all three, the build makes hidden source maps, uploads them for the release and deletes them
  from `dist/`; with any missing, there are no maps and no upload.

The release is the commit (`VERCEL_GIT_COMMIT_SHA`), the environment Vercel's (`production`, `preview`).
Never commit any of these values.

Both builds ship `third-party-notices.txt`, a copy of [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).
