from pathlib import Path
import re

SERVER = Path('server.js')
UI = Path('assets/js/ui-refactor.js')

server = SERVER.read_text(encoding='utf-8')
ui = UI.read_text(encoding='utf-8')

UI_MARK = '/* Character image admin reliability v6 */'
SERVER_MARK = '// CHARACTER IMAGE LOCAL VALIDATION V6'

if '/* Admin character viewer v5 */' not in ui:
    raise SystemExit('Admin character viewer v5 not found')

if UI_MARK not in ui:
    instant_rx = re.compile(r"    function instantStatus\(x\) \{[\s\S]*?\n    \}\n\n    function css\(\)")
    instant_new = """    function instantStatus(x) {
        const u = imageOf(x);
        if (!u) return 'bad';
        // Never trust a URL just because it is local: the browser verifies the
        // actual file immediately. This catches stale /assets paths after deploys.
        return 'checking';
    }

    function css()"""
    ui, n = instant_rx.subn(instant_new, ui, count=1)
    if n != 1:
        raise SystemExit('instantStatus v5 block not found')

    ui = ui.replace(
        ".ag-charcard.external{border-color:rgba(246,186,73,.45)}",
        ".ag-charcard.external{border-color:rgba(246,186,73,.45)}.ag-charcard.checking{border-color:rgba(100,160,255,.35)}",
        1,
    )

    stats_rx = re.compile(r"    function stats\(\)\{[\s\S]*?\n    \}\n\n    function testVisibleExternal\(imgEl, x, card\)\{[\s\S]*?\n    \}\n\n    function render\(reset\)\{")
    stats_new = r'''    function stats(){
        const vals=[...state.status.values()];
        const all=state.all.length,
              ok=vals.filter(v=>v==='ok').length,
              bad=vals.filter(v=>v==='bad').length,
              ext=vals.filter(v=>v==='external').length,
              checking=vals.filter(v=>v==='checking').length;
        const el=document.getElementById('ag-charadmin-stats');
        if(el) el.textContent=`⚡ Vérification réelle • ${all} persos uniques • ✅ ${ok} locales testées • 🔗 ${ext} URL testées • ❌ ${bad} cassées • ⏳ ${checking} en cours • ${state.filtered.length} affichés`;
    }

    function testVisibleImage(imgEl,x,card){
        const url=imageOf(x), k=keyOf(x), local=isLocal(url);
        let done=false;
        const finish=ok=>{
            if(done)return; done=true;
            const status=ok?(local?'ok':'external'):'bad';
            state.status.set(k,status);
            card.classList.remove('bad','ok','external','checking');
            card.classList.add(status);
            const badge=card.querySelector('.ag-charstate');
            if(badge) badge.textContent=ok?(local?'OK':'URL'):'CASSÉE';
            stats();
        };
        if(!url){finish(false);return}
        imgEl.addEventListener('load',()=>finish(imgEl.naturalWidth>0&&imgEl.naturalHeight>0),{once:true});
        imgEl.addEventListener('error',()=>finish(false),{once:true});
        if(imgEl.complete) finish(imgEl.naturalWidth>0&&imgEl.naturalHeight>0);
        else setTimeout(()=>finish(false),6500);
    }

    function render(reset){'''
    ui, n = stats_rx.subn(stats_new, ui, count=1)
    if n != 1:
        raise SystemExit('stats/testVisibleExternal v5 block not found')

    ui = ui.replace(
        "${st==='ok'?'OK':st==='external'?'URL':'CASSÉE'}",
        "${st==='ok'?'OK':st==='external'?'URL':st==='checking'?'…':'CASSÉE'}",
        1,
    )
    ui = ui.replace(
        "grid.appendChild(card); const img=card.querySelector('img'); testVisibleExternal(img,x,card);",
        "grid.appendChild(card); const img=card.querySelector('img'); testVisibleImage(img,x,card);",
        1,
    )

    save_rx = re.compile(r"    async function saveUrl\(x,card\)\{[\s\S]*?\n    \}\n\n    ensure\(\);")
    save_new = r'''    async function saveUrl(x,card){
        const input=card.querySelector('[data-url]'), btn=card.querySelector('[data-save]'), msg=card.querySelector('.ag-charmsg'), url=String(input.value||'').trim();
        if(!/^https:\/\/\S+$/i.test(url)){msg.textContent='❌ URL https:// obligatoire';return}
        btn.disabled=true;msg.textContent='⚡ Vérification immédiate…';
        const valid=await validateImageUrl(url);
        if(!valid){btn.disabled=false;msg.textContent='❌ Cette image ne charge pas';return}
        msg.textContent='💾 Sauvegarde permanente…';
        try{
            let headers={'Content-Type':'application/json'};
            if(typeof authHeaders==='function'){
                try{headers=authHeaders(true)||headers}catch(_){ }
                if(!headers['Content-Type']&&!headers['content-type']) headers['Content-Type']='application/json';
            }
            const r=await fetch('/api/admin/character-image',{
                method:'POST',headers,credentials:'same-origin',
                body:JSON.stringify({universe:x.u||x.universe,name:x.name,imageUrl:url})
            });
            const d=await r.json().catch(()=>({}));
            if(!r.ok||!d.ok)throw new Error(d.error||`HTTP ${r.status}`);
            x.img=url;x.originalImg=url;
            state.status.set(keyOf(x),'checking');
            card.classList.remove('bad','ok','external');card.classList.add('checking');
            const badge=card.querySelector('.ag-charstate');if(badge)badge.textContent='…';
            const img=card.querySelector('img');
            img.src='';
            requestAnimationFrame(()=>{img.src=url+(url.includes('?')?'&':'?')+'ag_verify='+Date.now();testVisibleImage(img,x,card)});
            msg.textContent='✅ Sauvegardée définitivement';
            stats();
        }catch(e){msg.textContent='❌ '+(e?.message||'Erreur')}
        finally{btn.disabled=false}
    }

    /* Character image admin reliability v6 */
    ensure();'''
    ui, n = save_rx.subn(save_new, ui, count=1)
    if n != 1:
        raise SystemExit('saveUrl v5 block not found')

