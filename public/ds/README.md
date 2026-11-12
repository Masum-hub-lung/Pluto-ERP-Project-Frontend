# public/ds/pluto · design-system assets

Fonts (`fonts/`) and the design tokens (`tokens.json`) of the Pluto design system. The token variables the app reads are in
`/lf-theme.css`.

The components themselves are source code now: `src/design/components.tsx` (React) and `src/design/pluto.css` (styles),
used through `ds()` in `src/ds.ts`. They were ported one-to-one from the old prebuilt bundle (UI redesign step 1, Nov 2026;
every component rendered identical HTML before the bundle was removed), including its Pluto-name and `Segmented`
`type="button"` patches. The CSS class prefix `lf-` is unchanged on purpose (decision C17).

The look is "A+ Paper Ledger" (owner's choice, 12 Nov 2026): navy brand `--brand`, gold `--gold`, paper sidebar in the light
theme (`src/app/shell.css`). Mock-ups: the "Pluto ERP Redesign" canvas on claude.ai.
