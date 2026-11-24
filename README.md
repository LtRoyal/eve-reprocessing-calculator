# Every Little Bit

**Make every little bit of ISK count.**

Every Little Bit is a free, browser-based **EVE Online sell-or-reprocess calculator**. Paste an inventory list and compare what its items are worth when sold directly against what their recoverable materials are worth at **Jita 4-4 buy orders**.

**Website:** https://ltroyal.github.io/every-little-bit/

## What it does

- Compares direct selling with reprocessing for eligible inventory items.
- Separates recommendations into **Better to SELL** and **Better to REPROCESS** lists, sorted alphabetically.
- Flags items without sufficient buy-order coverage separately instead of treating an uncertain value as a confirmed sale.
- Shows estimated ISK totals, alternative all-sell/all-reprocess scenarios, and the additional ISK identified by the recommendations.
- Provides a combined **Reprocessing Breakdown** of materials from items recommended for reprocessing.
- Supports searching results, copying lists and inventory, and exporting results as CSV.
- Creates shareable **frozen results snapshots**: recipients see the saved calculation rather than a fresh market-price lookup. Snapshots are stored temporarily through a Cloudflare Worker.

## How to use

1. Open [Every Little Bit](https://ltroyal.github.io/every-little-bit/).
2. Paste your inventory into the input area. An item name on its own is treated as quantity **1**; tab-separated inventory lines with quantities are also supported.
3. Review the **reprocessing yield** and **reprocessing tax** settings. The defaults are **55% yield** and **0% tax**.
4. Select **Calculate**.
5. Review the SELL and REPROCESS recommendations, the summary, and any items requiring additional attention.

Use **Share Results Snapshot** to share the saved result of a calculation. Snapshot prices do not update automatically; run a new calculation to use newer market information.

## Pricing and calculations

- Market comparisons use **buy orders at Jita 4-4**, not sell-order asking prices.
- Available buy-order volume matters: an order price is not assumed to apply to unlimited quantities.
- Reprocessing values are based on the recoverable materials and the configured yield and tax.
- Material quantities are rounded down to whole units.
- Items with unsupported or unavailable material data may not receive a reprocessing recommendation.

**Important:** These are estimates, not guaranteed sale proceeds. Buy orders can change or disappear, and the calculator does not include every possible cost or restriction (such as hauling, broker fees, sales tax, or item-specific reprocessing requirements). Double-check valuable items in-game before selling or reprocessing them.

## Data updates

The repository's GitHub Actions workflow, [Update EVE reprocessing data](.github/workflows/update-eve-data.yml), runs **daily at 11:30 UTC** and can also be started manually. It uses [`build_data.py`](build_data.py) to refresh [`eve-data.json`](eve-data.json) from EVE static data provided through Fuzzwork. The browser application obtains market buy-order information from CCP's ESI when calculating.

The workflow also runs when its configuration or the data-building script changes. A scheduled run does not guarantee the upstream data changed or that the run succeeded; check the [Actions tab](https://github.com/LtRoyal/every-little-bit/actions) for status.

## Repository files

| File | Purpose |
| --- | --- |
| `index.html` | Website layout and styling |
| `app.js` | Inventory processing, calculations, and sharing |
| `eve-data.json` | Generated item and reprocessing data |
| `build_data.py` | Data download and build script |
| `.github/workflows/update-eve-data.yml` | Automated data refresh |
| `*.png` | Site branding and interface images |

## Notes on snapshots

Short snapshot links use a Cloudflare Worker and temporary storage. They are intended for sharing results, not for permanent archiving. A frozen snapshot preserves the calculation at the time it was saved; it is **not** a live appraisal.

## Disclaimer

Every Little Bit is an independent community utility for EVE Online. EVE Online and related names and assets belong to their respective owners. This project is not affiliated with or endorsed by CCP Games.
