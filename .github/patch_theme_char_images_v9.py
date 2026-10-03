from pathlib import Path

p=Path('server.js')
s=p.read_text(encoding='utf-8')
marker='THEME_CHAR_IMAGES_QAP_FILTER_V9'
if marker not in s:
    start=s.find('const THEME_CHAR_IMAGES = (() => {')
    end=s.find('\n})();', start)
    if start<0 or end<0:
        raise SystemExit('THEME_CHAR_IMAGES block not found')
    end += len('\n})();')
    old=s[start:end]
    new=r'''const THEME_CHAR_IMAGES = (() => {
    const out = {};
    const add = (universeKey, name, img) => {
        if (!universeKey || !name || !img) return;
        const key = normalizeImageKey(cleanImageCharacterName(name));
        if (!key) return;
        out[universeKey] = out[universeKey] || {};
        if (!out[universeKey][key]) out[universeKey][key] = img;
    };
    // THEME_CHAR_IMAGES_QAP_FILTER_V9
    // UI ranking themes sometimes use kind='chars' even when their rows are anime titles,
    // arcs or transformation labels. Keep this portrait cache strictly character-only.
    const nonCharacterThemeIds = new Set(['transformation','arc','isekai','shonen','anime']);
    for (const file of ['qap-themes.json', 'tierlist-themes.json']) {
        try {
            const themes = JSON.parse(fs.readFileSync(path.join(__dirname, file), 'utf8')).themes || [];
            for (const theme of themes) {
                if (theme.kind !== 'chars') continue;
                const themeId = String(theme.id || '').trim().toLowerCase();
                if (nonCharacterThemeIds.has(themeId)) continue;
                for (const item of (theme.items || [])) {
                    const explicitChar = String(item.char || item.character || '').trim();
                    if (String(item.media || '').trim().toLowerCase() === 'anime' && !explicitChar) continue;
                    const rawSub = String(item.sub || item.anime || '').trim();
                    const bits = rawSub.split('•').map(x => x.trim()).filter(Boolean);
                    const anime = String(item.anime || (bits.length > 1 ? bits[bits.length - 1] : rawSub) || '').trim();
                    const name = explicitChar || String(item.name || '').trim();
                    if (!name || !anime) continue;
                    if (normalizeImageKey(name) === normalizeImageKey(anime)) continue;
                    let u = null;
                    try { u = resolveImageUniverseKey(anime) || null; } catch (_) {}
                    if (!u && item.u) u = String(item.u).trim();
                    if (u === 'fate') u = 'fatestay';
                    if (u === 'soul') u = 'souleater';
                    if (!u) continue;
                    add(u, name, item.img);
                }
            }
        } catch (_) {}
    }
    return out;
})();'''
    s=s[:start]+new+s[end:]

p.write_text(s,encoding='utf-8')
print('marker',marker in s)
print('old unsafe qap theme loop remains in THEME block:', "const u = resolveImageUniverseKey(item.sub);\n                    add(u, item.name, item.img);" in s[s.find('const THEME_CHAR_IMAGES'):s.find('function staticCharImage')])
