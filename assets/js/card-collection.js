(function () {
            const RORD = ['omega', 'eternelle', 'legende', 'cosmique', 'divine', 'eveillee', 'secrete', 'moment', 'altart', 'halloween', 'noel', 'valentin', 'ete', 'duo', 'mythique', 'legendaire', 'epique', 'rare', 'commune'];
            const SPECIAL = ['omega', 'eternelle', 'legende', 'cosmique', 'divine', 'eveillee', 'secrete', 'moment', 'altart', 'halloween', 'noel', 'valentin', 'ete'];
            const FORD = ['numbered', 'signed', 'glitch', 'galaxy', 'manga', 'fullart', 'dark', 'gold', 'glitter', 'reverse', 'holo'];
            const FLAB = { holo: '🌈 Holo', reverse: '🪩 Reverse Holo', glitter: '✨ Pailletée', gold: '🥇 Gold', dark: '🌑 Dark', fullart: '🖼️ Full Art', manga: '🖋️ Manga', galaxy: '🔮 Galaxie', glitch: '📺 Glitch', signed: '✍️ Signée', numbered: '🔢 Numérotée' };
            const rIdx = r => { const i = RORD.indexOf(r); return i < 0 ? 99 : i; }, fIdx = f => f ? FORD.indexOf(f) : 99;
            const SORTS = {
                rare: (a, b) => rIdx(a.rarity) - rIdx(b.rarity) || fIdx(a.finish) - fIdx(b.finish) || b.shiny - a.shiny || a.name.localeCompare(b.name, 'fr'),
                fin: (a, b) => fIdx(a.finish) - fIdx(b.finish) || rIdx(a.rarity) - rIdx(b.rarity) || a.name.localeCompare(b.name, 'fr'),
                name: (a, b) => a.name.localeCompare(b.name, 'fr'),
                anime: (a, b) => (a.anime || '').localeCompare(b.anime || '', 'fr') || rIdx(a.rarity) - rIdx(b.rarity),
                n: (a, b) => b.n - a.n || rIdx(a.rarity) - rIdx(b.rarity)
            };
            const newFilter = () => ({ q: '', rar: '', fin: '', anime: '', shiny: false, dup: false, sort: 'rare' });
            window.cardFilter = function (list, f) {
                const q = f.q.trim().toLowerCase();
                return list.filter(c => (!q || (c.name + ' ' + (c.anime || '')).toLowerCase().includes(q))
                    && (!f.rar || (f.rar === 'special' ? SPECIAL.includes(c.rarity) : c.rarity === f.rar))
                    && (!f.fin || (f.fin === 'any' ? !!c.finish : f.fin === 'none' ? !c.finish : !!(c.finishes && c.finishes[f.fin])))
                    && (!f.anime || c.anime === f.anime) && (!f.shiny || c.shiny > 0) && (!f.dup || c.n > 1))
                    .map(c => f.fin && FORD.includes(f.fin) ? Object.assign({}, c, { finish: f.fin }) : c)
                    .sort(SORTS[f.sort] || SORTS.rare);
            };
            window.cardFilterBar = function (f, list) {
                const animes = [...new Set(list.map(c => c.anime).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
                const rars = RORD.filter(r => list.some(c => c.rarity === r));
                const opt = (v, t, cur) => `<option value="${v}"${cur === v ? ' selected' : ''}>${t}</option>`;
                return `<div class="cf-bar"><input class="v7-input" data-cf="q" placeholder="🔎 Nom ou anime" value="${v7esc(f.q)}">
                    <select data-cf="rar">${opt('', 'Toutes les raretés', f.rar)}${opt('special', '🌈 Spéciales (Secrète et +)', f.rar)}${rars.map(r => opt(r, RAR_LABEL[r] || r, f.rar)).join('')}</select>
                    <select data-cf="fin">${opt('', 'Toutes les finitions', f.fin)}${opt('any', '✨ Avec finition', f.fin)}${opt('none', 'Sans finition', f.fin)}${FORD.slice().reverse().map(x => opt(x, FLAB[x], f.fin)).join('')}</select>
                    <select data-cf="anime">${opt('', 'Tous les animes', f.anime)}${animes.map(a => opt(v7esc(a), v7esc(a), f.anime)).join('')}</select>
                    <select data-cf="sort">${opt('rare', 'Trier : rareté', f.sort)}${opt('fin', 'Trier : finition', f.sort)}${opt('name', 'Trier : nom A → Z', f.sort)}${opt('anime', 'Trier : anime', f.sort)}${opt('n', 'Trier : exemplaires', f.sort)}</select>
                    <label><input type="checkbox" data-cf="shiny"${f.shiny ? ' checked' : ''}> ✨ Brillantes</label><label><input type="checkbox" data-cf="dup"${f.dup ? ' checked' : ''}> 📚 Doublons</label></div>`;
            };
            window.cardFilterBind = function (root, f, cb) {
                let tmo = null;
                root.querySelectorAll('[data-cf]').forEach(el => {
                    const k = el.dataset.cf;
                    const upd = () => { f[k] = el.type === 'checkbox' ? el.checked : el.value; cb(); };
                    if (k === 'q') el.oninput = () => { clearTimeout(tmo); tmo = setTimeout(upd, 180); }; else el.onchange = upd;
                });
            };

            // pages : « ‹ 1 2 3 … › »
            window.cardPager = function (id, page, pages, cb) {
                const el = document.getElementById(id); if (!el) return;
                if (pages <= 1) { el.innerHTML = ''; return; }
                const nums = [...new Set([1, 2, page - 1, page, page + 1, pages - 1, pages].filter(n => n >= 1 && n <= pages))].sort((a, b) => a - b);
                let html = `<button class="host-btn" ${page <= 1 ? 'disabled' : ''} data-p="${page - 1}">‹ Précédent</button>`, last = 0;
                nums.forEach(n => { if (n - last > 1) html += '<span class="pg-dots">…</span>'; html += `<button class="host-btn${n === page ? ' pg-on' : ''}" data-p="${n}">${n}</button>`; last = n; });
                html += `<button class="host-btn" ${page >= pages ? 'disabled' : ''} data-p="${page + 1}">Suivant ›</button>`;
                el.innerHTML = html;
                el.querySelectorAll('button[data-p]').forEach(b => b.onclick = () => cb(+b.dataset.p));
            };
            /* --- collection : toutes mes cartes --- */
            const CV = { f: newFilter(), cards: [], page: 1, per: 60, split: true };
            window.cardsAllView = async function () {
                const box = document.getElementById('eco-album'); if (!box) return;
                if (typeof eco !== 'undefined') eco.albumU = null;
                box.innerHTML = '<div class="arc-loading" style="padding:30px;"><div class="arc-spin"></div></div>';
                const d = await v7get('/api/cards/mine');
                if (!d || !d.ok) { box.innerHTML = '<p class="tl-hint">Impossible de charger ta collection.</p>'; return; }
                CV.cards = d.cards; CV.page = 1;
                const tot = d.cards.reduce((a, c) => a + c.n, 0), withFin = d.cards.filter(c => c.finish).length;
                const byFin = FORD.map(f => [f, d.cards.filter(c => c.finishes && c.finishes[f]).length]).filter(x => x[1]);
                box.innerHTML = `<div style="display:flex;align-items:center;gap:8px;margin:8px 0;flex-wrap:wrap;"><button class="host-btn" onclick="loadAlbum(null)">🔙 Albums</button><b>🗂️ Toutes mes cartes</b><button class="host-btn" onclick="cardFinishGuide()">✨ Finitions & raretés</button></div>
                    <div class="cf-stats"><span>🃏 ${d.cards.length} cartes différentes</span><span>📚 ${tot} exemplaires</span><span>✨ ${d.cards.filter(c => c.shiny).length} brillantes</span><span>🌈 ${withFin} avec finition</span>${byFin.map(([f, n]) => `<span>${FLAB[f]} ${n}</span>`).join('')}</div>
                    ${cardFilterBar(CV.f, d.cards)}<label class="cf-split"><input type="checkbox" id="cv-split"${CV.split ? ' checked' : ''}> 🔀 Voir chaque exemplaire à part (normal, Holo, Gold…)</label>
                    <div class="cf-count" id="cv-count"></div><div class="pg-bar" id="cv-pg1"></div><div class="card-grid" id="cv-grid"></div><div class="pg-bar" id="cv-pg2"></div>`;
                cardFilterBind(box, CV.f, () => { CV.page = 1; cvRender(); });
                box.querySelector('#cv-split').onchange = e => { CV.split = e.target.checked; CV.page = 1; cvRender(); };
                cvRender();
            };
            // une entrée par finition possédée + les exemplaires normaux restants
            function splitCopies(cards) {
                const out = [];
                cards.forEach(c => {
                    const fs = Object.entries(c.finishes || {}); let used = 0;
                    fs.forEach(([f, n]) => { used += n; out.push(Object.assign({}, c, { finish: f, n, serial: f === c.finish ? c.serial : null, finishes: { [f]: n } })); });
                    if (c.n - used > 0 || !fs.length) out.push(Object.assign({}, c, { finish: null, n: Math.max(1, c.n - used), serial: null, finishes: {} }));
                });
                return out;
            }
            function cvRender() {
                const g = document.getElementById('cv-grid'); if (!g) return;
                const list = cardFilter(CV.split ? splitCopies(CV.cards) : CV.cards, CV.f);
                const pages = Math.max(1, Math.ceil(list.length / CV.per)); CV.page = Math.min(Math.max(1, CV.page), pages);
                g.innerHTML = list.slice((CV.page - 1) * CV.per, CV.page * CV.per).map(c => cardHtml(c)).join('') || '<p class="tl-hint">Aucune carte ne correspond.</p>';
                document.getElementById('cv-count').textContent = `${list.length} carte${list.length > 1 ? 's' : ''} • page ${CV.page} / ${pages} • clique sur une carte pour l’inspecter en 3D`;
                const go = n => { CV.page = n; cvRender(); document.getElementById('cv-count').scrollIntoView({ behavior: 'smooth', block: 'start' }); };
                cardPager('cv-pg1', CV.page, pages, go); cardPager('cv-pg2', CV.page, pages, go);
            }
            // bouton dans l'album
            const albumPrev = loadAlbum;
            loadAlbum = async function (u) {
                await albumPrev.apply(this, arguments);
                const head = document.querySelector('#eco-album .album-extra-head');
                if (head && !head.querySelector('.cv-btn')) head.insertAdjacentHTML('afterbegin', '<button class="host-btn cv-btn" style="background:var(--accent-cyan);color:#111;border-color:transparent;" onclick="cardsAllView()">🗂️ Toutes mes cartes (trier / filtrer)</button>');
            };

            /* --- deck : les finitions se voient, se trient et donnent un bonus --- */
            dk.f = newFilter(); dk.page = 1;
            loadDeck = async function () {
                const [d, all] = await Promise.all([v7get('/api/deck'), v7get('/api/cards/mine')]);
                if (!d || !d.ok) return;
                dk.keys = d.deck.map(c => c.key); dk.cards = (all && all.cards) || []; dk.rules = d.rules; dk.pct = d.pct; dk.finDeck = (all && all.finDeck) || {};
                deckRender();
            };
            const bonusOf = c => (dk.rules[c.rarity] || 0) + (c.shiny ? 2 : 0) + (c.finish ? (dk.finDeck[c.finish] || 0) : 0);
            deckPctLocal = function () { let p = 0; dk.keys.forEach(k => { const c = dk.cards.find(x => x.key === k); if (c) p += bonusOf(c); }); return p; };
            deckRender = function () {
                const el = document.getElementById('eco-deck'); if (!el) return;
                const slot = i => { const c = dk.cards.find(x => x.key === dk.keys[i]); return c ? `<div class="dk-slot" onclick="deckToggle(${JSON.stringify(c.key).replace(/"/g, '&quot;')})">${cardHtml({ ...c, n: 1 })}<small>+${bonusOf(c)} %</small></div>` : `<div class="dk-slot empty">＋<small>Emplacement ${i + 1}</small></div>`; };
                el.innerHTML = `<div class="shop-head">🎴 Ton deck : <b>+${deckPctLocal()} %</b> de pièces à chaque partie <span class="tl-hint">• Commune +2 %, Rare +4 %, Épique +6 %, Légendaire +10 %, Mythique +14 %, Duo +16 %, Secrète +20 %, Éveillée +22 %, Divine +25 %, Cosmique +30 %, Légende vivante +35 %, Éternelle +40 %, Oméga +50 %, brillante +2 % • <b>finitions</b> : Holo / Reverse +1 %, Pailletée +2 %, Gold / Dark +4 %, Full Art / Manga +5 %, Galaxie +6 %, Glitch +7 %, Signée +8 %, Numérotée +10 % • bonus doublé si la partie est sur l’anime de la carte</span></div>
                    <div class="dk-slots">${[0, 1, 2, 3, 4].map(slot).join('')}</div>
                    <div style="display:flex;justify-content:flex-end;"><button class="btn-action" style="width:auto;margin:0;" onclick="deckSave()">💾 Enregistrer</button></div>
                    ${cardFilterBar(dk.f, dk.cards)}<div class="cf-count" id="dk-count"></div><div class="pg-bar" id="dk-pg1"></div><div class="trd-list dk-list" id="dk-list"></div><div class="pg-bar" id="dk-pg2"></div>`;
                cardFilterBind(el, dk.f, () => { dk.page = 1; deckList(); });
                deckList();
            };
            deckList = function () {
                const box = document.getElementById('dk-list'); if (!box) return;
                const list = cardFilter(dk.cards, dk.f), per = 60;
                const pages = Math.max(1, Math.ceil(list.length / per)); dk.page = Math.min(Math.max(1, dk.page || 1), pages);
                const cnt = document.getElementById('dk-count'); if (cnt) cnt.textContent = `${list.length} carte${list.length > 1 ? 's' : ''} • page ${dk.page} / ${pages} • clique pour l’ajouter ou la retirer du deck`;
                const go = n => { dk.page = n; deckList(); cnt && cnt.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
                cardPager('dk-pg1', dk.page, pages, go); cardPager('dk-pg2', dk.page, pages, go);
                box.innerHTML = list.slice((dk.page - 1) * per, dk.page * per).map(c => {
                    const full = dk.cards.find(x => x.key === c.key) || c, fin = full.finish;
                    const img = c.imgs && c.imgs.length === 2 ? `<span class="tm-duo">${c.imgs.map(u => `<img src="/api/img?u=${encodeURIComponent(u)}" alt="" loading="lazy">`).join('')}</span>` : `<img src="${v7esc(c.img)}" alt="" loading="lazy" onerror="this.style.opacity=.15">`;
                    return `<button class="trd-mini r-${c.rarity}${fin ? ' f-' + fin : ''}${dk.keys.includes(c.key) ? ' on' : ''}" style="--fc:${(window.FIN_COL || {})[fin] || '#fff'}" onclick="deckToggle(${JSON.stringify(c.key).replace(/"/g, '&quot;')})">${img}${fin ? `<span class="tm-fin">${FLAB[fin]}</span>` : ''}<b>${v7esc(c.name)}</b><small>${RAR_LABEL[c.rarity] || c.rarity}${c.shiny ? ' ✨' : ''} • +${bonusOf(full)} %</small></button>`;
                }).join('') || '<p class="tl-hint">Aucune carte ne correspond.</p>';
            };
        })();
