const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { loadCatalog, audit } = require('./audit-transform.cjs');
const catalog = loadCatalog();

test('all 105 catalog forms select an existing reviewed source', () => {
    const result = audit(catalog);
    assert.equal(result.total, 105);
    assert.equal(result.verifiedRows, 116);
    assert.equal(result.missing.length, 0);
    for (const row of result.covered) assert.match(row.selectedUrl, /^https:\/\//);
});

test('runtime exclusions distinguish related forms', () => {
    const resolve = catalog.resolve;
    assert.notEqual(resolve('Dragon Ball', 'Son Goku', 'Super Saiyan'), resolve('Dragon Ball', 'Son Goku', 'Super Saiyan Blue'));
    assert.notEqual(resolve('Naruto', 'Naruto Uzumaki', 'Sage Mode'), resolve('Naruto', 'Naruto Uzumaki', 'Six Paths Sage Mode'));
    assert.notEqual(resolve('Mob Psycho 100', 'Shigeo Kageyama', 'Mob 100%'), resolve('Mob Psycho 100', 'Shigeo Kageyama', 'Mob 100% Courage'));
    assert.equal(resolve('Unknown', 'Unknown', 'Unknown'), null);
});

test('audit uses runtime fields and reports only the first selected source', () => {
    const result = audit({ ...catalog, items: [
        { name: 'Unknown', char: 'Unknown', imageSearch: 'Goku Super Saiyan' },
        { name: 'Sage Mode', sub: 'Naruto Uzumaki • Naruto' }
    ] });
    assert.equal(result.missing.length, 1);
    assert.equal(result.covered.length, 1);
    assert.equal(result.covered[0].selectedUrl, catalog.resolve('Naruto', 'Naruto Uzumaki', 'Sage Mode'));
});

test('malformed or empty catalogs fail instead of reporting success', () => {
    assert.throws(() => loadCatalog(''), /not found/);
    const replacement = Buffer.from(JSON.stringify({ themes: [{ id: 'transformation', items: [] }] })).toString('base64');
    assert.throws(() => loadCatalog(catalog.source.replace(/("qap-themes\.json"\s*:\s*")[A-Za-z0-9+/=]+"/, '$1' + replacement + '"')), /Empty/);
});

async function resolveRoute({ source = 'qt:transformation', saved = null, verified = null, persisted = null, candidate = null } = {}) {
    let handler, response;
    const it = { name: 'Unknown form', char: 'Character', sub: 'Character • Anime', img: 'https://example.com/normal-portrait.png' };
    const context = vm.createContext({
        app: { get: (_path, fn) => { handler = fn; } },
        QAP_ITEM_IMAGE_CACHE: new Map(),
        arcItemsFor: () => [it],
        normalizeImageKey: value => value.toLowerCase(),
        FANDOM_UNIVERSE_ALIASES: { anime: 'anime' }, FANDOM_WIKIS: { anime: 'example.com' },
        getCachedCharacterImage: async () => saved,
        qapVerifiedTransformSource: () => verified,
        persistQapTransformImage: async () => persisted,
        fetchFandomTransformationImage: async () => candidate,
        qapAniListCharacterImage: async () => { throw new Error('Normal portrait lookup must not run'); }
    });
    const start = catalog.source.indexOf("app.get('/api/arcade/item-image',");
    const end = catalog.source.indexOf('\n});', start) + 4;
    assert.ok(start >= 0 && end > start);
    vm.runInContext(catalog.source.slice(start, end), context);
    await handler({ query: { source, name: it.name } }, {
        set: () => {}, json: value => { response = JSON.parse(JSON.stringify(value)); }
    });
    return response;
}

test('failed transformation lookup never falls back to an embedded portrait', async () => {
    assert.deepEqual(await resolveRoute(), { ok: false, imageUrl: null });
    assert.deepEqual(await resolveRoute({ verified: 'https://example.com/form.png' }), { ok: false, imageUrl: null });
});

test('saved, verified and form-specific images still resolve', async () => {
    const imageUrl = '/api/image/form';
    assert.deepEqual(await resolveRoute({ saved: { imageUrl } }), { ok: true, imageUrl });
    assert.deepEqual(await resolveRoute({ verified: 'https://example.com/form.png', persisted: imageUrl }), { ok: true, imageUrl });
    assert.deepEqual(await resolveRoute({ candidate: 'https://example.com/form.png' }), { ok: true, imageUrl: 'https://example.com/form.png' });
});

test('ordinary character themes retain their embedded image', async () => {
    assert.deepEqual(await resolveRoute({ source: 'qt:characters' }), { ok: true, imageUrl: 'https://example.com/normal-portrait.png' });
});
