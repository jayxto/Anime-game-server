from pathlib import Path
import re

UI = Path('assets/js/ui-refactor.js')
ui = UI.read_text(encoding='utf-8')

START = '/* Admin character viewer v4 */'
NEW_START = '/* Admin character viewer v5 */'

if NEW_START in ui:
    print('Admin viewer v5 already installed')
    raise SystemExit(0)

start = ui.find(START)
if start < 0:
    raise SystemExit('Admin character viewer v4 marker not found')

# The viewer is the final self-contained IIFE added by v4. Replace exactly that block.
end = ui.find('\n})();', start)
if end < 0:
    raise SystemExit('Admin character viewer v4 end not found')
end += len('\n})();')

block = r'''/* Admin character viewer v5 */
(() => {
    const PAGE = 120;
    const state = { all: [], filtered: [], page: 0, status: new Map(), loaded: false };
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
    const keyOf = x => norm(x.u || x.universe || x.anime) + '|' + norm(x.name);

    const MODE_LABELS = {
        undercover:'Undercover', undercover_normal:'Undercover normal', undercover_hardcore:'Undercover hardcore', hardcore:'Undercover hardcore',
        rg:'Roland-Garros', rolandgarros:'Roland-Garros', roland_garros:'Roland-Garros', dle:'AnimeDLE', animedle:'AnimeDLE',
        quote:'Citations', quotes:'Citations', citation:'Citations', citations:'Citations', chaine:'Chaîne de persos', chain:'Chaîne de persos',
        guess:'Devine le perso', devine:'Devine le perso', tierlist:'Tier List', tier_list:'Tier List', draw:'Dessine le perso', drawing:'Dessine le perso',
        battle:'Battle de préférence', card:'Combat de cartes', cards:'Combat de cartes', tournoi:'Tournoi', tournament:'Tournoi', arcade:'Mini-jeux',
        static:'Catalogue images', images:'Catalogue images', character_images:'Catalogue images'
    };
    const prettyMode = value => {
        const raw = String(value || '').trim();
        if (!raw) return 'Autre';
        const k = raw.toLowerCase().replace(/[\s-]+/g,'_');
        return MODE_LABELS[k] || raw.replace(/[_-]+/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
    };
    const sourcesOf = x => {
        let a = [];
        if (Array.isArray(x?.sources)) a = x.sources;
        else if (Array.isArray(x?.modes)) a = x.modes;
        else if (x?.mode) a = [x.mode];
        return [...new Set(a.map(v=>String(v||'').trim()).filter(Boolean))];
    };
    const imageOf = x => String(x?.img || x?.imageUrl || x?.originalImg || '').trim();
    const isLocal = u => /^\/assets\/images\/chars\//i.test(String(u||''));

    function mergeCatalogue(items) {
        const map = new Map();
        for (const raw of Array.isArray(items) ? items : []) {
            const name = String(raw?.name || '').trim();
            const universe = String(raw?.u || raw?.universe || '').trim();
            const anime = String(raw?.anime || universe || '').trim();
            if (!name || !universe) continue;
            const k = norm(universe) + '|' + norm(name);
            const src = sourcesOf(raw);
            const candidate = { ...raw, u: universe, anime, name, sources: src };
            if (!map.has(k)) { map.set(k, candidate); continue; }
            const old = map.get(k);
            old.sources = [...new Set([...sourcesOf(old), ...src])];
            if (!old.anime && anime) old.anime = anime;
            const a = imageOf(old), b = imageOf(candidate);
            if ((!a && b) || (!isLocal(a) && isLocal(b))) {
                old.img = b;
                old.originalImg = candidate.originalImg || b;
            }
        }
        return [...map.values()].sort((a,b) => String(a.anime).localeCompare(String(b.anime)) || String(a.name).localeCompare(String(b.name)));
    }

    function instantStatus(x) {
        const u = imageOf(x);
        if (!u) return 'bad';
        if (isLocal(u)) return 'ok';
        return 'external';
    }

    function css() {
        if (document.getElementById('ag-charadmin-style')) return;
        const s = document.createElement('style'); s.id = 'ag-charadmin-style';
        s.textContent = `
        .ag-charadmin{margin-top:18px}.ag-charadmin-head{display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap}.ag-charadmin-head h2{margin:0}
        .ag-charadmin-tools{display:grid;grid-template-columns:minmax(180px,2fr) repeat(3,minmax(145px,1fr));gap:8px;margin:12px 0}.ag-charadmin-tools input,.ag-charadmin-tools select{width:100%;min-width:0;padding:10px 12px;border-radius:10px;border:1px solid rgba(255,255,255,.14);background:#111827;color:#fff}
        .ag-charadmin-stats{font-size:.82rem;opacity:.9;margin:8px 0 12px}.ag-charadmin-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:10px}.ag-charcard{position:relative;border:1px solid rgba(255,255,255,.1);background:rgba(10,14,25,.78);border-radius:12px;overflow:hidden;min-width:0}.ag-charcard>img{width:100%;height:190px;object-fit:cover;background:#0b1020;display:block}.ag-charcard.bad{border-color:rgba(255,70,100,.68)}.ag-charcard.bad>img{opacity:.22}.ag-charcard.external{border-color:rgba(246,186,73,.45)}
        .ag-charcard-copy{padding:9px}.ag-charcard-copy>b{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ag-charcard-copy>small{display:block;opacity:.67;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}.ag-charstate{position:absolute;z-index:2;top:7px;right:7px;font-size:.68rem;font-weight:900;padding:3px 6px;border-radius:999px;background:#5b6475;color:white}.ag-charcard.ok .ag-charstate{background:#118a58}.ag-charcard.bad .ag-charstate{background:#b82d48}.ag-charcard.external .ag-charstate{background:#9a6b12}
        .ag-modechips{display:flex;gap:4px;overflow:hidden;flex-wrap:wrap;max-height:42px;margin-top:6px}.ag-modechip{font-size:.58rem;padding:2px 5px;border-radius:999px;background:rgba(73,169,255,.12);border:1px solid rgba(73,169,255,.24);white-space:nowrap}.ag-charurl{margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,.09)}.ag-charurl label{display:block;font-size:.63rem;opacity:.7;margin-bottom:4px}.ag-charurl input{width:100%;box-sizing:border-box;padding:7px 8px;border-radius:7px;border:1px solid rgba(255,255,255,.16);background:#0b1020;color:#fff;font-size:.67rem}
        .ag-charcard-actions{display:grid;grid-template-columns:1fr 1fr 1fr;gap:5px;margin-top:6px}.ag-charcard-actions button,.ag-charcard-actions a{min-width:0;font-size:.65rem;padding:7px 5px;border-radius:7px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.05);color:inherit;text-decoration:none;text-align:center;cursor:pointer}.ag-charcard-actions [data-save]{background:#116b4a;font-weight:800}.ag-charcard-actions button:disabled{opacity:.5;cursor:wait}.ag-charmsg{display:block;min-height:15px;margin-top:5px;font-size:.62rem;line-height:1.2}.ag-charadmin-more{display:block;margin:14px auto 2px;padding:9px 18px}.ag-charadmin-empty{padding:25px;text-align:center;opacity:.7}
        @media(max-width:900px){.ag-charadmin-tools{grid-template-columns:1fr 1fr}.ag-charadmin-grid{grid-template-columns:repeat(auto-fill,minmax(165px,1fr))}}@media(max-width:540px){.ag-charadmin-tools{grid-template-columns:1fr}.ag-charadmin-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}.ag-charcard>img{height:155px}.ag-charcard-actions{grid-template-columns:1fr}}
        `;
        document.head.appendChild(s);
    }

    function ensure() {
        css();
        const admin = document.getElementById('admin');
        if (!admin) return setTimeout(ensure, 400);
        if (document.getElementById('ag-charadmin')) return;
        const wrap = document.createElement('div'); wrap.id='ag-charadmin'; wrap.className='opt-panel ag-charadmin';
        wrap.innerHTML = `<div class="ag-charadmin-head"><div><h2>🖼️ Tous les personnages & images</h2><p class="tl-hint" style="text-align:left;margin:3px 0">Catalogue unique de tous les personnages du site. Les images locales sont validées instantanément. Tu peux remplacer n'importe quelle image par une URL.</p></div><button id="ag-charadmin-load" class="btn-action">Afficher les personnages</button></div><div id="ag-charadmin-body" style="display:none"><div class="ag-charadmin-tools"><input id="ag-charadmin-q" type="search" autocomplete="off" placeholder="🔎 Perso ou anime…"><select id="ag-charadmin-mode"><option value="">Tous les modes</option></select><select id="ag-charadmin-anime"><option value="">Tous les anime</option></select><select id="ag-charadmin-status"><option value="">Toutes les images</option><option value="bad">Images manquantes</option><option value="external">URLs externes</option><option value="ok">Images locales / stables</option></select></div><div id="ag-charadmin-stats" class="ag-charadmin-stats"></div><div id="ag-charadmin-grid" class="ag-charadmin-grid"></div><button id="ag-charadmin-more" class="ag-charadmin-more" style="display:none">Afficher plus</button></div>`;
        admin.appendChild(wrap);
        document.getElementById('ag-charadmin-load').addEventListener('click', load);
        document.getElementById('ag-charadmin-q').addEventListener('input', apply);
        document.getElementById('ag-charadmin-mode').addEventListener('change', apply);
        document.getElementById('ag-charadmin-anime').addEventListener('change', apply);
        document.getElementById('ag-charadmin-status').addEventListener('change', apply);
        document.getElementById('ag-charadmin-more').addEventListener('click',()=>{state.page++;render(false)});
    }

    async function load() {
        const btn=document.getElementById('ag-charadmin-load');
        if (state.loaded) { document.getElementById('ag-charadmin-body').style.display=''; apply(); return; }
        btn.disabled=true; btn.textContent='Chargement…';
        try {
            const r=await fetch('/api/character-catalog',{cache:'no-store'}); const d=await r.json(); if(!r.ok||!d.ok) throw new Error(d.error||'catalogue');
            state.all=mergeCatalogue(d.characters);
            for (const x of state.all) state.status.set(keyOf(x), instantStatus(x));
            const animeSel=document.getElementById('ag-charadmin-anime');
            for(const a of [...new Set(state.all.map(x=>x.anime).filter(Boolean))].sort((a,b)=>a.localeCompare(b))){const o=document.createElement('option');o.value=a;o.textContent=a;animeSel.appendChild(o)}
            const modeSel=document.getElementById('ag-charadmin-mode');
            for(const m of [...new Set(state.all.flatMap(sourcesOf))].sort((a,b)=>prettyMode(a).localeCompare(prettyMode(b)))){const o=document.createElement('option');o.value=m;o.textContent=prettyMode(m);modeSel.appendChild(o)}
            state.loaded=true; document.getElementById('ag-charadmin-body').style.display=''; btn.textContent='Catalogue chargé'; apply();
        } catch(e) { btn.disabled=false;btn.textContent='Réessayer';document.getElementById('ag-charadmin-stats').textContent='❌ '+(e?.message||'Impossible de charger le catalogue'); }
    }

    function apply(){
        if(!state.loaded)return; const q=norm(document.getElementById('ag-charadmin-q')?.value); const anime=document.getElementById('ag-charadmin-anime')?.value||''; const mode=document.getElementById('ag-charadmin-mode')?.value||''; const wanted=document.getElementById('ag-charadmin-status')?.value||'';
        state.filtered=state.all.filter(x=>{if(anime&&x.anime!==anime)return false;if(mode&&!sourcesOf(x).includes(mode))return false;if(q&&!norm(`${x.name} ${x.anime} ${sourcesOf(x).map(prettyMode).join(' ')}`).includes(q))return false;if(wanted&&state.status.get(keyOf(x))!==wanted)return false;return true}); state.page=0; render(true);
    }

    function stats(){
        const all=state.all.length, ok=[...state.status.values()].filter(v=>v==='ok').length, bad=[...state.status.values()].filter(v=>v==='bad').length, ext=[...state.status.values()].filter(v=>v==='external').length;
        const el=document.getElementById('ag-charadmin-stats'); if(el) el.textContent=`⚡ Vérification instantanée • ${all} persos uniques • ✅ ${ok} locales/stables • 🔗 ${ext} URL externes • ❌ ${bad} manquantes • ${state.filtered.length} affichés`;
    }

    function testVisibleExternal(imgEl, x, card){
        if(state.status.get(keyOf(x))!=='external')return;
        let done=false; const finish=ok=>{if(done)return;done=true;state.status.set(keyOf(x),ok?'external':'bad');card.classList.toggle('bad',!ok);card.classList.toggle('external',ok);card.querySelector('.ag-charstate').textContent=ok?'URL':'CASSÉE';stats()};
        imgEl.addEventListener('load',()=>finish(true),{once:true}); imgEl.addEventListener('error',()=>finish(false),{once:true}); setTimeout(()=>finish(false),6000);
    }

    function render(reset){
        const grid=document.getElementById('ag-charadmin-grid');if(!grid)return;if(reset)grid.innerHTML=''; const start=reset?0:Math.max(0,state.page*PAGE), end=Math.min(state.filtered.length,(state.page+1)*PAGE); if(reset&&state.filtered.length===0)grid.innerHTML='<div class="ag-charadmin-empty">Aucun personnage.</div>';
        for(const x of state.filtered.slice(start,end)){
            const k=keyOf(x), st=state.status.get(k)||instantStatus(x), url=imageOf(x), modes=sourcesOf(x); const card=document.createElement('div');card.className=`ag-charcard ${st}`; card.dataset.key=k;
            card.innerHTML=`<span class="ag-charstate">${st==='ok'?'OK':st==='external'?'URL':'CASSÉE'}</span><img loading="lazy" referrerpolicy="no-referrer" src="${esc(url)}" alt="${esc(x.name)}"><div class="ag-charcard-copy"><b title="${esc(x.name)}">${esc(x.name)}</b><small>${esc(x.anime||x.u||'')}</small><div class="ag-modechips">${modes.slice(0,5).map(m=>`<span class="ag-modechip">${esc(prettyMode(m))}</span>`).join('')}</div><div class="ag-charurl"><label>URL de l'image</label><input data-url value="${esc(url)}" placeholder="https://…"></div><div class="ag-charcard-actions"><button data-save>Enregistrer</button><button data-copy>Copier</button><a data-open href="${esc(url||'#')}" target="_blank" rel="noopener noreferrer">Ouvrir</a></div><span class="ag-charmsg"></span></div>`;
            grid.appendChild(card); const img=card.querySelector('img'); testVisibleExternal(img,x,card);
            card.querySelector('[data-copy]').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(card.querySelector('[data-url]').value||'')}catch(_){}});
            card.querySelector('[data-url]').addEventListener('input',e=>{card.querySelector('[data-open]').href=e.target.value||'#'});
            card.querySelector('[data-save]').addEventListener('click',()=>saveUrl(x,card));
        }
        const more=document.getElementById('ag-charadmin-more');more.style.display=end<state.filtered.length?'':'none'; stats();
    }

    async function validateImageUrl(url){
        return await new Promise(resolve=>{let settled=false;const im=new Image();const done=v=>{if(settled)return;settled=true;clearTimeout(t);resolve(v)};const t=setTimeout(()=>done(false),6500);im.onload=()=>done(im.naturalWidth>0&&im.naturalHeight>0);im.onerror=()=>done(false);im.referrerPolicy='no-referrer';im.src=url});
    }

    async function saveUrl(x,card){
        const input=card.querySelector('[data-url]'), btn=card.querySelector('[data-save]'), msg=card.querySelector('.ag-charmsg'), url=String(input.value||'').trim();
        if(!/^https:\/\/\S+$/i.test(url)){msg.textContent='❌ URL https:// obligatoire';return}
        btn.disabled=true;msg.textContent='⚡ Vérification…';
        const valid=await validateImageUrl(url); if(!valid){btn.disabled=false;msg.textContent='❌ Cette image ne charge pas';return}
        msg.textContent='💾 Sauvegarde…';
        try{const r=await fetch('/api/admin/character-image',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({universe:x.u||x.universe,name:x.name,imageUrl:url})});const d=await r.json().catch(()=>({}));if(!r.ok||!d.ok)throw new Error(d.error||'sauvegarde');x.img=url;x.originalImg=url;state.status.set(keyOf(x),'external');card.classList.remove('bad','ok');card.classList.add('external');card.querySelector('img').src=url;card.querySelector('.ag-charstate').textContent='URL';msg.textContent='✅ Sauvegardée définitivement';stats()}catch(e){msg.textContent='❌ '+(e?.message||'Erreur')}finally{btn.disabled=false}
    }

    ensure();
})();'''

ui = ui[:start] + block + ui[end:]
UI.write_text(ui, encoding='utf-8')
print('Installed Admin character viewer v5')
