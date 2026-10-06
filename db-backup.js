'use strict';
/* AG_BACKUP_V1 — sauvegarde complète de la base Postgres dans un fichier .agbak.gz
   (une ligne JSON par élément : tables, colonnes, contraintes, lignes, index, compteurs).
   Sert au serveur (sauvegardes automatiques) et à restore-backup.js (remise en place dans une base vide). */
const fs = require('fs');
const zlib = require('zlib');
const readline = require('readline');

const qi = n => '"' + String(n).replace(/"/g, '""') + '"';
const isTime = t => /^(timestamp|time|date|interval)/.test(t);
const tick = () => new Promise(r => setImmediate(r));

async function tableMeta(pool, t) {
    const cols = (await pool.query(`SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull AS nn, pg_get_expr(d.adbin, d.adrelid) AS def, a.attidentity AS ident
        FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE a.attrelid = ('public.' || quote_ident($1))::regclass AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum`, [t])).rows;
    const cons = (await pool.query(`SELECT conname, contype, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = ('public.' || quote_ident($1))::regclass ORDER BY contype`, [t])).rows;
    return { cols, cons };
}

/* opts : { pool, file, skipBytes (ne garde pas les colonnes bytea), onProgress(msg) } */
async function createBackup({ pool, file, skipBytes = false, onProgress = () => {} }) {
    const tmp = file + '.part';
    const gz = zlib.createGzip({ level: skipBytes ? 6 : 1 });
    const out = fs.createWriteStream(tmp);
    gz.pipe(out);
    const done = new Promise((res, rej) => { out.on('finish', res); out.on('error', rej); gz.on('error', rej); });
    const write = obj => new Promise(r => (gz.write(JSON.stringify(obj) + '\n') ? r() : gz.once('drain', r)));
    let rowsTotal = 0;
    try {
        await write({ k: 'head', v: 1, at: new Date().toISOString(), skipBytes });
        const seqs = (await pool.query(`SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema = 'public'`)).rows.map(r => r.sequence_name);
        await write({ k: 'seqs', names: seqs });
        const tables = (await pool.query(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY c.relname`)).rows.map(r => r.relname);
        for (const t of tables) {
            const { cols, cons } = await tableMeta(pool, t);
            await write({ k: 'table', name: t, cols, cons });
            const heavy = cols.some(c => /bytea/.test(c.type)), batch = heavy && !skipBytes ? 25 : 500;
            const sel = cols.map(c => (skipBytes && /bytea/.test(c.type)) ? `NULL AS ${qi(c.name)}` : isTime(c.type) ? `${qi(c.name)}::text AS ${qi(c.name)}` : qi(c.name)).join(', ');
            const n = (await pool.query(`SELECT count(*)::int AS n FROM ${qi(t)}`)).rows[0].n;
            for (let off = 0; off < n; off += batch) {
                onProgress(`${t} : ${Math.min(off + batch, n)} / ${n}`);
                const rows = (await pool.query(`SELECT ${sel} FROM ${qi(t)} ORDER BY ctid LIMIT ${batch} OFFSET ${off}`)).rows;
                if (!rows.length) break;
                for (const r of rows) {
                    await write({ k: 'row', t, v: cols.map(c => { const x = r[c.name]; return Buffer.isBuffer(x) ? { $b: x.toString('base64') } : x; }) });
                    rowsTotal++;
                }
                await tick(); // laisse respirer le serveur pendant la sauvegarde
            }
        }
        const consNames = new Set((await pool.query(`SELECT conname FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = 'public'`)).rows.map(r => r.conname));
        const idx = (await pool.query(`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public'`)).rows.filter(r => !consNames.has(r.indexname));
        await write({ k: 'indexes', list: idx });
        const seqVals = [];
        for (const s of seqs) { try { const r = (await pool.query(`SELECT last_value::text AS v, is_called FROM ${qi(s)}`)).rows[0]; seqVals.push({ name: s, v: r.v, called: r.is_called }); } catch (_) {} }
        await write({ k: 'seqvals', list: seqVals });
        await write({ k: 'end', rows: rowsTotal, tables: tables.length });
        gz.end();
        await done;
        fs.renameSync(tmp, file);
        return { rows: rowsTotal, tables: tables.length, bytes: fs.statSync(file).size };
    } catch (e) {
        try { gz.destroy(); out.destroy(); fs.rmSync(tmp, { force: true }); } catch (_) {}
        throw e;
    }
}

/* Remet une sauvegarde dans une base VIDE. */
async function restoreBackup({ pool, file, onProgress = () => {} }) {
    const existing = (await pool.query(`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'`)).rows[0].n;
    if (existing) throw new Error(`La base cible n’est pas vide (${existing} tables).`);
    const rl = readline.createInterface({ input: fs.createReadStream(file).pipe(zlib.createGunzip()), crlfDelay: Infinity });
    const meta = {}, fks = [], counts = {};
    let buf = [], cur = null, ended = false;
    const flush = async () => {
        if (!buf.length) return;
        const m = meta[cur], cols = m.cols, ph = [], vals = [];
        const override = cols.some(c => c.ident === 'a') ? ' OVERRIDING SYSTEM VALUE' : '';
        buf.forEach((v, ri) => { ph.push('(' + cols.map((c, ci) => '$' + (ri * cols.length + ci + 1)).join(', ') + ')'); v.forEach((x, ci) => vals.push(x && typeof x === 'object' && x.$b !== undefined ? Buffer.from(x.$b, 'base64') : (x != null && /^jsonb?$/.test(cols[ci].type) ? JSON.stringify(x) : x))); });
        await pool.query(`INSERT INTO ${qi(cur)} (${cols.map(c => qi(c.name)).join(', ')})${override} VALUES ${ph.join(', ')}`, vals);
        counts[cur] = (counts[cur] || 0) + buf.length; buf = [];
    };
    for await (const line of rl) {
        if (!line) continue;
        const o = JSON.parse(line);
        if (o.k === 'seqs') { for (const s of o.names) await pool.query(`CREATE SEQUENCE IF NOT EXISTS ${qi(s)}`); }
        else if (o.k === 'table') {
            await flush(); cur = o.name; meta[cur] = o; counts[cur] = 0;
            onProgress(`table ${cur}`);
            const defs = o.cols.map(c => `${qi(c.name)} ${c.type}${c.ident === 'a' ? ' GENERATED ALWAYS AS IDENTITY' : c.ident === 'd' ? ' GENERATED BY DEFAULT AS IDENTITY' : c.def ? ' DEFAULT ' + c.def : ''}${c.nn ? ' NOT NULL' : ''}`);
            await pool.query(`CREATE TABLE ${qi(cur)} (${defs.join(', ')})`);
            for (const c of o.cons) { if (c.contype === 'f') fks.push([cur, c]); else if (['p', 'u', 'c', 'x'].includes(c.contype)) await pool.query(`ALTER TABLE ${qi(cur)} ADD CONSTRAINT ${qi(c.conname)} ${c.def}`); }
        }
        else if (o.k === 'row') { buf.push(o.v); if (buf.length >= (meta[cur].cols.some(c => /bytea/.test(c.type)) ? 25 : 300)) await flush(); }
        else if (o.k === 'indexes') {
            await flush();
            onProgress('index et liens');
            for (const [t, c] of fks) await pool.query(`ALTER TABLE ${qi(t)} ADD CONSTRAINT ${qi(c.conname)} ${c.def}`).catch(e => console.warn('[restauration] lien', c.conname, e.message));
            for (const r of o.list) await pool.query(r.indexdef.replace(/^CREATE (UNIQUE )?INDEX /, 'CREATE $1INDEX IF NOT EXISTS ')).catch(e => console.warn('[restauration] index', r.indexname, e.message));
        }
        else if (o.k === 'seqvals') { for (const s of o.list) await pool.query(`SELECT setval($1, $2, $3)`, [s.name, s.v, s.called]).catch(() => {}); }
        else if (o.k === 'end') ended = true;
    }
    await flush();
    if (!ended) throw new Error('Sauvegarde incomplète (fichier coupé).');
    return counts;
}

module.exports = { createBackup, restoreBackup };
