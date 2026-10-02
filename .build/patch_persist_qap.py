from pathlib import Path
import re


def patch_server():
    p = Path('server.js')
    s = p.read_text(encoding='utf-8')

    rx = re.compile(
        r"app\.use\('/api/avatar/img',\s*__agServeCanonicalImageV2\);\s*"
        r"app\.use\('/api/character-image',\s*__agServeCanonicalImageV2\);\s*"
        r"app\.use\('/api/character-image-file',\s*__agServeCanonicalImageV2\);",
        re.M,
    )
    repl = r'''/* AG_MANUAL_IMAGE_PRIORITY_V3
   A manual admin image is authoritative. The verified local library is only a fallback. */
async function __agServeManualThenCanonicalV3(req, res, next) {
  try {
    const u = String(req.query.u || req.query.universe || req.query.universeKey || '').trim();
    const n = String(req.query.n || req.query.name || '').trim();
    if (u && n) {
      const cleanName = cleanImageCharacterName(n);
      const normName = normalizeImageKey(cleanName);
      const r = await pool.query(`
        SELECT image_bytes, mime_type, status
        FROM character_images
        WHERE universe_key=$1 AND norm_name=$2
          AND status='manual-admin'
          AND image_bytes IS NOT NULL
          AND octet_length(image_bytes)>=700
        LIMIT 1`, [u, normName]);
      const row = r.rows && r.rows[0];
      if (row && row.image_bytes) {
        res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Content-Type', row.mime_type || 'image/jpeg');
        return res.end(row.image_bytes);
      }
    }
  } catch (_) {}
  return __agServeCanonicalImageV2(req, res, next);
}
app.use('/api/avatar/img', __agServeManualThenCanonicalV3);
app.use('/api/character-image', __agServeManualThenCanonicalV3);
app.use('/api/character-image-file', __agServeManualThenCanonicalV3);'''
    s, n = rx.subn(repl, s, count=1)
    assert n == 1, f'canonical bridge registrations not patched: {n}'

    needle = """    const normName = normalizeImageKey(cleanImageCharacterName(x.name));
    const stable = simpleImageRoute(x.u, x.name, Date.now());"""
    inject = """    const normName = normalizeImageKey(cleanImageCharacterName(x.name));
    /* AG_MANUAL_IMAGE_LOCK_V3: background fill must never overwrite an admin choice. */
    if (status !== 'manual-admin') {
        try {
            const prior = await pool.query(`
                SELECT status FROM character_images
                WHERE universe_key=$1 AND norm_name=$2
                LIMIT 1`, [x.u, normName]);
            if (prior.rows && prior.rows[0] && prior.rows[0].status === 'manual-admin') return true;
        } catch (_) {}
    }
    const stable = simpleImageRoute(x.u, x.name, Date.now());"""
    assert needle in s, 'simpleStoreImage normName/stable block not found'
    s = s.replace(needle, inject, 1)

    old = "if (manual?.imageUrl && manual?.sourceUrl === 'manual-admin') return manual;"
    new = "if (manual?.imageUrl && (manual?.status === 'manual-admin' || manual?.sourceUrl === 'manual-admin')) return manual;"
    if old in s:
        s = s.replace(old, new, 1)

    route = "app.get('/api/character-catalog', (req, res) => {"
    assert route in s, 'character-catalog route signature not found'
    s = s.replace(route, "app.get('/api/character-catalog', async (req, res) => {", 1)
    rpos = s.index("app.get('/api/character-catalog', async (req, res) => {")
    cpos = s.find('const characters = [...rows.values()]', rpos)
    assert cpos > rpos, 'catalog characters declaration not found'
    tail = s[cpos:].replace('const characters = [...rows.values()]', 'let characters = [...rows.values()]', 1)
    s = s[:cpos] + tail
    apos = s.find('const animes =', cpos)
    assert apos > cpos, 'catalog animes declaration not found'
    merge = r'''/* AG_MANUAL_CATALOG_PRIORITY_V3: reload the exact manual URL in admin after refresh. */
    try {
        const manualRows = await pool.query(`
            SELECT universe_key, norm_name, source_url, status, updated_at
            FROM character_images
            WHERE status='manual-admin'
              AND source_url IS NOT NULL
              AND source_url ~ '^https://'
              AND image_bytes IS NOT NULL
              AND octet_length(image_bytes)>=700`);
        const manualByKey = new Map((manualRows.rows || []).map(row => [
            `${String(row.universe_key || '').trim()}|${String(row.norm_name || '').trim()}`,
            row
        ]));
        characters = characters.map(x => {
            if (!x || !x.u || !x.name) return x;
            const key = `${String(x.u).trim()}|${normalizeImageKey(cleanImageCharacterName(x.name))}`;
            const row = manualByKey.get(key);
            if (!row || !/^https:\/\/\S+$/i.test(String(row.source_url || ''))) return x;
            return { ...x, img: row.source_url, originalImg: row.source_url, manualImage: true };
        });
    } catch (e) {
        console.warn('[character-catalog] manual image read failed:', e && e.message ? e.message : e);
    }
    '''
    s = s[:apos] + merge + s[apos:]

    for marker in ['AG_MANUAL_IMAGE_PRIORITY_V3', 'AG_MANUAL_IMAGE_LOCK_V3', 'AG_MANUAL_CATALOG_PRIORITY_V3']:
        assert marker in s
    p.write_text(s, encoding='utf-8')


