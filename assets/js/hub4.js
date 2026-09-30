/* =====================================================================
           HUB 4 : Plus ou moins, Survie, Chaos, échauffement, bannières, profil public, écran live
           ===================================================================== */
        ARC_UI.plusmoins = { title: '⚖️ PLUS OU MOINS', sub: 'Deux persos : lequel est le plus fort ou le plus populaire ? Enchaîne les bonnes réponses pour une série', universe: false };
        ARC_UI.survie = { title: '☠️ SURVIE', sub: 'Une mauvaise réponse et tu es éliminé. Le dernier debout gagne', universe: false };
        ARC_UI.chaos = { title: '🌀 CHAOS', sub: 'Une règle surprise à chaque manche', universe: false };
        (function () {
            const grid = document.querySelector('.arc-menu-grid');
            if (grid && !grid.querySelector('[data-h4]')) {
                grid.insertAdjacentHTML('afterbegin', `
                    <button class="arc-game-btn" data-h4 onclick="openArcadeGame('plusmoins')"><span class="arc-ico">⚖️</span><b>Plus ou moins</b><span>Deux persos : qui est le plus fort, le plus populaire ? Fais la plus longue série</span><em class="h4-new">NOUVEAU</em></button>
                    <button class="arc-game-btn" data-h4 onclick="openArcadeGame('survie')"><span class="arc-ico">☠️</span><b>Survie</b><span>Mauvaise réponse = éliminé. Le dernier debout gagne</span><em class="h4-new">NOUVEAU</em></button>
                    <button class="arc-game-btn" data-h4 onclick="openArcadeGame('chaos')"><span class="arc-ico">🌀</span><b>Chaos</b><span>Chaque manche a une règle surprise : x2, 6 secondes, image floue, à l’envers…</span><em class="h4-new">NOUVEAU</em></button>`);
            }
            const orig = arcRenderStage;
            arcRenderStage = function (q) {
                const st = (q && q.stage) || {};
                const stage = document.getElementById('arc-stage');
                // Chaos : effets visuels + bannière de règle
                if (stage) {
                    const r = q && q.game === 'chaos' && q.phase === 'playing' ? q.rule : null;
                    stage.classList.toggle('ch-flou', !!(r && r.id === 'flou'));
                    stage.classList.toggle('ch-envers', !!(r && r.id === 'envers'));
                    const ch = document.getElementById('arc-choices');
                    if (ch) { ch.classList.toggle('ch-cache', !!(r && r.id === 'cache')); if (r && r.id === 'cache') { clearTimeout(window._h4c); window._h4c = setTimeout(() => ch.classList.remove('ch-cache'), Math.max(0, 3000 - (Date.now() + (arcClock || 0) - q.startedAt))); } }
                }
                if (q && q.phase !== 'loading' && st.pm) {
                    const key = 'pm|' + q.round + '|' + q.phase;
                    if (arcStageKey !== key) {
                        arcStageKey = key;
                        const a = st.pm.a, b = st.pm.b, rev = q.phase !== 'playing';
                        const card = c => `<div class="pm-card${rev ? (c.name === q.answer ? ' win' : ' lose') : ''}"><img src="${v7esc(c.img)}" alt="" onerror="this.style.opacity=.15"><b>${v7esc(c.name)}</b><small>${v7esc(c.anime)}</small></div>`;
                        stage.innerHTML = `<div class="pm-wrap">${h4RuleHtml(q)}<div class="pm-q">${v7esc(st.pm.q)}</div><div class="pm-duel">${card(a)}<div class="pm-vs">VS</div>${card(b)}</div>${rev && st.pmInfo ? `<div class="pm-info">${v7esc(st.pmInfo)}</div>` : ''}${h4Streak(q)}</div>`;
                    }
                    return h4After(q);
                }
                if (q && (q.game === 'survie' || q.game === 'chaos') && st.sub) {
                    const r = orig.call(this, Object.assign({}, q, { game: st.sub }));
                    if (stage && q.phase !== 'loading' && !stage.querySelector('.h4-rule') && (q.rule || q.game === 'survie')) stage.insertAdjacentHTML('afterbegin', h4RuleHtml(q));
                    h4After(q);
                    return r;
                }
                return orig.apply(this, arguments);
            };
        })();
        function h4RuleHtml(q) {
            if (q.game === 'chaos' && q.rule) return `<div class="h4-rule">🌀 ${v7esc(q.rule.label)}</div>`;
            if (q.game === 'survie') { const me = q.players.find(p => p.id === socket.id) || {}; return `<div class="h4-rule surv">☠️ ${q.alive} survivant${q.alive > 1 ? 's' : ''}${me.eliminated ? ' • tu es éliminé, regarde la suite' : ''}</div>`; }
            return '';
        }
        function h4Streak(q) { const me = q.players.find(p => p.id === socket.id); return me && me.streak >= 2 ? `<div class="pm-streak">🔥 Série : ${me.streak}</div>` : ''; }
        function h4After(q) {
            if (q.game === 'survie' && q.message && q.phase === 'reveal') { const r = document.getElementById('arc-result'); if (r) setTimeout(() => { r.textContent = q.message; r.style.color = '#ffb347'; }, 0); }
        }

        /* ---------- Salle d'attente animée : questions d'échauffement ---------- */
        (function () {
            const wr = document.getElementById('waiting-room'); if (!wr || document.getElementById('warmup')) return;
            const d = document.createElement('div'); d.id = 'warmup'; d.className = 'warmup';
            d.innerHTML = `<div class="wu-head">🔥 Échauffement <small>en attendant les autres • ne compte pas</small></div><div id="wu-body"><button class="btn-action" onclick="wuNext()">Lancer une question</button></div><div class="wu-score" id="wu-score"></div>`;
            wr.appendChild(d);
            let wasOpen = false;
            setInterval(() => {
                const open = wr.style.display !== 'none' && wr.offsetParent !== null;
                if (open && !wasOpen && !wu.q) wuNext();
                wasOpen = open;
            }, 1200);
        })();
        const wu = { q: null, good: 0, total: 0, t: null };
        async function wuNext() {
            clearTimeout(wu.t);
            const d = await v7get('/api/warmup'); const body = document.getElementById('wu-body'); if (!body) return;
            if (!d || !d.ok) { body.innerHTML = '<p class="tl-hint">Échauffement indisponible.</p>'; return; }
            wu.q = d;
            const imgs = d.kind === 'pm' ? `<div class="wu-duel"><div><img src="${v7esc(d.a.img)}" alt="" onerror="this.style.opacity=.15"><b>${v7esc(d.a.name)}</b></div><span>VS</span><div><img src="${v7esc(d.b.img)}" alt="" onerror="this.style.opacity=.15"><b>${v7esc(d.b.name)}</b></div></div>` : `<div class="wu-anime">${v7esc(d.anime)}</div>`;
            body.innerHTML = `<div class="wu-q">${v7esc(d.q)}</div>${imgs}<div class="wu-ch">${d.choices.map((c, i) => `<button onclick="wuPick(${i},this)">${v7esc(c)}</button>`).join('')}</div>`;
        }
        function wuPick(i, btn) {
            if (!wu.q || wu.q.done) return;
            wu.q.done = true; wu.total++;
            const ok = wu.q.choices[i] === wu.q.answer; if (ok) wu.good++;
            document.querySelectorAll('#wu-body .wu-ch button').forEach(b => { b.disabled = true; if (b.textContent === wu.q.answer) b.classList.add('good'); });
            if (!ok) btn.classList.add('bad');
            const s = document.getElementById('wu-score'); if (s) s.textContent = `${wu.good}/${wu.total} bonnes réponses`;
            wu.t = setTimeout(wuNext, 1800);
        }

        /* ---------- Bannières de profil ---------- */
        (function () {
            const o = cosNameHtml;
            cosNameHtml = function (name, cos) { const h = o(name, cos); return cos && cos.banner ? `<span class="cn-ban ban-${v7esc(cos.banner)}">${h}</span>` : h; };
            const opt = document.querySelector('#options > div');
            if (opt && !document.getElementById('ban-opt')) {
                const d = document.createElement('div'); d.id = 'ban-opt'; d.style.cssText = 'margin-top:16px;text-align:left;';
                d.innerHTML = `<h3 style="margin:0 0 6px;">🎨 Ma bannière</h3><p class="tl-hint" style="text-align:left;margin:0 0 8px;">Un fond derrière ton pseudo dans les salons. Débloque-les avec tes succès.</p><div id="ban-grid" class="ban-grid"><p class="tl-hint">Connecte-toi pour voir tes bannières.</p></div>
                    <h3 style="margin:16px 0 6px;">🔗 Mon profil public</h3><p class="tl-hint" style="text-align:left;margin:0 0 8px;">Une page à partager avec ta bannière, tes cartes rares et tes succès.</p><div class="ch-in"><button class="btn-action" onclick="pubOpen()">👀 Voir</button><button class="btn-action" onclick="pubCopy()">📋 Copier le lien</button></div>`;
                opt.appendChild(d);
            }
            const sw = window.switchTab;
            window.switchTab = function (t) { const r = sw.apply(this, arguments); if (t === 'options') banLoad(); return r; };
        })();
        async function banLoad() {
            const g = document.getElementById('ban-grid'); if (!g || !isAccount()) return;
            const d = await v7get('/api/banners'); if (!d || !d.ok) return;
            g.innerHTML = `<button class="ban-item none${!d.selected ? ' on' : ''}" onclick="banPick('')"><span>Aucune</span></button>` + d.list.map(b => `<button class="ban-item ban-${v7esc(b.id)}${b.unlocked ? '' : ' locked'}${d.selected === b.id ? ' on' : ''}" onclick="banPick('${v7esc(b.id)}')" title="${v7esc(b.need)}"><span>${b.unlocked ? '' : '🔒 '}${v7esc(b.name)}</span><small>${b.unlocked ? '' : v7esc(b.need)}</small></button>`).join('');
        }
        async function banPick(id) {
            const d = await v7post('/api/banners/select', { id });
            if (d && d.ok) { toast(id ? '🎨 Bannière équipée !' : 'Bannière retirée', '#00f0ff'); if (currentUser) currentUser.cos = Object.assign({}, currentUser.cos, { banner: id || undefined }); banLoad(); }
            else toast((d && d.error) || 'Erreur', '#ff2a5f');
        }
        function pubUrl() { const p = currentUser && currentUser.pseudo; return p ? location.origin + '/u/' + encodeURIComponent(p) : null; }
        function pubOpen() { const u = pubUrl(); if (!u || !isAccount()) return toast('Connecte-toi à un compte pour avoir un profil public.', '#ff2a5f'); window.open(u, '_blank', 'noopener'); }
        async function pubCopy() {
            const u = pubUrl(); if (!u || !isAccount()) return toast('Connecte-toi à un compte pour avoir un profil public.', '#ff2a5f');
            try { if (navigator.share && /Mobi|iPhone|Android/i.test(navigator.userAgent)) { await navigator.share({ title: 'Mon profil Anime Game', url: u }); return; } } catch (_) {}
            try { await navigator.clipboard.writeText(u); toast('🔗 Lien copié : ' + u, '#00ff88'); } catch (_) { toast(u, '#00f0ff'); }
        }

        /* ---------- Mode Streamer : écran live propre + compteur de viewers ---------- */
        (function () {
            const w = document.getElementById('stream-widget'); if (!w || document.getElementById('live-btn')) return;
            const b = document.createElement('button'); b.id = 'live-btn'; b.className = 'live-btn'; b.textContent = '📺 Écran live';
            b.onclick = e => { e.stopPropagation(); liveToggle(); };
            w.insertBefore(b, w.children[1] || null);
            const c = document.createElement('div'); c.id = 'live-count'; c.style.display = 'none'; document.body.appendChild(c);
            setInterval(() => {
                const on = !!(typeof stream !== 'undefined' && stream.ws);
                if (!on && document.documentElement.classList.contains('live')) liveToggle(false);
                c.style.display = on ? '' : 'none';
                if (!on) return;
                const players = Object.keys(stream.board || {}).length, now = stream.votes ? stream.votes.size : 0;
                c.innerHTML = `🎥 <b>${Math.max(players, now)}</b> viewer${Math.max(players, now) > 1 ? 's' : ''} jouent${stream.key ? ` • <b>${now}</b> vote${now > 1 ? 's' : ''} sur cette question` : ''} <small>tape !1 !2 !3 !4 dans le chat</small>`;
            }, 700);
        })();
        function liveToggle(force) {
            const on = force === undefined ? !document.documentElement.classList.contains('live') : !!force;
            document.documentElement.classList.toggle('live', on);
            const b = document.getElementById('live-btn'); if (b) b.textContent = on ? '✖ Quitter l’écran live' : '📺 Écran live';
            if (on) toast('📺 Écran live : interface épurée pour ton stream', '#9146FF');
        }
