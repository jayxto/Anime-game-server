from pathlib import Path

p=Path('server.js')
s=p.read_text(encoding='utf-8')

marker='SIMPLE_CATALOGUE_CANONICAL_UNIVERSES_V2'
if marker not in s:
    needle="""        u = String(u || '').trim();
        if (!u && anime) {
            try { u = resolveImageUniverseKey(anime) || ''; } catch (_) {}
        }
        if (!u || !name) return;
"""
    repl="""        u = String(u || '').trim();
        if (!u && anime) {
            try { u = resolveImageUniverseKey(anime) || ''; } catch (_) {}
        }
        // SIMPLE_CATALOGUE_CANONICAL_UNIVERSES_V2 — merge legacy ids into the live ARC ids.
        if (u === 'fate') u = 'fatestay';
        if (u === 'soul') u = 'souleater';
        if (!u || !name) return;
"""
    if needle not in s:
        raise SystemExit('simpleCatalogue add() anchor not found')
    s=s.replace(needle,repl,1)

health_marker='CHARACTER_IMAGE_HEALTH_V1'
if health_marker not in s:
    anchor="""app.get('/api/admin/character-images/status', adminOnly(async (req, res) => {
    res.json({ ok:true, state:SIMPLE_IMAGE_STATE });
}));
"""
    if anchor not in s:
        raise SystemExit('admin character image status anchor not found')
    route=r'''/* CHARACTER_IMAGE_HEALTH_V1
   Read-only operational health for public game assets. No admin/session/user data is exposed. */
app.get('/api/character-image-health', async (req, res) => {
    const state = {
        running:!!SIMPLE_IMAGE_STATE?.running,
        done:!!SIMPLE_IMAGE_STATE?.done,
        total:Number(SIMPLE_IMAGE_STATE?.total || 0),
        current:Number(SIMPLE_IMAGE_STATE?.current || 0),
        saved:Number(SIMPLE_IMAGE_STATE?.saved || 0),
        missing:Number(SIMPLE_IMAGE_STATE?.missing || 0)
    };
    if (!HAS_DB) return res.json({ok:true,db:false,state,counts:[],missing:[]});
    try {
        const counts=(await pool.query(`
            SELECT COALESCE(status,'') AS status,
                   count(*)::int AS n,
                   sum(CASE WHEN image_bytes IS NOT NULL AND octet_length(image_bytes)>=700 THEN 1 ELSE 0 END)::int AS with_bytes
            FROM character_images
            GROUP BY COALESCE(status,'')
            ORDER BY n DESC
        `)).rows;
        const missing=(await pool.query(`
            SELECT universe_key,display_name,COALESCE(status,'') AS status
            FROM character_images
            WHERE image_bytes IS NULL OR octet_length(image_bytes)<700
            ORDER BY universe_key,display_name
            LIMIT 500
        `)).rows.map(x=>({u:x.universe_key,name:x.display_name,status:x.status}));
        const totals=(await pool.query(`
            SELECT count(*)::int AS rows,
                   sum(CASE WHEN image_bytes IS NOT NULL AND octet_length(image_bytes)>=700 THEN 1 ELSE 0 END)::int AS with_bytes,
                   sum(CASE WHEN status='manual-admin' THEN 1 ELSE 0 END)::int AS manual
            FROM character_images
        `)).rows[0] || {};
        res.setHeader('Cache-Control','no-store');
        return res.json({ok:true,db:true,state,totals,counts,missingCount:Math.max(0,Number(totals.rows||0)-Number(totals.with_bytes||0)),missing});
    } catch (e) {
        console.error('[character image health]',e);
        return res.status(500).json({ok:false,error:'health query failed'});
    }
});

'''
    s=s.replace(anchor,route+anchor,1)

p.write_text(s,encoding='utf-8')
print('canonical marker:', marker in s)
print('health marker:', health_marker in s)
