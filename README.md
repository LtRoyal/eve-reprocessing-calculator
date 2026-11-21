# EVE Sell or Reprocess — GitHub Pages starter

This is a static website for GitHub Pages. It has inventory parsing, alphabetical SELL/REPROCESS/review lists, click-to-copy, progress checkboxes, CSV export, and Jita 4-4 buy-order lookup through EVE ESI.

## Important limitation

**This is not yet a fully automatic calculator.** The user must load a **verified item/material JSON file**; no recipes are included. It deliberately refuses to recommend reprocessing if recipes or buy orders are missing. A future version should bundle a versioned, verified EVE SDE dataset, include item portion sizes, validate batch rounding and material units, and handle ESI order pagination beyond 30 pages if necessary. Current calculation assumes supplied materials are per single item; do not use for ore/ice or other batch-based recipes without appropriate preprocessing.

### Static data JSON format

```json
{"items":[{"name":"Example Item","typeId":12345,"materials":[{"typeId":34,"quantity":100}]}]}
```

`typeId` is the EVE type ID. `materials` lists full-yield material quantities **per item**. Use a trusted EVE Static Data Export source and validate the item and material data; the example above is not a real item.

## Publish to GitHub Pages (no terminal required)

1. Create a **public** GitHub repository named `eve-reprocessing-calculator`.
2. Use **Add file → Upload files** to upload `index.html`, `app.js`, and this README into the repository root.
3. Commit the files.
4. Go to **Settings → Pages → Build and deployment**, select **Deploy from a branch**, branch **main**, folder **/(root)**, then save.
5. After deployment, open `https://YOUR-USERNAME.github.io/eve-reprocessing-calculator/` (replace YOUR-USERNAME).

GitHub Pages serves static files. ESI requests happen in the browser, so connectivity depends on the ESI endpoint's CORS policy and availability. If ESI cannot be accessed directly, a separate proxy/backend would be needed. The website cannot use a Janice appraisal URL to import data automatically.
