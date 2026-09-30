(function () {
            const FIN_LABEL = { holo: 'Holo', reverse: 'Reverse Holo', glitter: 'Pailletée', gold: 'Gold', dark: 'Dark', fullart: 'Full Art', manga: 'Manga', galaxy: 'Galaxie', glitch: 'Glitch', signed: 'Signée', numbered: 'Numérotée' };
            const FIN_ICON = { holo: '🌈', reverse: '🪩', glitter: '✨', gold: '🥇', dark: '🌑', fullart: '🖼️', manga: '🖋️', galaxy: '🔮', glitch: '📺', signed: '✍️', numbered: '🔢' };
            const FIN_COL = window.FIN_COL = { holo: '#d7a8ff', reverse: '#8ff', glitter: '#fff2b3', gold: '#ffd700', dark: '#8a2be2', fullart: '#ffffff', manga: '#f5f5f5', galaxy: '#7b5cff', glitch: '#0ff', signed: '#ffd700', numbered: '#dfe9ff' };
            const FIN_ORDER = ['numbered', 'signed', 'glitch', 'galaxy', 'manga', 'fullart', 'dark', 'gold', 'glitter', 'reverse', 'holo'];
            const SPECIAL_RARS = ['secrete', 'divine', 'cosmique', 'eternelle', 'omega', 'halloween', 'eveillee', 'legende', 'noel', 'valentin', 'ete'];
            Object.assign(RAR_LABEL, { eveillee: 'Éveillée 🩸', legende: 'Légende vivante 👑', duo: 'Duo 🎴', noel: 'Noël 🎄', valentin: 'Saint-Valentin 💘', ete: 'Été ☀️', altart: 'Alt Art 🖼️', moment: 'Moment 🎬' });
            if (typeof MK_RAR !== 'undefined') Object.assign(MK_RAR, { eveillee: 'Éveillée', legende: 'Légende vivante', noel: 'Noël 🎄', valentin: 'Saint-Valentin 💘', ete: 'Été ☀️', altart: 'Alt Art 🖼️', moment: 'Moment 🎬' });
            const CARD_CACHE = window.CARD_CACHE = {};
            const esc = s => v7esc(s == null ? '' : String(s));
            function keyOf(c) {
                if (c.key) return c.key;
                const u = c.u || (window.__albumRender && typeof eco !== 'undefined' ? eco.albumU : null);
                if (!u || !c.name) return null;
                if (u === 'duo' || c.rarity === 'duo') return 'duo|' + c.name;
                return u + '|' + c.name + (c.secret || SPECIAL_RARS.includes(c.rarity) ? '|' + c.rarity : '');
            }
            const origCardHtml = cardHtml;
            cardHtml = function (c, big) {
                if (!c || !c.name) return origCardHtml(c, big);
                const key = keyOf(c);
                const ex = window.__albumRender && window.ALBUM_EXTRA && key ? window.ALBUM_EXTRA.fin[key] : null;
                const fin = c.finish || (ex && ex.f) || null, ser = c.serial || (ex && ex.ser) || null;
                if (key) CARD_CACHE[key] = Object.assign({}, c, { key, finish: fin, serial: ser });
                const imgs = c.imgs && c.imgs.length === 2
                    ? `<div class="tc-duo">${c.imgs.map(u => `<img src="/api/img?u=${encodeURIComponent(u)}" alt="" loading="lazy" onerror="this.style.opacity=.15">`).join('')}</div>`
                    : `<img src="${esc(c.img)}" alt="" loading="lazy" decoding="async" onerror="this.style.opacity=.15">`;
                const first = String(c.name).split(/[ &]/)[0];
                return `<div class="tcard r-${esc(c.rarity)}${c.shiny ? ' shiny' : ''}${big ? ' big' : ''}${fin ? ' f-' + fin : ''}"${key ? ` data-key="${esc(key)}"` : ''} style="--fc:${FIN_COL[fin] || '#fff'}"><i class="tc-bgfx"></i>
                    <div class="tc-img">${imgs}<i class="tc-fx"></i><i class="tc-glare"></i>${fin ? `<b class="tc-fin">${FIN_ICON[fin]} ${FIN_LABEL[fin]}</b>` : ''}${fin === 'signed' ? `<i class="tc-sign">${esc(first)}</i>` : ''}${ser && (fin === 'numbered' || fin === 'signed') ? `<b class="tc-ser">#${ser}${fin === 'numbered' ? '/' + (c.serialMax || 50) : ''}</b>` : ''}</div>
                    <div class="tc-name">${esc(c.name)}</div><div class="tc-rar">${c.shiny ? '✨ ' : ''}${RAR_LABEL[c.rarity] || esc(c.rarity)}${c.n > 1 ? ` • x${c.n}` : ''}</div>${c.isNew ? '<em class="tc-new">NOUVELLE</em>' : ''}${c.god ? '<em class="tc-god">GOD PACK</em>' : ''}</div>`;
            };

            /* --- effet 3D : la carte suit la souris --- */
            if (matchMedia('(hover:hover) and (pointer:fine)').matches) {
                let cur = null, raf = 0, ev = null;
                const apply = () => {
                    raf = 0; if (!cur || !ev || !cur.isConnected) return;
                    const r = cur.getBoundingClientRect(), x = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)), y = Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height));
                    cur.style.setProperty('--rx', ((0.5 - y) * 20).toFixed(1) + 'deg'); cur.style.setProperty('--ry', ((x - 0.5) * 24).toFixed(1) + 'deg');
                    cur.style.setProperty('--mx', (x * 100).toFixed(0) + '%'); cur.style.setProperty('--my', (y * 100).toFixed(0) + '%');
                };
                document.addEventListener('pointermove', e => {
                    const t = e.target.closest ? e.target.closest('.tcard:not(.empty)') : null;
                    if (t && t.closest('#card-inspect')) return;
                    if (t !== cur) { if (cur) cur.classList.remove('tilting'); cur = t; if (cur) cur.classList.add('tilting'); }
                    ev = e; if (cur && !raf) raf = requestAnimationFrame(apply);
                }, { passive: true });
            }

            /* --- effets plein écran quand une finition sort à l'invocation --- */
            window.finishFx = function (o, el, c) {
                const f = c.finish; if (!f) return;
                o.querySelectorAll('.fin-banner').forEach(b => b.remove());
                const b = document.createElement('div'); b.className = 'fin-banner'; b.style.setProperty('--fc', FIN_COL[f]);
                b.textContent = `${FIN_ICON[f]} ${FIN_LABEL[f].toUpperCase()}${c.serial && f === 'numbered' ? ` #${c.serial}/${c.serialMax || 50}` : c.serial && f === 'signed' ? ` #${c.serial}` : ''} ${FIN_ICON[f]}`;
                o.appendChild(b); setTimeout(() => b.remove(), 2600);
                const sc = document.createElement('div'); sc.className = 'fin-screen ' + f; o.appendChild(sc); setTimeout(() => sc.remove(), 3200);
                const add = (cls, txt, css) => { const i = document.createElement('i'); i.className = cls; if (txt) i.textContent = txt; i.style.cssText = css; sc.appendChild(i); return i; };
                if (f === 'holo' || f === 'reverse' || f === 'numbered') sc.classList.add('holo');
                if (f === 'glitter' || f === 'holo' || f === 'reverse') for (let k = 0; k < 26; k++) add('spark', '✨', `left:${Math.random() * 100}%;top:${Math.random() * 100}%;--dl:${(Math.random() * .8).toFixed(2)}s`);
                if (f === 'gold') for (let k = 0; k < 40; k++) add('coin', '🪙', `left:${Math.random() * 100}%;--d:${(1.4 + Math.random() * 1.4).toFixed(2)}s;--dl:${(Math.random() * .9).toFixed(2)}s`);
                if (f === 'dark') { o.classList.remove('fin-dark-flash'); void o.offsetWidth; o.classList.add('fin-dark-flash'); }
                if (f === 'galaxy') for (let k = 0; k < 50; k++) { const a = Math.random() * Math.PI * 2, d = 40 + Math.random() * 60; add('star', '', `--x:${(Math.cos(a) * d).toFixed(0)}vw;--y:${(Math.sin(a) * d).toFixed(0)}vh;--d:${(1 + Math.random()).toFixed(2)}s;--dl:${(Math.random() * .6).toFixed(2)}s`); }
                if (f === 'manga') ['ゴゴゴ', 'ドン!', 'ズキューン', 'ゴゴゴゴ', 'バーン!'].forEach((t, k) => add('ono', t, `left:${[8, 62, 12, 60, 36][k]}%;top:${[12, 16, 68, 70, 40][k]}%;--r:${(Math.random() * 24 - 12).toFixed(0)}deg;--dl:${(k * .12).toFixed(2)}s`));
                if (f === 'glitch') { o.classList.remove('glitch'); void o.offsetWidth; o.classList.add('glitch'); setTimeout(() => o.classList.remove('glitch'), 1900); }
                if (f === 'signed') add('sign-big', String(c.name).split(/[ &]/)[0], '');
                if (f === 'numbered') { const n = add('num-big', '', ''); n.innerHTML = `#${c.serial || '?'}<span style="opacity:.5">/${c.serialMax || 50}</span><small>TIRAGE LIMITÉ</small>`; }
                if (typeof bip === 'function' && typeof sfxOn !== 'undefined' && sfxOn) {
                    ({ gold: [1319, 1568, 2093, 2637], dark: [220, 185, 147], galaxy: [880, 660, 440, 220, 110], glitch: [100, 1200, 90, 1500], manga: [196, 196, 262], signed: [784, 988, 1175, 1568], numbered: [523, 784, 1047, 1568, 2093] }[f] || [1047, 1319, 1568, 2093])
                        .forEach((fr, k) => bip(fr, 0.14, 0.05, 0.25 + k * 0.08, f === 'glitch' ? 'square' : 'triangle'));
                }
            };
            window.quoteFx = function (o, c) {
                o.querySelectorAll('.sm-quote').forEach(q => q.remove());
                const q = document.createElement('div'); q.className = 'sm-quote';
                q.innerHTML = `« ${esc(c.quote)} »<small>— ${esc(c.name)}</small>`;
                setTimeout(() => { if (o.isConnected) { o.appendChild(q); setTimeout(() => q.remove(), 4600); } }, 900);
            };

            /* --- mode inspection : la carte en grand, en 3D --- */
            let ciOri = null;
            window.cardInspect = async function (key) {
                const c = CARD_CACHE[key]; if (!c) return;
                document.getElementById('card-inspect')?.remove();
                const o = document.createElement('div'); o.id = 'card-inspect';
                o.innerHTML = `<button class="ci-close">✖ Fermer</button><div class="ci-stage"><div class="ci-rot">${cardHtml(Object.assign({}, c, { isNew: false }), true)}</div></div>
                    <div class="ci-info"><h3>${esc(c.name)}</h3><div class="ci-sub">${esc(c.anime || '')} • ${RAR_LABEL[c.rarity] || esc(c.rarity)}${c.finish ? ' • ' + FIN_ICON[c.finish] + ' ' + FIN_LABEL[c.finish] : ''}</div><div class="ci-body"><div class="arc-spin" style="margin:10px auto;"></div></div>
                    <div class="tl-hint" style="text-align:left;">🖱️ Fais glisser la carte pour la faire tourner${typeof DeviceOrientationEvent !== 'undefined' ? ' • 📱 penche ton téléphone' : ''}.</div></div>`;
                document.body.appendChild(o);
                const close = () => { o.remove(); if (ciOri) { window.removeEventListener('deviceorientation', ciOri); ciOri = null; } };
                o.querySelector('.ci-close').onclick = close;
                o.addEventListener('click', e => { if (e.target === o) close(); });
                const stage = o.querySelector('.ci-stage'), rot = o.querySelector('.ci-rot');
                let cx = 0, cy = 0, sx = 0, sy = 0, drag = false;
                const setRot = () => { rot.style.setProperty('--cx', cx + 'deg'); rot.style.setProperty('--cy', cy + 'deg'); const t = rot.querySelector('.tcard'); if (t) { t.style.setProperty('--mx', (50 + cy / 1.8) + '%'); t.style.setProperty('--my', (50 - cx / 1.2) + '%'); t.classList.add('tilting'); t.style.transform = 'none'; } };
                stage.addEventListener('pointerdown', e => { drag = true; sx = e.clientX; sy = e.clientY; o.classList.add('drag'); stage.setPointerCapture && stage.setPointerCapture(e.pointerId); });
                stage.addEventListener('pointermove', e => { if (!drag) return; cy = Math.max(-180, Math.min(180, cy + (e.clientX - sx) * 0.6)); cx = Math.max(-45, Math.min(45, cx - (e.clientY - sy) * 0.4)); sx = e.clientX; sy = e.clientY; setRot(); });
                stage.addEventListener('pointerup', () => { drag = false; });
                stage.addEventListener('dblclick', () => { cx = 0; cy = 0; setRot(); o.classList.remove('drag'); });
                const startGyro = () => {
                    if (ciOri) return;
                    ciOri = e => { if (e.beta == null) return; o.classList.add('drag'); cx = Math.max(-35, Math.min(35, (e.beta - 45) * 0.7)); cy = Math.max(-40, Math.min(40, e.gamma * 0.9)); setRot(); };
                    window.addEventListener('deviceorientation', ciOri);
                };
                if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission !== 'function') startGyro();
                // infos : exemplaires, finitions, compteur mondial, réplique
                const body = o.querySelector('.ci-body');
                if (!isAccount() || key.startsWith('duo|') && !CARD_CACHE[key].n) { body.innerHTML = ''; }
                const d = isAccount() ? await v7get('/api/cards/info?key=' + encodeURIComponent(key)) : null;
                if (!o.isConnected) return;
                if (!d || !d.ok) { body.innerHTML = ''; return; }
                const mineF = Object.keys(d.mine), worldF = Object.entries(d.world);
                body.innerHTML = `<div class="ci-row">🃏 Tu en as <b>${d.n}</b> exemplaire${d.n > 1 ? 's' : ''}${d.shiny ? ` dont <b>${d.shiny}</b> brillante${d.shiny > 1 ? 's' : ''} ✨` : ''}</div>
                    <div class="ci-row">🌍 <b>${d.total}</b> exemplaire${d.total > 1 ? 's' : ''} de cette carte sur tout le serveur</div>
                    ${mineF.length ? `<div class="ci-row">Tes finitions : <div class="ci-chips">${['', ...mineF].map(f => `<button data-f="${f}" class="${(c.finish || '') === f ? 'on' : ''}">${f ? FIN_ICON[f] + ' ' + FIN_LABEL[f] + ' x' + d.mine[f] : 'Normale'}</button>`).join('')}</div></div>` : ''}
                    ${worldF.length ? `<div class="ci-row">${worldF.map(([f, n]) => `${FIN_ICON[f]} Il n’existe que <b>${n}</b> ${esc(c.name)} ${FIN_LABEL[f]}${f === 'numbered' ? ` (sur ${d.numberedMax} maximum)` : ''} sur le serveur`).join('<br>')}</div>` : ''}
                    ${Object.entries(d.serials || {}).map(([f, l]) => `<div class="ci-row">${FIN_ICON[f]} Tes numéros : ${l.map(n => '<b>#' + n + (f === 'numbered' ? '/' + d.numberedMax : '') + '</b>').join(', ')}</div>`).join('')}
                    ${d.quote ? `<div class="ci-row ci-quote">« ${esc(d.quote)} »</div>` : ''}
                    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;">
                        ${d.canUpgrade ? `<button class="btn-action" style="margin:0;flex:1;" data-act="up">✨ Améliorer la finition (5 doublons)</button>` : ''}
                        ${d.n ? `<button class="btn-action" style="margin:0;flex:1;background:#2a2a40;" data-act="vit">${d.showcase ? '🏛️ Retirer du musée' : '🏛️ Mettre au musée'}</button>` : ''}
                        ${typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function' ? `<button class="btn-action" style="margin:0;flex:1;background:#2a2a40;" data-act="gyro">📱 Gyroscope</button>` : ''}
                    </div>
                    ${!d.canUpgrade && d.n ? `<div class="tl-hint" style="text-align:left;">✨ Avec 6 exemplaires, tu peux fusionner 5 doublons pour passer ta carte en Holo, puis Gold, puis Galaxie.</div>` : ''}`;
                body.querySelectorAll('.ci-chips button').forEach(b => b.onclick = () => {
                    body.querySelectorAll('.ci-chips button').forEach(x => x.classList.toggle('on', x === b));
                    const f = b.dataset.f || null, ser = f && d.serials[f] ? Math.min(...d.serials[f]) : null;
                    rot.innerHTML = cardHtml(Object.assign({}, c, { finish: f, serial: ser, isNew: false }), true); setRot();
                });
                body.querySelectorAll('[data-act]').forEach(b => b.onclick = async () => {
                    const act = b.dataset.act;
                    if (act === 'gyro') { try { if ((await DeviceOrientationEvent.requestPermission()) === 'granted') startGyro(); } catch (_) {} return; }
                    if (act === 'vit') {
                        const r = await v7post('/api/cards/showcase', { key });
                        if (!r || !r.ok) return toast('❌ ' + ((r && r.error) || 'Impossible'), 'var(--accent-pink)');
                        const on = r.showcase.includes(key); b.textContent = on ? '🏛️ Retirer du musée' : '🏛️ Mettre au musée';
                        toast(on ? '🏆 Ajoutée à ton musée (visible sur ton profil public)' : 'Retirée du musée', '#ffd700'); return;
                    }
                    if (act === 'up') {
                        if (!confirm('Fusionner 5 doublons de cette carte pour améliorer sa finition ?')) return;
                        const r = await v7post('/api/cards/upgrade', { key });
                        if (!r || !r.ok) return toast('❌ ' + ((r && r.error) || 'Impossible'), 'var(--accent-pink)');
                        close(); showBooster([r.card]);
                        if (typeof loadAlbum === 'function' && document.getElementById('eco-album')) setTimeout(() => loadAlbum(eco.albumU), 400);
                    }
                });
            };
            document.addEventListener('click', e => {
                const t = e.target.closest ? e.target.closest('.tcard[data-key]') : null;
                if (!t || t.closest('#card-inspect') || e.target.closest('button,a')) return;
                const sm = t.closest('#summon'); if (sm && !sm.classList.contains('done')) return;
                if (t.closest('#adm-hw-list') || t.closest('[onclick]')) return;
                e.stopPropagation(); cardInspect(t.dataset.key);
            }, true);

            /* --- album : finitions, vitrine, cartes Duo, saisons, guide --- */
            window.cardFinishGuide = function () {
                document.getElementById('fin-guide-modal')?.remove();
                const sample = Object.values(CARD_CACHE).find(c => c.img && !c.imgs) || { name: 'Naruto Uzumaki', img: '/api/avatar/img?u=naruto&n=Naruto%20Uzumaki', u: 'naruto' };
                const RATES = { holo: '1/20', reverse: '1/30', glitter: '1/40', gold: '1/150', dark: '1/200', fullart: '1/250', manga: '1/300', galaxy: '1/400', glitch: '1/500', signed: '1/1000', numbered: '1/2000 • 50 max' };
                const m = document.createElement('div'); m.className = 'v7-modal'; m.id = 'fin-guide-modal';
                m.innerHTML = `<div class="v7-box" style="max-width:820px;"><button class="v7-close" onclick="this.closest('.v7-modal').remove()">✕</button><h3>✨ Finitions & raretés</h3>
                    <p class="tl-hint" style="text-align:left;">Chaque carte que tu gagnes peut sortir avec une <b>finition</b> en plus de sa rareté (la chance x2 / x10 marche aussi). Passe la souris sur une carte, ou clique dessus pour l’inspecter en 3D.</p>
                    <div class="fin-guide">${FIN_ORDER.slice().reverse().map(f => `<div>${cardHtml({ name: sample.name, img: sample.img, rarity: 'legendaire', finish: f, serial: f === 'numbered' ? 7 : f === 'signed' ? 12 : null })}<small>${FIN_ICON[f]} ${FIN_LABEL[f]} • ${RATES[f]}</small></div>`).join('')}</div>
                    <h3 style="margin-top:16px;">🆕 Nouvelles raretés</h3>
                    <div class="fin-guide">${[['eveillee', 'Éveillée • 1/900'], ['legende', 'Légende vivante • 1/6000'], ['duo', 'Duo • 1/300'], ['altart', 'Alt Art • bonus rare de booster'], ['moment', 'Moment • scène culte en bonus'], ['noel', 'Noël • décembre'], ['valentin', 'Saint-Valentin • février'], ['ete', 'Été • juillet-août']].map(([r, t]) => `<div>${cardHtml(r === 'duo' ? { name: 'Naruto & Sasuke', rarity: 'duo', imgs: ['https://s4.anilist.co/file/anilistcdn/character/large/b17-phjcWCkRuIhu.png', 'https://s4.anilist.co/file/anilistcdn/character/large/b13-SISLEw1oAD7a.png'] } : { name: sample.name, img: sample.img, rarity: r })}<small>${t}</small></div>`).join('')}</div>
                    <p class="tl-hint" style="text-align:left;margin-top:12px;">🎴 <b>God Pack</b> (1 booster sur 500) : toutes les cartes du paquet sont rares. • ✍️ Les cartes <b>Signées</b> et <b>Numérotées</b> ont un numéro unique. • 🏆 Expose jusqu’à <b>10 cartes</b> dans ton <b>Musée</b> public. • 📖 Termine un album pour gagner le cadre <b>Album complet</b>.</p></div>`;
                m.addEventListener('click', e => { if (e.target === m) m.remove(); });
                document.body.appendChild(m);
            };
            const origAlbum = loadAlbum;
            loadAlbum = async function (u) {
                const ex = isAccount() ? await v7get('/api/cards/extra') : null;
                window.ALBUM_EXTRA = ex && ex.ok ? ex : null;
                window.__albumRender = true;
                try { await origAlbum.apply(this, arguments); } finally { window.__albumRender = false; }
                const box = document.getElementById('eco-album'); if (!box || !window.ALBUM_EXTRA) return;
                const X = window.ALBUM_EXTRA;
                if (X.albumFrame) toast('📖 <b>Album complet !</b> Tu débloques le cadre exclusif « Album complet » (Boutique → Cadres).', '#ffd700');
                const head = document.createElement('div'); head.className = 'album-extra-head';
                head.innerHTML = `<button class="host-btn" onclick="cardFinishGuide()">✨ Finitions & raretés</button><span class="tl-hint">Clique sur une carte pour l’inspecter en 3D</span>`;
                const sh = box.querySelector('.shop-head'); if (sh) sh.after(head); else box.prepend(head);
                if (X.seasons.length) head.insertAdjacentHTML('afterend', `<div class="season-banner">${X.seasons.map(s => ({ noel: '🎄', valentin: '💘', ete: '☀️' }[s.id] + ' Cartes <b>' + s.label + '</b>')).join(' • ')} disponibles dans les boosters en ce moment !</div>`);
                if (eco.albumU) return;
                const list = box.querySelector('.album-list');
                if (X.showcaseCards && X.showcaseCards.length) {
                    const s = document.createElement('div'); s.innerHTML = `<h3 class="adm-h">🏛️ Mon musée</h3><div class="card-grid">${X.showcaseCards.map(c => cardHtml(c)).join('')}</div>`;
                    box.insertBefore(s, list);
                }
                const s2 = document.createElement('div');
                s2.innerHTML = `<h3 class="adm-h">🎴 Cartes Duo <small class="tl-hint">${X.duos.length}/${X.duoTotal} • 1 carte sur 300 dans les boosters</small></h3>${X.duos.length ? `<div class="card-grid">${X.duos.map(c => cardHtml(c)).join('')}</div>` : '<p class="tl-hint">Pas encore de carte Duo : elles tombent au hasard dans les boosters.</p>'}`;
                box.insertBefore(s2, list);
                const renderSpecialSet = (title, arr, total, rateText) => {
                    if (!Array.isArray(arr) || !total) return;
                    const own = arr.filter(c => c.owned).length;
                    const s = document.createElement('div');
                    s.innerHTML = `<h3 class="adm-h">${title} <small class="tl-hint">${own}/${total} • ${rateText}</small></h3><div class="card-grid">${arr.map(c => c.owned ? cardHtml(c) : cardHtml({ rarity:c.rarity, img:c.img })).join('')}</div>`;
                    box.insertBefore(s, list);
                };
                renderSpecialSet('🖼️ Alt Arts', X.altArts, X.altArtTotal, 'illustrations alternatives exclusives aux boosters');
                renderSpecialSet('🎬 Cartes Moment', X.moments, X.momentTotal, 'scènes cultes exclusives aux boosters');
            };
        })();
