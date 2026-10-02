from pathlib import Path
import re

SERVER = Path('server.js')
UI = Path('assets/js/ui-refactor.js')

server = SERVER.read_text(encoding='utf-8')
ui = UI.read_text(encoding='utf-8')

SERVER_MARK = '// CHARACTER IMAGE ADMIN V4'
ROUTE_MARK = '// CHARACTER IMAGE ADMIN ROUTE V4'
UI_MARK = '/* Admin character viewer v4 */'
OLD_UI_MARK = '/* Admin character viewer v1 */'

# ---------------------------------------------------------------------------
# Server: manual admin image overrides live in Postgres and always win.
# ---------------------------------------------------------------------------
if SERVER_MARK not in server:
    rx = re.compile(
        r"(async\s+function\s+resolveCharacterImage\s*\(\s*universeKey\s*,\s*displayName\s*\)\s*\{\s*)"
        r"(const\s+fixed\s*=\s*staticCharImage\s*\(\s*universeKey\s*,\s*displayName\s*\)\s*;)"
    )
    m = rx.search(server)
    if not m:
        raise SystemExit('resolveCharacterImage() anchor not found')

    injected = (
        m.group(1)
        + "    // CHARACTER IMAGE ADMIN V4\n"
        + "    // A URL selected by an admin is stored in Postgres and must survive Render redeploys.\n"
        + "    // Manual values deliberately take priority over bundled/static image maps and auto-resolvers.\n"
        + "    const manualName = cleanImageCharacterName(displayName);\n"
        + "    const manual = await getCachedCharacterImage(universeKey, manualName);\n"
        + "    if (manual?.imageUrl && manual?.sourceUrl === 'manual-admin') return manual;\n\n"
        + m.group(2)
    )
    server = server[:m.start()] + injected + server[m.end():]

if ROUTE_MARK not in server:
    anchor = '/* ---------- API : citations ---------- */'
    if anchor not in server:
        raise SystemExit('citations API anchor not found')

    route = r'''
// CHARACTER IMAGE ADMIN ROUTE V4
// Admin-only editor. The chosen URL is persisted in the existing Postgres
// character_images cache so it is not lost when Render rebuilds the service.
app.post('/api/admin/character-image', adminOnly(async (req, res) => {
    const b = req.body || {};
    const universe = String(b.universe || '').trim();
    const name = cleanImageCharacterName(String(b.name || '').trim()).slice(0, 160);
    const imageUrl = String(b.imageUrl || b.img || '').trim().slice(0, 1800);

    if (!ARC_UNIVERSE_ANIME[universe]) {
        return res.status(400).json({ ok:false, error:'Anime invalide.' });
    }
    if (!name) {
        return res.status(400).json({ ok:false, error:'Personnage invalide.' });
    }
    if (!/^https:\/\/\S+$/i.test(imageUrl)) {
        return res.status(400).json({ ok:false, error:'Le lien doit commencer par https://' });
    }

    await saveCachedCharacterImage(universe, name, {
        imageUrl,
        sourceUrl:'manual-admin',
        status:'ok'
    });

    try {
        CHARACTER_IMAGE_RETRY_AT.delete(`${universe}|${normalizeImageKey(name)}`);
    } catch (_) {}

    return res.json({ ok:true, universe, name, imageUrl, sourceUrl:'manual-admin' });
}));

'''
    server = server.replace(anchor, route + anchor, 1)

