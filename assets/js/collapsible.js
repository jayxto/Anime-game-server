/* ===== OPTIONS / ADMIN : catégories repliables ===== */
(function(){
    const norm=s=>String(s||'').replace(/\s+/g,' ').trim().toLowerCase().replace(/[^a-z0-9à-ÿ]+/gi,'-').slice(0,80);
    function make(panel,scope){
        if(!panel||panel.dataset.optCollapseReady==='1')return;
        const h=[...panel.children].find(x=>x.tagName==='H2'); if(!h)return;
        panel.dataset.optCollapseReady='1';
        h.classList.add('opt-collapse-head');
        const title=(h.textContent||'section').trim();
        const key='animegame:collapse:v3:'+scope+':'+(panel.id||norm(title));
        const body=document.createElement('div'); body.className='opt-collapse-body';
        let n=h.nextSibling; while(n){const next=n.nextSibling; body.appendChild(n); n=next;}
        panel.appendChild(body);
        const b=document.createElement('button'); b.type='button'; b.className='opt-collapse-btn'; b.setAttribute('aria-label','Réduire ou ouvrir '+title); h.appendChild(b);
        let collapsed=false; try{collapsed=localStorage.getItem(key)==='1';}catch(_){}
        const apply=()=>{panel.classList.toggle('opt-collapsed',collapsed);b.textContent=collapsed?'▶':'▼';b.title=collapsed?'Ouvrir la catégorie':'Réduire la catégorie';b.setAttribute('aria-expanded',collapsed?'false':'true');};
        b.onclick=e=>{e.preventDefault();e.stopPropagation();collapsed=!collapsed;try{localStorage.setItem(key,collapsed?'1':'0');}catch(_){}apply();};
        apply();
    }
    function scan(){
        const opts=document.getElementById('options');
        if(opts)[...opts.children].filter(x=>x.nodeType===1&&[...x.children].some(c=>c.tagName==='H2')).forEach(x=>make(x,'options'));
        const adm=document.getElementById('admin');
        if(adm)adm.querySelectorAll('.opt-panel').forEach(x=>make(x,'admin'));
    }
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',scan);else scan();
    const obs=new MutationObserver(()=>scan()); if(document.body)obs.observe(document.body,{childList:true,subtree:true});
})();
