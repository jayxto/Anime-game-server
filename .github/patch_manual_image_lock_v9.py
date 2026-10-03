from pathlib import Path
import re

def sub_once(text, pattern, repl, label, flags=0):
    out, n = re.subn(pattern, repl, text, count=1, flags=flags)
    if n != 1:
        raise SystemExit(f"{label}: expected 1 replacement, got {n}")
    print("patched:", label)
    return out

# ---------------- index.html ----------------
p = Path("index.html")
s = p.read_text(encoding="utf-8")

s = sub_once(
    s,
    r"""(?ms)(\s*// Transformations must use the game's strict resolver, never an old portrait\.\s*\n)\s*img:\s*id === 'transformation' \? '' : \(item\.img \|\| item\.imgs\?\.\[0\] \|\| ''\),\s*\n\s*imagePending:\s*id === 'transformation' \|\| !\(item\.img \|\| item\.imgs\?\.\[0\]\)""",
    r"""\1                // AG_MANUAL_IMAGE_LOCK_V9 — always resolve through the server after refresh.
                // This makes a saved admin override authoritative over every embedded/fallback image.
                fallbackImg: item.img || item.imgs?.[0] || '',
                img: '',
                imagePending: true""",
    "QAP loadTheme always resolves server override"
)

s = sub_once(
    s,
    r"""(?ms)\s*item\.img = response\.ok && data\.ok \? String\(data\.imageUrl \|\| ''\) : '';\s*\n\s*\} catch \(_\) \{ item\.img = ''; \}\s*\n\s*item\.imagePending = false;\s*\n\s*if \(!card\.isConnected\) return;\s*\n\s*const img = card\.querySelector\('img'\);\s*\n\s*if \(item\.img\) img\.src = item\.img;\s*\n\s*card\.querySelector\('\[data-url\]'\)\.value = item\.img;\s*\n\s*card\.querySelector\('\[data-open\]'\)\.href = item\.img \|\| '#';\s*\n\s*testVisibleImage\(img, item, card\);""",
    r"""
                    item.img = response.ok && data.ok ? String(data.imageUrl || '') : '';
                    if (response.ok && data.ok && data.manualOverride) {
                        // AG_MANUAL_IMAGE_LOCK_V9 — restore the permanent source URL/state after F5.
                        item.manualOverride = true;
                        item.status = 'manual-admin';
                        item.sourceUrl = String(data.sourceUrl || '');
                        item.imgs = [];
                    }
                } catch (_) { item.img = ''; }
                item.imagePending = false;
                if (!card.isConnected) return;
                const img = card.querySelector('img');
                if (item.img) img.src = item.img;
                const input = card.querySelector('[data-url]');
                if (input) input.value = item.manualOverride ? (item.sourceUrl || item.img) : item.img;
                card.querySelector('[data-open]').href = item.img || '#';
                testVisibleImage(img, item, card);""",
    "QAP drain restores manual metadata"
)

s = sub_once(
    s,
    r"""(?ms)    function testVisibleImage\(imgEl,x,card\)\{\s*\n.*?\n    \}\s*\n\s*    function render\(reset\)\{""",
    r"""    function testVisibleImage(imgEl,x,card){
        // AG_MANUAL_IMAGE_LOCK_V9 — a DB-backed manual image is authoritative.
        // Never turn it into a false "CASSÉE" because a lazy image did not load within 6.5s.
        const url=imageOf(x), k=keyOf(x), local=isLocal(url);
        const manual=!!x.manualOverride || x.status==='manual-admin';
        let done=false;
        const finish=ok=>{
            if(done)return; done=true;
            const status=manual?'ok':(ok?(local?'ok':'external'):'bad');
            state.status.set(k,status);
            card.classList.remove('bad','ok','external','checking');
            card.classList.add(status);
            const badge=card.querySelector('.ag-charstate');
            if(badge) badge.textContent=manual?'SAUVÉE':(ok?(local?'OK':'URL'):'CASSÉE');
            stats();
        };
        if(!url){finish(false);return}
        if(manual && local){finish(true);return}
        imgEl.addEventListener('load',()=>finish(imgEl.naturalWidth>0&&imgEl.naturalHeight>0),{once:true});
        imgEl.addEventListener('error',()=>finish(false),{once:true});
        if(imgEl.complete) finish(imgEl.naturalWidth>0&&imgEl.naturalHeight>0);
        else setTimeout(()=>finish(false),6500);
    }

    function render(reset){""",
    "manual images never false-broken from lazy loading"
)

old_badge = """<span class="ag-charstate">${st==='ok'?'OK':st==='external'?'URL':st==='checking'?'…':'CASSÉE'}</span>"""
new_badge = """<span class="ag-charstate">${x.manualOverride||x.status==='manual-admin'?'SAUVÉE':st==='ok'?'OK':st==='external'?'URL':st==='checking'?'…':'CASSÉE'}</span>"""
if old_badge not in s:
    raise SystemExit("initial saved badge target missing")
s = s.replace(old_badge, new_badge, 1)
print("patched: initial saved badge")

