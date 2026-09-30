/* ---------- Page Jouer rangée par catégories ---------- */
        (function () {
            const grid = [...document.querySelectorAll('#menu-selection div')].find(d => d.style && d.style.gridTemplateColumns === '1fr' && d.querySelector('.arc-menu'));
            if (!grid || grid.dataset.cats) return;
            grid.dataset.cats = '1'; grid.classList.add('mode-grid-2');
            // catégories de chaque carte (une carte peut être dans plusieurs)
            const RULES = [
                [/undercover/i, ['bluff']], [/loup-garou/i, ['bluff', 'grand']], [/devine le perso/i, ['bluff']],
                [/devine la note/i, ['quiz']], [/citation/i, ['quiz']], [/blind test/i, ['musique', 'stream']], [/battle d'openings/i, ['musique', 'stream']], [/tu préfères/i, ['fun', 'stream']], [/qui a le plus/i, ['fun', 'stream']],
                [/mini-jeux/i, ['quiz', 'stream']], [/chaîne de persos/i, ['quiz']], [/quiz des joueurs/i, ['quiz']], [/animedle/i, ['quiz']], [/rolland garos/i, ['quiz']],
                [/dessine le perso/i, ['fun', 'stream']], [/tier list/i, ['fun']], [/jeu de connexion/i, ['fun']],
                [/tournoi/i, ['strat', 'grand']], [/enchère/i, ['strat']]
            ];
            const CATS = [['all', '⭐ Tout'], ['stream', '🎥 Avec le chat'], ['bluff', '🕵️ Bluff & Undercover'], ['quiz', '🧠 Quiz & mini-jeux'], ['musique', '🎵 Musique'], ['fun', '🎨 Dessin & fun'], ['strat', '💰 Stratégie & tournois']];
            const STREAM_ARC = ['attaque', 'emoji', 'quatre', 'mapguess', 'scene', 'link', 'imposteur', 'audio', 'plusmoins', 'survie', 'chaos'];
            const cards = [...grid.children];
            cards.forEach(c => {
                const t = (c.querySelector('h3') || {}).textContent || '';
                const r = RULES.find(([re]) => re.test(t));
                c.dataset.cat = (r ? r[1] : ['quiz']).join(' ');
                if (/blind test|battle d'openings|dessine le perso|tu préfères|qui a le plus/i.test(t)) { const h = c.querySelector('h3'); if (h && !h.querySelector('.mc-tag')) h.insertAdjacentHTML('beforeend', '<span class="mc-tag">🎥 CHAT</span>'); }
            });
            // tuiles mini-jeux jouables avec le chat
            grid.querySelectorAll('.arc-game-btn').forEach(b => {
                const m = (b.getAttribute('onclick') || '').match(/openArcadeGame\('(\w+)'\)/);
                b.dataset.stream = m && STREAM_ARC.includes(m[1]) ? '1' : '0';
            });
            // encart d'aide streamer
            const info = document.createElement('div'); info.className = 'mc-stream-info'; info.dataset.cat = 'stream-only';
            info.innerHTML = `<h3>🎥 Jouer avec ton chat Twitch ou TikTok</h3><ol><li>Va dans <b>Options → Mode streamer</b>, choisis Twitch ou TikTok Live et tape ton pseudo.</li><li>Lance un des jeux ci-dessous : tes viewers répondent avec <b>1 2 3 4</b> dans le chat.</li><li>Clique sur <b>📺 Écran live</b> dans le widget pour une interface propre dans OBS.</li></ol><button class="btn-action" onclick="switchTab('options');setTimeout(()=>document.getElementById('stream-channel')?.scrollIntoView({behavior:'smooth',block:'center'}),150)">⚙️ Configurer le mode streamer</button>`;
            grid.insertBefore(info, grid.firstChild);
            const bar = document.createElement('div'); bar.className = 'mode-cats'; bar.id = 'mode-cats';
            grid.parentNode.insertBefore(bar, grid);
            const count = k => k === 'all' ? cards.length : cards.filter(c => c.dataset.cat.split(' ').includes(k)).length + (k === 'quiz' || k === 'stream' ? 0 : 0);
            function apply(k) {
                try { localStorage.setItem('modeCat', k); } catch (_) {}
                bar.innerHTML = CATS.map(([id, l]) => `<button class="${id === k ? 'on' : ''}${id === 'stream' ? ' stream' : ''}" onclick="modeCat('${id}')">${l}${id !== 'all' ? `<b>${count(id)}</b>` : ''}</button>`).join('');
                cards.forEach(c => c.classList.toggle('mc-hidden', k !== 'all' && !c.dataset.cat.split(' ').includes(k)));
                info.classList.toggle('mc-hidden', k !== 'stream');
                grid.querySelectorAll('.arc-game-btn').forEach(b => b.classList.toggle('mc-hidden', k === 'stream' && b.dataset.stream !== '1'));
                const mh = grid.querySelector('.arc-menu h3'); if (mh) mh.dataset.orig = mh.dataset.orig || mh.textContent;
                if (mh) mh.textContent = k === 'stream' ? '🕹️ Mini-jeux jouables avec le chat' : mh.dataset.orig;
            }
            window.modeCat = k => { apply(k); bar.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); };
            let start = 'all'; try { start = localStorage.getItem('modeCat') || 'all'; } catch (_) {}
            if (!CATS.some(c => c[0] === start)) start = 'all';
            apply(start);
        })();
