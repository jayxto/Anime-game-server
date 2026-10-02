from pathlib import Path
import re

p = Path('server.js')
s = p.read_text(encoding='utf-8')

# A fresh key namespace invalidates older transformation URLs that may have cached
# a normal portrait before the strict resolver existed.
s, nkey = re.subn(
    r"const persistKey = `\$\{animeName\}\|\$\{charName\}\|\$\{form\}`;",
    "const persistKey = `v2|${animeName}|${charName}|${form}`;",
    s,
    count=1,
)
if nkey != 1 and "const persistKey = `v2|${animeName}|${charName}|${form}`;" not in s:
    raise SystemExit('persistKey anchor not found')

marker = 'QAP_VERIFIED_TRANSFORM_IMAGES_V2'
if marker not in s:
    anchor = "async function fetchFandomTransformationImage(host, character, form) {"
    pos = s.find(anchor)
    if pos < 0:
        raise SystemExit('transformation resolver anchor not found')
    helper = r'''/* QAP_VERIFIED_TRANSFORM_IMAGES_V2
   Small visually-reviewed seed set for the most obvious/high-risk forms.
   The remote URL is only an import source: persistQapTransformImage copies the
   bytes into PostgreSQL under universe `_transform`, so game rendering does not
   depend on the hotlink after the first successful import. */
const QAP_VERIFIED_TRANSFORM_SOURCES_V2 = [
    {
        needs:['naruto','six paths','sage'],
        url:'https://img.lemino.docomo.ne.jp/cms/a04cecf/a04cecf_w1.jpg?auto=webp&quality=75&width=3840'
    },
    {
        needs:['naruto','sage mode'], forbids:['six paths','rikudo'],
        url:'https://static.deltiasgaming.com/2025/01/Naruto-Uzumaki.jpg'
    },
    {
        needs:['sasuke','susanoo'],
        url:'https://i.ytimg.com/vi/-PVBJ4mf-xo/maxresdefault.jpg'
    },
    {
        needs:['luffy','gear 5'],
        url:'https://s1.dmcdn.net/v/V9ncC1eoseQFOJQqb/x720'
    },
    {
        needs:['goku','ultra instinct'], forbids:['sign'],
        url:'https://fr.dragon-ball-official.com/dragonball/jp/news/2026/01/2785224.jpg?_=1790885400'
    },
    {
        needs:['ichigo','bankai'],
        url:'https://cdn2.fptshop.com.vn/unsafe/800x0/bankai_5_233785fa0d.png'
    }
];

function qapVerifiedTransformSource(animeName, charName, form) {
    const hay = normalizeImageKey([animeName, charName, form].filter(Boolean).join(' '));
    for (const row of QAP_VERIFIED_TRANSFORM_SOURCES_V2) {
        const ok = row.needs.every(x => hay.includes(normalizeImageKey(x)));
        const blocked = (row.forbids || []).some(x => hay.includes(normalizeImageKey(x)));
        if (ok && !blocked) return row.url;
    }
    return null;
}

async function persistQapTransformImage(persistKey, sourceUrl, status='transform-auto') {
    if (!persistKey || !sourceUrl) return null;
    try {
        const img = await simpleFetchImage(sourceUrl, 12000);
        if (!img) return null;
        const ok = await simpleStoreImage({u:'_transform', name:persistKey}, img, sourceUrl, status);
        if (!ok) return null;
        return simpleImageRoute('_transform', persistKey, Date.now());
    } catch (e) {
        console.warn('[transform image persist]', persistKey, e?.message || e);
        return null;
    }
}

'''
    s = s[:pos] + helper + s[pos:]

