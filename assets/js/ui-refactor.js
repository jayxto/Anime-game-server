/* =====================================================================
   UI REFACTOR V2 — amélioration progressive, sans changer les mécaniques.
   ===================================================================== */
(() => {
    const norm = s => String(s || '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase().replace(/\s+/g, ' ').trim();

    function findGameGrid() {
        return [...document.querySelectorAll('#menu-selection > div')]
            .find(d => d.classList.contains('mode-grid-2') || (d.querySelector('.arc-menu') && d.children.length > 5));
    }

    function gameText(el) {
        return norm(el?.textContent || '');
    }

    function markCards(grid) {
        [...grid.children].forEach(el => {
            if (el.classList.contains('arc-menu') || el.classList.contains('mc-stream-info')) return;
            el.classList.add('game-mode-card');
        });
    }

    function setupMiniGames(grid) {
        const arc = grid.querySelector(':scope > .arc-menu');
        if (!arc || arc.dataset.refactor === '1') return;
        arc.dataset.refactor = '1';
        arc.classList.add('arc-compact');

        const title = arc.querySelector(':scope > h3');
        const desc = title?.nextElementSibling?.tagName === 'P' ? title.nextElementSibling : null;
        if (title) {
            const head = document.createElement('div');
            head.className = 'arc-menu-refactor-head';
            const left = document.createElement('div');
            title.parentNode.insertBefore(head, title);
            head.appendChild(left);
            left.appendChild(title);
            if (desc) left.appendChild(desc);
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'arc-menu-refactor-toggle';
            const refresh = () => {
                const compact = arc.classList.contains('arc-compact');
                const count = arc.querySelectorAll('.arc-game-btn:not(.mc-hidden)').length;
                btn.textContent = compact ? `Voir tous (${count}) ▾` : 'Réduire ▴';
                btn.setAttribute('aria-expanded', compact ? 'false' : 'true');
            };
            btn.onclick = () => {
                arc.classList.toggle('arc-compact');
                try { localStorage.setItem('arcMiniExpanded', arc.classList.contains('arc-compact') ? '0' : '1'); } catch (_) {}
                refresh();
            };
            head.appendChild(btn);
            try { if (localStorage.getItem('arcMiniExpanded') === '1') arc.classList.remove('arc-compact'); } catch (_) {}
            refresh();
            new MutationObserver(refresh).observe(arc.querySelector('.arc-menu-grid') || arc, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
        }
    }

    function setupJoinCard(menu) {
        const direct = [...menu.children].find(el => el.querySelector?.('#join-code-input'));
        if (direct) direct.classList.add('ui-join-card');
    }

    function setupSearch(menu, grid) {
        if (document.getElementById('mode-library-search')) return;
        const cats = document.getElementById('mode-cats');
        const tools = document.createElement('div');
        tools.className = 'mode-library-tools';
        tools.innerHTML = `<label class="mode-library-search"><span>🔎</span><input id="mode-library-search" type="search" autocomplete="off" placeholder="Chercher un jeu…"><button type="button" class="host-btn" id="mode-library-clear" style="display:none;padding:3px 8px;">✕</button></label><span class="mode-library-count" id="mode-library-count"></span>`;
        (cats || grid).parentNode.insertBefore(tools, cats || grid);

        const input = tools.querySelector('input');
        const clear = tools.querySelector('#mode-library-clear');
        const count = tools.querySelector('#mode-library-count');

        const apply = () => {
            const q = norm(input.value);
            let shown = 0;
            [...grid.children].forEach(el => {
                if (el.classList.contains('mc-stream-info')) return;
                if (el.classList.contains('arc-menu')) {
                    let miniShown = 0;
                    el.querySelectorAll('.arc-game-btn').forEach(btn => {
                        const yes = !q || gameText(btn).includes(q);
                        btn.classList.toggle('mode-search-hidden', !yes);
                        if (yes && !btn.classList.contains('mc-hidden')) miniShown++;
                    });
                    const yes = !q || gameText(el.querySelector(':scope > .arc-menu-refactor-head') || el).includes(q) || miniShown > 0;
                    el.classList.toggle('mode-search-hidden', !yes);
                    if (yes) shown++;
                    return;
                }
                const yes = !q || gameText(el).includes(q);
                el.classList.toggle('mode-search-hidden', !yes);
                if (yes && !el.classList.contains('mc-hidden')) shown++;
            });
            clear.style.display = q ? '' : 'none';
            count.textContent = q ? `${shown} résultat${shown > 1 ? 's' : ''}` : '';
        };
        input.addEventListener('input', apply);
        clear.onclick = () => { input.value = ''; apply(); input.focus(); };
        window.addEventListener('mode-category-changed', apply);
        new MutationObserver(apply).observe(grid, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
        apply();
    }

    /* Catégories robustes : on reprend le contrôle du filtre historique afin
       qu'il fonctionne aussi avec les modes ajoutés dynamiquement après le chargement. */
    function setupModeCategories(grid) {
        let bar = document.getElementById('mode-cats');
        if (!bar) {
            bar = document.createElement('div');
            bar.id = 'mode-cats';
            bar.className = 'mode-cats';
            grid.parentNode.insertBefore(bar, grid);
        }

        const CATS = [
            ['all', '⭐ Tout'],
            ['stream', '🎥 Avec le chat'],
            ['bluff', '🕵️ Bluff & Undercover'],
            ['quiz', '🧠 Quiz & mini-jeux'],
            ['musique', '🎵 Musique'],
            ['fun', '🎨 Dessin & fun'],
            ['strat', '💰 Stratégie & tournois']
        ];
        const VALID = new Set(CATS.map(x => x[0]));
        const STREAM_ARC = new Set(['attaque','emoji','quatre','mapguess','scene','link','imposteur','audio','plusmoins','survie','chaos']);
        let current = 'all';
        try { current = localStorage.getItem('modeCat') || 'all'; } catch (_) {}
        if (!VALID.has(current)) current = 'all';

        const directCards = () => [...grid.children].filter(c => !c.classList.contains('mc-stream-info'));
        const titleOf = c => norm(c.querySelector('h3')?.textContent || c.textContent || '');

        function categoriesFor(card) {
            if (card.classList.contains('arc-menu')) return ['quiz','stream'];
            const t = titleOf(card);
            const cats = new Set();
            const add = (...xs) => xs.forEach(x => cats.add(x));

            if (/undercover/.test(t)) add('bluff');
            if (/loup.?garou/.test(t)) add('bluff');
            if (/devine le perso/.test(t)) add('bluff','quiz');
            if (/devine la note|citation|chaine de persos|quiz des joueurs|animedle|rolland garos|roland garros/.test(t)) add('quiz');
            if (/blind test|battle d.openings/.test(t)) add('musique','stream');
            if (/tu preferes|qui a le plus|dessine le perso|tier list|jeu de connexion|party mix/.test(t)) add('fun');
            if (/bingo anime/.test(t)) add('quiz','fun');
            if (/combat de cartes|tournoi|enchere/.test(t)) add('strat');
            if (/mini.jeux/.test(t)) add('quiz','stream');

            // Un mode non classé reste accessible dans Quiz plutôt que de disparaître.
            if (!cats.size) add('quiz');
            return [...cats];
        }

        function refreshMeta() {
            directCards().forEach(card => {
                card.dataset.cat = categoriesFor(card).join(' ');
            });
            grid.querySelectorAll('.arc-game-btn').forEach(btn => {
                const raw = btn.getAttribute('onclick') || '';
                const m = raw.match(/openArcadeGame\(['\"]([^'\"]+)['\"]\)/);
                if (m) btn.dataset.stream = STREAM_ARC.has(m[1]) ? '1' : '0';
                else if (!btn.dataset.stream) btn.dataset.stream = '0';
            });
        }

        function count(cat) {
            if (cat === 'all') return directCards().length;
            return directCards().filter(c => (c.dataset.cat || '').split(/\s+/).includes(cat)).length;
        }

        function rebuildButtons() {
            bar.innerHTML = CATS.map(([id,label]) =>
                `<button type="button" data-mode-cat="${id}" class="${id === current ? 'on' : ''}${id === 'stream' ? ' stream' : ''}">${label}${id !== 'all' ? `<b>${count(id)}</b>` : ''}</button>`
            ).join('');
        }

        function apply(cat, doScroll = true) {
            if (!VALID.has(cat)) cat = 'all';
            current = cat;
            refreshMeta();
            try { localStorage.setItem('modeCat', cat); } catch (_) {}

            directCards().forEach(card => {
                const cats = (card.dataset.cat || '').split(/\s+/);
                card.classList.toggle('mc-hidden', cat !== 'all' && !cats.includes(cat));
            });

            const info = grid.querySelector(':scope > .mc-stream-info');
            if (info) info.classList.toggle('mc-hidden', cat !== 'stream');

            grid.querySelectorAll('.arc-game-btn').forEach(btn => {
                btn.classList.toggle('mc-hidden', cat === 'stream' && btn.dataset.stream !== '1');
            });

            const arc = grid.querySelector(':scope > .arc-menu');
            if (arc) {
                arc.classList.toggle('arc-stream-view', cat === 'stream');
                const mh = arc.querySelector('h3');
                if (mh) {
                    mh.dataset.orig = mh.dataset.orig || mh.textContent;
                    mh.textContent = cat === 'stream' ? '🕹️ Mini-jeux jouables avec le chat' : mh.dataset.orig;
                }
            }

            bar.querySelectorAll('[data-mode-cat]').forEach(b => b.classList.toggle('on', b.dataset.modeCat === cat));
            window.dispatchEvent(new Event('mode-category-changed'));
            if (doScroll) bar.scrollIntoView({ block:'nearest', behavior:'smooth' });
        }

        function refreshAll() {
            refreshMeta();
            rebuildButtons();
            apply(current, false);
        }

        // Plus d'onclick inline fragile : une délégation unique fonctionne sur PC et mobile.
        if (bar.dataset.agCatsBound !== '1') {
            bar.dataset.agCatsBound = '1';
            const activateCat = e => {
                const btn = e.target.closest('[data-mode-cat]');
                if (!btn || !bar.contains(btn)) return;
                e.preventDefault(); e.stopPropagation();
                apply(btn.dataset.modeCat, true);
            };
            let lastTouch = 0;
            bar.addEventListener('touchend', e => {
                const btn = e.target.closest('[data-mode-cat]');
                if (!btn || !bar.contains(btn)) return;
                lastTouch = Date.now();
                e.preventDefault(); e.stopPropagation();
                apply(btn.dataset.modeCat, true);
            }, {passive:false});
            bar.addEventListener('click', e => {
                if (Date.now() - lastTouch < 700) { e.preventDefault(); e.stopPropagation(); return; }
                activateCat(e);
            }, {passive:false});
        }

        const controller = cat => apply(cat, true);
        controller.__refactorWrapped = true;
        window.modeCat = controller;
        refreshAll();

        // Les nouveaux modes / mini-jeux peuvent arriver après le chargement du menu.
        let refreshTimer = null;
        new MutationObserver(() => {
            clearTimeout(refreshTimer);
            refreshTimer = setTimeout(refreshAll, 20);
        }).observe(grid, { childList:true, subtree:true });
    }

    function init() {
        const menu = document.getElementById('menu-selection');
        if (!menu) return;
        menu.classList.add('mode-home-refactor');
        setupJoinCard(menu);

        const grid = findGameGrid();
        if (!grid) return setTimeout(init, 120);
        grid.classList.add('game-library-grid');
        markCards(grid);
        setupMiniGames(grid);
        setupModeCategories(grid);
        setupSearch(menu, grid);

        // Les nouveaux modes peuvent être injectés après le DOMContentLoaded.
        new MutationObserver(() => {
            markCards(grid);
            setupMiniGames(grid);
        }).observe(grid, { childList: true, subtree: true });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
})();

/* =====================================================================
   UI REFACTOR V4 — DASHBOARD RESPONSIVE
   Shell desktop + mobile. Toutes les fonctions métier existantes restent
   celles du site (switchTab, ecoTab, startDaily, createRoom, etc.).
   ===================================================================== */
(() => {
    const DASH_BP = 1181;
    const dashState = { section: 'home', shell: false, friendTimer: null };
    const q = (s, r = document) => r.querySelector(s);
    const qa = (s, r = document) => [...r.querySelectorAll(s)];
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

    function isDesktop() { return window.innerWidth >= DASH_BP; }
    function appVisible() {
        const app = q('#app-root');
        return !!app && getComputedStyle(app).display !== 'none';
    }
    function menuIsHome() {
        const active = q('#app-root > .tab-content.active');
        if (!active) return false;
        if (active.id !== 'mode') return true;
        const menu = q('#menu-selection');
        if (!menu) return false;
        // Le code historique masque le menu en inline quand un salon / jeu s'ouvre.
        // On teste d'abord cette valeur car le dashboard mobile utilise des !important
        // et ne doit jamais ressusciter visuellement un menu que le jeu vient de fermer.
        if (menu.style.display === 'none') return false;
        return getComputedStyle(menu).display !== 'none';
    }

    function buildShell() {
        const app = q('#app-root');
        if (!app || q('#ag-desktop-shell')) return;

        const shell = document.createElement('div');
        shell.id = 'ag-desktop-shell';
        shell.className = 'ag-desktop-shell';
        shell.innerHTML = `
            <div class="ag-dash-top">
                <button class="ag-dash-brand" type="button" data-dash-nav="home" aria-label="Accueil">
                    <span class="ag-dash-brand-mark">AG</span>
                    <span class="ag-dash-brand-copy"><b>ANIME GAME</b><small>アニメゲーム</small></span>
                </button>
                <label class="ag-dash-search" id="ag-dash-search-wrap">
                    <span>⌕</span>
                    <input id="ag-dash-search" type="search" autocomplete="off" placeholder="Rechercher un jeu…" aria-label="Rechercher un jeu">
                    <button id="ag-dash-search-clear" type="button" aria-label="Effacer">✕</button>
                </label>
                <div class="ag-dash-top-spacer"></div>
                <div class="ag-dash-account">
                    <button type="button" class="ag-dash-pill ag-dash-coins" data-dash-nav="collection" title="Collection"><span>🪙</span><b id="ag-dash-coins">0</b></button>
                    <button type="button" class="ag-dash-icon-btn" id="ag-dash-news" title="Nouveautés">🔔</button>
                    <button type="button" class="ag-dash-profile" data-dash-nav="settings">
                        <span class="ag-dash-avatar" id="ag-dash-avatar">AG</span>
                        <span class="ag-dash-profile-copy"><b id="ag-dash-name">Joueur</b><small id="ag-dash-rank">Anime Game</small></span>
                    </button>
                    <button type="button" class="ag-mobile-menu-toggle" id="ag-mobile-menu-toggle" aria-label="Ouvrir le menu" aria-expanded="false">☰</button>
                </div>
            </div>
            <aside class="ag-dash-sidebar">
                <nav class="ag-dash-nav" aria-label="Navigation principale">
                    <button class="ag-dash-nav-btn on" type="button" data-dash-nav="home"><span class="ico">⌂</span><span>Accueil</span></button>
                    <button class="ag-dash-nav-btn" type="button" data-dash-nav="play"><span class="ico">🎮</span><span>Jouer</span></button>
                    <button class="ag-dash-nav-btn" type="button" data-dash-nav="collection"><span class="ico">🃏</span><span>Collection</span></button>
                    <button class="ag-dash-nav-btn" type="button" data-dash-nav="shop"><span class="ico">🛒</span><span>Boutique</span></button>
                    <button class="ag-dash-nav-btn" type="button" data-dash-nav="deck"><span class="ico">▱</span><span>Decks</span></button>
                    <button class="ag-dash-nav-btn" type="button" data-dash-nav="trade"><span class="ico">⇄</span><span>Échanges</span></button>
                    <button class="ag-dash-nav-btn" type="button" data-dash-nav="clan"><span class="ico">🛡</span><span>Clans</span></button>
                    <button class="ag-dash-nav-btn" type="button" data-dash-nav="friends"><span class="ico">👥</span><span>Amis</span></button>
                    <div class="ag-dash-nav-sep"></div>
                    <button class="ag-dash-nav-btn" type="button" data-dash-nav="leaderboard"><span class="ico">🏆</span><span>Classements</span></button>
                    <button class="ag-dash-nav-btn" type="button" data-dash-nav="quests"><span class="ico">📜</span><span>Quêtes</span></button>
                    <button class="ag-dash-nav-btn" type="button" data-dash-nav="museum"><span class="ico">🏛</span><span>Musée</span></button>
                    <button class="ag-dash-nav-btn" type="button" data-dash-nav="settings"><span class="ico">⚙</span><span>Paramètres</span></button>
                    <button class="ag-dash-nav-btn ag-dash-role-btn" id="ag-dash-beta" type="button" data-dash-nav="beta" style="display:none"><span class="ico">🧪</span><span>Bêta</span></button>
                    <button class="ag-dash-nav-btn ag-dash-role-btn" id="ag-dash-admin" type="button" data-dash-nav="admin" style="display:none"><span class="ico">🛠</span><span>Admin</span></button>
                </nav>
                <button class="ag-dash-event" id="ag-dash-event" type="button">
                    <small>Événement en cours</small>
                    <b id="ag-dash-event-title">Défis & événements</b>
                    <span id="ag-dash-event-sub">Boss, anime de la semaine et tournois</span>
                </button>
            </aside>
            <button class="ag-mobile-backdrop" id="ag-mobile-backdrop" type="button" aria-label="Fermer le menu"></button>
            <nav class="ag-mobile-bottom" aria-label="Navigation mobile">
                <button class="ag-mobile-nav-btn on" type="button" data-dash-nav="home"><span>⌂</span><small>Accueil</small></button>
                <button class="ag-mobile-nav-btn" type="button" data-dash-nav="play"><span>🎮</span><small>Jouer</small></button>
                <button class="ag-mobile-nav-btn" type="button" data-dash-nav="collection"><span>🃏</span><small>Collection</small></button>
                <button class="ag-mobile-nav-btn" type="button" data-dash-nav="friends"><span>👥</span><small>Amis</small></button>
                <button class="ag-mobile-nav-btn" type="button" id="ag-mobile-more"><span>☰</span><small>Menu</small></button>
            </nav>`;
        app.appendChild(shell);

        const menu = q('#menu-selection');
        if (menu) buildHomeBlocks(menu);

        qa('[data-dash-nav]', shell).forEach(b => b.addEventListener('click', () => {
            navigate(b.dataset.dashNav);
            closeMobileMenu();
        }));
        q('#ag-mobile-menu-toggle', shell)?.addEventListener('click', toggleMobileMenu);
        q('#ag-mobile-more', shell)?.addEventListener('click', toggleMobileMenu);
        q('#ag-mobile-backdrop', shell)?.addEventListener('click', closeMobileMenu);
        q('#ag-dash-news', shell)?.addEventListener('click', () => {
            if (typeof openChangelog === 'function') openChangelog();
            else navigate('settings');
        });
        q('#ag-dash-event', shell)?.addEventListener('click', () => {
            navigate('home');
            setTimeout(() => q('#hub-home')?.scrollIntoView({ behavior:'smooth', block:'start' }), 80);
        });
        setupTopSearch();
        wrapSwitchTab();
        syncAll();
    }

    function mobileMenuOpen() { return document.body.classList.contains('ag-mobile-menu-open'); }

    function setMobileMenu(open) {
        const yes = !!open && !isDesktop();
        document.body.classList.toggle('ag-mobile-menu-open', yes);
        const btn = q('#ag-mobile-menu-toggle');
        if (btn) {
            btn.setAttribute('aria-expanded', yes ? 'true' : 'false');
            btn.textContent = yes ? '✕' : '☰';
        }
    }

    function toggleMobileMenu() { setMobileMenu(!mobileMenuOpen()); }
    function closeMobileMenu() { setMobileMenu(false); }

    function buildHomeBlocks(menu) {
        if (!q('#ag-home-hero')) {
            const hero = document.createElement('div');
            hero.id = 'ag-home-hero';
            hero.innerHTML = `
                <div class="ag-hero-copy">
                    <div class="ag-hero-kicker">Quiz • Jeux • Collection • Multijoueur</div>
                    <div class="ag-hero-title">ANIME GAME</div>
                    <p class="ag-hero-sub">Tous tes modes anime dans un seul hub, entre amis, en solo ou en live.</p>
                    <button type="button" class="btn-action ag-hero-btn" id="ag-hero-play">JOUER MAINTENANT →</button>
                </div>
                <div class="ag-hero-side" aria-hidden="true"><div class="ag-hero-orb">AG</div></div>`;
            menu.insertBefore(hero, menu.firstChild);
            q('#ag-hero-play', hero)?.addEventListener('click', () => navigate('play'));
        }

        if (!q('#ag-quick-actions')) {
            const quick = document.createElement('div');
            quick.id = 'ag-quick-actions';
            quick.innerHTML = `
                <button class="ag-quick-btn purple" type="button" data-quick="public"><span class="qi">⚡</span><span><b>Partie rapide</b><small>Trouver un salon public</small></span></button>
                <button class="ag-quick-btn blue" type="button" data-quick="create"><span class="qi">👥</span><span><b>Créer un salon</b><small>Choisir ton mode</small></span></button>
                <button class="ag-quick-btn green" type="button" data-quick="bots"><span class="qi">🤖</span><span><b>Jouer avec des bots</b><small>Outil bêta / admin</small></span></button>
                <button class="ag-quick-btn gold" type="button" data-quick="tournament"><span class="qi">🏆</span><span><b>Tournoi</b><small>Lancer le mode tournoi</small></span></button>`;
            const hero = q('#ag-home-hero');
            hero?.insertAdjacentElement('afterend', quick);
            q('[data-quick="public"]', quick)?.addEventListener('click', quickPublic);
            q('[data-quick="create"]', quick)?.addEventListener('click', () => navigate('play'));
            q('[data-quick="bots"]', quick)?.addEventListener('click', quickBots);
            q('[data-quick="tournament"]', quick)?.addEventListener('click', () => {
                if (typeof createRoom === 'function') createRoom('arcade','tournoi');
            });
        }

        if (!q('#ag-dashboard-right')) {
            const side = document.createElement('aside');
            side.id = 'ag-dashboard-right';
            side.innerHTML = `
                <div class="ag-right-card">
                    <div class="ag-right-head"><b>● En ligne <span id="ag-online-count"></span></b><button type="button" data-dash-nav="friends">Voir tous</button></div>
                    <div class="ag-friend-list" id="ag-dash-friends"><div class="ag-right-muted">Chargement…</div></div>
                </div>
                <div class="ag-right-card">
                    <div class="ag-right-head"><b>📜 Quêtes du jour</b><button type="button" data-dash-nav="quests">Voir</button></div>
                    <div id="ag-dash-quests"><div class="ag-right-muted">Chargement…</div></div>
                </div>
                <div class="ag-right-card">
                    <div class="ag-right-head"><b>🎯 Défis du jour</b><button type="button" id="ag-daily-board-btn">Classement</button></div>
                    <div class="ag-daily-mini"><button type="button" data-daily="dle">🎴<br>AnimeDLE</button><button type="button" data-daily="blindtest">🎧<br>Blind Test</button><button type="button" data-daily="pixel">🖼️<br>Pixel</button></div>
                </div>`;
            menu.appendChild(side);
            qa('[data-dash-nav]', side).forEach(b => b.addEventListener('click', () => navigate(b.dataset.dashNav)));
            qa('[data-daily]', side).forEach(b => b.addEventListener('click', () => {
                if (typeof startDaily === 'function') startDaily(b.dataset.daily);
            }));
            q('#ag-daily-board-btn', side)?.addEventListener('click', () => {
                navigate('home');
                setTimeout(() => {
                    if (typeof toggleDailyBoard === 'function') toggleDailyBoard();
                    q('#daily-card')?.scrollIntoView({ behavior:'smooth', block:'center' });
                }, 80);
            });
        }

        waitForLibraryHeading();
    }

    function waitForLibraryHeading() {
        if (q('#ag-games-heading')) return;
        const tryAdd = () => {
            const cats = q('#mode-cats');
            const grid = q('#menu-selection .game-library-grid, #menu-selection .mode-grid-2');
            if (!grid) return false;
            const h = document.createElement('div');
            h.id = 'ag-games-heading';
            h.innerHTML = `<h3>🎮 Tous les jeux</h3><span>Choisis un mode ou utilise les catégories</span>`;
            (cats || grid).parentNode.insertBefore(h, cats || grid);
            return true;
        };
        if (tryAdd()) return;
        let n = 0;
        const t = setInterval(() => { if (tryAdd() || ++n > 30) clearInterval(t); }, 100);
    }

    function setupTopSearch() {
        const input = q('#ag-dash-search');
        const wrap = q('#ag-dash-search-wrap');
        const clear = q('#ag-dash-search-clear');
        if (!input || !wrap || !clear) return;
        const apply = () => {
            wrap.classList.toggle('has-value', !!input.value.trim());
            if (!input.value.trim()) return syncSearch('');
            if (q('#app-root > #mode') && !q('#mode')?.classList.contains('active')) {
                if (typeof switchTab === 'function') switchTab('mode');
            }
            dashState.section = 'play';
            syncNav();
            if (typeof modeCat === 'function') try { modeCat('all'); } catch (_) {}
            syncSearch(input.value);
            setTimeout(() => q('#mode-cats, #ag-games-heading, .game-library-grid')?.scrollIntoView({ behavior:'smooth', block:'start' }), 50);
        };
        input.addEventListener('input', apply);
        input.addEventListener('keydown', e => { if (e.key === 'Escape') { input.value=''; apply(); input.blur(); } });
        clear.addEventListener('click', () => { input.value=''; apply(); input.focus(); });
    }

    function syncSearch(value) {
        const target = q('#mode-library-search');
        if (!target) return;
        if (target.value !== value) target.value = value;
        target.dispatchEvent(new Event('input', { bubbles:true }));
    }

    function quickPublic() {
        navigate('home');
        setTimeout(() => {
            const panel = q('#public-rooms-panel');
            if (panel && getComputedStyle(panel).display === 'none' && typeof togglePublicRooms === 'function') togglePublicRooms();
            q('.ui-join-card')?.scrollIntoView({ behavior:'smooth', block:'center' });
        }, 80);
    }

    function quickBots() {
        if (window.IS_ADMIN || window.IS_BETA) {
            if (typeof createRoom === 'function') createRoom('undercover','normal');
            return;
        }
        if (typeof toast === 'function') toast('🤖 Les bots sont réservés aux admins et bêta testeurs pour le moment.', '#00f0ff');
        else navigate('play');
    }

    function navigate(key) {
        closeMobileMenu();
        dashState.section = key;
        const later = (fn, ms = 70) => setTimeout(fn, ms);
        const tab = t => { if (typeof switchTab === 'function') switchTab(t); };
        const eco = t => { if (typeof ecoTab === 'function') ecoTab(t); };

        if (key === 'home') { tab('mode'); later(() => window.scrollTo({ top:0, behavior:'smooth' })); }
        else if (key === 'play') { tab('mode'); later(() => q('#ag-games-heading, #mode-cats, .game-library-grid')?.scrollIntoView({ behavior:'smooth', block:'start' })); }
        else if (key === 'collection') { tab('collection'); later(() => eco('album')); }
        else if (key === 'shop') { tab('collection'); later(() => eco('shop')); }
        else if (key === 'deck') { tab('collection'); later(() => eco('deck')); }
        else if (key === 'trade') { tab('collection'); later(() => eco('trade')); }
        else if (key === 'clan') { tab('collection'); later(() => eco('clan')); }
        else if (key === 'museum') { tab('collection'); later(() => eco('museum')); }
        else if (key === 'friends') { tab('amis'); later(() => { if (typeof loadFriends === 'function') loadFriends(); }); }
        else if (key === 'leaderboard') { tab('options'); later(() => scrollOption('Classements par jeu')); }
        else if (key === 'quests') { tab('mode'); later(() => q('#ag-dashboard-right')?.scrollIntoView({ behavior:'smooth', block:'start' })); }
        else if (key === 'settings') { tab('options'); later(() => window.scrollTo({ top:0, behavior:'smooth' })); }
        else if (key === 'beta') {
            tab('beta');
            later(() => { if (typeof betaLoad === 'function') betaLoad(); window.scrollTo({ top:0, behavior:'smooth' }); });
        }
        else if (key === 'admin') {
            tab('admin');
            later(() => { if (typeof loadAdmin === 'function') loadAdmin(); window.scrollTo({ top:0, behavior:'smooth' }); });
        }
        syncNav();
    }

    function scrollOption(title) {
        const h = qa('#options h2').find(x => x.textContent.includes(title));
        h?.closest('.opt-panel,div')?.scrollIntoView({ behavior:'smooth', block:'start' });
    }

    function wrapSwitchTab() {
        if (typeof window.switchTab !== 'function' || window.switchTab.__agDashWrapped) return;
        const old = window.switchTab;
        const wrapped = function(t) {
            const r = old.apply(this, arguments);
            if (t === 'mode' && !['play','quests','home'].includes(dashState.section)) dashState.section = 'home';
            if (t === 'amis') dashState.section = 'friends';
            if (t === 'options' && !['leaderboard','settings'].includes(dashState.section)) dashState.section = 'settings';
            if (t === 'beta') dashState.section = 'beta';
            if (t === 'admin') dashState.section = 'admin';
            if (t === 'collection' && !['collection','shop','deck','trade','clan','museum'].includes(dashState.section)) dashState.section = 'collection';
            setTimeout(syncAll, 0);
            return r;
        };
        wrapped.__agDashWrapped = true;
        window.switchTab = wrapped;
    }

    function syncShell() {
        const app = q('#app-root');
        if (!app) return;
        const on = appVisible() && menuIsHome();
        const mobile = on && !isDesktop();
        dashState.shell = on;
        app.classList.toggle('ag-dashboard-shell-on', on);
        app.classList.toggle('ag-dashboard-mobile-on', mobile);
        document.body.classList.toggle('ag-dashboard-on', on);
        document.body.classList.toggle('ag-dashboard-mobile', mobile);
        if (!mobile) closeMobileMenu();
    }

    function syncNav() {
        let key = dashState.section;
        const active = q('#app-root > .tab-content.active')?.id;
        if (active === 'amis') key = 'friends';
        else if (active === 'beta') key = 'beta';
        else if (active === 'admin') key = 'admin';
        else if (active === 'options' && !['leaderboard','settings'].includes(key)) key = 'settings';
        else if (active === 'collection') {
            const t = q('#collection .eco-tabs button.on')?.dataset.t;
            const map = { shop:'shop', album:'collection', deck:'deck', trade:'trade', clan:'clan', museum:'museum' };
            key = map[t] || key || 'collection';
        } else if (active === 'mode' && !['home','play','quests'].includes(key)) key = 'home';
        qa('.ag-dash-nav-btn').forEach(b => b.classList.toggle('on', b.dataset.dashNav === key));
        qa('.ag-mobile-nav-btn[data-dash-nav]').forEach(b => b.classList.toggle('on', b.dataset.dashNav === key));
        const more = q('#ag-mobile-more');
        if (more) more.classList.toggle('on', !['home','play','collection','friends'].includes(key));
    }

    function syncRoleNav() {
        const adminBtn = q('#ag-dash-admin');
        const betaBtn = q('#ag-dash-beta');
        if (!adminBtn || !betaBtn) return;

        // On reprend exactement les droits déjà calculés par checkAdmin() dans core.js.
        // Fallback sur les anciens boutons de navigation pour éviter un flash si la
        // vérification serveur vient juste de se terminer.
        const oldAdmin = q('#btn-admin')?.parentElement;
        const oldBeta = q('#btn-beta')?.parentElement;
        const adminVisibleLegacy = !!oldAdmin && getComputedStyle(oldAdmin).display !== 'none';
        const betaVisibleLegacy = !!oldBeta && getComputedStyle(oldBeta).display !== 'none';
        const isAdmin = window.IS_ADMIN === true || adminVisibleLegacy;
        const isBeta = !isAdmin && (window.IS_BETA === true || betaVisibleLegacy);

        adminBtn.style.display = isAdmin ? '' : 'none';
        betaBtn.style.display = isBeta ? '' : 'none';

        // Si un rôle vient d'être retiré pendant qu'on est sur son onglet,
        // on renvoie proprement vers les paramètres.
        if (dashState.section === 'admin' && !isAdmin) {
            dashState.section = 'settings';
            if (q('#app-root > .tab-content.active')?.id === 'admin' && typeof switchTab === 'function') switchTab('options');
        }
        if (dashState.section === 'beta' && !isBeta) {
            dashState.section = 'settings';
            if (q('#app-root > .tab-content.active')?.id === 'beta' && typeof switchTab === 'function') switchTab('options');
        }
    }

    function syncProfile() {
        const name = (typeof currentUser !== 'undefined' && currentUser && currentUser.pseudo) || q('#profile-pseudo')?.textContent?.trim() || 'Joueur';
        const rank = q('#profile-rank')?.textContent?.trim();
        const nameEl = q('#ag-dash-name'); if (nameEl) nameEl.textContent = name || 'Joueur';
        const rankEl = q('#ag-dash-rank'); if (rankEl) rankEl.textContent = rank && rank !== '---' ? rank : ((typeof currentUser !== 'undefined' && currentUser?.isGuest) ? 'Invité' : 'Anime Game');
        const av = q('#ag-dash-avatar');
        if (av) {
            try {
                av.innerHTML = typeof avatarHtml === 'function' ? avatarHtml(name, (typeof currentUser !== 'undefined' && currentUser?.cos) || null) : esc(name.charAt(0).toUpperCase());
            } catch (_) { av.textContent = name.charAt(0).toUpperCase(); }
        }
        const coin = q('#coin-badge b')?.textContent?.trim();
        const out = q('#ag-dash-coins'); if (out && coin) out.textContent = coin;
    }

    function syncQuests() {
        const src = q('#quest-list');
        const dst = q('#ag-dash-quests');
        if (!src || !dst) return;
        if (dst.dataset.html !== src.innerHTML) {
            dst.dataset.html = src.innerHTML;
            dst.innerHTML = src.innerHTML || '<div class="ag-right-muted">Aucune quête chargée.</div>';
        }
    }

    function syncEvent() {
        const title = q('#ag-dash-event-title');
        const sub = q('#ag-dash-event-sub');
        if (!title || !sub) return;
        try {
            if (typeof hub !== 'undefined' && hub.home?.weekAnime) {
                title.textContent = `⭐ ${hub.home.weekAnime.name}`;
                sub.textContent = 'Anime de la semaine • bonus de collection';
                return;
            }
        } catch (_) {}
        const week = q('#hub-home .hub-card.week .hb-name')?.textContent?.trim();
        if (week) { title.textContent = `⭐ ${week}`; sub.textContent = 'Anime de la semaine • bonus de collection'; }
    }

    async function loadDashFriends() {
        const box = q('#ag-dash-friends');
        const count = q('#ag-online-count');
        if (!box || !dashState.shell) return;
        let account = false;
        try { account = typeof isAccount === 'function' ? isAccount() : false; } catch (_) {}
        if (!account) {
            if (count) count.textContent = '(0)';
            box.innerHTML = `<div class="ag-right-muted">Connecte-toi avec un compte pour voir tes amis en ligne.</div><button class="ag-empty-action" type="button" data-open-friends>Ouvrir l'onglet Amis</button>`;
            q('[data-open-friends]', box)?.addEventListener('click', () => navigate('friends'));
            return;
        }
        let d = null;
        try { if (typeof v7get === 'function') d = await v7get('/api/friends'); } catch (_) {}
        if (!d || !d.ok) { box.innerHTML = '<div class="ag-right-muted">Amis indisponibles pour le moment.</div>'; return; }
        const online = (d.friends || []).filter(f => f.online);
        if (count) count.textContent = `(${online.length})`;
        if (!online.length) {
            box.innerHTML = `<div class="ag-right-muted">Aucun ami en ligne pour le moment.</div><button class="ag-empty-action" type="button" data-open-friends>Voir mes amis</button>`;
            q('[data-open-friends]', box)?.addEventListener('click', () => navigate('friends'));
            return;
        }
        box.innerHTML = online.slice(0,7).map(f => {
            let av = `<span class="av">${esc(String(f.pseudo || '?').charAt(0).toUpperCase())}</span>`;
            try { if (typeof avatarHtml === 'function') av = avatarHtml(f.pseudo, f.cos); } catch (_) {}
            const state = f.room ? `${f.room.waiting ? 'Salon' : 'En partie'}${f.room.mode ? ' • ' + esc(f.room.mode) : ''}` : `Niveau ${Number(f.level || 1)}`;
            return `<div class="ag-friend-row" data-friend="${esc(f.pseudo)}">${av}<span class="ag-friend-copy"><b>${esc(f.pseudo)}</b><small>${state}</small></span><span class="ag-online-dot"></span></div>`;
        }).join('');
        qa('.ag-friend-row', box).forEach(r => r.addEventListener('click', () => navigate('friends')));
    }

    function syncAll() {
        syncShell();
        syncRoleNav();
        syncNav();
        syncProfile();
        syncQuests();
        syncEvent();
    }

    // PC + MOBILE : salon / sélection / partie = vraie page dédiée.
    // Sur iPhone, un simple scrollTo(0,0) peut être ignoré pendant un changement
    // de layout : on détecte donc la page de jeu, on masque le shell et on recale
    // plusieurs fois le panneau actif en haut.
    const GAME_PAGE_IDS = [
        'waiting-room','gameplay-room','rg-room','enchere-room','enchereaveugle-room',
        'connexion-room','dle-room','quote-room','blindtest-room','arcade-room',
        'draw-room','guess-room','chaine-room','lg-room','uq-room',
        'quote-universe-selection','theme-selection-container'
    ];

    function visibleGamePanel() {
        for (const id of GAME_PAGE_IDS) {
            const el = q('#' + id);
            if (!el) continue;
            const cs = getComputedStyle(el);
            if (cs.display !== 'none' && cs.visibility !== 'hidden') return el;
        }
        return null;
    }

    function forceGamePageTop() {
        const panel = visibleGamePanel();
        try { window.scrollTo({ top:0, left:0, behavior:'auto' }); } catch (_) { window.scrollTo(0,0); }
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
        if (panel) {
            try { panel.scrollIntoView({ block:'start', inline:'nearest', behavior:'auto' }); } catch (_) {}
        }
    }

    function setupGamePageTransition() {
        const menu = q('#menu-selection');
        const app = q('#app-root');
        if (!menu || !app || menu.dataset.agGamePageWatch === '1') return;
        menu.dataset.agGamePageWatch = '1';

        let wasGamePage = false;
        const refresh = () => {
            const inlineHidden = menu.style.display === 'none';
            const panel = visibleGamePanel();
            const gamePage = inlineHidden || !!panel;

            document.body.classList.toggle('ag-game-page', gamePage);
            app.classList.toggle('ag-game-page', gamePage);
            if (gamePage) closeMobileMenu();

            // syncShell() lit d'abord l'état inline du menu et retire le dashboard.
            syncAll();

            if (gamePage && !wasGamePage) {
                forceGamePageTop();
                requestAnimationFrame(forceGamePageTop);
                setTimeout(forceGamePageTop, 40);
                setTimeout(forceGamePageTop, 140);
                setTimeout(forceGamePageTop, 320);
            }
            wasGamePage = gamePage;
        };

        const observer = new MutationObserver(refresh);
        observer.observe(menu, { attributes:true, attributeFilter:['style','class'] });
        GAME_PAGE_IDS.forEach(id => {
            const el = q('#' + id);
            if (el) observer.observe(el, { attributes:true, attributeFilter:['style','class'] });
        });
        refresh();
    }

    function init() {
        buildShell();
        setupGamePageTransition();
        syncAll();
        window.addEventListener('resize', syncAll, { passive:true });
        document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMobileMenu(); });
        setInterval(syncAll, 900);
        dashState.friendTimer = setInterval(loadDashFriends, 30000);
        setTimeout(loadDashFriends, 600);
        try {
            q('#quest-list') && new MutationObserver(syncQuests).observe(q('#quest-list'), { childList:true, subtree:true, characterData:true });
            q('#coin-badge') && new MutationObserver(syncProfile).observe(q('#coin-badge'), { childList:true, subtree:true, characterData:true, attributes:true });
            q('#hub-home') && new MutationObserver(syncEvent).observe(q('#hub-home'), { childList:true, subtree:true });
        } catch (_) {}
        if (typeof socket !== 'undefined' && socket?.on) {
            socket.on('friends_changed', () => setTimeout(loadDashFriends, 150));
            socket.on('connect', () => setTimeout(loadDashFriends, 900));
        }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once:true });
    else init();

    // iOS/Safari : intercepter le toucher avant les overlays du dashboard/audio.
    // Cela rend les catégories Jouer fiables même quand une couche visuelle passe au-dessus.
    const mobileCategoryTap = e => {
        const btn = e.target && e.target.closest ? e.target.closest('#mode-cats [data-mode-cat], #mode-cats button') : null;
        if (!btn) return;
        let cat = btn.dataset.modeCat || '';
        if (!cat) { const m = (btn.getAttribute('onclick') || '').match(/modeCat\(['\"]([^'\"]+)/); cat = m ? m[1] : ''; }
        if (!cat || typeof window.modeCat !== 'function') return;
        e.preventDefault(); e.stopPropagation();
        window.modeCat(cat);
    };
    document.addEventListener('touchstart', mobileCategoryTap, {capture:true,passive:false});
})();
