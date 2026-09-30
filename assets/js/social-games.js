/* =====================================================================
           HUB 2 : onglet Amis, Chaîne de persos, Loup-garou, quiz des joueurs,
           règles perso, deck, prestige, heure de pointe, saison à thème
           ===================================================================== */
        const h2 = { extra: null, ch: null, lg: null, lgp: null, uq: null, chatLg: [] };
        const h2esc = v7esc;
        const h2Left = (endsAt, serverNow) => Math.max(0, Math.ceil(((endsAt - serverNow) - (Date.now() - (h2._recv || Date.now()))) / 1000));

        /* ---------- panneaux de jeu ---------- */
        (function () {
            const anchor = document.getElementById('guess-room');
            if (!anchor) return;
            [['chaine-room', 'ch'], ['lg-room', 'lg'], ['uq-room', 'uq']].forEach(([id]) => {
                const d = document.createElement('div'); d.id = id; d.className = 'game-panel h2-panel'; d.style.display = 'none';
                anchor.parentNode.insertBefore(d, anchor.nextSibling);
            });
            const orig = window.hideAllPanels;
            window.hideAllPanels = function () { const r = orig.apply(this, arguments); ['chaine-room', 'lg-room', 'uq-room'].forEach(id => { const e = document.getElementById(id); if (e) e.style.display = 'none'; }); return r; };
        })();
        function h2Show(id) {
            const el = document.getElementById(id);
            if (el && el.style.display !== 'none') return el;
            hideAllPanels();
            el.style.display = 'block';
            return el;
        }
        function h2Head(title, sub, q) {
            const host = q && q.hostId === socket.id;
            return `<div class="h2-head"><div><h2>${title}</h2>${sub ? `<div class="h2-sub">${sub}</div>` : ''}</div><div class="h2-hbtns">${host ? `<button onclick="h2Back()">🔙 Salon</button>` : ''}<button onclick="leaveRoom()">🚪 Quitter</button></div></div>`;
        }
        function h2Back() { returningToWaitingRoom = true; socket.emit('back_to_menu', currentRoomCode); }
        function h2Replay() { socket.emit('start_game', currentRoomCode); }
        function h2EndBtns(q) {
            return q.hostId === socket.id ? `<div class="hb-btns" style="justify-content:center;"><button class="go" onclick="h2Replay()">🔁 Rejouer</button><button onclick="h2Back()">🔙 Retour au salon</button></div>` : `<p class="tl-hint">En attente de l’hôte…</p>`;
        }
        socket.on('hub2_closed', () => { returningToWaitingRoom = true; h2.ch = h2.lg = h2.uq = null; ['chaine-room', 'lg-room', 'uq-room'].forEach(id => { const e = document.getElementById(id); if (e) e.style.display = 'none'; }); });
        socket.on('connect', () => { if (currentRoomCode && (h2.ch || h2.lg || h2.uq)) setTimeout(() => socket.emit('hub2_sync', { roomCode: currentRoomCode }), 700); });
        function h2PlayersHtml(players, extra) {
            return `<div class="h2-players">${players.map(p => `<div class="${p.id === socket.id ? 'me' : ''}${extra && extra(p) ? ' ' + extra(p) : ''}">${avatarHtml(p.name, p.cos)}<span>${cosNameHtml(p.name, p.cos)}</span><b>${p.score != null ? p.score : ''}</b></div>`).join('')}</div>`;
        }

        /* ---------- Chaîne de persos ---------- */
        socket.on('chaine_state', q => {
            if (!q || !currentRoomCode) return;
            const newTurn = !h2.ch || h2.ch.turnId !== q.turnId || h2.ch.length !== q.length;
            h2.ch = q; h2._recv = Date.now();
            chRender(newTurn);
        });
        socket.on('chaine_feedback', d => {
            const f = document.getElementById('ch-fb');
            if (f) { f.textContent = d.ok ? '✅' : d.msg; f.className = 'ch-fb ' + (d.ok ? 'ok' : 'ko'); }
            if (!d.ok) { const i = document.getElementById('ch-input'); if (i) { i.classList.add('shake'); setTimeout(() => i.classList.remove('shake'), 400); i.select(); } }
        });
        socket.on('chaine_out', d => toast(`⛓️ ${h2esc(d.name)} est éliminé !`, 'var(--accent-pink)'));
        function chRender(newTurn) {
            const q = h2.ch;
            const el = h2Show('chaine-room');
            const mine = q.turnId === socket.id && q.phase === 'playing';
            const meP = q.players.find(p => p.id === socket.id) || {};
            const keepVal = document.getElementById('ch-input') && !newTurn ? document.getElementById('ch-input').value : '';
            let body;
            if (q.phase === 'finished') {
                body = `<div class="ch-end"><div class="ch-end-t">${q.solo ? `⛓️ Chaîne de <b>${q.length}</b> persos !` : q.winnerNames && q.winnerNames.length ? `🏆 ${q.winnerNames.map(h2esc).join(', ')} gagne !` : 'Partie terminée'}</div>${h2EndBtns(q)}</div>`;
            } else {
                body = `<div class="ch-top"><div class="ch-letter${mine ? ' me' : ''}"><span>${h2esc(q.letter || '?')}</span><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="46" id="ch-ring"/></svg></div>
                    <div class="ch-turn"><div class="ch-who">${mine ? '👉 <b>À toi !</b>' : `C'est à <b>${h2esc(q.turnName || '')}</b>`}</div><div class="tl-hint">Un perso (prénom, nom ou les deux) qui commence par <b>${h2esc(q.letter)}</b> • ${q.possible} possible${q.possible > 1 ? 's' : ''} encore • <span id="ch-timer"></span></div>
                    ${meP.alive === false ? '<div class="ch-fb ko">💀 Tu es éliminé : regarde la suite !</div>' : `<div class="ch-in"><input id="ch-input" class="v7-input" autocomplete="off" placeholder="${mine ? `Un perso en ${h2esc(q.letter)}…` : 'Attends ton tour…'}" ${mine ? '' : 'disabled'} onkeydown="if(event.key==='Enter')chSend()"><button class="btn-action" ${mine ? '' : 'disabled'} onclick="chSend()">Valider</button></div><div id="ch-fb" class="ch-fb"></div>`}</div></div>`;
            }
            const chain = q.chain.slice(-14).map((c, i, a) => `<div class="ch-link${i === a.length - 1 ? ' last' : ''}"><img src="${h2esc(c.img)}" alt="" loading="lazy" onerror="this.style.opacity=.15"><div><b>${c.said ? h2esc(c.said.slice(0, -1)) + '<u class="ch-lastl">' + h2esc(c.said.slice(-1)) + '</u>' : h2esc(c.name)}</b><small>${c.said && chNorm(c.said) !== chNorm(c.name) ? h2esc(c.name) + ' • ' : ''}${h2esc(c.anime)} • ${h2esc(c.by)}</small></div></div>`).join('<span class="ch-arrow">→</span>');
            el.innerHTML = h2Head('⛓️ CHAÎNE DE PERSOS', `${h2esc(q.universeLabel || '')} • chaîne : <b>${q.length}</b>`, q) + body
                + `<div class="ch-chain">${chain || '<p class="tl-hint">La chaîne commence ! Premier perso en ' + h2esc(q.letter || '') + '.</p>'}</div>`
                + h2PlayersHtml(q.players, p => (p.alive ? '' : 'out') + (p.turn ? ' turn' : ''))
                + (q.log.length ? `<div class="h2-log">${q.log.slice(-4).map(h2esc).join('<br>')}</div>` : '');
            const inp = document.getElementById('ch-input');
            if (inp && mine) { inp.value = keepVal; if (window.innerWidth > 700 || newTurn) setTimeout(() => inp.focus(), 30); }
            const cl = el.querySelector('.ch-chain'); if (cl) cl.scrollLeft = cl.scrollWidth;
        }
        function chNorm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[^a-z]/g, ''); }
        function chSend() { const i = document.getElementById('ch-input'); if (!i || !i.value.trim()) return; socket.emit('chaine_answer', { roomCode: currentRoomCode, text: i.value.trim() }); }
        setInterval(() => {
            const q = h2.ch;
            if (!q || q.phase !== 'playing') return;
            const t = document.getElementById('ch-timer'), ring = document.getElementById('ch-ring');
            const left = Math.max(0, (q.endsAt - q.serverNow) - (Date.now() - h2._recv));
            if (t) { t.textContent = `⏱️ ${Math.ceil(left / 1000)} s`; t.classList.toggle('hurry', left < 5000); }
            if (ring) { ring.style.strokeDasharray = '289'; ring.style.strokeDashoffset = String(289 * (1 - left / q.turnMs)); ring.classList.toggle('hurry', left < 5000); }
        }, 200);

        /* ---------- Loup-garou anime (16 joueurs, 17 rôles) ---------- */
        const lgc = { msgs: [], wheelDone: {}, roles: null };
        const LG_AURA = { claire: '☀️ claire', obscure: '🌑 obscure', inconnue: '❔ inconnue' };
        const LG_CH = { public: ['💬', 'Village'], demons: ['👹', 'Chat des démons'], jail: ['🌀', 'Domaine de Gojo'], dead: ['👻', 'Monde des morts'] };
        socket.on('lg_state', q => { if (!q || !currentRoomCode) return; const prev = h2.lg; if (q.gameId && lgc.gameId !== q.gameId) { lgc.gameId = q.gameId; lgc.msgs = []; lgc.armed = null; } h2.lg = q; h2._lgRecv = Date.now(); if (!prev || prev.phase !== q.phase) { lgc.pick = null; lgc.armed = null; } lgRender(); });
        socket.on('lg_private', p => { h2.lgp = p; if (h2.lg) lgRender(); });
        socket.on('lg_notice', d => d && d.text && toast(h2esc(d.text), '#b77bff'));
        socket.on('lg_msg', m => {
            if (!m || (m.gameId && lgc.gameId && m.gameId !== lgc.gameId)) return;
            lgc.msgs.push(m); if (lgc.msgs.length > 120) lgc.msgs.shift();
            const box = document.getElementById('lg-chat-list'); if (box) { box.innerHTML = lgChatHtml(); box.scrollTop = box.scrollHeight; }
        });
        function lgMyNum() { const q = h2.lg; const me = q && q.players.find(p => p.id === socket.id); return me ? me.num : null; }
        function lgChatHtml() {
            const mine = lgMyNum();
            return lgc.msgs.slice(-60).map(m => {
                const hit = mine && !m.me && new RegExp('(^|[^0-9])#?' + mine + '([^0-9]|$)').test(m.text);
                const txt = h2esc(m.text).replace(/(^|[\s,.;:!?(])#?([0-9]{1,2})(?![0-9])/g, (a, pre, n) => pre + `<span class="lg-num-ref${+n === mine ? ' me' : ''}">#${n}</span>`);
                return `<div class="lgm ch-${m.ch}${hit ? ' hit' : ''}"><i>${LG_CH[m.ch][0]}</i>${m.num ? `<span class="lg-num">${m.num}</span>` : ''}<b>${h2esc(m.from)}</b> ${txt}</div>`;
            }).join('');
        }
        function lgWheel(q, me) {
            const roles = q.composition, n = roles.length, seg = 360 / n;
            const idx = Math.max(0, roles.indexOf(me.orig.id));
            const stop = 360 * 6 + (360 - (idx * seg + seg / 2));
            const cols = ['#b91c1c', '#1d4ed8', '#15803d', '#a16207', '#7e22ce', '#0e7490', '#be185d', '#4d7c0f'];
            const grad = roles.map((r, i) => `${cols[i % cols.length]} ${i * seg}deg ${(i + 1) * seg}deg`).join(',');
            const icons = roles.map((r, i) => `<span style="transform:rotate(${i * seg + seg / 2}deg) translateY(-118px) rotate(-${i * seg + seg / 2}deg)">${q.roleInfo[r].icon}</span>`).join('');
            return `<div class="lg-wheel-wrap"><div class="lg-pointer">▼</div><div class="lg-wheel" style="background:conic-gradient(${grad});--stop:${stop}deg">${icons}</div></div>
                <div class="lg-reveal" id="lg-reveal"><div class="lg-ri big">${me.orig.icon}</div><h3>${h2esc(me.orig.name)}</h3><p>${h2esc(me.orig.desc)}</p><small>Aura : ${LG_AURA[me.orig.aura] || ''}</small></div>`;
        }
        function lgRender() {
            const q = h2.lg, me = h2.lgp;
            if (!q) return;
            const el = h2Show('lg-room');
            const keepChat = document.getElementById('lg-chat-in') ? document.getElementById('lg-chat-in').value : '';
            const now = q.serverNow + (Date.now() - h2._lgRecv);
            const fin = q.phase === 'finished';
            const phaseTxt = { intro: '🎡 Distribution des rôles', night: `🌙 Nuit ${q.day}`, talk: `☀️ Jour ${q.day} : débat`, vote: `⚖️ Jour ${q.day} : vote`, finished: '🏁 Fin de partie' }[q.phase];
            const comp = q.composition.map(r => q.roleInfo[r].icon).join('');
            if (q.phase === 'intro' && me && me.gameId === q.gameId) {
                const k = q.gameId;
                if (!el.querySelector('.lg-wheel') || lgc.wheelKey !== k) {
                    lgc.wheelKey = k;
                    el.innerHTML = h2Head('🐺 LOUP-GAROU ANIME', `${phaseTxt} • ${q.composition.length} joueurs`, q) + `<div class="lg-intro">${lgWheel(q, me)}</div>`;
                    requestAnimationFrame(() => { const w = el.querySelector('.lg-wheel'); if (w) w.classList.add('spin'); });
                    setTimeout(() => { const r = document.getElementById('lg-reveal'); if (r) r.classList.add('on'); }, 5200);
                }
                return;
            }
            if (q.phase === 'intro') { el.innerHTML = h2Head('🐺 LOUP-GAROU ANIME', phaseTxt, q) + '<div class="arc-loading"><div class="arc-spin"></div><div>Distribution des rôles…</div></div>'; return; }
            const alive = me && me.alive;
            const acts = (me && me.gameId === q.gameId && me.actions) || [];
            const onCard = acts.filter(a => a.targets);
            const solo = acts.filter(a => a.solo);
            const role = me && me.role;
            let info = '';
            if (me) {
                const L = [];
                (me.notes || []).forEach(t => L.push('🔒 ' + h2esc(t)));
                (me.info || []).forEach(t => L.push(h2esc(t)));
                if (me.mates && me.mates.length) L.push('👹 Ton équipe : ' + me.mates.map(m => `${h2esc(m.name)} = ${m.role.icon} ${h2esc(m.role.name)}${m.alive ? '' : ' ☠️'}`).join(' • '));
                if (me.demonVotes && me.demonVotes.length) L.push('🗳️ Choix des démons : ' + me.demonVotes.map(v => `${h2esc(v.by)} → ${h2esc(v.target)}`).join(' • '));
                if (me.demonSeen && me.demonSeen.length) L.push('👺 Vu par Kokushibo : ' + me.demonSeen.map(s => `${h2esc(s.name)} = ${s.role.icon} ${h2esc(s.role.name)}`).join(' • '));
                if (me.seen && me.seen.length) L.push('👁️ Sharingan : ' + me.seen.map(s => `${h2esc(s.name)} = ${s.role.icon} ${h2esc(s.role.name)}`).join(' • '));
                if (me.auras && me.auras.length) L.push('🐸 Auras : ' + me.auras.map(s => `${h2esc(s.name)} = ${LG_AURA[s.aura]}`).join(' • '));
                if (!alive && !fin) L.push('👻 Tu es mort : tu peux parler avec les autres morts.');
                info = L.map(t => `<small class="lg-mates">${t}</small>`).join('');
            }
            const roleCard = role ? `<div class="lg-role t-${role.team}"><span class="lg-ri">${role.icon}</span><div><b>${h2esc(role.name)}</b><small>${h2esc(role.desc)}</small>${info}</div></div>` : '';
            let hint = '';
            if (!fin && alive) {
                if (q.phase === 'night') hint = !acts.length ? (me.info || []).some(t => t.includes('enfermé')) ? '🌀 Tu es enfermé : discute avec ton geôlier.' : '😴 Tu dors… attends le lever du jour.' : me.done ? '✔ Tu as joué. Tu peux encore changer d’avis.' : 'Choisis ta cible sur les cartes des joueurs.';
                else if (q.phase === 'talk') hint = '💬 Débattez ! Le vote commence dans quelques secondes.';
                else hint = `⚖️ Votez pour éliminer un suspect : il faut <b>${q.need || '?'}</b> voix pour éliminer quelqu’un.`;
            }
            const grid = q.players.map(p => {
                const btns = onCard.filter(a => a.targets.includes(p.key)).map(a => {
                    const picked = a.picked === p.key || (lgc.pick && lgc.pick.kind === a.kind && lgc.pick.key === p.key);
                    const armed = lgc.armed === a.kind + ':' + p.key;
                    return `<button class="k-${a.kind}${picked ? ' on' : ''}${armed ? ' armed' : ''}" onclick="lgAct('${a.kind}','${h2esc(p.key)}')">${armed ? '⚠️ Confirmer ?' : (picked ? '✔ ' : '') + a.label}</button>`;
                }).join('');
                const mate = me && (me.mates || []).find(m => m.key === p.key);
                return `<div class="lg-p${p.alive ? '' : ' dead'}${p.id === socket.id ? ' me' : ''}${mate ? ' mate' : ''}"><span class="lg-num">${p.num || ''}</span>${avatarHtml(p.name, p.cos)}<b>${h2esc(p.name)}${p.hokage ? ' 🏯' : ''}${p.lover ? ' 💘' : ''}</b>
                    ${p.role ? `<small>${p.role.icon} ${h2esc(p.role.name)}</small>` : mate ? `<small class="lg-materole">${mate.role.icon} ${h2esc(mate.role.name)}</small>` : p.alive ? '' : '<small>☠️</small>'}
                    ${q.phase === 'vote' && p.voteFor ? `<small class="lg-votefor">🗳️ ${p.voteFor === 'blanc' ? 'blanc' : '→ #' + p.voteFor}</small>` : ''}
                    ${q.phase === 'vote' && p.votes ? `<em class="lg-votes">${p.votes} 🗳️</em>` : ''}${q.phase === 'vote' && p.voted && p.alive ? '<em class="lg-voted">✔</em>' : ''}${btns}</div>`;
            }).join('');
            const soloHtml = solo.length ? `<div class="hb-btns lg-solo">${solo.map(a => `<button class="${a.kind === 'execute' ? 'danger' : ''}${lgc.armed === a.kind + ':' ? ' armed' : ''}" onclick="lgAct('${a.kind}')">${lgc.armed === a.kind + ':' ? '⚠️ Confirmer ?' : a.label}</button>`).join('')}</div>` : '';
            const ch = me && me.channel;
            const chatIn = ch ? `<div class="lg-chan">${LG_CH[ch][0]} ${LG_CH[ch][1]}</div><div class="ch-in"><input id="lg-chat-in" class="v7-input" maxlength="200" placeholder="Écrire…" onkeydown="if(event.key==='Enter')lgChat()"><button onclick="lgChat()">➤</button></div>` : `<div class="tl-hint">🌙 Silence, c’est la nuit…</div>`;
            const endHtml = fin ? `<div class="ch-end"><div class="ch-end-t">${q.log[q.log.length - 1] ? h2esc(q.log[q.log.length - 1]) : ''}</div>${q.winnerNames && q.winnerNames.length ? `<p>🏆 Gagnants : ${q.winnerNames.map(h2esc).join(', ')}</p>` : ''}${h2EndBtns(q)}</div>` : '';
            const bars = me && me.jailed ? `<div class="lg-bars"><div class="lg-bars-txt">🌀 Tu es enfermé dans le domaine<br><small>Tes capacités sont bloquées cette nuit. Tu peux parler avec ton geôlier.</small></div></div>` : '';
            el.innerHTML = bars + h2Head('🐺 LOUP-GAROU ANIME', `${phaseTxt} • <span id="lg-timer"></span> • ${comp}`, q)
                + `<div class="lg-wrap ${q.phase === 'night' ? 'night' : fin ? 'fin' : 'day'}"><div class="lg-main">${endHtml}${roleCard}${hint ? `<div class="lg-hint">${hint}</div>` : ''}${soloHtml}<div class="lg-grid">${grid}</div></div>
                <div class="lg-side"><div class="lg-log">${q.log.slice(-14).map(h2esc).join('<br>')}</div><div class="lg-chat"><div id="lg-chat-list">${lgChatHtml()}</div>${chatIn}</div></div></div>`;
            const ci = document.getElementById('lg-chat-in'); if (ci && keepChat) { ci.value = keepChat; ci.focus(); }
            const cl = document.getElementById('lg-chat-list'); if (cl) cl.scrollTop = cl.scrollHeight;
            const lgl = el.querySelector('.lg-log'); if (lgl) lgl.scrollTop = lgl.scrollHeight;
        }
        function lgAct(kind, key) {
            // actions définitives : 1er clic = « Confirmer ? », 2e clic = on valide (pas de fenêtre du navigateur)
            if (kind === 'execute' || kind === 'shoot') {
                const id = kind + ':' + (key || '');
                if (lgc.armed !== id) { lgc.armed = id; lgRender(); clearTimeout(lgc.armT); lgc.armT = setTimeout(() => { if (lgc.armed === id) { lgc.armed = null; lgRender(); } }, 4000); return; }
                lgc.armed = null;
            }
            lgc.pick = key ? { kind, key } : null;
            socket.emit('lg_act', { roomCode: currentRoomCode, kind, target: key || null });
        }
        function lgChat() { const i = document.getElementById('lg-chat-in'); if (!i || !i.value.trim()) return; socket.emit('lg_chat', { roomCode: currentRoomCode, text: i.value.trim() }); i.value = ''; }
        setInterval(() => {
            const q = h2.lg; if (!q || q.phase === 'finished') return;
            const t = document.getElementById('lg-timer'); if (!t) return;
            const now = q.serverNow + (Date.now() - h2._lgRecv);
            t.textContent = `⏱️ ${Math.max(0, Math.ceil((q.endsAt - now) / 1000))} s`;
        }, 500);
        // règles et rôles expliqués dans le salon d'attente
        function lgRulesHide() { const b = document.getElementById('lg-rules-box'); if (b) b.style.display = 'none'; }
        (function () { const o = goToMenuSelection; goToMenuSelection = function () { lgRulesHide(); lgc.roomMode = null; return o.apply(this, arguments); }; })();
        socket.on('update_room', async room => {
            // les règles du Loup-garou ne s'affichent QUE dans un salon Loup-garou en attente ; sinon on les cache toujours
            lgc.roomMode = room && room.mode;
            if (!room || room.mode !== 'loupgarou' || room.status !== 'waiting' || (currentRoomCode && room.code !== currentRoomCode)) return lgRulesHide();
            let box = document.getElementById('lg-rules-box');
            if (!lgc.roles) { const d = await v7get('/api/lg/roles'); if (d && d.ok) lgc.roles = d; else return; }
            if (lgc.roomMode !== 'loupgarou') return lgRulesHide(); // le salon a changé pendant le chargement
            const R = lgc.roles;
            if (!box) { box = document.createElement('div'); box.id = 'lg-rules-box'; box.className = 'lg-rules'; const list = document.getElementById('waiting-players-list'); (list ? list.parentNode : document.getElementById('waiting-room')).appendChild(box); }
            box.style.display = '';
            const n = room.players.length, comp = R.order.slice(0, Math.min(R.max, n));
            const team = { demons: '👹 Démons', village: '🍃 Village', kira: '📓 Solitaire', buggy: '🤡 Solitaire' };
            box.innerHTML = `<h3>🐺 Loup-garou anime : règles</h3>
                <p class="tl-hint">4 à ${R.max} joueurs • 🌙 nuit ${R.timings.night} s → ☀️ débat ${R.timings.talk} s → ⚖️ vote ${R.timings.vote} s. Au début, une roue tire ton rôle. Les démons ont un chat secret la nuit. Un rôle mort est révélé à tous.</p>
                <p class="tl-hint">🎯 Le village gagne quand il n’y a plus ni démon ni Kira. Les démons gagnent quand ils sont aussi nombreux que les autres. Kira gagne seul. Buggy gagne s’il est voté. Le couple + Cupidon gagnent s’ils sont les derniers.</p>
                <div class="lg-comp"><b>Avec ${n} joueur${n > 1 ? 's' : ''} :</b> ${n < 4 ? 'il faut au moins 4 joueurs' : comp.map(r => `<span title="${h2esc(R.roles[r].name)}">${R.roles[r].icon}</span>`).join('')}</div>
                <details><summary>📖 Tous les rôles (${R.order.length + 1})</summary><div class="lg-rlist">${[...R.order, 'villager'].map(r => { const x = R.roles[r]; return `<div class="${comp.includes(r) ? 'in' : ''}"><span>${x.icon}</span><div><b>${h2esc(x.name)}</b> <small>${team[x.team]} • aura ${LG_AURA[x.aura]}</small><p>${h2esc(x.desc)}</p></div></div>`; }).join('')}</div></details>`;
        });

        /* ---------- Quiz des joueurs : partie ---------- */
        socket.on('uq_state', q => { if (!q || !currentRoomCode) return; h2.uq = q; h2._uqRecv = Date.now(); uqRender(); });
        function uqRender() {
            const q = h2.uq; const el = h2Show('uq-room');
            const me = q.players.find(p => p.id === socket.id) || {};
            let body;
            if (q.phase === 'finished') {
                const sorted = q.players.slice().sort((a, b) => b.score - a.score);
                body = `<div class="ch-end"><div class="ch-end-t">${q.winnerNames && q.winnerNames.length ? `🏆 ${q.winnerNames.map(h2esc).join(', ')}` : '🏁 Quiz terminé'}</div>
                    <div class="uq-rank">${sorted.map((p, i) => `<div><span>${['🥇', '🥈', '🥉'][i] || i + 1 + '.'}</span><b>${h2esc(p.name)}</b><em>${p.score} pts</em></div>`).join('')}</div>
                    <div class="uq-rate" id="uq-rate"><span>Note ce quiz :</span>${[1, 2, 3, 4, 5].map(n => `<button onclick="uqRate('${q.quizId}',${n})">⭐</button>`).join('')}</div>${h2EndBtns(q)}</div>`;
            } else {
                const rev = q.phase === 'reveal';
                body = `<div class="uq-q"><small>Question ${q.round}/${q.total}</small><b>${h2esc(q.q || '')}</b><div class="uq-bar"><i id="uq-bar"></i></div></div>
                    <div class="uq-choices">${(q.choices || []).map((c, i) => `<button class="${rev ? (i === q.answer ? 'good' : me.pick === i ? 'bad' : '') : me.done && me.pick === i ? 'picked' : ''}" ${me.done || rev ? 'disabled' : ''} onclick="uqPick(${i})">${['🅰️', '🅱️', '©️', '🇩'][i]} ${h2esc(c)}</button>`).join('')}</div>
                    <div class="tl-hint">${rev ? (me.correct ? `✅ Bonne réponse ! +${me.gained}` : '❌ Raté') : me.done ? 'Réponse envoyée, attends les autres…' : 'Plus tu réponds vite, plus tu gagnes de points'}</div>`;
            }
            el.innerHTML = h2Head('📝 ' + h2esc(q.title).toUpperCase(), `par ${h2esc(q.author)}${q.anime ? ' • ' + h2esc(q.anime) : ''}`, q) + body + h2PlayersHtml(q.players.map(p => ({ ...p, score: p.score + (p.done && q.phase === 'playing' ? ' ✔' : '') })));
        }
        function uqPick(i) { if (h2.uq) { const me = h2.uq.players.find(p => p.id === socket.id); if (me) { me.done = true; me.pick = i; } uqRender(); } socket.emit('uq_answer', { roomCode: currentRoomCode, idx: i }); }
        async function uqRate(id, n) {
            const d = await v7post('/api/quiz/rate', { id, stars: n });
            const b = document.getElementById('uq-rate');
            if (b) b.innerHTML = d && d.ok ? `Merci ! Note moyenne : ⭐ ${d.quiz.rating} (${d.quiz.votes} vote${d.quiz.votes > 1 ? 's' : ''})` : h2esc((d && d.error) || 'Crée un compte pour noter.');
        }
        setInterval(() => {
            const q = h2.uq; if (!q || q.phase !== 'playing') return;
            const b = document.getElementById('uq-bar'); if (!b) return;
            const left = Math.max(0, (q.endsAt - q.serverNow) - (Date.now() - h2._uqRecv));
            b.style.width = (100 * left / q.roundMs) + '%';
        }, 150);

        /* ---------- Quiz des joueurs : parcourir / créer ---------- */
        const uqb = { sort: 'top', q: '' };
        async function openQuizBrowser(tab) {
            if (tab) uqb.sort = tab;
            const m = hubModal('uq-browser', `<h3>📝 Quiz des joueurs</h3><div class="eco-tabs"><button data-t="top" onclick="openQuizBrowser('top')">⭐ Populaires</button><button data-t="new" onclick="openQuizBrowser('new')">🆕 Nouveaux</button><button data-t="mine" onclick="openQuizBrowser('mine')">✏️ Mes quiz</button></div>
                <div class="ch-in"><input id="uq-search" class="v7-input" placeholder="🔎 Chercher un quiz, un anime, un auteur" value="${h2esc(uqb.q)}" onkeydown="if(event.key==='Enter'){uqb.q=this.value;openQuizBrowser()}"><button class="go-btn" onclick="openQuizEditor()">➕ Créer un quiz</button></div><div id="uq-list"><div class="arc-loading"><div class="arc-spin"></div></div></div>`, true);
            m.querySelectorAll('.eco-tabs button').forEach(b => b.classList.toggle('on', b.dataset.t === uqb.sort));
            const d = await v7get('/api/quiz?sort=' + (uqb.sort === 'new' ? 'new' : 'top') + '&q=' + encodeURIComponent(uqb.q));
            const box = document.getElementById('uq-list'); if (!box || !d) return;
            const list = uqb.sort === 'mine' ? d.mine : d.list;
            box.innerHTML = list.length ? list.map(q => `<div class="uq-row"><div><b>${h2esc(q.title)}</b><small>${q.anime ? h2esc(q.anime) + ' • ' : ''}par ${h2esc(q.author)} • ${q.rating ? `⭐ ${q.rating} (${q.votes})` : 'pas encore noté'} • ${q.plays} partie${q.plays > 1 ? 's' : ''}</small></div>
                <div class="hb-btns"><button class="go" onclick="document.getElementById('uq-browser').remove();createRoom('uquiz','${q.id}')">▶ Jouer</button>${q.mine ? `<button onclick="openQuizEditor('${q.id}')">✏️</button><button onclick="quizDelete('${q.id}')">🗑️</button>` : ''}</div></div>`).join('')
                : `<p class="tl-hint">${uqb.sort === 'mine' ? 'Tu n’as pas encore créé de quiz.' : 'Aucun quiz pour le moment : crée le premier !'}</p>`;
        }
        async function quizDelete(id) { if (!confirm('Supprimer ce quiz ?')) return; await v7post('/api/quiz/delete', { id }); openQuizBrowser('mine'); }
        async function openQuizEditor(id) {
            if (!isAccount()) return toast('Crée un compte pour créer un quiz.', 'var(--accent-pink)');
            let data = { title: '', anime: '', questions: Array.from({ length: 10 }, () => ({ q: '', choices: ['', '', '', ''], answer: 0 })) };
            if (id) { const d = await v7get('/api/quiz/one?id=' + id); if (d && d.ok && d.questions) data = { id, title: d.quiz.title, anime: d.quiz.anime, questions: d.questions }; }
            document.getElementById('uq-browser')?.remove();
            hubModal('uq-editor', `<h3>${id ? '✏️ Modifier mon quiz' : '📝 Créer un quiz'}</h3><p class="tl-hint">10 questions, 4 réponses chacune : coche la bonne. Les autres joueurs pourront le jouer et le noter.</p>
                <input id="uqe-title" class="v7-input" maxlength="60" placeholder="Titre (ex : Le quiz ultime One Piece)" value="${h2esc(data.title)}"><input id="uqe-anime" class="v7-input" maxlength="40" placeholder="Anime (facultatif)" value="${h2esc(data.anime)}">
                ${data.questions.map((x, i) => `<div class="uqe-q"><b>Question ${i + 1}</b><input class="v7-input uqe-text" maxlength="160" placeholder="Ta question…" value="${h2esc(x.q)}">
                    <div class="uqe-ch">${x.choices.map((c, j) => `<label><input type="radio" name="uqe-a${i}" value="${j}" ${x.answer === j ? 'checked' : ''}><input class="v7-input uqe-c" maxlength="60" placeholder="Réponse ${j + 1}" value="${h2esc(c)}"></label>`).join('')}</div></div>`).join('')}
                <div id="uqe-err" class="ch-fb ko"></div><button class="btn-action" onclick="quizSave(${id ? `'${id}'` : ''})">💾 Enregistrer le quiz</button>`, true);
        }
        async function quizSave(id) {
            const qs = [...document.querySelectorAll('.uqe-q')].map((b, i) => ({ q: b.querySelector('.uqe-text').value, choices: [...b.querySelectorAll('.uqe-c')].map(x => x.value), answer: +((b.querySelector(`input[name="uqe-a${i}"]:checked`) || {}).value || 0) }));
            const d = await v7post('/api/quiz', { id, title: document.getElementById('uqe-title').value, anime: document.getElementById('uqe-anime').value, questions: qs });
            if (!d || !d.ok) { const e = document.getElementById('uqe-err'); if (e) e.textContent = '❌ ' + ((d && d.error) || 'Impossible'); return; }
            document.getElementById('uq-editor')?.remove();
            toast('📝 Quiz enregistré !', '#00ff88');
            openQuizBrowser('mine');
        }

        /* ---------- salon personnalisé (mini-jeux) ---------- */
        socket.on('update_room', room => {
            if (!room || room.status !== 'waiting' || room.code !== currentRoomCode) return;
            let box = document.getElementById('room-rules-box');
            const anchor = document.getElementById('room-teams-box') || document.getElementById('room-rounds-box');
            if (!box && anchor) { box = document.createElement('div'); box.id = 'room-rules-box'; box.className = 'room-rounds rules'; anchor.parentNode.insertBefore(box, anchor.nextSibling); }
            if (!box) return;
            if (room.mode !== 'arcade' || String(room.subMode || '').startsWith('pixel:daily')) { box.style.display = 'none'; return; }
            box.style.display = 'flex';
            const r = room.rules || { time: 1, pts: 1, streak: false };
            const host = room.host === socket.id;
            const T = { 0.5: '⚡ Très rapide (x0,5)', 0.75: '🏃 Rapide', 1: '⏱️ Normal', 1.5: '🐢 Lent', 2: '🐌 Très lent (x2)' };
            box.innerHTML = host ? `<span>🛠️ Règles :</span><select onchange="setRules({time:+this.value})">${Object.entries(T).map(([v, l]) => `<option value="${v}" ${+v === r.time ? 'selected' : ''}>${l}</option>`).join('')}</select>
                <select onchange="setRules({pts:+this.value})">${[1, 2, 3].map(n => `<option value="${n}" ${n === r.pts ? 'selected' : ''}>Points x${n}</option>`).join('')}</select>
                <label><input type="checkbox" ${r.streak ? 'checked' : ''} onchange="setRules({streak:this.checked})"> 🔥 Bonus de série</label>`
                : `<span>🛠️ Règles :</span><b>${T[r.time] || 'Normal'} • Points x${r.pts}${r.streak ? ' • 🔥 bonus de série' : ''}</b>`;
            box.dataset.rules = JSON.stringify(r);
        });
        function setRules(patch) { const box = document.getElementById('room-rules-box'); const r = Object.assign(JSON.parse((box && box.dataset.rules) || '{"time":1,"pts":1,"streak":false}'), patch); socket.emit('set_rules', { roomCode: currentRoomCode, rules: r }); }

        /* ---------- onglet Amis ---------- */
        (function () {
            const orig = window.switchTab;
            window.switchTab = function (t) { const r = orig.apply(this, arguments); if (t === 'amis') { loadFriends(); h2FriendsExtra(); } return r; };
        })();
        async function h2FriendsBadge() {
            const b = document.getElementById('friends-badge'); if (!b) return;
            if (!isAccount()) { b.style.display = 'none'; return; }
            const d = await v7get('/api/friends');
            if (!d || !d.ok) return;
            const on = d.friends.filter(f => f.online).length, inc = d.incoming.length;
            b.style.display = on || inc ? '' : 'none';
            b.textContent = inc ? inc + ' !' : on;
            b.classList.toggle('alert', !!inc);
            const h = document.getElementById('friends-head');
            if (h) h.innerHTML = `<b>${d.friends.length}</b> ami${d.friends.length > 1 ? 's' : ''} • <span style="color:#00ff88">● ${on} en ligne</span>${inc ? ` • <span style="color:var(--accent-yellow)">📩 ${inc} demande${inc > 1 ? 's' : ''}</span>` : ''}`;
        }
        function h2FriendsExtra() { h2FriendsBadge(); }
        socket.on('connect', () => setTimeout(h2FriendsBadge, 1500));
        socket.on('friends_changed', () => { h2FriendsBadge(); if (document.getElementById('amis')?.classList.contains('active')) loadFriends(); });
        setInterval(() => { if (!document.hidden) { h2FriendsBadge(); if (document.getElementById('amis')?.classList.contains('active')) loadFriends(); } }, 30000);

        /* ---------- deck de 5 cartes ---------- */
        (function () {
            const orig = ecoTab;
            ecoTab = function (t) {
                const el = document.getElementById('eco-deck');
                if (t !== 'deck') { if (el) el.style.display = 'none'; return orig(t); }
                eco.tab = t;
                document.querySelectorAll('.eco-tabs button').forEach(b => b.classList.toggle('on', b.dataset.t === t));
                document.querySelectorAll('#collection [id^="eco-"]').forEach(x => { if (x.id !== 'eco-deck' && x.id !== 'eco-tabs') x.style.display = 'none'; });
                el.style.display = '';
                if (!isAccount()) { el.innerHTML = '<p class="tl-hint">Crée un compte pour composer ton deck.</p>'; return; }
                loadDeck();
            };
        })();
        const dk = { keys: [], cards: [], q: '' };
        async function loadDeck() {
            const [d, all] = await Promise.all([v7get('/api/deck'), v7get('/api/trade/cards')]);
            if (!d || !d.ok) return;
            dk.keys = d.deck.map(c => c.key); dk.cards = (all && all.cards) || []; dk.rules = d.rules; dk.pct = d.pct;
            deckRender();
        }
        function deckPctLocal() { let p = 0; dk.keys.forEach(k => { const c = dk.cards.find(x => x.key === k); if (c) p += (dk.rules[c.rarity] || 0) + (c.shiny ? 2 : 0); }); return p; }
        function deckRender() {
            const el = document.getElementById('eco-deck'); if (!el) return;
            const slot = i => { const c = dk.cards.find(x => x.key === dk.keys[i]); return c ? `<div class="dk-slot" onclick="deckToggle(${JSON.stringify(c.key).replace(/"/g, '&quot;')})">${cardHtml({ ...c, n: 1 })}<small>+${(dk.rules[c.rarity] || 0) + (c.shiny ? 2 : 0)} %</small></div>` : `<div class="dk-slot empty">＋<small>Emplacement ${i + 1}</small></div>`; };
            const q = dk.q.toLowerCase();
            const list = dk.cards.filter(c => !q || (c.name + ' ' + c.anime).toLowerCase().includes(q)).sort((a, b) => ['omega', 'eternelle', 'cosmique', 'divine', 'secrete', 'halloween', 'mythique', 'legendaire', 'epique', 'rare', 'commune'].indexOf(a.rarity) - ['omega', 'eternelle', 'cosmique', 'divine', 'secrete', 'halloween', 'mythique', 'legendaire', 'epique', 'rare', 'commune'].indexOf(b.rarity)).slice(0, 80);
            el.innerHTML = `<div class="shop-head">🎴 Ton deck : <b>+${deckPctLocal()} %</b> de pièces à chaque partie <span class="tl-hint">• Commune +2 %, Rare +4 %, Épique +6 %, Légendaire +10 %, Mythique +14 %, Secrète +20 %, Divine +25 %, Cosmique +30 %, Éternelle +40 %, Oméga +50 %, brillante +2 % • bonus doublé si la partie est sur l’anime de la carte • sans limite</span></div>
                <div class="dk-slots">${[0, 1, 2, 3, 4].map(slot).join('')}</div>
                <div class="ch-in"><input class="v7-input" placeholder="🔎 Chercher dans ta collection" value="${h2esc(dk.q)}" oninput="dk.q=this.value;deckList()"><button class="btn-action" style="width:auto;margin:0;" onclick="deckSave()">💾 Enregistrer</button></div>
                <div class="trd-list dk-list" id="dk-list"></div>`;
            deckList();
        }
        function deckList() {
            const box = document.getElementById('dk-list'); if (!box) return;
            const q = dk.q.toLowerCase();
            const list = dk.cards.filter(c => !q || (c.name + ' ' + c.anime).toLowerCase().includes(q)).sort((a, b) => ['omega', 'eternelle', 'cosmique', 'divine', 'secrete', 'halloween', 'mythique', 'legendaire', 'epique', 'rare', 'commune'].indexOf(a.rarity) - ['omega', 'eternelle', 'cosmique', 'divine', 'secrete', 'halloween', 'mythique', 'legendaire', 'epique', 'rare', 'commune'].indexOf(b.rarity)).slice(0, 80);
            box.innerHTML = list.map(c => `<button class="trd-mini r-${c.rarity}${dk.keys.includes(c.key) ? ' on' : ''}" onclick="deckToggle(${JSON.stringify(c.key).replace(/"/g, '&quot;')})"><img src="${h2esc(c.img)}" alt="" loading="lazy" onerror="this.style.opacity=.15"><b>${h2esc(c.name)}</b><small>${h2esc(c.anime)}${c.shiny ? ' ✨' : ''}</small></button>`).join('') || '<p class="tl-hint">Aucune carte : joue pour en gagner !</p>';
        }
        function deckToggle(k) {
            if (dk.keys.includes(k)) dk.keys = dk.keys.filter(x => x !== k);
            else { if (dk.keys.length >= 5) return toast('Ton deck est plein (5 cartes).', 'var(--accent-pink)'); dk.keys.push(k); }
            deckRender();
        }
        async function deckSave() {
            const d = await v7post('/api/deck', { keys: dk.keys });
            if (!d || !d.ok) return toast('❌ ' + ((d && d.error) || 'Impossible'), 'var(--accent-pink)');
            toast(`🎴 Deck enregistré : +${d.pct} % de pièces`, '#00ff88');
        }
        socket.on('coins_gain', d => { if (d && d.why) setTimeout(() => toast(`🪙 dont +${d.gain} grâce à ${d.why === 'deck' ? 'ton deck 🎴' : 'la ' + h2esc(d.why) + ' 🌟'}`, '#ffd700'), 600); });

        /* ---------- prestige + étoiles devant le pseudo ---------- */
        (function () {
            const orig = cosNameHtml;
            cosNameHtml = function (name, cos) { const n = cos && cos.prestige; return orig(name, cos) + (n ? `<span class="cn-prest" title="Prestige ${n}">⭐${n > 1 ? n : ''}</span>` : ''); };
        })();
        async function loadPrestige() {
            const box = document.getElementById('prestige-panel'); if (!box) return;
            if (!isAccount()) { box.innerHTML = ''; return; }
            const d = await v7get('/api/prestige'); if (!d || !d.ok) return;
            const pct = Math.min(100, Math.round(100 * (d.level - 1) / (d.need - 1)));
            box.innerHTML = `<h3>⭐ Prestige ${d.prestige ? `<span class="cn-prest">⭐${d.prestige}</span>` : ''}</h3><div class="tl-hint">Au niveau ${d.need}, recommence au niveau 1 et gagne une étoile à côté de ton pseudo + ${d.reward} 🪙.</div>
                <div class="hb-bar" style="margin:6px 0;"><i style="width:${pct}%;background:linear-gradient(90deg,#ffd700,#ff9a3c)"></i><span>Niveau ${d.level} / ${d.need}</span></div>
                ${d.can ? `<button class="btn-action" onclick="doPrestige()">⭐ Passer prestige ${d.prestige + 1}</button>` : ''}`;
        }
        async function doPrestige() {
            if (!confirm('Recommencer au niveau 1 pour gagner une étoile de prestige ?')) return;
            const d = await v7post('/api/prestige', {});
            if (!d || !d.ok) return toast('❌ ' + ((d && d.error) || 'Impossible'), 'var(--accent-pink)');
            toast(`⭐ Prestige ${d.prestige} ! +1000 🪙`, '#ffd700'); confetti(2500); loadPrestige();
            if (currentUser) { currentUser.cos = currentUser.cos || {}; currentUser.cos.prestige = d.prestige; }
        }
        (function () {
            const opt = document.querySelector('#options > div');
            if (opt && !document.getElementById('prestige-panel')) { const p = document.createElement('div'); p.id = 'prestige-panel'; p.className = 'a11y-panel'; opt.appendChild(p); }
            const orig = window.switchTab;
            window.switchTab = function (t) { const r = orig.apply(this, arguments); if (t === 'options') loadPrestige(); return r; };
        })();

        /* ---------- heure de pointe + saison à thème (accueil) ---------- */
        function h2PaletteCss(p) {
            let css = '';
            Object.entries(p || {}).forEach(([u, [a, b]]) => {
                css += `.cn-th_${u}{background:linear-gradient(90deg,${a},${b},${a});background-size:200% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;animation:cnMove 3s linear infinite;}`;
                css += `.fr-th_${u}{border-color:${a};box-shadow:0 0 0 2px ${b},0 0 14px ${a};}`;
            });
            let st = document.getElementById('h2-pal'); if (!st) { st = document.createElement('style'); st.id = 'h2-pal'; document.head.appendChild(st); }
            st.textContent = css;
        }
        async function h2LoadExtra() {
            const d = await v7get('/api/hub/extra');
            if (!d || !d.ok) return;
            h2.extra = d; h2PaletteCss(d.palettes);
            h2RenderExtra();
        }
        function h2RenderExtra() {
            const box = document.getElementById('hub-home'); const d = h2.extra;
            if (!box || !d) return;
            box.querySelectorAll('.h2-extra').forEach(e => e.remove());
            const th = d.theme, [a, b, em] = th.palette;
            const html = (d.rush ? `<div class="hub-weekend h2-extra" style="background:linear-gradient(90deg,#ff2a2a,#ffb300);">⚡ <b>HEURE DE POINTE</b> : dégâts x2 sur le boss jusqu’à ${d.rush.until} h !</div>` : '')
                + `<div class="hub-card h2-extra theme" style="--ta:${a};--tb:${b}"><div class="hb-main"><div class="hb-h">🌟 Saison à thème <small>${h2esc(th.season)}</small></div>
                  <b class="hb-name">${em} ${h2esc(th.name)}</b><div class="tl-hint">Ce mois-ci : couleur de pseudo et cadre <b>${h2esc(th.name)}</b> exclusifs en boutique (disponibles seulement ce mois-ci) • +25 % de pièces sur les parties ${h2esc(th.name)}.</div>
                  <div class="hb-btns"><button class="go" onclick="switchTab('collection');ecoTab('shop')">🛒 Voir les cosmétiques</button><button onclick="createRoom('arcade','pixel:${th.u}')">🖼️ Pixel ${h2esc(th.name)}</button><button onclick="openUniverseSelection('chaine')">⛓️ Chaîne</button></div></div></div>`;
            const first = box.querySelector('.hub-card');
            const tmp = document.createElement('div'); tmp.innerHTML = html;
            [...tmp.children].forEach(c => box.insertBefore(c, first || null));
        }
        (function () { const orig = hubRenderHome; hubRenderHome = function () { const r = orig.apply(this, arguments); h2RenderExtra(); return r; }; })();
        socket.on('connect', () => setTimeout(h2LoadExtra, 1300));
        socket.on('rush_start', d => { toast(`⚡ <b>Heure de pointe !</b> Dégâts x2 sur le boss jusqu’à ${d.until} h`, '#ffb300'); h2LoadExtra(); });
        setInterval(() => { if (!document.hidden) h2LoadExtra(); }, 5 * 60000);
