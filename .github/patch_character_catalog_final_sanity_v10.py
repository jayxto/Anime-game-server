from pathlib import Path

p=Path('server.js')
s=p.read_text(encoding='utf-8')
marker='CHARACTER_CATALOG_FINAL_SANITY_V10'
if marker not in s:
    old="""        const characters = [...rows.values()].map(x => ({ ...x, sources:[...x.sources].sort() }))
            .sort((a,b) => String(a.anime).localeCompare(String(b.anime), 'fr') || String(a.name).localeCompare(String(b.name), 'fr'));"""
    new="""        // CHARACTER_CATALOG_FINAL_SANITY_V10 — a portrait row without a resolved universe
        // is not a usable character row. This blocks anime titles, arcs and transformation labels
        // from leaking into the public character catalogue even if an upstream theme changes later.
        const characters = [...rows.values()]
            .filter(x => String(x?.u || '').trim())
            .map(x => ({ ...x, sources:[...x.sources].sort() }))
            .sort((a,b) => String(a.anime).localeCompare(String(b.anime), 'fr') || String(a.name).localeCompare(String(b.name), 'fr'));"""
    if old not in s:
        raise SystemExit('character catalogue final mapping anchor not found')
    s=s.replace(old,new,1)
p.write_text(s,encoding='utf-8')
print('final sanity marker',marker in s)