# The transformation page's main image is no longer trusted blindly. A direct
# page image must itself look form-specific in its URL; otherwise we continue to
# the stricter Fandom file search, which scores filenames using the form tokens.
old = """async function fetchFandomTransformationImage(host, character, form) {\n    const direct = await fetchFandomTransformationPageFast(host, form);\n    if (direct) return direct;\n    const stop = new Set(['mode','form','forme','anime','transformation','final','true','full','power','awakened','awakening']);\n    const toks = x => normalizeImageKey(String(x||'')).split(' ').filter(t => t.length > 2 && !stop.has(t));\n    const formTokens = toks(form), charTokens = toks(character);"""
new = """async function fetchFandomTransformationImage(host, character, form) {\n    const direct = await fetchFandomTransformationPageFast(host, form);\n    const stop = new Set(['mode','form','forme','anime','transformation','final','true','full','power','awakened','awakening']);\n    const toks = x => normalizeImageKey(String(x||'')).split(' ').filter(t => t.length > 2 && !stop.has(t));\n    const formTokens = toks(form), charTokens = toks(character);\n    if (direct) {\n        let directName = '';\n        try { directName = normalizeImageKey(decodeURIComponent(String(direct))); }\n        catch (_) { directName = normalizeImageKey(String(direct)); }\n        const distinctive = formTokens.filter(t => t.length >= 4);\n        if (distinctive.length && distinctive.some(t => directName.includes(t))) return direct;\n    }"""
if old in s:
    s = s.replace(old, new, 1)
elif 'const distinctive = formTokens.filter' not in s:
    raise SystemExit('direct transformation resolver block not found')

# Replace old URL-only cache behavior by:
# 1. trusting only the new v2 cache,
# 2. importing visually-reviewed seeds first,
# 3. importing resolver results to PostgreSQL bytes,
# 4. using an external URL only as a temporary last resort if copying fails.
block_re = re.compile(r"""\s*try \{\s*const saved = await getCachedCharacterImage\('_transform', persistKey\);\s*if \(saved\?\.imageUrl\) url = saved\.imageUrl;\s*\} catch \(_\) \{\}\s*if \(!url && host\) \{\s*try \{ url = await fetchFandomTransformationImage\(host, charName, form\); \} catch \(_\) \{\}\s*if \(url\) \{\s*try \{ await saveCachedCharacterImage\('_transform', persistKey, \{ imageUrl:url, sourceUrl:null, status:'ok' \}\); \} catch \(_\) \{\}\s*\}\s*// Aucun fallback vers le portrait normal du personnage\.\s*\}""", re.S)
replacement = r'''
                            try {
                                const saved = await getCachedCharacterImage('_transform', persistKey);
                                if (saved?.imageUrl) url = saved.imageUrl;
                            } catch (_) {}

                            // Hand-checked candidates win for the critical forms. They are copied
                            // into Postgres immediately; the external URL is only provenance.
                            if (!url) {
                                const verifiedSource = qapVerifiedTransformSource(animeName, charName, form);
                                if (verifiedSource) {
                                    url = await persistQapTransformImage(persistKey, verifiedSource, 'transform-verified');
                                }
                            }

                            if (!url && host) {
                                let candidate = null;
                                try { candidate = await fetchFandomTransformationImage(host, charName, form); } catch (_) {}
                                if (candidate) {
                                    url = await persistQapTransformImage(persistKey, candidate, 'transform-auto');
                                    // If the source rejects server-side copying, keep it as a temporary
                                    // display fallback but do not treat it as durable/verified cache.
                                    if (!url) url = candidate;
                                }
                                // Aucun fallback vers le portrait normal du personnage.
                            }'''
if 'transform-verified' not in s[s.find('const persistKey = `v2|'):s.find('const persistKey = `v2|') + 5000]:
    s, n = block_re.subn(replacement, s, count=1)
    if n != 1:
        raise SystemExit('QAP transform cache block not found')

p.write_text(s, encoding='utf-8')
print('v2 key:', 'const persistKey = `v2|' in s)
print('verified seed marker:', marker in s)
print('persistent transform import:', 'persistQapTransformImage(persistKey, candidate' in s)
print('strict direct candidate:', 'const distinctive = formTokens.filter' in s)
