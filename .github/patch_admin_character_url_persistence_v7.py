from pathlib import Path

p = Path('index.html')
s = p.read_text(encoding='utf-8')
marker = 'AG_CHARACTER_ADMIN_PERSISTENT_URL_V7'

if marker in s:
    print('marker already present')
    raise SystemExit(0)

start = s.find('    async function saveUrl(x,card){')
if start < 0:
    raise SystemExit('saveUrl function not found')

end_marker = '\n    /* Character image admin reliability v6 */'
end = s.find(end_marker, start)
if end < 0:
    raise SystemExit('saveUrl end marker not found')

new_block = r'''    async function saveUrl(x,card){
        // AG_CHARACTER_ADMIN_PERSISTENT_URL_V7
        // The URL typed in the admin catalogue is the durable source URL.
        // The preview/game image is the stable server route backed by PostgreSQL.
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

            const savedSource=String(d.sourceUrl||url).trim();
            const savedImage=String(d.imageUrl||url).trim();
            const k=keyOf(x);
            const applySaved=row=>{
                if(!row)return;
                row.sourceUrl=savedSource;
                row.img=savedImage;
                row.imageUrl=savedImage;
                row.originalImg=savedImage;
                row.status='manual-admin';
                row.manualOverride=true;
            };
            applySaved(x);
            for(const row of state.all){if(keyOf(row)===k)applySaved(row)}
            for(const row of state.filtered){if(keyOf(row)===k)applySaved(row)}

            input.value=savedSource;
            const open=card.querySelector('[data-open]');
            if(open)open.href=savedImage||savedSource||'#';
            state.status.set(k,'checking');
            card.classList.remove('bad','ok','external');card.classList.add('checking');
            const badge=card.querySelector('.ag-charstate');if(badge)badge.textContent='…';
            const img=card.querySelector('img');
            if(img){
                img.src='';
                requestAnimationFrame(()=>{
                    const sep=savedImage.includes('?')?'&':'?';
                    img.src=savedImage+sep+'ag_verify='+Date.now();
                    testVisibleImage(img,x,card);
                });
            }
            msg.textContent='✅ URL enregistrée définitivement';
            stats();
        }catch(e){msg.textContent='❌ '+(e?.message||'Erreur')}
        finally{btn.disabled=false}
    }
'''

s = s[:start] + new_block + s[end:]
p.write_text(s, encoding='utf-8')

# Safety checks: the catalogue must still read the persistent endpoint and the save
# handler must now keep both the source URL and the stable DB-backed image route.
check = p.read_text(encoding='utf-8')
required = [
    marker,
    "fetch('/api/admin/character-catalog-persistent', { cache:'no-store' })",
    "fetch('/api/admin/character-image'",
    "row.sourceUrl=savedSource",
    "row.manualOverride=true",
    "row.img=savedImage",
]
missing = [x for x in required if x not in check]
if missing:
    raise SystemExit('missing expected markers: ' + repr(missing))
print('patched admin URL persistence v7')
