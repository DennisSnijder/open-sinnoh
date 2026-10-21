## What and why

<!-- What this changes, and why. Link the issue if there is one. For DS behaviour, cite the decomp by file and line. -->

## How I checked it

<!-- The real results. Delete the lines that don't apply. -->

- [ ] `pnpm check` passes
- [ ] ROM tests: `OPENSINNOH_NDS_ROM=... pnpm test` (or the files this touches)
- [ ] Browser specs this touches: `pnpm test:browser:changed`
- [ ] Played it in the browser (device and browser: )

## Checklist

- [ ] No ROM, nothing extracted or derived from one, and no screenshots of game content in the diff
- [ ] Importer output changed: `IMPORTER_VERSION` bumped
- [ ] Contract changed: `CONTRACTS_VERSION` bumped and a line in `docs/contracts.md`
- [ ] New runtime dependency: licence notice in `THIRD_PARTY_NOTICES.md`
