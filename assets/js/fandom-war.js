/* ---------- Guerre des fandoms : deux animes s'affrontent chaque semaine ---------- */
        const fw = { war: null, skew: 0 };
        async function fwLoad() {
            const d = await v7get('/api/fandom-war');
            if (!d || !d.ok || !d.war) return;
            fw.war = d.war; fw.skew = d.war.now - Date.now();
            fwRender();
        }
        function fwRender() {
            const box = document.getElementById('hub-home'), w = fw.war;
            if (!box || !w) return;
            box.querySelectorAll('.fw-card').forEach(e => e.remove());
            const tot = w.a.pts + w.b.pts, pa = tot ? Math.round(100 * w.a.pts / tot) : 50;
            const me = w.mine, acc = isAccount();
            const side = s => { const x = w[s], mine = me && me.side === s;
                return `<div class="fw-side fw-${s}${mine ? ' mine' : ''}"><img src="${hubEsc(x.img)}" alt="" onerror="this.style.opacity=.2"><b>${hubEsc(x.name)}</b><small>${x.members} joueur${x.members > 1 ? 's' : ''}</small>
                ${!me && acc ? `<button class="go" onclick="fwJoin('${s}')">Rejoindre</button>` : mine ? '<span class="fw-tag">Ton camp</span>' : ''}</div>`; };
            let foot;
            if (me) foot = `Tu as rapporté <b>${me.pts}</b> points à ${hubEsc(w[me.side].name)}. Joue sur ${hubEsc(w[me.side].name)} pour marquer <b>x2</b> !`;
            else if (acc) foot = 'Choisis ton camp (définitif pour la semaine) : chaque partie jouée rapporte ensuite des points à ton camp.';
            else foot = 'Crée un compte pour choisir ton camp.';
            const last = w.last ? `<div class="tl-hint">Semaine dernière : ${hubEsc(w.last.a.name)} ${w.last.a.pts} – ${w.last.b.pts} ${hubEsc(w.last.b.name)} • ${w.last.win.length > 1 ? 'égalité !' : '🏆 ' + hubEsc(w.last[w.last.win[0]].name)}</div>` : '';
            const html = `<div class="hub-card fw-card"><div class="hb-main">
                <div class="hb-h">⚔️ Guerre des fandoms <small>fin dans <b data-hub-left="${w.endsAt}">${hubFmtLeft(w.endsAt - (Date.now() + fw.skew))}</b></small></div>
                <div class="fw-vs">${side('a')}<div class="fw-x">VS</div>${side('b')}</div>
                <div class="fw-bar"><i style="width:${pa}%"></i><span class="l">${w.a.pts}</span><span class="r">${w.b.pts}</span></div>
                <div class="tl-hint">${foot}</div>
                <div class="tl-hint">🎴 Camp gagnant : carte Collector exclusive (${hubEsc(w.a.card)} ou ${hubEsc(w.b.card)}) + ${w.winCoins} 🪙 • camp perdant : ${w.loseCoins} 🪙 si tu as joué.</div>
                ${me ? `<div class="hb-btns"><button onclick="createRoom('arcade','pixel:${w[me.side].u}')">🖼️ Pixel ${hubEsc(w[me.side].name)}</button><button onclick="createRoom('arcade','silhouette:${w[me.side].u}')">👤 Silhouette</button><button onclick="createRoom('arcade','zoom:${w[me.side].u}')">🔍 Zoom</button></div>` : ''}
                ${last}</div></div>`;
            const tmp = document.createElement('div'); tmp.innerHTML = html;
            const after = box.querySelector('.hub-card.week');
            box.insertBefore(tmp.firstElementChild, after ? after.nextSibling : null);
        }
        async function fwJoin(s) {
            const w = fw.war; if (!w) return;
            if (!confirm(`Rejoindre le camp ${w[s].name} pour toute la semaine ?`)) return;
            const d = await v7post('/api/fandom-war/join', { side: s });
            if (!d || !d.ok) return toast('❌ ' + hubEsc((d && d.error) || 'Impossible'), 'var(--accent-pink)');
            fw.war = d.war; fwRender();
            toast(`⚔️ Tu as rejoint le camp <b>${hubEsc(w[s].name)}</b> !`, '#ff5a2a');
        }
        (function () { const orig = hubRenderHome; hubRenderHome = function () { const r = orig.apply(this, arguments); fwRender(); return r; }; })();
        (function () { const orig = collectorCard; collectorCard = function (c) { return orig(String(c.week || '').startsWith('guerre-') ? { ...c, week: '⚔️ Guerre des fandoms' } : c); }; })();
        socket.on('connect', () => setTimeout(fwLoad, 1500));
        setInterval(() => { if (!document.hidden && document.getElementById('menu-selection')?.style.display !== 'none') fwLoad(); }, 2 * 60000);
        socket.on('fw_score', d => { if (fw.war && fw.war.week === d.week) { fw.war.a.pts = d.a; fw.war.b.pts = d.b; fwRender(); } });
        socket.on('fw_gain', d => { toast(`⚔️ +${d.pts} points pour ${hubEsc(d.side)}${d.bonus ? ' (x2 anime de ton camp !)' : ''}`, '#ff5a2a'); if (fw.war && fw.war.mine) { fw.war.mine.pts += d.pts; fwRender(); } });
        socket.on('fw_win', d => { hubModal('collector-modal', `<h3>⚔️ Ton camp a gagné la Guerre des fandoms !</h3><div class="card-grid booster" style="justify-content:center;"><div class="flip">${collectorCard(d)}</div></div><p class="tl-hint">Carte Collector exclusive de ${hubEsc(d.name)} (${hubEsc(d.anime)}) + ${d.coins} 🪙. Elle est dans ton album.</p>`); confetti(2500); });
