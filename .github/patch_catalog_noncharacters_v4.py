from pathlib import Path

p=Path('server.js')
s=p.read_text(encoding='utf-8')
marker='CHARACTER_CATALOG_NONCHAR_THEME_FILTER_V4'
start=s.find("app.get('/api/character-catalog'")
if start<0: raise SystemExit('catalog route not found')
end=s.find('\napp.',start+30)
if end<0: end=min(len(s),start+100000)
block=s[start:end]

if marker not in block:
    needle="""                for (const theme of (parsed.themes || [])) {
                    if (theme.kind !== 'chars') continue;
                    for (const item of (theme.items || [])) {
"""
    repl="""                for (const theme of (parsed.themes || [])) {
                    if (theme.kind !== 'chars') continue;
                    // CHARACTER_CATALOG_NONCHAR_THEME_FILTER_V4
                    // Some ranking themes are typed `chars` for UI reuse although their items are
                    // arcs/anime/categories, not character portraits. Never feed them to the image catalogue.
                    const nonCharacterThemeIds = new Set(['arc','anime','shonen','isekai']);
                    if (nonCharacterThemeIds.has(String(theme.id || '').trim().toLowerCase())) continue;
                    for (const item of (theme.items || [])) {
"""
    if needle not in block:
        raise SystemExit('theme loop anchor not found')
    block=block.replace(needle,repl,1)
    s=s[:start]+block+s[end:]

p.write_text(s,encoding='utf-8')
print('noncharacter theme filter:',marker in s)
