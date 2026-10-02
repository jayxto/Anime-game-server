from pathlib import Path
import re

p=Path('server.js')
s=p.read_text(encoding='utf-8')
original=s

# Replace simpleCatalogue() with a complete catalogue builder.
start=s.find('async function simpleCatalogue()')
if start < 0:
    raise SystemExit('simpleCatalogue() not found')
next_anchor=s.find('\nasync function simplePokeIndex()', start)
if next_anchor < 0:
    raise SystemExit('simplePokeIndex() anchor not found')

new_func=r'''async function simpleCatalogue() {
    const map = new Map();
    const add = (u, name, anime, img, source='jeu') => {
        name = cleanImageCharacterName(String(name || '').trim());
        anime = String(anime || '').trim();
        u = String(u || '').trim();
        if (!u && anime) {
            try { u = resolveImageUniverseKey(anime) || ''; } catch (_) {}
        }
        if (!u || !name) return;
        if (!anime) {
            try { anime = String((typeof ARC_UNIVERSE_ANIME !== 'undefined' && ARC_UNIVERSE_ANIME[u]) || u); }
            catch (_) { anime = u; }
        }
        const k = `${u}|${normalizeImageKey(name)}`;
        const cleanImg = String(img || '').trim();
        const old = map.get(k);
        if (old) {
            if (!old.img && cleanImg) old.img = cleanImg;
            if (!old.anime && anime) old.anime = anime;
            if (source && !old.sources.includes(source)) old.sources.push(source);
            return;
        }
        map.set(k,{u,name,anime,img:cleanImg,sources:[source]});
    };
    const addNames = (u, names, source) => {
        let anime='';
        try { anime=String((typeof ARC_UNIVERSE_ANIME !== 'undefined' && ARC_UNIVERSE_ANIME[u]) || u); } catch (_) { anime=String(u||''); }
        for (const raw of (Array.isArray(names) ? names : [])) {
            if (typeof raw === 'string') add(u,raw,anime,'',source);
            else if (raw && typeof raw === 'object') add(raw.u||u,raw.display||raw.name||raw.character||raw.speaker,raw.anime||anime,raw.img||raw.image||raw.imageUrl||'',source);
        }
    };
    const addCardish = (item, fallbackU='', source='cards') => {
        if (!item) return;
        if (typeof item === 'string') { if (fallbackU) add(fallbackU,item,'','',source); return; }
        if (Array.isArray(item)) { for (const x of item) addCardish(x,fallbackU,source); return; }
        if (typeof item !== 'object') return;
        const u=String(item.u||item.universe||item.universeKey||fallbackU||'').trim();
        const name=item.display||item.name||item.character||item.speaker||'';
        if (u && name) add(u,name,item.anime||item.sub||'',item.img||item.image||item.imageUrl||'',source);
        for (const key of ['cards','chars','characters','items','pool','list']) {
            if (Array.isArray(item[key])) addCardish(item[key],u||fallbackU,source);
        }
    };

    // Existing public catalogue (modes, DLE, Roland-Garros, themes, etc.).
    try {
        const r = await fetch(`http://127.0.0.1:${PORT}/api/character-catalog`, { headers:{Accept:'application/json'} });
        if (r.ok) {
            const d=await r.json();
            for (const raw of (d?.characters || d?.items || [])) {
                add(raw?.u, raw?.name || raw?.display, raw?.anime, raw?.originalImg || raw?.img || raw?.imageUrl, 'catalogue-api');
            }
        }
    } catch (_) {}

    // Direct game sources, so migration still works even if the HTTP catalogue is unavailable.
    try { for (const [u,b] of Object.entries(STATIC_CHAR_IMAGES || {})) for (const [name,img] of Object.entries(b||{})) add(u,name,'',img,'char-images'); } catch (_) {}
    try { for (const [u,names] of Object.entries(ARC_FAMOUS_OVERRIDE || {})) addNames(u,names,'modes'); } catch (_) {}
    try { for (const [u,names] of Object.entries(RG_POOLS_V2 || {})) addNames(u,names,'roland-garros'); } catch (_) {}
    try { for (const [u,names] of Object.entries(DLE_MASTER_NAMES || {})) addNames(u,names,'dle-master'); } catch (_) {}
    try { for (const [u,names] of Object.entries(DLE_TARGET_NAMES || {})) addNames(u,names,'dle-target'); } catch (_) {}
    try {
        for (const [u,def] of Object.entries(DLE_UNIVERSES || {})) {
            for (const c of (def?.characters || [])) add(u,c?.name,'',c?.img||c?.image||'','dle-base');
        }
    } catch (_) {}

    // Every card actually obtainable/displayed by the collection.
    try {
        if (typeof ARC_UNIVERSE_ANIME !== 'undefined' && typeof cardPool === 'function') {
            for (const [u,anime] of Object.entries(ARC_UNIVERSE_ANIME || {})) {
                let list=[];
                try { list=cardPool(u) || []; } catch (_) { list=[]; }
                for (const c of list) add(u,c?.display||c?.name||c?.raw,anime,c?.img||c?.image||'','cards');
                try {
                    if (typeof cardAllSpecials === 'function') {
                        for (const c of (cardAllSpecials(u)||[])) add(u,c?.display||c?.name,anime,c?.img||'','cards-special');
                    }
                } catch (_) {}
            }
        }
    } catch (_) {}

    // Event / seasonal cards that can sit outside the standard card pools.
    try { if (typeof hwCards === 'function') addCardish(hwCards(),'','cards-halloween'); } catch (_) {}
    try {
        if (typeof SEASON_CARDS !== 'undefined') {
            for (const [id,cfg] of Object.entries(SEASON_CARDS || {})) {
                addCardish(cfg,'',`cards-season:${id}`);
                try { if (typeof seasonChars === 'function') addCardish(seasonChars(id),'',`cards-season:${id}`); } catch (_) {}
            }
        }
    } catch (_) {}
    try { if (typeof BOSS_VILLAINS !== 'undefined') for (const [u,names] of Object.entries(BOSS_VILLAINS||{})) addNames(u,names,'boss'); } catch (_) {}
    try { if (typeof PM_POWER_OVERRIDES !== 'undefined') for (const [u,byName] of Object.entries(PM_POWER_OVERRIDES||{})) addNames(u,Object.keys(byName||{}),'power'); } catch (_) {}

    // Bonus card types already carry dedicated imagery, but cache their base character too.
    try { if (typeof ALT_ART_CARDS === 'function') for (const c of (ALT_ART_CARDS()||[])) if (c?.u && c?.name) add(c.u,c.name,c.anime,'','alt-art-base'); } catch (_) {}

    return [...map.values()].sort((a,b)=>String(a.anime).localeCompare(String(b.anime),'fr') || String(a.name).localeCompare(String(b.name),'fr'));
}'''

