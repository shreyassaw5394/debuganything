#!/usr/bin/env bash
# Assemble the static site into _site/ (used by both GitHub Pages and Vercel).
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf _site && mkdir -p _site/docs
cp -r site/* _site/
# Erode (Indian Type Foundry, ITF Free Font License) may be self-hosted but not redistributed, so it is fetched
# from Fontshare at build time instead of living in this repository.
if [ ! -f _site/fonts/Erode-Variable.woff2 ]; then
  tmp="$(mktemp -d)"
  if curl -fsSL --max-time 60 -o "$tmp/erode.zip" "https://api.fontshare.com/v2/fonts/download/erode" \
     && unzip -q -o "$tmp/erode.zip" -d "$tmp"; then
    cp "$tmp"/Erode_Complete/Fonts/WEB/fonts/Erode-Variable.woff2 "$tmp"/Erode_Complete/Fonts/WEB/fonts/Erode-VariableItalic.woff2 _site/fonts/
  else
    echo "warning: could not fetch Erode; the site falls back to Georgia" >&2
  fi
  rm -rf "$tmp"
fi
cp -r docs/* _site/docs/
cp README.md _site/docs/README.md
cp docs/demo.mp4 _site/docs/demo.mp4 2>/dev/null || true
cp assets/debuganything-logo.png assets/debuganything-logo-light.png assets/debuganything-mark-512.png _site/ 2>/dev/null || true
{ cat site/llms.txt; echo; for f in README.md docs/installation.md docs/examples.md docs/real-world.md docs/workflows.md docs/proactive.md docs/cli.md docs/providers.md docs/safety.md; do echo; echo "----- $f -----"; echo; cat "$f"; done; } > _site/llms-full.txt
echo "site assembled in _site/ ($(find _site -type f | wc -l | tr -d ' ') files)"
