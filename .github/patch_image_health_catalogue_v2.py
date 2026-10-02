from pathlib import Path

p=Path('server.js')
s=p.read_text(encoding='utf-8')

old="""        const totals=(await pool.query(`
            SELECT count(*)::int AS rows,
                   sum(CASE WHEN image_bytes IS NOT NULL AND octet_length(image_bytes)>=700 THEN 1 ELSE 0 END)::int AS with_bytes,
                   sum(CASE WHEN status='manual-admin' THEN 1 ELSE 0 END)::int AS manual
            FROM character_images
        `)).rows[0] || {};
        res.setHeader('Cache-Control','no-store');
        return res.json({ok:true,db:true,state,totals,counts,missingCount:Math.max(0,Number(totals.rows||0)-Number(totals.with_bytes||0)),missing});
"""
new="""        const totals=(await pool.query(`
            SELECT count(*)::int AS rows,
                   sum(CASE WHEN image_bytes IS NOT NULL AND octet_length(image_bytes)>=700 THEN 1 ELSE 0 END)::int AS with_bytes,
                   sum(CASE WHEN status='manual-admin' THEN 1 ELSE 0 END)::int AS manual
            FROM character_images
        `)).rows[0] || {};

        // CHARACTER_IMAGE_HEALTH_CATALOGUE_V2 — compare the real migration catalogue
        // against persisted bytes, including characters which do not have a DB row yet.
        let catalogue=[];
        try { catalogue=await simpleCatalogue(); } catch (_) { catalogue=[]; }
        const storedRows=(await pool.query(`
            SELECT universe_key,norm_name,status
            FROM character_images
            WHERE image_bytes IS NOT NULL AND octet_length(image_bytes)>=700
        `)).rows;
        const have=new Set(storedRows.map(x=>`${x.universe_key}|${x.norm_name}`));
        const catalogueMissing=[];
        for (const x of catalogue) {
            const key=`${x.u}|${normalizeImageKey(x.name)}`;
            if (have.has(key)) continue;
            catalogueMissing.push({
                u:x.u,
                name:x.name,
                anime:x.anime || '',
                sources:Array.isArray(x.sources) ? x.sources.slice(0,8) : [],
                originalImg:String(x.img || '').slice(0,1200)
            });
        }
        res.setHeader('Cache-Control','no-store');
        return res.json({
            ok:true,db:true,state,totals,counts,
            missingCount:Math.max(0,Number(totals.rows||0)-Number(totals.with_bytes||0)),
            missing,
            catalogueTotal:catalogue.length,
            catalogueStored:Math.max(0,catalogue.length-catalogueMissing.length),
            catalogueMissingCount:catalogueMissing.length,
            catalogueMissing:catalogueMissing.slice(0,2000)
        });
"""
if old in s:
    s=s.replace(old,new,1)
elif 'CHARACTER_IMAGE_HEALTH_CATALOGUE_V2' not in s:
    raise SystemExit('health totals block not found')

p.write_text(s,encoding='utf-8')
print('catalogue health v2:', 'CHARACTER_IMAGE_HEALTH_CATALOGUE_V2' in s)