# ---------------------------------------------------------------------------
# Client: replace the old catalogue viewer with the complete v4 admin.
# It uses the catalogue's `sources` array as the mode categorisation.
# ---------------------------------------------------------------------------
if UI_MARK not in ui:
    start = ui.find(OLD_UI_MARK)
    if start < 0:
        raise SystemExit('Admin character viewer v1 marker not found')

    block = r'''/* Admin character viewer v4 */
(() => {
    const PAGE = 80;
    const SCAN_WORKERS = 16;
    const state = {
        all: [], filtered: [], page: 0, status: new Map(), loaded: false,
        scanning: false, scanDone: 0, scanOk: 0, scanBad: 0
    };

    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
        '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[c]));
    const keyOf = x => String(x.u || x.universe || x.anime || '') + '|' + String(x.name || '');

    const MODE_LABELS = {
        undercover: 'Undercover', undercover_normal: 'Undercover normal', undercover_hardcore: 'Undercover hardcore',
        hardcore: 'Undercover hardcore', rg: 'Roland-Garros', rolandgarros: 'Roland-Garros', roland_garros: 'Roland-Garros',
        dle: 'AnimeDLE', animedle: 'AnimeDLE', quote: 'Citations', quotes: 'Citations', citation: 'Citations', citations: 'Citations',
        chaine: 'Chaîne de persos', chain: 'Chaîne de persos', guess: 'Devine le perso', devine: 'Devine le perso',
        tierlist: 'Tier List', tier_list: 'Tier List', draw: 'Dessine le perso', drawing: 'Dessine le perso',
        battle: 'Battle de préférence', card: 'Combat de cartes', cards: 'Combat de cartes', tournoi: 'Tournoi', tournament: 'Tournoi',
        arcade: 'Mini-jeux', static: 'Catalogue images', images: 'Catalogue images', character_images: 'Catalogue images'
    };

    function prettyMode(value) {
        const raw = String(value || '').trim();
        if (!raw) return 'Autre';
        const key = raw.toLowerCase().replace(/[\s-]+/g, '_');
        if (MODE_LABELS[key]) return MODE_LABELS[key];
        return raw.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    }

    function sourcesOf(x) {
        let out = [];
        if (Array.isArray(x?.sources)) out = x.sources;
        else if (Array.isArray(x?.modes)) out = x.modes;
        else if (x?.mode) out = [x.mode];
        return [...new Set(out.map(v => String(v || '').trim()).filter(Boolean))];
    }

    function css() {
        if (document.getElementById('ag-charadmin-style')) return;
        const s = document.createElement('style');
        s.id = 'ag-charadmin-style';
        s.textContent = `
        .ag-charadmin{margin-top:18px}.ag-charadmin-head{display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap}
        .ag-charadmin-head h2{margin:0}.ag-charadmin-tools{display:grid;grid-template-columns:minmax(180px,2fr) repeat(3,minmax(145px,1fr));gap:8px;margin:12px 0}
        .ag-charadmin-tools input,.ag-charadmin-tools select{width:100%;min-width:0;padding:10px 12px;border-radius:10px;border:1px solid rgba(255,255,255,.14);background:#111827;color:#fff}
        .ag-charadmin-stats{font-size:.82rem;opacity:.86;margin:8px 0 12px}.ag-charadmin-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:10px}
        .ag-charcard{position:relative;border:1px solid rgba(255,255,255,.1);background:rgba(10,14,25,.78);border-radius:12px;overflow:hidden;min-width:0}
        .ag-charcard>img{width:100%;height:190px;object-fit:cover;background:#0b1020;display:block}.ag-charcard.bad>img{opacity:.24}.ag-charcard.bad{border-color:rgba(255,70,100,.65)}
        .ag-charcard-copy{padding:9px}.ag-charcard-copy>b{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ag-charcard-copy>small{display:block;opacity:.67;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}
        .ag-charstate{position:absolute;z-index:2;top:7px;right:7px;font-size:.68rem;font-weight:900;padding:3px 6px;border-radius:999px;background:#5b6475;color:white}.ag-charcard.ok .ag-charstate{background:#118a58}.ag-charcard.bad .ag-charstate{background:#b82d48}
        .ag-modechips{display:flex;gap:4px;overflow:hidden;flex-wrap:wrap;max-height:42px;margin-top:6px}.ag-modechip{font-size:.58rem;padding:2px 5px;border-radius:999px;background:rgba(73,169,255,.12);border:1px solid rgba(73,169,255,.24);white-space:nowrap}
        .ag-charurl{margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,.09)}.ag-charurl label{display:block;font-size:.63rem;opacity:.7;margin-bottom:4px}.ag-charurl input{width:100%;box-sizing:border-box;padding:7px 8px;border-radius:7px;border:1px solid rgba(255,255,255,.16);background:#0b1020;color:#fff;font-size:.67rem}
        .ag-charcard-actions{display:grid;grid-template-columns:1fr 1fr 1fr;gap:5px;margin-top:6px}.ag-charcard-actions button,.ag-charcard-actions a{min-width:0;font-size:.65rem;padding:7px 5px;border-radius:7px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.05);color:inherit;text-decoration:none;text-align:center;cursor:pointer}.ag-charcard-actions [data-save]{background:#116b4a;font-weight:800}.ag-charcard-actions button:disabled{opacity:.5;cursor:wait}
        .ag-charmsg{display:block;min-height:15px;margin-top:5px;font-size:.62rem;line-height:1.2}.ag-charadmin-more{display:block;margin:14px auto 2px;padding:9px 18px}.ag-charadmin-empty{padding:25px;text-align:center;opacity:.7}
        @media(max-width:900px){.ag-charadmin-tools{grid-template-columns:1fr 1fr}.ag-charadmin-grid{grid-template-columns:repeat(auto-fill,minmax(165px,1fr))}}
        @media(max-width:540px){.ag-charadmin-tools{grid-template-columns:1fr}.ag-charadmin-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}.ag-charcard>img{height:155px}.ag-charcard-actions{grid-template-columns:1fr}.ag-charcard-actions a,.ag-charcard-actions button{font-size:.62rem}}
        `;
        document.head.appendChild(s);
    }

    function ensure() {
        css();
        const admin = document.getElementById('admin');
        if (!admin) return setTimeout(ensure, 400);
        if (document.getElementById('ag-charadmin')) return;

        const wrap = document.createElement('div');
        wrap.id = 'ag-charadmin';
        wrap.className = 'opt-panel ag-charadmin';
        wrap.innerHTML = `
          <div class="ag-charadmin-head">
            <div><h2>🖼️ Tous les personnages & images</h2><p class="tl-hint" style="text-align:left;margin:3px 0">Catalogue complet. L'URL de chaque image est visible et modifiable ; les changements admin sont sauvegardés en base et survivent aux redéploiements Render.</p></div>
            <button id="ag-charadmin-load" class="btn-action">Afficher les personnages</button>
          </div>
          <div id="ag-charadmin-body" style="display:none">
            <div class="ag-charadmin-tools">
              <input id="ag-charadmin-q" type="search" autocomplete="off" placeholder="🔎 Perso ou anime…">
              <select id="ag-charadmin-mode"><option value="">Tous les modes</option></select>
              <select id="ag-charadmin-anime"><option value="">Tous les anime</option></select>
              <select id="ag-charadmin-status"><option value="">Toutes les images</option><option value="bad">Images cassées / manquantes</option><option value="ok">Images OK</option></select>
            </div>
            <div id="ag-charadmin-stats" class="ag-charadmin-stats"></div>
            <div id="ag-charadmin-grid" class="ag-charadmin-grid"></div>
            <button id="ag-charadmin-more" class="ag-charadmin-more" style="display:none">Afficher plus</button>
          </div>`;
        admin.appendChild(wrap);

        document.getElementById('ag-charadmin-load').addEventListener('click', load);
        document.getElementById('ag-charadmin-q').addEventListener('input', apply);
        document.getElementById('ag-charadmin-mode').addEventListener('change', apply);
        document.getElementById('ag-charadmin-anime').addEventListener('change', apply);
        document.getElementById('ag-charadmin-status').addEventListener('change', apply);
        document.getElementById('ag-charadmin-more').addEventListener('click', () => { state.page++; render(false); });
    }

    async function load() {
        const btn = document.getElementById('ag-charadmin-load');
        if (state.loaded) {
            document.getElementById('ag-charadmin-body').style.display = '';
            apply();
            return;
        }
        btn.disabled = true;
        btn.textContent = 'Chargement…';
        try {
            const r = await fetch('/api/character-catalog', { cache:'no-store' });
            const d = await r.json();
            if (!r.ok || !d.ok) throw new Error(d.error || 'catalogue');
            state.all = Array.isArray(d.characters) ? d.characters : [];

            const animeSel = document.getElementById('ag-charadmin-anime');
            const animes = Array.isArray(d.animes) && d.animes.length ? d.animes : [...new Set(state.all.map(x => x.anime).filter(Boolean))].sort((a,b) => a.localeCompare(b));
            for (const a of animes) {
                const o = document.createElement('option'); o.value = a; o.textContent = a; animeSel.appendChild(o);
            }

            const modeSel = document.getElementById('ag-charadmin-mode');
            const modes = [...new Set(state.all.flatMap(sourcesOf))].sort((a,b) => prettyMode(a).localeCompare(prettyMode(b)));
            for (const m of modes) {
                const o = document.createElement('option'); o.value = m; o.textContent = prettyMode(m); modeSel.appendChild(o);
            }

            state.loaded = true;
            document.getElementById('ag-charadmin-body').style.display = '';
            btn.textContent = 'Catalogue chargé';
            btn.disabled = true;
            apply();
            detectAllCharacterImages();
        } catch (e) {
            btn.disabled = false;
            btn.textContent = 'Réessayer';
            const st = document.getElementById('ag-charadmin-stats');
            if (st) st.textContent = '❌ Impossible de charger le catalogue : ' + (e?.message || 'erreur');
        }
    }

    function apply() {
        if (!state.loaded) return;
        const q = String(document.getElementById('ag-charadmin-q')?.value || '').trim().toLowerCase();
        const anime = document.getElementById('ag-charadmin-anime')?.value || '';
        const mode = document.getElementById('ag-charadmin-mode')?.value || '';
        const wantedStatus = document.getElementById('ag-charadmin-status')?.value || '';

        state.filtered = state.all.filter(x => {
            if (anime && x.anime !== anime) return false;
            if (mode && !sourcesOf(x).includes(mode)) return false;
            if (q && !(String(x.name || '').toLowerCase().includes(q) || String(x.anime || '').toLowerCase().includes(q) || sourcesOf(x).some(s => prettyMode(s).toLowerCase().includes(q)))) return false;
            if (wantedStatus && state.status.get(keyOf(x)) !== wantedStatus) return false;
            return true;
        });
        state.page = 0;
        render(true);
    }

    function render(reset) {
        const grid = document.getElementById('ag-charadmin-grid');
        if (!grid) return;
        if (reset) grid.innerHTML = '';
        const start = state.page * PAGE;
        const end = Math.min(state.filtered.length, start + PAGE);
        const slice = state.filtered.slice(start, end);
        if (!slice.length && !grid.children.length) grid.innerHTML = '<div class="ag-charadmin-empty">Aucun personnage avec ces filtres.</div>';

        for (const x of slice) {
            const k = keyOf(x);
            const known = state.status.get(k) || '';
            const card = document.createElement('div');
            card.className = 'ag-charcard ' + known;
            card.dataset.key = k;
            const img = String(x.img || x.originalImg || '');
            const modes = sourcesOf(x);
            const chips = modes.length ? modes.map(m => `<span class="ag-modechip" title="${esc(m)}">${esc(prettyMode(m))}</span>`).join('') : '<span class="ag-modechip">Non classé</span>';

            card.innerHTML = `<span class="ag-charstate">${known === 'ok' ? 'OK' : known === 'bad' ? 'CASSÉE' : '…'}</span>
              <img loading="lazy" referrerpolicy="no-referrer" src="${esc(img)}" alt="${esc(x.name)}">
              <div class="ag-charcard-copy">
                <b title="${esc(x.name)}">${esc(x.name)}</b>
                <small title="${esc(x.anime)}">${esc(x.anime)}</small>
                <div class="ag-modechips">${chips}</div>
                <div class="ag-charurl"><label>URL actuelle / nouvelle URL</label><input data-url type="url" inputmode="url" autocomplete="off" spellcheck="false" value="${esc(img)}" title="${esc(img)}" placeholder="https://…"></div>
                <div class="ag-charcard-actions"><button type="button" data-save>Enregistrer</button><button type="button" data-copy-url>Copier URL</button><a data-open href="${esc(img || '#')}" target="_blank" rel="noopener">Ouvrir</a></div>
                <small class="ag-charmsg" data-msg></small>
              </div>`;

            const im = card.querySelector('img');
            const badge = card.querySelector('.ag-charstate');
            const input = card.querySelector('[data-url]');
            const save = card.querySelector('[data-save]');
            const msg = card.querySelector('[data-msg]');
            const open = card.querySelector('[data-open]');

            const setStatus = val => {
                state.status.set(k, val);
                card.classList.remove('ok','bad');
                card.classList.add(val);
                badge.textContent = val === 'ok' ? 'OK' : 'CASSÉE';
                stats();
            };
            im.addEventListener('load', () => setStatus('ok'), { once:true });
            im.addEventListener('error', () => setStatus('bad'), { once:true });

            card.querySelector('[data-copy-url]').addEventListener('click', async () => {
                const value = String(input.value || '').trim();
                try { await navigator.clipboard.writeText(value); msg.textContent = '✅ URL copiée'; }
                catch (_) { msg.textContent = '❌ Copie impossible'; }
            });

            save.addEventListener('click', async () => {
                const imageUrl = String(input.value || '').trim();
                if (!/^https:\/\/\S+$/i.test(imageUrl)) {
                    msg.textContent = '❌ La nouvelle URL doit commencer par https://';
                    return;
                }
                if (!x.u && !x.universe) {
                    msg.textContent = '❌ Anime non reconnu pour ce personnage.';
                    return;
                }

                save.disabled = true;
                save.textContent = 'Sauvegarde…';
                msg.textContent = 'Enregistrement permanent…';
                try {
                    const headers = typeof authHeaders === 'function' ? authHeaders(true) : { 'Content-Type':'application/json' };
                    const r = await fetch('/api/admin/character-image', {
                        method:'POST', headers,
                        body:JSON.stringify({ universe:x.u || x.universe, name:x.name, imageUrl })
                    });
                    const d = await r.json().catch(() => ({}));
                    if (!r.ok || !d.ok) throw new Error(d.error || `HTTP ${r.status}`);

                    x.img = imageUrl;
                    x.originalImg = imageUrl;
                    input.value = imageUrl;
                    input.title = imageUrl;
                    open.href = imageUrl;
                    msg.textContent = '⏳ URL sauvegardée, test de l’image…';

                    const test = new Image();
                    const timer = setTimeout(() => {
                        setStatus('bad');
                        msg.textContent = '⚠️ URL sauvegardée, mais le chargement de l’image expire.';
                    }, 12000);
                    test.onload = () => {
                        clearTimeout(timer);
                        setStatus('ok');
                        im.src = imageUrl + (imageUrl.includes('?') ? '&' : '?') + 'ag_admin=' + Date.now();
                        msg.textContent = '✅ Image enregistrée définitivement';
                    };
                    test.onerror = () => {
                        clearTimeout(timer);
                        setStatus('bad');
                        msg.textContent = '⚠️ URL sauvegardée, mais l’image ne charge pas.';
                    };
                    test.referrerPolicy = 'no-referrer';
                    test.src = imageUrl + (imageUrl.includes('?') ? '&' : '?') + 'ag_test=' + Date.now();
                } catch (e) {
                    msg.textContent = '❌ ' + (e?.message || 'Erreur de sauvegarde');
                } finally {
                    save.disabled = false;
                    save.textContent = 'Enregistrer';
                }
            });

            grid.appendChild(card);
        }

        const more = document.getElementById('ag-charadmin-more');
        if (more) more.style.display = end < state.filtered.length ? '' : 'none';
        stats();
    }

    function stats() {
        const el = document.getElementById('ag-charadmin-stats');
        if (!el) return;
        const ok = [...state.status.values()].filter(x => x === 'ok').length;
        const bad = [...state.status.values()].filter(x => x === 'bad').length;
        const mode = document.getElementById('ag-charadmin-mode')?.value || '';
        const suffix = mode ? ` • mode ${prettyMode(mode)}` : '';
        if (state.scanning) {
            el.textContent = `🔎 Vérification automatique ${state.scanDone}/${state.all.length} • ✅ ${state.scanOk} • ❌ ${state.scanBad}${suffix}`;
        } else {
            el.textContent = `${state.all.length} personnages • ${state.filtered.length} avec les filtres • ${ok} images OK testées • ${bad} cassées/manquantes${suffix}`;
        }
    }

    function probe(x) {
        return new Promise(resolve => {
            const k = keyOf(x);
            const url = String(x.img || x.originalImg || '');
            if (!url) {
                state.status.set(k, 'bad');
                state.scanDone++; state.scanBad++;
                return resolve();
            }
            const image = new Image();
            let finished = false;
            const done = status => {
                if (finished) return;
                finished = true;
                clearTimeout(timer);
                state.status.set(k, status);
                state.scanDone++;
                if (status === 'ok') state.scanOk++; else state.scanBad++;
                resolve();
            };
            image.onload = () => done('ok');
            image.onerror = () => done('bad');
            image.referrerPolicy = 'no-referrer';
            const timer = setTimeout(() => done('bad'), 12000);
            image.src = url;
        });
    }

    async function detectAllCharacterImages() {
        if (state.scanning || !state.loaded || !state.all.length) return;
        state.scanning = true;
        state.scanDone = state.scanOk = state.scanBad = 0;
        stats();
        let cursor = 0;
        let lastUiRefresh = 0;

        async function worker() {
            while (cursor < state.all.length) {
                const i = cursor++;
                await probe(state.all[i]);
                if (state.scanDone - lastUiRefresh >= 35 || state.scanDone === state.all.length) {
                    lastUiRefresh = state.scanDone;
                    stats();
                    document.querySelectorAll('.ag-charcard[data-key]').forEach(card => {
                        const status = state.status.get(card.dataset.key);
                        if (!status) return;
                        card.classList.remove('ok','bad'); card.classList.add(status);
                        const b = card.querySelector('.ag-charstate');
                        if (b) b.textContent = status === 'ok' ? 'OK' : 'CASSÉE';
                    });
                }
            }
        }

        await Promise.all(Array.from({ length:Math.min(SCAN_WORKERS, state.all.length) }, worker));
        state.scanning = false;
        stats();
        if (document.getElementById('ag-charadmin-status')?.value) apply();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ensure, { once:true });
    else ensure();
})();
'''
    ui = ui[:start] + block

SERVER.write_text(server, encoding='utf-8')
UI.write_text(ui, encoding='utf-8')
print('character admin v4 patch applied')
