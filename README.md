# hulma-core

## What it is

hulma-core is the 3D library of hulma. It is plain TypeScript with no UI and no framework. The code follows
`STANDARD.md`.

## Requirements

Node 24. Run `nvm use` in this folder to pick it up from `.nvmrc`.

## First-time setup

1. Clone `hulma` and `hulma-core` as sibling folders.
2. Run `npm install` in `hulma`.
3. Run `npm install && npm run build:local` in `hulma-core`.

## Scripts

- `npm test` runs the unit tests with Vitest.
- `npm run typecheck` type-checks the sources with `tsc` and writes no files.
- `npm run check:dist` fails if `dist/` still contains the `@core/` alias.
- `npm run build` runs `npm run typecheck` first, then makes the production build (a minified `dist/index.js` and
  `dist/index.d.ts`), then runs `npm run check:dist`.
- `npm run copy` copies `package.json` and the current `dist/` into `../hulma/node_modules/hulma-core`.
- `npm run build:local` runs `npm run typecheck` first, then makes a readable build with source maps, then runs
  `npm run check:dist` and `npm run copy`.

## Working on hulma-core with hulma

Edit the code here, then run `npm run build:local`. It replaces `../hulma/node_modules/hulma-core`, and the running
hulma dev server rebuilds. hulma never installs hulma-core. Any `npm install` inside hulma removes the copy, so run
`npm run build:local` (or `npm run copy`) again afterwards.

The copy needs `../hulma/node_modules`, so run `npm install` in `../hulma` once before the first `build:local`.

## Production

Run `npm run build && npm run copy` here, then run `npm run build` in `../hulma`. Then run `npm run build:local` here
again, so `../hulma/node_modules/hulma-core` gets the readable copy back.
