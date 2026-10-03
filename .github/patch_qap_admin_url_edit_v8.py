from pathlib import Path

# --- index.html: make QAP cards editable instead of preview-only ---
ip = Path('index.html')
ui = ip.read_text(encoding='utf-8')
ui_marker = 'AG_QAP_ADMIN_URL_EDIT_V8'
if ui_marker not in ui:
    old = """            if (x.themeSource) {
                card.querySelector('[data-save]').remove();
                card.querySelector('.ag-charcard-copy>small').textContent = x.sub || x.anime;
                card.querySelector('.ag-charmsg').textContent = 'Aperçu du sous-mode';
                card.querySelector('[data-url]').readOnly = true;
"""
    new = """            if (x.themeSource) {
                // AG_QAP_ADMIN_URL_EDIT_V8 — QAP cards are real editable admin entries.
                card.querySelector('.ag-charcard-copy>small').textContent = x.sub || x.anime;
                card.querySelector('.ag-charmsg').textContent = 'URL modifiable • sauvegarde persistante';
                const qapUrlInput = card.querySelector('[data-url]');
                if (qapUrlInput) qapUrlInput.readOnly = false;
                const qapSaveButton = card.querySelector('[data-save]');
                if (qapSaveButton) {
                    qapSaveButton.textContent = 'Enregistrer';
                    qapSaveButton.title = 'Enregistrer définitivement cette image pour ce sous-mode';
                }
"""
    if old not in ui:
        raise SystemExit('QAP preview-only card block not found')
    ui = ui.replace(old, new, 1)

    old_fetch = "const response = await fetch('/api/arcade/item-image?source=' + encodeURIComponent(item.themeSource) + '&name=' + encodeURIComponent(item.name), { signal: AbortSignal.timeout(60000) });"
    new_fetch = "const response = await fetch('/api/arcade/item-image?source=' + encodeURIComponent(item.themeSource) + '&name=' + encodeURIComponent(item.name), { cache:'no-store', signal: AbortSignal.timeout(60000) });"
    if old_fetch not in ui:
        raise SystemExit('QAP item-image fetch anchor not found')
    ui = ui.replace(old_fetch, new_fetch, 1)

    old_saved = """                row.status='manual-admin';
                row.manualOverride=true;
"""
    new_saved = """                row.status='manual-admin';
                row.manualOverride=true;
                if(row.themeSource) row.imagePending=false;
"""
    if old_saved not in ui:
        raise SystemExit('saveUrl applySaved anchor not found')
    ui = ui.replace(old_saved, new_saved, 1)

ip.write_text(ui, encoding='utf-8')

# --- server.js: manual QAP overrides must win before embedded/automatic images ---
sp = Path('server.js')
server = sp.read_text(encoding='utf-8')
server_marker = 'AG_QAP_MANUAL_OVERRIDE_V8'
if server_marker not in server:
    route_start = server.find("app.get('/api/arcade/item-image', async (req, res) => {")
    route_end = server.find('\n});', route_start)
    if route_start < 0 or route_end < 0:
        raise SystemExit('QAP item-image route not found')
    route_end += 4
    route = server[route_start:route_end]

    opening = "app.get('/api/arcade/item-image', async (req, res) => {\n"
    injected = """app.get('/api/arcade/item-image', async (req, res) => {
    // AG_QAP_MANUAL_OVERRIDE_V8 — an admin URL saved for a QAP item always wins.
    // It uses the same durable character_images table, keyed by qt:<theme> + item name.
    const overrideSource = String(req.query.source || '');
    const overrideName = String(req.query.name || '');
    if (overrideSource.startsWith('qt:') && overrideName) {
        try {
            const manualOverride = await getCachedCharacterImage(overrideSource, overrideName);
            if (manualOverride?.imageUrl) {
                QAP_ITEM_IMAGE_CACHE.delete(overrideSource + '|' + overrideName);
                res.set('Cache-Control', 'no-store');
                return res.json({ ok:true, imageUrl:manualOverride.imageUrl });
            }
        } catch (_) {}
    }
"""
    if not route.startswith(opening):
        raise SystemExit('QAP route opening changed')
    route = injected + route[len(opening):]

    old_cached_header = "res.set('Cache-Control', cached.url ? 'public, max-age=86400' : 'no-store');"
    new_cached_header = "res.set('Cache-Control', overrideSource.startsWith('qt:') ? 'no-store' : (cached.url ? 'public, max-age=86400' : 'no-store'));"
    if old_cached_header not in route:
        raise SystemExit('QAP cached header anchor not found')
    route = route.replace(old_cached_header, new_cached_header, 1)

    old_final_header = "res.set('Cache-Control', url ? 'public, max-age=86400' : 'no-store');"
    new_final_header = "res.set('Cache-Control', overrideSource.startsWith('qt:') ? 'no-store' : (url ? 'public, max-age=86400' : 'no-store'));"
    if old_final_header not in route:
        raise SystemExit('QAP final header anchor not found')
    route = route.replace(old_final_header, new_final_header, 1)

    server = server[:route_start] + route + server[route_end:]

    admin_anchor = """    const x={u,name}; await simpleStoreImage(x,img,url,'manual-admin');
    const imageUrl=simpleImageRoute(u,name,Date.now());
"""
    admin_new = """    const x={u,name}; await simpleStoreImage(x,img,url,'manual-admin');
    // A QAP image may already be held in the runtime resolver cache. Drop it immediately
    // so the newly saved admin image is visible without waiting for cache expiry/redeploy.
    if (u.startsWith('qt:') && typeof QAP_ITEM_IMAGE_CACHE !== 'undefined') QAP_ITEM_IMAGE_CACHE.clear();
    const imageUrl=simpleImageRoute(u,name,Date.now());
"""
    if admin_anchor not in server:
        raise SystemExit('admin character-image save anchor not found')
    server = server.replace(admin_anchor, admin_new, 1)

sp.write_text(server, encoding='utf-8')

# Static safety assertions.
ui2 = ip.read_text(encoding='utf-8')
server2 = sp.read_text(encoding='utf-8')
required_ui = [
    ui_marker,
    "qapUrlInput.readOnly = false",
    "qapSaveButton.textContent = 'Enregistrer'",
    "if(row.themeSource) row.imagePending=false",
    "cache:'no-store', signal: AbortSignal.timeout(60000)",
]
required_server = [
    server_marker,
    "getCachedCharacterImage(overrideSource, overrideName)",
    "QAP_ITEM_IMAGE_CACHE.clear()",
    "overrideSource.startsWith('qt:') ? 'no-store'",
]
missing = [x for x in required_ui if x not in ui2] + [x for x in required_server if x not in server2]
if missing:
    raise SystemExit('missing expected markers: ' + repr(missing))
if "card.querySelector('[data-save]').remove();" in ui2:
    raise SystemExit('QAP save button removal still present')
if "card.querySelector('[data-url]').readOnly = true;" in ui2:
    raise SystemExit('QAP URL readonly lock still present')
print('patched QAP admin URL editing v8')
