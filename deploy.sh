#!/bin/bash
# Deploy pgtools to GitHub Pages
set -e
echo "Deploying to GitHub Pages..."
git checkout gh-pages
rm -rf *.html *.css *.js tools/
git checkout main -- public/
cp -r public/* .
rm -rf public
git add -A
git commit -m "Deploy: $(date -u +%Y-%m-%dT%H:%M:%SZ)" || echo "No changes to deploy"
git push origin gh-pages
git checkout main
echo "Deployed! Site: https://eliasyonovic.github.io/pgtools/"
