"""Build a compact, versioned reprocessing lookup from Fuzzwork's EVE SDE CSV export."""
import csv, io, json, pathlib, urllib.request, datetime
BASE = 'https://www.fuzzwork.co.uk/dump/latest/'
def get_csv(name):
    req = urllib.request.Request(BASE + name, headers={'User-Agent':'EVE-Reprocessing-Calculator/1.0 (GitHub Pages)'})
    with urllib.request.urlopen(req, timeout=90) as response:
        content = response.read().decode('utf-8-sig')
    rows = list(csv.DictReader(io.StringIO(content)))
    if not rows: raise RuntimeError(f'No rows in {name}')
    return rows

def main():
    types = get_csv('invTypes.csv')
    mats = get_csv('invTypeMaterials.csv')
    names = {}
    for t in types:
        try:
            tid = int(t['typeID'])
            name = t['typeName'].strip()
            portion = int(t.get('portionSize') or 1)
            published = int(t.get('published') or 0)
            if name: names[tid] = {'name':name, 'portion':portion, 'published':published}
        except (KeyError,ValueError): continue
    recipes = {}
    for m in mats:
        try:
            tid, mid, qty = int(m['typeID']), int(m['materialTypeID']), int(m['quantity'])
            if qty > 0 and tid in names and mid in names:
                recipes.setdefault(tid,[]).append([mid,qty])
        except (KeyError,ValueError): continue
    # This calculator handles only items with one-unit reprocessing portions.
    # Other items must be reviewed to avoid wrong material rounding.
    items = {}
    for tid, t in names.items():
        if t['published'] and t['portion'] == 1 and tid in recipes:
            items[t['name'].casefold()] = {'name':t['name'],'id':tid,'materials':recipes[tid]}
    if len(items) < 1000: raise RuntimeError(f'Suspiciously small dataset: {len(items)} items')
    out = {'generated':datetime.datetime.now(datetime.timezone.utc).isoformat(), 'source':BASE,
           'portionSize':1, 'items':items}
    pathlib.Path('eve-data.json').write_text(json.dumps(out,separators=(',',':'),ensure_ascii=False),encoding='utf-8')
    print(f'Generated {len(items)} recipes')
if __name__ == '__main__': main()
