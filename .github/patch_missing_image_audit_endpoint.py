from pathlib import Path

p=Path('server.js')
s=p.read_text(encoding='utf-8')
marker='AG_FULL_MISSING_IMAGE_AUDIT_V1'
if marker not in s:
    anchor="app.get('/api/image-migration-status', async (req,res)=>{\n    return res.json({ok:true,...SIMPLE_IMAGE_STATE});\n});"
    pos=s.find(anchor)
    if pos<0:
        raise SystemExit('migration status endpoint anchor not found')
    insert=anchor+r'''

/* AG_FULL_MISSING_IMAGE_AUDIT_V1
   Public audit data contains only character names/universe labels already exposed
   by the catalogue. It compares the catalogue to durable PostgreSQL image bytes. */
app.get('/api/character-image-missing-list', async (req,res)=>{
    try {
        const chars=await simpleCatalogue();
        const rows=await simpleExistingRows();
        const missing=[];
        for (const x of chars) {
            const k=`${x.u}|${normalizeImageKey(x.name)}`;
            if (rows.get(k)?.has_bytes) continue;
            missing.push({u:x.u,anime:x.anime||ARC_UNIVERSE_ANIME?.[x.u]||x.u,name:x.name});
        }
        res.setHeader('Cache-Control','no-store, no-cache, must-revalidate');
        return res.json({
            ok:true,
            persistent:true,
            total:chars.length,
            stored:chars.length-missing.length,
            missingCount:missing.length,
            missing
        });
    } catch (e) {
        console.error('[image missing audit]',e);
        return res.status(500).json({ok:false,error:String(e?.message||e)});
    }
});'''
    s=s[:pos]+insert+s[pos+len(anchor):]

# Keep enough final unresolved names in the migration status too.
s=s.replace("SIMPLE_IMAGE_STATE.failed = finalMissing.slice(0,80).map(x=>({u:x.u,anime:x.anime,name:x.name}));",
            "SIMPLE_IMAGE_STATE.failed = finalMissing.slice(0,1500).map(x=>({u:x.u,anime:x.anime,name:x.name}));")

p.write_text(s,encoding='utf-8')
print('marker:',marker in s)
print('full failed list:', 'slice(0,1500)' in s)
