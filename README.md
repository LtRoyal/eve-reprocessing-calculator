# EVE Sell or Reprocess — GitHub Pages update

This version removes the manual JSON upload. It uses an automated GitHub Actions workflow to download the EVE static data CSVs from Fuzzwork, builds `eve-data.json`, and then the GitHub Pages browser app fetches Jita 4-4 buy orders from CCP ESI.

## Upload / enable

1. In your GitHub repository, upload/replace `index.html`, `app.js`, `build_data.py`, `README.md` in the **root**.
2. Create the folder `.github/workflows/` and put `update-eve-data.yml` there (GitHub's **Add file → Create new file** can create the path `.github/workflows/update-eve-data.yml`; paste the workflow file contents). Alternatively use GitHub's upload feature and drag the entire `.github` folder if your browser supports folder uploads.
3. Commit changes. In GitHub **Settings → Actions → General**, ensure workflow permissions allow **Read and write permissions** so the workflow can commit `eve-data.json`. You may need to enable Actions for the repository.
4. Open the repository's **Actions** tab → **Update EVE reprocessing data** → **Run workflow** → select `main` → **Run workflow**. The workflow also runs on pushes to `build_data.py` and weekly.
5. Wait for the workflow to finish successfully and for `eve-data.json` to appear in the repository root. Wait for GitHub Pages to deploy, then hard-refresh the site (Ctrl+Shift+R).
6. The page should show **Automatic EVE material data loaded**. Paste inventory and press **Calculate**.

If the workflow fails, open its run and send the **error text**. The website will display a missing-data message instead of inventing values.

## Supported inventory format

`125mm Railgun I<TAB>2<TAB>Hybrid Weapon` — first column is the exact item name, second column is the quantity, and subsequent category columns are ignored. A name on its own is quantity 1. A quantity-first tab-separated line also works.

## Calculation caveats

- Only **Jita 4-4 station** buy orders are included, including order-book depth, for the full item stack and all recovered materials.
- Default yield is **55%**, as requested; reprocessing tax is configurable. The material-unit calculation is rounded down for each material. The calculator does not account for hauling, broker fees, sales tax, or item-specific reprocessing restrictions.
- Only items with `portionSize=1` and a static `invTypeMaterials` recipe are eligible. Others go to **Needs review**. This is deliberately conservative; ore, ice and special batch-based items are not supported.
- This data source and material mapping have **not been validated against a real live EVE appraisal** in this environment. Test with a few low-value items before using the recommendations to melt valuable items. If CCP's ESI does not allow cross-origin browser requests, market lookups will show an error and require an alternative hosting/API arrangement.
- No Janice API key is used. ESI prices are subject to caching and rate limits.
