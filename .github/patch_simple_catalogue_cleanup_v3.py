from pathlib import Path

p=Path('server.js')
s=p.read_text(encoding='utf-8')
marker='SIMPLE_CATALOGUE_THEME_FILTER_V3'

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
                        // SIMPLE_CATALOGUE_THEME_FILTER_V3
                        // Theme files contain characters, anime titles and transformation labels.
                        // Only persist real character portraits. Transformation rows use item.char.
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
                        if (!u && !explicitChar) continue;
                        if (!u || !name) continue;
                        add(u, name, anime, item.img || null, file.replace('.json',''));
                    }
                }
            } catch (_) {}
        }
"""

if marker not in s:
    if old not in s:
        raise SystemExit('simpleCatalogue theme block not found')
    s=s.replace(old,new,1)

p.write_text(s,encoding='utf-8')
print('simple catalogue filter:', marker in s)
print('uses explicit character:', 'const explicitChar = String(item.char || item.character ||' in s)
