// Construit public/cards.json : tous les persos d'Anime Game + les nouveaux animés,
// avec les mêmes raretés, raretés spéciales, cartes de saison et Duos.
// Usage : node tools/build-cards.js   (lit tools/images.json si présent)
const fs = require('fs');
const path = require('path');
const T = f => path.join(__dirname, f);

const pool = require(T('pool.json'));
const extra = require(T('extra.json'));
const added = require(T('new-animes.json'));
const halloween = require(T('halloween.json'));
const images = fs.existsSync(T('images.json')) ? require(T('images.json')) : {};

// même répartition que cardRarity() d'Anime Game
const rarityAt = (i, n) => { const f = i / Math.max(1, n); return f < 0.35 ? 'commune' : f < 0.65 ? 'rare' : f < 0.88 ? 'epique' : f < 0.97 ? 'legendaire' : 'mythique'; };

const animes = {};
for (const [u, v] of Object.entries(pool)) animes[u] = { name: v.anime, cards: v.cards.map(c => [c.n, c.r]) };
for (const [u, v] of Object.entries(added)) {
    if (animes[u]) continue;
    animes[u] = { name: v.anime, cards: v.chars.map((n, i) => [n, rarityAt(i, v.chars.length)]), added: true };
}

// raretés spéciales : top N persos (ordre de la liste = popularité)
const SPECIAL_TIERS = [
    { id: 'secrete', top: 3 }, { id: 'divine', top: 2 }, { id: 'cosmique', top: 1 },
    { id: 'eternelle', top: 1, animes: ['naruto', 'onepiece', 'dragonball', 'bleach', 'snk', 'jojo', 'hxh', 'demonslayer', 'jjk', 'fma'] },
    { id: 'omega', top: 1, animes: ['onepiece', 'naruto', 'dragonball'] }
];
const ICONS = { pokemon: ['Pikachu', 'Dracaufeu', 'Mewtwo'] };
for (const [u, a] of Object.entries(animes)) {
    const icons = ICONS[u] || a.cards.slice(0, 3).map(c => c[0]);
    a.specials = {};
    for (const t of SPECIAL_TIERS) if (!t.animes || t.animes.includes(u)) a.specials[t.id] = icons.slice(0, t.top);
}

const seasons = { halloween: { label: 'Halloween', chars: halloween } };
for (const [k, v] of Object.entries(extra.season)) seasons[k] = { label: v.label, from: v.from, to: v.to, chars: v.chars };

const duos = extra.duo.map(d => ({ name: d.name, anime: d.sub }));

// images : clé "u|nom" -> url
const img = {};
for (const [k, url] of Object.entries(images)) if (url) img[k] = url;
for (const [n, url] of Object.entries(extra.poke || {})) img['pokemon|' + n] = url;

const out = { v: 1, animes, seasons, duos, img };
fs.mkdirSync(path.join(__dirname, '..', 'public'), { recursive: true });
fs.writeFileSync(path.join(__dirname, '..', 'public', 'cards.json'), JSON.stringify(out));
const total = Object.values(animes).reduce((s, a) => s + a.cards.length, 0);
console.log(`${Object.keys(animes).length} animés, ${total} persos, ${Object.keys(img).length} images, ${duos.length} duos`);
