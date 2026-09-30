/* =====================================================================
           HÔTEL DES VENTES + SCÈNE D'INVOCATION
           ===================================================================== */
        const mk = { view: 'buy', q: '', rarity: '', shiny: false, sort: 'new', sell: null, cards: [] };
        (function () {
            const orig = ecoTab;
            ecoTab = function (t) {
                const el = document.getElementById('eco-market');
                if (t !== 'market') { if (el) el.style.display = 'none'; return orig(t); }
                eco.tab = t;
                document.querySelectorAll('.eco-tabs button').forEach(b => b.classList.toggle('on', b.dataset.t === t));
                document.querySelectorAll('#collection [id^="eco-"]').forEach(x => { if (x.id !== 'eco-market') x.style.display = 'none'; });
                el.style.display = '';
                if (!isAccount()) { el.innerHTML = '<p class="tl-hint">Crée un compte pour utiliser l’hôtel des ventes.</p>'; return; }
                loadMarket();
            };
        })();
        socket.on('market_sold', d => { toast(`🏪 <b>${v7esc(d.buyer)}</b> a acheté ta carte ${v7esc(d.name)} : +${d.gain} 🪙`, '#ffd700'); if (typeof ecoLoad === 'function') ecoLoad(); });
        const MK_RAR = { commune: 'Commune', rare: 'Rare', epique: 'Épique', legendaire: 'Légendaire', mythique: 'Mythique', secrete: 'Secrète', divine: 'Divine', cosmique: 'Cosmique', eternelle: 'Éternelle', omega: 'Oméga', halloween: 'Halloween 🎃' };
        function mkCard(c) { return cardHtml({ name: c.name, rarity: c.rarity, shiny: c.shiny, img: c.img, n: 1 }); }
        async function loadMarket() {
            const el = document.getElementById('eco-market'); if (!el) return;
            const qs = `?q=${encodeURIComponent(mk.q)}&rarity=${mk.rarity}&sort=${mk.sort}${mk.shiny ? '&shiny=1' : ''}`;
            const d = await v7get('/api/market' + qs);
            if (!d || !d.ok) { el.innerHTML = '<p class="tl-hint">Hôtel des ventes indisponible (server.js à jour ?).</p>'; return; }
            mk.data = d;
            if (typeof eco !== 'undefined') { eco.coins = d.coins; ecoCoinsUi(); }
            const tabs = `<div class="mk-tabs">${[['buy', '🛒 Acheter'], ['sell', '💰 Vendre'], ['mine', '📦 Mes ventes']].map(([k, l]) => `<button class="${mk.view === k ? 'on' : ''}" onclick="mk.view='${k}';loadMarket()">${l}</button>`).join('')}</div>`;
            const head = `<div class="shop-head">🏪 Hôtel des ventes <span class="tl-hint">• achète et vends des cartes aux autres joueurs • 🪙 <b>${d.coins}</b> • taxe de ${Math.round(d.tax * 100)} % sur chaque vente</span></div>`;
            if (mk.view === 'buy') {
                el.innerHTML = head + tabs + `<div class="mk-filters"><input class="v7-input" placeholder="🔎 Perso, anime, vendeur" value="${v7esc(mk.q)}" onkeydown="if(event.key==='Enter'){mk.q=this.value;loadMarket()}">
                    <select onchange="mk.rarity=this.value;loadMarket()"><option value="">Toutes raretés</option>${Object.entries(MK_RAR).map(([k, v]) => `<option value="${k}" ${mk.rarity === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
                    <select onchange="mk.sort=this.value;loadMarket()"><option value="new" ${mk.sort === 'new' ? 'selected' : ''}>Plus récentes</option><option value="cheap" ${mk.sort === 'cheap' ? 'selected' : ''}>Moins chères</option><option value="expensive" ${mk.sort === 'expensive' ? 'selected' : ''}>Plus chères</option></select>
                    <label><input type="checkbox" ${mk.shiny ? 'checked' : ''} onchange="mk.shiny=this.checked;loadMarket()"> ✨ Brillantes</label></div>
                    <div class="mk-grid">${d.list.length ? d.list.map(c => `<div class="mk-item${c.mine ? ' mine' : ''}">${mkCard(c)}<div class="mk-meta"><b class="mk-price">🪙 ${c.price}</b><small>${v7esc(c.anime)} • par ${v7esc(c.seller)}</small>
                        ${c.mine ? '<small class="tl-hint">Ta vente</small>' : `<button ${d.coins < c.price ? 'disabled' : ''} onclick="mkBuy('${c.id}',${c.price},this)">Acheter</button>`}</div></div>`).join('') : '<p class="tl-hint">Aucune carte en vente pour le moment. Sois le premier à vendre !</p>'}</div>`;
                return;
            }
            if (mk.view === 'sell') {
                if (!mk.cards.length) { const c = await v7get('/api/trade/cards'); mk.cards = Object.values(((c && c.cards) || []).filter(x => x.rarity !== 'duo' && x.rarity !== 'collector').reduce((m, x) => { if (m[x.key]) m[x.key].n += x.n; else m[x.key] = Object.assign({}, x, { finish: null }); return m; }, {})); }
                const s = mk.sell && mk.cards.find(c => c.key === mk.sell);
                const hint = s ? d.hints[s.rarity] : null;
                el.innerHTML = head + tabs + (s ? `<div class="mk-sellbox">${mkCard(s)}<div><h3>${v7esc(s.name)}</h3><p class="tl-hint">${v7esc(s.anime)} • ${MK_RAR[s.rarity]} • tu en as ${s.n}${s.shiny ? ` (dont ${s.shiny} brillante${s.shiny > 1 ? 's' : ''})` : ''}</p>
                    <p class="tl-hint">Prix conseillé pour une ${MK_RAR[s.rarity].toLowerCase()} : ${hint[0]} à ${hint[1]} 🪙 (plus pour une brillante)</p>
                    <div class="ch-in"><input id="mk-price" class="v7-input" type="number" min="5" max="100000" value="${hint[0] * 2}" oninput="document.getElementById('mk-net').textContent=Math.max(1,Math.round((+this.value||0)*${1 - d.tax}))"><button class="btn-action" onclick="mkSell()">💰 Mettre en vente</button></div>
                    <small class="tl-hint">Tu recevras <b id="mk-net">${Math.round(hint[0] * 2 * (1 - d.tax))}</b> 🪙 après la taxe.</small>
                    ${s.shiny ? `<label style="display:block;margin-top:6px;"><input type="checkbox" id="mk-shiny"> ✨ Vendre l’exemplaire brillant</label>` : ''}
                    <div class="hb-btns"><button onclick="mk.sell=null;loadMarket()">↩ Choisir une autre carte</button></div></div></div>`
                    : `<p class="tl-hint">Choisis la carte à vendre (elle quitte ta collection pendant la vente, tu la récupères si tu annules).</p><input class="v7-input" placeholder="🔎 Chercher dans ta collection" oninput="mkFilter(this.value)"><div class="trd-list mk-pick" id="mk-pick"></div>`);
                if (!s) mkFilter('');
                return;
            }
            const open = d.mine.filter(x => x.status === 'open'), sold = d.mine.filter(x => x.status === 'sold');
            el.innerHTML = head + tabs + `<h3 class="adm-h">📦 En vente (${open.length}/${d.max})</h3>${open.length ? `<div class="mk-grid">${open.map(c => `<div class="mk-item">${mkCard(c)}<div class="mk-meta"><b class="mk-price">🪙 ${c.price}</b><button onclick="mkCancel('${c.id}')">Retirer</button></div></div>`).join('')}</div>` : '<p class="tl-hint">Rien en vente.</p>'}
                <h3 class="adm-h">✅ Vendues</h3>${sold.length ? sold.map(c => `<div class="friend-row"><span>${v7esc(c.name)}${c.shiny ? ' ✨' : ''} → <b>${v7esc(c.buyer || '')}</b></span><span>🪙 ${c.price}</span></div>`).join('') : '<p class="tl-hint">Aucune vente pour l’instant.</p>'}
                <h3 class="adm-h">🛍️ Tes achats</h3>${d.bought.length ? d.bought.map(c => `<div class="friend-row"><span>${v7esc(c.name)}${c.shiny ? ' ✨' : ''} (de ${v7esc(c.seller)})</span><span>🪙 ${c.price}</span></div>`).join('') : '<p class="tl-hint">Aucun achat pour l’instant.</p>'}`;
        }
        function mkFilter(q) {
            const box = document.getElementById('mk-pick'); if (!box) return;
            const s = String(q || '').toLowerCase();
            const order = ['omega', 'eternelle', 'cosmique', 'divine', 'secrete', 'halloween', 'mythique', 'legendaire', 'epique', 'rare', 'commune'];
            box.innerHTML = mk.cards.filter(c => !s || (c.name + ' ' + c.anime).toLowerCase().includes(s)).sort((a, b) => order.indexOf(a.rarity) - order.indexOf(b.rarity)).slice(0, 90)
                .map(c => `<button class="trd-mini r-${c.rarity}" onclick="mk.sell=${JSON.stringify(c.key).replace(/"/g, '&quot;')};loadMarket()"><img src="${v7esc(c.img)}" alt="" loading="lazy" onerror="this.style.opacity=.15"><b>${v7esc(c.name)}</b><small>${v7esc(c.anime)} • x${c.n}${c.shiny ? ' ✨' : ''}</small></button>`).join('') || '<p class="tl-hint">Aucune carte.</p>';
        }
        async function mkSell() {
            const price = +document.getElementById('mk-price').value, shiny = !!(document.getElementById('mk-shiny') || {}).checked;
            const d = await v7post('/api/market/sell', { key: mk.sell, price, shiny });
            if (!d || !d.ok) return toast('❌ ' + ((d && d.error) || 'Impossible'), 'var(--accent-pink)');
            toast(`🏪 ${v7esc(d.listing.name)} mis en vente à ${d.listing.price} 🪙`, '#00ff88');
            mk.sell = null; mk.cards = []; mk.view = 'mine'; loadMarket();
        }
        async function mkCancel(id) {
            const d = await v7post('/api/market/cancel', { id });
            if (!d || !d.ok) return toast('❌ ' + ((d && d.error) || 'Impossible'), 'var(--accent-pink)');
            toast('↩ Carte retirée de la vente et rendue', '#48dbfb'); mk.cards = []; loadMarket();
        }
        async function mkBuy(id, price, btn) {
            if (btn && !btn.classList.contains('armed')) { btn.classList.add('armed'); btn.textContent = `Confirmer ${price} 🪙 ?`; setTimeout(() => { if (btn.isConnected) { btn.classList.remove('armed'); btn.textContent = 'Acheter'; } }, 4000); return; }
            const d = await v7post('/api/market/buy', { id });
            if (!d || !d.ok) { toast('❌ ' + ((d && d.error) || 'Impossible'), 'var(--accent-pink)'); return loadMarket(); }
            if (typeof eco !== 'undefined') { eco.coins = d.coins; ecoCoinsUi(); }
            showBooster([d.card]);
            mk.cards = []; loadMarket();
        }

        /* ---------- scène d'invocation pour les boosters ---------- */
        (function () {
            const RANK = { commune: 0, rare: 1, epique: 2, legendaire: 3, mythique: 4, secrete: 5, divine: 6, cosmique: 7, eternelle: 8, omega: 9, halloween: 5, eveillee: 5, legende: 7, duo: 4, noel: 5, valentin: 5, ete: 5, altart: 5, moment: 5 };
            const XCOL = { halloween: '#ff7a00', eveillee: '#ff2d55', legende: '#ff4500', duo: '#00e5a0', noel: '#e8363d', valentin: '#ff6fa8', ete: '#ffc233', altart: '#8b5cf6', moment: '#ffb020' };
            const COL = ['#d6e4ff', '#3fa7ff', '#b44dff', '#ffb300', '#ff3c7a', '#00f0ff', '#fff3b0', '#7b5cff', '#ffd700', '#ffffff'];
            const RNAME = ['commune', 'rare', 'epique', 'legendaire', 'mythique', 'secrete', 'divine', 'cosmique', 'eternelle', 'omega'];
            const BANNER = { legendaire: 'LÉGENDAIRE !', mythique: '🔥 MYTHIQUE 🔥', secrete: '🌈 SECRÈTE 🌈', divine: '👑 DIVINE 👑', cosmique: '🌌 COSMIQUE 🌌', eternelle: '♾️ ÉTERNELLE ♾️', omega: 'Ω OMÉGA Ω', halloween: '🎃 HALLOWEEN 🎃', eveillee: '🩸 ÉVEILLÉE 🩸', legende: '👑 LÉGENDE VIVANTE 👑', duo: '🎴 CARTE DUO 🎴', noel: '🎄 NOËL 🎄', valentin: '💘 SAINT-VALENTIN 💘', ete: '☀️ ÉTÉ ☀️', altart: '🖼️ ALT ART 🖼️', moment: '🎬 CARTE MOMENT 🎬' };
            // particules : [nombre, couleurs, distance, direction ('out' | 'up' | 'down' | 'orbit')]
            const PARTS = {
                rare: [10, ['#3fa7ff', '#9fd4ff'], 110, 'out'], epique: [18, ['#b44dff', '#e3b0ff', '#fff'], 150, 'out'],
                legendaire: [26, ['#ffb300', '#ffe066', '#fff'], 190, 'out'], mythique: [30, ['#ff9a2a', '#ff3c7a', '#ffe066'], 200, 'up'],
                secrete: [36, ['#ff2a5f', '#ffe600', '#00ff88', '#00f0ff', '#b44dff'], 220, 'out'], divine: [30, ['#ffffff', '#fff3b0', '#ffd700'], 240, 'down'],
                cosmique: [44, ['#ffffff', '#7b5cff', '#00c8ff', '#ff5ce1'], 240, 'orbit'], eternelle: [44, ['#ffd700', '#fff3b0', '#b8860b'], 260, 'out'],
                omega: [70, ['#ff2a5f', '#ffe600', '#00ff88', '#00f0ff', '#b44dff', '#ffffff'], 340, 'out'],
                halloween: [40, ['#ff7a00', '#ffb347', '#8a2be2', '#39ff14', '#111111'], 230, 'orbit'],
                eveillee: [46, ['#ff2d55', '#ff8a00', '#ffffff', '#b3001b'], 260, 'up'], legende: [64, ['#ff4500', '#ffd700', '#ffffff', '#ff2a5f'], 320, 'out'],
                duo: [34, ['#00e5a0', '#00b3ff', '#ffffff'], 220, 'orbit'], noel: [40, ['#ffffff', '#e8363d', '#1faa59', '#ffd700'], 230, 'down'],
                valentin: [40, ['#ff6fa8', '#ff2a5f', '#ffffff', '#ffc2d9'], 230, 'up'], ete: [40, ['#ffc233', '#ff7a00', '#00c2ff', '#ffffff'], 230, 'out'],
                altart: [46, ['#8b5cf6', '#00e5ff', '#ff4fd8', '#ffffff'], 265, 'orbit'], moment: [50, ['#ffb020', '#ff5a36', '#ffffff', '#ffe28a'], 275, 'out']
            };
            function smParticles(host, rar) {
                const cfg = PARTS[rar]; if (!cfg) return;
                const [n, cols, dist, dir] = cfg;
                for (let k = 0; k < n; k++) {
                    const p = document.createElement('i'); p.className = 'sm-p';
                    let a = Math.random() * Math.PI * 2, d = dist * (0.45 + Math.random() * 0.55), x = Math.cos(a) * d, y = Math.sin(a) * d;
                    if (dir === 'up') { x = (Math.random() - .5) * 120; y = -dist * (0.5 + Math.random() * 0.5); }
                    if (dir === 'down') { x = (Math.random() - .5) * 240; y = dist * (0.3 + Math.random() * 0.4); p.style.borderRadius = '50% 0'; }
                    if (dir === 'orbit') { a += Math.PI; x = Math.cos(a) * d * 1.2; y = Math.sin(a) * d * .5; }
                    p.style.cssText += `--x:${x.toFixed(0)}px;--y:${y.toFixed(0)}px;--s:${(3 + Math.random() * (rar === 'omega' ? 9 : 6)).toFixed(1)}px;--pc:${cols[k % cols.length]};--d:${(0.8 + Math.random() * (dir === 'down' ? 2 : 1)).toFixed(2)}s;--dl:${(Math.random() * (dir === 'orbit' ? .8 : .25)).toFixed(2)}s;--r:${(Math.random() * 360).toFixed(0)}deg;`;
                    host.appendChild(p);
                }
            }
            function smSound(rank) { // petite fanfare, plus longue et plus aiguë selon la rareté
                if (typeof bip !== 'function' || typeof sfxOn === 'undefined' || !sfxOn) return;
                const notes = [523, 659, 784, 1047, 1319, 1568, 2093];
                const n = Math.min(notes.length, 1 + rank);
                for (let k = 0; k < n; k++) bip(notes[k], k === n - 1 ? 0.6 : 0.16, 0.05, k * 0.07, rank >= 5 ? 'triangle' : 'sine');
                if (rank >= 7) bip(notes[n - 1] / 2, 1.2, 0.05, n * 0.07, 'triangle');
                if (rank >= 8 && typeof sfxBoom === 'function') sfxBoom(1.2, 0.25, 1500);
            }
            function hwSound() { // rire de sorcière + orage
                if (typeof bip !== 'function' || typeof sfxOn === 'undefined' || !sfxOn) return;
                [659, 622, 587, 554, 523, 494, 466, 440].forEach((f, k) => bip(f, 0.14, 0.05, k * 0.09, 'sawtooth'));
                [880, 988, 880, 988, 880].forEach((f, k) => bip(f, 0.08, 0.04, 0.85 + k * 0.1, 'square'));
                bip(110, 1.4, 0.06, 0.2, 'triangle');
                if (typeof sfxBoom === 'function') sfxBoom(1.4, 0.3, 700);
            }
            function hwBurst(host) { // chauves-souris, fantômes et citrouilles qui s'échappent de la carte
                const E = ['🦇', '🦇', '🦇', '👻', '🎃', '🕸️', '🦇', '👻', '🎃', '🦇', '💀', '🦇'];
                for (let k = 0; k < 18; k++) {
                    const p = document.createElement('b'); p.className = 'hw-e'; p.textContent = E[k % E.length];
                    const a = Math.random() * Math.PI * 2, d = 160 + Math.random() * 220;
                    p.style.cssText = `--x:${(Math.cos(a) * d).toFixed(0)}px;--y:${(Math.sin(a) * d * .8 - 40).toFixed(0)}px;--r:${(Math.random() * 60 - 30).toFixed(0)}deg;--d:${(1.4 + Math.random()).toFixed(2)}s;--dl:${(Math.random() * .35).toFixed(2)}s;font-size:${(1.2 + Math.random() * 1.4).toFixed(1)}rem;`;
                    host.appendChild(p);
                }
            }
            function smReveal(o, el, c) {
                const rank = RANK[c.rarity] || 0, rar = XCOL[c.rarity] ? c.rarity : (RNAME[rank] || 'commune');
                const fx = document.createElement('div'); fx.className = 'sm-fx fx-' + rar; el.appendChild(fx);
                smParticles(fx, rar);
                if (rar === 'halloween') {
                    hwBurst(fx);
                    const sc = document.createElement('div'); sc.className = 'sm-screen fx-halloween'; o.insertBefore(sc, o.querySelector('.sm-cards')); setTimeout(() => sc.remove(), 3600);
                    o.classList.remove('hw-storm'); void o.offsetWidth; o.classList.add('hw-storm'); setTimeout(() => o.classList.remove('hw-storm'), 1600);
                    hwSound();
                }
                setTimeout(() => fx.remove(), 4200);
                if (rank >= 6) { const sc = document.createElement('div'); sc.className = 'sm-screen fx-' + rar; o.insertBefore(sc, o.querySelector('.sm-cards')); setTimeout(() => sc.remove(), 4000); }
                if (rank >= 9) { o.classList.add('glitch'); setTimeout(() => o.classList.remove('glitch'), 1900); }
                if (BANNER[rar]) {
                    o.querySelectorAll('.sm-banner').forEach(b => b.remove());
                    const b = document.createElement('div'); b.className = 'sm-banner' + (['secrete', 'omega'].includes(rar) ? ' rainbow' : '');
                    b.style.setProperty('--bc', XCOL[rar] || COL[rank]); b.textContent = (c.shiny ? '✨ ' : '') + BANNER[rar] + (c.shiny ? ' ✨' : '');
                    o.appendChild(b); setTimeout(() => b.remove(), 2300);
                }
                if (rank >= 3 && typeof confetti === 'function' && rar !== 'halloween') confetti(rank >= 6 ? 3500 : 1800);
                if (rar !== 'halloween') smSound(rank);
                if (c.finish && typeof finishFx === 'function') finishFx(o, el, c);
                if (c.quote && typeof quoteFx === 'function') quoteFx(o, c);
            }
            function circleSvg(col) {
                const runes = 'ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟ';
                let t = ''; for (let i = 0; i < 24; i++) { const a = i * 15; t += `<text x="150" y="26" transform="rotate(${a} 150 150)" text-anchor="middle">${runes[i]}</text>`; }
                return `<svg viewBox="0 0 300 300" class="sm-circle" style="--c:${col}"><g class="sm-rot"><circle cx="150" cy="150" r="140"/><circle cx="150" cy="150" r="118"/><g class="sm-runes">${t}</g></g>
                    <g class="sm-rot2"><path d="M150 40L245 205H55Z"/><path d="M150 260L55 95H245Z"/><circle cx="150" cy="150" r="60"/><circle cx="150" cy="150" r="30"/></g></svg>`;
            }
            // affiché dès le clic sur « acheter » : le cercle se charge pendant que le serveur prépare les cartes
            window.summonPending = function () {
                document.getElementById('summon')?.remove();
                const o = document.createElement('div'); o.id = 'summon'; o.className = 'summon r0 pending';
                o.style.setProperty('--c', COL[0]);
                o.innerHTML = `<div class="sm-bg"></div>${circleSvg(COL[0])}<div class="sm-beam"></div><div class="sm-flash"></div><div class="sm-txt">Invocation…</div>`;
                document.body.appendChild(o);
                setTimeout(() => o.classList.add('charge'), 20);
                setTimeout(() => { if (o.isConnected && o.classList.contains('pending')) o.remove(); }, 20000); // sécurité si le serveur ne répond pas
            };
            window.summonCancel = function () { const o = document.querySelector('#summon.pending'); if (o) o.remove(); };
            showBooster = function (cards) {
                if (!cards || !cards.length) return;
                const wasPending = !!document.querySelector('#summon.pending');
                document.getElementById('booster-modal')?.remove(); document.getElementById('summon')?.remove();
                const best = Math.max(...cards.map(c => RANK[c.rarity] || 0));
                const anyShiny = cards.some(c => c.shiny);
                const god = cards.some(c => c.god);
                // une carte Halloween (et rien de plus rare) : toute la scène passe en mode Halloween
                const hw = cards.some(c => c.rarity === 'halloween') && best <= 5;
                const col = hw ? '#ff7a00' : anyShiny && best < 3 ? '#ff7ae0' : COL[best] || COL[0];
                const o = document.createElement('div'); o.id = 'summon'; o.className = 'summon r' + best + (anyShiny ? ' shiny' : '') + (hw ? ' hw' : '') + (god ? ' god' : '');
                o.style.setProperty('--c', col);
                const hwDeco = hw ? `<div class="hw-moon"></div><div class="hw-fog"></div><div class="hw-bats">${Array.from({ length: 9 }, (_, k) => `<i style="--k:${k};top:${8 + (k * 37) % 70}%;animation-delay:${(k * 0.23).toFixed(2)}s">🦇</i>`).join('')}</div><div class="hw-pump">🎃</div>` : '';
                o.innerHTML = `<div class="sm-bg"></div>${hwDeco}${circleSvg(col)}<div class="sm-beam"></div><div class="sm-flash"></div>
                    <div class="sm-txt">${god ? '✨ GOD PACK ✨<br><small>Toutes les cartes sont rares !</small>' : hw ? '🎃 Les esprits se réveillent… 🎃' : best >= 9 ? 'Ω La réalité se déchire… Ω' : best >= 8 ? '♾️ Le temps s’arrête… ♾️' : best >= 7 ? '🌌 Les étoiles s’alignent… 🌌' : best >= 6 ? '👑 Une lumière céleste descend… 👑' : best >= 5 ? '🌈 Un secret se révèle… 🌈' : best >= 4 ? '🔥 Le cercle s’embrase ! 🔥' : best >= 3 ? '✨ Une énergie immense se dégage… ✨' : best === 2 ? 'Une aura puissante apparaît…' : 'Invocation…'}</div>
                    <div class="sm-cards">${cards.map((c, i) => `<div class="sm-card" data-i="${i}" style="animation-delay:${i * 0.08}s"><div class="sm-inner"><div class="sm-back${c.rarity === 'halloween' ? ' hwb' : ''}" style="--c:${c.rarity === 'halloween' ? '#ff7a00' : COL[RANK[c.rarity] || 0]}"><span>${c.rarity === 'halloween' ? '🎃' : '🎴'}</span></div><div class="sm-front">${cardHtml(c, true)}</div></div></div>`).join('')}</div>
                    <div class="sm-bottom"><button class="sm-skip" onclick="summonRevealAll()">⏭ Tout révéler</button><div class="sm-sum"></div></div>`;
                document.body.appendChild(o);
                o._cards = cards;
                const w = c => (RANK[c.rarity] || 0) + (c.shiny ? .5 : 0) + (c.finish ? .7 : 0);
                const order = cards.map((c, i) => i).sort((a, b) => w(cards[a]) - w(cards[b]));
                o._order = order;
                setTimeout(() => o.classList.add('charge'), wasPending ? 0 : 50);
                setTimeout(() => o.classList.add('burst'), wasPending ? 20 : 250);
                setTimeout(() => { o.classList.add('show'); summonNext(); }, wasPending ? 150 : 450);
                o.addEventListener('click', e => { if (e.target.closest('.sm-card') || e.target.closest('button')) return; if (o.classList.contains('done')) o.remove(); });
            };
            window.summonNext = function () {
                const o = document.getElementById('summon'); if (!o || o.classList.contains('done')) return;
                const i = o._order.shift();
                if (i == null) return summonDone();
                const c = o._cards[i], el = o.querySelector(`.sm-card[data-i="${i}"]`);
                const rank = RANK[c.rarity] || 0;
                const big = rank >= 2 || c.shiny || !!c.finish;
                const flip = () => {
                    el.classList.remove('tease', 't-high');
                    el.classList.add('flip');
                    smReveal(o, el, c);
                    if (big) { o.classList.add('shake'); setTimeout(() => o.classList.remove('shake'), 500); el.classList.add('wow'); }
                    // plus la carte est rare, plus on la laisse briller avant la suivante
                    o._t = setTimeout(summonNext, [200, 280, 400, 650, 800, 950, 1100, 1250, 1400, 1600][rank] + (c.shiny ? 150 : 0) + (c.finish ? 400 : 0) + (c.quote ? 600 : 0));
                };
                if (big) { el.classList.add('tease'); if (rank >= 5 || c.finish) el.classList.add('t-high'); if (c.finish) el.style.setProperty('--fc', (window.FIN_COL || {})[c.finish] || '#fff'); o._t = setTimeout(flip, rank >= 9 ? 1100 : rank >= 7 ? 850 : rank >= 5 ? 600 : 350); } else flip();
            };
            window.summonRevealAll = function () {
                const o = document.getElementById('summon'); if (!o) return;
                clearTimeout(o._t);
                o.classList.add('show');
                // on joue quand même l'animation de la meilleure carte pas encore révélée
                const hidden = o._order.map(i => ({ i, c: o._cards[i] }));
                const top = hidden.sort((a, b) => (RANK[b.c.rarity] || 0) - (RANK[a.c.rarity] || 0))[0];
                o.querySelectorAll('.sm-card').forEach(e => { e.classList.remove('tease', 't-high'); e.classList.add('flip'); });
                if (top) smReveal(o, o.querySelector(`.sm-card[data-i="${top.i}"]`), top.c);
                o._order = [];
                summonDone();
            };
            function summonDone() {
                const o = document.getElementById('summon'); if (!o || o.classList.contains('done')) return;
                o.classList.add('done');
                const cards = o._cards, news = cards.filter(c => c.isNew).length, coins = cards.reduce((a, c) => a + (c.coins || 0), 0);
                o.querySelector('.sm-sum').innerHTML = `${news} nouvelle${news > 1 ? 's' : ''} carte${news > 1 ? 's' : ''}${coins ? ` • doublons : +${coins} 🪙` : ''}`;
                const b = o.querySelector('.sm-skip'); b.textContent = '✔ Fermer'; b.onclick = () => o.remove();
            }
        })();
