#!/usr/bin/env node
'use strict';
/* AG_BACKUP_V1 — remettre une sauvegarde dans une base Postgres VIDE.
   Usage : node restore-backup.js <fichier.agbak.gz> <adresse postgres de la base vide> */
const { Pool } = require('pg');
const { restoreBackup } = require('./db-backup');

(async () => {
    const [file, url] = process.argv.slice(2);
    if (!file || !url) { console.error('Usage : node restore-backup.js <fichier.agbak.gz> <postgres://…>'); process.exit(1); }
    const local = /@(localhost|127\.|[^.:/]+[:/])/.test(url) || /sslmode=disable/.test(url);
    const pool = new Pool({ connectionString: url, ssl: local ? false : { rejectUnauthorized: false }, max: 2 });
    try {
        const counts = await restoreBackup({ pool, file, onProgress: m => console.log('…', m) });
        console.log('✅ Restauration terminée :', Object.entries(counts).map(([t, n]) => `${t}=${n}`).join(', '));
    } catch (e) { console.error('❌', e.message); process.exitCode = 1; }
    finally { await pool.end(); }
})();