s=s[:start]+new_func+s[next_anchor:]

# Expose card pools in /api/character-catalog too.
marker="        const characters = [...rows.values()].map(x => ({ ...x, sources:[...x.sources].sort() }))"
if marker not in s:
    raise SystemExit('character catalog marker not found')
inject=r'''
        // IMAGE FULL COVERAGE V2 — collection/card pools are part of the master catalogue.
        try {
            if (typeof ARC_UNIVERSE_ANIME !== 'undefined' && typeof cardPool === 'function') {
                for (const [u, anime] of Object.entries(ARC_UNIVERSE_ANIME || {})) {
                    let list=[];
                    try { list=cardPool(u) || []; } catch (_) { list=[]; }
                    for (const c of list) add(u, anime, c?.display || c?.name || c?.raw, c?.img || c?.image || null, 'cards');
                    try {
                        if (typeof cardAllSpecials === 'function') {
                            for (const c of (cardAllSpecials(u) || [])) add(u, anime, c?.display || c?.name, c?.img || null, 'cards-special');
                        }
                    } catch (_) {}
                }
            }
        } catch (e) { console.warn('[character catalog cards]', e.message); }
        try {
            if (typeof hwCards === 'function') {
                for (const c of (hwCards() || [])) if (c?.u && (c?.display || c?.name)) {
                    add(c.u, (typeof ARC_UNIVERSE_ANIME !== 'undefined' && ARC_UNIVERSE_ANIME[c.u]) || c.anime || c.u, c.display || c.name, c.img || null, 'cards-halloween');
                }
            }
        } catch (_) {}
        try {
            if (typeof BOSS_VILLAINS !== 'undefined') for (const [u,names] of Object.entries(BOSS_VILLAINS || {})) {
                const anime=(typeof ARC_UNIVERSE_ANIME !== 'undefined' && ARC_UNIVERSE_ANIME[u]) || u;
                for (const name of (names || [])) add(u, anime, name, null, 'boss');
            }
        } catch (_) {}
        try {
            if (typeof PM_POWER_OVERRIDES !== 'undefined') for (const [u,byName] of Object.entries(PM_POWER_OVERRIDES || {})) {
                const anime=(typeof ARC_UNIVERSE_ANIME !== 'undefined' && ARC_UNIVERSE_ANIME[u]) || u;
                for (const name of Object.keys(byName || {})) add(u, anime, name, null, 'power');
            }
        } catch (_) {}

'''
s=s.replace(marker,inject+marker,1)

# Larger AniList bulk coverage and faster retries while gaps remain.
s=s.replace('for (let page=1; page<=4; page++) {','for (let page=1; page<=8; page++) {',1)
s=s.replace('}, 6 * 60 * 60 * 1000);','}, 60 * 60 * 1000);',1)

if 'IMAGE FULL COVERAGE V2' not in s:
    raise SystemExit('patch marker missing')
if s == original:
    raise SystemExit('server.js unchanged')
p.write_text(s,encoding='utf-8')
print('patched bytes',len(original),'->',len(s))
print('card coverage marker count',s.count('IMAGE FULL COVERAGE V2'))
