// Cherche une photo pour chaque perso sur AniList et l'écrit dans tools/images.json.
// Reprend là où il s'est arrêté. Usage : node tools/resolve-images.js
const fs = require('fs');
const path = require('path');
const T = f => path.join(__dirname, f);

const pool = require(T('pool.json'));
const added = require(T('new-animes.json'));
const OUT = T('images.json');
const images = fs.existsSync(OUT) ? require(OUT) : {};

// titres à chercher dans les œuvres du perso pour choisir le bon homonyme
const ALIAS = { snk: 'shingeki', sds: 'nanatsu', cote: 'youkoso', clover: 'black clover', fairy: 'fairy tail', fma: 'hagane', demonslayer: 'kimetsu', jjk: 'jujutsu', jojo: 'jojo', tensura: 'tensei shitara', opm: 'one punch', hxh: 'hunter', mha: 'boku no hero', hokuto: 'hokuto', saintseiya: 'saint seiya', spiritedaway: '', yourname: '', ranma: 'ranma', kenshin: 'rurouni', solo: 'solo leveling', mushoku: 'mushoku', rezero: 're:zero', hellsparadise: 'jigokuraku', tokyorevengers: 'tokyo revengers', chainsaw: 'chainsaw' };
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

const todo = [];
for (const [u, v] of Object.entries(pool)) if (u !== 'pokemon') for (const c of v.cards) todo.push({ u, anime: v.anime, name: c.n, raw: c.raw || c.n });
for (const [u, v] of Object.entries(added)) for (const n of v.chars) todo.push({ u, anime: v.anime, name: n, raw: n });
const left = todo.filter(t => !images[t.u + '|' + t.name] && !(process.argv[2] === 'new' && (t.u + '|' + t.name) in images));
console.log(`${todo.length} persos, ${left.length} à chercher`);

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function batch(items) {
    const q = items.map((t, i) => `c${i}: Page(perPage: 6) { characters(search: ${JSON.stringify(t.raw.normalize("NFD").replace(/[\u0300-\u036f]/g, ""))}) { name { full native alternative } image { large } media(perPage: 6) { nodes { title { romaji english } } } } }`).join('\n');
    for (let tryN = 0; tryN < 6; tryN++) {
        const r = await fetch('https://graphql.anilist.co', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ query: `{${q}}` }) });
        if (r.status === 429) { const w = +(r.headers.get('retry-after') || 30); console.log('429, attente', w); await sleep((w + 1) * 1000); continue; }
        const j = await r.json().catch(() => null);
        if (!j || !j.data) { await sleep(5000); continue; }
        return items.map((t, i) => {
            const list = ((j.data['c' + i] || {}).characters || []).filter(c => c.image && c.image.large && !/default\.jpg/.test(c.image.large));
            const want = [norm(ALIAS[t.u] ?? t.anime), ...norm(t.anime).split(' ').filter(w => w.length > 3)].filter(Boolean);
            const score = c => {
                const titles = c.media.nodes.map(m => norm((m.title.romaji || '') + ' ' + (m.title.english || ''))).join(' | ');
                return (want[0] && titles.includes(want[0]) ? 10 : 0) + want.slice(1).filter(w => titles.includes(w)).length;
            };
            const best = list.map(c => [score(c), c]).sort((a, b) => b[0] - a[0])[0];
            return best && best[0] > 0 ? best[1].image.large : null;
        });
    }
    return items.map(() => undefined);
}

(async () => {
    const N = 12;
    for (let i = 0; i < left.length; i += N) {
        const part = left.slice(i, i + N);
        const res = await batch(part);
        part.forEach((t, k) => { if (res[k] !== undefined) images[t.u + '|' + t.name] = res[k]; });
        fs.writeFileSync(OUT, JSON.stringify(images));
        if (i % (N * 20) === 0) console.log(i + part.length, '/', left.length, 'trouvées :', Object.values(images).filter(Boolean).length);
        await sleep(2100);
    }
    console.log('fini, trouvées :', Object.values(images).filter(Boolean).length, '/', Object.keys(images).length);
})();
