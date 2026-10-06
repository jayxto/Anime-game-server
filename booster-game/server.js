// Serveur statique d'Anime Boosters : node server.js  (PORT=3000 par défaut)
const http = require('http');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
http.createServer((req, res) => {
    const p = path.normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^([/\\]\.\.)+/, '');
    const file = path.join(ROOT, p === '/' || p === '\\' ? 'index.html' : p);
    if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, buf) => {
        if (err) { res.writeHead(404); return res.end('Introuvable'); }
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
        res.end(buf);
    });
}).listen(process.env.PORT || 3000, () => console.log('Anime Boosters sur le port', process.env.PORT || 3000));
