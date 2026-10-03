from pathlib import Path

p=Path('server.js')
s=p.read_text(encoding='utf-8')
route=s.find("app.get('/api/character-catalog'")
if route < 0:
    raise SystemExit('character catalog route not found')
end=s.find("\n});", route)
if end < 0:
    raise SystemExit('character catalog route end not found')
block=s[route:end]

marker='CHARACTER_CATALOG_CANONICAL_V9'
if marker not in block:
    anchor="""        const rows = new Map();\n        const add = (u, anime, name, originalImg, source) => {\n            name = String(name || '').trim();\n            anime = String(anime || '').trim();\n            if (!name) return;"""
    repl="""        const rows = new Map();\n        // CHARACTER_CATALOG_CANONICAL_V9 — keep the public image catalogue character-only.\n        const isClearlyNonCharacterCatalogName = (value) => {\n            const raw = String(value || '').trim();\n            if (!raw) return true;\n            return /(?:\\bsquad|\\bparents|\\bmagic knights|\\bspirit guardians|\\bshining generals)$/i.test(raw)\n                || /['’]s\\s+gang$/i.test(raw);\n        };\n        const add = (u, anime, name, originalImg, source) => {\n            name = String(name || '').trim();\n            anime = String(anime || '').trim();\n            u = String(u || '').trim();\n            if (u === 'fate') u = 'fatestay';\n            if (u === 'soul') u = 'souleater';\n            if (!name || isClearlyNonCharacterCatalogName(name)) return;"""
    if anchor not in block:
        raise SystemExit('catalog add anchor not found')
    block=block.replace(anchor,repl,1)

    anchor2="            if (arcAnime) anime = arcAnime;"
    repl2="""            // Canonicalize aliases returned by older datasets/resolvers too.\n            if (u === 'fate') u = 'fatestay';\n            if (u === 'soul') u = 'souleater';\n            if (arcAnime) anime = arcAnime;"""
    if anchor2 not in block:
        raise SystemExit('catalog arcAnime anchor not found')
    block=block.replace(anchor2,repl2,1)
    s=s[:route]+block+s[end:]

p.write_text(s,encoding='utf-8')
print('v9 marker', marker in s)
print('fate canonical', "if (u === 'fate') u = 'fatestay';" in s[route:route+9000])
print('soul canonical', "if (u === 'soul') u = 'souleater';" in s[route:route+9000])
print('group filter', 'isClearlyNonCharacterCatalogName' in s[route:route+9000])
