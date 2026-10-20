#!/bin/bash
# Assembles node_modules in an environment WITHOUT access to the npm registry (the build workspace of 19 Oct 2026).
# On a normal machine use `npm ci` instead; package.json pins the same versions.
# Sources: React 19.2.8, react-dom, scheduler, zod 3.25.76, esbuild, typescript and playwright from a preinstalled
# global node_modules; the libraries below from their official GitHub repositories at the release tags in package.json.
set -euo pipefail
G=${GLOBAL_NODE_MODULES:-/opt/npm-tools/node_modules}
S=${GITHUB_SOURCES:-/home/claude/build/js}
cd "$(dirname "$0")/.."
rm -rf node_modules && mkdir -p node_modules/@types node_modules/@tanstack node_modules/@remix-run node_modules/@hookform node_modules/.bin
for p in react react-dom scheduler zod esbuild typescript playwright playwright-core; do ln -s "$G/$p" "node_modules/$p"; done
ln -s "$G/@esbuild" node_modules/@esbuild
ln -s ../esbuild/bin/esbuild node_modules/.bin/esbuild
ln -s ../typescript/bin/tsc node_modules/.bin/tsc
pkg() { # pkg <dir> <name> <entry> [exports-json]
  mkdir -p "$1"
  printf '{"name":"%s","version":"0.0.0-github","type":"module","main":"%s","types":"%s"%s}\n' "$2" "$3" "$3" "${4:-}" > "$1/package.json"
}
cp -r "$S/query/packages/query-core/src" node_modules/@tanstack/query-core-src && mkdir -p node_modules/@tanstack/query-core && mv node_modules/@tanstack/query-core-src node_modules/@tanstack/query-core/src
pkg node_modules/@tanstack/query-core @tanstack/query-core src/index.ts
mkdir -p node_modules/@tanstack/react-query && cp -r "$S/query/packages/react-query/src" node_modules/@tanstack/react-query/src
pkg node_modules/@tanstack/react-query @tanstack/react-query src/index.ts
cp -r "$S/router/packages/router" node_modules/@remix-run/router && pkg node_modules/@remix-run/router @remix-run/router index.ts
cp -r "$S/router/packages/react-router" node_modules/react-router && pkg node_modules/react-router react-router index.ts
cp -r "$S/router/packages/react-router-dom" node_modules/react-router-dom && pkg node_modules/react-router-dom react-router-dom index.tsx
mkdir -p node_modules/react-hook-form && cp -r "$S/rhf/src" node_modules/react-hook-form/src && pkg node_modules/react-hook-form react-hook-form src/index.ts
mkdir -p node_modules/@hookform/resolvers && cp -r "$S/resolvers/src" node_modules/@hookform/resolvers/src && cp -r "$S/resolvers/zod" node_modules/@hookform/resolvers/zod
pkg node_modules/@hookform/resolvers @hookform/resolvers src/index.ts ',"exports":{".":"./src/index.ts","./zod":"./zod/src/index.ts"}'
cp -r "$S/dt/types/react" node_modules/@types/react && cp -r "$S/dt/types/react-dom" node_modules/@types/react-dom
cp -r "$S/csstype" node_modules/csstype
find node_modules -path '*/__tests__' -prune -exec rm -rf {} + 2>/dev/null || true
find node_modules -path '*/__typetest__' -prune -exec rm -rf {} + 2>/dev/null || true
# Published packages ship generated .d.ts files, not sources: generate them the same way so the app is type-checked
# against each library's declared API (the libraries' own sources are compiled by their projects, not by ours).
printf 'declare const process: { env: Record<string, string | undefined> };\n' > node_modules/.process-shim.d.ts
decl() { # decl <package dir> <entry>
  # tsc never emits for files inside node_modules, so compile a copy placed beside it (imports still resolve upward).
  local work=".decl-build/$(basename "$1")"
  rm -rf "$work" && mkdir -p "$work" && cp -r "$1"/. "$work"/ && cp node_modules/.process-shim.d.ts "$work/_process-shim.d.ts"
  node_modules/.bin/tsc --ignoreConfig "$work/$2" "$work/_process-shim.d.ts" --declaration --emitDeclarationOnly --skipLibCheck \
    --target ES2022 --module ESNext --moduleResolution bundler --jsx react-jsx --lib ES2022,DOM,DOM.Iterable \
    --strict false --esModuleInterop --outDir "$1/dist-types" --rootDir "$work" >/dev/null 2>&1 || true
  local dts="dist-types/${2%.*}.d.ts"
  [ -f "$1/$dts" ] || { echo "no declarations for $1"; exit 1; }
  node -e "const f='$1/package.json',p=require('./'+f);p.types='$dts';if(p.exports&&p.exports['.']){p.exports={'.':{types:'./$dts',default:p.exports['.']},...Object.fromEntries(Object.entries(p.exports).filter(([k])=>k!=='.'))}};require('fs').writeFileSync(f,JSON.stringify(p))"
}
decl node_modules/@tanstack/query-core src/index.ts
decl node_modules/@tanstack/react-query src/index.ts
decl node_modules/@remix-run/router index.ts
decl node_modules/react-router index.ts
decl node_modules/react-router-dom index.tsx
decl node_modules/react-hook-form src/index.ts
decl node_modules/@hookform/resolvers src/index.ts
node_modules/.bin/tsc --ignoreConfig .decl-build/resolvers/zod/src/index.ts .decl-build/resolvers/_process-shim.d.ts --declaration --emitDeclarationOnly \
  --skipLibCheck --target ES2022 --module ESNext --moduleResolution bundler --strict false --outDir node_modules/@hookform/resolvers/zod-types \
  --rootDir .decl-build/resolvers >/dev/null 2>&1 || true
rm -rf .decl-build
node -e "const f='node_modules/@hookform/resolvers/package.json',p=require('./'+f);p.exports['./zod']={types:'./zod-types/zod/src/index.d.ts',default:'./zod/src/index.ts'};require('fs').writeFileSync(f,JSON.stringify(p))"
echo "node_modules assembled"
