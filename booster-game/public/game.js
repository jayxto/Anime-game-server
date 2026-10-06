/* Anime Boosters — ouverture de boosters, même système de packs qu'Anime Game. */
(() => {
'use strict';

const RAR = ['commune', 'rare', 'epique', 'legendaire', 'mythique', 'secrete', 'divine', 'cosmique', 'eternelle', 'omega'];
const RAR_LABEL = { commune: 'Commune', rare: 'Rare', epique: 'Épique', legendaire: 'Légendaire', mythique: 'Mythique', secrete: 'Secrète', divine: 'Divine', cosmique: 'Cosmique', eternelle: 'Éternelle', omega: 'Oméga', saison: 'Saison', duo: 'Duo' };
const RANK = Object.fromEntries(RAR.map((r, i) => [r, i]));
RANK.saison = 5; RANK.duo = 5;
// raretés spéciales : versions à part des persos les plus iconiques (chance par carte)
const SPECIAL_TIERS = [
    { id: 'secrete', rate: 1 / 150, coins: 50 }, { id: 'divine', rate: 1 / 600, coins: 150 },
    { id: 'cosmique', rate: 1 / 2500, coins: 400 }, { id: 'eternelle', rate: 1 / 10000, coins: 1000 },
    { id: 'omega', rate: 1 / 50000, coins: 3000 }
];
const FINISHES = [ // de la plus rare à la plus courante
    { id: 'numbered', label: 'Numérotée', rate: 1 / 2000 }, { id: 'signed', label: 'Signée', rate: 1 / 1000 },
    { id: 'glitch', label: 'Glitch', rate: 1 / 500 }, { id: 'galaxy', label: 'Galaxie', rate: 1 / 400 },
    { id: 'manga', label: 'Manga', rate: 1 / 300 }, { id: 'fullart', label: 'Full Art', rate: 1 / 250 },
    { id: 'dark', label: 'Dark', rate: 1 / 200 }, { id: 'gold', label: 'Gold', rate: 1 / 150 },
    { id: 'glitter', label: 'Pailletée', rate: 1 / 40 }, { id: 'reverse', label: 'Reverse Holo', rate: 1 / 30 },
    { id: 'holo', label: 'Holographique', rate: 1 / 20 }
];
const FIN_IDX = Object.fromEntries(FINISHES.map((f, i) => [f.id, i]));
const GOD_PACK_RATE = 1 / 500, DUO_RATE = 1 / 300, SEASON_RATE = 1 / 150, SHINY_RATE = 1 / 10;
const FREE_EVERY = 2 * 3600e3;
const SEASON_EMO = { halloween: '🎃', noel: '🎄', valentin: '💘', ete: '🏖️' };

const PACKS = [
    { id: 'b3', n: 3, price: 150, emo: '🃏', name: 'Booster 3 cartes', desc: 'Le booster de base.', art: ['naruto', 0] },
    { id: 'b10', n: 10, price: 450, emo: '🎴', name: 'Booster 10 cartes', desc: '1 rare minimum.', art: ['onepiece', 0] },
    { id: 'epique', n: 5, price: 700, emo: '💜', name: 'Booster Épique', desc: '5 cartes, 1 épique min., raretés spéciales x2.', type: 'epique', art: ['jjk', 0] },
    { id: 'mythique', n: 5, price: 1800, emo: '🌈', name: 'Booster Mythique', desc: '5 cartes, 1 légendaire min., raretés spéciales x4.', type: 'mythique', art: ['dragonball', 0] },
    { id: 'duo', n: 4, price: 1200, emo: '🤝', name: 'Booster Duo', desc: '4 cartes dont 1 carte Duo garantie.', type: 'duo', art: ['demonslayer', 0] },
    { id: 'halloween', n: 5, price: 900, emo: '🎃', name: 'Booster Halloween', desc: '5 cartes, 1 carte Halloween garantie.', type: 'season', season: 'halloween', art: ['deathnote', 1] },
    { id: 'noel', n: 5, price: 900, emo: '🎄', name: 'Booster Noël', desc: '5 cartes, 1 carte Noël garantie.', type: 'season', season: 'noel', art: ['onepiece', 5] },
    { id: 'valentin', n: 5, price: 900, emo: '💘', name: 'Booster Saint-Valentin', desc: '5 cartes, 1 carte Valentin garantie.', type: 'season', season: 'valentin', art: ['naruto', 5] },
    { id: 'ete', n: 5, price: 900, emo: '🏖️', name: 'Booster Été', desc: '5 cartes, 1 carte Été garantie.', type: 'season', season: 'ete', art: ['onepiece', 1] },
    { id: 'chance', n: 10, price: 10000, emo: '👑', name: 'Pack Chance', desc: '10 cartes, chance x10 sur tout.', type: 'chance', art: ['jojo', 0] }
];
const ANIME_PACK_PRICE = 400;

let D = null, S = null, lastPack = null;
const $ = s => document.querySelector(s);
const rnd = n => Math.floor(Math.random() * n);
const pick = a => a[rnd(a.length)];
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => n.toLocaleString('fr-FR');

/* ---------- sauvegarde ---------- */
const SAVE_KEY = 'anime-boosters-v1';
const fresh = () => ({ coins: 2000, cards: {}, opened: 0, pulled: 0, best: {}, lastFree: 0, lastDaily: '', streak: 0, god: 0 });
function load() { try { S = Object.assign(fresh(), JSON.parse(localStorage.getItem(SAVE_KEY)) || {}); } catch (_) { S = fresh(); } }
function save() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch (_) {} renderCoins(); }

/* ---------- données ---------- */
const imgOf = (u, n) => D.img[u + '|' + n] || null;
const universes = () => Object.keys(D.animes);
function seasonActive(id) {
    const s = D.seasons[id]; if (!s) return false;
    if (id === 'halloween') return new Date().getMonth() === 9;
    if (!s.from) return false;
    const d = new Date(), v = d.getMonth() * 100 + d.getDate(), a = s.from[0] * 100 + s.from[1], b = s.to[0] * 100 + s.to[1];
    return a <= b ? v >= a && v <= b : v >= a || v <= b;
}
const seasonChars = id => (D.seasons[id].chars || []).filter(([u, n]) => D.animes[u] && D.animes[u].cards.some(c => c[0] === n));

/* ---------- tirage ---------- */
function rollFinish(luck) { for (const f of FINISHES) if (Math.random() < Math.min(0.5, f.rate * luck)) return f.id; return null; }
function award(c, luck) {
    c.finish = rollFinish(luck);
    const o = S.cards[c.key];
    c.isNew = !o;
    if (o) { o.n++; if (c.shiny) o.shiny++; if (c.finish && (!o.fin || FIN_IDX[c.finish] < FIN_IDX[o.fin])) o.fin = c.finish; }
    else S.cards[c.key] = { n: 1, shiny: c.shiny ? 1 : 0, fin: c.finish || null };
    c.coins = 0;
    if (!c.isNew) {
        const sp = SPECIAL_TIERS.find(t => t.id === c.rarity);
        c.coins = sp ? sp.coins : c.rarity === 'duo' ? 60 : c.rarity === 'saison' ? 50 : (c.shiny ? 10 : 2) * (c.rarity === 'mythique' ? 3 : 1);
        S.coins += c.coins;
    }
    S.pulled++;
    if (!S.best[c.rarity]) S.best[c.rarity] = 0;
    S.best[c.rarity]++;
    return c;
}
const baseCard = (u, i, shiny) => { const [n, r] = D.animes[u].cards[i]; return { key: u + '|' + n, u, name: n, anime: D.animes[u].name, rarity: r, shiny }; };
const specialCard = (u, n, tier, shiny) => ({ key: u + '|' + n + '|' + tier, u, name: n, anime: D.animes[u].name, rarity: tier, shiny });
const seasonCard = (id, u, n, shiny) => ({ key: 'saison:' + id + '|' + u + '|' + n, u, name: n, anime: D.animes[u].name, rarity: 'saison', season: id, shiny });
function duoCard(shiny) {
    const d = pick(D.duos);
    return { key: 'duo|' + d.name, name: d.name, anime: d.anime, rarity: 'duo', duo: duoImgs(d), shiny };
}
function duoImgs(d) {
    const [a, b] = d.name.split(/\s*&\s*/);
    const find = n => { for (const u of universes()) { const c = D.animes[u].cards.find(c => c[0] === n || c[0].split(' ')[0] === n); if (c) return imgOf(u, c[0]); } return null; };
    return [find(a), find(b || '')];
}
function randomOfRarity(rar) {
    const us = universes();
    for (let t = 0; t < 40; t++) {
        const u = pick(us), a = D.animes[u];
        if (SPECIAL_TIERS.some(x => x.id === rar)) { const l = a.specials[rar]; if (l && l.length) return specialCard(u, pick(l), rar, Math.random() < 0.3); continue; }
        const idx = a.cards.map((c, i) => c[1] === rar ? i : -1).filter(i => i >= 0);
        if (idx.length) return baseCard(u, pick(idx), Math.random() < 0.3);
    }
    return null;
}

function openPack(p) {
    const luck = p.type === 'chance' ? 10 : 1;
    const n = p.n;
    // God Pack : que des cartes très rares
    if (n >= 3 && Math.random() < Math.min(0.2, GOD_PACK_RATE * luck)) {
        const out = [];
        for (let i = 0; i < n; i++) {
            const r = Math.random(), rar = r < 0.02 ? 'cosmique' : r < 0.06 ? 'divine' : r < 0.3 ? 'secrete' : r < 0.6 ? 'mythique' : 'legendaire';
            const c = randomOfRarity(rar); if (c) out.push(award(c, luck));
        }
        S.god++;
        out.god = true;
        return out;
    }
    const us = p.anime ? [p.anime] : universes();
    const mult = (p.type === 'mythique' ? 4 : p.type === 'epique' ? 2 : 1) * luck;
    const minRank = p.type === 'mythique' ? 3 : p.type === 'epique' || p.anime ? 2 : n >= 10 ? 1 : 0;
    const out = [];
    for (let i = 0; i < n; i++) {
        const u = pick(us), a = D.animes[u], last = i === n - 1;
        // garanties de packs spéciaux sur la dernière carte
        if (last && p.type === 'duo' && !out.some(c => c.rarity === 'duo')) { out.push(award(duoCard(Math.random() < SHINY_RATE), luck)); continue; }
        if (last && p.type === 'season' && !out.some(c => c.season === p.season)) {
            const l = seasonChars(p.season);
            if (l.length) { const [su, sn] = pick(l); out.push(award(seasonCard(p.season, su, sn, Math.random() < 0.2), luck)); continue; }
        }
        let special = null;
        for (const t of SPECIAL_TIERS.slice().reverse()) {
            if (Math.random() >= t.rate * mult) continue;
            const cands = (p.anime ? [u] : us).filter(x => (D.animes[x].specials[t.id] || []).length);
            if (!cands.length) continue;
            const cu = cands.includes(u) ? u : pick(cands);
            special = specialCard(cu, pick(D.animes[cu].specials[t.id]), t.id, Math.random() < Math.min(0.9, luck / 10));
            break;
        }
        if (special) { out.push(award(special, luck)); continue; }
        if (!p.anime && Math.random() < Math.min(0.3, DUO_RATE * luck) && D.duos.length) { out.push(award(duoCard(Math.random() < SHINY_RATE), luck)); continue; }
        const act = Object.keys(D.seasons).filter(id => seasonActive(id) && seasonChars(id).length);
        if (!p.anime && act.length && Math.random() < Math.min(0.3, SEASON_RATE * luck)) {
            const id = pick(act), [su, sn] = pick(seasonChars(id));
            out.push(award(seasonCard(id, su, sn, Math.random() < Math.min(0.9, luck / 10)), luck)); continue;
        }
        // les persos connus tombent plus souvent, les rares moins (la chance rapproche des cartes rares)
        const L = a.cards.length;
        let idx = Math.min(L - 1, Math.floor(Math.pow(Math.random(), 1.6 / Math.sqrt(luck)) * L));
        if (last && minRank && !out.some(c => (RANK[c.rarity] || 0) >= minRank)) {
            const ok = a.cards.map((c, j) => RANK[c[1]] >= minRank ? j : -1).filter(j => j >= 0);
            if (ok.length) idx = pick(ok);
        }
        out.push(award(baseCard(u, idx, Math.random() < Math.min(0.9, SHINY_RATE * luck)), luck));
    }
    return out;
}

/* ---------- rendu des cartes ---------- */
function cardHtml(c, opt = {}) {
    const img = c.duo ? null : imgOf(c.u, c.name);
    const ini = c.name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
    const cls = ['card', 'r-' + c.rarity, c.shiny ? 'shiny' : '', c.finish ? 'f-' + c.finish : '', c.duo ? 'duo' : '', RANK[c.rarity] >= 4 ? 'big-rar' : '', opt.miss ? 'miss' : ''].join(' ');
    const art = c.duo ? c.duo.map(u => u ? `<div class="im" style="background-image:url('${esc(u)}')"></div>` : `<div class="ph">?</div>`).join('')
        : img ? `<div class="im" style="background-image:url('${esc(img)}')"></div>` : `<div class="ph">${esc(ini)}</div>`;
    const lab = c.season ? (SEASON_EMO[c.season] || '') + ' ' + esc(D.seasons[c.season].label) : RAR_LABEL[c.rarity];
    const fin = c.finish ? FINISHES.find(f => f.id === c.finish).label : '';
    const badges = [opt.isNew ? '<span class="new">NOUVEAU</span>' : '', opt.count > 1 ? `<span class="cnt">x${opt.count}</span>` : '', c.shiny ? '<span>✨ Brillante</span>' : '', fin ? `<span>${esc(fin)}</span>` : '', opt.coins ? `<span>+${opt.coins} 🪙</span>` : ''].join('');
    return `<div class="${cls}">${art}<span class="rr">${lab}</span><div class="bd">${badges}</div>
      <div class="info"><div class="nm">${opt.miss ? '???' : esc(c.name)}</div><div class="an">${esc(c.anime || '')}</div></div></div>`;
}

/* ---------- ouverture ---------- */
function startOpen(p) {
    if (p.price && S.coins < p.price) return toast("Pas assez de pièces !");
    if (p.price) S.coins -= p.price;
    S.opened++;
    lastPack = p;
    const cards = openPack(p);
    save();
    const ov = $('#opening'), pk = $('#op-pack'), box = $('#op-cards');
    ov.classList.add('on');
    $('#op-god').classList.remove('on');
    $('.op-bar').classList.remove('on');
    box.innerHTML = '';
    pk.style.display = '';
    pk.classList.remove('tear');
    pk.style.setProperty('--pk', packBg(p));
    $('#op-name').textContent = p.name;
    pk.onclick = () => {
        pk.onclick = null;
        pk.classList.add('tear');
        setTimeout(() => {
            pk.style.display = 'none';
            if (cards.god) $('#op-god').classList.add('on');
            // les cartes les plus rares sont révélées en dernier
            const order = cards.map((c, i) => i).sort((a, b) => (RANK[cards[a].rarity] || 0) - (RANK[cards[b].rarity] || 0));
            box.innerHTML = order.map((i, k) => { const c = cards[i]; return `<div class="slot" style="animation-delay:${k * 70}ms"><div class="in">
              <div class="back ${RANK[c.rarity] >= 3 ? 'glow r-' + c.rarity : ''}">🎴</div>${cardHtml(c, { isNew: c.isNew, coins: c.coins })}</div></div>`; }).join('');
            box.querySelectorAll('.slot').forEach(s => s.onclick = () => { if (s.classList.contains('up')) zoom(s.querySelector('.card').outerHTML); else s.classList.add('up'); });
            $('.op-bar').classList.add('on');
            $('#op-again').disabled = !!lastPack.free || S.coins < (lastPack.price || 0);
            const top = cards.reduce((m, c) => Math.max(m, RANK[c.rarity] || 0), 0);
            if (top >= 5) toast('🔥 Carte ' + RAR_LABEL[cards.find(c => RANK[c.rarity] === top).rarity] + ' !');
        }, 550);
    };
}
$('#op-flip').onclick = () => { $('#op-cards').querySelectorAll('.slot').forEach((s, i) => setTimeout(() => s.classList.add('up'), i * 120)); };
$('#op-close').onclick = () => { $('#opening').classList.remove('on'); renderShop(); if ($('#tab-album').classList.contains('on')) renderAlbum(); };
$('#op-again').onclick = () => { if (lastPack && !lastPack.free) startOpen(lastPack); };
function zoom(html) { const z = $('#zoom'); z.innerHTML = html; z.classList.add('on'); }
$('#zoom').onclick = () => $('#zoom').classList.remove('on');

/* ---------- boutique ---------- */
function packBg(p) {
    const u = p.anime || (p.art && p.art[0]);
    const a = D.animes[u];
    const n = p.anime ? a.cards[0][0] : a && a.cards[Math.min(p.art[1], a.cards.length - 1)][0];
    const im = n && imgOf(u, n);
    return im ? `linear-gradient(to top, rgba(0,0,0,.6), transparent), url('${im}') center top / cover` : '';
}
function packHtml(p, off, tag) {
    const im = packBg(p);
    return `<div class="pack ${off ? 'off' : ''}" data-id="${esc(p.id)}">${tag ? `<span class="pk-tag">${tag}</span>` : ''}
      ${im ? `<div class="pk-art" style="background:${im}"></div>` : ''}
      <div class="pk-emo">${p.emo}</div><div class="pk-n">${esc(p.name)}</div><div class="pk-d">${esc(p.desc)}</div><div class="pk-p">${fmt(p.price)} 🪙</div></div>`;
}
function renderShop() {
    const list = PACKS.filter(p => p.type !== 'season' || seasonActive(p.season));
    $('#packs').innerHTML = list.map(p => packHtml(p, S.coins < p.price, p.type === 'season' ? 'ÉVÉNEMENT' : '')).join('');
    $('#packs').querySelectorAll('.pack').forEach(el => el.onclick = () => { const p = PACKS.find(x => x.id === el.dataset.id); if (S.coins >= p.price) startOpen(p); else toast('Pas assez de pièces !'); });
    renderAnimePacks();
    renderFree();
}
const animePack = u => ({ id: 'anime:' + u, anime: u, n: 5, price: ANIME_PACK_PRICE, emo: '📦', name: D.animes[u].name, desc: `${D.animes[u].cards.length} persos · 1 épique min.` });
function renderAnimePacks() {
    const q = $('#anime-search').value.trim().toLowerCase();
    const us = universes().filter(u => !q || D.animes[u].name.toLowerCase().includes(q)).sort((a, b) => D.animes[b].cards.length - D.animes[a].cards.length);
    $('#anime-packs').innerHTML = us.map(u => packHtml(animePack(u), S.coins < ANIME_PACK_PRICE, D.animes[u].added ? 'NOUVEAU' : '')).join('');
    $('#anime-packs').querySelectorAll('.pack').forEach(el => el.onclick = () => startOpen(animePack(el.dataset.id.slice(6))));
}
$('#anime-search').oninput = renderAnimePacks;

function renderFree() {
    const left = S.lastFree + FREE_EVERY - Date.now();
    $('#free-btn').disabled = left > 0;
    $('#free-txt').textContent = left > 0 ? `Prochain booster gratuit dans ${Math.floor(left / 3600e3)} h ${String(Math.floor(left / 60e3) % 60).padStart(2, '0')} min` : 'Un booster de 3 cartes t’attend !';
    const today = new Date().toDateString();
    $('#daily-btn').disabled = S.lastDaily === today;
    $('#daily-txt').textContent = S.lastDaily === today ? `Reviens demain ! Série : ${S.streak} jour(s)` : `+${dailyAmount()} 🪙 (série de ${S.streak} jour(s))`;
}
const dailyAmount = () => 500 + Math.min(S.streak, 10) * 100;
$('#free-btn').onclick = () => {
    if (S.lastFree + FREE_EVERY > Date.now()) return;
    S.lastFree = Date.now();
    startOpen({ id: 'free', n: 3, price: 0, free: true, name: 'Booster gratuit', art: ['naruto', 0] });
};
$('#daily-btn').onclick = () => {
    const today = new Date().toDateString(), yest = new Date(Date.now() - 864e5).toDateString();
    if (S.lastDaily === today) return;
    S.streak = S.lastDaily === yest ? S.streak + 1 : 1;
    const g = dailyAmount();
    S.coins += g; S.lastDaily = today; save(); renderShop();
    toast(`+${g} 🪙 !`);
};

/* ---------- collection ---------- */
function albumCards(u) {
    if (u === '_saison') return Object.keys(D.seasons).flatMap(id => seasonChars(id).map(([su, n]) => seasonCard(id, su, n)));
    if (u === '_duo') return D.duos.map(d => ({ key: 'duo|' + d.name, name: d.name, anime: d.anime, rarity: 'duo', duo: duoImgs(d) }));
    if (u === '_special') return universes().flatMap(x => SPECIAL_TIERS.flatMap(t => (D.animes[x].specials[t.id] || []).map(n => specialCard(x, n, t.id))));
    return D.animes[u].cards.map((c, i) => baseCard(u, i));
}
function renderAlbum() {
    const sel = $('#album-anime');
    if (!sel.options.length) {
        const us = universes().sort((a, b) => D.animes[a].name.localeCompare(D.animes[b].name));
        sel.innerHTML = `<option value="_special">⭐ Raretés spéciales</option><option value="_saison">🎃 Cartes de saison</option><option value="_duo">🤝 Cartes Duo</option>` + us.map(u => `<option value="${u}">${esc(D.animes[u].name)}</option>`).join('');
        sel.value = 'naruto';
    }
    const all = albumCards(sel.value), f = $('#album-filter').value;
    const own = all.filter(c => S.cards[c.key]).length;
    $('#album-prog').textContent = `${own} / ${all.length} cartes (${Math.round(own / Math.max(1, all.length) * 100)} %)`;
    const shown = all.filter(c => { const o = S.cards[c.key]; return f === 'all' || (f === 'owned' && o) || (f === 'missing' && !o) || (f === 'dupes' && o && o.n > 1); }).slice(0, 600);
    $('#album').innerHTML = shown.map(c => { const o = S.cards[c.key]; if (o) { c.shiny = o.shiny > 0; c.finish = o.fin; } return `<div data-k="${esc(c.key)}">${cardHtml(c, { miss: !o, count: o ? o.n : 0 })}</div>`; }).join('');
    $('#album').querySelectorAll('[data-k]').forEach(el => el.onclick = () => { if (S.cards[el.dataset.k]) zoom(el.innerHTML); });
}
$('#album-anime').onchange = renderAlbum;
$('#album-filter').onchange = renderAlbum;
$('#sell-dupes').onclick = () => {
    const price = k => { const r = k.split('|')[2]; const t = SPECIAL_TIERS.find(x => x.id === r); return t ? t.coins : k.startsWith('duo|') ? 60 : k.startsWith('saison:') ? 50 : 5; };
    let total = 0, n = 0;
    for (const [k, o] of Object.entries(S.cards)) if (o.n > 1) { total += (o.n - 1) * price(k); n += o.n - 1; o.n = 1; }
    if (!n) return toast('Aucun doublon.');
    S.coins += total; save(); renderAlbum(); toast(`${n} doublons vendus : +${fmt(total)} 🪙`);
};

/* ---------- stats ---------- */
function renderStats() {
    const total = universes().reduce((s, u) => s + D.animes[u].cards.length, 0);
    const owned = Object.keys(S.cards).length;
    const done = universes().filter(u => D.animes[u].cards.every(c => S.cards[u + '|' + c[0]])).length;
    const box = (l, v) => `<div>${l}<b>${v}</b></div>`;
    $('#stats').innerHTML = `<div class="st">${box('Boosters ouverts', fmt(S.opened))}${box('Cartes tirées', fmt(S.pulled))}${box('Cartes différentes', fmt(owned))}${box('Persos au total', fmt(total))}
      ${box('Animés', universes().length)}${box('Albums complets', done)}${box('God Packs', S.god)}${box('Brillantes', Object.values(S.cards).filter(o => o.shiny).length)}</div>
      <h2 class="sec">Tes tirages par rareté</h2><div class="st">${[...RAR, 'saison', 'duo'].map(r => box(`<span style="color:var(--${r})">${RAR_LABEL[r]}</span>`, fmt(S.best[r] || 0))).join('')}</div>`;
    const pct = r => (r * 100 < 0.01 ? (r * 100).toFixed(4) : (r * 100).toFixed(2)) + ' %';
    $('#rates').innerHTML = `<table>${SPECIAL_TIERS.map(t => `<tr><td style="color:var(--${t.id})">${RAR_LABEL[t.id]}</td><td>${pct(t.rate)} par carte</td></tr>`).join('')}
      <tr><td>✨ God Pack</td><td>${pct(GOD_PACK_RATE)} par booster</td></tr><tr><td style="color:var(--duo)">Duo</td><td>${pct(DUO_RATE)} par carte</td></tr>
      <tr><td style="color:var(--saison)">Saison (pendant l'événement)</td><td>${pct(SEASON_RATE)} par carte</td></tr><tr><td>Brillante</td><td>${pct(SHINY_RATE)} par carte</td></tr>
      ${FINISHES.map(f => `<tr><td>Finition ${f.label}</td><td>${pct(f.rate)}</td></tr>`).join('')}</table>`;
}
$('#reset').onclick = () => { if (confirm('Tout effacer et recommencer ?')) { S = fresh(); save(); renderShop(); toast('Partie réinitialisée.'); } };

/* ---------- divers ---------- */
let toastT = 0;
function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('on'), 2600); }
function renderCoins() { $('#coins').textContent = fmt(S.coins); }
document.querySelectorAll('nav button').forEach(b => b.onclick = () => {
    document.querySelectorAll('nav button').forEach(x => x.classList.toggle('on', x === b));
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t.id === 'tab-' + b.dataset.tab));
    if (b.dataset.tab === 'album') renderAlbum();
    if (b.dataset.tab === 'stats') renderStats();
    if (b.dataset.tab === 'shop') renderShop();
});
setInterval(renderFree, 30e3);

load();
fetch('cards.json').then(r => r.json()).then(d => { D = d; renderCoins(); renderShop(); })
    .catch(() => { $('#packs').textContent = 'Impossible de charger les cartes.'; });
})();
