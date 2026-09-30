/* =====================================================================
           HUB : accueil (boss, anime de la semaine, tournoi, coffre, week-end x2),
           duel classé, pass de saison, échanges, fusion, clans, stats, zoom,
           spectateurs, salon vocal, reconnexion, accessibilité
           ===================================================================== */
        const hub = { home: null, boss: null, rk: { queued: false, t0: 0, timer: null }, passData: null };
        const hubEsc = v7esc;
        function hubModal(id, html, wide) {
            document.getElementById(id)?.remove();
            const m = document.createElement('div'); m.className = 'v7-modal'; m.id = id;
            m.innerHTML = `<div class="v7-box hub-box${wide ? ' wide' : ''}"><button class="v7-close" onclick="this.closest('.v7-modal').remove()">✕</button>${html}</div>`;
            m.addEventListener('click', e => { if (e.target === m) m.remove(); });
            document.body.appendChild(m);
            return m;
        }
        function hubFmtLeft(ms) {
            if (ms <= 0) return 'maintenant';
            const s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
            return d ? `${d} j ${h} h` : h ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min ${String(s % 60).padStart(2, '0')} s`;
        }
        function tierBadge(t, elo) { return `<span class="rk-tier" style="--tc:${t.color}">${rkIcon(t.name)} ${hubEsc(t.name)}${elo != null ? ` <small>${elo}</small>` : ''}</span>`; }
        function rkIcon(n) { return { Bronze: '🥉', Argent: '🥈', Or: '🥇', Platine: '💠', Diamant: '💎', Kage: '🌀', Hokage: '🔥' }[n] || '🎖️'; }

        /* ---------- accueil ---------- */
        async function hubLoadHome() {
            const d = await v7get('/api/hub/home');
            if (!d || !d.ok) return;
            hub.home = d; hub.boss = d.boss; hub.homeAt = Date.now(); hub.skew = d.now - Date.now();
            hubRenderHome();
        }
        function hubRenderHome() {
            const box = document.getElementById('hub-home');
            const d = hub.home;
            if (!box || !d) return;
            const acc = isAccount();
            const wa = d.weekAnime, w = d.weekly, b = hub.boss || d.boss;
            const now = Date.now() + (hub.skew || 0);
            const lk = (typeof SITE_STATE !== 'undefined' && SITE_STATE.luck) || {};
            const weekendBar = (d.weekend ? `<div class="hub-weekend">🎉 <b>WEEK-END x2</b> : pièces et XP doublées jusqu'à dimanche minuit !</div>` : '')
                + (lk.admins && window.IS_ADMIN ? `<div class="hub-weekend" style="background:linear-gradient(90deg,#b8860b,#ffd700);color:#000;">👑 <b>CHANCE x10</b> (admin) : brillantes et raretés spéciales x10 !</div>`
                : lk.players ? `<div class="hub-weekend" style="background:linear-gradient(90deg,#00b862,#00ff88);color:#000;">🍀 <b>CHANCE x2</b> sur les cartes : plus de brillantes et de raretés spéciales !</div>` : '');
            const chest = acc && d.chest ? `<button class="hub-chest${d.chest.ready ? ' ready' : ''}" onclick="hubChest()"><span class="hc-ico">${d.chest.ready ? '🎁' : '📦'}</span><span><b>${d.chest.ready ? 'Coffre du jour prêt !' : 'Coffre du jour ouvert'}</b><small>${d.chest.ready ? `Jour ${d.chest.day}/7 de ta série` : `Série : ${d.chest.streak} jour${d.chest.streak > 1 ? 's' : ''} • reviens demain`}</small></span></button>` : '';
            const pass = acc && d.pass ? `<button class="hub-pass-mini" onclick="switchTab('collection');ecoTab('pass')"><span>🎟️ Pass de saison</span><b>Palier ${d.pass.tier}/30</b><span class="ab"><i style="width:${d.pass.tier >= 30 ? 100 : Math.round(100 * (d.pass.xp % d.pass.perTier) / d.pass.perTier)}%"></i></span></button>` : '';
            const bossHtml = b ? `<div class="hub-card boss${b.dead ? ' dead' : ''}" id="hub-boss">
                <div class="hb-img"><img src="${hubEsc(b.img)}" alt="" onerror="this.style.opacity=.2"></div>
                <div class="hb-main"><div class="hb-h">👹 Boss du serveur <small>${b.fighters} combattant${b.fighters > 1 ? 's' : ''}</small></div>
                <b class="hb-name">${hubEsc(b.name)} <small>${hubEsc(b.anime)}</small></b>
                <div class="hb-bar"><i style="width:${Math.round(100 * b.hp / b.max)}%"></i><span>${b.dead ? 'VAINCU !' : `${b.hp} / ${b.max} PV`}</span></div>
                <div class="tl-hint">${b.dead ? 'Tous les participants ont reçu 100 pièces et sa carte. Nouveau boss demain !' : 'Chaque bonne réponse, dans n’importe quel mode, lui enlève 10 PV (15 si tu réponds en moins de 3 s). S’il tombe aujourd’hui : 100 🪙 + sa carte pour tous les participants.'}</div>
                ${b.top && b.top.length ? `<div class="hb-top">${b.top.map((x, i) => `<span>${['🥇', '🥈', '🥉', '4.', '5.'][i]} ${hubEsc(x.name)} <b>${x.dmg}</b></span>`).join('')}</div>` : ''}</div></div>` : '';
            const mine = wa.mine;
            const weekHtml = `<div class="hub-card week"><div class="hb-img"><img src="${hubEsc(wa.img)}" alt="" onerror="this.style.opacity=.2"></div><div class="hb-main">
                <div class="hb-h">⭐ Anime de la semaine</div><b class="hb-name">${hubEsc(wa.name)}</b>
                <div class="tl-hint">Cartes brillantes x3 sur cet anime. Trouve ${wa.goal} persos cette semaine pour gagner la carte <b>Collector</b> de ${hubEsc(wa.main)} !</div>
                ${mine ? `<div class="hb-bar week"><i style="width:${Math.round(100 * mine.n / wa.goal)}%"></i><span>${mine.done ? '✅ Collector obtenue !' : `${mine.n} / ${wa.goal} persos`}</span></div>` : ''}
                <div class="hb-btns"><button onclick="createRoom('arcade','pixel:${wa.u}')">🖼️ Pixel</button><button onclick="createRoom('arcade','silhouette:${wa.u}')">👤 Silhouette</button><button onclick="createRoom('arcade','zoom:${wa.u}')">🔍 Zoom</button></div></div></div>`;
            let wk;
            if (w.open) wk = `<b>Inscriptions ouvertes !</b> ${w.players} joueur${w.players > 1 ? 's' : ''} inscrit${w.players > 1 ? 's' : ''} • départ à 20 h<div class="hb-btns"><button class="go" onclick="hubJoinWeekly('${w.code}')">🏆 Rejoindre le tournoi</button></div>`;
            else if (w.started) wk = `<b>Le tournoi est en cours !</b><div class="hb-btns"><button onclick="spectateRoom('${w.code}')">👁️ Regarder</button></div>`;
            else if (w.done && w.winner) wk = `🏆 Vainqueur de cette semaine : <b>${hubEsc(w.winner)}</b>`;
            else wk = w.nextAt && w.nextAt > now ? `Prochain tournoi dans <b data-hub-left="${w.nextAt}">${hubFmtLeft(w.nextAt - now)}</b> • inscriptions dès 19 h 45` : 'Tous les dimanches à 20 h (heure de Paris)';
            const weeklyHtml = `<div class="hub-card weekly"><div class="hb-main"><div class="hb-h">🏆 Tournoi du dimanche <small>20 h</small></div>
                <div class="tl-hint">Tournoi automatique chaque dimanche : 500 🪙 + le titre « Champion du dimanche » pour le vainqueur.</div><div class="hb-weekly">${wk}</div></div></div>`;
            box.innerHTML = weekendBar + (chest || pass ? `<div class="hub-row">${chest}${pass}</div>` : '') + bossHtml + weekHtml + weeklyHtml;
            hubRenderRankedCard();
        }
        setInterval(() => {
            document.querySelectorAll('[data-hub-left]').forEach(el => { el.textContent = hubFmtLeft(+el.dataset.hubLeft - (Date.now() + (hub.skew || 0))); });
            const rk = document.getElementById('rk-wait'); if (rk && hub.rk.queued) rk.textContent = hubFmtLeft(Date.now() - hub.rk.t0).replace('min', 'min');
        }, 1000);
        setInterval(() => { if (document.getElementById('menu-selection')?.style.display !== 'none' && !document.hidden) hubLoadHome(); }, 60000);
        socket.on('connect', () => setTimeout(hubLoadHome, 1100));
        (function () { const orig = window.switchTab; window.switchTab = function (t) { const r = orig.apply(this, arguments); if (t === 'mode') hubLoadHome(); return r; }; })();
        socket.on('boss_state', b => { hub.boss = b; if (hub.home) hubRenderHome(); });
        socket.on('boss_down', d => { toast(`👹 <b>${hubEsc(d.name)}</b> est vaincu ! Coup final : ${hubEsc(d.killer)}`, '#ff5a2a'); hubLoadHome(); });
        socket.on('boss_reward', d => { toast(`👹 Boss vaincu : +${d.coins} 🪙 et la carte de ${hubEsc(d.name)} !`, '#ffd700'); confetti(1500); });
        socket.on('collector_gain', d => { hubModal('collector-modal', `<h3>⭐ Carte Collector !</h3><div class="card-grid booster" style="justify-content:center;"><div class="flip">${collectorCard(d)}</div></div><p class="tl-hint">Tu as trouvé 15 persos de ${hubEsc(d.anime)} cette semaine. Elle est dans ton album.</p>`); confetti(2000); });
        socket.on('mastery_gain', d => { toast(`🏅 <b>Maîtrise ${hubEsc(d.anime)}</b> : 100 bonnes réponses ! Badge doré débloqué`, '#ffd700'); confetti(1800); });
        socket.on('pass_tier', d => toast(`🎟️ Pass de saison : palier <b>${d.tier}</b> atteint ! Récupère ta récompense`, '#b77bff'));
        socket.on('weekly_open', d => toast(`🏆 Le tournoi du dimanche ouvre ! <button class="toast-btn" onclick="hubJoinWeekly('${d.code}')">Rejoindre</button>`, '#00ff88'));
        socket.on('weekly_result', d => toast(`🏆 <b>${hubEsc(d.winner)}</b> remporte le tournoi du dimanche !`, '#ffd700'));
        socket.on('weekly_win', d => { toast(`🏆 Tu as gagné le tournoi du dimanche ! +${d.coins} 🪙 + titre « Champion du dimanche »`, '#ffd700'); confetti(3000); });
        socket.on('clan_event', d => toast(d.text, '#ffd700'));
        socket.on('site_settings', () => setTimeout(() => { if (hub.home) hubRenderHome(); }, 0)); // bannière chance x2 / x10
        socket.on('rare_pull', d => { toast(`${{ cosmique: '🌌', eternelle: '♾️', omega: 'Ω' }[d.rarity] || '✨'} <b>${hubEsc(d.who)}</b> vient d'obtenir <b>${hubEsc(d.name)}</b> ${d.shiny ? 'brillante ' : ''}en carte <b>${hubEsc(d.label)}</b> !`, { cosmique: '#7b5cff', eternelle: '#ffd700', omega: '#ffffff' }[d.rarity]); if (d.rarity !== 'cosmique') confetti(3000); });
        socket.on('trade_live_invite', d => { toast(`🔴 <b>${hubEsc(d.from)}</b> a ouvert un échange direct avec toi <button class="toast-btn" onclick="switchTab('collection');ecoTab('trade')">Ouvrir</button>`, '#48dbfb'); if (document.getElementById('eco-trade')?.style.display !== 'none') loadTrade(); });
        socket.on('trade_live_state', d => { if (!d || !d.ok) return; trd.session = d.session || null; if (document.getElementById('eco-trade')?.style.display !== 'none') { if (!trd.mine.length) loadTrade(); else tradeRender(); } });
        socket.on('trade_live_closed', () => { trd.session = null; if (document.getElementById('eco-trade')?.style.display !== 'none') loadTrade(); });
        socket.on('trade_done', d => { toast(d.text, '#48dbfb'); if (/terminé/i.test(d.text || '')) confetti(1000); if (document.getElementById('eco-trade')?.style.display !== 'none') loadTrade(); });
        function hubJoinWeekly(code) {
            if (currentRoomCode && currentRoomCode !== code) socket.emit('leave_room', { roomCode: currentRoomCode });
            switchTab('mode');
            currentRoomCode = code;
            socket.emit('join_room', { roomCode: code, username: getUsername(), mode: 'arcade', subMode: 'tournoi' });
        }
        async function hubChest() {
            if (!hub.home || !hub.home.chest || !hub.home.chest.ready) { const d = await v7get('/api/chest'); if (d && d.ok) hubModal('chest-modal', `<h3>📦 Coffre du jour</h3><p>Série actuelle : <b>${d.streak}</b> jour${d.streak > 1 ? 's' : ''}. Reviens demain pour le jour ${d.day} !</p><div class="chest-days">${d.rewards.map((r, i) => `<div class="${i + 1 < d.day ? 'past' : i + 1 === d.day ? 'next' : ''}"><b>J${i + 1}</b><small>${r}</small></div>`).join('')}</div>`); return; }
            const d = await v7post('/api/chest/open', {});
            if (!d || !d.ok) return toast('❌ ' + ((d && d.error) || 'Impossible'), 'var(--accent-pink)');
            if (typeof eco !== 'undefined') { eco.coins = d.total; ecoCoinsUi(); }
            hubModal('chest-modal', `<h3>🎁 Coffre du jour</h3><div class="chest-open">🎁</div><p style="font-size:1.2rem;"><b>+${d.coins} 🪙</b></p><p class="tl-hint">Série : ${d.streak} jour${d.streak > 1 ? 's' : ''} d’affilée${d.streak % 7 === 6 ? ' • demain : booster offert !' : ''}</p>${d.cards && d.cards.length ? `<div class="card-grid booster" style="justify-content:center;">${d.cards.map((c, i) => `<div class="flip" style="animation-delay:${i * .15}s">${cardHtml(c, true)}</div>`).join('')}</div>` : ''}`);
            confetti(1400);
            hubLoadHome();
        }

        /* ---------- duel classé ---------- */
        function hubRenderRankedCard() {
            const box = document.getElementById('ranked-card-body');
            if (!box) return;
            const r = hub.home && hub.home.ranked;
            if (!isAccount()) { box.innerHTML = `<p class="tl-hint">Crée un compte pour jouer en classé.</p>`; return; }
            if (!r) { box.innerHTML = ''; return; }
            const t = r.tier, pct = t.next ? Math.round(100 * (r.elo - t.min) / (t.next - t.min)) : 100;
            box.innerHTML = `<div class="rk-me">${tierBadge(t, r.elo)}<span class="tl-hint">${r.w} V • ${r.l} D${r.d ? ` • ${r.d} N` : ''}</span></div>
                <div class="hb-bar rk"><i style="width:${pct}%;background:${t.color}"></i><span>${t.next ? `${t.next - r.elo} pts avant ${hubEsc(t.nextName)}` : 'Rang maximum !'}</span></div>
                <div class="hb-btns"><button class="go" id="rk-btn" onclick="rankedToggle()">${hub.rk.queued ? '✖ Annuler la recherche' : '⚔️ Chercher un adversaire'}</button><button onclick="rankedBoard()">🏆 Classement</button></div>`;
        }
        function rankedToggle() {
            if (!isAccount()) return toast('Crée un compte pour jouer en classé.', 'var(--accent-pink)');
            if (hub.rk.queued) { socket.emit('ranked_leave'); hub.rk.queued = false; document.getElementById('rk-ovl')?.remove(); hubRenderRankedCard(); return; }
            if (currentRoomCode) { socket.emit('leave_room', { roomCode: currentRoomCode }); currentRoomCode = ''; }
            socket.emit('ranked_queue');
        }
        socket.on('ranked_queued', () => {
            hub.rk.queued = true; hub.rk.t0 = Date.now();
            document.getElementById('rk-ovl')?.remove();
            const o = document.createElement('div'); o.id = 'rk-ovl'; o.className = 'rk-ovl';
            o.innerHTML = `<div class="rk-box"><div class="rk-spin">⚔️</div><b>Recherche d'un adversaire…</b><div class="tl-hint">Mini-jeu tiré au sort • 7 manches • tu peux continuer à naviguer</div><div id="rk-wait" class="rk-wait">0 min 00 s</div><button onclick="rankedToggle()">Annuler</button></div>`;
            document.body.appendChild(o);
            hubRenderRankedCard();
        });
        socket.on('ranked_error', d => toast('❌ ' + d.message, 'var(--accent-pink)'));
        socket.on('ranked_found', d => {
            hub.rk.queued = false;
            const o = document.getElementById('rk-ovl') || document.body.appendChild(Object.assign(document.createElement('div'), { id: 'rk-ovl', className: 'rk-ovl' }));
            const me = hub.home && hub.home.ranked;
            o.innerHTML = `<div class="rk-box vs"><div class="rk-vs"><div><b>${hubEsc(getUsername())}</b>${me ? tierBadge(me.tier, me.elo) : ''}</div><span class="rk-x">VS</span><div><b>${hubEsc(d.opponent.name)}</b>${tierBadge(d.opponent.tier, d.opponent.elo)}</div></div>
                <div class="rk-game">🎮 ${hubEsc(d.game)} • 7 manches</div><div class="tl-hint">La partie démarre…</div></div>`;
            if (currentRoomCode && currentRoomCode !== d.roomCode) socket.emit('leave_room', { roomCode: currentRoomCode });
            switchTab('mode');
            currentRoomCode = d.roomCode;
            socket.emit('join_room', { roomCode: d.roomCode, username: getUsername(), mode: 'arcade', subMode: d.subMode });
            setTimeout(() => document.getElementById('rk-ovl')?.remove(), 12000);
        });
        socket.on('ranked_countdown', () => setTimeout(() => document.getElementById('rk-ovl')?.remove(), 3300));
        socket.on('ranked_cancel', d => { document.getElementById('rk-ovl')?.remove(); toast(d.message, 'var(--accent-pink)'); currentRoomCode = ''; goToMenuSelection(); });
        socket.on('ranked_result', d => {
            const t = d.tier, pct = t.next ? Math.round(100 * (d.elo - t.min) / (t.next - t.min)) : 100;
            const title = d.result === 'win' ? '🏆 Victoire !' : d.result === 'lose' ? '💀 Défaite' : '🤝 Match nul';
            setTimeout(() => {
                hubModal('rk-result', `<h3 class="rk-res ${d.result}">${title}</h3><div class="rk-delta ${d.delta >= 0 ? 'up' : 'down'}">${d.delta >= 0 ? '+' : ''}${d.delta} pts</div>
                    ${d.promoted ? `<div class="rk-promo">⬆️ Nouveau rang : ${tierBadge(t)}</div>` : ''}
                    <div style="margin:10px 0;">${tierBadge(t, d.elo)}</div><div class="hb-bar rk"><i style="width:${pct}%;background:${t.color}"></i><span>${t.next ? `${t.next - d.elo} pts avant ${hubEsc(t.nextName)}` : 'Rang maximum !'}</span></div>
                    ${d.coins ? `<p>+${d.coins} 🪙</p>` : ''}<div class="hb-btns" style="justify-content:center;"><button class="go" onclick="document.getElementById('rk-result').remove();leaveRoom();setTimeout(rankedToggle,300)">⚔️ Rejouer en classé</button><button onclick="document.getElementById('rk-result').remove();leaveRoom()">Menu</button></div>`);
                if (d.result === 'win') confetti(2000);
                hubLoadHome();
            }, 2500);
        });
        async function rankedBoard() {
            const d = await v7get('/api/ranked');
            if (!d || !d.ok) return;
            hubModal('rk-board', `<h3>🏆 Classement duel classé</h3><div class="rk-tiers">${d.tiers.map(t => `<span style="--tc:${t.color}">${rkIcon(t.name)} ${hubEsc(t.name)} <small>${t.min}+</small></span>`).join('')}</div>
                ${d.top.length ? `<div class="rk-list">${d.top.map((x, i) => `<div class="${x.me ? 'me' : ''}"><span>${i + 1}.</span><b>${hubEsc(x.name)}</b>${tierBadge(x.tier, x.elo)}<small>${x.w}V ${x.l}D</small></div>`).join('')}</div>` : '<p class="tl-hint">Personne n’a encore joué en classé cette saison. Sois le premier !</p>'}
                <p class="tl-hint">${d.queue} joueur${d.queue > 1 ? 's' : ''} en recherche en ce moment • victoire = +25 🪙</p>`);
        }

        /* ---------- onglets de la Collection ---------- */
        (function () {
            const orig = ecoTab;
            const NEW = ['pass', 'trade', 'fuse', 'clan', 'stats', 'museum'];
            ecoTab = function (t) {
                if (!NEW.includes(t)) { NEW.forEach(k => { const el = document.getElementById('eco-' + k); if (el) el.style.display = 'none'; }); return orig(t); }
                eco.tab = t;
                document.querySelectorAll('.eco-tabs button').forEach(b => b.classList.toggle('on', b.dataset.t === t));
                ['shop', 'album', 'titles', 'challenges', ...NEW].forEach(k => { const el = document.getElementById('eco-' + k); if (el) el.style.display = k === t ? '' : 'none'; });
                const box = document.getElementById('eco-' + t);
                if (!isAccount()) { box.innerHTML = '<p class="tl-hint">Crée un compte pour accéder à cette partie.</p>'; return; }
                ({ pass: loadPass, trade: loadTrade, fuse: loadFuse, clan: loadClan, stats: loadStats, museum: loadMuseum })[t]();
            };
        })();
        function collectorCard(c) {
            return `<div class="tcard r-legendaire shiny collector"><div class="tc-img"><img src="${hubEsc(c.img)}" alt="" loading="lazy" onerror="this.style.opacity=.15"></div><div class="tc-name">${hubEsc(c.name)}</div><div class="tc-rar">⭐ Collector${c.week ? ' • ' + hubEsc(c.week) : ''}</div></div>`;
        }
        // album : section collector
        (function () {
            const orig = loadAlbum;
            loadAlbum = async function (u) {
                await orig.apply(this, arguments);
                if (eco.albumU) return;
                const d = await v7get('/api/cards');
                const box = document.getElementById('eco-album');
                if (!d || !d.ok || !box || !(d.collectors || []).length || box.querySelector('.collector-sec')) return;
                const sec = document.createElement('div'); sec.className = 'collector-sec';
                sec.innerHTML = `<h3 class="adm-h">⭐ Cartes Collector</h3><div class="card-grid">${d.collectors.map(collectorCard).join('')}</div>`;
                box.insertBefore(sec, box.querySelector('.album-list'));
            };
        })();

        // --- pass de saison ---
        async function loadPass() {
            const box = document.getElementById('eco-pass');
            const d = await v7get('/api/pass');
            if (!d || !d.ok) return;
            hub.passData = d;
            const inTier = d.tier >= 30 ? d.perTier : d.xp % d.perTier;
            const cell = (t, track) => {
                const got = d.claimed[track].includes(t.tier), reached = t.tier <= d.tier, locked = track === 'prem' && !d.premium;
                const lab = track === 'free' ? t.free : t.prem;
                return `<div class="ps-cell ${track}${got ? ' got' : reached && !locked ? ' ready' : ''}${locked ? ' locked' : ''}"><small>${hubEsc(lab)}</small>${got ? '<b>✔</b>' : reached && !locked ? `<button onclick="passClaim(${t.tier},'${track}')">Récupérer</button>` : locked ? '<b>🔒</b>' : ''}</div>`;
            };
            box.innerHTML = `<div class="ps-head"><div><h3>🎟️ Pass de saison <small>${hubEsc(d.season)}</small></h3><div class="tl-hint">Gagne de l’XP de pass en jouant (x2 le week-end) • fin de saison dans <b data-hub-left="${d.endsAt}">${hubFmtLeft(d.endsAt - Date.now())}</b></div></div>
                ${d.premium ? '<span class="ps-prem-on">⭐ Premium actif</span>' : `<button class="ps-buy" onclick="passBuy()">⭐ Pass premium : 🪙 ${d.price}</button>`}</div>
                <div class="ps-prog"><b>Palier ${d.tier}/30</b><div class="hb-bar"><i style="width:${Math.round(100 * inTier / d.perTier)}%"></i><span>${d.tier >= 30 ? 'Pass terminé !' : `${inTier} / ${d.perTier} XP`}</span></div></div>
                <div class="tl-hint">Premium : couleur <b>Aurore</b> (palier 10), cadre <b>Flammes</b> (20), effet <b>Aurore boréale</b> (25), titre <b>Légende de la saison</b> (30) + plus de pièces et de boosters.</div>
                <div class="ps-grid"><div class="ps-lab"><span></span><span>Gratuit</span><span>⭐ Premium</span></div>${d.tiers.map(t => `<div class="ps-col${t.tier <= d.tier ? ' on' : ''}${t.tier === d.tier + 1 ? ' cur' : ''}"><span class="ps-n">${t.tier}</span>${cell(t, 'free')}${cell(t, 'prem')}</div>`).join('')}</div>`;
            const cur = box.querySelector('.ps-col.cur') || box.querySelector('.ps-col.on:last-of-type');
            if (cur) cur.scrollIntoView({ block: 'nearest', inline: 'center' });
        }
        async function passBuy() {
            if (!confirm(`Acheter le pass premium pour ${hub.passData ? hub.passData.price : 1200} pièces ?`)) return;
            const d = await v7post('/api/pass/buy', {});
            if (!d || !d.ok) return toast('❌ ' + ((d && d.error) || 'Impossible'), 'var(--accent-pink)');
            eco.coins = d.coins; ecoCoinsUi(); toast('⭐ Pass premium activé !', '#ffd700'); confetti(1500); loadPass();
        }
        async function passClaim(tier, track) {
            const d = await v7post('/api/pass/claim', { tier, track });
            if (!d || !d.ok) return toast('❌ ' + ((d && d.error) || 'Impossible'), 'var(--accent-pink)');
            eco.coins = d.coins; ecoCoinsUi();
            if (d.got.cards) showBooster(d.got.cards); else toast(`🎟️ ${hubEsc(d.label)} récupéré !`, '#b77bff');
            if (d.got.item) { await ecoLoad(); if (d.got.item.startsWith('title:')) toast('🏷️ Nouveau titre dans l’onglet Titres !', '#ffd700'); }
            loadPass();
        }

        // --- échanges directs ---
        const trd = { friend: null, friends: [], mine: [], session: null, q1: '', r1: '', showHistory: false };
        const TRD_ORD = ['omega', 'eternelle', 'legende', 'cosmique', 'divine', 'eveillee', 'secrete', 'moment', 'altart', 'halloween', 'noel', 'valentin', 'ete', 'collector', 'duo', 'mythique', 'legendaire', 'epique', 'rare', 'commune'];
        const TRD_FIN = { holo: '🌈 Holo', reverse: '🪩 Reverse', glitter: '✨ Pailletée', gold: '🥇 Gold', dark: '🌑 Dark', fullart: '🖼️ Full Art', manga: '🖋️ Manga', galaxy: '🔮 Galaxie', glitch: '📺 Glitch', signed: '✍️ Signée', numbered: '🔢 Numérotée' };
        const trdId = c => c.key + '#' + (c.finish || '');
        const trdSplit = id => { const i = String(id || '').lastIndexOf('#'); return i < 0 ? [String(id || ''), null] : [id.slice(0, i), id.slice(i + 1) || null]; };
        function trdCard(c, empty) {
            if (!c) return `<div class="trd-c trd-card"><div style="width:86px;height:108px;border:2px dashed #3b3b55;border-radius:10px;display:grid;place-items:center;font-size:1.7rem;">${empty || '❔'}</div><small>Aucune carte</small></div>`;
            return `<div class="trd-c trd-card">${cardHtml({ name:c.name, anime:c.anime, img:c.img, imgs:c.imgs, rarity:c.rarity || 'commune', finish:c.finish || null })}<small>${hubEsc(c.anime || '')}</small></div>`;
        }
        async function loadTrade() {
            const box = document.getElementById('eco-trade'); if (!box) return;
            const [d, cards] = await Promise.all([v7get('/api/trade'), v7get('/api/trade/cards')]);
            if (!d || !d.ok) { box.innerHTML = '<p class="tl-hint">Impossible de charger les échanges.</p>'; return; }
            trd.friends = d.friends || []; trd.session = d.session || null; trd.mine = (cards && cards.cards) || [];
            tradeRender();
            if (trd.showHistory) tradeLoadHistory();
        }
        function tradeRender() {
            const box = document.getElementById('eco-trade'); if (!box) return;
            const hist = `<label style="display:flex;align-items:center;gap:8px;margin:10px 0;cursor:pointer;"><input id="trd-history-toggle" type="checkbox" ${trd.showHistory ? 'checked' : ''} onchange="tradeHistoryToggle(this.checked)"> 🕘 Voir l’historique des échanges</label><div id="trd-history" style="display:${trd.showHistory ? '' : 'none'};"></div>`;
            if (!trd.session) {
                const online = trd.friends.filter(f => f.online);
                box.innerHTML = `<div class="shop-head">🔁 <b>Échange en direct</b> <span class="tl-hint">• chacun choisit uniquement dans sa propre collection</span></div>
                    <div class="trd-row" style="padding:14px;"><b>Ouvrir une table d’échange</b><p class="tl-hint" style="margin:3px 0 8px;">Choisis un ami connecté. Tu ne verras jamais sa collection : il posera lui-même sa carte.</p>
                    ${online.length ? `<div class="ch-in"><select id="trd-friend" class="v7-input"><option value="">Choisis un ami connecté…</option>${online.map(f => `<option value="${f.id}" ${f.busy ? 'disabled' : ''}>${hubEsc(f.pseudo)}${f.busy ? ' • déjà en échange' : ''}</option>`).join('')}</select><button class="btn-action" style="width:auto;margin:0;" onclick="tradeOpen()">Ouvrir</button></div>` : '<p class="tl-hint">Aucun ami n’est connecté pour le moment.</p>'}</div>${hist}`;
                return;
            }
            const s = trd.session, me = s.me, other = s.other;
            const myPicked = me.card ? trdId(me.card) : '';
            const status = s.phase === 'confirm'
                ? `<div class="trd-row" style="border-color:#ffd700;text-align:center;"><b>⚠️ Confirmation finale</b><p class="tl-hint" style="margin:4px 0;">Les deux joueurs ont accepté. Vérifie une dernière fois les deux cartes.</p><div class="trd-act"><button class="go" ${me.confirmed ? 'disabled' : ''} onclick="tradeConfirm(true)">${me.confirmed ? '✅ Confirmé — attente…' : '🔒 Confirmer définitivement'}</button><button onclick="tradeConfirm(false)">↩ Revenir</button></div></div>`
                : `<div class="trd-act"><button class="go" ${!(me.card && other.card) || me.accepted ? 'disabled' : ''} onclick="tradeDecision(true)">${me.accepted ? '✅ Accepté — attente de ' + hubEsc(other.name) : '✔ Accepter l’échange'}</button><button onclick="tradeDecision(false)">✖ Refuser / quitter</button></div>`;
            box.innerHTML = `<div class="shop-head">🔴 <b>Échange en direct avec ${hubEsc(other.name)}</b></div>
                <div class="trd-row"><div class="trd-swap"><div><b>Toi</b>${trdCard(me.card, '🃏')}<small>${me.accepted ? '✅ accepté' : 'en attente'}</small></div><span>⇄</span><div><b>${hubEsc(other.name)}</b>${trdCard(other.card, '⌛')}<small>${other.accepted ? '✅ accepté' : 'choisit sa carte'}</small></div></div>${status}</div>
                <h3 class="adm-h">🃏 Tes cartes</h3><p class="tl-hint">Clique sur une carte pour la poser. Si tu changes de carte, les validations des deux joueurs sont automatiquement annulées.</p>
                <div class="ch-in"><input class="v7-input" placeholder="🔎 Chercher dans tes cartes" value="${hubEsc(trd.q1)}" oninput="trd.q1=this.value;tradeLists()"><select class="trd-sel" style="max-width:210px" onchange="trd.r1=this.value;tradeLists()"><option value="">Toutes les raretés</option><option value="fin"${trd.r1 === 'fin' ? ' selected' : ''}>✨ Avec finition</option>${TRD_ORD.filter(r => trd.mine.some(c => c.rarity === r)).map(r => `<option value="${r}"${trd.r1 === r ? ' selected' : ''}>${RAR_LABEL[r] || r}</option>`).join('')}</select></div>
                <div class="trd-list" id="trd-l-give"></div>${hist}`;
            tradeLists(myPicked);
        }
        function tradeLists(selected) {
            const g = document.getElementById('trd-l-give'); if (!g) return;
            const rk = r => { const i = TRD_ORD.indexOf(r); return i < 0 ? 99 : i; };
            const f = trd.mine.filter(c => (!trd.q1 || (c.name + ' ' + c.anime).toLowerCase().includes(trd.q1.toLowerCase())) && (!trd.r1 || (trd.r1 === 'fin' ? !!c.finish : c.rarity === trd.r1)))
                .sort((a, b) => rk(a.rarity) - rk(b.rarity) || (b.finish ? 1 : 0) - (a.finish ? 1 : 0) || a.name.localeCompare(b.name, 'fr'));
            const sel = selected != null ? selected : (trd.session && trd.session.me.card ? trdId(trd.session.me.card) : '');
            g.innerHTML = (f.length > 100 ? `<p class="tl-hint" style="grid-column:1/-1;">${f.length} cartes : utilise la recherche ou le filtre (100 premières affichées)</p>` : '') + f.slice(0, 100).map(c => {
                const img = c.imgs && c.imgs.length === 2 ? `<span class="tm-duo">${c.imgs.map(u => `<img src="/api/img?u=${encodeURIComponent(u)}" alt="" loading="lazy">`).join('')}</span>` : `<img src="${hubEsc(c.img)}" alt="" loading="lazy" onerror="this.style.opacity=.15">`;
                return `<button class="trd-mini r-${c.rarity}${c.finish ? ' f-' + c.finish : ''}${sel === trdId(c) ? ' on' : ''}" style="--fc:${(window.FIN_COL || {})[c.finish] || '#fff'}" onclick="tradeSelect(${JSON.stringify(trdId(c)).replace(/"/g, '&quot;')})">${img}${c.finish ? `<span class="tm-fin">${TRD_FIN[c.finish]}</span>` : ''}<b>${hubEsc(c.name)}</b><small class="trd-rar">${RAR_LABEL[c.rarity] || (c.rarity === 'collector' ? '⭐ Collector' : c.rarity)}${c.shiny ? ' ✨' : ''}${c.n > 1 ? ' • x' + c.n : ''}</small><small>${hubEsc(c.anime)}</small></button>`;
            }).join('') || '<p class="tl-hint">Aucune carte.</p>';
        }
        async function tradeOpen() {
            const sel = document.getElementById('trd-friend'), fid = +(sel && sel.value || 0);
            if (!fid) return toast('Choisis un ami connecté.', 'var(--accent-pink)');
            const d = await v7post('/api/trade/live/open', { friendId: fid });
            if (!d || !d.ok) return toast('❌ ' + ((d && d.error) || 'Impossible'), 'var(--accent-pink)');
            trd.session = d.session; tradeRender(); toast('🔴 Table d’échange ouverte.', '#48dbfb');
        }
        async function tradeSelect(id) {
            if (!trd.session) return;
            const [key, finish] = trdSplit(id);
            const d = await v7post('/api/trade/live/select', { key, finish });
            if (!d || !d.ok) return toast('❌ ' + ((d && d.error) || 'Impossible'), 'var(--accent-pink)');
            trd.session = d.session; tradeRender();
        }
        async function tradeDecision(accept) {
            const d = await v7post('/api/trade/live/decision', { accept: !!accept });
            if (!d || !d.ok) return toast('❌ ' + ((d && d.error) || 'Impossible'), 'var(--accent-pink)');
            if (d.closed) { trd.session = null; loadTrade(); return; }
            trd.session = d.session; tradeRender();
        }
        async function tradeConfirm(confirm) {
            const d = await v7post('/api/trade/live/confirm', { confirm: !!confirm });
            if (!d || !d.ok) return toast('❌ ' + ((d && d.error) || 'Impossible'), 'var(--accent-pink)');
            if (d.done) { trd.session = null; confetti(1100); await loadTrade(); return; }
            trd.session = d.session; tradeRender();
        }
        function tradeHistoryToggle(on) { trd.showHistory = !!on; const b = document.getElementById('trd-history'); if (b) b.style.display = on ? '' : 'none'; if (on) tradeLoadHistory(); }
        async function tradeLoadHistory() {
            const b = document.getElementById('trd-history'); if (!b || !trd.showHistory) return;
            b.innerHTML = '<p class="tl-hint">Chargement de l’historique…</p>';
            const d = await v7get('/api/trade/history'); if (!d || !d.ok) { b.innerHTML = '<p class="tl-hint">Historique indisponible.</p>'; return; }
            const lab = { done:'✅ Terminé', refused:'❌ Refusé', cancelled:'Annulé', failed:'⚠️ Échoué', expired:'⌛ Expiré' };
            b.innerHTML = d.history.length ? `<h3 class="adm-h">🕘 Historique</h3>${d.history.map(h => `<div class="trd-row"><div><b>${hubEsc(h.other.name || 'Joueur')}</b> • <small>${new Date(h.at).toLocaleString('fr-FR')}</small> • ${lab[h.status] || hubEsc(h.status)}</div><div class="trd-swap">${trdCard(h.mine.card, '—')}<span>⇄</span>${trdCard(h.other.card, '—')}</div></div>`).join('')}` : '<p class="tl-hint">Aucun ancien échange.</p>';
        }

        // --- fusion ---
        async function loadFuse(result) {
            const box = document.getElementById('eco-fuse');
            const d = await v7get('/api/cards/fuse');
            if (!d || !d.ok) return;
            const R = [['commune', 'rare', 'Commune', 'Rare'], ['rare', 'epique', 'Rare', 'Épique'], ['epique', 'legendaire', 'Épique', 'Légendaire'], ['legendaire', 'mythique', 'Légendaire', 'Mythique 🔥'], ['mythique', 'secrete', 'Mythique', 'Secrète 🌈'], ['secrete', 'divine', 'Secrète', 'Divine 👑'], ['divine', 'cosmique', 'Divine', 'Cosmique 🌌'], ['cosmique', 'eternelle', 'Cosmique', 'Éternelle ♾️'], ['eternelle', 'omega', 'Éternelle', 'Ω Oméga'], ['omega', 'omega', 'Oméga', 'Oméga brillante ✨']].filter(([r]) => r !== 'omega' || d.spares.omega > 0);
            box.innerHTML = `<div class="shop-head">⚗️ Fusion de cartes <span class="tl-hint">• 5 doublons de la même rareté = 1 carte de la rareté au-dessus (tu gardes toujours un exemplaire de chaque carte)</span></div>
                ${result ? `<div class="fuse-res"><div class="card-grid booster" style="justify-content:center;"><div class="flip">${cardHtml(result, true)}</div></div></div>` : ''}
                <div class="fuse-grid">${R.map(([r, to, a, b]) => `<div class="fuse-row r-${r}"><div class="fuse-from"><b>${d.spares[r]}</b> doublon${d.spares[r] > 1 ? 's' : ''} ${a}</div><div class="fuse-arrow">5 ➜ 1</div><div class="fuse-to">${b}</div><button ${d.spares[r] >= 5 ? '' : 'disabled'} onclick="fuseGo('${r}')">⚗️ Fusionner</button></div>`).join('')}</div>`;
        }
        async function fuseGo(r) {
            const d = await v7post('/api/cards/fuse', { rarity: r });
            if (!d || !d.ok) return toast('❌ ' + ((d && d.error) || 'Impossible'), 'var(--accent-pink)');
            if (d.card && (d.card.shiny || ['legendaire', 'mythique', 'secrete', 'divine', 'cosmique', 'eternelle', 'omega', 'halloween'].includes(d.card.rarity))) confetti(1600);
            loadFuse(d.card);
        }

        // --- clans ---
        const clanDraft = { emblem: '🐉', color: '#ffd700' };
        const CLAN_TYPE_LABEL = { open: '🔓 Ouvert', invite: '✉️ Sur invitation', closed: '🔒 Fermé' };
        const CLAN_TYPE_HINT = { open: 'tout le monde peut entrer', invite: 'il faut envoyer une demande', closed: 'seulement sur invitation' };
        const CLAN_ROLE_ICON = { leader: '👑', coleader: '⭐', elder: '🛡️', member: '' };
        const CLAN_RANK = { member: 0, elder: 1, coleader: 2, leader: 3 };
        let clanData = null;
        function clanRoleBadge(role, names) { return `<span class="clan-role r-${role}">${CLAN_ROLE_ICON[role] ? CLAN_ROLE_ICON[role] + ' ' : ''}${hubEsc((names || {})[role] || role)}</span>`; }
        function clanTypeBadge(t) { return `<span class="clan-type t-${t}">${CLAN_TYPE_LABEL[t] || t}</span>`; }
        async function loadClan() {
            const box = document.getElementById('eco-clan');
            const d = await v7get('/api/clans');
            if (!d || !d.ok) return;
            clanData = d;
            const boardHtml = `<h3 class="adm-h">🏆 Classement de la semaine</h3><div class="tl-hint">Chaque partie jouée par un membre rapporte des points au clan (10 à 60, x2 le week-end). Récompenses le lundi : ${d.rewards.map((r, i) => `${i + 1}${i ? 'e' : 'er'} : ${r} 🪙`).join(' • ')} pour chaque membre.</div>
                ${d.lastWinners && d.lastWinners.winners && d.lastWinners.winners.length ? `<div class="tl-hint">Semaine dernière : ${d.lastWinners.winners.map((w, i) => `${['🥇', '🥈', '🥉'][i]} ${hubEsc(w.emblem)} ${hubEsc(w.name)}`).join(' • ')}</div>` : ''}
                <div class="clan-board">${d.board.length ? d.board.map((c, i) => `<div class="${d.mine && d.mine.id === c.id ? 'me' : ''}"><span>${i + 1}.</span><span class="clan-emb" style="--cc:${c.color}">${hubEsc(c.emblem)}</span><b>${hubEsc(c.name)} <small style="color:${c.color}">[${hubEsc(c.tag)}]</small></b><small title="${CLAN_TYPE_HINT[c.type] || ''}">${(CLAN_TYPE_LABEL[c.type] || '').split(' ')[0]}</small><small>${c.members} 👥</small><b>${c.pts} pts</b><button onclick="clanView('${c.id}')">Voir</button></div>`).join('') : '<p class="tl-hint">Aucun clan pour l’instant : crée le premier !</p>'}</div>`;
            if (d.mine) {
                const c = d.mine, my = CLAN_RANK[c.myRole] || 0;
                const act = m => {
                    if (m.id === undefined) return '';
                    const r = CLAN_RANK[m.role] || 0, b = [];
                    if (my === 3 && r === 2) b.push(`<button onclick="clanRole(${m.id},'promote',true)">👑 Nommer chef</button>`);
                    else if (my >= 2 && r + 1 < my) b.push(`<button onclick="clanRole(${m.id},'promote')">⬆️ Promouvoir</button>`);
                    if (my >= 2 && r > 0 && r < my) b.push(`<button onclick="clanRole(${m.id},'demote')">⬇️ Rétrograder</button>`);
                    if (my >= 1 && r < my) b.push(`<button class="danger" onclick="clanKick(${m.id})">Exclure</button>`);
                    return b.length ? `<div class="clan-acts">${b.join('')}</div>` : '';
                };
                const reqs = my >= 1 ? `<h3 class="adm-h">✉️ Demandes pour rejoindre (${c.requests.length})</h3>${c.requests.length ? `<div class="clan-members">${c.requests.map(r => `<div><b>${hubEsc(r.name)} <small>niv. ${r.level || 1}</small>${r.msg ? `<br><small class="tl-hint">« ${hubEsc(r.msg)} »</small>` : ''}</b><div class="clan-acts"><button class="ok" onclick="clanReq(${r.uid},true)">✔ Accepter</button><button class="danger" onclick="clanReq(${r.uid},false)">✖</button></div></div>`).join('')}</div>` : '<p class="tl-hint">Aucune demande en attente.</p>'}
                    <div class="clan-invite"><input id="clan-inv-pseudo" class="v7-input" maxlength="20" placeholder="Pseudo du joueur à inviter"><button class="btn-action" onclick="clanInvite()">✉️ Inviter</button></div>` : '';
                const settings = my >= 2 ? `<details class="clan-edit"><summary>⚙️ Modifier le clan</summary>
                    <label class="clan-l">Bio du clan<textarea id="clan-e-bio" class="v7-input" maxlength="200" rows="3" placeholder="Présente ton clan, vos règles…">${hubEsc(c.bio)}</textarea></label>
                    <label class="clan-l">Type<select id="clan-e-type" class="v7-input">${Object.keys(CLAN_TYPE_LABEL).map(t => `<option value="${t}" ${t === c.type ? 'selected' : ''}>${CLAN_TYPE_LABEL[t]} (${CLAN_TYPE_HINT[t]})</option>`).join('')}</select></label>
                    <label class="clan-l">Niveau minimum pour entrer<input id="clan-e-lvl" class="v7-input" type="number" min="0" max="100" value="${c.minLevel || 0}"></label>
                    <button class="btn-action" onclick="clanEdit({bio:document.getElementById('clan-e-bio').value,type:document.getElementById('clan-e-type').value,minLevel:document.getElementById('clan-e-lvl').value},'✅ Clan modifié')">💾 Enregistrer</button>
                    <div class="clan-embs">${d.emblems.map(e => `<button class="${e === c.emblem ? 'on' : ''}" onclick="clanEdit({emblem:'${e}'})">${e}</button>`).join('')}</div><label>Couleur <input type="color" value="${c.color}" onchange="clanEdit({color:this.value})"></label></details>` : '';
                box.innerHTML = `<div class="clan-head" style="--cc:${c.color}"><span class="clan-emb big">${hubEsc(c.emblem)}</span><div style="min-width:0;flex:1;"><h3>${hubEsc(c.name)} <span style="color:${c.color}">[${hubEsc(c.tag)}]</span></h3>
                        <div class="tl-hint">${clanTypeBadge(c.type)} ${c.minLevel ? `• niv. ${c.minLevel} min.` : ''} • ${c.members.length}/${d.max} membres • ${c.rank ? `${c.rank}${c.rank > 1 ? 'e' : 'er'} cette semaine • ` : ''}<b>${c.pts} pts</b></div>
                        <div class="tl-hint">Ton rôle : ${clanRoleBadge(c.myRole, d.roles)}</div></div></div>
                    ${c.bio ? `<div class="clan-bio">${hubEsc(c.bio)}</div>` : ''}
                    <h3 class="adm-h">👥 Membres</h3><div class="clan-members">${c.members.map(m => `<div class="${m.me ? 'me' : ''}"><b>${hubEsc(m.name)} ${clanRoleBadge(m.role, d.roles)}</b><span>${m.pts} pts</span>${m.me ? '' : act(m)}</div>`).join('')}</div>
                    ${reqs}${settings}
                    <details class="clan-edit"><summary>ℹ️ Qui peut faire quoi ?</summary><div class="tl-hint">🛡️ <b>Aîné</b> : inviter, accepter les demandes, exclure des membres.<br>⭐ <b>Chef adjoint</b> : + promouvoir en aîné, exclure des aînés, modifier le clan.<br>👑 <b>Chef</b> : tout + nommer des chefs adjoints et passer son titre.</div></details>
                    <div class="hb-btns"><button onclick="clanLeave()">🚪 Quitter le clan</button></div>` + boardHtml;
                return;
            }
            const invHtml = d.invites && d.invites.length ? `<h3 class="adm-h">✉️ Invitations reçues</h3><div class="clan-members">${d.invites.map(i => `<div><span class="clan-emb" style="--cc:${i.color}">${hubEsc(i.emblem)}</span><b>${hubEsc(i.name)} <small style="color:${i.color}">[${hubEsc(i.tag)}]</small><br><small class="tl-hint">invité par ${hubEsc(i.from)}</small></b><div class="clan-acts"><button onclick="clanView('${i.id}')">Voir</button><button class="ok" onclick="clanInvResp('${i.id}',true)">✔ Rejoindre</button><button class="danger" onclick="clanInvResp('${i.id}',false)">✖</button></div></div>`).join('')}</div>` : '';
            const pendHtml = d.pending ? `<div class="tl-hint clan-pending">⏳ Demande envoyée au clan <b>${hubEsc(d.pending.name)}</b> <button onclick="clanAct('/api/clans/cancel-request',{},'Demande annulée')">Annuler</button></div>` : '';
            box.innerHTML = invHtml + pendHtml + `<div class="clan-create"><h3>🛡️ Créer un clan <small>🪙 ${d.price}</small></h3>
                <input id="clan-name" class="v7-input" maxlength="20" placeholder="Nom du clan (ex : Akatsuki)"><input id="clan-tag" class="v7-input" maxlength="4" placeholder="Tag (2 à 4 lettres, ex : AKA)" style="text-transform:uppercase">
                <textarea id="clan-bio" class="v7-input" maxlength="200" rows="2" placeholder="Bio du clan (facultatif)"></textarea>
                <select id="clan-type" class="v7-input">${Object.keys(CLAN_TYPE_LABEL).map(t => `<option value="${t}">${CLAN_TYPE_LABEL[t]} (${CLAN_TYPE_HINT[t]})</option>`).join('')}</select>
                <input id="clan-lvl" class="v7-input" type="number" min="0" max="100" placeholder="Niveau minimum (facultatif)">
                <div class="clan-embs">${d.emblems.map(e => `<button class="${e === clanDraft.emblem ? 'on' : ''}" onclick="clanDraft.emblem='${e}';this.parentNode.querySelectorAll('button').forEach(b=>b.classList.toggle('on',b===this))">${e}</button>`).join('')}</div>
                <label>Couleur du tag <input type="color" value="${clanDraft.color}" onchange="clanDraft.color=this.value"></label>
                <button class="btn-action" onclick="clanCreate()">🛡️ Créer mon clan</button></div>` + boardHtml;
        }
        async function clanView(id) {
            const d = await v7get('/api/clans/view?id=' + encodeURIComponent(id));
            if (!d || !d.ok) return toast('❌ ' + ((d && d.error) || 'Clan introuvable'), 'var(--accent-pink)');
            const c = d.clan, mine = clanData && clanData.mine, lvl = (clanData && clanData.level) || 0;
            const invited = clanData && (clanData.invites || []).some(i => i.id === c.id);
            let btn = '';
            if (!mine) {
                if (invited) btn = `<button class="btn-action" onclick="clanInvResp('${c.id}',true);this.closest('.v7-modal').remove()">✔ Accepter l’invitation</button>`;
                else if (c.count >= d.max) btn = '<p class="tl-hint">Clan complet.</p>';
                else if (c.minLevel && lvl < c.minLevel) btn = `<p class="tl-hint">Il faut être niveau ${c.minLevel} (tu es niveau ${lvl}).</p>`;
                else if (c.type === 'open') btn = `<button class="btn-action" onclick="clanJoin('${c.id}');this.closest('.v7-modal').remove()">🛡️ Rejoindre</button>`;
                else if (c.type === 'invite') btn = `<input id="clan-req-msg" class="v7-input" maxlength="100" placeholder="Petit message (facultatif)"><button class="btn-action" onclick="clanJoin('${c.id}',document.getElementById('clan-req-msg').value);this.closest('.v7-modal').remove()">✉️ Envoyer une demande</button>`;
                else btn = '<p class="tl-hint">🔒 Clan fermé : il faut être invité par un chef ou un aîné.</p>';
            }
            hubModal('clan-view', `<div class="clan-head" style="--cc:${c.color}"><span class="clan-emb big">${hubEsc(c.emblem)}</span><div><h3>${hubEsc(c.name)} <span style="color:${c.color}">[${hubEsc(c.tag)}]</span></h3>
                <div class="tl-hint">${clanTypeBadge(c.type)} ${c.minLevel ? `• niv. ${c.minLevel} min.` : ''} • ${c.count}/${d.max} membres • <b>${c.pts} pts</b> cette semaine</div></div></div>
                <div class="clan-bio">${c.bio ? hubEsc(c.bio) : '<i>Pas encore de bio.</i>'}</div>
                <div class="clan-members">${c.members.map(m => `<div><b>${hubEsc(m.name)} ${clanRoleBadge(m.role, d.roles)}</b><span>${m.pts} pts</span></div>`).join('')}</div>${btn}`);
        }
        async function clanAct(url, body, okMsg) {
            const d = await v7post(url, body);
            if (!d || !d.ok) return toast('❌ ' + ((d && d.error) || 'Impossible'), 'var(--accent-pink)');
            if (okMsg) toast(typeof okMsg === 'function' ? okMsg(d) : okMsg, '#ffd700');
            ecoLoad(); loadClan();
        }
        function clanCreate() { clanAct('/api/clans/create', { name: document.getElementById('clan-name').value, tag: document.getElementById('clan-tag').value, emblem: clanDraft.emblem, color: clanDraft.color, bio: document.getElementById('clan-bio').value, type: document.getElementById('clan-type').value, minLevel: document.getElementById('clan-lvl').value }, '🛡️ Clan créé !'); }
        function clanJoin(id, msg) { clanAct('/api/clans/join', { id, msg: msg || '' }, d => d.requested ? '✉️ Demande envoyée ! Un aîné ou un chef va te répondre.' : '🛡️ Bienvenue dans le clan !'); }
        function clanLeave() { if (confirm('Quitter ton clan ?')) clanAct('/api/clans/leave', {}, 'Tu as quitté le clan.'); }
        function clanKick(id) { if (confirm('Exclure ce joueur du clan ?')) clanAct('/api/clans/kick', { id }); }
        function clanRole(id, action, transfer) { if (transfer && !confirm('Nommer ce joueur chef ? Tu deviendras chef adjoint.')) return; clanAct('/api/clans/role', { id, action }, action === 'promote' ? '⬆️ Promu !' : '⬇️ Rétrogradé'); }
        function clanReq(uid, accept) { clanAct('/api/clans/requests/respond', { uid, accept }, accept ? '🛡️ Nouveau membre !' : 'Demande refusée'); }
        function clanInvite() { const i = document.getElementById('clan-inv-pseudo'); clanAct('/api/clans/invite', { pseudo: i.value }, d => `✉️ Invitation envoyée à ${d.name} !`); }
        function clanInvResp(id, accept) { clanAct('/api/clans/invites/respond', { id, accept }, accept ? '🛡️ Bienvenue dans le clan !' : 'Invitation refusée'); }
        function clanEdit(o, msg) { clanAct('/api/clans/edit', o, msg); }
        // tag du clan devant le pseudo, partout
        (function () {
            const orig = cosNameHtml;
            cosNameHtml = function (name, cos) { const c = cos && cos.clan; return (c && c.tag ? `<span class="cn-clan" style="color:${hubEsc(c.color || '#ffd700')}">[${hubEsc(c.tag)}]</span>` : '') + orig(name, cos); };
        })();

        // --- stats par anime + maîtrise ---
        async function loadStats() {
            const box = document.getElementById('eco-stats');
            const d = await v7get('/api/hub/stats');
            if (!d || !d.ok) return;
            const masters = d.list.filter(a => a.mastery);
            box.innerHTML = `${d.best || d.worst ? `<div class="best-worst"><div>💪 Tu es fort sur<b style="color:#00ff88">${hubEsc(d.best ? d.best.anime : '—')}</b>${d.best ? d.best.pct + ' % de bonnes réponses' : ''}</div><div>😵 Tu galères sur<b style="color:var(--accent-pink)">${hubEsc(d.worst ? d.worst.anime : '—')}</b>${d.worst ? d.worst.pct + ' % de bonnes réponses' : ''}</div></div>` : ''}
                <div class="shop-head">🏅 <b>${masters.length}</b> anime${masters.length > 1 ? 's' : ''} maîtrisé${masters.length > 1 ? 's' : ''} <span class="tl-hint">• ${d.goal} bonnes réponses sur un anime = badge doré</span></div>
                ${masters.length ? `<div class="mastery-badges">${masters.map(a => `<span class="mst-badge">🏅 ${hubEsc(a.anime)}</span>`).join('')}</div>` : ''}
                ${d.list.length ? `<div class="stat-list">${d.list.map(a => `<div class="${a.mastery ? 'gold' : ''}"><div class="sl-top"><b>${a.mastery ? '🏅 ' : ''}${hubEsc(a.anime)}</b><span>${a.pct} % • ${a.ok}/${a.n}${a.ms ? ` • ${(a.ms / 1000).toFixed(1)} s` : ''}</span></div>
                    <div class="sl-bar"><i style="width:${a.pct}%;background:${a.pct >= 70 ? '#00ff88' : a.pct >= 40 ? '#ffd700' : 'var(--accent-pink)'}"></i></div>
                    <div class="sl-mst"><span class="ab"><i style="width:${Math.min(100, Math.round(100 * a.ok / d.goal))}%"></i></span><small>${a.mastery ? 'Maîtrisé !' : `Maîtrise : ${a.ok}/${d.goal}`}</small></div></div>`).join('')}</div>` : '<p class="tl-hint">Joue quelques parties pour voir tes stats par anime.</p>'}`;
        }

        /* ---------- Zoom extrême : dessin ---------- */
        function arcDrawZoom(canvas, img, t, focus) {
            const ctx = canvas.getContext('2d');
            const W = canvas.width, H = canvas.height;
            ctx.fillStyle = '#0b0b10'; ctx.fillRect(0, 0, W, H);
            const base = Math.min(W / img.width, H / img.height);
            const e = Math.min(1, Math.max(0, t));
            const zoom = Math.pow(9, 1 - Math.pow(e, 0.85)); // x9 au début → x1 à la fin
            const fx = focus ? focus.x : 0.5, fy = focus ? focus.y : 0.4;
            const k = Math.min(1, (zoom - 1) / 8);          // on se recentre en dézoomant
            const cx = 0.5 + (fx - 0.5) * k, cy = 0.5 + (fy - 0.5) * k;
            const s = base * zoom, dw = img.width * s, dh = img.height * s;
            let x = W / 2 - cx * dw, y = H / 2 - cy * dh;
            if (dw >= W) x = Math.min(0, Math.max(W - dw, x)); else x = (W - dw) / 2;
            if (dh >= H) y = Math.min(0, Math.max(H - dh, y)); else y = (H - dh) / 2;
            ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, x, y, dw, dh);
        }

        /* ---------- mode spectateur ---------- */
        const spect = { code: null };
        socket.on('public_rooms', () => socket.emit('list_live_rooms'));
        socket.on('live_rooms', list => {
            const panel = document.getElementById('public-rooms-panel');
            if (!panel) return;
            let box = document.getElementById('live-rooms-list');
            if (!box) { box = document.createElement('div'); box.id = 'live-rooms-list'; box.className = 'public-rooms-list'; panel.appendChild(box); }
            box.innerHTML = `<div class="public-rooms-head"><span>🔴 Parties en cours (mode spectateur)</span></div>` + (list && list.length ? list.map(r => `<div class="public-room live"><div class="public-room-info"><span class="public-room-mode">${r.weekly ? '🏆 ' : ''}${hubEsc(r.modeLabel)}${r.subLabel ? ' · ' + hubEsc(r.subLabel) : ''}</span><span class="public-room-meta">👥 ${r.players} joueur${r.players > 1 ? 's' : ''} · 👁️ ${r.spectators} · #${hubEsc(r.code)}</span></div><button class="btn-action" onclick="spectateRoom('${r.code}')">👁️ Regarder</button></div>`).join('') : '<div class="public-empty">Aucune partie publique en cours.</div>');
        });
        function spectateRoom(code) {
            if (currentRoomCode) { socket.emit('leave_room', { roomCode: currentRoomCode }); currentRoomCode = ''; }
            socket.emit('spectate_room', { roomCode: code });
        }
        socket.on('spectate_error', d => toast('👁️ ' + d.message, 'var(--accent-pink)'));
        socket.on('spectate_ok', d => {
            spect.code = d.roomCode;
            document.body.classList.add('spectating');
            switchTab('mode');
            hideAllPanels();
            const ms = document.getElementById('menu-selection'); if (ms) ms.style.display = 'none';
            let bar = document.getElementById('spect-bar');
            if (!bar) { bar = document.createElement('div'); bar.id = 'spect-bar'; document.body.appendChild(bar); }
            const lab = d.label ? `${d.label.modeLabel}${d.label.subLabel ? ' · ' + d.label.subLabel : ''}` : 'Partie';
            bar.innerHTML = `<span>👁️ <b>Tu regardes</b> ${hubEsc(lab)} <small id="spect-n"></small></span><span class="sp-react">${['😂', '🔥', '😱', '👏', '💀', '🤯', '🐐'].map(e => `<button onclick="socket.emit('spectate_react',{emoji:'${e}'})">${e}</button>`).join('')}</span><button class="sp-quit" onclick="spectateLeave()">✖ Quitter</button>`;
            const wait = document.getElementById('spect-wait') || document.body.appendChild(Object.assign(document.createElement('div'), { id: 'spect-wait' }));
            wait.innerHTML = '<div class="arc-spin"></div><div>La partie s’affiche dès la prochaine manche…</div>';
            wait.style.display = 'block';
        });
        ['arc_state', 'bt_state', 'quote_state', 'dle_state', 'draw_state', 'guess_state', 'rg_state'].forEach(ev => socket.on(ev, () => { if (spect.code) { const w = document.getElementById('spect-wait'); if (w) w.style.display = 'none'; } }));
        socket.on('spectators', d => { const el = document.getElementById('spect-n'); if (el && spect.code === d.roomCode) el.textContent = `• ${d.n} spectateur${d.n > 1 ? 's' : ''}`; });
        function spectateLeave() {
            socket.emit('spectate_leave');
            spect.code = null;
            document.body.classList.remove('spectating');
            document.getElementById('spect-bar')?.remove(); document.getElementById('spect-wait')?.remove();
            goToMenuSelection();
        }

        /* ---------- salon vocal (WebRTC) ---------- */
        const vc = { on: false, stream: null, peers: new Map(), muted: false, code: null, ctx: null };
        const VC_ICE = { iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }] };
        function vcUi() {
            let fab = document.getElementById('voice-fab');
            if (!fab) { fab = document.createElement('button'); fab.id = 'voice-fab'; fab.onclick = () => vcPanel(true); document.body.appendChild(fab); }
            const inRoom = !!currentRoomCode && !spect.code;
            fab.style.display = inRoom || vc.on ? '' : 'none';
            fab.className = vc.on ? (vc.muted ? 'on muted' : 'on') : '';
            fab.innerHTML = vc.on ? (vc.muted ? '🔇' : '🎙️') + `<small>${vc.peers.size + 1}</small>` : '🎙️';
            fab.title = vc.on ? 'Salon vocal' : 'Rejoindre le salon vocal';
            const p = document.getElementById('voice-panel');
            if (p) vcPanel(false);
        }
        function vcPanel(toggle) {
            let p = document.getElementById('voice-panel');
            if (toggle && p) { p.remove(); return; }
            if (!p) { if (!toggle) return; p = document.createElement('div'); p.id = 'voice-panel'; document.body.appendChild(p); }
            if (!vc.on) {
                p.innerHTML = `<b>🎙️ Salon vocal</b><p class="tl-hint">Parle avec les joueurs de ton salon, sans Discord. Ton micro n’est utilisé que pendant que tu es connecté au vocal.</p><button class="go" onclick="vcStart()">Rejoindre le vocal</button><button onclick="document.getElementById('voice-panel').remove()">Fermer</button>`;
                return;
            }
            p.innerHTML = `<b>🎙️ Salon vocal</b><div class="vc-list"><div class="vc-p me" id="vc-me"><span class="vc-dot"></span>${hubEsc(getUsername())} (toi)${vc.muted ? ' 🔇' : ''}</div>${[...vc.peers].map(([id, pr]) => `<div class="vc-p" id="vc-${id}"><span class="vc-dot"></span>${hubEsc(pr.name)}${pr.muted ? ' 🔇' : ''}${pr.state && pr.state !== 'connected' ? ` <small>(${pr.state === 'failed' ? 'connexion impossible' : 'connexion…'})</small>` : ''}</div>`).join('')}</div>
                <div class="hb-btns"><button onclick="vcMute()">${vc.muted ? '🔊 Réactiver le micro' : '🔇 Couper le micro'}</button><button onclick="vcStop()">📴 Quitter</button></div>`;
        }
        async function vcStart() {
            if (!currentRoomCode) return toast('Rejoins d’abord un salon.', 'var(--accent-pink)');
            if (!navigator.mediaDevices || !window.RTCPeerConnection) return toast('Ton navigateur ne gère pas le vocal.', 'var(--accent-pink)');
            try { vc.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
            catch (e) { return toast('🎙️ Accès au micro refusé.', 'var(--accent-pink)'); }
            vc.on = true; vc.muted = false; vc.code = currentRoomCode;
            socket.emit('voice_join', { roomCode: currentRoomCode });
            vcMeter('me', vc.stream);
            vcUi(); vcPanel(false);
        }
        function vcStop() {
            if (vc.on) socket.emit('voice_leave');
            vc.peers.forEach(p => { try { p.pc.close(); } catch (_) {} if (p.audio) p.audio.remove(); });
            vc.peers.clear();
            if (vc.stream) vc.stream.getTracks().forEach(t => t.stop());
            vc.stream = null; vc.on = false; vc.code = null;
            document.getElementById('voice-panel')?.remove();
            vcUi();
        }
        function vcMute() {
            vc.muted = !vc.muted;
            if (vc.stream) vc.stream.getAudioTracks().forEach(t => { t.enabled = !vc.muted; });
            socket.emit('voice_state', { muted: vc.muted });
            vcUi();
        }
        function vcMeter(id, stream) {
            try {
                vc.ctx = vc.ctx || new (window.AudioContext || window.webkitAudioContext)();
                const an = vc.ctx.createAnalyser(); an.fftSize = 512;
                vc.ctx.createMediaStreamSource(stream).connect(an);
                const buf = new Uint8Array(an.fftSize);
                const tick = () => {
                    if (!vc.on || (id !== 'me' && !vc.peers.has(id))) return;
                    an.getByteTimeDomainData(buf);
                    let s = 0; for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; s += v * v; }
                    const el = document.getElementById(id === 'me' ? 'vc-me' : 'vc-' + id);
                    if (el) el.classList.toggle('talk', Math.sqrt(s / buf.length) > 0.04 && !(id === 'me' && vc.muted));
                    setTimeout(tick, 120);
                };
                tick();
            } catch (_) {}
        }
        function vcPeer(id, name, initiator) {
            if (vc.peers.has(id)) return vc.peers.get(id);
            const pc = new RTCPeerConnection(VC_ICE);
            const pr = { pc, name, audio: null, ice: [], state: 'new', muted: false };
            vc.peers.set(id, pr);
            vc.stream.getTracks().forEach(t => pc.addTrack(t, vc.stream));
            pc.onicecandidate = e => { if (e.candidate) socket.emit('voice_signal', { to: id, data: { ice: e.candidate } }); };
            pc.ontrack = e => {
                if (!pr.audio) { pr.audio = document.createElement('audio'); pr.audio.autoplay = true; pr.audio.playsInline = true; pr.audio.style.display = 'none'; document.body.appendChild(pr.audio); }
                pr.audio.srcObject = e.streams[0];
                pr.audio.play().catch(() => toast('🔊 Touche l’écran pour entendre le vocal', '#48dbfb'));
                vcMeter(id, e.streams[0]);
            };
            pc.onconnectionstatechange = () => { pr.state = pc.connectionState; vcUi(); };
            if (initiator) pc.createOffer().then(o => pc.setLocalDescription(o)).then(() => socket.emit('voice_signal', { to: id, data: { sdp: pc.localDescription } })).catch(() => {});
            vcUi();
            return pr;
        }
        socket.on('voice_peers', d => { if (vc.on) (d.peers || []).forEach(p => vcPeer(p.id, p.name, true)); });
        socket.on('voice_peer_joined', d => { if (vc.on) { vcPeer(d.id, d.name, false); toast(`🎙️ ${hubEsc(d.name)} a rejoint le vocal`, '#48dbfb'); } });
        socket.on('voice_peer_left', d => { const p = vc.peers.get(d.id); if (!p) return; try { p.pc.close(); } catch (_) {} if (p.audio) p.audio.remove(); vc.peers.delete(d.id); vcUi(); });
        socket.on('voice_state', d => { const p = vc.peers.get(d.id); if (p) { p.muted = d.muted; vcUi(); } });
        socket.on('voice_error', d => { toast('🎙️ ' + d.message, 'var(--accent-pink)'); vcStop(); });
        socket.on('voice_signal', async ({ from, name, data } = {}) => {
            if (!vc.on || !data) return;
            const p = vc.peers.get(from) || vcPeer(from, name, false);
            try {
                if (data.sdp) {
                    await p.pc.setRemoteDescription(data.sdp);
                    if (data.sdp.type === 'offer') { const a = await p.pc.createAnswer(); await p.pc.setLocalDescription(a); socket.emit('voice_signal', { to: from, data: { sdp: p.pc.localDescription } }); }
                    for (const c of p.ice.splice(0)) await p.pc.addIceCandidate(c).catch(() => {});
                } else if (data.ice) {
                    if (p.pc.remoteDescription) await p.pc.addIceCandidate(data.ice).catch(() => {}); else p.ice.push(data.ice);
                }
            } catch (e) { console.warn('[vocal]', e); }
        });
        socket.on('disconnect', () => { if (vc.on) { vc.peers.forEach(p => { try { p.pc.close(); } catch (_) {} if (p.audio) p.audio.remove(); }); vc.peers.clear(); vc.rejoin = true; } });
        socket.on('connect', () => { if (vc.on && vc.rejoin && currentRoomCode) setTimeout(() => { vc.rejoin = false; socket.emit('voice_join', { roomCode: currentRoomCode }); }, 1500); });
        setInterval(() => { if (vc.on && currentRoomCode !== vc.code) vcStop(); else vcUi(); }, 1500);

        /* ---------- reconnexion auto : même après un rechargement de la page ---------- */
        setInterval(() => {
            try {
                if (currentRoomCode) localStorage.setItem('lastRoom', JSON.stringify({ code: currentRoomCode, at: Date.now() }));
                else if (!document.hidden) localStorage.removeItem('lastRoom');
            } catch (_) {}
        }, 2000);
        socket.on('connect', () => {
            if (currentRoomCode) return;
            try {
                const lr = JSON.parse(localStorage.getItem('lastRoom') || 'null');
                if (lr && lr.code && Date.now() - lr.at < 140000) {
                    currentRoomCode = lr.code;
                    socket.emit('rejoin_room', { roomCode: lr.code });
                    const el = document.getElementById('connection-banner');
                    if (el) { el.textContent = '🔄 On te remet dans ta partie…'; el.style.display = 'block'; setTimeout(() => { if (el.textContent.startsWith('🔄')) el.style.display = 'none'; }, 4000); }
                }
            } catch (_) {}
        });
        socket.on('rejoin_failed', () => { try { localStorage.removeItem('lastRoom'); } catch (_) {} });
        // si la connexion ne revient pas toute seule, on relance régulièrement
        setInterval(() => { if (!socket.connected && !document.hidden && (authToken || socket.auth) && navigator.onLine !== false) { try { socket.connect(); } catch (_) {} } }, 4000);

        /* ---------- accessibilité : gros texte, mode daltonien ---------- */
        const A11Y_GREEN = /(#00ff88|rgb\(0,\s*255,\s*136\))/gi;
        function a11yPatchEl(el) {
            if (!el || !el.getAttribute) return;
            const st = el.getAttribute('style');
            if (st && /#00ff88|rgb\(0,\s*255,\s*136\)/i.test(st)) el.setAttribute('style', st.replace(A11Y_GREEN, '#3d9bff'));
        }
        let a11yObs = null;
        function a11yApply() {
            let big = false, cb = false;
            try { big = localStorage.getItem('a11y_big') === '1'; cb = localStorage.getItem('a11y_cb') === '1'; } catch (_) {}
            document.documentElement.classList.toggle('big-text', big);
            document.documentElement.classList.toggle('cb', cb);
            if (cb && !a11yObs) {
                // vert (bonne réponse) → bleu, rouge/rose (erreur) → orange : lisible pour les daltoniens
                for (const sh of document.styleSheets) { let rules; try { rules = sh.cssRules; } catch (_) { continue; } for (const r of rules || []) { if (r.style && r.style.cssText && /0, 255, 136|#00ff88/i.test(r.style.cssText)) { for (let i = 0; i < r.style.length; i++) { const p = r.style[i], v = r.style.getPropertyValue(p); if (/0, 255, 136|#00ff88/i.test(v)) r.style.setProperty(p, v.replace(/rgb\(0, 255, 136\)|#00ff88/gi, '#3d9bff'), r.style.getPropertyPriority(p)); } } } }
                document.querySelectorAll('[style]').forEach(a11yPatchEl);
                a11yObs = new MutationObserver(ms => ms.forEach(m => { if (m.type === 'attributes') a11yPatchEl(m.target); else m.addedNodes.forEach(n => { if (n.nodeType === 1) { a11yPatchEl(n); n.querySelectorAll && n.querySelectorAll('[style]').forEach(a11yPatchEl); } }); }));
                a11yObs.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['style'] });
            }
        }
        function a11ySet(k, on) { try { localStorage.setItem(k, on ? '1' : '0'); } catch (_) {} if (k === 'a11y_cb' && !on) return location.reload(); a11yApply(); }
        a11yApply();

        /* ---------- effet de victoire « Aurore boréale » (pass de saison) ---------- */
        (function () {
            const orig = playEffect;
            playEffect = function (key, ms = 3200) {
                if (key !== 'aurora') return orig.apply(this, arguments);
                const c = document.getElementById('fx-confetti'); if (!c) return;
                const ctx = c.getContext('2d'); c.width = innerWidth; c.height = innerHeight; c.style.display = 'block';
                const W = c.width, H = c.height, t0 = performance.now();
                const step = t => {
                    const el = t - t0, fade = Math.min(1, el / 500, (ms - el) / 700);
                    ctx.clearRect(0, 0, W, H);
                    if (el > ms) { c.style.display = 'none'; return; }
                    for (let band = 0; band < 3; band++) {
                        const hue = [150, 185, 290][band];
                        ctx.beginPath();
                        for (let x = 0; x <= W; x += 12) { const y = H * (0.18 + band * 0.08) + Math.sin(x / 140 + el / 600 + band) * 40 + Math.sin(x / 57 + el / 380) * 14; x ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
                        ctx.lineTo(W, 0); ctx.lineTo(0, 0); ctx.closePath();
                        const g = ctx.createLinearGradient(0, 0, 0, H * 0.5);
                        g.addColorStop(0, `hsla(${hue},100%,60%,0)`); g.addColorStop(0.7, `hsla(${hue},100%,60%,${0.35 * fade})`); g.addColorStop(1, `hsla(${hue},100%,70%,0)`);
                        ctx.fillStyle = g; ctx.fill();
                    }
                    requestAnimationFrame(step);
                };
                requestAnimationFrame(step);
            };
        })();

        /* ---------- options : accessibilité ---------- */
        (function () {
            const opt = document.querySelector('#options > div');
            if (!opt || document.getElementById('a11y-panel')) return;
            const p = document.createElement('div'); p.id = 'a11y-panel'; p.className = 'a11y-panel';
            let big = false, cb = false; try { big = localStorage.getItem('a11y_big') === '1'; cb = localStorage.getItem('a11y_cb') === '1'; } catch (_) {}
            p.innerHTML = `<h3>♿ Accessibilité</h3><label><input type="checkbox" ${big ? 'checked' : ''} onchange="a11ySet('a11y_big',this.checked)"> 🔠 Gros texte</label>
                <label><input type="checkbox" ${cb ? 'checked' : ''} onchange="a11ySet('a11y_cb',this.checked)"> 🎨 Mode daltonien <small class="tl-hint">(bonnes réponses en bleu, erreurs en orange)</small></label><div id="lang-slot"></div>`;
            opt.appendChild(p);
        })();
