# AlphaMorph frontend archive

Source: https://alphamorph.si/
Captured: 2026-11-17T09:18:41.757559+00:00

## Start the local preview

Windows: install Python 3 if needed, then double-click `start-preview.bat`.
macOS/Linux: run `sh start-preview.sh`.
Open http://localhost:8080/ in a browser.

Or run this command from this extracted folder:

    python -m http.server 8080 --directory site

JavaScript modules and JSON requests require HTTP. Opening index.html by
double-clicking a file:// URL will not load all interactive features.

## Contents

- `original/`: downloaded original frontend bytes; original root-relative paths
  and backend connections are retained. Extensionless pages are saved as HTML.
- `site/`: portable local preview. Same design and scripts, with local paths
  and a read-only recorded-data adapter (`snapshot-mode.js`).
- `capture-manifest.json`: source URLs and SHA-256 hashes for original files.

The four independent pages are `index.html`, `rebus.html`, `thesis.html`, and
`changelog.html`. The homepage also contains Economy, Circuits, Benchmark,
League, strategy/composition inspectors, and the Live Log drawer.
REBUS includes all four datasets from its manifest: REBUS-001, REBUS-002,
REBUS-002B, and the explicitly labelled synthetic development fixture.
The 3D renderer, wallet library, styles, article illustrations, favicon,
Open Graph image, RSS feed, sitemap, and public site configuration are included.

## Snapshot scope

The preview includes 64 recorded public API responses, including
the captured brain state, visible strategy details, generations, recent trades,
tokens, economy, tournament, circuit state, benchmark, league lineage details,
and public live-trading logs. Responses were collected at different times and
do not form an atomic database backup. Numbers do not update.

The original backend, database, trading engine, AI inference service, wallet
authentication, private reports, and realtime event stream cannot be downloaded
as frontend source. Wallet actions are disabled in the preview. Historical
strategy IDs and dynamic detail endpoints outside the captured set display an
unavailable response. No replacement trading or market data was invented.
External research links and block explorer links still require internet access.

## Static hosting / GitHub Pages

Upload the CONTENTS of `site/` to the hosting root (including all subfolders).
No npm install, build step, or server-side dependency is needed for this
recorded-data preview. HTML paths are relative and work in a repository subpath.

For development against a real backend, use `original/` and provide the API
routes referenced by the scripts. Preserve the included original notices.

## Changes in the preview

- Root-relative asset/page links changed to portable relative paths.
- Extensionless page navigation changed to .html navigation.
- A small snapshot adapter and visible archive label added to each HTML page.
- API reads mapped to saved JSON; no realtime events fabricated.
- Wallet/write operations disabled in this local read-only preview.
- Original asset and script copies remain available in `original/`.

Validation: original-file hashes, static references, dataset manifest entries,
JSON parsing, JavaScript syntax, and snapshot adapter behavior were checked.
A full browser visual comparison was not completed in this environment.