s = sub_once(
    s,
    r"""(?ms)\s*state\.status\.set\(k,'checking'\);\s*\n\s*card\.classList\.remove\('bad','ok','external'\);card\.classList\.add\('checking'\);\s*\n\s*const badge=card\.querySelector\('\.ag-charstate'\);if\(badge\)badge\.textContent='…';""",
    r"""
            // AG_MANUAL_IMAGE_LOCK_V9 — POST success already means the image was copied durably.
            state.status.set(k,'ok');
            card.classList.remove('bad','external','checking');card.classList.add('ok');
            const badge=card.querySelector('.ag-charstate');if(badge)badge.textContent='SAUVÉE';""",
    "save success becomes permanent saved state"
)

p.write_text(s, encoding="utf-8")

# ---------------- server.js ----------------
p = Path("server.js")
s = p.read_text(encoding="utf-8")

pattern = r"""(?ms)(const overrideSource = String\(req\.query\.source \|\| ''\);\s*\n\s*const overrideName = String\(req\.query\.name \|\| ''\);\s*\n\s*if \(overrideSource\.startsWith\('qt:'\) && overrideName\) \{\s*\n\s*try \{\s*\n\s*const manualOverride = await getCachedCharacterImage\(overrideSource, overrideName\);\s*\n)\s*if \(manualOverride\?\.imageUrl\) \{\s*\n(?P<body>.*?)\s*return res\.json\(\{ ok:true, imageUrl:manualOverride\.imageUrl \}\);\s*\n\s*\}"""
m = re.search(pattern, s)
if not m:
    raise SystemExit("QAP manual override response target missing")
body = m.group("body")
replacement = m.group(1) + """            if (manualOverride?.status === 'manual-admin' && manualOverride?.imageUrl) {
                // AG_MANUAL_IMAGE_LOCK_V9 — return the permanent metadata, not only the preview.
"""
if "QAP_ITEM_IMAGE_CACHE.delete" in body:
    replacement += "                QAP_ITEM_IMAGE_CACHE.delete(overrideSource + '|' + overrideName);\n"
replacement += """                res.set('Cache-Control', 'no-store');
                return res.json({
                    ok:true,
                    imageUrl:manualOverride.imageUrl,
                    sourceUrl:manualOverride.sourceUrl || '',
                    status:'manual-admin',
                    manualOverride:true
                });
            }"""
s = s[:m.start()] + replacement + s[m.end():]
print("patched: QAP manual override metadata response")

save_pattern = r"""(?ms)(app\.post\('/api/admin/character-image', adminOnly\(async \(req,res\)=>\{.*?const img=await simpleFetchImage\(url,10000\);\s*\n\s*if \(!img\) return res\.status\(400\)\.json\(\{ok:false,error:'Image inaccessible ou invalide\.'\}\);\s*\n)\s*const x=\{u,name\}; await simpleStoreImage\(x,img,url,'manual-admin'\);\s*\n(?P<middle>.*?)\s*const imageUrl=simpleImageRoute\(u,name,Date\.now\(\)\);\s*\n\s*return res\.json\(\{ok:true,universe:u,name,imageUrl,sourceUrl:url\}\);"""
m = re.search(save_pattern, s)
if not m:
    raise SystemExit("admin image save endpoint target missing")
middle = m.group("middle")
cache_clear = ""
if "QAP_ITEM_IMAGE_CACHE.clear()" in middle:
    cache_clear = "    if (u.startsWith('qt:') && typeof QAP_ITEM_IMAGE_CACHE !== 'undefined') QAP_ITEM_IMAGE_CACHE.clear();\n"
replacement = m.group(1) + """    const x={u,name}; await simpleStoreImage(x,img,url,'manual-admin');
    // AG_MANUAL_IMAGE_LOCK_V9 — report success only after the durable BYTEA row is confirmed.
    const persisted = await pool.query(
        `SELECT source_url,status,updated_at
           FROM character_images
          WHERE universe_key=$1 AND norm_name=$2
            AND status='manual-admin'
            AND image_bytes IS NOT NULL
            AND octet_length(image_bytes)>=700
          LIMIT 1`,
        [u, normalizeImageKey(name)]
    );
    const saved = persisted.rows[0];
    if (!saved) return res.status(500).json({ok:false,error:'La copie permanente de l’image a échoué.'});
""" + cache_clear + """    try { CHARACTER_IMAGE_CACHE.delete(`${u}|${normalizeImageKey(name)}`); } catch (_) {}
    const stamp = saved.updated_at ? new Date(saved.updated_at).getTime() : Date.now();
    const imageUrl=simpleImageRoute(u,name,stamp);
    return res.json({
        ok:true,universe:u,name,imageUrl,
        sourceUrl:String(saved.source_url || url),
        status:'manual-admin',manualOverride:true,persistent:true
    });"""
s = s[:m.start()] + replacement + s[m.end():]
print("patched: verify durable DB row on admin save")

p.write_text(s, encoding="utf-8")
print("DONE")
