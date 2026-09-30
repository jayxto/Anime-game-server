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

    function patchModeCategoryEvent() {
        if (typeof window.modeCat !== 'function' || window.modeCat.__refactorWrapped) return;
        const old = window.modeCat;
        const wrapped = function () {
            const r = old.apply(this, arguments);
            window.dispatchEvent(new Event('mode-category-changed'));
            const arc = document.querySelector('#menu-selection .arc-menu');
            if (arc) arc.classList.toggle('arc-stream-view', arguments[0] === 'stream');
            return r;
        };
        wrapped.__refactorWrapped = true;
        window.modeCat = wrapped;
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
        patchModeCategoryEvent();
        setupSearch(menu, grid);

        // Les nouveaux modes peuvent être injectés après le DOMContentLoaded.
        new MutationObserver(() => {
            markCards(grid);
            setupMiniGames(grid);
            patchModeCategoryEvent();
        }).observe(grid, { childList: true, subtree: true });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
})();
