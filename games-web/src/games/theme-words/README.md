# Theme Words Authoring Flow

Default flow (now):

1. Sync reversed letter seed from Secret Words.
2. Generate themed rows (`letters`, `themeTitle`, `targetWords`).
3. Manually edit `themeSeed.generated.json` (or `dailySeed.json`) as you curate.
4. Reload app and review.

The crossword layout is generated live in the browser from the latest seed.
You do not need to rerun a layout script after each manual content edit.

## Step 1: Reverse Secret Words Seed

```bash
npm run theme-words:sync-letters
```

This generates:

- `src/games/theme-words/letterSeed.reversed.json`

Each row includes:

- `date`
- `letters`
- `words` (possible word combos from Secret Words seed, aligned to the reversed entry)

Rules:

- Uses Secret Words dates in range `2021-04-20` to `2046-04-20` (available source currently ends at `2046-04-18`).
- Reverses letter order across the range.
- Guarantees Theme Words letters are not the same as Secret Words letters on the same date.

## Step 2: Generate Theme Rows

```bash
npm run theme-words:generate-themes
```

This writes:

- `src/games/theme-words/themeSeed.generated.json`

## Runtime Seed

Theme Words runtime now reads themed seed data and computes placements on demand.

## Notes

- The live solver uses strict crossword-style fit checks with retry behavior.
- Layout is deterministic per date + word list.
- Manual edits to titles and words can be done incrementally without rerunning layout generation.
