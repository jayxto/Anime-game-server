from pathlib import Path

p=Path('server.js')
s=p.read_text(encoding='utf-8')

marker='CHARACTER_CATALOG_CLEANUP_V2'
if marker not in s:
    # Canonicalize two legacy universe ids that were creating duplicate/missing rows.
    needle="""            name = String(name || '').trim();
            anime = String(anime || '').trim();
            if (!name) return;
"""
    repl="""            name = String(name || '').trim();
            anime = String(anime || '').trim();
            if (!name) return;
            // CHARACTER_CATALOG_CLEANUP_V2 — normalize legacy universe ids before dedupe/image routing.
            if (u === 'fate') u = 'fatestay';
            if (u === 'soul') u = 'souleater';
"""
    if needle not in s:
        raise SystemExit('catalog add() anchor not found')
    s=s.replace(needle,repl,1)

old="""        for (const file of ['tierlist-themes.json', 'qap-themes.json']) {
            try {
                const parsed = JSON.parse(fs.readFileSync(path.join(__dirname, file), 'utf8'));
                for (const theme of (parsed.themes || [])) {
                    if (theme.kind !== 'chars') continue;
                    for (const item of (theme.items || [])) {
                        const anime = String(item.sub || theme.title || '').trim();
                        const u = resolveImageUniverseKey(anime);
                        add(u, anime, item.name, item.img || null, file.replace('.json',''));
                    }
                }
            } catch (_) {}
        }
"""
new="""        for (const file of ['tierlist-themes.json', 'qap-themes.json']) {
            try {
                const parsed = JSON.parse(fs.readFileSync(path.join(__dirname, file), 'utf8'));
                for (const theme of (parsed.themes || [])) {
                    if (theme.kind !== 'chars') continue;
                    for (const item of (theme.items || [])) {
                        // Themes also contain anime titles and transformation labels. Only feed real
                        // character rows to the character catalogue. For transformation themes,
                        // item.char is the base character and `sub` is usually "Character • Anime".
                        const rawSub = String(item.sub || item.anime || '').trim();
                        const bits = rawSub.split('•').map(x => x.trim()).filter(Boolean);
                        const anime = String(item.anime || (bits.length > 1 ? bits[bits.length - 1] : rawSub) || '').trim();
                        const explicitChar = String(item.char || item.character || '').trim();
                        const name = explicitChar || String(item.name || '').trim();
                        let u = null;
                        try { u = resolveImageUniverseKey(anime) || null; } catch (_) {}
                        if (!u && item.u) u = String(item.u).trim();
                        if (u === 'fate') u = 'fatestay';
                        if (u === 'soul') u = 'souleater';
                        // A theme item with no resolvable universe and no explicit character field is
                        // almost certainly an anime/category item, not a character portrait.
                        if (!u && !explicitChar) continue;
                        if (!u || !name) continue;
                        add(u, anime, name, item.img || null, file.replace('.json',''));
                    }
                }
            } catch (_) {}
        }
"""
if old in s:
    s=s.replace(old,new,1)
elif 'Themes also contain anime titles and transformation labels' not in s:
    raise SystemExit('theme catalogue block not found')

p.write_text(s,encoding='utf-8')
print('cleanup marker:', marker in s)
print('theme filter:', 'almost certainly an anime/category item' in s)
print('legacy aliases:', "u === 'fate'" in s and "u === 'soul'" in s)
