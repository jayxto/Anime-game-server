const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function loadCatalog(source = fs.readFileSync(path.join(root, 'server.js'), 'utf8')) {
    function section(start, end) {
        const first = source.indexOf(start);
        const last = source.indexOf(end, first);
        if (first < 0 || last < 0) throw new Error(`Missing server section: ${start}`);
        return source.slice(first, last);
    }
    const embedded = source.match(/"qap-themes\.json"\s*:\s*"([A-Za-z0-9+/=]+)"/);
    if (!embedded) throw new Error('Embedded qap-themes.json not found');
    const data = JSON.parse(Buffer.from(embedded[1], 'base64').toString('utf8'));
    const items = data.themes.find(t => t.id === 'transformation')?.items;
    if (!items?.length) throw new Error('Empty or missing transformation catalog');

    // Execute only the declarations used by the resolver, without starting the server.
    // This preserves JS normalization, exclusions and first-match precedence exactly.
    const context = vm.createContext({});
    vm.runInContext(
        section('function normalizeImageKey(', '\nfunction resolveImageUniverseKey(') + '\n' +
        section('const QAP_VERIFIED_TRANSFORM_SOURCES_V2 =', '\nasync function persistQapTransformImage(') +
        '\nthis.rows = QAP_VERIFIED_TRANSFORM_SOURCES_V2;', context, { timeout: 1000 });
    if (!context.rows.length) throw new Error('Empty verified source array');
    return { source, items, rows: context.rows, resolve: context.qapVerifiedTransformSource };
}

function audit(catalog = loadCatalog()) {
    const entries = catalog.items.map((it, i) => {
        const parts = String(it.sub || '').split('•').map(s => s.trim()).filter(Boolean);
        const anime = parts.length > 1 ? parts[parts.length - 1] : '';
        const character = String(it.char || parts[0] || '').trim();
        const url = catalog.resolve(anime, character, String(it.name || '').trim());
        return { i: i + 1, char: character, name: it.name, sub: it.sub, selectedUrl: url };
    });
    return { total: entries.length, verifiedRows: catalog.rows.length,
        covered: entries.filter(r => r.selectedUrl), missing: entries.filter(r => !r.selectedUrl) };
}

function main() {
    const result = audit();
    const summary = `TOTAL=${result.total} VERIFIED_ROWS=${result.verifiedRows} COVERED=${result.covered.length} MISSING=${result.missing.length}`;
    const lines = [summary,
        'Resolver coverage only: existing reviewed mappings; not a new visual or HTTP verification.',
        '\n=== MISSING VERIFIED SOURCE ===', ...result.missing.map(r => JSON.stringify(r)),
        '\n=== COVERED (FIRST SOURCE SELECTED BY SERVER) ===', ...result.covered.map(r => JSON.stringify(r))];
    fs.writeFileSync(path.join(root, '.github/remaining_transform_report.txt'), lines.join('\n') + '\n');
    console.log(summary);
    if (result.missing.length) process.exitCode = 1;
}

module.exports = { loadCatalog, audit, main };
if (require.main === module) main();
