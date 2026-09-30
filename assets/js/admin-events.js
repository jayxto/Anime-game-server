/* =====================================================================
           HUB 3 : Devine l'attaque, évènements, modération, annonces, stats, nouveautés
           ===================================================================== */
        ARC_UI.attaque = { title: '💥 DEVINE L’ATTAQUE', sub: 'On lit ce que fait la technique : trouve son nom parmi 4 propositions', universe: false };
        // rendu de la question (texte de la technique)
        (function () {
            const orig = arcRenderStage;
            arcRenderStage = function (q) {
                if (q && q.game === 'attaque' && q.phase !== 'loading' && q.stage && q.stage.attack) {
                    const stage = document.getElementById('arc-stage');
                    const key = 'atk|' + q.round + '|' + q.phase;
                    if (arcStageKey === key) return;
                    arcStageKey = key;
                    const a = q.stage.attack;
                    stage.innerHTML = `<div class="atk-card"><div class="atk-ico">💥</div><div class="atk-desc">« ${v7esc(a.desc)} »</div><div class="atk-anime">${v7esc(a.anime)}</div>${q.phase !== 'playing' && q.answer ? `<div class="atk-ans">${v7esc(q.answer)}</div>` : ''}</div>`;
                    return;
                }
                return orig.apply(this, arguments);
            };
        })();

        /* ---------- bannissement / annonces / évènements ---------- */
        function h3Overlay(html) {
            let o = document.getElementById('h3-block'); if (!o) { o = document.createElement('div'); o.id = 'h3-block'; document.body.appendChild(o); }
            o.innerHTML = `<div class="h3-block-box">${html}</div>`;
        }
        socket.on('connect_error', e => {
            if (!e || e.message !== 'banned') return;
            const d = e.data || {};
            h3Overlay(`<div style="font-size:3rem;">🚫</div><h2>Tu es banni</h2><p>${d.until ? `Jusqu’au ${new Date(d.until).toLocaleString('fr-FR')}` : 'Définitivement'}${d.reason ? `<br>Raison : ${v7esc(d.reason)}` : ''}</p>`);
            try { socket.io.opts.reconnection = false; } catch (_) {}
        });
        socket.on('banned_now', d => h3Overlay(`<div style="font-size:3rem;">🚫</div><h2>Banni</h2><p>${v7esc(d.message || '')}</p>`));
        socket.on('announce', d => {
            if (!d || !d.text) return;
            let b = document.getElementById('h3-announce');
            if (!b) { b = document.createElement('div'); b.id = 'h3-announce'; document.body.appendChild(b); }
            b.className = 'k-' + (d.kind || 'admin');
            b.innerHTML = `<span>📢 ${v7esc(d.text)}</span><button onclick="this.parentNode.remove()">✕</button>`;
            clearTimeout(b._t); b._t = setTimeout(() => b.remove(), Math.max(15000, Math.min(3600000, (d.until || 0) - Date.now()) || 60000));
            if (!d.quiet) toast('📢 ' + v7esc(d.text), '#ffd700');
        });
        const h3 = { event: null };
        socket.on('site_event', e => { h3.event = e; h3RenderEvent(); });
        socket.on('surprise_open', d => toast(`⚡ <b>Tournoi surprise !</b> Départ dans quelques minutes <button class="toast-btn" onclick="h3JoinSurprise('${d.code}')">Rejoindre</button>`, '#00ff88'));
        function h3JoinSurprise(code) {
            if (currentRoomCode && currentRoomCode !== code) socket.emit('leave_room', { roomCode: currentRoomCode });
            switchTab('mode'); currentRoomCode = code;
            socket.emit('join_room', { roomCode: code, username: getUsername(), mode: 'arcade', subMode: 'tournoi' });
        }
        function h3RenderEvent() {
            const box = document.getElementById('hub-home'); if (!box) return;
            box.querySelectorAll('.h3-evt').forEach(x => x.remove());
            const e = h3.event; if (!e) return;
            let html = '';
            if (e.xp2Until) html += `<div class="hub-weekend h3-evt" style="background:linear-gradient(90deg,#00c2ff,#b77bff,#ff4d8d);">🎉 <b>ÉVÈNEMENT XP x2</b> : pièces et XP doublées encore <b data-hub-left="${e.xp2Until}">${hubFmtLeft(e.xp2Until - Date.now())}</b></div>`;
            if (e.surprise) html += `<div class="hub-card h3-evt weekly"><div class="hb-main"><div class="hb-h">⚡ Tournoi surprise</div><div class="hb-weekly">Départ dans <b data-hub-left="${e.surprise.startAt}">${hubFmtLeft(e.surprise.startAt - Date.now())}</b> • ${e.surprise.players} inscrit${e.surprise.players > 1 ? 's' : ''} • 300 🪙 pour le vainqueur</div><div class="hb-btns"><button class="go" onclick="h3JoinSurprise('${e.surprise.code}')">⚡ Rejoindre</button></div></div></div>`;
            const t = document.createElement('div'); t.innerHTML = html;
            [...t.children].reverse().forEach(c => box.prepend(c));
        }
        (function () { const orig = hubRenderHome; hubRenderHome = function () { const r = orig.apply(this, arguments); h3RenderEvent(); return r; }; })();

        /* ---------- signaler un joueur ---------- */
        let h3LastRoom = null;
        socket.on('update_room', room => { if (room && room.code === currentRoomCode) h3LastRoom = room; h3ReportBtn(); });
        function h3ReportBtn() {
            const wr = document.getElementById('waiting-room'); if (!wr) return;
            let b = document.getElementById('h3-report');
            if (!b) { b = document.createElement('button'); b.id = 'h3-report'; b.className = 'h3-report'; b.textContent = '🚩 Signaler un joueur'; b.onclick = () => h3Report(); const list = document.getElementById('waiting-players-list'); if (list) list.parentNode.insertBefore(b, list.nextSibling); }
        }
        function h3Report(players) {
            const list = (players || (h3LastRoom && h3LastRoom.players) || []).filter(p => p.id !== socket.id);
            if (!list.length) return toast('Personne à signaler ici.', 'var(--accent-pink)');
            hubModal('h3-rep', `<h3>🚩 Signaler un joueur</h3><p class="tl-hint">L’admin verra ton signalement (insultes, triche, pseudo choquant…).</p>
                <select id="h3-rep-p" class="v7-input">${list.map(p => `<option value="${v7esc(p.id)}">${v7esc(p.name)}</option>`).join('')}</select>
                <input id="h3-rep-r" class="v7-input" maxlength="200" placeholder="Raison (ex : insultes dans le chat)">
                <button class="btn-action" onclick="socket.emit('report_player',{roomCode:currentRoomCode,playerId:document.getElementById('h3-rep-p').value,reason:document.getElementById('h3-rep-r').value});document.getElementById('h3-rep').remove()">Envoyer</button>`);
        }
        (function () { // bouton dans le Loup-garou aussi
            const orig = h2Head;
            h2Head = function (title, sub, q) { const html = orig.apply(this, arguments); return q && q.players ? html.replace('<div class="h2-hbtns">', `<div class="h2-hbtns"><button title="Signaler un joueur" onclick='h3Report(${JSON.stringify(q.players.map(p => ({ id: p.id, name: p.name }))).replace(/'/g, '&#39;')})'>🚩</button>`) : html; };
        })();

        /* ---------- ADMIN : évènements, modération, annonces, stats ---------- */
        (function () {
            const adm = document.getElementById('admin'); if (!adm || document.getElementById('h3-admin')) return;
            const wrap = document.createElement('div'); wrap.id = 'h3-admin';
            wrap.innerHTML = `
            <div class="opt-panel"><h2>⚡ Lancer un évènement</h2><p class="tl-hint" style="text-align:left;">S’applique tout de suite à tout le site, avec une annonce pour tout le monde.</p>
                <div class="h3-evt-row"><b>🎉 XP et pièces x2</b><select id="h3-xp-h"><option value="1">1 h</option><option value="2" selected>2 h</option><option value="6">6 h</option><option value="24">24 h</option><option value="0">Arrêter</option></select><button class="btn-action" onclick="h3Event('xp2',{hours:+document.getElementById('h3-xp-h').value})">Lancer</button></div>
                <div class="h3-evt-row"><b>👹 Boss spécial</b><select id="h3-boss-hp"><option value="2000">2 000 PV</option><option value="3000" selected>3 000 PV</option><option value="6000">6 000 PV</option><option value="12000">12 000 PV</option></select><button class="btn-action" onclick="h3Event('boss',{hp:+document.getElementById('h3-boss-hp').value})">Lancer</button></div>
                <div class="h3-evt-row"><b>⚡ Tournoi surprise</b><select id="h3-sur-m"><option value="2">dans 2 min</option><option value="5" selected>dans 5 min</option><option value="10">dans 10 min</option></select><button class="btn-action" onclick="h3Event('surprise',{minutes:+document.getElementById('h3-sur-m').value})">Lancer</button></div>
                <div id="h3-evt-state" class="tl-hint" style="text-align:left;"></div></div>
            <div class="opt-panel"><h2>🟢 Joueurs connectés <span id="h3-online-count" class="tl-hint"></span></h2>
                <p class="tl-hint" style="text-align:left;">Pseudos actuellement connectés au site. La liste se met à jour automatiquement.</p>
                <div id="h3-online"><p class="tl-hint">Chargement…</p></div><button onclick="h3OnlineLoad()">↻ Actualiser</button></div>
            <div class="opt-panel"><h2>🛡️ Modération</h2>
                <div class="ch-in"><input id="h3-mod-q" class="v7-input" placeholder="🔎 Chercher un joueur (pseudo)" onkeydown="if(event.key==='Enter')h3ModSearch()"><button onclick="h3ModSearch()">Chercher</button></div>
                <input id="h3-mod-reason" class="v7-input" maxlength="120" placeholder="Raison pour muter / bannir (facultatif)">
                <div id="h3-mod-search"></div><div id="h3-mod"></div></div>
            <div class="opt-panel"><h2>📢 Annonces programmées</h2>
                <textarea id="h3-ann-t" class="v7-input" maxlength="300" rows="2" placeholder="Ex : Grosse mise à jour ce soir à 21 h : nouveau mode !"></textarea>
                <div class="h3-evt-row"><input id="h3-ann-at" type="datetime-local" class="v7-input"><select id="h3-ann-min"><option value="5">affichée 5 min</option><option value="15" selected>15 min</option><option value="60">1 h</option><option value="240">4 h</option></select><button class="btn-action" onclick="h3AnnAdd()">Programmer</button></div>
                <div id="h3-ann"></div></div>
            <div class="opt-panel"><h2>📊 Stats du site</h2><div id="h3-stats"><p class="tl-hint">Chargement…</p></div></div>`;
            adm.appendChild(wrap);
            const orig = window.switchTab;
            window.switchTab = function (t) { const r = orig.apply(this, arguments); if (t === 'admin') h3AdminLoad(); return r; };
        })();
        function h3AdminLoad() { h3OnlineLoad(); h3ModLoad(); h3AnnLoad(); h3StatsLoad(); v7get('/api/event').then(e => { if (e && e.ok) h3EvtState(e); }); }
        async function h3OnlineLoad() {
            const box = document.getElementById('h3-online'); if (!box) return;
            const d = await v7get('/api/admin/online'); if (!d || !d.ok) { box.innerHTML = '<p class="tl-hint">Liste indisponible.</p>'; return; }
            const n = document.getElementById('h3-online-count'); if (n) n.textContent = `• ${d.count} joueur${d.count > 1 ? 's' : ''} • ${d.connections} connexion${d.connections > 1 ? 's' : ''}`;
            box.innerHTML = d.players.length ? `<div style="display:flex;flex-wrap:wrap;gap:7px;margin:8px 0 12px;">${d.players.map(p => `<span class="rg-chip" style="border-color:#00ff88;"><span style="color:#00ff88">●</span> <b>${v7esc(p.name)}</b>${p.guest ? ' <small>(invité)</small>' : ''}${p.connections > 1 ? ` <small>×${p.connections}</small>` : ''}</span>`).join('')}</div>` : '<p class="tl-hint">Aucun joueur connecté.</p>';
        }
        setInterval(() => { if (!document.hidden && document.getElementById('admin')?.classList.contains('active')) h3OnlineLoad(); }, 5000);
        function h3EvtState(e) {
            const el = document.getElementById('h3-evt-state'); if (!el) return;
            const L = [];
            if (e.xp2Until) L.push(`🎉 XP x2 actif jusqu’à ${new Date(e.xp2Until).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`);
            if (e.surprise) L.push(`⚡ Tournoi surprise #${v7esc(e.surprise.code)} à ${new Date(e.surprise.startAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} (${e.surprise.players} inscrits)`);
            el.innerHTML = L.length ? L.join('<br>') : 'Aucun évènement en cours.';
        }
        async function h3Event(type, extra) {
            const d = await v7post('/api/admin/event', Object.assign({ type }, extra || {}));
            if (!d || !d.ok) return toast('❌ ' + ((d && d.error) || 'Impossible (server.js à jour ?)'), 'var(--accent-pink)');
            toast('⚡ Évènement lancé !', '#00ff88'); h3EvtState(d.event);
        }
        const H3_DUR = [[1, '1 h'], [24, '24 h'], [168, '7 jours'], [0, 'Définitif']];
        function h3ModRow(p) {
            const k = v7esc(p.key), n = v7esc(p.name);
            return `<div class="friend-row"><span><b>${n}</b> ${p.online ? '<span class="fs on">● en ligne</span>' : ''}${p.guest ? ' <small>(invité)</small>' : ''}${p.muted ? ' 🔇' : ''}${p.banned ? ' 🚫' : ''}</span>
                <span class="pl-btns"><select id="dur-${k}">${H3_DUR.map(([h, l]) => `<option value="${h}">${l}</option>`).join('')}</select>
                ${p.muted ? `<button onclick="h3Mod('unmute','${k}','${n}')">🔊 Démuter</button>` : `<button onclick="h3Mod('mute','${k}','${n}')">🔇 Muter</button>`}
                ${p.banned ? `<button onclick="h3Mod('unban','${k}','${n}')">✅ Débannir</button>` : `<button class="danger" onclick="h3Mod('ban','${k}','${n}')">🚫 Bannir</button>`}</span></div>`;
        }
        async function h3ModSearch() {
            const q = document.getElementById('h3-mod-q').value.trim();
            const d = await v7get('/api/admin/players?q=' + encodeURIComponent(q));
            const box = document.getElementById('h3-mod-search'); if (!box || !d) return;
            box.innerHTML = d.players.length ? d.players.map(h3ModRow).join('') : '<p class="tl-hint">Aucun joueur trouvé.</p>';
        }
        async function h3Mod(action, key, name, report) {
            const sel = document.getElementById('dur-' + key);
            const ri = document.getElementById('h3-mod-reason'); const reason = action === 'mute' || action === 'ban' ? ((ri && ri.value) || '') : '';
            const d = await v7post('/api/admin/mod', { action, key, name, hours: sel ? +sel.value : 24, reason, report });
            if (!d || !d.ok) return toast('❌ ' + ((d && d.error) || 'Impossible'), 'var(--accent-pink)');
            toast('✅ Fait', '#00ff88'); h3ModLoad(); if (document.getElementById('h3-mod-q').value) h3ModSearch();
        }
        async function h3ModLoad() {
            const d = await v7get('/api/admin/mod'); const box = document.getElementById('h3-mod'); if (!box || !d || !d.ok) return;
            const open = d.reports.filter(r => r.status === 'open');
            box.innerHTML = `<h3 class="adm-h">🚩 Signalements (${open.length} en attente)</h3>${d.reports.length ? d.reports.slice(0, 30).map(r => `<div class="friend-row ${r.status === 'open' ? '' : 'closed'}"><span><b>${v7esc(r.target)}</b> signalé par ${v7esc(r.by)} • ${v7esc(r.mode)} • ${new Date(r.at).toLocaleString('fr-FR')}<br><small>${v7esc(r.reason || 'Pas de raison')}</small></span>
                <span class="pl-btns">${r.status === 'open' ? `<button onclick="h3Mod('mute','${v7esc(r.targetKey)}','${v7esc(r.target)}')">🔇</button><button class="danger" onclick="h3Mod('ban','${v7esc(r.targetKey)}','${v7esc(r.target)}')">🚫</button><button onclick="v7post('/api/admin/mod',{action:'close',key:'u0',report:'${r.id}'}).then(h3ModLoad)">✔ Traité</button>` : '<small>traité</small>'}</span></div>`).join('') : '<p class="tl-hint">Aucun signalement.</p>'}
                <h3 class="adm-h">🔇 Muets</h3>${d.muted.length ? d.muted.map(m => h3ModRow({ key: m.key, name: m.name, muted: true })).join('') : '<p class="tl-hint">Personne.</p>'}
                <h3 class="adm-h">🚫 Bannis</h3>${d.banned.length ? d.banned.map(m => h3ModRow({ key: m.key, name: m.name, banned: true })).join('') : '<p class="tl-hint">Personne.</p>'}`;
        }
        async function h3AnnLoad() {
            const d = await v7get('/api/admin/announce'); const box = document.getElementById('h3-ann'); if (!box || !d || !d.ok) return;
            const at = document.getElementById('h3-ann-at'); if (at && !at.value) { const t = new Date(Date.now() + 3600000); t.setMinutes(0, 0, 0); at.value = new Date(t - t.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
            box.innerHTML = d.list.length ? d.list.slice().reverse().map(a => `<div class="friend-row"><span>${a.sent ? '✅' : '⏰'} <b>${new Date(a.at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</b> • ${v7esc(a.text)}</span><span class="pl-btns"><button onclick="v7post('/api/admin/announce',{delete:'${a.id}'}).then(h3AnnLoad)">🗑️</button></span></div>`).join('') : '<p class="tl-hint">Aucune annonce programmée.</p>';
        }
        async function h3AnnAdd() {
            const v = document.getElementById('h3-ann-at').value;
            const d = await v7post('/api/admin/announce', { text: document.getElementById('h3-ann-t').value, at: v ? new Date(v).toISOString() : '', minutes: +document.getElementById('h3-ann-min').value });
            if (!d || !d.ok) return toast('❌ ' + ((d && d.error) || 'Impossible'), 'var(--accent-pink)');
            document.getElementById('h3-ann-t').value = ''; toast('📢 Annonce programmée', '#00ff88'); h3AnnLoad();
        }
        function h3Bars(rows, label, val, fmt) {
            const max = Math.max(1, ...rows.map(val));
            return `<div class="h3-bars">${rows.map(r => `<div class="h3-bar" title="${v7esc(label(r))} : ${val(r)}"><i style="height:${Math.round(100 * val(r) / max)}%"></i><small>${v7esc(fmt ? fmt(r) : label(r))}</small><b>${val(r)}</b></div>`).join('')}</div>`;
        }
        async function h3StatsLoad() {
            const d = await v7get('/api/admin/stats2'); const box = document.getElementById('h3-stats'); if (!box) return;
            if (!d || !d.ok) { box.innerHTML = '<p class="tl-hint">Stats indisponibles (server.js à jour ?).</p>'; return; }
            const hours = Array.from({ length: 24 }, (_, h) => ({ h, n: (d.hours.find(x => x.h === h) || {}).n || 0 }));
            const peak = hours.slice().sort((a, b) => b.n - a.n)[0];
            box.innerHTML = `<div class="h3-kpis"><div><b>${d.online}</b><small>connectés maintenant</small></div><div><b>${d.perDay.length ? d.perDay[d.perDay.length - 1].players : 0}</b><small>joueurs aujourd’hui</small></div><div><b>${d.perDay.reduce((a, x) => a + x.games, 0)}</b><small>parties (14 j)</small></div><div><b>${peak && peak.n ? peak.h + ' h' : '—'}</b><small>heure de pointe</small></div></div>
                <h3 class="adm-h">👥 Joueurs par jour (14 jours)</h3>${d.perDay.length ? h3Bars(d.perDay, r => r.d, r => r.players, r => r.d.slice(8) + '/' + r.d.slice(5, 7)) : '<p class="tl-hint">Pas encore de données.</p>'}
                <h3 class="adm-h">🎮 Modes les plus joués (30 jours)</h3>${d.modes.length ? `<div class="h3-hbars">${d.modes.map(m => `<div><span>${v7esc(m.label)}</span><i style="width:${Math.round(100 * m.n / d.modes[0].n)}%"></i><b>${m.n}</b></div>`).join('')}</div>` : '<p class="tl-hint">Pas encore de données.</p>'}
                <h3 class="adm-h">🕐 Heures de pointe (30 jours, heure de Paris)</h3>${h3Bars(hours, r => r.h + ' h', r => r.n, r => r.h % 3 === 0 ? r.h + 'h' : '')}`;
        }

        /* ---------- Nouveautés ---------- */
        const CHANGELOG = [
            { v: '2026-10-03', title: 'Plus ou moins, Survie, Chaos et profils', items: ['⚖️ Plus ou moins : qui est le plus fort, le plus populaire ?', '☠️ Survie : une erreur et tu es éliminé', '🌀 Chaos : une règle surprise à chaque manche', '🔥 Échauffement dans la salle d’attente', '🎨 Bannières de profil à débloquer avec les succès', '🔗 Ta page profil publique à partager (Options)', '📺 Écran live pour les streamers'] },
            { v: '2026-10-01', title: 'Soutenir le jeu', items: ['💎 Badge Supporter : pseudo Prisme animé, invocations arc-en-ciel et plus de pub (bouton 💎 en haut)', '☕ Don libre sur Ko-fi ou abonnement à 1,99 €/mois, que du cosmétique'] },
            { v: '2026-09-30', title: 'Hôtel des ventes et invocations', items: ['🏪 Hôtel des ventes : vends tes cartes contre des pièces et achète celles des autres (onglet Marché de la Collection)', '🔮 Ouvrir un booster lance maintenant une vraie invocation : cercle magique, lumière et suspense avant la carte rare'] },
            { v: '2026-09-29', title: 'Admin et nouveau mini-jeu', items: ['💥 Nouveau mini-jeu : Devine l’attaque', '⚡ Évènements surprises : XP x2, boss spécial, tournoi surprise', '🚩 Tu peux signaler un joueur', '🆕 Cette page Nouveautés'] },
            { v: '2026-09-28', title: 'Loup-garou complet et nouveaux décors', items: ['🐺 Loup-garou : 16 joueurs, 17 rôles anime, auras, chats secrets, roue des rôles', '🌀 Gojo enferme un joueur (barreaux à l’écran !)', '🔢 Numéros des joueurs et votes visibles', '🎨 8 nouveaux décors qui changent selon la saison et chaque semaine'] },
            { v: '2026-09-27', title: 'Gros ajouts', items: ['⛓️ Chaîne de persos, 📝 Quiz des joueurs, 🟢 Blind test facile', '👥 Onglet Amis, 🎴 Deck de cartes, ⭐ Prestige, succès secrets', '⚔️ Duel classé, 🛡️ Clans, 🎟️ Pass de saison, 👹 Boss du serveur', '🔍 Zoom extrême, 🎙️ Salon vocal, 👁️ Mode spectateur, 🇬🇧 Version anglaise'] },
            { v: '2026-09-26', title: 'Boutique et collection', items: ['🛒 Boutique, 🃏 cartes à collectionner, 🏷️ titres', '🎃 Déco Halloween et Noël'] }
        ];
        function seenVersion() { try { return localStorage.getItem('seenChangelog') || ''; } catch (_) { return ''; } }
        function openChangelog() {
            try { localStorage.setItem('seenChangelog', CHANGELOG[0].v); } catch (_) {}
            h3NewsBtn();
            hubModal('h3-news', `<h3>🆕 Nouveautés</h3>${CHANGELOG.map(c => `<div class="h3-news"><div class="h3-news-h"><b>${v7esc(c.title)}</b><small>${new Date(c.v).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}</small></div><ul>${c.items.map(i => `<li>${v7esc(i)}</li>`).join('')}</ul></div>`).join('')}`, true);
        }
        function h3NewsBtn() {
            const menu = document.getElementById('menu-selection'); if (!menu) return;
            let b = document.getElementById('h3-news-btn');
            if (!b) { b = document.createElement('button'); b.id = 'h3-news-btn'; b.className = 'h3-news-btn'; b.onclick = openChangelog; const h2el = menu.querySelector('h2'); menu.insertBefore(b, h2el ? h2el.nextSibling : menu.firstChild); }
            const fresh = seenVersion() !== CHANGELOG[0].v;
            b.innerHTML = `🆕 Nouveautés${fresh ? ' <span class="nav-badge alert">!</span>' : ''}`;
        }
        h3NewsBtn();
