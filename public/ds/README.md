# public/ds/pluto · prebuilt design system

`components/bundle.js` and `bundle.css` are the prebuilt Pluto design system (React components, loaded at runtime by `src/ds.ts`; typed there as `PlutoLibrary` and used through `ds()`). Fonts and `tokens.json` sit next to them; the token variables are in `/lf-theme.css`.

The bundle was built under the old product name. For the rename to Pluto (backlog P1.7-FE-02) it was patched by hand in three places, nothing else:

| Where in `bundle.js` | Was | Now |
|---|---|---|
| header comment `@ds-bundle` | `"namespace"` set to the old product name | `"namespace":"Pluto"` |
| last line (the global it publishes) | `window.<old name>=Object.assign(…)` | `window.Pluto=Object.assign(window.Pluto\|\|{},…)` |
| `Logo` component word | the old product name | `"Pluto"` |

If the bundle is ever rebuilt or replaced, repeat these patches (or build it with the Pluto names) and check that a case-insensitive search of `public/` for the old product name finds nothing.

The CSS class prefix `lf-` is unchanged on purpose (decision C17): it is invisible to users and goes away when the design system is rebuilt from source.