# Server: a stale local path in char-images.json must never be returned as OK.
# If the file is absent, resolveCharacterImage continues to its DB/automatic fallback.
if SERVER_MARK not in server:
    fn_pos = server.find('async function resolveCharacterImage')
    if fn_pos < 0:
        raise SystemExit('resolveCharacterImage not found')
    helper = r'''
// CHARACTER IMAGE LOCAL VALIDATION V6
function characterLocalImageExistsV6(imageUrl) {
    const value = String(imageUrl || '');
    if (!/^\/assets\/images\//i.test(value)) return true;
    try {
        const fsV6 = require('fs');
        const pathV6 = require('path');
        const full = pathV6.join(__dirname, value.replace(/^\/+/, ''));
        const st = fsV6.statSync(full);
        return st.isFile() && st.size > 256;
    } catch (_) {
        return false;
    }
}

'''
    server = server[:fn_pos] + helper + server[fn_pos:]

    # Limit the replacement to resolveCharacterImage's static mapping path.
    tail = server[fn_pos + len(helper):]
    old = "const fixed = staticCharImage(universeKey, displayName);\n    if (fixed) return { imageUrl:fixed, sourceUrl:null, status:'ok' };"
    if old not in tail:
        old = "const fixed = staticCharImage(universeKey, displayName);\n              if (fixed) return { imageUrl:fixed, sourceUrl:null, status:'ok' };"
    if old not in tail:
        raise SystemExit('staticCharImage return anchor not found')
    new = old.replace("if (fixed) return", "if (fixed && characterLocalImageExistsV6(fixed)) return")
    tail = tail.replace(old, new, 1)
    server = server[:fn_pos + len(helper)] + tail

SERVER.write_text(server, encoding='utf-8')
UI.write_text(ui, encoding='utf-8')
print('Character image admin reliability v6 installed')