def patch_index():
    p = Path('index.html')
    s = p.read_text(encoding='utf-8')

    decl = 'const QAP_QUESTIONS = [], QAP_CAT_OF = [];'
    assert decl in s, 'QAP declaration not found'
    subblock = r'''const QAP_SUBS = {
            power: [
                ['combat','⚔️ Combat & puissance',[0,1,2,3,4,5,8]],
                ['mental','🧠 Mental & stratégie',[6,7,9,10,11]]
            ],
            aura: [
                ['presence','🔥 Aura & présence',[0,1,2,3,4]],
                ['style','✨ Style & charisme',[5,6,7,8]],
                ['mystique','🌙 Mystère & répliques',[9,10,11]]
            ],
            emo: [
                ['emotion','💔 Souffrance & émotions',[0,1,4,5]],
                ['evolution','📈 Évolution & comeback',[2,3,6]],
                ['opinion','👀 Sous-coté / surcoté',[7,8]]
            ],
            dark: [
                ['menace','😈 Danger & noirceur',[0,1,3,4]],
                ['toxic','☠️ Toxicité & ego',[2,5,6,7,8]]
            ],
            fun: [
                ['quotidien','😂 Drôle & quotidien',[0,1,2,8,11]],
                ['scenario','🎬 Scénarios improbables',[3,4,5,6,7]],
                ['absurde','🤪 Absurde & look',[9,10]]
            ],
            life: [
                ['relations','🤝 Amitié & relations',[0,1,6,7]],
                ['roles','👑 Rôles & responsabilités',[2,3,5,9]],
                ['confiance','🛡️ Confiance & loyauté',[4,8]]
            ]
        };
        const QAP_QUESTIONS = [], QAP_CAT_OF = [], QAP_SUB_OF = [];
        '''
    s = s.replace(decl, subblock, 1)

    flat = 'QAP_CATS.forEach(([c]) => QAP_BY_CAT[c].forEach(q => { QAP_QUESTIONS.push(q); QAP_CAT_OF.push(c); }));'
    assert flat in s, 'QAP flatten loop not found'
    flat2 = """QAP_CATS.forEach(([c]) => QAP_BY_CAT[c].forEach((q, localIndex) => {
            const sub = (QAP_SUBS[c] || []).find(([, , indexes]) => indexes.includes(localIndex));
            QAP_QUESTIONS.push(q);
            QAP_CAT_OF.push(c);
            QAP_SUB_OF.push(sub ? `${c}:${sub[0]}` : `${c}:other`);
        }));"""
    s = s.replace(flat, flat2, 1)

    qcats = "let qapCats = (() => { try { const v = JSON.parse(localStorage.getItem('qap_cats') || 'null'); return Array.isArray(v) && v.length ? v : null; } catch (e) { return null; } })();"
    assert qcats in s, 'qapCats state not found'
    qsubs = "let qapSubs = (() => { try { const v = JSON.parse(localStorage.getItem('qap_subcats') || 'null'); return Array.isArray(v) && v.length ? v : null; } catch (e) { return null; } })();"
    s = s.replace(qcats, qcats + '\n        ' + qsubs, 1)

    qnext = "if (!bb.qBag || !bb.qBag.length) bb.qBag = bbShuffle(QAP_QUESTIONS.map((_, i) => i).filter(i => !qapCats || qapCats.includes(QAP_CAT_OF[i])));"
    assert qnext in s, 'qapNextQ filter not found'
    qnext2 = "if (!bb.qBag || !bb.qBag.length) bb.qBag = bbShuffle(QAP_QUESTIONS.map((_, i) => i).filter(i => (!qapCats || qapCats.includes(QAP_CAT_OF[i])) && (!qapSubs || qapSubs.includes(QAP_SUB_OF[i]))));"
    s = s.replace(qnext, qnext2, 1)

    setup_pos = s.index('function qapSetup(body)')
    start = s.index('            // thèmes des questions (plusieurs possibles)', setup_pos)
    end_marker = '            drawChips(); body.appendChild(chips);'
    end = s.index(end_marker, start) + len(end_marker)
    ui = r'''            // thèmes + sous-catégories des questions
            const chips = document.createElement('div'); chips.className = 'qap-chips';
            const subTitle = document.createElement('div');
            subTitle.style.cssText = 'margin:12px 0 6px;color:var(--accent-cyan);font-size:.78rem;font-weight:800;text-transform:uppercase;letter-spacing:.05em;';
            subTitle.textContent = 'Sous-catégories';
            const subChips = document.createElement('div'); subChips.className = 'qap-chips';
            const saveQapSubs = () => { try { qapSubs ? localStorage.setItem('qap_subcats', JSON.stringify(qapSubs)) : localStorage.removeItem('qap_subcats'); } catch (e) {} };
            const availableQapSubs = () => {
                const cats = qapCats || QAP_CATS.map(x => x[0]);
                return cats.flatMap(c => (QAP_SUBS[c] || []).map(([id,label]) => ({ key:`${c}:${id}`, label, cat:c })));
            };
            const drawSubs = () => {
                const available = availableQapSubs();
                const allowed = new Set(available.map(x => x.key));
                if (qapSubs) {
                    qapSubs = qapSubs.filter(x => allowed.has(x));
                    if (!qapSubs.length) qapSubs = null;
                    saveQapSubs();
                }
                subChips.innerHTML = '';
                const allSub = document.createElement('button');
                allSub.textContent = '✨ Toutes les sous-catégories';
                allSub.className = !qapSubs ? 'on' : '';
                allSub.onclick = () => { qapSubs = null; saveQapSubs(); if (bb) bb.qBag = null; drawSubs(); };
                subChips.appendChild(allSub);
                available.forEach(({key,label}) => {
                    const b = document.createElement('button');
                    b.textContent = label;
                    b.className = qapSubs && qapSubs.includes(key) ? 'on' : '';
                    b.onclick = () => {
                        const set = new Set(qapSubs || []); set.has(key) ? set.delete(key) : set.add(key);
                        qapSubs = set.size ? [...set] : null;
                        saveQapSubs(); if (bb) bb.qBag = null; drawSubs();
                    };
                    subChips.appendChild(b);
                });
            };
            const drawChips = () => {
                chips.innerHTML = '';
                const all = document.createElement('button'); all.textContent = '🌈 Tout mélangé'; all.className = !qapCats ? 'on' : '';
                all.onclick = () => { qapCats = null; try { localStorage.removeItem('qap_cats'); } catch (e) {} if (bb) bb.qBag = null; drawChips(); drawSubs(); };
                chips.appendChild(all);
                QAP_CATS.forEach(([c, label]) => {
                    const b = document.createElement('button'); b.textContent = label; b.className = qapCats && qapCats.includes(c) ? 'on' : '';
                    b.onclick = () => {
                        const set = new Set(qapCats || []); set.has(c) ? set.delete(c) : set.add(c);
                        qapCats = set.size ? [...set] : null;
                        try { qapCats ? localStorage.setItem('qap_cats', JSON.stringify(qapCats)) : localStorage.removeItem('qap_cats'); } catch (e) {}
                        if (bb) bb.qBag = null;
                        drawChips(); drawSubs();
                    };
                    chips.appendChild(b);
                });
            };
            drawChips(); body.appendChild(chips);
            body.appendChild(subTitle); body.appendChild(subChips); drawSubs();'''
    s = s[:start] + ui + s[end:]

    # Active robust mode category list.
    active_list = """            ['fun', '🎨 Dessin & fun'],
            ['strat', '💰 Stratégie & tournois']"""
    assert active_list in s, 'active mode category list not found'
    s = s.replace(active_list, """            ['fun', '🎨 Dessin & fun'],
            ['qap', '🏆 Qui a le plus'],
            ['strat', '💰 Stratégie & tournois']""", 1)

    active_rule = "if (/tu preferes|qui a le plus|dessine le perso|tier list|jeu de connexion|party mix/.test(t)) add('fun');"
    assert active_rule in s, 'active categoriesFor QAP rule not found'
    s = s.replace(active_rule, active_rule + "\n            if (/qui a le plus/.test(t)) add('qap');", 1)

    # Keep disabled historical category block coherent too.
    s = s.replace("[/qui a le plus/i, ['fun', 'stream']]", "[/qui a le plus/i, ['fun', 'stream', 'qap']]")

    assert 'QAP_SUBS' in s and 'QAP_SUB_OF' in s and 'qap_subcats' in s
    assert "['qap', '🏆 Qui a le plus']" in s
    p.write_text(s, encoding='utf-8')


if __name__ == '__main__':
    patch_server()
    patch_index()
    print('PATCH_OK')
