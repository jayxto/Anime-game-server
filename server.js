const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(__dirname));

app.get('/api/music-tracks', (req, res) => {
    try {
        const musicDir = path.join(__dirname, 'music');
        if (!fs.existsSync(musicDir)) {
            return res.json({ ok:true, tracks:[], count:0, missingFolder:true });
        }

        const files = fs.readdirSync(musicDir)
            .filter(name => /^track_\d{3}\.mp3$/i.test(name))
            .sort((a,b) => a.localeCompare(b, undefined, { numeric:true }));

        res.json({
            ok:true,
            count:files.length,
            tracks:files.map(name => `/music/${name}`)
        });
    } catch (e) {
        res.status(500).json({ ok:false, tracks:[], count:0, error:e.message });
    }
});


/* ================= Comptes utilisateurs (Postgres + JWT) ================= */
// La base vit en dehors de Render (Neon / Supabase / etc.) via DATABASE_URL,
// donc les comptes et le rating survivent aux redéploiements et aux mises en veille.

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret-in-production';
const JWT_EXPIRES_IN = '30d';

if (!process.env.DATABASE_URL) {
    console.warn("⚠️  Aucune variable DATABASE_URL définie : configure-la avec ta connection string Postgres (Neon/Supabase) pour que les comptes soient persistés.");
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

async function initDb() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            pseudo TEXT UNIQUE NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            rating INTEGER NOT NULL DEFAULT 1000,
            wins INTEGER NOT NULL DEFAULT 0,
            losses INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS dle_profiles (
            universe_key TEXT NOT NULL,
            norm_name TEXT NOT NULL,
            display_name TEXT NOT NULL,
            attrs JSONB NOT NULL,
            source TEXT NOT NULL DEFAULT 'fandom',
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (universe_key, norm_name)
        );
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS character_images (
            universe_key TEXT NOT NULL,
            norm_name TEXT NOT NULL,
            display_name TEXT NOT NULL,
            image_url TEXT,
            source_url TEXT,
            status TEXT NOT NULL DEFAULT 'ok',
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (universe_key, norm_name)
        );
    `);
}

initDb()
    .then(() => console.log("Base de données prête (table 'users' OK)."))
    .catch(err => {
        console.error("Erreur d'initialisation de la base de données :", err);
    });


/* ================= Images personnages — Fandom automatique =================
   Aucun lien à remplir à la main :
   - première apparition d'un perso -> recherche de son image principale sur Fandom
   - URL + page source mises en cache en mémoire et dans Postgres
   - les appels suivants réutilisent directement le cache
============================================================================ */

const FANDOM_WIKIS = {
    naruto: 'naruto.fandom.com',
    onepiece: 'onepiece.fandom.com',
    bleach: 'bleach.fandom.com',
    hxh: 'hunterxhunter.fandom.com',
    snk: 'attackontitan.fandom.com',
    sds: 'nanatsu-no-taizai.fandom.com',
    deathnote: 'deathnote.fandom.com',
    cote: 'you-zitsu.fandom.com',
    solo: 'solo-leveling.fandom.com',
    clover: 'blackclover.fandom.com',
    fireforce: 'fire-force.fandom.com',
    mushoku: 'mushokutensei.fandom.com',
    rezero: 'rezero.fandom.com',
    fairy: 'fairytail.fandom.com',
    bluelock: 'bluelock.fandom.com',
    fma: 'fma.fandom.com',
    chainsaw: 'chainsaw-man.fandom.com',
    wakfu: 'wakfu.fandom.com',
    demonslayer: 'kimetsu-no-yaiba.fandom.com',
    pokemon: 'pokemon.fandom.com',
    dragonball: 'dragonball.fandom.com',
    hellsparadise: 'jigokuraku.fandom.com',
    gachiakuta: 'gachiakuta.fandom.com',
    haikyuu: 'haikyuu.fandom.com',
    jjk: 'jujutsu-kaisen.fandom.com',
    jojo: 'jojo.fandom.com',
    tensura: 'tensura.fandom.com',
    opm: 'onepunchman.fandom.com',
    sao: 'swordartonline.fandom.com',
    tokyoghoul: 'tokyoghoul.fandom.com',
    tokyorevengers: 'tokyorevengers.fandom.com'
};

const FANDOM_UNIVERSE_ALIASES = {
    'naruto':'naruto',
    'one piece':'onepiece',
    'bleach':'bleach',
    'hunter x hunter':'hxh',
    "snk":"snk",
    "snk / l'attaque des titans":"snk",
    "l'attaque des titans":"snk",
    "attack on titan":"snk",
    'seven deadly sins':'sds',
    'death note':'deathnote',
    'classroom of the elite':'cote',
    'solo leveling':'solo',
    'black clover':'clover',
    'fire force':'fireforce',
    'mushoku tensei':'mushoku',
    're:zero':'rezero',
    'rezero':'rezero',
    'fairy tail':'fairy',
    'blue lock':'bluelock',
    'fullmetal alchemist':'fma',
    'chainsaw man':'chainsaw',
    'wakfu':'wakfu',
    'demon slayer':'demonslayer',
    'pokemon':'pokemon',
    'pokémon':'pokemon',
    'dragon ball':'dragonball',
    "hell's paradise":'hellsparadise',
    'gachiakuta':'gachiakuta',
    'haikyuu':'haikyuu',
    'jujutsu kaisen':'jjk',
    'jjk':'jjk',
    "jojo's bizarre adventure":'jojo',
    'jojo':'jojo',
    'tensura':'tensura',
    'one punch man':'opm',
    'sword art online':'sao',
    'sao':'sao',
    'tokyo ghoul':'tokyoghoul',
    'tokyo revengers':'tokyorevengers'
};

const CHARACTER_IMAGE_CACHE = new Map();
const CHARACTER_IMAGE_INFLIGHT = new Map();

function normalizeImageKey(value) {
    return String(value || '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[’`]/g, "'")
        .replace(/[^a-z0-9']+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function resolveImageUniverseKey(rawUniverse) {
    const raw = String(rawUniverse || '').trim();
    if (FANDOM_WIKIS[raw]) return raw;
    return FANDOM_UNIVERSE_ALIASES[normalizeImageKey(raw)] || null;
}

function cleanImageCharacterName(name) {
    return String(name || '')
        .replace(/\s+\((?:adult|young|child|anime|manga|movie|film)\)\s*$/i, '')
        .trim();
}

function parseCharacterLabelForImage(label) {
    const s = String(label || '').trim();
    if (!s) return { name:'', universe:null };

    if (s.endsWith(')')) {
        const i = s.lastIndexOf(' (');
        if (i > 0) {
            return {
                name: s.slice(0, i).trim(),
                universe: s.slice(i + 2, -1).trim()
            };
        }
    }
    return { name:s, universe:null };
}

async function getCachedCharacterImage(universeKey, displayName) {
    const normName = normalizeImageKey(displayName);
    const cacheKey = `${universeKey}|${normName}`;

    if (CHARACTER_IMAGE_CACHE.has(cacheKey)) {
        return CHARACTER_IMAGE_CACHE.get(cacheKey);
    }

    if (!process.env.DATABASE_URL) return null;
    try {
        const result = await pool.query(
            `SELECT image_url, source_url, status
             FROM character_images
             WHERE universe_key=$1 AND norm_name=$2
             LIMIT 1`,
            [universeKey, normName]
        );
        if (!result.rows.length) return null;
        const row = result.rows[0];
        const data = {
            imageUrl: row.image_url || null,
            sourceUrl: row.source_url || null,
            status: row.status || 'missing'
        };
        CHARACTER_IMAGE_CACHE.set(cacheKey, data);
        return data;
    } catch (e) {
        return null;
    }
}

async function saveCachedCharacterImage(universeKey, displayName, data) {
    const normName = normalizeImageKey(displayName);
    const cacheKey = `${universeKey}|${normName}`;
    CHARACTER_IMAGE_CACHE.set(cacheKey, data);

    if (!process.env.DATABASE_URL) return;
    try {
        await pool.query(`
            INSERT INTO character_images
                (universe_key, norm_name, display_name, image_url, source_url, status, updated_at)
            VALUES ($1,$2,$3,$4,$5,$6,now())
            ON CONFLICT (universe_key, norm_name)
            DO UPDATE SET
                display_name=EXCLUDED.display_name,
                image_url=EXCLUDED.image_url,
                source_url=EXCLUDED.source_url,
                status=EXCLUDED.status,
                updated_at=now()
        `, [
            universeKey,
            normName,
            displayName,
            data.imageUrl || null,
            data.sourceUrl || null,
            data.status || 'missing'
        ]);
    } catch (e) {
        console.warn('[Fandom image] cache DB impossible:', e.message);
    }
}

function pageImageFromApiPage(page) {
    if (!page || page.missing != null) return null;
    const imageUrl = page.original?.source || page.thumbnail?.source || null;
    if (!imageUrl) return null;
    return {
        imageUrl,
        sourceUrl: page.fullurl || null,
        title: page.title || null
    };
}

function fandomPageScore(page, wantedName) {
    const wanted = normalizeImageKey(wantedName);
    const title = normalizeImageKey(page?.title || '');
    if (!title) return -999;
    let score = 0;
    if (title === wanted) score += 100;
    if (title.includes(wanted) || wanted.includes(title)) score += 45;

    const wantedTokens = new Set(wanted.split(' ').filter(Boolean));
    const titleTokens = new Set(title.split(' ').filter(Boolean));
    let overlap = 0;
    wantedTokens.forEach(t => { if (titleTokens.has(t)) overlap++; });
    score += overlap * 8;

    if (/gallery|image gallery|images|list of|category|episode|chapter|volume/i.test(page?.title || '')) score -= 45;
    return score;
}

async function fetchFandomPageImageByExactTitle(host, title) {
    const params = new URLSearchParams({
        action: 'query',
        titles: title,
        prop: 'pageimages|info',
        piprop: 'original|thumbnail',
        pithumbsize: '700',
        inprop: 'url',
        redirects: '1',
        format: 'json',
        origin: '*'
    });
    const data = await fetchJsonWithTimeout(`https://${host}/api.php?${params}`, 12000);
    const pages = Object.values(data?.query?.pages || {});
    for (const page of pages) {
        const hit = pageImageFromApiPage(page);
        if (hit) return hit;
    }
    return null;
}

async function fetchFandomPageImageBySearch(host, name) {
    const params = new URLSearchParams({
        action: 'query',
        generator: 'search',
        gsrsearch: name,
        gsrnamespace: '0',
        gsrlimit: '8',
        prop: 'pageimages|info',
        piprop: 'original|thumbnail',
        pithumbsize: '700',
        inprop: 'url',
        format: 'json',
        origin: '*'
    });
    const data = await fetchJsonWithTimeout(`https://${host}/api.php?${params}`, 12000);
    const pages = Object.values(data?.query?.pages || {})
        .filter(p => pageImageFromApiPage(p))
        .sort((a,b) => fandomPageScore(b, name) - fandomPageScore(a, name));

    return pages.length ? pageImageFromApiPage(pages[0]) : null;
}

async function resolveCharacterImage(universeKey, displayName) {
    const host = FANDOM_WIKIS[universeKey];
    if (!host || !displayName) {
        return { imageUrl:null, sourceUrl:null, status:'unsupported' };
    }

    const cleanName = cleanImageCharacterName(displayName);
    const cacheKey = `${universeKey}|${normalizeImageKey(cleanName)}`;

    const cached = await getCachedCharacterImage(universeKey, cleanName);
    // Un "ok" est permanent. Un missing de plus de 7 jours peut être retenté côté DB
    // lors d'un futur nettoyage; ici on évite de spammer Fandom.
    if (cached) return cached;

    if (CHARACTER_IMAGE_INFLIGHT.has(cacheKey)) {
        return CHARACTER_IMAGE_INFLIGHT.get(cacheKey);
    }

    const task = (async () => {
        try {
            // Les alias DLE servent aussi pour les recherches d'images.
            let searchName = cleanName;
            try {
                const n = normalizeImageKey(cleanName);
                const alias = typeof DLE_MASTER_ALIASES !== 'undefined'
                    ? DLE_MASTER_ALIASES[universeKey]?.[n]
                    : null;
                if (alias && typeof DLE_MASTER_NAMES !== 'undefined') {
                    const found = (DLE_MASTER_NAMES[universeKey] || [])
                        .find(x => normalizeImageKey(x) === alias);
                    if (found) searchName = found;
                }
            } catch (_) {}

            let hit = await fetchFandomPageImageByExactTitle(host, searchName);
            if (!hit) hit = await fetchFandomPageImageBySearch(host, searchName);

            const result = hit
                ? { imageUrl:hit.imageUrl, sourceUrl:hit.sourceUrl, status:'ok' }
                : { imageUrl:null, sourceUrl:null, status:'missing' };

            await saveCachedCharacterImage(universeKey, cleanName, result);
            return result;
        } catch (e) {
            console.warn(`[Fandom image] ${universeKey}/${cleanName}:`, e.message);
            return { imageUrl:null, sourceUrl:null, status:'error' };
        } finally {
            CHARACTER_IMAGE_INFLIGHT.delete(cacheKey);
        }
    })();

    CHARACTER_IMAGE_INFLIGHT.set(cacheKey, task);
    return task;
}

app.get('/api/character-image', async (req, res) => {
    const rawUniverse = String(req.query.universeKey || req.query.universe || '').trim();
    const name = String(req.query.name || '').trim();

    if (!rawUniverse || !name) {
        return res.status(400).json({ ok:false, imageUrl:null, message:'universe/name requis' });
    }

    const universeKey = resolveImageUniverseKey(rawUniverse);
    if (!universeKey) {
        return res.json({ ok:false, imageUrl:null, status:'unsupported' });
    }

    const result = await resolveCharacterImage(universeKey, name);
    res.json({
        ok: !!result.imageUrl,
        universeKey,
        name,
        imageUrl: result.imageUrl,
        sourceUrl: result.sourceUrl,
        status: result.status
    });
});

app.get('/api/character-image-stats', async (req, res) => {
    if (!process.env.DATABASE_URL) {
        return res.json({ cachedInMemory:CHARACTER_IMAGE_CACHE.size, persistent:false });
    }
    try {
        const result = await pool.query(`
            SELECT
                COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE status='ok')::int AS ok,
                COUNT(*) FILTER (WHERE status='missing')::int AS missing,
                COUNT(*) FILTER (WHERE status='error')::int AS error
            FROM character_images
        `);
        res.json({ persistent:true, cachedInMemory:CHARACTER_IMAGE_CACHE.size, ...(result.rows[0] || {}) });
    } catch (e) {
        res.json({ persistent:true, cachedInMemory:CHARACTER_IMAGE_CACHE.size, error:e.message });
    }
});

/* ================= Système de rangs & ELO ================= */

const RANK_TIERS = [
    { name: 'Bronze',  division: 1, min: -Infinity, max: 1099 },
    { name: 'Bronze',  division: 2, min: 1100, max: 1199 },
    { name: 'Bronze',  division: 3, min: 1200, max: 1299 },
    { name: 'Argent',  division: 1, min: 1300, max: 1399 },
    { name: 'Argent',  division: 2, min: 1400, max: 1499 },
    { name: 'Argent',  division: 3, min: 1500, max: 1599 },
    { name: 'Or',      division: 1, min: 1600, max: 1699 },
    { name: 'Or',      division: 2, min: 1700, max: 1799 },
    { name: 'Or',      division: 3, min: 1800, max: 1899 },
    { name: 'Platine', division: 1, min: 1900, max: 1999 },
    { name: 'Platine', division: 2, min: 2000, max: 2099 },
    { name: 'Platine', division: 3, min: 2100, max: 2199 },
    { name: 'Diamant', division: 1, min: 2200, max: 2299 },
    { name: 'Diamant', division: 2, min: 2300, max: 2399 },
    { name: 'Diamant', division: 3, min: 2400, max: 2499 }
];

function getRankLabel(rating) {
    for (const tier of RANK_TIERS) {
        if (rating >= tier.min && rating <= tier.max) {
            return `${tier.name} ${tier.division}`;
        }
    }
    return 'Élite'; // au-dessus de 2499 : classement pur à l'ELO, plus de divisions
}

// Barème ELO
const ELO = {
    normal: { winCivil: 12, winImpostor: 14, loss: 17 },
    hardcore: { winCivil: 10, winImpostor: 17, loss: 17 },
    rollandgaros: { win: 12, loss: 17 }
};

async function recordMatchResult(userId, won, eloDelta) {
    if (!userId) return;
    try {
        await pool.query(
            `UPDATE users SET
                rating = GREATEST(rating + $1, 0),
                wins = wins + $2,
                losses = losses + $3
             WHERE id = $4`,
            [eloDelta, won ? 1 : 0, won ? 0 : 1, userId]
        );
    } catch (err) {
        console.error('Erreur mise à jour ELO :', err);
    }
}

async function notifyProfileUpdate(socketId, userId) {
    if (!userId) return;
    try {
        const result = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
        const user = result.rows[0];
        if (user) {
            io.to(socketId).emit('profile_updated', { user: publicUser(user) });
        }
    } catch (err) {
        console.error('Erreur notifyProfileUpdate :', err);
    }
}

// Undercover Normal/Hardcore + Devine la note (même mécanique imposteur/civils)
async function applyImpostorModeRanking(room, { impostorsWin, noImpostorRoundWin }) {
    const scale = (room.mode === 'undercover' && room.subMode === 'hardcore') ? ELO.hardcore : ELO.normal;

    for (const p of room.players) {
        if (!p.userId) continue;
        let won;
        let eloDelta;

        if (noImpostorRoundWin) {
            won = true;
            eloDelta = scale.winCivil;
        } else if (p.isImpostor) {
            won = impostorsWin;
            eloDelta = won ? scale.winImpostor : -scale.loss;
        } else {
            won = !impostorsWin;
            eloDelta = won ? scale.winCivil : -scale.loss;
        }

        await recordMatchResult(p.userId, won, eloDelta);
        notifyProfileUpdate(p.id, p.userId);
    }
}

// Rolland Garos : un seul gagnant (dernier en vie), tous les autres perdent
async function applyRollandGarosRanking(room, winner) {
    if (!winner) return;

    for (const p of room.players) {
        if (!p.userId) continue;
        const won = p.id === winner.id;
        const eloDelta = won ? ELO.rollandgaros.win : -ELO.rollandgaros.loss;

        await recordMatchResult(p.userId, won, eloDelta);
        notifyProfileUpdate(p.id, p.userId);
    }
}

function publicUser(row) {
    return {
        id: row.id,
        pseudo: row.pseudo,
        email: row.email,
        rating: row.rating,
        wins: row.wins,
        losses: row.losses,
        rank: getRankLabel(row.rating)
    };
}

function signToken(userId) {
    return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function verifyToken(token) {
    try {
        return jwt.verify(token, JWT_SECRET);
    } catch (e) {
        return null;
    }
}

app.post('/api/register', async (req, res) => {
    const { pseudo, email, password } = req.body || {};

    if (!pseudo || !email || !password) {
        return res.status(400).json({ error: 'Pseudo, email et mot de passe sont requis.' });
    }
    const cleanPseudo = String(pseudo).trim();
    const cleanEmail = String(email).trim().toLowerCase();

    if (cleanPseudo.length < 3 || cleanPseudo.length > 20) {
        return res.status(400).json({ error: 'Le pseudo doit faire entre 3 et 20 caractères.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
        return res.status(400).json({ error: 'Email invalide.' });
    }
    if (String(password).length < 6) {
        return res.status(400).json({ error: 'Le mot de passe doit faire au moins 6 caractères.' });
    }

    try {
        const existing = await pool.query('SELECT id FROM users WHERE email = $1 OR pseudo = $2', [cleanEmail, cleanPseudo]);
        if (existing.rows.length > 0) {
            return res.status(409).json({ error: 'Ce pseudo ou cet email est déjà utilisé.' });
        }

        const passwordHash = bcrypt.hashSync(String(password), 10);
        const insert = await pool.query(
            'INSERT INTO users (pseudo, email, password_hash) VALUES ($1, $2, $3) RETURNING *',
            [cleanPseudo, cleanEmail, passwordHash]
        );
        const user = insert.rows[0];

        const token = signToken(user.id);
        res.json({ token, user: publicUser(user) });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Erreur serveur, réessaie plus tard." });
    }
});

app.post('/api/login', async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) {
        return res.status(400).json({ error: 'Email et mot de passe requis.' });
    }

    const cleanEmail = String(email).trim().toLowerCase();

    try {
        const result = await pool.query('SELECT * FROM users WHERE email = $1', [cleanEmail]);
        const user = result.rows[0];
        if (!user || !bcrypt.compareSync(String(password), user.password_hash)) {
            return res.status(401).json({ error: 'Email ou mot de passe incorrect.' });
        }

        const token = signToken(user.id);
        res.json({ token, user: publicUser(user) });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Erreur serveur, réessaie plus tard." });
    }
});

app.get('/api/me', async (req, res) => {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Non authentifié.' });

    const payload = verifyToken(token);
    if (!payload) return res.status(401).json({ error: 'Session invalide ou expirée.' });

    try {
        const result = await pool.query('SELECT * FROM users WHERE id = $1', [payload.sub]);
        const user = result.rows[0];
        if (!user) return res.status(401).json({ error: 'Utilisateur introuvable.' });

        res.json({ user: publicUser(user) });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Erreur serveur." });
    }
});

// Chaque connexion Socket.io doit présenter un token JWT valide (envoyé par le client via socket.auth)
io.use(async (socket, next) => {
    const auth = socket.handshake.auth || {};

    // Mode invité : pas de compte, pas de persistance, pas de ranked (userId reste null partout)
    if (auth.guest) {
        const pseudo = String(auth.pseudo || '').trim().slice(0, 20);
        if (!pseudo) return next(new Error('unauthorized'));

        socket.user = {
            id: null,
            pseudo,
            email: null,
            rating: null,
            wins: 0,
            losses: 0,
            rank: null,
            isGuest: true
        };
        return next();
    }

    const token = auth.token;
    if (!token) return next(new Error('unauthorized'));

    const payload = verifyToken(token);
    if (!payload) return next(new Error('unauthorized'));

    try {
        const result = await pool.query('SELECT * FROM users WHERE id = $1', [payload.sub]);
        const user = result.rows[0];
        if (!user) return next(new Error('unauthorized'));

        socket.user = publicUser(user);
        next();
    } catch (err) {
        next(new Error('unauthorized'));
    }
});

const rooms = {};

// Reconnexion : délai pendant lequel on garde la place d'un joueur déconnecté
const RECONNECT_GRACE_MS = 90000; // 90 secondes
const graceTimers = {}; // socketId -> timeout de retrait définitif

// Timers et pools de la manche Rolland Garos, tenus à part de `rooms`
// pour ne jamais envoyer d'objets non serialisables (Set, Timeout) aux clients.
const rgTimers = {};   // roomCode -> interval id
const rgPools = {};    // roomCode -> { pool: string[], usedNorm: Set<string> }

// Liste Undercover Normal (Paires)
const undercoverPairsNormal = [
    [
        "Naruto (Naruto)",
        "Minato (Naruto)"
    ],
    [
        "Sasuke (Naruto)",
        "Itachi (Naruto)"
    ],
    [
        "Sakura (Naruto)",
        "Tsunade (Naruto)"
    ],
    [
        "Kakashi (Naruto)",
        "Obito (Naruto)"
    ],
    [
        "Jiraiya (Naruto)",
        "Orochimaru (Naruto)"
    ],
    [
        "Gaara (Naruto)",
        "Sasori (Naruto)"
    ],
    [
        "Madara (Naruto)",
        "Hashirama (Naruto)"
    ],
    [
        "Hinata (Naruto)",
        "Neji (Naruto)"
    ],
    [
        "Shikamaru (Naruto)",
        "Shikaku (Naruto)"
    ],
    [
        "Rock Lee (Naruto)",
        "Might Guy (Naruto)"
    ],
    [
        "Pain (Naruto)",
        "Konan (Naruto)"
    ],
    [
        "Deidara (Naruto)",
        "Sasori (Naruto)"
    ],
    [
        "Kisame (Naruto)",
        "Zabuza (Naruto)"
    ],
    [
        "Kurama (Naruto)",
        "Shukaku (Naruto)"
    ],
    [
        "Rasengan (Naruto)",
        "Chidori (Naruto)"
    ],
    [
        "Sharingan (Naruto)",
        "Byakugan (Naruto)"
    ],
    [
        "Amaterasu (Naruto)",
        "Kamui (Naruto)"
    ],
    [
        "Akatsuki (Naruto)",
        "ANBU (Naruto)"
    ],
    [
        "Konoha (Naruto)",
        "Suna (Naruto)"
    ],
    [
        "Hokage (Naruto)",
        "Kazekage (Naruto)"
    ],
    [
        "Luffy (One Piece)",
        "Ace (One Piece)"
    ],
    [
        "Zoro (One Piece)",
        "Mihawk (One Piece)"
    ],
    [
        "Sanji (One Piece)",
        "Zeff (One Piece)"
    ],
    [
        "Nami (One Piece)",
        "Robin (One Piece)"
    ],
    [
        "Usopp (One Piece)",
        "Franky (One Piece)"
    ],
    [
        "Shanks (One Piece)",
        "Roger (One Piece)"
    ],
    [
        "Garp (One Piece)",
        "Sengoku (One Piece)"
    ],
    [
        "Law (One Piece)",
        "Kid (One Piece)"
    ],
    [
        "Kaido (One Piece)",
        "Big Mom (One Piece)"
    ],
    [
        "Crocodile (One Piece)",
        "Doflamingo (One Piece)"
    ],
    [
        "Akainu (One Piece)",
        "Aokiji (One Piece)"
    ],
    [
        "Kizaru (One Piece)",
        "Fujitora (One Piece)"
    ],
    [
        "Sabo (One Piece)",
        "Ace (One Piece)"
    ],
    [
        "Chopper (One Piece)",
        "Bepo (One Piece)"
    ],
    [
        "Vivi (One Piece)",
        "Rebecca (One Piece)"
    ],
    [
        "Haki de l'armement (One Piece)",
        "Haki de l'observation (One Piece)"
    ],
    [
        "Gear 4 (One Piece)",
        "Gear 5 (One Piece)"
    ],
    [
        "Marine (One Piece)",
        "Gouvernement Mondial (One Piece)"
    ],
    [
        "Grand Line (One Piece)",
        "Nouveau Monde (One Piece)"
    ],
    [
        "Impel Down (One Piece)",
        "Enies Lobby (One Piece)"
    ],
    [
        "Ichigo (Bleach)",
        "Uryu (Bleach)"
    ],
    [
        "Rukia (Bleach)",
        "Renji (Bleach)"
    ],
    [
        "Byakuya (Bleach)",
        "Toshiro (Bleach)"
    ],
    [
        "Kenpachi (Bleach)",
        "Unohana (Bleach)"
    ],
    [
        "Aizen (Bleach)",
        "Yhwach (Bleach)"
    ],
    [
        "Gin (Bleach)",
        "Tosen (Bleach)"
    ],
    [
        "Grimmjow (Bleach)",
        "Ulquiorra (Bleach)"
    ],
    [
        "Orihime (Bleach)",
        "Rangiku (Bleach)"
    ],
    [
        "Chad (Bleach)",
        "Ganju (Bleach)"
    ],
    [
        "Kisuke (Bleach)",
        "Mayuri (Bleach)"
    ],
    [
        "Shinigami (Bleach)",
        "Quincy (Bleach)"
    ],
    [
        "Hollow (Bleach)",
        "Arrancar (Bleach)"
    ],
    [
        "Bankai (Bleach)",
        "Shikai (Bleach)"
    ],
    [
        "Soul Society (Bleach)",
        "Hueco Mundo (Bleach)"
    ],
    [
        "Gotei 13 (Bleach)",
        "Sternritter (Bleach)"
    ],
    [
        "Gon (Hunter x Hunter)",
        "Killua (Hunter x Hunter)"
    ],
    [
        "Kurapika (Hunter x Hunter)",
        "Leorio (Hunter x Hunter)"
    ],
    [
        "Hisoka (Hunter x Hunter)",
        "Illumi (Hunter x Hunter)"
    ],
    [
        "Chrollo (Hunter x Hunter)",
        "Kurapika (Hunter x Hunter)"
    ],
    [
        "Meruem (Hunter x Hunter)",
        "Netero (Hunter x Hunter)"
    ],
    [
        "Pitou (Hunter x Hunter)",
        "Pouf (Hunter x Hunter)"
    ],
    [
        "Knuckle (Hunter x Hunter)",
        "Shoot (Hunter x Hunter)"
    ],
    [
        "Kite (Hunter x Hunter)",
        "Ging (Hunter x Hunter)"
    ],
    [
        "Biscuit (Hunter x Hunter)",
        "Wing (Hunter x Hunter)"
    ],
    [
        "Feitan (Hunter x Hunter)",
        "Phinks (Hunter x Hunter)"
    ],
    [
        "Zeno (Hunter x Hunter)",
        "Silva (Hunter x Hunter)"
    ],
    [
        "Nen (Hunter x Hunter)",
        "Ren (Hunter x Hunter)"
    ],
    [
        "Ten (Hunter x Hunter)",
        "Zetsu (Hunter x Hunter)"
    ],
    [
        "Hunter (Hunter x Hunter)",
        "Brigade Fantôme (Hunter x Hunter)"
    ],
    [
        "Eren (SNK / L'Attaque des Titans)",
        "Reiner (SNK / L'Attaque des Titans)"
    ],
    [
        "Mikasa (SNK / L'Attaque des Titans)",
        "Annie (SNK / L'Attaque des Titans)"
    ],
    [
        "Armin (SNK / L'Attaque des Titans)",
        "Erwin (SNK / L'Attaque des Titans)"
    ],
    [
        "Levi (SNK / L'Attaque des Titans)",
        "Kenny (SNK / L'Attaque des Titans)"
    ],
    [
        "Zeke (SNK / L'Attaque des Titans)",
        "Grisha (SNK / L'Attaque des Titans)"
    ],
    [
        "Jean (SNK / L'Attaque des Titans)",
        "Connie (SNK / L'Attaque des Titans)"
    ],
    [
        "Sasha (SNK / L'Attaque des Titans)",
        "Historia (SNK / L'Attaque des Titans)"
    ],
    [
        "Hansi (SNK / L'Attaque des Titans)",
        "Erwin (SNK / L'Attaque des Titans)"
    ],
    [
        "Gabi (SNK / L'Attaque des Titans)",
        "Falco (SNK / L'Attaque des Titans)"
    ],
    [
        "Porco (SNK / L'Attaque des Titans)",
        "Reiner (SNK / L'Attaque des Titans)"
    ],
    [
        "Titan Assaillant (SNK / L'Attaque des Titans)",
        "Titan Cuirassé (SNK / L'Attaque des Titans)"
    ],
    [
        "Titan Colossal (SNK / L'Attaque des Titans)",
        "Titan Bestial (SNK / L'Attaque des Titans)"
    ],
    [
        "Paradis (SNK / L'Attaque des Titans)",
        "Marley (SNK / L'Attaque des Titans)"
    ],
    [
        "Bataillon d'exploration (SNK / L'Attaque des Titans)",
        "Brigades spéciales (SNK / L'Attaque des Titans)"
    ],
    [
        "Meliodas (Seven Deadly Sins)",
        "Zeldris (Seven Deadly Sins)"
    ],
    [
        "Ban (Seven Deadly Sins)",
        "Escanor (Seven Deadly Sins)"
    ],
    [
        "King (Seven Deadly Sins)",
        "Gowther (Seven Deadly Sins)"
    ],
    [
        "Diane (Seven Deadly Sins)",
        "Merlin (Seven Deadly Sins)"
    ],
    [
        "Elizabeth (Seven Deadly Sins)",
        "Elaine (Seven Deadly Sins)"
    ],
    [
        "Estarossa (Seven Deadly Sins)",
        "Zeldris (Seven Deadly Sins)"
    ],
    [
        "Chandler (Seven Deadly Sins)",
        "Cusack (Seven Deadly Sins)"
    ],
    [
        "Mael (Seven Deadly Sins)",
        "Ludociel (Seven Deadly Sins)"
    ],
    [
        "Hawk (Seven Deadly Sins)",
        "Wild (Seven Deadly Sins)"
    ],
    [
        "Dreyfus (Seven Deadly Sins)",
        "Hendrickson (Seven Deadly Sins)"
    ],
    [
        "Démons (Seven Deadly Sins)",
        "Déesses (Seven Deadly Sins)"
    ],
    [
        "Dix Commandements (Seven Deadly Sins)",
        "Seven Deadly Sins (Seven Deadly Sins)"
    ],
    [
        "Full Counter (Seven Deadly Sins)",
        "Revenge Counter (Seven Deadly Sins)"
    ],
    [
        "Light (Death Note)",
        "L (Death Note)"
    ],
    [
        "Near (Death Note)",
        "Mello (Death Note)"
    ],
    [
        "Ryuk (Death Note)",
        "Rem (Death Note)"
    ],
    [
        "Misa (Death Note)",
        "Kiyomi (Death Note)"
    ],
    [
        "Soichiro (Death Note)",
        "Matsuda (Death Note)"
    ],
    [
        "Light (Death Note)",
        "Mikami (Death Note)"
    ],
    [
        "Death Note (Death Note)",
        "Faux Death Note (Death Note)"
    ],
    [
        "Kira (Death Note)",
        "L (Death Note)"
    ],
    [
        "Shinigami (Death Note)",
        "Humain (Death Note)"
    ],
    [
        "Ayanokoji (Classroom of the Elite)",
        "Koenji (Classroom of the Elite)"
    ],
    [
        "Horikita (Classroom of the Elite)",
        "Kushida (Classroom of the Elite)"
    ],
    [
        "Ryuen (Classroom of the Elite)",
        "Sakayanagi (Classroom of the Elite)"
    ],
    [
        "Ichinose (Classroom of the Elite)",
        "Horikita (Classroom of the Elite)"
    ],
    [
        "Manabu (Classroom of the Elite)",
        "Nagumo (Classroom of the Elite)"
    ],
    [
        "Kei (Classroom of the Elite)",
        "Kushida (Classroom of the Elite)"
    ],
    [
        "Sudo (Classroom of the Elite)",
        "Ike (Classroom of the Elite)"
    ],
    [
        "Classe A (Classroom of the Elite)",
        "Classe D (Classroom of the Elite)"
    ],
    [
        "Examen spécial (Classroom of the Elite)",
        "Examen écrit (Classroom of the Elite)"
    ],
    [
        "Jinwoo (Solo Leveling)",
        "Igris (Solo Leveling)"
    ],
    [
        "Jinwoo (Solo Leveling)",
        "Jinho (Solo Leveling)"
    ],
    [
        "Cha Hae-In (Solo Leveling)",
        "Lee Joohee (Solo Leveling)"
    ],
    [
        "Baek Yoonho (Solo Leveling)",
        "Choi Jong-In (Solo Leveling)"
    ],
    [
        "Thomas Andre (Solo Leveling)",
        "Liu Zhigang (Solo Leveling)"
    ],
    [
        "Beru (Solo Leveling)",
        "Igris (Solo Leveling)"
    ],
    [
        "Antares (Solo Leveling)",
        "Ashborn (Solo Leveling)"
    ],
    [
        "Monarque (Solo Leveling)",
        "Dirigeant (Solo Leveling)"
    ],
    [
        "Ombre (Solo Leveling)",
        "Chasseur (Solo Leveling)"
    ],
    [
        "Portail (Solo Leveling)",
        "Donjon (Solo Leveling)"
    ],
    [
        "Asta (Black Clover)",
        "Yuno (Black Clover)"
    ],
    [
        "Yami (Black Clover)",
        "Nacht (Black Clover)"
    ],
    [
        "Noelle (Black Clover)",
        "Mimosa (Black Clover)"
    ],
    [
        "Luck (Black Clover)",
        "Magna (Black Clover)"
    ],
    [
        "Finral (Black Clover)",
        "Langris (Black Clover)"
    ],
    [
        "Fuegoleon (Black Clover)",
        "Mereoleona (Black Clover)"
    ],
    [
        "Julius (Black Clover)",
        "Lumière (Black Clover)"
    ],
    [
        "Patry (Black Clover)",
        "Licht (Black Clover)"
    ],
    [
        "Dante (Black Clover)",
        "Zenon (Black Clover)"
    ],
    [
        "Vanessa (Black Clover)",
        "Grey (Black Clover)"
    ],
    [
        "Black Bulls (Black Clover)",
        "Golden Dawn (Black Clover)"
    ],
    [
        "Mana (Black Clover)",
        "Anti-magie (Black Clover)"
    ],
    [
        "Grimoire à 4 feuilles (Black Clover)",
        "Grimoire à 5 feuilles (Black Clover)"
    ],
    [
        "Shinra (Fire Force)",
        "Sho (Fire Force)"
    ],
    [
        "Arthur (Fire Force)",
        "Ogun (Fire Force)"
    ],
    [
        "Benimaru (Fire Force)",
        "Burns (Fire Force)"
    ],
    [
        "Maki (Fire Force)",
        "Tamaki (Fire Force)"
    ],
    [
        "Joker (Fire Force)",
        "Licht (Fire Force)"
    ],
    [
        "Hibana (Fire Force)",
        "Iris (Fire Force)"
    ],
    [
        "Vulcan (Fire Force)",
        "Giovanni (Fire Force)"
    ],
    [
        "Compagnie 8 (Fire Force)",
        "Compagnie 1 (Fire Force)"
    ],
    [
        "Adolla (Fire Force)",
        "Monde réel (Fire Force)"
    ],
    [
        "Deuxième génération (Fire Force)",
        "Troisième génération (Fire Force)"
    ],
    [
        "Rudeus (Mushoku Tensei)",
        "Paul (Mushoku Tensei)"
    ],
    [
        "Roxy (Mushoku Tensei)",
        "Sylphiette (Mushoku Tensei)"
    ],
    [
        "Eris (Mushoku Tensei)",
        "Ghislaine (Mushoku Tensei)"
    ],
    [
        "Ruijerd (Mushoku Tensei)",
        "Orsted (Mushoku Tensei)"
    ],
    [
        "Zenith (Mushoku Tensei)",
        "Lilia (Mushoku Tensei)"
    ],
    [
        "Ariel (Mushoku Tensei)",
        "Nanahoshi (Mushoku Tensei)"
    ],
    [
        "Rudeus (Mushoku Tensei)",
        "Cliff (Mushoku Tensei)"
    ],
    [
        "Paul (Mushoku Tensei)",
        "Geese (Mushoku Tensei)"
    ],
    [
        "Magie (Mushoku Tensei)",
        "Touki (Mushoku Tensei)"
    ],
    [
        "Migurd (Mushoku Tensei)",
        "Superd (Mushoku Tensei)"
    ],
    [
        "Subaru (Re:Zero)",
        "Reinhard (Re:Zero)"
    ],
    [
        "Emilia (Re:Zero)",
        "Satella (Re:Zero)"
    ],
    [
        "Rem (Re:Zero)",
        "Ram (Re:Zero)"
    ],
    [
        "Beatrice (Re:Zero)",
        "Echidna (Re:Zero)"
    ],
    [
        "Roswaal (Re:Zero)",
        "Puck (Re:Zero)"
    ],
    [
        "Garfiel (Re:Zero)",
        "Frederica (Re:Zero)"
    ],
    [
        "Otto (Re:Zero)",
        "Garfiel (Re:Zero)"
    ],
    [
        "Crusch (Re:Zero)",
        "Anastasia (Re:Zero)"
    ],
    [
        "Regulus (Re:Zero)",
        "Petelgeuse (Re:Zero)"
    ],
    [
        "Sorcière (Re:Zero)",
        "Archevêque (Re:Zero)"
    ],
    [
        "Return by Death (Re:Zero)",
        "Autorité (Re:Zero)"
    ],
    [
        "Natsu (Fairy Tail)",
        "Gajeel (Fairy Tail)"
    ],
    [
        "Gray (Fairy Tail)",
        "Lyon (Fairy Tail)"
    ],
    [
        "Erza (Fairy Tail)",
        "Mirajane (Fairy Tail)"
    ],
    [
        "Lucy (Fairy Tail)",
        "Yukino (Fairy Tail)"
    ],
    [
        "Wendy (Fairy Tail)",
        "Chelia (Fairy Tail)"
    ],
    [
        "Happy (Fairy Tail)",
        "Carla (Fairy Tail)"
    ],
    [
        "Makarov (Fairy Tail)",
        "Gildarts (Fairy Tail)"
    ],
    [
        "Zeref (Fairy Tail)",
        "Acnologia (Fairy Tail)"
    ],
    [
        "Sting (Fairy Tail)",
        "Rogue (Fairy Tail)"
    ],
    [
        "Jellal (Fairy Tail)",
        "Mystogan (Fairy Tail)"
    ],
    [
        "Fairy Tail (Fairy Tail)",
        "Sabertooth (Fairy Tail)"
    ],
    [
        "Dragon Slayer (Fairy Tail)",
        "God Slayer (Fairy Tail)"
    ],
    [
        "Isagi (Blue Lock)",
        "Rin (Blue Lock)"
    ],
    [
        "Bachira (Blue Lock)",
        "Shidou (Blue Lock)"
    ],
    [
        "Nagi (Blue Lock)",
        "Reo (Blue Lock)"
    ],
    [
        "Barou (Blue Lock)",
        "Kunigami (Blue Lock)"
    ],
    [
        "Chigiri (Blue Lock)",
        "Zantetsu (Blue Lock)"
    ],
    [
        "Sae (Blue Lock)",
        "Rin (Blue Lock)"
    ],
    [
        "Ego (Blue Lock)",
        "Noa (Blue Lock)"
    ],
    [
        "Gagamaru (Blue Lock)",
        "Aryu (Blue Lock)"
    ],
    [
        "Karasu (Blue Lock)",
        "Otoya (Blue Lock)"
    ],
    [
        "Kaiser (Blue Lock)",
        "Isagi (Blue Lock)"
    ],
    [
        "Dribble (Blue Lock)",
        "Tir (Blue Lock)"
    ],
    [
        "Vision périphérique (Blue Lock)",
        "Meta Vision (Blue Lock)"
    ],
    [
        "Edward (Fullmetal Alchemist)",
        "Alphonse (Fullmetal Alchemist)"
    ],
    [
        "Roy (Fullmetal Alchemist)",
        "Riza (Fullmetal Alchemist)"
    ],
    [
        "Scar (Fullmetal Alchemist)",
        "Greed (Fullmetal Alchemist)"
    ],
    [
        "Bradley (Fullmetal Alchemist)",
        "Father (Fullmetal Alchemist)"
    ],
    [
        "Winry (Fullmetal Alchemist)",
        "Pinako (Fullmetal Alchemist)"
    ],
    [
        "Izumi (Fullmetal Alchemist)",
        "Edward (Fullmetal Alchemist)"
    ],
    [
        "Envy (Fullmetal Alchemist)",
        "Lust (Fullmetal Alchemist)"
    ],
    [
        "Gluttony (Fullmetal Alchemist)",
        "Sloth (Fullmetal Alchemist)"
    ],
    [
        "Alchimie (Fullmetal Alchemist)",
        "Alkahestrie (Fullmetal Alchemist)"
    ],
    [
        "Pierre philosophale (Fullmetal Alchemist)",
        "Transmutation humaine (Fullmetal Alchemist)"
    ],
    [
        "Denji (Chainsaw Man)",
        "Aki (Chainsaw Man)"
    ],
    [
        "Power (Chainsaw Man)",
        "Kobeni (Chainsaw Man)"
    ],
    [
        "Makima (Chainsaw Man)",
        "Reze (Chainsaw Man)"
    ],
    [
        "Pochita (Chainsaw Man)",
        "Nayuta (Chainsaw Man)"
    ],
    [
        "Kishibe (Chainsaw Man)",
        "Yoshida (Chainsaw Man)"
    ],
    [
        "Katana Man (Chainsaw Man)",
        "Denji (Chainsaw Man)"
    ],
    [
        "Angel Devil (Chainsaw Man)",
        "Future Devil (Chainsaw Man)"
    ],
    [
        "Démon (Chainsaw Man)",
        "Hybride (Chainsaw Man)"
    ],
    [
        "Public Safety (Chainsaw Man)",
        "Chasseurs privés (Chainsaw Man)"
    ],
    [
        "Yugo (Wakfu)",
        "Adamai (Wakfu)"
    ],
    [
        "Tristepin (Wakfu)",
        "Goultard (Wakfu)"
    ],
    [
        "Amalia (Wakfu)",
        "Evangelyne (Wakfu)"
    ],
    [
        "Ruel (Wakfu)",
        "Alibert (Wakfu)"
    ],
    [
        "Qilby (Wakfu)",
        "Yugo (Wakfu)"
    ],
    [
        "Nox (Wakfu)",
        "Oropo (Wakfu)"
    ],
    [
        "Elely (Wakfu)",
        "Flopin (Wakfu)"
    ],
    [
        "Eliatrope (Wakfu)",
        "Dragon (Wakfu)"
    ],
    [
        "Shushu (Wakfu)",
        "Dofus (Wakfu)"
    ],
    [
        "Wakfu (Wakfu)",
        "Stasis (Wakfu)"
    ],
    [
        "Tanjiro (Demon Slayer)",
        "Yoriichi (Demon Slayer)"
    ],
    [
        "Nezuko (Demon Slayer)",
        "Tamayo (Demon Slayer)"
    ],
    [
        "Zenitsu (Demon Slayer)",
        "Inosuke (Demon Slayer)"
    ],
    [
        "Giyu (Demon Slayer)",
        "Sanemi (Demon Slayer)"
    ],
    [
        "Rengoku (Demon Slayer)",
        "Tengen (Demon Slayer)"
    ],
    [
        "Shinobu (Demon Slayer)",
        "Mitsuri (Demon Slayer)"
    ],
    [
        "Muichiro (Demon Slayer)",
        "Obanai (Demon Slayer)"
    ],
    [
        "Muzan (Demon Slayer)",
        "Kokushibo (Demon Slayer)"
    ],
    [
        "Akaza (Demon Slayer)",
        "Doma (Demon Slayer)"
    ],
    [
        "Gyutaro (Demon Slayer)",
        "Rui (Demon Slayer)"
    ],
    [
        "Pilier (Demon Slayer)",
        "Lune Supérieure (Demon Slayer)"
    ],
    [
        "Souffle de l'eau (Demon Slayer)",
        "Souffle du soleil (Demon Slayer)"
    ],
    [
        "Pikachu (Pokémon)",
        "Raichu (Pokémon)"
    ],
    [
        "Dracaufeu (Pokémon)",
        "Dracolosse (Pokémon)"
    ],
    [
        "Mew (Pokémon)",
        "Mewtwo (Pokémon)"
    ],
    [
        "Groudon (Pokémon)",
        "Kyogre (Pokémon)"
    ],
    [
        "Dialga (Pokémon)",
        "Palkia (Pokémon)"
    ],
    [
        "Reshiram (Pokémon)",
        "Zekrom (Pokémon)"
    ],
    [
        "Lugia (Pokémon)",
        "Ho-Oh (Pokémon)"
    ],
    [
        "Ectoplasma (Pokémon)",
        "Alakazam (Pokémon)"
    ],
    [
        "Lucario (Pokémon)",
        "Zoroark (Pokémon)"
    ],
    [
        "Sacha (Pokémon)",
        "Red (Pokémon)"
    ],
    [
        "Poké Ball (Pokémon)",
        "Master Ball (Pokémon)"
    ],
    [
        "Méga-Évolution (Pokémon)",
        "Dynamax (Pokémon)"
    ],
    [
        "Goku (Dragon Ball)",
        "Vegeta (Dragon Ball)"
    ],
    [
        "Gohan (Dragon Ball)",
        "Trunks (Dragon Ball)"
    ],
    [
        "Piccolo (Dragon Ball)",
        "Nail (Dragon Ball)"
    ],
    [
        "Freezer (Dragon Ball)",
        "Cell (Dragon Ball)"
    ],
    [
        "Buu (Dragon Ball)",
        "Cell (Dragon Ball)"
    ],
    [
        "Beerus (Dragon Ball)",
        "Champa (Dragon Ball)"
    ],
    [
        "Whis (Dragon Ball)",
        "Vados (Dragon Ball)"
    ],
    [
        "Gogeta (Dragon Ball)",
        "Vegetto (Dragon Ball)"
    ],
    [
        "Broly (Dragon Ball)",
        "Kale (Dragon Ball)"
    ],
    [
        "Jiren (Dragon Ball)",
        "Toppo (Dragon Ball)"
    ],
    [
        "Super Saiyan (Dragon Ball)",
        "Super Saiyan God (Dragon Ball)"
    ],
    [
        "Ultra Instinct (Dragon Ball)",
        "Ultra Ego (Dragon Ball)"
    ],
    [
        "Kamehameha (Dragon Ball)",
        "Final Flash (Dragon Ball)"
    ],
    [
        "Gabimaru (Hell's Paradise)",
        "Chobei (Hell's Paradise)"
    ],
    [
        "Sagiri (Hell's Paradise)",
        "Yuzuriha (Hell's Paradise)"
    ],
    [
        "Shion (Hell's Paradise)",
        "Tenza (Hell's Paradise)"
    ],
    [
        "Fuchi (Hell's Paradise)",
        "Senta (Hell's Paradise)"
    ],
    [
        "Mei (Hell's Paradise)",
        "Rien (Hell's Paradise)"
    ],
    [
        "Chobei (Hell's Paradise)",
        "Toma (Hell's Paradise)"
    ],
    [
        "Tao (Hell's Paradise)",
        "Ninjutsu (Hell's Paradise)"
    ],
    [
        "Asaemon (Hell's Paradise)",
        "Criminel (Hell's Paradise)"
    ],
    [
        "Rudo (Gachiakuta)",
        "Zanka (Gachiakuta)"
    ],
    [
        "Enjin (Gachiakuta)",
        "Riyo (Gachiakuta)"
    ],
    [
        "Jabber (Gachiakuta)",
        "Zodyl (Gachiakuta)"
    ],
    [
        "Tamsy (Gachiakuta)",
        "Delmon (Gachiakuta)"
    ],
    [
        "Amo (Gachiakuta)",
        "Chiwa (Gachiakuta)"
    ],
    [
        "Regto (Gachiakuta)",
        "Corvus (Gachiakuta)"
    ],
    [
        "Eishia (Gachiakuta)",
        "August (Gachiakuta)"
    ],
    [
        "Guita (Gachiakuta)",
        "Dear (Gachiakuta)"
    ],
    [
        "Cleaners (Gachiakuta)",
        "Raiders (Gachiakuta)"
    ],
    [
        "Giver (Gachiakuta)",
        "Jinki (Gachiakuta)"
    ],
    [
        "Hinata (Haikyuu)",
        "Kageyama (Haikyuu)"
    ],
    [
        "Oikawa (Haikyuu)",
        "Atsumu (Haikyuu)"
    ],
    [
        "Bokuto (Haikyuu)",
        "Ushijima (Haikyuu)"
    ],
    [
        "Kenma (Haikyuu)",
        "Akaashi (Haikyuu)"
    ],
    [
        "Nishinoya (Haikyuu)",
        "Yaku (Haikyuu)"
    ],
    [
        "Tsukishima (Haikyuu)",
        "Kuroo (Haikyuu)"
    ],
    [
        "Daichi (Haikyuu)",
        "Kita (Haikyuu)"
    ],
    [
        "Asahi (Haikyuu)",
        "Aran (Haikyuu)"
    ],
    [
        "Karasuno (Haikyuu)",
        "Nekoma (Haikyuu)"
    ],
    [
        "Shiratorizawa (Haikyuu)",
        "Inarizaki (Haikyuu)"
    ],
    [
        "Passeur (Haikyuu)",
        "Libéro (Haikyuu)"
    ],
    [
        "Yuji (Jujutsu Kaisen)",
        "Yuta (Jujutsu Kaisen)"
    ],
    [
        "Gojo (Jujutsu Kaisen)",
        "Sukuna (Jujutsu Kaisen)"
    ],
    [
        "Megumi (Jujutsu Kaisen)",
        "Nobara (Jujutsu Kaisen)"
    ],
    [
        "Maki (Jujutsu Kaisen)",
        "Toji (Jujutsu Kaisen)"
    ],
    [
        "Geto (Jujutsu Kaisen)",
        "Kenjaku (Jujutsu Kaisen)"
    ],
    [
        "Nanami (Jujutsu Kaisen)",
        "Kusakabe (Jujutsu Kaisen)"
    ],
    [
        "Todo (Jujutsu Kaisen)",
        "Hakari (Jujutsu Kaisen)"
    ],
    [
        "Mahito (Jujutsu Kaisen)",
        "Jogo (Jujutsu Kaisen)"
    ],
    [
        "Choso (Jujutsu Kaisen)",
        "Eso (Jujutsu Kaisen)"
    ],
    [
        "Rika (Jujutsu Kaisen)",
        "Mahoraga (Jujutsu Kaisen)"
    ],
    [
        "Fléau (Jujutsu Kaisen)",
        "Exorciste (Jujutsu Kaisen)"
    ],
    [
        "Black Flash (Jujutsu Kaisen)",
        "Extension du territoire (Jujutsu Kaisen)"
    ],
    [
        "Jonathan (JoJo's Bizarre Adventure)",
        "Joseph (JoJo's Bizarre Adventure)"
    ],
    [
        "Jotaro (JoJo's Bizarre Adventure)",
        "Josuke (JoJo's Bizarre Adventure)"
    ],
    [
        "Giorno (JoJo's Bizarre Adventure)",
        "Jolyne (JoJo's Bizarre Adventure)"
    ],
    [
        "Dio (JoJo's Bizarre Adventure)",
        "Kars (JoJo's Bizarre Adventure)"
    ],
    [
        "Kira (JoJo's Bizarre Adventure)",
        "Diavolo (JoJo's Bizarre Adventure)"
    ],
    [
        "Pucci (JoJo's Bizarre Adventure)",
        "Valentine (JoJo's Bizarre Adventure)"
    ],
    [
        "Caesar (JoJo's Bizarre Adventure)",
        "Polnareff (JoJo's Bizarre Adventure)"
    ],
    [
        "Speedwagon (JoJo's Bizarre Adventure)",
        "Stroheim (JoJo's Bizarre Adventure)"
    ],
    [
        "Hamon (JoJo's Bizarre Adventure)",
        "Stand (JoJo's Bizarre Adventure)"
    ],
    [
        "Star Platinum (JoJo's Bizarre Adventure)",
        "The World (JoJo's Bizarre Adventure)"
    ],
    [
        "Crazy Diamond (JoJo's Bizarre Adventure)",
        "Gold Experience (JoJo's Bizarre Adventure)"
    ],
    [
        "Rimuru (Tensura)",
        "Veldora (Tensura)"
    ],
    [
        "Benimaru (Tensura)",
        "Souei (Tensura)"
    ],
    [
        "Shion (Tensura)",
        "Shuna (Tensura)"
    ],
    [
        "Diablo (Tensura)",
        "Testarossa (Tensura)"
    ],
    [
        "Milim (Tensura)",
        "Ramiris (Tensura)"
    ],
    [
        "Guy (Tensura)",
        "Leon (Tensura)"
    ],
    [
        "Hinata (Tensura)",
        "Chloe (Tensura)"
    ],
    [
        "Ranga (Tensura)",
        "Gobta (Tensura)"
    ],
    [
        "Demon Lord (Tensura)",
        "True Dragon (Tensura)"
    ],
    [
        "Tempest (Tensura)",
        "Dwargon (Tensura)"
    ],
    [
        "Saitama (One Punch Man)",
        "Blast (One Punch Man)"
    ],
    [
        "Genos (One Punch Man)",
        "Drive Knight (One Punch Man)"
    ],
    [
        "Garou (One Punch Man)",
        "Bang (One Punch Man)"
    ],
    [
        "Tatsumaki (One Punch Man)",
        "Fubuki (One Punch Man)"
    ],
    [
        "Sonic (One Punch Man)",
        "Flashy Flash (One Punch Man)"
    ],
    [
        "Metal Bat (One Punch Man)",
        "Tanktop Master (One Punch Man)"
    ],
    [
        "Boros (One Punch Man)",
        "Orochi (One Punch Man)"
    ],
    [
        "King (One Punch Man)",
        "Mumen Rider (One Punch Man)"
    ],
    [
        "Hero Association (One Punch Man)",
        "Monster Association (One Punch Man)"
    ],
    [
        "Classe S (One Punch Man)",
        "Classe A (One Punch Man)"
    ],
    [
        "Kirito (Sword Art Online)",
        "Eugeo (Sword Art Online)"
    ],
    [
        "Asuna (Sword Art Online)",
        "Alice (Sword Art Online)"
    ],
    [
        "Sinon (Sword Art Online)",
        "Leafa (Sword Art Online)"
    ],
    [
        "Klein (Sword Art Online)",
        "Agil (Sword Art Online)"
    ],
    [
        "Yui (Sword Art Online)",
        "Cardinal (Sword Art Online)"
    ],
    [
        "Heathcliff (Sword Art Online)",
        "Oberon (Sword Art Online)"
    ],
    [
        "Kirito (Sword Art Online)",
        "Death Gun (Sword Art Online)"
    ],
    [
        "Aincrad (Sword Art Online)",
        "Alfheim (Sword Art Online)"
    ],
    [
        "SAO (Sword Art Online)",
        "GGO (Sword Art Online)"
    ],
    [
        "Épée (Sword Art Online)",
        "Épée photon (Sword Art Online)"
    ],
    [
        "Kaneki (Tokyo Ghoul)",
        "Haise (Tokyo Ghoul)"
    ],
    [
        "Touka (Tokyo Ghoul)",
        "Hinami (Tokyo Ghoul)"
    ],
    [
        "Arima (Tokyo Ghoul)",
        "Juuzou (Tokyo Ghoul)"
    ],
    [
        "Amon (Tokyo Ghoul)",
        "Akira (Tokyo Ghoul)"
    ],
    [
        "Eto (Tokyo Ghoul)",
        "Yoshimura (Tokyo Ghoul)"
    ],
    [
        "Tsukiyama (Tokyo Ghoul)",
        "Nishiki (Tokyo Ghoul)"
    ],
    [
        "Ayato (Tokyo Ghoul)",
        "Touka (Tokyo Ghoul)"
    ],
    [
        "Rize (Tokyo Ghoul)",
        "Kaneki (Tokyo Ghoul)"
    ],
    [
        "CCG (Tokyo Ghoul)",
        "Aogiri (Tokyo Ghoul)"
    ],
    [
        "Quinque (Tokyo Ghoul)",
        "Kagune (Tokyo Ghoul)"
    ],
    [
        "Kakuja (Tokyo Ghoul)",
        "Kagune (Tokyo Ghoul)"
    ],
    [
        "Takemichi (Tokyo Revengers)",
        "Chifuyu (Tokyo Revengers)"
    ],
    [
        "Mikey (Tokyo Revengers)",
        "Draken (Tokyo Revengers)"
    ],
    [
        "Baji (Tokyo Revengers)",
        "Kazutora (Tokyo Revengers)"
    ],
    [
        "Mitsuya (Tokyo Revengers)",
        "Hakkai (Tokyo Revengers)"
    ],
    [
        "Angry (Tokyo Revengers)",
        "Smiley (Tokyo Revengers)"
    ],
    [
        "Taiju (Tokyo Revengers)",
        "South (Tokyo Revengers)"
    ],
    [
        "Kisaki (Tokyo Revengers)",
        "Hanma (Tokyo Revengers)"
    ],
    [
        "Izana (Tokyo Revengers)",
        "Kakucho (Tokyo Revengers)"
    ],
    [
        "Emma (Tokyo Revengers)",
        "Hina (Tokyo Revengers)"
    ],
    [
        "Toman (Tokyo Revengers)",
        "Tenjiku (Tokyo Revengers)"
    ],
    [
        "Black Dragons (Tokyo Revengers)",
        "Valhalla (Tokyo Revengers)"
    ]
];

// Liste Undercover Hardcore (Tous les persos avec leur anime)
const undercoverHardcorePool = [
    // Naruto
    "Naruto Uzumaki (Naruto)", "Sasuke Uchiwa (Naruto)", "Sakura Haruno (Naruto)", "Kakashi Hatake (Naruto)", "Itachi Uchiwa (Naruto)", "Gaara (Naruto)", "Jiraya (Naruto)", "Hinata Hyûga (Naruto)", "Madara Uchiwa (Naruto)", "Orochimaru (Naruto)", "Pain (Nagato) (Naruto)", "Shikamaru Nara (Naruto)", "Rock Lee (Naruto)", "Neji Hyûga (Naruto)", "Minato Namikaze (Naruto)", "Obito Uchiwa (Naruto)", "Tsunade (Naruto)", "Might Guy (Naruto)", "Killer B (Naruto)", "Shisui Uchiwa (Naruto)", "Deidara (Naruto)", "Kisame Hoshigaki (Naruto)", "Sasori (Naruto)", "Konan (Naruto)", "Kabuto Yakushi (Naruto)", "Hashirama Senju (Naruto)", "Tobirama Senju (Naruto)", "Hiruzen Sarutobi (Naruto)", "Temari (Naruto)", "Kankurô (Naruto)", "Sai (Naruto)", "Yamato (Naruto)", "Konohamaru Sarutobi (Naruto)", "Ino Yamanaka (Naruto)", "Choji Akimichi (Naruto)", "Tenten (Naruto)", "Kiba Inuzuka (Naruto)", "Shino Aburame (Naruto)", "Zabuza Momochi (Naruto)", "Haku (Naruto)", "Danzo Shimura (Naruto)", "Asuma Sarutobi (Naruto)", "Iruka Umino (Naruto)", "Kurenai Yûhi (Naruto)", "Onoki (Naruto)", "Mei Terumi (Naruto)", "Momoshiki Otsutsuki (Naruto)", "Kaguya Otsutsuki (Naruto)", "Kurama (Naruto)", "Shikaku Nara (Naruto)",
    // One Piece
    "Monkey D. Luffy (One Piece)", "Roronoa Zoro (One Piece)", "Nami (One Piece)", "Sanji (One Piece)", "Tony Tony Chopper (One Piece)", "Nico Robin (One Piece)", "Usopp (One Piece)", "Trafalgar Law (One Piece)", "Portgas D. Ace (One Piece)", "Shanks (One Piece)", "Sabo (One Piece)", "Boa Hancock (One Piece)", "Dracule Mihawk (One Piece)", "Marshall D. Teach (Barbe Noire) (One Piece)", "Edward Newgate (Barbe Blanche) (One Piece)", "Gol D. Roger (One Piece)", "Kaido (One Piece)", "Charlotte Linlin (Big Mom) (One Piece)", "Eustass Kid (One Piece)", "Donquixote Doflamingo (One Piece)", "Crocodile (One Piece)", "Buggy (One Piece)", "Jinbe (One Piece)", "Franky (One Piece)", "Brook (One Piece)", "Marco (One Piece)", "Silvers Rayleigh (One Piece)", "Monkey D. Dragon (One Piece)", "Monkey D. Garp (One Piece)", "Sengoku (One Piece)", "Akainu (One Piece)", "Aokiji (One Piece)", "Kizaru (One Piece)", "Rob Lucci (One Piece)", "Enel (One Piece)", "Katakuri (One Piece)", "Yamato (One Piece)", "Kozuki Oden (One Piece)", "Momonosuke (One Piece)",
    // Bleach
    "Ichigo Kurosaki (Bleach)", "Rukia Kuchiki (Bleach)", "Orihime Inoue (Bleach)", "Uryū Ishida (Bleach)", "Renji Abarai (Bleach)", "Byakuya Kuchiki (Bleach)", "Toshiro Hitsugaya (Bleach)", "Kenpachi Zaraki (Bleach)", "Sosuke Aizen (Bleach)", "Kisuke Urahara (Bleach)", "Yoruichi Shihōin (Bleach)", "Shunsui Kyōraku (Bleach)", "Mayuri Kurotsuchi (Bleach)", "Retsu Unohana (Bleach)", "Genryūsai Yamamoto (Bleach)", "Ichimaru Gin (Bleach)", "Ulquiorra Cifer (Bleach)", "Grimmjow Jaegerjaquez (Bleach)", "Coyote Starrk (Bleach)", "Nelliel Tu Odelschwanck (Bleach)", "Yhwach (Bleach)", "Jugram Haschwalth (Bleach)", "Bambietta Basterbine (Bleach)", "As Nodt (Bleach)", "Bazz-B (Bleach)", "Lille Barro (Bleach)", "Gerard Valkyrie (Bleach)", "Gremmy Thoumeaux (Bleach)", "Shinji Hirako (Bleach)", "Kensei Muguruma (Bleach)", "Hiyori Sarugaki (Bleach)", "Love Aikawa (Bleach)", "Isshin Kurosaki (Bleach)", "Jūshirō Ukitake (Bleach)", "Sajin Komamura (Bleach)", "Soi Fon (Bleach)", "Rangiku Matsumoto (Bleach)", "Izuru Kira (Bleach)", "Ikkaku Madarame (Bleach)", "Yumichika Ayasegawa (Bleach)", "Yasutora Sado (Chad) (Bleach)", "Tessai Tsukabishi (Bleach)", "Kon (Bleach)", "Don Kanonji (Bleach)", "Shukuro Tsukishima (Bleach)",
    // Black Clover
    "Asta (Black Clover)", "Yuno (Black Clover)", "Noelle Silva (Black Clover)", "Yami Sukehiro (Black Clover)", "Julius Novachrono (Black Clover)", "Mereoleona Vermillion (Black Clover)", "Nacht Faust (Black Clover)", "Luck Voltia (Black Clover)", "Magna Swing (Black Clover)", "Vanessa Enoteca (Black Clover)", "Finral Roulacase (Black Clover)", "Charmy Pappitson (Black Clover)", "Gauche Adlai (Black Clover)", "Gordon Agrippa (Black Clover)", "Grey (Black Clover)", "Nozel Silva (Black Clover)", "Fuegoleon Vermillion (Black Clover)", "Leopold Vermillion (Black Clover)", "Mimosa Vermillion (Black Clover)", "Charlotte Roselei (Black Clover)", "William Vangeance (Black Clover)", "Rill Boismortier (Black Clover)", "Dorothy Unsworth (Black Clover)", "Jack the Ripper (Black Clover)", "Kaiser Granvorka (Black Clover)", "Sekke Bronzazza (Black Clover)", "Langris Vaude (Black Clover)", "Zora Ideale (Black Clover)", "Patolli (Black Clover)", "Licht (Black Clover)", "Zagred (Black Clover)", "Liebe (Black Clover)", "Dante Zogratis (Black Clover)", "Vanica Zogratis (Black Clover)", "Zenon Zogratis (Black Clover)", "Lucifero (Black Clover)", "Morris Libardirt (Black Clover)", "Megicula (Black Clover)", "Lucius Zogratis (Black Clover)", "Adrammelech (Black Clover)", "Mars (Black Clover)", "Fana (Black Clover)", "Ladros (Black Clover)", "Vetto (Black Clover)", "Sally (Black Clover)", "Rhya (Black Clover)", "Kirsch Vermillion (Black Clover)", "Sol Marron (Black Clover)", "Sister Lily (Black Clover)",
    // Seven Deadly Sins
    "Meliodas (Seven Deadly Sins)", "Elizabeth Liones (Seven Deadly Sins)", "Ban (Seven Deadly Sins)", "King (Seven Deadly Sins)", "Diane (Seven Deadly Sins)", "Gowther (Seven Deadly Sins)", "Merlin (Seven Deadly Sins)", "Escanor (Seven Deadly Sins)", "Hawk (Seven Deadly Sins)", "Zeldris (Seven Deadly Sins)", "Estarossa (Seven Deadly Sins)", "Mael (Seven Deadly Sins)", "Arthur Pendragon (Seven Deadly Sins)", "Ludociel (Seven Deadly Sins)", "Sariel (Seven Deadly Sins)", "Tarmiel (Seven Deadly Sins)", "Monspeet (Seven Deadly Sins)", "Derieri (Seven Deadly Sins)", "Drole (Seven Deadly Sins)", "Gloxinia (Seven Deadly Sins)", "Chandler (Seven Deadly Sins)", "Cusack (Seven Deadly Sins)", "Zaratras (Seven Deadly Sins)", "Hendrickson (Seven Deadly Sins)", "Dreyfus (Seven Deadly Sins)", "Gilthunder (Seven Deadly Sins)", "Howzer (Seven Deadly Sins)", "Griamore (Seven Deadly Sins)", "Veronica Liones (Seven Deadly Sins)", "Margaret Liones (Seven Deadly Sins)", "Jericho (Seven Deadly Sins)", "Guila (Seven Deadly Sins)", "Helbram (Seven Deadly Sins)", "Elaine (Seven Deadly Sins)", "Fraudrin (Seven Deadly Sins)", "Grayroad (Seven Deadly Sins)", "Galand (Seven Deadly Sins)", "Melascula (Seven Deadly Sins)", "Gray Demon (Seven Deadly Sins)", "Demon King (Seven Deadly Sins)", "Supreme Deity (Seven Deadly Sins)", "Cath (Seven Deadly Sins)", "Tristan Liones (Seven Deadly Sins)", "Percival (Seven Deadly Sins)", "Lancelot (Seven Deadly Sins)", "Donny (Seven Deadly Sins)",
    // Fairy Tail
    "Natsu Dragneel (Fairy Tail)", "Lucy Heartfilia (Fairy Tail)", "Erza Scarlet (Fairy Tail)", "Gray Fullbuster (Fairy Tail)", "Wendy Marvell (Fairy Tail)", "Happy (Fairy Tail)", "Gajeel Redfox (Fairy Tail)", "Juvia Lockser (Fairy Tail)", "Mirajane Strauss (Fairy Tail)", "Laxus Dreyar (Fairy Tail)", "Makarov Dreyar (Fairy Tail)", "Zeref Dragneel (Fairy Tail)", "Acnologia (Fairy Tail)", "Gildarts Clive (Fairy Tail)", "Cana Alberona (Fairy Tail)", "Levy McGarden (Fairy Tail)", "Elfman Strauss (Fairy Tail)", "Lisanna Strauss (Fairy Tail)", "Sting Eucliffe (Fairy Tail)", "Rogue Cheney (Fairy Tail)", "Carla (Fairy Tail)", "Panther Lily (Fairy Tail)", "Mavis Vermillion (Fairy Tail)", "Ultear Milkovich (Fairy Tail)", "Jellal Fernandes (Fairy Tail)", "Hades (Fairy Tail)", "Jose Porla (Fairy Tail)", "Cobra / Erik (Fairy Tail)", "Minerva Orland (Fairy Tail)", "Kagura Mikazuchi (Fairy Tail)", "Brandish μ (Fairy Tail)", "Irene Belserion (Fairy Tail)", "August (Fairy Tail)", "Dimaria Yesta (Fairy Tail)", "Larcade Dragneel (Fairy Tail)", "God Serena (Fairy Tail)", "Mard Geer (Fairy Tail)", "Jackal (Fairy Tail)", "Kyôka (Fairy Tail)", "Flare Corona (Fairy Tail)", "Lucy Ashley (Fairy Tail)", "Romeo Conbolt (Fairy Tail)", "Macao Conbolt (Fairy Tail)", "Wakaba Mine (Fairy Tail)", "Ichiya Vandalay Kotobuki (Fairy Tail)", "Freed Justine (Fairy Tail)", "Evergreen (Fairy Tail)", "Bickslow (Fairy Tail)", "Mystogan (Fairy Tail)",
    // Death Note
    "Light Yagami (Death Note)", "L (Death Note)", "Misa Amane (Death Note)", "Ryuk (Death Note)", "Near (Death Note)",
    // SAO
    "Kirito (SAO)", "Asuna Yuuki (SAO)", "Sinon (SAO)", "Alice Zuberg (SAO)", "Eugeo (SAO)", "Leafa (SAO)", "Yui (SAO)", "Klein (SAO)", "Agil (SAO)", "Lisbeth (SAO)",
    // MHA
    "Izuku Midoriya (MHA)", "Katsuki Bakugo (MHA)", "Shoto Todoroki (MHA)", "Ochaco Uraraka (MHA)", "All Might (MHA)", "Tomura Shigaraki (MHA)", "Dabi (MHA)", "Himiko Toga (MHA)", "Endeavor (MHA)", "Eijiro Kirishima (MHA)", "Tenya Iida (MHA)", "Tsuyu Asui (MHA)", "Momo Yaoyorozu (MHA)", "Fumikage Tokoyami (MHA)", "Denki Kaminari (MHA)", "Mina Ashido (MHA)", "Yuga Aoyama (MHA)", "Minoru Mineta (MHA)", "Kyoka Jiro (MHA)", "Hanta Sero (MHA)", "Mezo Shoji (MHA)", "Mashirao Ojiro (MHA)", "Toru Hagakure (MHA)", "Rikido Sato (MHA)", "Koji Koda (MHA)", "Mirio Togata (MHA)", "Tamaki Amajiki (MHA)", "Nejire Hado (MHA)", "Shota Aizawa (MHA)", "Present Mic (MHA)", "Hawks (MHA)", "Mirko (MHA)", "Best Jeanist (MHA)", "Mt. Lady (MHA)", "Gran Torino (MHA)", "Sir Nighteye (MHA)", "Stain (MHA)", "Overhaul (MHA)", "Twice (MHA)", "Mr. Compress (MHA)", "Spinner (MHA)", "Kurogiri (MHA)", "Lady Nagant (MHA)", "Gentle Criminal (MHA)", "La Brava (MHA)", "Star and Stripe (MHA)", "All For One (MHA)", "Gigantomachia (MHA)", "Eri (MHA)", "Inko Midoriya (MHA)",
    // SNK
    "Eren Jäger (SNK)", "Mikasa Ackerman (SNK)", "Armin Arlert (SNK)", "Levi Ackerman (SNK)", "Erwin Smith (SNK)", "Reiner Braun (SNK)", "Annie Leonhart (SNK)", "Historia Reiss (SNK)", "Jean Kirstein (SNK)", "Sasha Blouse (SNK)", "Hange Zoë (SNK)", "Connie Springer (SNK)", "Bertholdt Hoover (SNK)", "Zeke Jäger (SNK)", "Falco Grice (SNK)", "Gabi Braun (SNK)", "Pieck Finger (SNK)", "Porco Galliard (SNK)", "Ymir (SNK)", "Ymir Fritz (SNK)", "Kenny Ackerman (SNK)", "Grisha Jäger (SNK)", "Carla Jäger (SNK)", "Hannes (SNK)", "Floch Forster (SNK)", "Marco Bott (SNK)", "Petra Ral (SNK)", "Mike Zacharias (SNK)", "Moblit Berner (SNK)",
    // Solo Leveling
    "Sung Jin-Woo (Solo Leveling)", "Cha Hae-In (Solo Leveling)", "Beru (Solo Leveling)", "Igris (Solo Leveling)", "Thomas Andre (Solo Leveling)", "Go Gun-Hee (Solo Leveling)", "Sung Il-Hwan (Solo Leveling)", "Yoo Jin-Ho (Solo Leveling)", "Baek Yoon-Ho (Solo Leveling)", "Choi Jong-In (Solo Leveling)",
    // Demon Slayer
    "Tanjiro Kamado (Demon Slayer)", "Nezuko Kamado (Demon Slayer)", "Zenitsu Agatsuma (Demon Slayer)", "Inosuke Hashibira (Demon Slayer)", "Giyu Tomioka (Demon Slayer)", "Kyojuro Rengoku (Demon Slayer)", "Shinobu Kocho (Demon Slayer)", "Tengen Uzui (Demon Slayer)", "Muichiro Tokito (Demon Slayer)", "Mitsuri Kanroji (Demon Slayer)", "Sanemi Shinazugawa (Demon Slayer)", "Gyomei Himejima (Demon Slayer)", "Obanai Iguro (Demon Slayer)", "Akaza (Demon Slayer)", "Muzan Kibutsuji (Demon Slayer)", "Doma (Demon Slayer)", "Kokushibo (Demon Slayer)", "Genya Shinazugawa (Demon Slayer)", "Kanao Tsuyuri (Demon Slayer)", "Aoi Kanzaki (Demon Slayer)",
    // JJK
    "Satoru Gojo (JJK)", "Yuji Itadori (JJK)", "Megumi Fushiguro (JJK)", "Nobara Kugisaki (JJK)", "Ryomen Sukuna (JJK)", "Yuta Okkotsu (JJK)", "Suguru Geto (JJK)", "Toji Fushiguro (JJK)", "Maki Zenin (JJK)", "Kento Nanami (JJK)", "Aoi Todo (JJK)", "Mahito (JJK)", "Kenjaku (JJK)", "Choso (JJK)", "Toge Inumaki (JJK)", "Panda (JJK)", "Mei Mei (JJK)", "Ui Ui (JJK)", "Shoko Ieiri (JJK)", "Masamichi Yaga (JJK)",
    // Assassination Classroom
    "Koro-sensei (Assassination Classroom)", "Nagisa Shiota (Assassination Classroom)", "Karma Akabane (Assassination Classroom)", "Kaede Kayano (Assassination Classroom)", "Tadaomi Karasuma (Assassination Classroom)", "Irina Jelavić (Assassination Classroom)", "Gakushu Asano (Assassination Classroom)", "Manami Okuda (Assassination Classroom)", "Rio Nakamura (Assassination Classroom)",
    // Classroom of the Elite
    "Kiyotaka Ayanokoji (Classroom of the Elite)", "Suzune Horikita (Classroom of the Elite)", "Kei Karuizawa (Classroom of the Elite)", "Arisu Sakayanagi (Classroom of the Elite)", "Kakeru Ryuen (Classroom of the Elite)", "Honami Ichinose (Classroom of the Elite)",
    // Hunter x Hunter
    "Gon Freecss (Hunter x Hunter)", "Killua Zoldyck (Hunter x Hunter)", "Kurapika (Hunter x Hunter)", "Leorio Paradinight (Hunter x Hunter)", "Hisoka Morow (Hunter x Hunter)", "Chrollo Lucilfer (Hunter x Hunter)", "Meruem (Hunter x Hunter)", "Isaac Netero (Hunter x Hunter)", "Illumi Zoldyck (Hunter x Hunter)", "Biscuit Krueger (Hunter x Hunter)", "Ging Freecss (Hunter x Hunter)", "Kite (Hunter x Hunter)", "Feitan Portor (Hunter x Hunter)", "Shalnark (Hunter x Hunter)", "Machi Komacine (Hunter x Hunter)", "Nobunaga Hazama (Hunter x Hunter)", "Franklin Bordeau (Hunter x Hunter)", "Phinks Magcub (Hunter x Hunter)", "Shizuku Murasaki (Hunter x Hunter)", "Pakunoda (Hunter x Hunter)", "Uvogin (Hunter x Hunter)", "Kalluto Zoldyck (Hunter x Hunter)", "Silva Zoldyck (Hunter x Hunter)", "Zeno Zoldyck (Hunter x Hunter)", "Kikyo Zoldyck (Hunter x Hunter)", "Alluka Zoldyck (Hunter x Hunter)", "Nanika (Hunter x Hunter)", "Menthuthuyoupi (Hunter x Hunter)", "Shaiapouf (Hunter x Hunter)", "Neferpitou (Hunter x Hunter)", "Komugi (Hunter x Hunter)", "Colt (Hunter x Hunter)", "Morel Mackernasey (Hunter x Hunter)", "Knov (Hunter x Hunter)", "Knuckle Bine (Hunter x Hunter)", "Shoot McMahon (Hunter x Hunter)", "Palm Siberia (Hunter x Hunter)", "Gon’s Adult Form (Hunter x Hunter)", "Razor (Hunter x Hunter)", "Genthru (Hunter x Hunter)", "Greed Island’s Tzesguerra (Hunter x Hunter)", "Kite’s Crazy Slots (Hunter x Hunter)", "Hanzo (Hunter x Hunter)", "Tonpa (Hunter x Hunter)", "Canary (Hunter x Hunter)", "Gotoh (Hunter x Hunter)", "Amane (Hunter x Hunter)", "Gyro (Hunter x Hunter)", "Pariston Hill (Hunter x Hunter)", "Beyond Netero (Hunter x Hunter)",
    // One Punch Man
    "Saitama (One Punch Man)", "Genos (One Punch Man)", "Tatsumaki (One Punch Man)", "Garou (One Punch Man)", "King (One Punch Man)", "Fubuki (One Punch Man)",
    // Chainsaw Man
    "Denji (Chainsaw Man)", "Makima (Chainsaw Man)", "Power (Chainsaw Man)", "Aki Hayakawa (Chainsaw Man)", "Reze (Chainsaw Man)", "Pochita (Chainsaw Man)", "Kobeni Higashiyama (Chainsaw Man)", "Kishibe (Chainsaw Man)", "Himeno (Chainsaw Man)", "Asa Mitaka (Chainsaw Man)", "Yoru (Chainsaw Man)",
    // Tokyo Ghoul
    "Ken Kaneki (Tokyo Ghoul)", "Touka Kirishima (Tokyo Ghoul)", "Rize Kamishiro (Tokyo Ghoul)", "Hideyoshi Nagachika (Tokyo Ghoul)"
];



// Extension Hardcore : personnages issus des nouveaux univers Rolland Garos
undercoverHardcorePool.push(
    "Gon Freecss (Hunter x Hunter)",
    "Killua Zoldyck (Hunter x Hunter)",
    "Kurapika (Hunter x Hunter)",
    "Leorio Paradinight (Hunter x Hunter)",
    "Hisoka Morow (Hunter x Hunter)",
    "Illumi Zoldyck (Hunter x Hunter)",
    "Ging Freecss (Hunter x Hunter)",
    "Kite (Hunter x Hunter)",
    "Biscuit Krueger (Hunter x Hunter)",
    "Isaac Netero (Hunter x Hunter)",
    "Zeno Zoldyck (Hunter x Hunter)",
    "Silva Zoldyck (Hunter x Hunter)",
    "Kikyo Zoldyck (Hunter x Hunter)",
    "Milluki Zoldyck (Hunter x Hunter)",
    "Alluka Zoldyck (Hunter x Hunter)",
    "Nanika (Hunter x Hunter)",
    "Kalluto Zoldyck (Hunter x Hunter)",
    "Gotoh (Hunter x Hunter)",
    "Canary (Hunter x Hunter)",
    "Tsubone (Hunter x Hunter)",
    "Eren Jäger (SNK / L'Attaque des Titans)",
    "Mikasa Ackerman (SNK / L'Attaque des Titans)",
    "Armin Arlert (SNK / L'Attaque des Titans)",
    "Levi Ackerman (SNK / L'Attaque des Titans)",
    "Erwin Smith (SNK / L'Attaque des Titans)",
    "Hange Zoë (SNK / L'Attaque des Titans)",
    "Jean Kirstein (SNK / L'Attaque des Titans)",
    "Connie Springer (SNK / L'Attaque des Titans)",
    "Sasha Blouse (SNK / L'Attaque des Titans)",
    "Historia Reiss (SNK / L'Attaque des Titans)",
    "Ymir (SNK / L'Attaque des Titans)",
    "Reiner Braun (SNK / L'Attaque des Titans)",
    "Bertholdt Hoover (SNK / L'Attaque des Titans)",
    "Annie Leonhart (SNK / L'Attaque des Titans)",
    "Marco Bott (SNK / L'Attaque des Titans)",
    "Floch Forster (SNK / L'Attaque des Titans)",
    "Petra Ral (SNK / L'Attaque des Titans)",
    "Oluo Bozado (SNK / L'Attaque des Titans)",
    "Eld Jinn (SNK / L'Attaque des Titans)",
    "Gunther Schultz (SNK / L'Attaque des Titans)",
    "Light Yagami (Death Note)",
    "L Lawliet (Death Note)",
    "Misa Amane (Death Note)",
    "Ryuk (Death Note)",
    "Rem (Death Note)",
    "Near (Death Note)",
    "Mello (Death Note)",
    "Soichiro Yagami (Death Note)",
    "Sachiko Yagami (Death Note)",
    "Sayu Yagami (Death Note)",
    "Touta Matsuda (Death Note)",
    "Shuichi Aizawa (Death Note)",
    "Kanzo Mogi (Death Note)",
    "Hideki Ide (Death Note)",
    "Hirokazu Ukita (Death Note)",
    "Watari (Death Note)",
    "Teru Mikami (Death Note)",
    "Kiyomi Takada (Death Note)",
    "Naomi Misora (Death Note)",
    "Raye Penber (Death Note)",
    "Kiyotaka Ayanokoji (Classroom of the Elite)",
    "Suzune Horikita (Classroom of the Elite)",
    "Manabu Horikita (Classroom of the Elite)",
    "Kikyo Kushida (Classroom of the Elite)",
    "Kei Karuizawa (Classroom of the Elite)",
    "Yosuke Hirata (Classroom of the Elite)",
    "Ken Sudo (Classroom of the Elite)",
    "Kanji Ike (Classroom of the Elite)",
    "Haruki Yamauchi (Classroom of the Elite)",
    "Airi Sakura (Classroom of the Elite)",
    "Akito Miyake (Classroom of the Elite)",
    "Haruka Hasebe (Classroom of the Elite)",
    "Keisei Yukimura (Classroom of the Elite)",
    "Chiaki Matsushita (Classroom of the Elite)",
    "Maya Sato (Classroom of the Elite)",
    "Kokoro Inogashira (Classroom of the Elite)",
    "Rokusuke Koenji (Classroom of the Elite)",
    "Arisu Sakayanagi (Classroom of the Elite)",
    "Kohei Katsuragi (Classroom of the Elite)",
    "Masayoshi Hashimoto (Classroom of the Elite)",
    "Sung Jinwoo (Solo Leveling)",
    "Sung Jinah (Solo Leveling)",
    "Park Kyung-Hye (Solo Leveling)",
    "Yoo Jinho (Solo Leveling)",
    "Cha Hae-In (Solo Leveling)",
    "Lee Joohee (Solo Leveling)",
    "Song Chi-Yul (Solo Leveling)",
    "Kim Sangshik (Solo Leveling)",
    "Hwang Dongsuk (Solo Leveling)",
    "Kang Taeshik (Solo Leveling)",
    "Hwang Dongsoo (Solo Leveling)",
    "Baek Yoonho (Solo Leveling)",
    "Choi Jong-In (Solo Leveling)",
    "Woo Jinchul (Solo Leveling)",
    "Go Gunhee (Solo Leveling)",
    "Lim Tae-Gyu (Solo Leveling)",
    "Ma Dongwook (Solo Leveling)",
    "Min Byung-Gyu (Solo Leveling)",
    "Thomas Andre (Solo Leveling)",
    "Liu Zhigang (Solo Leveling)",
    "Shinra Kusakabe (Fire Force)",
    "Arthur Boyle (Fire Force)",
    "Maki Oze (Fire Force)",
    "Tamaki Kotatsu (Fire Force)",
    "Akitaru Obi (Fire Force)",
    "Takehisa Hinawa (Fire Force)",
    "Iris (Fire Force)",
    "Viktor Licht (Fire Force)",
    "Vulcan Joseph (Fire Force)",
    "Lisa Isaribe (Fire Force)",
    "Yu (Fire Force)",
    "Benimaru Shinmon (Fire Force)",
    "Konro Sagamiya (Fire Force)",
    "Hibana (Fire Force)",
    "Karim Flam (Fire Force)",
    "Rekka Hoshimiya (Fire Force)",
    "Leonard Burns (Fire Force)",
    "Ogun Montgomery (Fire Force)",
    "Pan Ko Paat (Fire Force)",
    "Joker (Fire Force)",
    "Rudeus Greyrat (Mushoku Tensei)",
    "Roxy Migurdia (Mushoku Tensei)",
    "Sylphiette (Mushoku Tensei)",
    "Eris Boreas Greyrat (Mushoku Tensei)",
    "Paul Greyrat (Mushoku Tensei)",
    "Zenith Greyrat (Mushoku Tensei)",
    "Lilia Greyrat (Mushoku Tensei)",
    "Norn Greyrat (Mushoku Tensei)",
    "Aisha Greyrat (Mushoku Tensei)",
    "Ruijerd Superdia (Mushoku Tensei)",
    "Ghislaine Dedoldia (Mushoku Tensei)",
    "Orsted (Mushoku Tensei)",
    "Nanahoshi Shizuka (Mushoku Tensei)",
    "Hitogami (Mushoku Tensei)",
    "Kishirika Kishirisu (Mushoku Tensei)",
    "Badigadi (Mushoku Tensei)",
    "Atofe (Mushoku Tensei)",
    "Ariel Anemoi Asura (Mushoku Tensei)",
    "Luke Notos Greyrat (Mushoku Tensei)",
    "Cliff Grimoire (Mushoku Tensei)",
    "Subaru Natsuki (Re:Zero)",
    "Emilia (Re:Zero)",
    "Rem (Re:Zero)",
    "Ram (Re:Zero)",
    "Beatrice (Re:Zero)",
    "Roswaal L. Mathers (Re:Zero)",
    "Puck (Re:Zero)",
    "Otto Suwen (Re:Zero)",
    "Garfiel Tinsel (Re:Zero)",
    "Frederica Baumann (Re:Zero)",
    "Petra Leyte (Re:Zero)",
    "Patrasche (Re:Zero)",
    "Reinhard van Astrea (Re:Zero)",
    "Felt (Re:Zero)",
    "Crusch Karsten (Re:Zero)",
    "Felix Argyle (Re:Zero)",
    "Wilhelm van Astrea (Re:Zero)",
    "Theresia van Astrea (Re:Zero)",
    "Anastasia Hoshin (Re:Zero)",
    "Julius Juukulius (Re:Zero)",
    "Yoichi Isagi (Blue Lock)",
    "Meguru Bachira (Blue Lock)",
    "Rensuke Kunigami (Blue Lock)",
    "Hyoma Chigiri (Blue Lock)",
    "Shoei Barou (Blue Lock)",
    "Seishiro Nagi (Blue Lock)",
    "Reo Mikage (Blue Lock)",
    "Rin Itoshi (Blue Lock)",
    "Sae Itoshi (Blue Lock)",
    "Ryusei Shidou (Blue Lock)",
    "Jyubei Aryu (Blue Lock)",
    "Aoshi Tokimitsu (Blue Lock)",
    "Gin Gagamaru (Blue Lock)",
    "Ikki Niko (Blue Lock)",
    "Raichi Jingo (Blue Lock)",
    "Gurimu Igarashi (Blue Lock)",
    "Asahi Naruhaya (Blue Lock)",
    "Wataru Kuon (Blue Lock)",
    "Yudai Imamura (Blue Lock)",
    "Junichi Wanima (Blue Lock)",
    "Edward Elric (Fullmetal Alchemist)",
    "Alphonse Elric (Fullmetal Alchemist)",
    "Winry Rockbell (Fullmetal Alchemist)",
    "Pinako Rockbell (Fullmetal Alchemist)",
    "Van Hohenheim (Fullmetal Alchemist)",
    "Trisha Elric (Fullmetal Alchemist)",
    "Roy Mustang (Fullmetal Alchemist)",
    "Riza Hawkeye (Fullmetal Alchemist)",
    "Jean Havoc (Fullmetal Alchemist)",
    "Heymans Breda (Fullmetal Alchemist)",
    "Vato Falman (Fullmetal Alchemist)",
    "Kain Fuery (Fullmetal Alchemist)",
    "Maes Hughes (Fullmetal Alchemist)",
    "Gracia Hughes (Fullmetal Alchemist)",
    "Elicia Hughes (Fullmetal Alchemist)",
    "Alex Louis Armstrong (Fullmetal Alchemist)",
    "Olivier Mira Armstrong (Fullmetal Alchemist)",
    "Buccaneer (Fullmetal Alchemist)",
    "Miles (Fullmetal Alchemist)",
    "Grumman (Fullmetal Alchemist)",
    "Denji (Chainsaw Man)",
    "Pochita (Chainsaw Man)",
    "Power (Chainsaw Man)",
    "Aki Hayakawa (Chainsaw Man)",
    "Makima (Chainsaw Man)",
    "Kobeni Higashiyama (Chainsaw Man)",
    "Himeno (Chainsaw Man)",
    "Kishibe (Chainsaw Man)",
    "Hirokazu Arai (Chainsaw Man)",
    "Madoka (Chainsaw Man)",
    "Reze (Chainsaw Man)",
    "Beam (Chainsaw Man)",
    "Angel Devil (Chainsaw Man)",
    "Violence Fiend (Chainsaw Man)",
    "Galgali (Chainsaw Man)",
    "Princi (Chainsaw Man)",
    "Future Devil (Chainsaw Man)",
    "Curse Devil (Chainsaw Man)",
    "Fox Devil (Chainsaw Man)",
    "Ghost Devil (Chainsaw Man)",
    "Yugo (Wakfu)",
    "Tristepin de Percedal (Wakfu)",
    "Amalia Sheran Sharm (Wakfu)",
    "Evangelyne (Wakfu)",
    "Ruel Stroud (Wakfu)",
    "Adamai (Wakfu)",
    "Az (Wakfu)",
    "Grougaloragran (Wakfu)",
    "Alibert (Wakfu)",
    "Qilby (Wakfu)",
    "Shinonome (Wakfu)",
    "Phaeris (Wakfu)",
    "Chibi (Wakfu)",
    "Mina (Wakfu)",
    "Glip (Wakfu)",
    "Baltazar (Wakfu)",
    "Nox (Wakfu)",
    "Oropo (Wakfu)",
    "Echo (Wakfu)",
    "Harebourg (Wakfu)",
    "Tanjiro Kamado (Demon Slayer)",
    "Nezuko Kamado (Demon Slayer)",
    "Zenitsu Agatsuma (Demon Slayer)",
    "Inosuke Hashibira (Demon Slayer)",
    "Kanao Tsuyuri (Demon Slayer)",
    "Genya Shinazugawa (Demon Slayer)",
    "Murata (Demon Slayer)",
    "Aoi Kanzaki (Demon Slayer)",
    "Giyu Tomioka (Demon Slayer)",
    "Kyojuro Rengoku (Demon Slayer)",
    "Tengen Uzui (Demon Slayer)",
    "Shinobu Kocho (Demon Slayer)",
    "Mitsuri Kanroji (Demon Slayer)",
    "Muichiro Tokito (Demon Slayer)",
    "Sanemi Shinazugawa (Demon Slayer)",
    "Gyomei Himejima (Demon Slayer)",
    "Obanai Iguro (Demon Slayer)",
    "Kanae Kocho (Demon Slayer)",
    "Kagaya Ubuyashiki (Demon Slayer)",
    "Amane Ubuyashiki (Demon Slayer)",
    "Pikachu (Pokémon)",
    "Raichu (Pokémon)",
    "Bulbasaur (Pokémon)",
    "Ivysaur (Pokémon)",
    "Venusaur (Pokémon)",
    "Charmander (Pokémon)",
    "Charmeleon (Pokémon)",
    "Charizard (Pokémon)",
    "Squirtle (Pokémon)",
    "Wartortle (Pokémon)",
    "Blastoise (Pokémon)",
    "Caterpie (Pokémon)",
    "Butterfree (Pokémon)",
    "Pidgeot (Pokémon)",
    "Rattata (Pokémon)",
    "Spearow (Pokémon)",
    "Ekans (Pokémon)",
    "Arbok (Pokémon)",
    "Sandshrew (Pokémon)",
    "Nidoran (Pokémon)",
    "Goku (Dragon Ball)",
    "Vegeta (Dragon Ball)",
    "Gohan (Dragon Ball)",
    "Goten (Dragon Ball)",
    "Trunks (Dragon Ball)",
    "Future Trunks (Dragon Ball)",
    "Piccolo (Dragon Ball)",
    "Krillin (Dragon Ball)",
    "Tien Shinhan (Dragon Ball)",
    "Chiaotzu (Dragon Ball)",
    "Yamcha (Dragon Ball)",
    "Master Roshi (Dragon Ball)",
    "Bulma (Dragon Ball)",
    "Chi-Chi (Dragon Ball)",
    "Videl (Dragon Ball)",
    "Pan (Dragon Ball)",
    "Mr. Satan (Dragon Ball)",
    "Majin Buu (Dragon Ball)",
    "Uub (Dragon Ball)",
    "Bardock (Dragon Ball)",
    "Gabimaru (Hell's Paradise)",
    "Yamada Asaemon Sagiri (Hell's Paradise)",
    "Yuzuriha (Hell's Paradise)",
    "Aza Chobei (Hell's Paradise)",
    "Aza Toma (Hell's Paradise)",
    "Tamiya Gantetsusai (Hell's Paradise)",
    "Yamada Asaemon Fuchi (Hell's Paradise)",
    "Yamada Asaemon Shion (Hell's Paradise)",
    "Nurugai (Hell's Paradise)",
    "Yamada Asaemon Tenza (Hell's Paradise)",
    "Yamada Asaemon Senta (Hell's Paradise)",
    "Yamada Asaemon Eizen (Hell's Paradise)",
    "Yamada Asaemon Genji (Hell's Paradise)",
    "Yamada Asaemon Kisho (Hell's Paradise)",
    "Yamada Asaemon Jikka (Hell's Paradise)",
    "Yamada Asaemon Shugen (Hell's Paradise)",
    "Isuzu (Hell's Paradise)",
    "Kiyomaru (Hell's Paradise)",
    "Mei (Hell's Paradise)",
    "Rien (Hell's Paradise)",
    "Rudo (Gachiakuta)",
    "Enjin (Gachiakuta)",
    "Zanka (Gachiakuta)",
    "Riyo (Gachiakuta)",
    "Tamsy (Gachiakuta)",
    "Delmon (Gachiakuta)",
    "Bro (Gachiakuta)",
    "Dear (Gachiakuta)",
    "Guita (Gachiakuta)",
    "Gris (Gachiakuta)",
    "Follo (Gachiakuta)",
    "Tomme (Gachiakuta)",
    "Corvus (Gachiakuta)",
    "Semiu (Gachiakuta)",
    "August (Gachiakuta)",
    "Eishia (Gachiakuta)",
    "Zodyl (Gachiakuta)",
    "Jabber (Gachiakuta)",
    "Cthoni (Gachiakuta)",
    "Noerde (Gachiakuta)",
    "Shoyo Hinata (Haikyuu)",
    "Tobio Kageyama (Haikyuu)",
    "Kei Tsukishima (Haikyuu)",
    "Tadashi Yamaguchi (Haikyuu)",
    "Daichi Sawamura (Haikyuu)",
    "Koshi Sugawara (Haikyuu)",
    "Asahi Azumane (Haikyuu)",
    "Yu Nishinoya (Haikyuu)",
    "Ryunosuke Tanaka (Haikyuu)",
    "Chikara Ennoshita (Haikyuu)",
    "Hisashi Kinoshita (Haikyuu)",
    "Kazuhito Narita (Haikyuu)",
    "Kiyoko Shimizu (Haikyuu)",
    "Hitoka Yachi (Haikyuu)",
    "Ittetsu Takeda (Haikyuu)",
    "Keishin Ukai (Haikyuu)",
    "Toru Oikawa (Haikyuu)",
    "Hajime Iwaizumi (Haikyuu)",
    "Issei Matsukawa (Haikyuu)",
    "Takahiro Hanamaki (Haikyuu)",
    "Yuji Itadori (Jujutsu Kaisen)",
    "Megumi Fushiguro (Jujutsu Kaisen)",
    "Nobara Kugisaki (Jujutsu Kaisen)",
    "Satoru Gojo (Jujutsu Kaisen)",
    "Yuta Okkotsu (Jujutsu Kaisen)",
    "Maki Zenin (Jujutsu Kaisen)",
    "Toge Inumaki (Jujutsu Kaisen)",
    "Panda (Jujutsu Kaisen)",
    "Masamichi Yaga (Jujutsu Kaisen)",
    "Kento Nanami (Jujutsu Kaisen)",
    "Shoko Ieiri (Jujutsu Kaisen)",
    "Kiyotaka Ijichi (Jujutsu Kaisen)",
    "Atsuya Kusakabe (Jujutsu Kaisen)",
    "Aoi Todo (Jujutsu Kaisen)",
    "Mai Zenin (Jujutsu Kaisen)",
    "Kasumi Miwa (Jujutsu Kaisen)",
    "Kokichi Muta (Jujutsu Kaisen)",
    "Mechamaru (Jujutsu Kaisen)",
    "Noritoshi Kamo (Jujutsu Kaisen)",
    "Momo Nishimiya (Jujutsu Kaisen)",
    "Jonathan Joestar (JoJo's Bizarre Adventure)",
    "Joseph Joestar (JoJo's Bizarre Adventure)",
    "Jotaro Kujo (JoJo's Bizarre Adventure)",
    "Josuke Higashikata (JoJo's Bizarre Adventure)",
    "Giorno Giovanna (JoJo's Bizarre Adventure)",
    "Jolyne Cujoh (JoJo's Bizarre Adventure)",
    "Johnny Joestar (JoJo's Bizarre Adventure)",
    "Josuke Higashikata Gappy (JoJo's Bizarre Adventure)",
    "Dio Brando (JoJo's Bizarre Adventure)",
    "Robert E. O. Speedwagon (JoJo's Bizarre Adventure)",
    "Will A. Zeppeli (JoJo's Bizarre Adventure)",
    "Erina Pendleton (JoJo's Bizarre Adventure)",
    "Dire (JoJo's Bizarre Adventure)",
    "Straizo (JoJo's Bizarre Adventure)",
    "Caesar Zeppeli (JoJo's Bizarre Adventure)",
    "Lisa Lisa (JoJo's Bizarre Adventure)",
    "Rudol von Stroheim (JoJo's Bizarre Adventure)",
    "Santana (JoJo's Bizarre Adventure)",
    "Wamuu (JoJo's Bizarre Adventure)",
    "Esidisi (JoJo's Bizarre Adventure)",
    "Rimuru Tempest (Tensura)",
    "Veldora Tempest (Tensura)",
    "Shizue Izawa (Tensura)",
    "Benimaru (Tensura)",
    "Shuna (Tensura)",
    "Shion (Tensura)",
    "Souei (Tensura)",
    "Hakuro (Tensura)",
    "Kurobe (Tensura)",
    "Gobta (Tensura)",
    "Rigurd (Tensura)",
    "Rigur (Tensura)",
    "Ranga (Tensura)",
    "Geld (Tensura)",
    "Gabiru (Tensura)",
    "Diablo (Tensura)",
    "Testarossa (Tensura)",
    "Carrera (Tensura)",
    "Ultima (Tensura)",
    "Zegion (Tensura)",
    "Saitama (One Punch Man)",
    "Genos (One Punch Man)",
    "King (One Punch Man)",
    "Tatsumaki (One Punch Man)",
    "Fubuki (One Punch Man)",
    "Bang (One Punch Man)",
    "Bomb (One Punch Man)",
    "Blast (One Punch Man)",
    "Mumen Rider (One Punch Man)",
    "Atomic Samurai (One Punch Man)",
    "Child Emperor (One Punch Man)",
    "Metal Knight (One Punch Man)",
    "Zombieman (One Punch Man)",
    "Drive Knight (One Punch Man)",
    "Pig God (One Punch Man)",
    "Superalloy Darkshine (One Punch Man)",
    "Watchdog Man (One Punch Man)",
    "Flashy Flash (One Punch Man)",
    "Tanktop Master (One Punch Man)",
    "Metal Bat (One Punch Man)",
    "Kirito (Sword Art Online)",
    "Kazuto Kirigaya (Sword Art Online)",
    "Asuna Yuuki (Sword Art Online)",
    "Leafa (Sword Art Online)",
    "Suguha Kirigaya (Sword Art Online)",
    "Sinon (Sword Art Online)",
    "Shino Asada (Sword Art Online)",
    "Klein (Sword Art Online)",
    "Agil (Sword Art Online)",
    "Yui (Sword Art Online)",
    "Silica (Sword Art Online)",
    "Lisbeth (Sword Art Online)",
    "Sachi (Sword Art Online)",
    "Argo (Sword Art Online)",
    "Diavel (Sword Art Online)",
    "Kibaou (Sword Art Online)",
    "Heathcliff (Sword Art Online)",
    "Akihiko Kayaba (Sword Art Online)",
    "Yuuki Konno (Sword Art Online)",
    "Sakuya (Sword Art Online)",
    "Ken Kaneki (Tokyo Ghoul)",
    "Touka Kirishima (Tokyo Ghoul)",
    "Rize Kamishiro (Tokyo Ghoul)",
    "Hideyoshi Nagachika (Tokyo Ghoul)",
    "Nishiki Nishio (Tokyo Ghoul)",
    "Kimi Nishino (Tokyo Ghoul)",
    "Hinami Fueguchi (Tokyo Ghoul)",
    "Yoshimura (Tokyo Ghoul)",
    "Eto Yoshimura (Tokyo Ghoul)",
    "Ayato Kirishima (Tokyo Ghoul)",
    "Renji Yomo (Tokyo Ghoul)",
    "Shu Tsukiyama (Tokyo Ghoul)",
    "Uta (Tokyo Ghoul)",
    "Itori (Tokyo Ghoul)",
    "Roma Hoito (Tokyo Ghoul)",
    "Kaya Irimi (Tokyo Ghoul)",
    "Enji Koma (Tokyo Ghoul)",
    "Kishou Arima (Tokyo Ghoul)",
    "Juuzou Suzuya (Tokyo Ghoul)",
    "Kotaro Amon (Tokyo Ghoul)",
    "Takemichi Hanagaki (Tokyo Revengers)",
    "Manjiro Sano (Tokyo Revengers)",
    "Mikey (Tokyo Revengers)",
    "Ken Ryuguji (Tokyo Revengers)",
    "Draken (Tokyo Revengers)",
    "Keisuke Baji (Tokyo Revengers)",
    "Chifuyu Matsuno (Tokyo Revengers)",
    "Takashi Mitsuya (Tokyo Revengers)",
    "Kazutora Hanemiya (Tokyo Revengers)",
    "Haruki Hayashida (Tokyo Revengers)",
    "Pah-chin (Tokyo Revengers)",
    "Ryohei Hayashi (Tokyo Revengers)",
    "Peh-yan (Tokyo Revengers)",
    "Nahoya Kawata (Tokyo Revengers)",
    "Smiley (Tokyo Revengers)",
    "Souya Kawata (Tokyo Revengers)",
    "Angry (Tokyo Revengers)",
    "Hakkai Shiba (Tokyo Revengers)",
    "Atsushi Sendo (Tokyo Revengers)",
    "Akkun (Tokyo Revengers)"
);

/* ================= Rolland Garos : listes de personnages ================= */

function parseRGList(raw) {
    return raw.split('\n')
        .map(l => l.replace(/^\s*\d*\.\s*/, '').trim())
        .filter(l => l.length > 0);
}

function normalizeRG(s) {
    return s.toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9 ]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}


// ================= Rolland Garos V11 — anti-doublons / anti-formes =================
// Le Rolland Garos utilise maintenant la liste maître DLE propre :
// 1 personnage réel = 1 seule entrée, même s'il existe sous plusieurs formes,
// surnoms, romanisations ou versions.
function rgStripFormDescriptors(value) {
    let n = normalizeRG(value);

    const patterns = [
        /\bmode baryon\b/g, /\bbaryon mode\b/g,
        /\bmode ermite\b/g, /\bsage mode\b/g,
        /\bmode kurama\b/g, /\bkurama mode\b/g,
        /\bmode kyubi\b/g, /\bkyubi mode\b/g,
        /\bsix paths sage mode\b/g, /\bsix paths\b/g,
        /\brikudo mode\b/g,
        /\bgear\s*(?:2|3|4|5|second|third|fourth|fifth)\b/g,
        /\bsnakeman\b/g, /\bbounceman\b/g, /\btankman\b/g,
        /\bultra instinct\b/g, /\bmastered ultra instinct\b/g, /\bmui\b/g,
        /\bultra ego\b/g,
        /\bsuper saiyan(?:\s*(?:god|blue|rose|[1-4]|ssj\d*))?\b/g,
        /\bssj(?:\s*\d+)?\b/g,
        /\bbankai\b/g, /\bshikai\b/g,
        /\brinnegan\b/g, /\bsharingan\b/g, /\bmangekyo\b/g,
        /\bedo tensei\b/g, /\breanimated\b/g,
        /\bjinchuriki\b/g,
        /\bawakened\b/g, /\beveille\b/g, /\beveil\b/g,
        /\btransformed\b/g, /\btransformation\b/g,
        /\bfinal form\b/g, /\bforme finale\b/g,
        /\bhybrid form\b/g, /\bforme hybride\b/g,
        /\badult\b/g, /\badulte\b/g,
        /\byoung\b/g, /\bjeune\b/g,
        /\bchild\b/g, /\benfant\b/g,
        /\bteen\b/g, /\bteenager\b/g,
        /\bpre timeskip\b/g, /\bpost timeskip\b/g, /\btimeskip\b/g,
        /\bshippuden\b/g, /\bboruto version\b/g,
        /\bmovie version\b/g, /\bfilm version\b/g,
        /\bversion anime\b/g, /\bversion manga\b/g
    ];

    for (const rx of patterns) n = n.replace(rx, ' ');
    return n.replace(/\s+/g, ' ').trim();
}

function rgMasterPoolForUniverse(universeKey, rawFallback) {
    // V12 : pool élargi et nettoyé (fusion liste maître + listes brutes + ajouts, sans doublons ni formes).
    if (typeof RG_POOLS_V2 !== 'undefined' && Array.isArray(RG_POOLS_V2[universeKey]) && RG_POOLS_V2[universeKey].length) {
        return RG_POOLS_V2[universeKey].slice();
    }

    // Repli : liste maître propre/dédoublonnée créée pour le DLE.
    const master = (typeof DLE_MASTER_NAMES !== 'undefined' && Array.isArray(DLE_MASTER_NAMES[universeKey]))
        ? DLE_MASTER_NAMES[universeKey]
        : [];

    const source = master.length ? master : parseRGList(rawFallback);
    const seen = new Set();
    const pool = [];

    for (const rawName of source) {
        const name = String(rawName || '').trim();
        if (!name) continue;

        const norm = normalizeRG(name);
        if (!norm || seen.has(norm)) continue;

        seen.add(norm);
        pool.push(name);
    }

    return pool;
}

function rgApplyKnownAliases(universeKey, value) {
    let n = normalizeRG(value);
    if (!n) return n;

    // Alias propres à l'univers (formes, surnoms, anciennes écritures).
    if (typeof RG_EXTRA_ALIASES !== 'undefined' && RG_EXTRA_ALIASES[universeKey]?.[n]) {
        n = normalizeRG(RG_EXTRA_ALIASES[universeKey][n]);
    }

    // Alias historiques du Rolland Garos.
    if (typeof ALIAS_RG !== 'undefined' && ALIAS_RG[n]) {
        n = normalizeRG(ALIAS_RG[n]);
    }

    // Alias issus du nettoyage DLE (Mikey -> Manjiro, Goku -> Son Goku, etc.).
    if (typeof DLE_MASTER_ALIASES !== 'undefined' && DLE_MASTER_ALIASES[universeKey]?.[n]) {
        n = normalizeRG(DLE_MASTER_ALIASES[universeKey][n]);
    }

    return n;
}

function rgCanonicalInput(universeKey, value, pool) {
    const norms = new Set(pool.map(name => normalizeRG(name)));

    // 0) Nom exact du pool : prioritaire (évite qu'un alias d'un autre univers le détourne,
    //    ex. "Arthur" dans Fire Force ou "Dragon" qui pointaient vers One Piece / SDS).
    const brut = normalizeRG(value);
    if (norms.has(brut)) return brut;

    // 1) Forme brute + alias connus.
    let n = rgApplyKnownAliases(universeKey, value);
    if (norms.has(n)) return n;

    // 2) Retire les descripteurs de formes puis retente les alias.
    const stripped = rgStripFormDescriptors(value);
    if (stripped) {
        n = rgApplyKnownAliases(universeKey, stripped);
        if (norms.has(n)) return n;
    }

    // 3) Si l'utilisateur donne uniquement "Sasuke", "Goku", "Mikey", etc.,
    // on le rattache seulement si UN SEUL personnage du pool correspond.
    for (const candidateToken of [n || normalizeRG(stripped), brut]) {
        if (!candidateToken || candidateToken.includes(' ')) continue;
        const matches = pool.filter(name => normalizeRG(name).split(' ').includes(candidateToken));
        if (matches.length === 1) return normalizeRG(matches[0]);
    }

    return n || normalizeRG(value);
}

// Alias VF / VO connus : les deux écritures sont acceptées indifféremment.
const ALIAS_RG = {
    // --- One Piece ---
    'ener': 'enel', 'eneru': 'enel',
    'baggy': 'buggy', 'baggy le clown': 'buggy',
    'pipo': 'usopp', 'ussop': 'usopp', 'sogeking': 'usopp',
    'zorro': 'roronoa zoro', 'zoro': 'roronoa zoro',
    'luffy': 'monkey d luffy', 'luffy au chapeau de paille': 'monkey d luffy',
    'barbe blanche': 'edward newgate', 'whitebeard': 'edward newgate',
    'barbe noire': 'marshall d teach', 'blackbeard': 'marshall d teach',
    'barbe brune': 'brownbeard',
    'big mom': 'charlotte linlin',
    'akainu': 'sakazuki', 'aokiji': 'kuzan', 'kizaru': 'borsalino',
    'fujitora': 'issho', 'ryokugyu': 'aramaki', 'greenbull': 'aramaki',
    'oeil de faucon': 'dracule mihawk', 'hawkeye': 'dracule mihawk', 'mihawk': 'dracule mihawk',
    'shanks le roux': 'shanks', 'roux': 'shanks',
    'ace': 'portgas d ace', 'ace aux poings ardents': 'portgas d ace',
    'chopper': 'tony tony chopper', 'robin': 'nico robin',
    'law': 'trafalgar d water law', 'trafalgar law': 'trafalgar d water law',
    'kidd': 'eustass kid', 'kid': 'eustass kid',
    'hancock': 'boa hancock', 'doflamingo': 'donquixote doflamingo',
    'corazon': 'donquixote rosinante', 'rosinante': 'donquixote rosinante',
    'dragon': 'monkey d dragon', 'garp': 'monkey d garp',
    'roger': 'gol d roger', 'gold roger': 'gol d roger', 'rayleigh': 'silvers rayleigh',
    'jimbei': 'jinbe', 'jinbei': 'jinbe', 'jambe noire': 'sanji',
    'vivi': 'nefertari vivi', 'crocus': 'crocus',
    'moria': 'gecko moria', 'gekko moria': 'gecko moria',
    'kuma': 'bartholomew kuma', 'ivankov': 'emporio ivankov',
    'bon clay': 'bentham', 'mr 2': 'bentham', 'mr 1': 'daz bonez', 'daz bones': 'daz bonez',
    'mr 3': 'galdino', 'wiper': 'wyper', 'kaidou': 'kaido',
    'lucci': 'rob lucci', 'sabo': 'sabo', 'oden': 'kozuki oden',
    'momonosuke': 'kozuki momonosuke', 'hiyori': 'kozuki hiyori', 'toki': 'kozuki toki',
    'kiku': 'kikunojo', 'orochi': 'kurozumi orochi', 'tama': 'otama', 'o tama': 'otama',
    'chien runard': 'inuarashi', 'chat vipere': 'nekomamushi',
    'judge': 'vinsmoke judge', 'reiju': 'vinsmoke reiju', 'ichiji': 'vinsmoke ichiji',
    'niji': 'vinsmoke niji', 'yonji': 'vinsmoke yonji',
    'xebec': 'rocks d xebec', 'saturn': 'saint jaygarcia saturn',
    'weevil': 'edward weevil', 'teach': 'marshall d teach',

    // --- Naruto ---
    'jiraya': 'jiraiya', 'jaraya': 'jiraiya',
    'gai maito': 'might guy', 'maito gai': 'might guy', 'gai': 'might guy', 'guy': 'might guy',
    'kyubi': 'kurama', 'kyuubi': 'kurama', 'neuf queues': 'kurama',
    'shukaku': 'shukaku', 'huit queues': 'gyuki', 'hachibi': 'gyuki',
    'nibi': 'matatabi', 'sanbi': 'isobu', 'yonbi': 'son goku',
    'gobi': 'kokuo', 'rokubi': 'saiken', 'nanabi': 'chomei',
    'sage des six chemins': 'hagoromo otsutsuki', 'rikudo sennin': 'hagoromo otsutsuki',
    'quatrieme hokage': 'minato namikaze', 'yondaime': 'minato namikaze',
    'troisieme hokage': 'hiruzen sarutobi', 'sandaime': 'hiruzen sarutobi',
    'premier hokage': 'hashirama senju', 'deuxieme hokage': 'tobirama senju',
    'killer bee': 'killer b', 'killerbee': 'killer b',
    'tsunade senju': 'tsunade', 'kakashi': 'kakashi hatake',
    'naruto': 'naruto uzumaki', 'sakura': 'sakura haruno',
    'pain': 'pain', 'nagato uzumaki': 'nagato',
    'tobi': 'tobi', 'zetsu blanc': 'white zetsu', 'zetsu noir': 'black zetsu',
    'dix queues': 'jubi', 'juubi': 'jubi',

    // --- Bleach ---
    'aizen': 'sosuke aizen', 'ichigo': 'ichigo kurosaki', 'rukia': 'rukia kuchiki',
    'byakuya': 'byakuya kuchiki', 'renji': 'renji abarai', 'orihime': 'orihime inoue',
    'chad': 'yasutora sado', 'sado': 'yasutora sado',
    'ishida': 'uryu ishida', 'uryu': 'uryu ishida',
    'urahara': 'kisuke urahara', 'yoruichi': 'yoruichi shihoin',
    'kenpachi': 'kenpachi zaraki', 'zaraki': 'kenpachi zaraki',
    'hitsugaya': 'toshiro hitsugaya', 'toshiro': 'toshiro hitsugaya',
    'gin': 'gin ichimaru', 'ichimaru': 'gin ichimaru',
    'tosen': 'kaname tosen', 'tousen': 'kaname tosen',
    'yamamoto': 'genryusai shigekuni yamamoto', 'yamajii': 'genryusai shigekuni yamamoto',
    'grimmjow': 'grimmjow jaegerjaquez', 'ulquiorra': 'ulquiorra cifer',
    'harribel': 'tier harribel', 'starrk': 'coyote starrk',
    'nel': 'nelliel tu odelschwanck', 'neliel': 'nelliel tu odelschwanck',
    'as nodt': 'as nodt', 'bazz b': 'bazz b',

    // --- Seven Deadly Sins ---
    'harlequin': 'king', 'roi harlequin': 'king',
    'meliodas': 'meliodas', 'elizabeth': 'elizabeth liones',
    'roi des demons': 'demon king', 'deesse supreme': 'supreme deity',
    'arthur': 'arthur pendragon',

    // --- My Hero Academia ---
    'deku': 'izuku midoriya', 'midoriya': 'izuku midoriya',
    'bakugo': 'katsuki bakugo', 'kacchan': 'katsuki bakugo', 'bakugou': 'katsuki bakugo',
    'todoroki': 'shoto todoroki', 'uraraka': 'ochaco uraraka', 'iida': 'tenya iida',
    'eraserhead': 'shota aizawa', 'aizawa': 'shota aizawa',
    'all for one': 'all for one', 'afo': 'all for one',
    'shigaraki': 'tomura shigaraki', 'tenko': 'tenko shimura',
    'overhaul': 'kai chisaki', 'chisaki': 'kai chisaki',
    'lemillion': 'mirio togata', 'togata': 'mirio togata',
    'froppy': 'tsuyu asui', 'tsuyu': 'tsuyu asui',

    // --- Black Clover ---
    'patolli': 'patry', 'patri': 'patry',
    'yami': 'yami sukehiro', 'asta': 'asta', 'yuno': 'yuno grinberryall',
    'noelle': 'noelle silva', 'julius': 'julius novachrono',
    'roi mage': 'julius novachrono', 'empereur mage': 'julius novachrono',

    // --- Fairy Tail ---
    'natsu': 'natsu dragneel', 'lucy': 'lucy heartfilia', 'gray': 'gray fullbuster',
    'erza': 'erza scarlet', 'wendy': 'wendy marvell', 'gajeel': 'gajeel redfox',
    'juvia': 'juvia lockser', 'mirajane': 'mirajane strauss', 'mira': 'mirajane strauss',
    'laxus': 'laxus dreyar', 'luxus': 'laxus dreyar',
    'makarov': 'makarov dreyar', 'gildarts': 'gildarts clive',
    'zeref': 'zeref dragneel', 'mavis': 'mavis vermillion',
    'jellal': 'jellal fernandes', 'gerald': 'jellal fernandes',
    'siegrain': 'jellal fernandes', 'erik': 'cobra',
    'richard buchanan': 'hoteye', 'precht': 'hades',
    'happy': 'happy', 'lily': 'panther lily', 'pantherlily': 'panther lily'
};

// Distance d'édition, pour tolérer une petite faute de frappe ou une romanisation différente
function distanceRG(a, b) {
    if (Math.abs(a.length - b.length) > 2) return 99;
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 0; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            d[i][j] = Math.min(
                d[i - 1][j] + 1,
                d[i][j - 1] + 1,
                d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
            );
        }
    }
    return d[a.length][b.length];
}

function toleranceRG(longueur) {
    if (longueur <= 4) return 0;   // noms courts : exact, sinon trop de confusions
    if (longueur <= 8) return 1;
    return 2;
}

const NARUTO_RAW = `1. A
2. A — Premier Raikage
3. A — Quatrième Raikage
4. A — Troisième Raikage
5. Agara
6. Agari
7. Agari Kichi
8. Ageha
9. Ajisaï
10. Akaboshi
11. Akahoshi
12. Akamaru
13. Akatsuchi
14. Akino
15. Akio
16. Amachi
17. Amado
18. Amado Sanzu
19. Amaru
20. Ameyuri Ringo
21. Ami
22. Anko Mitarashi
23. Ao
24. Aoba Yamashiro
25. Aoda
26. Aoi Rokushô
27. Arashi Fûma
28. Araya
29. Ashina Uzumaki
30. Ashura Ôtsutsuki
31. Asuma Sarutobi
32. Asura Ōtsutsuki
33. Atsui
34. Ayame
35. Baïu
36. Baki
37. Baku
38. Bansai
39. Bekkō
40. Benga
41. Benten
42. Bifū
43. Bikō
44. Biscuit
45. Biwako Sarutobi
46. Black Zetsu
47. Blue B
48. Boro
49. Boruto Uzumaki
50. Bull
51. Bunpuku
52. Buntan Kurosuki
53. Burō
54. Byakuren
55. C
56. Chikushôdô
57. Chino
58. Chiriku
59. Chiyo
60. Chōbi
61. Chôchô Akimichi
62. Chōhan
63. Chôji Akimichi
64. Chôjûrô
65. Chômei
66. Chōsa
67. Chôza Akimichi
68. Chûkichi
69. Chûshin
70. Code
71. Daemon
72. Daikoku Funeno
73. Dajimu
74. Dan Katô
75. Danzô Shimura
76. Darui
77. Datsuji
78. Deepa
79. Deidara
80. Delta
81. Denka
82. Denki Kaminarimon
83. Dodaï
84. Dōjō
85. Doki
86. Dōmu
87. Dōshu
88. Doshu Goetsu
89. Dosu Kinuta
90. Dotô Kazahana
91. Ebisu
92. Ebizô
93. Eida
94. Eiki
95. En Chinoike
96. En no Gyôja
97. Enko Onikuma
98. Enma
99. Ensui Nara
100. Fû
101. Fū Yamanaka
102. Fubuki Kakuyoku
103. Fudo
104. Fuen
105. Fugai
106. Fugaku Uchiwa
107. Fuguki Suikazan
108. Fûjin
109. Fûka
110. Fukai
111. Fukasaku
112. Fuki
113. Fukusuke Hiashira
114. Funamushi
115. Fūshin
116. Fūta
117. Fuu
118. Fuujin
119. Gaara
120. Gaï Maito
121. Gakidô
122. Gama
123. Gamabunta
124. Gamahiro
125. Gamaken
126. Gamakichi
127. Gamamaru
128. Gamariki
129. Gamatabi
130. Gamatatsu
131. Gantetsu
132. Garaga
133. Gari
134. Gatô
135. Gengetsu Hôzuki
136. Gengo
137. Genma Shiranui
138. Gennô
139. Genzô
140. Gerotora
141. Giichi
142. Ginkaku
143. Gôzu
144. Gulko
145. Guren
146. Guruguru
147. Gyokurō
148. Gyûki
149. Hachidai
150. Hagoromo Ôtsutsuki
151. Haido
152. Hakkaku
153. Hako Kuroi
154. Haku
155. Hamura Ôtsutsuki
156. Han
157. Hana Inuzuka
158. Hanabi Hyûga
159. Hanare
160. Hanzaki
161. Hanzô
162. Haruna
163. Harusame
164. Hashirama Senju
165. Hayate Gekkô
166. Hiashi Hyûga
167. Hidan
168. Himawari Uzumaki
169. Hina
170. Hinata Hyûga
171. Hiruko
172. Hiruzen Sarutobi
173. Hizashi Hyûga
174. Hoheto Hyûga
175. Hōichi
176. Hôki
177. Hōki Taketori
178. Hokuto
179. Homura Mitokado
180. Hotaru
181. Hotarubi
182. Houki Taketori
183. Hyô
184. Ibiki Morino
185. Ibuse
186. Idate Morino
187. Ikkaku Umino
188. Inabi Uchiwa
189. Inari
190. Indra Ôtsutsuki
191. Ino Yamanaka
192. Inoichi Yamanaka
193. Inojin Yamanaka
194. Iō
195. Iruka Umino
196. Isaribi
197. Ishikawa
198. Isobu
199. Isshiki Ôtsutsuki
200. Itachi Uchiwa
201. Ittan
202. Ittetsu
203. Iwabee Yuino
204. Iwana Akame
205. Iwashi Tatami
206. Izumi Uchiwa
207. Izumo Kamizuki
208. Izuna Uchiwa
209. J
210. Jako
211. Jibachi Kamizuru
212. Jiga
213. Jigen
214. Jigokudô
215. Jigumo
216. Jin
217. Jinin Akebino
218. Jinpachi Munashi
219. Jiraiya
220. Jirôbô
221. Jirocho
222. Jōseki
223. Jûbi
224. Jûgo
225. Jūjin
226. Jūzō Biwa
227. Kabuto Yakushi
228. Kagami Uchiwa
229. Kagari
230. Kagerô Fûma
231. Kaguya Ôtsutsuki
232. Kaiza
233. Kaji
234. Kakashi Hatake
235. Kakkou
236. Kakuzu
237. Kamatari
238. Kamikiri
239. Kandachi
240. Kankurô
241. Kanna
242. Kanpachi
243. Karashi
244. Karin
245. Karin Uzumaki
246. Karui
247. Karura
248. Kashin Koji
249. Katasuke Tôno
250. Katsuyu
251. Kawaki
252. Kazuma
253. Kiba Inuzuka
254. Kido Tsumiki
255. Kidômaru
256. Kigiri
257. Kihô
258. Kikunojô
259. Killer B
260. Killer Bee
261. Kimimaro
262. Kimimaro Kaguya
263. Kin Tsuchi
264. Kinkaku
265. Kinshiki Ôtsutsuki
266. Kirara
267. Kirisame
268. Kisame Hoshigaki
269. Kitsuchi
270. Kiyoi Yotsuki
271. Kô Hyûga
272. Kogen
273. Kohari Mitokado
274. Koharu Utatane
275. Koji Kashin
276. Kokuô
277. Komachi
278. Komori
279. Konan
280. Konohamaru Sarutobi
281. Kôsuke Maruboshi
282. Kotetsu Hagane
283. Kotohime
284. Koyuki Kazahana
285. Kujaku
286. Kurama
287. Kurenaï Yûhi
288. Kurobachi Kamizuru
289. Kurobane Raijin
290. Kurotsuchi
291. Kushimaru Kuriarare
292. Kushina Uzumaki
293. Kyodaigumo
294. Kyodaija
295. Kyūsuke
296. Lando
297. Lili
298. Log
299. Lone
300. Mabui
301. Madame Shijimi
302. Madara Uchiwa
303. Mahiru
304. Maki
305. Mamushi
306. Manabu Akado
307. Manda
308. Mangetsu Hôzuki
309. Matatabi
310. Matsu
311. Matsuri
312. Meï Terumi
313. Meizu
314. Menma
315. Menma Uzumaki
316. Meno
317. Menza
318. Metal Lee
319. Midare
320. Mifune
321. Might Duy
322. Might Guy
323. Mikoshi
324. Mikoto Uchiwa
325. Minato Namikaze
326. Minoichi
327. Mirai Sarutobi
328. Misumi Tsurugi
329. Mito Uzumaki
330. Mitsuki
331. Mizore Fuyukuma
332. Mizuki Tôji
333. Mizura
334. Mō
335. Moegi
336. Moegi Kazamatsuri
337. Momoshiki Ôtsutsuki
338. Monju
339. Monzaemon Chikamatsu
340. Mōryō
341. Mōsō
342. Motoi
343. Mozuku
344. Mû
345. Mubi
346. Mugino
347. Mukade
348. Murasame
349. Muta Aburame
350. Nadare Rôga
351. Nagato
352. Nagato Uzumaki
353. Namida Suzume
354. Namida Suzumeno
355. Nangô
356. Naori Uchiwa
357. Naruto Uzumaki
358. Natori
359. Natsuhi
360. Nawaki
361. Neji Hyûga
362. Nekobaa
363. Nekomata
364. Ningame
365. Ningendo
366. Ninkame
367. Nishi
368. Nono Yakushi
369. Nue
370. Nurari
371. Obito Uchiwa
372. Oboro
373. Okisuke
374. Omoï
375. Onoki
376. Oogama Sennin
377. Orochimaru
378. Osoi
379. Otoha
380. Pain
381. Pakkun
382. Pakura
383. Pochi
384. Ponta
385. Princesse Fuku
386. Raidô Namiashi
387. Raïga Kurosuki
388. Raijin
389. Raimei
390. Ranka
391. Ranke
392. Ranmaru
393. Rasa
394. Renga
395. Reto
396. Rikudō Sennin
397. Rin Nohara
398. Rinji
399. Rō
400. Rock Lee
401. Rôshi
402. Ryûgan
403. Ryūmyaku
404. Ryūzetsu
405. Sabu
406. Saï
407. Saiken
408. Sakon
409. Sakumo Hatake
410. Sakura Haruno
411. Samui
412. Sana
413. Sandayuu Azama
414. Sarada Uchiwa
415. Sari
416. Sasame Fûma
417. Sasori
418. Sasuke Uchiwa
419. Satori
420. Saya
421. Sazanami
422. Seimei
423. Sekka
424. Sen
425. Shamon
426. Shiba
427. Shibai Ôtsutsuki
428. Shibi Aburame
429. Shibito Azuma
430. Shibuki
431. Shigure
432. Shiho
433. Shiin
434. Shikadai Nara
435. Shikaku Nara
436. Shikamaru Nara
437. Shikuro Aburame
438. Shima
439. Shimon Hijiri
440. Shin
441. Shin Uchiwa
442. Shinki
443. Shinnô
444. Shino Aburame
445. Shion
446. Shiore
447. Shira
448. Shiranami
449. Shisou
450. Shisui Uchiwa
451. Shizuka
452. Shizune
453. Shukaku
454. Shun
455. Shura
456. Shurado
457. Son Gokû
458. Sora
459. Sôtetsu Kazahana
460. Suien
461. Suigetsu Hôzuki
462. Suika
463. Suiko
464. Suiren
465. Sumaru
466. Sumashi
467. Sumire Kakei
468. Suzume
469. Suzumebachi Kamizuru
470. Taiseki
471. Tajima Uchiwa
472. Tamaki
473. Tatewaki
474. Tayuya
475. Tazuna
476. Temari
477. Tendô
478. Tenga
479. Tenji
480. Tenten
481. Tenzô
482. Tera
483. Teraï
484. Teuchi
485. Teyaki Uchiwa
486. Tobi
487. Tobirama Senju
488. Todoroki
489. Tōka Senju
490. Tokuma Hyûga
491. Tonbo Tobitake
492. Toneri Ôtsutsuki
493. Tonton
494. Toroi
495. Torune
496. Torune Aburame
497. Towa
498. Tsubaki
499. Tsubaki Kurogane
500. Tsuguri
501. Tsukino
502. Tsunade
503. Tsunami
504. Tsurushi Hachiya
505. Udon
506. Udon Ise
507. U-hei
508. Ukon
509. Ulshi
510. Umibôzu
511. Urakaku
512. Urashiki
513. Urashiki Ôtsutsuki
514. Uruchi Uchiwa
515. Urushi
516. Utakata
517. Victor
518. Wagarashi
519. Waraji
520. Wasabi Izuno
521. Watari Nagare
522. Wataru
523. White Zetsu
524. Yagura
525. Yagura Karatachi
526. Yahiko
527. Yakumo Kurama
528. Yamato
529. Yashamaru
530. Yashiro Uchiwa
531. Yodo
532. Yome
533. Yoro
534. Yoroï Akadô
535. Yoshino Nara
536. Yota
537. Yotaka
538. Yûgao Uzuki
539. Yugito Nii
540. Yukata
541. Yuki
542. Yuki Kazahana
543. Yûkimaru
544. Yûra
545. Yurinojô
546. Zabuza Momochi
547. Zaji
548. Zaku Abumi
549. Zansūru
550. Zetsu
551. Zetsu Blanc
552. Zetsu Noir
553. Zōmei
554. Zôri`;

const ONEPIECE_RAW = `1. Abdullah
2. Absalom
3. Ain
4. Aisa
5. Aladine
6. Alpacaman
7. Alvida
8. Amande
9. Andre
10. Aphelandra
11. Aramaki
12. Arlong
13. Ashura Doji
14. Atlas
15. Atmos
16. Avalo Pizarro
17. Axe-Hand Morgan
18. Babanuki
19. Baby 5
20. Baccarat
21. Baggaley
22. Bakkin
23. Bao Huang
24. Bariete
25. Bartholomew Kuma
26. Bartolomeo
27. Basil Hawkins
28. Bastille
29. Batman
30. Bellamy
31. Bell-mère
32. Belo Betty
33. Benn Beckman
34. Bentham
35. Bepo
36. Big Pan
37. Billy
38. Binz
39. Black Maria
40. Blackback
41. Blamenco
42. Blenheim
43. Blue Gilly
44. Blueno
45. Boa Hancock
46. Boa Marigold
47. Boa Sandersonia
48. Bobbin
49. Bogard
50. Bonney
51. Boo
52. Boodle
53. Borsalino
54. Brannew
55. Briscola
56. Broggy
57. Brogy
58. Brook
59. Brownbeard
60. Buchi
61. Buffalo
62. Buggy
63. Byrnndi World
64. Cabaji
65. Caesar Clown
66. Caimanlady
67. Calgara
68. Camie
69. Capone Bege
70. Caribou
71. Carina
72. Carmel
73. Carne
74. Carrot
75. Catarina Devon
76. Cavendish
77. Chaka
78. Charlos
79. Charlotte Amande
80. Charlotte Anana
81. Charlotte Anglais
82. Charlotte Basans
83. Charlotte Bavarois
84. Charlotte Brownie
85. Charlotte Brûlée
86. Charlotte Chiboust
87. Charlotte Chiffon
88. Charlotte Cinnamon
89. Charlotte Citron
90. Charlotte Compote
91. Charlotte Counter
92. Charlotte Cracker
93. Charlotte Custard
94. Charlotte Daifuku
95. Charlotte Decuple
96. Charlotte Dolce
97. Charlotte Dragée
98. Charlotte Flampe
99. Charlotte Galette
100. Charlotte Harumatsu
101. Charlotte Joconde
102. Charlotte Joscarpone
103. Charlotte Kanten
104. Charlotte Katakuri
105. Charlotte Kato
106. Charlotte Linlin
107. Charlotte Lola
108. Charlotte Mascarpone
109. Charlotte Mash
110. Charlotte Mobile
111. Charlotte Mont-d'Or
112. Charlotte Moscato
113. Charlotte Myukuru
114. Charlotte Newichi
115. Charlotte Newji
116. Charlotte Nougat
117. Charlotte Nusstorte
118. Charlotte Opera
119. Charlotte Oven
120. Charlotte Perospero
121. Charlotte Poire
122. Charlotte Praline
123. Charlotte Pudding
124. Charlotte Raisin
125. Charlotte Smoothie
126. Charlotte Snack
127. Charlotte Tablet
128. Charlotte Yuen
129. Chess
130. Chew
131. Chimney
132. Cindry
133. Clover
134. Conis
135. Coribou
136. Crocodile
137. Crocus
138. Curiel
139. Curly Dadan
140. Dagama
141. Daifugo
142. Daikoku
143. Dalmatian
144. Dalton
145. Damask
146. Daruma
147. Daz Bones
148. Daz Bonez
149. Dellinger
150. Demalo Black
151. Demaro Black
152. Den
153. Denjiro
154. Diamante
155. Dice
156. Disco
157. Django
158. Doberman
159. Dobon
160. Doc Q
161. Doma
162. Domino
163. Don Chinjao
164. Don Krieg
165. Donquixote Doflamingo
166. Donquixote Homing
167. Donquixote Mjosgard
168. Donquixote Rosinante
169. Dorry
170. Dosun
171. Douglas Bullet
172. Dr. Hiriluk
173. Dr. Hogback
174. Dr. Indigo
175. Dr. Kureha
176. Dracule Mihawk
177. Dracule Perona
178. Drake
179. Du Feld
180. Duval
181. Edison
182. Edward Newgate
183. Edward Weevil
184. Elizabello II
185. Emporio Ivankov
186. Enel
187. Epoida
188. Ethanbaron V. Nusjuro
189. Eustass Kid
190. Farafra
191. Fisher Tiger
192. Flampe
193. Fossa
194. Foxy
195. Franky
196. Fukaboshi
197. Fukuro
198. Fukurokuju
199. Fukurou
200. Fullbody
201. Funkfreed
202. Gaban
203. Gaimon
204. Galdino
205. Gambia
206. Gan Fall
207. Gasparde
208. Gazelleman
209. Gecko Moria
210. Gedatsu
211. Genzo
212. Gerd
213. Gin
214. Ginny
215. Ginrummy
216. Giolla
217. Gladius
218. Gloriosa
219. Gol D. Roger
220. Gonbe
221. Gordon
222. Gotti
223. Guernica
224. Gyaro
225. Gyukimaru
226. Hack
227. Hajrudin
228. Hamburg
229. Hammond
230. Hannyabal
231. Hanzo
232. Haredas
233. Haruta
234. Hatchan
235. Hattori
236. Heat
237. Helmeppo
238. Héra
239. Heracles
240. Hildon
241. Hina
242. Hody Jones
243. Hogback
244. Holdem
245. Hongo
246. Hotori
247. Hyogoro
248. Hyouzou
249. Iceburg
250. Ideo
251. Igaram
252. Ikaros Much
253. Imu
254. Inazuma
255. Indigo
256. Inuarashi
257. Ipponmatsu
258. Issho
259. Isuka
260. Itomimizu
261. Izo
262. Jabra
263. Jack
264. Jaguar D. Saul
265. Jango
266. Jaygarcia Saturn
267. Jean Bart
268. Jeet
269. Jesus Burgess
270. Jewelry Bonney
271. Jinbe
272. Jinbei
273. Jiro
274. John
275. Johnny
276. Jonathan
277. Jora
278. Joy Boy
279. Jozu
280. Kaido
281. Kaku
282. Kalgara
283. Kalifa
284. Kanjuro
285. Karasu
286. Karoo
287. Kashii
288. Kawamatsu
289. Kaya
290. Kikunojo
291. Kikyo
292. Killer
293. Kin'emon
294. King
295. King Neptune
296. Kingdew
297. Koala
298. Koby
299. Kokoro
300. Komachiyo
301. Komurasaki
302. Kong
303. Kotori
304. Koushirou
305. Koza
306. Kozuki Hiyori
307. Kozuki Momonosuke
308. Kozuki Oden
309. Kozuki Sukiyaki
310. Kozuki Toki
311. Kuina
312. Kumadori
313. Kumashi
314. Kuro
315. Kuromarimo
316. Kuroobi
317. Kurozumi Higurashi
318. Kurozumi Orochi
319. Kuzan
320. Kyoshiro
321. Kyros
322. Laboon
323. Lacroix
324. Laffitte
325. Lafitte
326. Laki
327. Lao G
328. Leo
329. Lilith
330. Lindbergh
331. Little Oars Jr.
332. Loki
333. Lonz
334. Lorenz
335. Lucky Roux
336. Lulu
337. Machvise
338. Macro
339. Magellan
340. Makino
341. Manboshi
342. Mansherry
343. Marco
344. Marcus Mars
345. Marguerite
346. Marshall D. Teach
347. Masira
348. Maynard
349. McGuy
350. McKinley
351. Merry
352. Minatomo
353. Miss Doublefinger
354. Miss Friday
355. Miss Goldenweek
356. Miss Merry Christmas
357. Miss Monday
358. Miss Valentine
359. Miyagi
360. Mjosgard
361. Mohji
362. Momonga
363. Monet
364. Monkey D. Dragon
365. Monkey D. Garp
366. Monkey D. Luffy
367. Mont Blanc Cricket
368. Mont Blanc Noland
369. Morgan
370. Morgans
371. Morley
372. Mouseman
373. Mousse
374. Mozambia
375. Mr. 13
376. Mr. 4
377. Mr. 5
378. Mr. 7
379. Mr. 9
380. Nami
381. Namur
382. Napoléon
383. Nefertari Cobra
384. Nefertari D. Lili
385. Nefertari Vivi
386. Nekomamushi
387. Neptune
388. Nero
389. Nezumi
390. Nico Olvia
391. Nico Robin
392. Ninjin
393. Nojiko
394. Nure-Onna
395. Nyon
396. Oars
397. Ochoku
398. Ohm
399. Oimo
400. Okiku
401. Onigumo
402. Onimaru
403. Orlumbus
404. O-Tama
405. Otohime
406. O-Toko
407. O-Tsuru
408. Pagaya
409. Page One
410. Pappag
411. Patty
412. Paulie
413. Pearl
414. Pedro
415. Pekoms
416. Pell
417. Penguin
418. Perona
419. Pica
420. Pierre
421. Porche
422. Porchemy
423. Portgas D. Ace
424. Portgas D. Rouge
425. Pound
426. Prométhée
427. Prometheus
428. Pythagoras
429. Queen
430. Rabbitman
431. Raizo
432. Raki
433. Rakuyo
434. Rayleigh Shakky
435. Rebecca
436. Richie
437. Riku Doldo III
438. Rindo
439. Rob Lucci
440. Rocks D. Xebec
441. Rockstar
442. Roddy
443. Roronoa Zoro
444. Roshio
445. Rosward
446. Rush
447. Ryuboshi
448. Ryuma
449. Sabo
450. Sadi
451. Saga
452. Sai
453. Saint Ethanbaron V. Nusjuro
454. Saint Figarland Garling
455. Saint Jaygarcia Saturn
456. Saint Marcus Mars
457. Saint Shepherd Ju Peter
458. Saint Topman Warcury
459. Sakazuki
460. Saldeath
461. Salome
462. Sanji
463. Sanjuan Wolf
464. Sarahebi
465. Sarquiss
466. Sarutobi
467. Sasaki
468. Satori
469. S-Bat
470. S-Bear
471. Scarlett
472. Scopper Gaban
473. Scotch
474. Scratchmen Apoo
475. Sengoku
476. Senor Pink
477. Sentomaru
478. S-Flamingo
479. Shachi
480. Shaka
481. Shakuyaku
482. Shalria
483. Sham
484. Shanks
485. S-Hawk
486. Sheepshead
487. Shepherd Ju Peter
488. Shiki
489. Shiliew
490. Shimotsuki Kozaburo
491. Shimotsuki Yasuie
492. Shinobu
493. Shirahoshi
494. Shiryu
495. Shoujou
496. Shura
497. Shutenmaru
498. Shyarly
499. Sicilian
500. Silver Axe
501. Silvers Rayleigh
502. Smoker
503. Snakeman
504. Solitaire
505. Spandam
506. Spandine
507. Speed
508. Speed Jill
509. Squardo
510. S-Shark
511. S-Snake
512. Strawberry
513. Streusen
514. Stronger
515. Stussy
516. Sugar
517. Suleiman
518. Surume
519. Sweet Pea
520. Tama
521. Tamago
522. Tank Lepanto
523. Tansui
524. Tararan
525. Taro
526. Tashigi
527. T-Bone
528. Tenguyama Hitetsu
529. Terracotta
530. Tesoro
531. Thatch
532. Tilestone
533. Toko
534. Tom
535. Tonoyasu
536. Tony Tony Chopper
537. Topman Warcury
538. Toto
539. Trafalgar D. Water Law
540. Trebol
541. Tristan
542. Tsuru
543. Ucy
544. Ulti
545. Urashima
546. Urouge
547. Usopp
548. Uta
549. Van Augur
550. Vander Decken IX
551. Vasco Shot
552. Vegapunk
553. Vegapunk Atlas
554. Vegapunk Pythagoras
555. Vegapunk York
556. Vergo
557. Victoria Cindry
558. Vinsmoke Ichiji
559. Vinsmoke Judge
560. Vinsmoke Niji
561. Vinsmoke Reiju
562. Vinsmoke Sora
563. Vinsmoke Yonji
564. Viola
565. Vista
566. Vito
567. Wadatsumi
568. Wanda
569. Wanze
570. Wapol
571. Whitey Bay
572. Who's Who
573. Who's-Who
574. Wire
575. Wyper
576. X Drake
577. Yama
578. Yamakaji
579. Yamato
580. Yasopp
581. Yokozuna
582. York
583. Yosaku
584. Yuda
585. Zala
586. Zambai
587. Zeff
588. Zeo
589. Zephyr
590. Zepo
591. Zeus
592. Zodia
593. Zunesha`;

const BLEACH_RAW = `1. Aaroniero Arruruerie
2. Abirama Redder
3. Acidwire
4. Akon
5. As Nodt
6. Asguiaro Ebern
7. Ashido Kano
8. Askin Nakk Le Vaar
9. Aura Michibane
10. Baishin
11. Bambietta Basterbine
12. Baraggan Louisenbairn
13. Baura
14. Bawabawa
15. Bazz-B
16. Berenice Gabrielli
17. BG9
18. Bonnie
19. Byakuya Kuchiki
20. Candice Catnipp
21. Cang Du
22. Charlotte Chuhlhourne
23. Chizuru Honsho
24. Choe Neng Poww
25. Chojiro Sasakibe
26. Cirucci Sanderwicci
27. Coyote Starrk
28. Cyan Sung-Sun
29. Danon
30. Di Roy Rinker
31. Don Kanonji
32. Dondochakka Bilstin
33. Dondochakka Birstanne
34. Dordoni Alessandro Del Socaccio
35. Driscoll Berci
36. D-Roy Linker
37. Edrad Liones
38. Eikichirō Saidō
39. Emilou Apacci
40. Enryu
41. Enzo
42. Fērum
43. Findorr Calius
44. Fishbone D
45. Franceska Mila Rose
46. Ganju Shiba
47. Ganryu
48. Gantenbainne Mosqueda
49. Garogai
50. Genryusai Shigekuni Yamamoto
51. Genshiro Okikiba
52. Gerard Valkyrie
53. Ggio Vega
54. Gin Ichimaru
55. Ginrei Kuchiki
56. Giriko Kutsuzawa
57. Giselle Gewelle
58. Grand Fisher
59. Gremmy Thoumeaux
60. Grimmjow Jaegerjaquez
61. Guenael Lee
62. Gunjo
63. Hachi
64. Hachigen Ushoda
65. Hanataro Yamada
66. Hanza Nukui
67. Hexapodus
68. Hikone Ubuginu
69. Hisagi
70. Hisana Kuchiki
71. Hiyori Sarugaki
72. Hiyosu
73. Homura
74. Hōzukimaru
75. Ichibe Hyosube
76. Ichigo Kurosaki
77. Ikkaku Madarame
78. Ikumi Unagiya
79. Inose
80. Isane Kotetsu
81. Isshin Kurosaki
82. Izuru Kira
83. Jackie Tristan
84. James
85. Jerome Guizbatt
86. Jidanbo Ikkanzaka
87. Jinnai Doko
88. Jinta Hanakari
89. Jugram Haschwalth
90. Jushiro Ukitake
91. Kageroza Inaba
92. Kaien
93. Kaien Shiba
94. Kanae Katagiri
95. Kaname Tosen
96. Karin Kurosaki
97. Kazui Kurosaki
98. Keigo Asano
99. Kenpachi Zaraki
100. Kenryu
101. Kensei
102. Kensei Muguruma
103. Kirio Hikifune
104. Kisuke Urahara
105. Kiyone Kotetsu
106. Koga Kuchiki
107. Kokuto
108. Kon
109. Kugo Ginjo
110. Kukaku Shiba
111. Kumoi
112. Lilinette Gingerback
113. Lille Barro
114. Liltotto Lamperd
115. Lilynette Gingerbuck
116. Lisa Yadomaru
117. Loly Aivirrne
118. Love Aikawa
119. Loyd Lloyd
120. Luppi Antenor
121. Mahana Natsui
122. Maki Ichinose
123. Makoto Kibune
124. Marechiyo Omaeda
125. Marenoshin Ōmaeda
126. Masaki Kurosaki
127. Mashiro Kuna
128. Mask De Masculine
129. Mayuri Kurotsuchi
130. Meninas McAllon
131. Menis
132. Menoly Mallia
133. Michiru Ogawa
134. Mimihagi
135. Miyako Shiba
136. Mizuiro Kojima
137. Moe Shishigawara
138. Momo Hinamori
139. Muramasa
140. Nakeem Grindina
141. NaNaNa Najahkoop
142. Nanao
143. Nanao Ise
144. Nelliel Tu Odelschwanck
145. Nemu Kurotsuchi
146. Nianzol Weizol
147. Ninny Spangcole
148. Nirgge Parduoc
149. Nnoitra Gilga
150. Nozomi Kujo
151. Numb Chandelier
152. Oetsu Nimaiya
153. Ōko Yushima
154. Orihime Inoue
155. Ouko Yushima
156. Pepe Waccabrada
157. Pernida Parnkgjas
158. Pesche Guatiche
159. Poww
160. Quilge Opie
161. Rangiku Matsumoto
162. Renji Abarai
163. Retsu Unohana
164. Rin Tsubokura
165. Riruka Dokugamine
166. Riyan
167. Robert Accutrone
168. Rōjūrō Otoribashi
169. Rose Otoribashi
170. Royd Lloyd
171. Rudbornn Chelute
172. Rukia Kuchiki
173. Rukongai Rukia
174. Rurichiyo Kasumioji
175. Ryo Kunieda
176. Ryuken Ishida
177. Ryusei Kenzaki
178. Sajin Komamura
179. Seinosuke Yamada
180. Senjumaru Shutara
181. Senna
182. Sentaro Kotsubaki
183. Shawlong Koufang
184. Shaz Domino
185. Shinji Hirako
186. Shino Madarame
187. Shizuku
188. Shrieker
189. Shuhei Hisagi
190. Shukuro Tsukishima
191. Shunsui Kyoraku
192. Shuren
193. Shusuke Amagai
194. Sode no Shirayuki
195. Soi Fon
196. Sojiro Kusaka
197. Sojun Kuchiki
198. Soken Ishida
199. Sora Inoue
200. Sosuke Aizen
201. Soul King
202. Szayelaporro Granz
203. Taikon
204. Tatsuki Arisawa
205. Tenjiro Kirinji
206. Tensa Zangetsu
207. Tesla Lindocruz
208. Tessai Tsukabishi
209. Tetsuzaemon Iba
210. Tier Harribel
211. Tokinada Tsunayashiro
212. Toshiro Hitsugaya
213. Tsukishima
214. Ulquiorra Cifer
215. Ururu Tsumugiya
216. Uryu Ishida
217. Uryu Quincy
218. Wabisuke
219. White
220. Wonderweiss Margela
221. Yachiru Kusajishi
222. Yachiru Unohana
223. Yammy Llargo
224. Yasutora Sado
225. Yhwach
226. Yoruichi Shihoin
227. Yukio Hans Vorarlberna
228. Yumichika Ayasegawa
229. Yūshirō Shihōin
230. Yuzu Kurosaki
231. Yylfordt Granz
232. Zangetsu
233. Zennosuke Kurumadani
234. Zommari Rureaux`;

const SDS_RAW = `1. Aldrich
2. Anne
3. Aranak
4. Arden
5. Arthur Pendragon
6. Arthur's sword
7. Atra
8. Baltra
9. Ban
10. Ban young
11. Ban's father
12. Bartra Liones
13. Bartra's daughter
14. Bellion
15. Burgie
16. Cain Barzad
17. Camelot Knight
18. Cath
19. Cath Palug
20. Caulifla
21. Chandler
22. Chaos
23. Chaos Arthur
24. Chion
25. Cusack
26. Cusack's apprentice
27. Dahaka
28. Dahlia
29. Dale
30. Dalmally
31. Dana
32. Daz
33. Deathpierce
34. Deldry
35. Demon King
36. Denzel
37. Denzel Liones
38. Derieri
39. Diane
40. Diane young
41. Dogedo
42. Dolor
43. Dolores
44. Donny
45. Doronach
46. Dreyfus
47. Drole
48. Dubs
49. Edlin
50. Elaine
51. Elaine young
52. Elaine's brother
53. Elizabeth Liones
54. Elizabeth reincarnation
55. Elizabeth's mother
56. Ellatte
57. Escanor
58. Escanor's brother
59. Estarossa
60. Fiddich
61. Fraudrin
62. Fraudrin's host
63. Friesia
64. Galand
65. Galand's petrification
66. Galla
67. Gannon
68. Gara
69. Gawain
70. Gelda
71. Gerharde
72. Gerheade
73. Gilthunder
74. Gloxinia
75. Golgius
76. Gowther
77. Gowther doll
78. Grayroad
79. Grayroad's larvae
80. Griamore
81. Griamore's father
82. Guila
83. Guila's brother
84. Guinevere
85. Gustaf
86. Hauser
87. Hawk
88. Hawk Mama
89. Helbram
90. Hendrickson
91. Hendrickson's father
92. Howzer
93. Howzer's niece
94. Hugo
95. Ironside
96. Isolde
97. Jade
98. Jenna
99. Jenny
100. Jericho
101. Jericho young
102. Jude
103. Kay
104. King
105. King young
106. Lady of the Lake
107. Lancelot
108. Lancelot's mother
109. Liz
110. Ludociel
111. Lyonesse
112. Macduff
113. Mael
114. Margaret Liones
115. Marmas
116. Matrona
117. Melascula
118. Melascula's soul
119. Meliodas
120. Meliodas young
121. Merlin
122. Merlin's father
123. Mild
124. Mod
125. Monspeet
126. Mortlach
127. Nadja Liones
128. Nanashi
129. Nasiens
130. Nerobasta
131. Old Fart
132. Ordo
133. Orlondi
134. Oslo
135. Pelio
136. Pellegarde
137. Pelliot
138. Pelliot's father
139. Percival
140. Percival's grandfather
141. Percival's mother
142. Ren
143. Rosa
144. Rou
145. Ruin
146. Sariel
147. Sariel's follower
148. Selion
149. Sennett
150. Simon
151. Sin
152. Slader
153. Solaad
154. Supreme Deity
155. Talisker
156. Tamdhu
157. Tarmiel
158. Tarmiel's brother
159. Teaninich
160. The Sinner
161. Threader
162. Tristan Liones
163. Twigo
164. Varghese
165. Veronica Liones
166. Veronica's guard
167. Vivian
168. Vivian's master
169. Waillo
170. Weinheidt
171. Wild
172. Zaneri
173. Zaratras
174. Zaratras' brother
175. Zeal
176. Zeldris
177. Zhivago
178. Zhivago's son
179. Zoria`;

const MHA_RAW = `1. Air Jet
2. All For One
3. All Might
4. Anna Scervino
5. Aoyama's parents
6. Awase
7. Backdraft
8. Bee Hero
9. Beros
10. Best Jeanist
11. Bombast
12. Bondo
13. Bruce
14. Bubble Girl
15. Burnin
16. Camie Utsushimi
17. Cathleen Bate
18. Cementoss
19. Centipeder
20. Chimera
21. Chitose Kizuki
22. Chiyo Shuzenji
23. Chronostasis
24. Crust
25. Curious
26. Dabi
27. Daigoro Banjo
28. David Shield
29. Death Arms
30. Deidoro Sakaki
31. Denki Kaminari
32. Dictator
33. Ectoplasm
34. Edgeshot
35. Eijiro Kirishima
36. Endeavor
37. Ending
38. Enji Todoroki
39. Eri
40. Fat Gum
41. Flect Turn
42. Fourth Kind
43. Fukidashi
44. Fumikage Tokoyami
45. Fuyumi Todoroki
46. Gang Orca
47. Gentle Criminal
48. Geten
49. Gigantomachia
50. Giran
51. Gran Torino
52. Gunhead
53. Hana Shimura
54. Hanabata
55. Hanta Sero
56. Hawks
57. Hekiji Tengai
58. Hikage Shinomori
59. Himiko Toga
60. Hiryu Rin
61. Hisashi Midoriya
62. Hitoshi Shinso
63. Hizashi Yamada
64. Hojo
65. Honenuki
66. Hound Dog
67. Ibara Shiozaki
68. Inasa Yoarashi
69. Inko Midoriya
70. Innsmouth
71. Itejiro Toteki
72. Itsuka Kendo
73. Izuku Midoriya
74. Johnny
75. Jurota Shishida
76. Juzo Honenuki
77. Kai Chisaki
78. Kaibara
79. Kamakiri
80. Kamui Woods
81. Katsukame
82. Katsuki Bakugo
83. Keigo Takami
84. Kendo
85. Kendo Rappa
86. Kesagiriman
87. Kido
88. Kinoko
89. Kinoko Komori
90. Kodai
91. Koji Koda
92. Kojiro Bondo
93. Koku Hanabata
94. Komori
95. Kosei Tsuburaba
96. Kota Izumi
97. Kotaro Shimura
98. Kuin Hachisuka
99. Kurogiri
100. Kuroiro
101. Kyoka Jiro
102. Kyudai Garaki
103. La Brava
104. Lady Nagant
105. Larceny
106. Magne
107. Majestic
108. Mandalay
109. Manga Fukidashi
110. Manual
111. Masaru Bakugo
112. Mashirao Ojiro
113. Mei Hatsume
114. Melissa Shield
115. Mezo Shoji
116. Midnight
117. Mimic
118. Mina Ashido
119. Minoru Mineta
120. Mirai Sasaki
121. Mirio Togata
122. Mirko
123. Mitsuki Bakugo
124. Moe Kamiji
125. Momo Yaoyorozu
126. Monoma
127. Moonfish
128. Mr. Compress
129. Ms. Joke
130. Mt. Lady
131. Mummy
132. Muscular
133. Mustard
134. Nagamasa Mora
135. Nana Shimura
136. Nao Shimura
137. Native
138. Natsuo Todoroki
139. Nedzu
140. Neito Monoma
141. Nejire Hado
142. Nemuri Kayama
143. Nezu
144. Nighteye's agency
145. Nine
146. Nirengeki
147. Nirengeki Shoda
148. Nomu
149. Ochaco Uraraka
150. Onima
151. Overhaul
152. Pino
153. Pixie-Bob
154. Pony Tsunotori
155. Power Loader
156. Present Mic
157. Present Mic's agency
158. Ragdoll
159. Rappa
160. Recovery Girl
161. Re-Destro
162. Rei Todoroki
163. Reiko Yanagi
164. Rikido Sato
165. Rin
166. Rock Lock
167. Rody Soul
168. Rumi Usagiyama
169. Ryukyu
170. Sanctum
171. Sansa Tamakawa
172. Seiji Shishikura
173. Selkie
174. Sen Kaibara
175. Serpenters
176. Setsuna Tokage
177. Setsuno
178. Shihai Kuroiro
179. Shikkui Makabe
180. Shin Nemoto
181. Shindo
182. Shinso Hitoshi
183. Shiozaki
184. Shishida
185. Shishido
186. Shota Aizawa
187. Shoto Todoroki
188. Sir Nighteye
189. Sirius
190. Skeptic
191. Slice
192. Slidin' Go
193. Snatch
194. Snipe
195. Sorahiko Torino
196. Soramitsu Tabe
197. Spinner
198. Stain
199. Star and Stripe
200. Tabe
201. Tamaki Amajiki
202. Tartarus Warden
203. Tatami Nakagame
204. Tenko Shimura
205. Tenya Iida
206. Tetsutetsu
207. Tetsutetsu Tetsutetsu
208. Thirteen
209. Tiger
210. Togaru Kamakiri
211. Tokage
212. Tomoyasu Chikazoku
213. Tomura Shigaraki
214. Toru Hagakure
215. Toshinori Yagi
216. Toshitsugu Kudo
217. Toya Setsuno
218. Toya Todoroki
219. Trumpet
220. Tsuburaba
221. Tsukauchi Naomasa
222. Tsukuyomi
223. Tsunotori
224. Tsuyu Asui
225. Twice
226. Ujiko
227. Uwabami
228. Vlad King
229. Wash
230. Wolfram
231. X-Less
232. Yanagi
233. Yaoyorozu's butler
234. Yo Shindo
235. Yoichi Shigaraki
236. Yoroi Musha
237. Yosetsu Awase
238. Yotsubashi Rikiya
239. Yu Hojo
240. Yuga Aoyama
241. Yui Kodai`;

const FAIRY_RAW = `1. Acnologia
2. Ajeel Raml
3. Aldoron
4. Alzack Connell
5. Angel
6. Angel Sorano
7. Anna Heartfilia
8. Aquarius
9. Arana Webb
10. Arcadios
11. Aria
12. Aries
13. Asuka Connell
14. Athena
15. Atlas Flame
16. August
17. Azuma
18. Belno
19. Belserion
20. Beth Vanderwood
21. Bickslow
22. Bisca Connell
23. Bloodman
24. Blue Note
25. Bluenote Stinger
26. Bob
27. Bora
28. Brain
29. Brandish
30. Brandish Mu
31. Byro
32. Byro Cracy
33. Cana Alberona
34. Cancer
35. Caprico
36. Capricorn
37. Carla
38. Chapati Lola
39. Chelia
40. Chelia Blendy
41. Cobra
42. Coco
43. Crux
44. Darton
45. Deliora
46. Deneb
47. Dimaria Yesta
48. Dobengal
49. Dogramag
50. Doranbalt
51. Droy
52. Duke Barbaroa
53. Duke Everlue
54. Edolas Erza
55. Edolas Gray
56. Edolas Lucy
57. Edolas Natsu
58. Edolas Wendy
59. Elefseria
60. Elfman Strauss
61. Erigor
62. Erza Knightwalker
63. Erza Scarlet
64. Eve Tearm
65. Evergreen
66. Everlue
67. Extalia Queen
68. Ezel
69. Faris
70. Faust
71. First Master Mavis Vermillion
72. Flare Corona
73. Franmalth
74. Freed Justine
75. Frosch
76. Future Rogue
77. Gajeel Redfox
78. Gemini
79. Georg Reizen
80. Gildarts Clive
81. God Serena
82. Goldmine
83. Grandeeney
84. Gray Fullbuster
85. Guttman
86. Hades
87. Happy
88. Hibiki Lates
89. Hisui E. Fiore
90. Horologium
91. Hot Eye
92. Hoteye
93. Hughes
94. Ichiya Vandalay Kotobuki
95. Igneel
96. Ignia
97. Ikaruga
98. Imitatia
99. Invel Yura
100. Irene Belserion
101. Jackal
102. Jackpot
103. Jacob Lessio
104. Jason
105. Jellal Fernandes
106. Jenny Realight
107. Jet
108. Jiemma
109. Jose Porla
110. Jude Heartfilia
111. Jura Neekis
112. Juvia Lockser
113. Kageyama
114. Kagura Mikazuchi
115. Kain Hikaru
116. Karen Lilica
117. Kawazu
118. Keith
119. Keyes
120. Kinana
121. Kurohebi
122. Kyoka
123. Laki Olietta
124. Larcade Dragneel
125. Laxus Dreyar
126. Layla Heartfilia
127. Lector
128. Leiji
129. Levy McGarden
130. Libra
131. Lisanna Strauss
132. Loke
133. Lucy Heartfilia
134. Lyon Vastia
135. Lyra
136. Macao Conbolt
137. Makarov Dreyar
138. Mard Geer
139. Mavis Vermillion
140. Mavis young
141. Max Alors
142. Meldy
143. Mercphobia
144. Meredy
145. Mest Gryder
146. Metalicana
147. Michelle Lobster
148. Michello
149. Midnight
150. Millianna
151. Minerva Orland
152. Mirajane
153. Mirajane Strauss
154. Motherglare
155. Mystogan
156. Nab Lasaro
157. Nadi
158. Natsu Dragneel
159. Neinhart
160. Nichiya
161. Nineheart
162. Nullpudding
163. Obra
164. Ooba Babasaama
165. Ophiuchus
166. Org
167. Orga Nanagear
168. Panther Lily
169. Pantherlily Edolas
170. Plue
171. Polaris
172. Porlyusica
173. Precht
174. Precht Gaebolg
175. Pyxis
176. Racer
177. Reedus Jonah
178. Ren Akatsuki
179. Richard Buchanan
180. Risley Law
181. Rocker
182. Rogue Cheney
183. Romeo Conbolt
184. Rufus Lore
185. Rustyrose
186. Sagittarius
187. Samuel
188. Sayla
189. Scorpio
190. Seilah
191. Selene
192. Semmes
193. Shagotte
194. Sherria Blendy
195. Sherry Blendy
196. Sho
197. Silver
198. Silver Fullbuster
199. Simon
200. Skiadrum
201. Sorano Agria
202. Sting Eucliffe
203. Sugarboy
204. Taurus
205. Tempester
206. Toby Horhorta
207. Toma E. Fiore
208. Torafuzar
209. Touka
210. Ultear Milkovich
211. Ultear young
212. Ur
213. Vidaldus Taka
214. Viernes
215. Vijeeter Ecor
216. Virgo
217. Wahl Icht
218. Wakaba Mine
219. Wally Buchanan
220. Warren Rocko
221. Warrod Sequen
222. Weisslogia
223. Wendy Marvell
224. Wolfheim
225. Yajima
226. Yomazu
227. Yuka Suzuki
228. Yukino Agria
229. Yuri Dreyar
230. Yury
231. Zancrow
232. Zentopia
233. Zera
234. Zeref Dragneel
235. Zero
236. Zirconis
237. Zoldeo`;

const CLOVER_RAW = `1. Acier Silva
2. Adrammelech
3. Alecdora Sandler
4. Allen Fiarain
5. Aruru
6. Asta
7. Asta's parents
8. Augustus Kira Clover XIII
9. Baro
10. Baro's gang
11. Baval
12. Beelzebub
13. Broccos
14. Catherine
15. Charla
16. Charlotte Roselei
17. Charlotte's squad
18. Charmy Pappitson
19. Ciel Grinberryall
20. Clover Kingdom Magic Knights
21. Conrad Leto
22. Daizaemon O'oka
23. Damnatio Kira
24. Dante Zogratis
25. David Swallow
26. Devil Adrammelech
27. Devil Beelzebub
28. Devil Lilith
29. Devil Lucifero
30. Devil Megicula
31. Devil Naamah
32. Diamond Kingdom Shining Generals
33. Digit Taliss
34. Dominante Code
35. Dorothy Unsworth
36. Drowa
37. Dryad
38. Eclat
39. Ecthel
40. Edward Avalache
41. Elf Charla
42. Elf Drowa
43. Elf Eclat
44. Elf Fana
45. Elf Kivn
46. Elf Licht
47. Elf Patolli
48. Elf Rhya
49. Elf Ronne
50. Elf Vetto
51. En Ringard
52. Fana
53. Fanzell Kruger
54. Father Fuego
55. Father Orsi Orfai
56. Finral Roulacase
57. Floga
58. Foyal Migusteau
59. Fragil Tormenta
60. Fuegoleon Vermillion
61. Fuegoleon's squad
62. Fujio
63. Gaderois Godroc
64. Gadjah
65. Gaja
66. Gauche Adlai
67. Gifso
68. Gimodelo
69. Ginnojomorifuyu Kezoukaku
70. Gordon Agrippa
71. Grey
72. Gueldre Poizot
73. Halbet Chevour
74. Hamon Caseus
75. Heart Kingdom Spirit Guardians
76. Heath Grice
77. Henry Legolant
78. Hollo
79. Ichika Yami
80. Jack the Ripper
81. Jester Garandros
82. Julius Novachrono
83. Kabwe Carillon
84. Kahono
85. Kaiser Granvorka
86. Kiato
87. Kirsch Vermillion
88. Kivn
89. Klaus Lunettes
90. Komari Imari
91. Ladros
92. Langris Vaude
93. Lemiel Silvamillion Clover
94. Leopold Vermillion
95. Letoile Becquerel
96. Licht
97. Liebe
98. Liebe's mother
99. Lilith
100. Lolopechka
101. Lotus Whomalt
102. Loyce Grinberryall
103. Lucifero
104. Lucifugus
105. Lucius Zogratis
106. Luck Voltia
107. Lumiere Silvamillion Clover
108. Magic Emperor
109. Magna Swing
110. Marie Adlai
111. Mariella
112. Mars
113. Marx Francois
114. Megicula
115. Mereoleona Vermillion
116. Milly Maxwell
117. Mimosa Vermillion
118. Morgen Faust
119. Morris
120. Morris Libardirt
121. Mushogatake Yosuga
122. Naamah
123. Nacht Faust
124. Nacht's father
125. Nash
126. Nathan Agrippa
127. Nebra Silva
128. Neige
129. Neige's mother
130. Nero
131. Noelle Silva
132. Noze
133. Nozel Silva
134. Nozel's squad
135. Orsi Orfai
136. Owen
137. Patolli
138. Patri
139. Patry
140. Plumede
141. Potrof
142. Princia Funnybunny
143. Puli Angel
144. Rades Spirito
145. Ragus
146. Raia
147. Ralph Niaflem
148. Randall Luftair
149. Rebecca Scarlet
150. Recca
151. Revchi Salik
152. Rhya
153. Richita
154. Rill Boismortier
155. Rill's squad
156. Robero Ringert
157. Roland
158. Ronne
159. Rufel
160. Ryudo Ryuya
161. Salim of Hapshass
162. Sally
163. Secre Swallowtail
164. Sekke Bronzazza
165. Sekke's rival
166. Shiren Tium
167. Siren Tium
168. Sister Lily
169. Sister Theresa
170. Sister Theresa Rapual
171. Sivoir Snyle
172. Slotos
173. Sol Marron
174. Solid Silva
175. Spade Kingdom Dark Triad
176. Svenkin Gatard
177. Tetia
178. Undine
179. Valtos
180. Vanessa Enoteca
181. Vanica Zogratis
182. Vetto
183. Walgner
184. William Vangeance
185. Wizard King
186. Xerx Lugner
187. Yagos
188. Yami Sukehiro
189. Yami's squad
190. Yuno Grinberryall
191. Yuno's retainer
192. Zagred
193. Zagred's vessel
194. Zenon Zogratis
195. Zenon's father
196. Zogratis siblings
197. Zora Ideale`;

const RG_HXH_RAW = `Gon Freecss
Killua Zoldyck
Kurapika
Leorio Paradinight
Hisoka Morow
Illumi Zoldyck
Ging Freecss
Kite
Biscuit Krueger
Isaac Netero
Zeno Zoldyck
Silva Zoldyck
Kikyo Zoldyck
Milluki Zoldyck
Alluka Zoldyck
Nanika
Kalluto Zoldyck
Gotoh
Canary
Tsubone
Amane
Satotz
Menchi
Buhara
Lippo
Hanzo
Pokkle
Ponzu
Tonpa
Bodoro
Geretta
Melody
Basho
Squala
Baise
Dalzollene
Neon Nostrade
Light Nostrade
Chrollo Lucilfer
Nobunaga Hazama
Feitan Portor
Machi Komacine
Phinks Magcub
Franklin Bordeau
Shizuku Murasaki
Bonolenov Ndongo
Pakunoda
Uvogin
Shalnark
Kortopi
Razor
Genthru
Sub
Bara
Tsezguerra
Goreinu
Abengane
Meruem
Neferpitou
Shaiapouf
Menthuthuyoupi
Colt
Reina
Cheetu
Leol
Welfin
Bloster
Ikalgo
Meleoron
Zazan
Pike
Rammot
Morel Mackernasey
Knov
Knuckle Bine
Shoot McMahon
Palm Siberia
Komugi
Gyro`;

const RG_SNK_RAW = `Eren Jäger
Mikasa Ackerman
Armin Arlert
Levi Ackerman
Erwin Smith
Hange Zoë
Jean Kirstein
Connie Springer
Sasha Blouse
Historia Reiss
Ymir
Reiner Braun
Bertholdt Hoover
Annie Leonhart
Marco Bott
Floch Forster
Petra Ral
Oluo Bozado
Eld Jinn
Gunther Schultz
Miche Zacharius
Nanaba
Moblit Berner
Keith Shadis
Dot Pixis
Nile Dok
Darius Zackly
Kenny Ackerman
Rod Reiss
Frieda Reiss
Uri Reiss
Grisha Jäger
Carla Jäger
Dina Fritz
Eren Kruger
Zeke Jäger
Pieck Finger
Porco Galliard
Marcel Galliard
Gabi Braun
Falco Grice
Colt Grice
Theo Magath
Yelena
Onyankopon
Niccolo
Willy Tybur
Lara Tybur
Ymir Fritz`;

const RG_DEATHNOTE_RAW = `Light Yagami
L Lawliet
Misa Amane
Ryuk
Rem
Near
Mello
Soichiro Yagami
Sachiko Yagami
Sayu Yagami
Touta Matsuda
Shuichi Aizawa
Kanzo Mogi
Hideki Ide
Hirokazu Ukita
Watari
Teru Mikami
Kiyomi Takada
Naomi Misora
Raye Penber
Kyosuke Higuchi
Reiji Namikawa
Wedy
Aiber
Matt
Sidoh
Gelus`;

const RG_COTE_RAW = `Kiyotaka Ayanokoji
Suzune Horikita
Manabu Horikita
Kikyo Kushida
Kei Karuizawa
Yosuke Hirata
Ken Sudo
Kanji Ike
Haruki Yamauchi
Airi Sakura
Akito Miyake
Haruka Hasebe
Keisei Yukimura
Chiaki Matsushita
Maya Sato
Kokoro Inogashira
Rokusuke Koenji
Arisu Sakayanagi
Kohei Katsuragi
Masayoshi Hashimoto
Masumi Kamuro
Kakeru Ryuen
Mio Ibuki
Albert Yamada
Daichi Ishizaki
Hiyori Shiina
Honami Ichinose
Ryuji Kanzaki
Chie Hoshinomiya
Sae Chabashira
Miyabi Nagumo
Takuya Yagami
Ichika Amasawa
Nanase Tsubasa
Kazuomi Hosen
Fuka Kiryuin`;

const RG_SOLO_RAW = `Sung Jinwoo
Sung Jinah
Park Kyung-Hye
Yoo Jinho
Cha Hae-In
Lee Joohee
Song Chi-Yul
Kim Sangshik
Hwang Dongsuk
Kang Taeshik
Hwang Dongsoo
Baek Yoonho
Choi Jong-In
Woo Jinchul
Go Gunhee
Lim Tae-Gyu
Ma Dongwook
Min Byung-Gyu
Thomas Andre
Liu Zhigang
Christopher Reed
Siddharth Bachchan
Norma Selner
Igris
Beru
Bellion
Tusk
Iron
Tank
Greed
Kaisel
Ashborn
Antares
Baran
Rakan
Sillad
Querehsha
Tarnak
Legia
Yogumunt
Architect
Kandiaru
Esil Radiru
Kamish`;

const RG_FIREFORCE_RAW = `Shinra Kusakabe
Arthur Boyle
Maki Oze
Tamaki Kotatsu
Akitaru Obi
Takehisa Hinawa
Iris
Viktor Licht
Vulcan Joseph
Lisa Isaribe
Yu
Benimaru Shinmon
Konro Sagamiya
Hibana
Karim Flam
Rekka Hoshimiya
Leonard Burns
Ogun Montgomery
Pan Ko Paat
Joker
Sho Kusakabe
Haumea
Charon
Arrow
Inca Kasugatani
Ritsu
Yona
Assault
Dragon
Giovanni
Nataku Son
Kurono Yuichiro
Amaterasu`;

const RG_MUSHOKU_RAW = `Rudeus Greyrat
Roxy Migurdia
Sylphiette
Eris Boreas Greyrat
Paul Greyrat
Zenith Greyrat
Lilia Greyrat
Norn Greyrat
Aisha Greyrat
Ruijerd Superdia
Ghislaine Dedoldia
Orsted
Nanahoshi Shizuka
Hitogami
Kishirika Kishirisu
Badigadi
Atofe
Ariel Anemoi Asura
Luke Notos Greyrat
Cliff Grimoire
Zanoba Shirone
Julie
Elinalise Dragonroad
Talhand
Geese Nukadia
Philip Boreas Greyrat
Hilda Boreas Greyrat
Sauros Boreas Greyrat
Perugius Dola
Almanfi
Soldat Heckler
Sara
Linia Dedoldia
Pursena Adoldia
Pax Shirone
Randolph Marianne`;

const RG_REZERO_RAW = `Subaru Natsuki
Emilia
Rem
Ram
Beatrice
Roswaal L. Mathers
Puck
Otto Suwen
Garfiel Tinsel
Frederica Baumann
Petra Leyte
Patrasche
Reinhard van Astrea
Felt
Crusch Karsten
Felix Argyle
Wilhelm van Astrea
Theresia van Astrea
Anastasia Hoshin
Julius Juukulius
Ricardo Welkin
Mimi
Hetaro
Tivey
Priscilla Barielle
Al
Echidna
Satella
Minerva
Typhon
Daphne
Sekhmet
Carmilla
Pandora
Petelgeuse Romanee-Conti
Regulus Corneas
Sirius Romanee-Conti
Capella Emerada Lugunica
Lye Batenkaitos
Roy Alphard
Louis Arneb
Elsa Granhiert
Meili Portroute`;

const RG_BLUELOCK_RAW = `Yoichi Isagi
Meguru Bachira
Rensuke Kunigami
Hyoma Chigiri
Shoei Barou
Seishiro Nagi
Reo Mikage
Rin Itoshi
Sae Itoshi
Ryusei Shidou
Jyubei Aryu
Aoshi Tokimitsu
Gin Gagamaru
Ikki Niko
Raichi Jingo
Gurimu Igarashi
Asahi Naruhaya
Wataru Kuon
Yudai Imamura
Junichi Wanima
Keisuke Wanima
Tabito Karasu
Eita Otoya
Kenyu Yukimiya
Yo Hiori
Ranze Kurona
Nijiro Nanase
Kiyora Jin
Oliver Aiku
Shuto Sendou
Miroku Darai
Teppei Neru
Kazuma Niou
Gen Fukaku
Michael Kaiser
Alexis Ness
Don Lorenzo
Charles Chevalier
Noel Noa
Julian Loki
Lavinho
Chris Prince
Marc Snuffy
Jinpachi Ego
Anri Teieri`;

const RG_FMA_RAW = `Edward Elric
Alphonse Elric
Winry Rockbell
Pinako Rockbell
Van Hohenheim
Trisha Elric
Roy Mustang
Riza Hawkeye
Jean Havoc
Heymans Breda
Vato Falman
Kain Fuery
Maes Hughes
Gracia Hughes
Elicia Hughes
Alex Louis Armstrong
Olivier Mira Armstrong
Buccaneer
Miles
Grumman
Basque Grand
Scar
May Chang
Ling Yao
Lan Fan
Fu
Yoki
Tim Marcoh
Izumi Curtis
Sig Curtis
Father
Pride
Selim Bradley
Wrath
King Bradley
Greed
Lust
Envy
Gluttony
Sloth
Shou Tucker
Nina Tucker
Alexander
Barry the Chopper
Maria Ross
Denny Brosh`;

const RG_CHAINSAW_RAW = `Denji
Pochita
Power
Aki Hayakawa
Makima
Kobeni Higashiyama
Himeno
Kishibe
Hirokazu Arai
Madoka
Reze
Beam
Angel Devil
Violence Fiend
Galgali
Princi
Future Devil
Curse Devil
Fox Devil
Ghost Devil
Katana Man
Akane Sawatari
Quanxi
Cosmo
Pingtsi
Long
Tsugihagi
Santa Claus
Tolka
Aldo
Asa Mitaka
Yoru
Nayuta
Hirofumi Yoshida
Fami
Haruka Iseumi
Seigi Akoku
Nobana Higashiyama
Barem Bridge
Miri Sugo
Whip Hybrid
Spear Hybrid`;

const RG_WAKFU_RAW = `Yugo
Tristepin de Percedal
Amalia Sheran Sharm
Evangelyne
Ruel Stroud
Adamai
Az
Grougaloragran
Alibert
Qilby
Shinonome
Phaeris
Chibi
Mina
Glip
Baltazar
Nox
Oropo
Echo
Harebourg
Ush Galesh
Black Bump
Goultard
Rubilax
Elely
Flopin
Pin
Joris Jurgen
Kerubim Crepin
Atcham
Remington Smisse
Grany Smisse
Maskemane
Kabrok
Miranda
Armand Sheran Sharm
Aurora
Moon`;

const RG_DEMONSLAYER_RAW = `Tanjiro Kamado
Nezuko Kamado
Zenitsu Agatsuma
Inosuke Hashibira
Kanao Tsuyuri
Genya Shinazugawa
Murata
Aoi Kanzaki
Giyu Tomioka
Kyojuro Rengoku
Tengen Uzui
Shinobu Kocho
Mitsuri Kanroji
Muichiro Tokito
Sanemi Shinazugawa
Gyomei Himejima
Obanai Iguro
Kanae Kocho
Kagaya Ubuyashiki
Amane Ubuyashiki
Sakonji Urokodaki
Sabito
Makomo
Jigoro Kuwajima
Shinjuro Rengoku
Senjuro Rengoku
Muzan Kibutsuji
Kokushibo
Doma
Akaza
Hantengu
Gyokko
Gyutaro
Daki
Nakime
Kaigaku
Enmu
Rui
Kyogai
Susamaru
Yahaba
Tamayo
Yushiro
Yoriichi Tsugikuni
Michikatsu Tsugikuni`;

const RG_POKEMON_RAW = `Pikachu
Raichu
Bulbasaur
Ivysaur
Venusaur
Charmander
Charmeleon
Charizard
Squirtle
Wartortle
Blastoise
Caterpie
Butterfree
Pidgeot
Rattata
Spearow
Ekans
Arbok
Sandshrew
Nidoran
Clefairy
Vulpix
Jigglypuff
Zubat
Oddish
Paras
Venonat
Diglett
Meowth
Psyduck
Mankey
Growlithe
Poliwag
Abra
Machop
Bellsprout
Tentacool
Geodude
Ponyta
Slowpoke
Magnemite
Farfetch'd
Doduo
Seel
Grimer
Shellder
Gastly
Haunter
Gengar
Onix
Drowzee
Krabby
Voltorb
Exeggcute
Cubone
Hitmonlee
Hitmonchan
Lickitung
Koffing
Rhyhorn
Chansey
Tangela
Kangaskhan
Horsea
Goldeen
Staryu
Mr. Mime
Scyther
Jynx
Electabuzz
Magmar
Pinsir
Tauros
Magikarp
Gyarados
Lapras
Ditto
Eevee
Vaporeon
Jolteon
Flareon
Porygon
Omanyte
Kabuto
Aerodactyl
Snorlax
Articuno
Zapdos
Moltres
Dratini
Dragonair
Dragonite
Mewtwo
Mew
Lugia
Ho-Oh
Celebi
Groudon
Kyogre
Rayquaza
Jirachi
Deoxys
Dialga
Palkia
Giratina
Arceus
Reshiram
Zekrom
Kyurem
Xerneas
Yveltal
Zygarde
Solgaleo
Lunala
Necrozma
Zacian
Zamazenta
Eternatus
Koraidon
Miraidon
Ash Ketchum
Misty
Brock
Gary Oak
Professor Oak
Jessie
James
Giovanni
Tracey
May
Max
Dawn
Iris
Cilan
Serena
Clemont
Bonnie
Lillie
Kiawe
Lana
Mallow
Sophocles
Goh
Leon
Cynthia
Steven Stone
Lance
Diantha
Alder
Raihan
Paul
Alain`;

const RG_DRAGONBALL_RAW = `Goku
Vegeta
Gohan
Goten
Trunks
Future Trunks
Piccolo
Krillin
Tien Shinhan
Chiaotzu
Yamcha
Master Roshi
Bulma
Chi-Chi
Videl
Pan
Mr. Satan
Majin Buu
Uub
Bardock
Gine
Raditz
Nappa
King Vegeta
Tarble
Frieza
King Cold
Cooler
Zarbon
Dodoria
Captain Ginyu
Jeice
Burter
Recoome
Guldo
Android 16
Android 17
Android 18
Android 19
Dr. Gero
Cell
Babidi
Dabura
Supreme Kai
Kibito
Beerus
Whis
Champa
Vados
Zeno
Grand Priest
Hit
Cabba
Caulifla
Kale
Kefla
Frost
Botamo
Magetta
Jiren
Toppo
Dyspo
Goku Black
Zamasu
Fused Zamasu
Broly
Paragus
Gogeta
Vegito
Gotenks
Moro
Merus
Granolah
Gas
Elec`;

const RG_HELLSPARADISE_RAW = `Gabimaru
Yamada Asaemon Sagiri
Yuzuriha
Aza Chobei
Aza Toma
Tamiya Gantetsusai
Yamada Asaemon Fuchi
Yamada Asaemon Shion
Nurugai
Yamada Asaemon Tenza
Yamada Asaemon Senta
Yamada Asaemon Eizen
Yamada Asaemon Genji
Yamada Asaemon Kisho
Yamada Asaemon Jikka
Yamada Asaemon Shugen
Isuzu
Kiyomaru
Mei
Rien
Zhu Jin
Mu Dan
Ju Fa
Tao Fa
Gui Fa`;

const RG_GACHIAKUTA_RAW = `Rudo
Enjin
Zanka
Riyo
Tamsy
Delmon
Bro
Dear
Guita
Gris
Follo
Tomme
Corvus
Semiu
August
Eishia
Zodyl
Jabber
Cthoni
Noerde
Fu
Bundus
Regto
Chiwa
Alice
Remlin
Amo`;

const RG_HAIKYUU_RAW = `Shoyo Hinata
Tobio Kageyama
Kei Tsukishima
Tadashi Yamaguchi
Daichi Sawamura
Koshi Sugawara
Asahi Azumane
Yu Nishinoya
Ryunosuke Tanaka
Chikara Ennoshita
Hisashi Kinoshita
Kazuhito Narita
Kiyoko Shimizu
Hitoka Yachi
Ittetsu Takeda
Keishin Ukai
Toru Oikawa
Hajime Iwaizumi
Issei Matsukawa
Takahiro Hanamaki
Shinji Watari
Shigeru Yahaba
Yutaro Kindaichi
Akira Kunimi
Tetsuro Kuroo
Kenma Kozume
Morisuke Yaku
Nobuyuki Kai
Taketora Yamamoto
Shohei Fukunaga
Lev Haiba
So Inuoka
Tamahiko Teshiro
Kotaro Bokuto
Keiji Akaashi
Akinori Konoha
Wakatoshi Ushijima
Satori Tendo
Tsutomu Goshiki
Kenjiro Shirabu
Eita Semi
Reon Ohira
Taichi Kawanishi
Atsumu Miya
Osamu Miya
Shinsuke Kita
Rintaro Suna
Aran Ojiro
Korai Hoshiumi
Sachiro Hirugami
Motoya Komori
Kiyoomi Sakusa
Takanobu Aone
Kenji Futakuchi
Kanji Koganegawa
Yuji Terushima
Suguru Daisho`;

const RG_JJK_RAW = `Yuji Itadori
Megumi Fushiguro
Nobara Kugisaki
Satoru Gojo
Yuta Okkotsu
Maki Zenin
Toge Inumaki
Panda
Masamichi Yaga
Kento Nanami
Shoko Ieiri
Kiyotaka Ijichi
Atsuya Kusakabe
Aoi Todo
Mai Zenin
Kasumi Miwa
Kokichi Muta
Mechamaru
Noritoshi Kamo
Momo Nishimiya
Utahime Iori
Yoshinobu Gakuganji
Suguru Geto
Kenjaku
Toji Fushiguro
Riko Amanai
Misato Kuroi
Yu Haibara
Ryomen Sukuna
Mahito
Jogo
Hanami
Dagon
Choso
Eso
Kechizu
Uraume
Mei Mei
Ui Ui
Yuki Tsukumo
Tengen
Naobito Zenin
Naoya Zenin
Ogi Zenin
Jinichi Zenin
Kinji Hakari
Kirara Hoshi
Hiromi Higuruma
Fumihiko Takaba
Hajime Kashimo
Reggie Star
Remi
Rin Amai
Iori Hazenoki
Chizuru Hari
Ryu Ishigori
Takako Uro
Dhruv Lakdawalla
Kurourushi
Hana Kurusu
Angel
Charles Bernard`;

const RG_JOJO_RAW = `Jonathan Joestar
Joseph Joestar
Jotaro Kujo
Josuke Higashikata
Giorno Giovanna
Jolyne Cujoh
Johnny Joestar
Josuke Higashikata Gappy
Dio Brando
Robert E. O. Speedwagon
Will A. Zeppeli
Erina Pendleton
Dire
Straizo
Caesar Zeppeli
Lisa Lisa
Rudol von Stroheim
Santana
Wamuu
Esidisi
Kars
Suzi Q
Muhammad Avdol
Noriaki Kakyoin
Jean Pierre Polnareff
Iggy
Hol Horse
Enya
Vanilla Ice
Oingo
Boingo
Mariah
Pet Shop
Koichi Hirose
Okuyasu Nijimura
Rohan Kishibe
Yukako Yamagishi
Shigekiyo Yangu
Tonio Trussardi
Akira Otoishi
Reimi Sugimoto
Yoshikage Kira
Bruno Bucciarati
Guido Mista
Narancia Ghirga
Leone Abbacchio
Pannacotta Fugo
Trish Una
Diavolo
Vinegar Doppio
Risotto Nero
Prosciutto
Pesci
Ghiaccio
Melone
Formaggio
Illuso
Ermes Costello
Foo Fighters
Weather Report
Narciso Anasui
Emporio Alnino
Enrico Pucci
Gyro Zeppeli
Diego Brando
Funny Valentine
Hot Pants
Lucy Steel`;

const RG_TENSURA_RAW = `Rimuru Tempest
Veldora Tempest
Shizue Izawa
Benimaru
Shuna
Shion
Souei
Hakuro
Kurobe
Gobta
Rigurd
Rigur
Ranga
Geld
Gabiru
Diablo
Testarossa
Carrera
Ultima
Zegion
Apito
Kumara
Adalmann
Milim Nava
Ramiris
Guy Crimson
Luminous Valentine
Leon Cromwell
Dagruel
Dino
Frey
Carrion
Clayman
Hinata Sakaguchi
Chloe Aubert
Yuuki Kagurazaka
Kagali
Laplace
Tear
Footman
Velgrynd
Velzard
Treyni
Beretta
Kaijin
Gazel Dwargo`;

const RG_OPM_RAW = `Saitama
Genos
King
Tatsumaki
Fubuki
Bang
Bomb
Blast
Mumen Rider
Atomic Samurai
Child Emperor
Metal Knight
Zombieman
Drive Knight
Pig God
Superalloy Darkshine
Watchdog Man
Flashy Flash
Tanktop Master
Metal Bat
Puri-Puri Prisoner
Amai Mask
Iaian
Okamaitachi
Bushidrill
Spring Mustachio
Golden Ball
Tanktop Tiger
Tanktop Black Hole
Speed-o'-Sound Sonic
Garou
Suiryu
Boros
Melzargard
Geryuganshoop
Groribas
Orochi
Psykos
Gyoro Gyoro
Black Sperm
Homeless Emperor
Elder Centipede
Gouketsu
Fuhrer Ugly
Nyan
Phoenix Man
Deep Sea King
Vaccine Man
Carnage Kabuto
Mosquito Girl
Beast King
Armored Gorilla
Dr. Genus`;

const RG_SAO_RAW = `Kirito
Kazuto Kirigaya
Asuna Yuuki
Leafa
Suguha Kirigaya
Sinon
Shino Asada
Klein
Agil
Yui
Silica
Lisbeth
Sachi
Argo
Diavel
Kibaou
Heathcliff
Akihiko Kayaba
Yuuki Konno
Sakuya
Alicia Rue
Recon
Oberon
Nobuyuki Sugou
Death Gun
XaXa
PoH
Vassago Casals
Eugeo
Alice Zuberg
Selka Zuberg
Ronie Arabel
Tiese Shtolienen
Cardinal
Administrator
Quinella
Chudelkin
Bercouli Synthesis One
Fanatio Synthesis Two
Deusolbert
Sheyta
Iskahn
Gabriel Miller`;

const RG_TOKYOGHOUL_RAW = `Ken Kaneki
Touka Kirishima
Rize Kamishiro
Hideyoshi Nagachika
Nishiki Nishio
Kimi Nishino
Hinami Fueguchi
Yoshimura
Eto Yoshimura
Ayato Kirishima
Renji Yomo
Shu Tsukiyama
Uta
Itori
Roma Hoito
Kaya Irimi
Enji Koma
Kishou Arima
Juuzou Suzuya
Kotaro Amon
Akira Mado
Kureo Mado
Seidou Takizawa
Yukinori Shinohara
Iwao Kuroiwa
Koori Ui
Take Hirako
Mougan Tanakamaru
Yakumo Oomori
Jason
Naki
Tatara
Noro
Donato Porpora
Shachi
Haise Sasaki
Kuki Urie
Ginshi Shirazu
Tooru Mutsuki
Saiko Yonebayashi
Shinsanpei Aura
Hairu Ihei
Nimura Furuta
Kanae von Rosewald
Kurona Yasuhisa
Nashiro Yasuhisa`;

const RG_TOKYOREVENGERS_RAW = `Takemichi Hanagaki
Manjiro Sano
Mikey
Ken Ryuguji
Draken
Keisuke Baji
Chifuyu Matsuno
Takashi Mitsuya
Kazutora Hanemiya
Haruki Hayashida
Pah-chin
Ryohei Hayashi
Peh-yan
Nahoya Kawata
Smiley
Souya Kawata
Angry
Hakkai Shiba
Atsushi Sendo
Akkun
Takuya Yamamoto
Makoto Suzuki
Kazushi Yamagishi
Hinata Tachibana
Naoto Tachibana
Emma Sano
Shinichiro Sano
Tetta Kisaki
Shuji Hanma
Nobutaka Osanai
Taiju Shiba
Yuzuha Shiba
Seishu Inui
Hajime Kokonoi
Izana Kurokawa
Kakucho
Kanji Mochizuki
Shion Madarame
Ran Haitani
Rindo Haitani
Yasuhiro Muto
Mucho
Haruchiyo Sanzu
South Terano
Senju Kawaragi
Takeomi Akashi
Wakasa Imaushi
Keizo Arashi
Benkei`;

const RG_UNIVERSES = {
    naruto: { name: "Naruto", raw: NARUTO_RAW },
    onepiece: { name: "One Piece", raw: ONEPIECE_RAW },
    bleach: { name: "Bleach", raw: BLEACH_RAW },
    hxh: { name: "Hunter x Hunter", raw: RG_HXH_RAW },
    snk: { name: "SNK / L'Attaque des Titans", raw: RG_SNK_RAW },
    sds: { name: "Seven Deadly Sins", raw: SDS_RAW },
    deathnote: { name: "Death Note", raw: RG_DEATHNOTE_RAW },
    cote: { name: "Classroom of the Elite", raw: RG_COTE_RAW },
    solo: { name: "Solo Leveling", raw: RG_SOLO_RAW },
    clover: { name: "Black Clover", raw: CLOVER_RAW },
    fireforce: { name: "Fire Force", raw: RG_FIREFORCE_RAW },
    mushoku: { name: "Mushoku Tensei", raw: RG_MUSHOKU_RAW },
    rezero: { name: "Re:Zero", raw: RG_REZERO_RAW },
    fairy: { name: "Fairy Tail", raw: FAIRY_RAW },
    bluelock: { name: "Blue Lock", raw: RG_BLUELOCK_RAW },
    fma: { name: "Fullmetal Alchemist", raw: RG_FMA_RAW },
    chainsaw: { name: "Chainsaw Man", raw: RG_CHAINSAW_RAW },
    wakfu: { name: "Wakfu", raw: RG_WAKFU_RAW },
    demonslayer: { name: "Demon Slayer", raw: RG_DEMONSLAYER_RAW },
    pokemon: { name: "Pokémon", raw: RG_POKEMON_RAW },
    dragonball: { name: "Dragon Ball", raw: RG_DRAGONBALL_RAW },
    hellsparadise: { name: "Hell's Paradise", raw: RG_HELLSPARADISE_RAW },
    gachiakuta: { name: "Gachiakuta", raw: RG_GACHIAKUTA_RAW },
    haikyuu: { name: "Haikyuu", raw: RG_HAIKYUU_RAW },
    jjk: { name: "Jujutsu Kaisen", raw: RG_JJK_RAW },
    jojo: { name: "JoJo's Bizarre Adventure", raw: RG_JOJO_RAW },
    tensura: { name: "Tensura", raw: RG_TENSURA_RAW },
    opm: { name: "One Punch Man", raw: RG_OPM_RAW },
    sao: { name: "Sword Art Online", raw: RG_SAO_RAW },
    tokyoghoul: { name: "Tokyo Ghoul", raw: RG_TOKYOGHOUL_RAW },
    tokyorevengers: { name: "Tokyo Revengers", raw: RG_TOKYOREVENGERS_RAW },
};

// ================= Rolland Garos V12 — pools élargis, sans doublons ni formes =================
// 1 personnage = 1 entrée. Les formes (Goku Black, Haise Sasaki, Pain...) et les doublons
// d'écriture (Uchiwa/Uchiha, Jäger/Yeager...) ont été retirés ; ils restent acceptés comme alias.
const RG_POOLS_V2 = {"naruto":["Naruto Uzumaki","Sasuke Uchiha","Sakura Haruno","Kakashi Hatake","Itachi Uchiha","Hinata Hyūga","Gaara","Minato Namikaze","Madara Uchiha","Hashirama Senju","Neji Hyūga","Jiraiya","Agara","Ageha","Akahoshi","Akamaru","Akatsuchi","Akino","Anko Mitarashi","Ao","Aoi Rokushô","Arashi Fûma","Ashina Uzumaki","Asura Ōtsutsuki","Asuma Sarutobi","Ayame","Black Zetsu","Boruto Uzumaki","Chino","Chiriku","Chiyo","Chôchô Akimichi","Chôji Akimichi","Chôza Akimichi","Daemon","Danzô Shimura","Darui","Deidara","Denki Kaminarimon","Ebisu","Fû","Fū Yamanaka","Fubuki Kakuyoku","Fugaku Uchiha","Might Guy","Gama","Gamabunta","Gamakichi","Hagoromo Ôtsutsuki","Haku","Hamura Ôtsutsuki","Hanabi Hyûga","Hanzô","Hayate Gekkô","Hiashi Hyûga","Hidan","Himawari Uzumaki","Hiruzen Sarutobi","Ibiki Morino","Indra Ôtsutsuki","Ino Yamanaka","Inoichi Yamanaka","Inojin Yamanaka","Iruka Umino","Izumi Uchiha","Jigen","Jinpachi Munashi","Jirôbô","Jirocho","Jōseki","Jûbi","Jûgo","Jūjin","Jūzō Biwa","Kabuto Yakushi","Kagami Uchiha","Kagari","Kaguya Ôtsutsuki","Kakuzu","Kankurô","Karin Uzumaki","Karui","Katsuyu","Kawaki","Kisame Hoshigaki","Konan","Konohamaru Sarutobi","Kurama","Kushina Uzumaki","Matatabi","Meï Terumi","Metal Lee","Might Duy","Mito Uzumaki","Mitsuki","Momoshiki Ôtsutsuki","Mû","Nagato","Obito Uchiha","Omoï","Onoki","Orochimaru","Pakkun","Rin Nohara","Rock Lee","Saï","Samui","Sarada Uchiha","Sasori","Shikadai Nara","Shikaku Nara","Shikamaru Nara","Shino Aburame","Shisui Uchiha","Shukaku","Son Gokû","Suzume","Temari","Tenten","Tobirama Senju","Tsunade","Utakata","White Zetsu","Yahiko","Yamato","Zōmei","Zôri","Kiba Inuzuka","Kurenai Yūhi","A","Rasa","Baki","Chōjūrō","Yagura Karatachi","Zabuza Momochi","Suigetsu Hōzuki","Mangetsu Hōzuki","Kurotsuchi","Gengetsu Hōzuki","Mifune","Izuna Uchiha","Kinshiki Ōtsutsuki","Isshiki Ōtsutsuki","Toneri Ōtsutsuki","Gyūki","Isobu","A — Premier Raikage","A — Troisième Raikage","Agari Kichi","Ajisaï","Akaboshi","Akio","Amachi","Amado Sanzu","Amaru","Ameyuri Ringo","Ami","Aoba Yamashiro","Aoda","Araya","Atsui","Baïu","Baku","Bansai","Bekkō","Benga","Benten","Bifū","Bikō","Biwako Sarutobi","Blue B","Boro","Bull","Bunpuku","Buntan Kurosuki","Burō","Byakuren","C","Chōbi","Chōhan","Chômei","Chōsa","Chûkichi","Chûshin","Code","Daikoku Funeno","Dajimu","Dan Katô","Datsuji","Deepa","Delta","Denka","Dodaï","Dōjō","Doki","Dōmu","Doshu Goetsu","Dosu Kinuta","Dotô Kazahana","Ebizô","Eida","Eiki","En Chinoike","En no Gyôja","Enko Onikuma","Enma","Ensui Nara","Fudo","Fuen","Fugai","Fuguki Suikazan","Fûjin","Fûka","Fukai","Fukasaku","Fuki","Fukusuke Hiashira","Funamushi","Fūshin","Fūta","Gamahiro","Gamaken","Gamamaru","Gamariki","Gamatabi","Gamatatsu","Gantetsu","Garaga","Gari","Gatô","Gengo","Genma Shiranui","Gennô","Genzô","Gerotora","Giichi","Ginkaku","Gôzu","Gulko","Guren","Guruguru","Gyokurō","Hachidai","Haido","Hakkaku","Hako Kuroi","Han","Hana Inuzuka","Hanare","Hanzaki","Haruna","Harusame","Hina","Hiruko","Hizashi Hyûga","Hoheto Hyûga","Hōichi","Hōki Taketori","Hokuto","Homura Mitokado","Hotaru","Hotarubi","Hyô","Ibuse","Idate Morino","Ikkaku Umino","Inabi Uchiwa","Inari","Iō","Isaribi","Ishikawa","Ittan","Ittetsu","Iwabee Yuino","Iwana Akame","Iwashi Tatami","Izumo Kamizuki","Jako","Jibachi Kamizuru","Jiga","Jigumo","Jin","Jinin Akebino","Kagerô Fûma","Kaiza","Kaji","Kakkou","Kamatari","Kamikiri","Kandachi","Kanna","Kanpachi","Karashi","Karura","Kashin Koji","Katasuke Tôno","Kazuma","Kido Tsumiki","Kidômaru","Kigiri","Kihô","Kikunojô","Kimimaro Kaguya","Kin Tsuchi","Kinkaku","Kirara","Kirisame","Kitsuchi","Kiyoi Yotsuki","Kô Hyûga","Kogen","Kohari Mitokado","Koharu Utatane","Koji Kashin","Kokuô","Komachi","Komori","Kôsuke Maruboshi","Kotetsu Hagane","Kotohime","Koyuki Kazahana","Kujaku","Kurobachi Kamizuru","Kurobane Raijin","Kushimaru Kuriarare","Kyodaigumo","Kyodaija","Kyūsuke","Lando","Lone","Mabui","Madame Shijimi","Mahiru","Maki","Mamushi","Manabu Akado","Manda","Matsu","Matsuri","Meizu","Menma Uzumaki","Meno","Menza","Midare","Mikoshi","Mikoto Uchiwa","Minoichi","Mirai Sarutobi","Misumi Tsurugi","Mizore Fuyukuma","Mizuki Tôji","Mizura","Mō","Moegi Kazamatsuri","Monju","Monzaemon Chikamatsu","Mōryō","Mōsō","Motoi","Mozuku","Mubi","Mugino","Mukade","Murasame","Muta Aburame","Nadare Rôga","Namida Suzumeno","Nangô","Naori Uchiwa","Natori","Natsuhi","Nawaki","Nekobaa","Nekomata","Ningame","Ninkame","Nishi","Nono Yakushi","Nue","Nurari","Oboro","Okisuke","Oogama Sennin","Osoi","Otoha","Pakura","Pochi","Ponta","Princesse Fuku","Raidô Namiashi","Raïga Kurosuki","Raimei","Ranka","Ranke","Ranmaru","Renga","Reto","Rinji","Rō","Rôshi","Ryûgan","Ryūmyaku","Ryūzetsu","Sabu","Saiken","Sakon","Sakumo Hatake","Sana","Sandayuu Azama","Sari","Sasame Fûma","Satori","Saya","Sazanami","Seimei","Sekka","Sen","Shamon","Shiba","Shibai Ôtsutsuki","Shibi Aburame","Shibito Azuma","Shibuki","Shigure","Shiho","Shiin","Shikuro Aburame","Shima","Shimon Hijiri","Shin Uchiwa","Shinki","Shinnô","Shion","Shiore","Shira","Shiranami","Shisou","Shizuka","Shizune","Shun","Shura","Sora","Sôtetsu Kazahana","Suien","Suika","Suiko","Suiren","Sumaru","Sumashi","Sumire Kakei","Suzumebachi Kamizuru","Taiseki","Tajima Uchiwa","Tamaki","Tatewaki","Tayuya","Tazuna","Tenga","Tenji","Tera","Teraï","Teuchi","Teyaki Uchiwa","Todoroki","Tōka Senju","Tokuma Hyûga","Tonbo Tobitake","Tonton","Toroi","Torune Aburame","Towa","Tsubaki Kurogane","Tsuguri","Tsukino","Tsunami","Tsurushi Hachiya","Udon Ise","U-hei","Ukon","Ulshi","Umibôzu","Urakaku","Urashiki Ôtsutsuki","Uruchi Uchiwa","Urushi","Victor","Wagarashi","Waraji","Wasabi Izuno","Watari Nagare","Wataru","Yakumo Kurama","Yashamaru","Yashiro Uchiwa","Yodo","Yome","Yoro","Yoroï Akadô","Yoshino Nara","Yota","Yotaka","Yûgao Uzuki","Yugito Nii","Yukata","Yûkimaru","Yûra","Yurinojô","Zaji","Zaku Abumi","Zansūru","Tsume Inuzuka","Kizashi Haruno","Mebuki Haruno","Hikaku Uchiha","Butsuma Senju","Kawarama Senju","Itama Senju"],"onepiece":["Monkey D. Luffy","Roronoa Zoro","Nami","Sanji","Nico Robin","Trafalgar D. Water Law","Shanks","Portgas D. Ace","Marshall D. Teach","Kaido","Boa Hancock","Sabo","Abdullah","Absalom","Ain","Aisa","Aladine","Alpacaman","Alvida","Charlotte Amande","Andre","Aphelandra","Aramaki","Arlong","Ashura Doji","Atlas","Atmos","Avalo Pizarro","Axe-Hand Morgan","Babanuki","Baby 5","Baccarat","Baggaley","Bakkin","Bao Huang","Bariete","Bartholomew Kuma","Bartolomeo","Basil Hawkins","Bastille","Batman","Bellamy","Bell-mère","Belo Betty","Benn Beckman","Bentham","Bepo","Big Pan","Billy","Binz","Black Maria","Blackback","Blamenco","Blenheim","Blue Gilly","Blueno","Boa Marigold","Boa Sandersonia","Bobbin","Bogard","Jewelry Bonney","Boo","Boodle","Borsalino","Brannew","Briscola","Brogy","Brook","Brownbeard","Buchi","Buffalo","Buggy","Byrnndi World","Cabaji","Caesar Clown","Caimanlady","Kalgara","Camie","Capone Bege","Caribou","Carina","Carmel","Carne","Carrot","Catarina Devon","Cavendish","Chaka","Charlos","Charlotte Anana","Charlotte Anglais","Charlotte Basans","Charlotte Bavarois","Charlotte Brownie","Charlotte Brûlée","Charlotte Chiboust","Charlotte Chiffon","Charlotte Cinnamon","Charlotte Citron","Charlotte Compote","Charlotte Counter","Charlotte Cracker","Charlotte Custard","Charlotte Daifuku","Charlotte Decuple","Charlotte Dolce","Charlotte Dragée","Charlotte Flampe","Charlotte Galette","Charlotte Harumatsu","Charlotte Joconde","Charlotte Joscarpone","Charlotte Kanten","Charlotte Katakuri","Charlotte Kato","Charlotte Linlin","Charlotte Lola","Charlotte Mascarpone","Charlotte Mash","Charlotte Mobile","Charlotte Mont-d'Or","Charlotte Moscato","Charlotte Myukuru","Charlotte Newichi","Charlotte Newji","Charlotte Nougat","Charlotte Nusstorte","Charlotte Opera","Charlotte Oven","Charlotte Perospero","Charlotte Poire","Charlotte Praline","Charlotte Pudding","Charlotte Raisin","Charlotte Smoothie","Charlotte Snack","Charlotte Tablet","Charlotte Yuen","Chess","Chew","Chimney","Clover","Conis","Coribou","Crocodile","Crocus","Curiel","Curly Dadan","Dagama","Daifugo","Daikoku","Dalmatian","Dalton","Damask","Daruma","Daz Bones","Dellinger","Demalo Black","Den","Denjiro","Diamante","Dice","Disco","Doberman","Dobon","Doc Q","Doma","Domino","Don Chinjao","Don Krieg","Donquixote Doflamingo","Donquixote Homing","Donquixote Mjosgard","Donquixote Rosinante","Dorry","Dosun","Douglas Bullet","Dr. Hiriluk","Dr. Hogback","Dr. Indigo","Dr. Kureha","Dracule Mihawk","Perona","Du Feld","Duval","Edison","Edward Newgate","Edward Weevil","Elizabello II","Emporio Ivankov","Enel","Epoida","Saint Ethanbaron V. Nusjuro","Eustass Kid","Farafra","Fisher Tiger","Fossa","Foxy","Franky","Fukaboshi","Fukuro","Fukurokuju","Fullbody","Funkfreed","Scopper Gaban","Gaimon","Galdino","Gambia","Gan Fall","Gasparde","Gazelleman","Gecko Moria","Gedatsu","Genzo","Gerd","Gin","Ginny","Ginrummy","Giolla","Gladius","Gloriosa","Gol D. Roger","Gonbe","Gordon","Gotti","Guernica","Gyaro","Gyukimaru","Hack","Hajrudin","Hamburg","Hammond","Hannyabal","Hanzo","Haredas","Haruta","Hatchan","Hattori","Heat","Helmeppo","Héra","Heracles","Hildon","Hina","Hody Jones","Holdem","Hongo","Hotori","Hyogoro","Hyouzou","Iceburg","Ideo","Igaram","Ikaros Much","Imu","Inazuma","Inuarashi","Ipponmatsu","Issho","Isuka","Itomimizu","Izo","Jabra","Jack","Jaguar D. Saul","Jango","Saint Jaygarcia Saturn","Jean Bart","Jeet","Jesus Burgess","Jinbe","Jiro","John","Johnny","Jonathan","Jora","Joy Boy","Jozu","Kaku","Kalifa","Kanjuro","Karasu","Karoo","Kashii","Kawamatsu","Kaya","Kikunojo","Kikyo","Killer","Kin'emon","King","King Neptune","Kingdew","Koala","Koby","Kokoro","Komachiyo","Komurasaki","Kong","Kotori","Koushirou","Koza","Kozuki Hiyori","Kozuki Momonosuke","Kozuki Oden","Kozuki Sukiyaki","Kozuki Toki","Kuina","Kumadori","Kumashi","Kuro","Kuromarimo","Kuroobi","Kurozumi Higurashi","Kurozumi Orochi","Kuzan","Kyoshiro","Kyros","Laboon","Lacroix","Laffitte","Laki","Lao G","Leo","Lilith","Lindbergh","Little Oars Jr.","Loki","Lonz","Lorenz","Lucky Roux","Lulu","Machvise","Macro","Magellan","Makino","Manboshi","Mansherry","Marco","Saint Marcus Mars","Marguerite","Masira","Maynard","McGuy","McKinley","Merry","Minatomo","Miss Doublefinger","Miss Friday","Miss Goldenweek","Miss Merry Christmas","Miss Monday","Miss Valentine","Miyagi","Mohji","Momonga","Monet","Monkey D. Dragon","Monkey D. Garp","Mont Blanc Cricket","Mont Blanc Noland","Morgans","Morley","Mouseman","Mousse","Mozambia","Mr. 13","Mr. 4","Mr. 5","Mr. 7","Mr. 9","Namur","Napoléon","Nefertari Cobra","Nefertari D. Lili","Nefertari Vivi","Nekomamushi","Nero","Nezumi","Nico Olvia","Ninjin","Nojiko","Nure-Onna","Nyon","Oars","Ochoku","Ohm","Oimo","Okiku","Onigumo","Onimaru","Orlumbus","O-Tama","Otohime","O-Toko","O-Tsuru","Pagaya","Page One","Pappag","Patty","Paulie","Pearl","Pedro","Pekoms","Pell","Penguin","Pica","Pierre","Porche","Porchemy","Portgas D. Rouge","Pound","Prometheus","Pythagoras","Queen","Rabbitman","Raizo","Raki","Rakuyo","Rebecca","Richie","Riku Doldo III","Rindo","Rob Lucci","Rocks D. Xebec","Rockstar","Roddy","Roshio","Rosward","Rush","Ryuboshi","Ryuma","Sadi","Saga","Sai","Saint Figarland Garling","Saint Shepherd Ju Peter","Saint Topman Warcury","Sakazuki","Saldeath","Salome","Sanjuan Wolf","Sarahebi","Sarquiss","Sarutobi","Sasaki","Satori","S-Bat","S-Bear","Scarlett","Scotch","Scratchmen Apoo","Sengoku","Senor Pink","Sentomaru","S-Flamingo","Shachi","Shaka","Shakuyaku","Shalria","Sham","S-Hawk","Sheepshead","Shiki","Shiryu","Shimotsuki Kozaburo","Shimotsuki Yasuie","Shinobu","Shirahoshi","Shoujou","Shura","Shyarly","Sicilian","Silver Axe","Silvers Rayleigh","Smoker","Solitaire","Spandam","Spandine","Speed","Speed Jill","Squardo","S-Shark","S-Snake","Strawberry","Streusen","Stronger","Stussy","Sugar","Suleiman","Surume","Sweet Pea","Tamago","Tank Lepanto","Tansui","Tararan","Taro","Tashigi","T-Bone","Tenguyama Hitetsu","Terracotta","Tesoro","Thatch","Tilestone","Tom","Tonoyasu","Tony Tony Chopper","Toto","Trebol","Tristan","Tsuru","Ucy","Ulti","Urashima","Urouge","Usopp","Uta","Van Augur","Vander Decken IX","Vasco Shot","Vegapunk","Vergo","Victoria Cindry","Vinsmoke Ichiji","Vinsmoke Judge","Vinsmoke Niji","Vinsmoke Reiju","Vinsmoke Sora","Vinsmoke Yonji","Viola","Vista","Vito","Wadatsumi","Wanda","Wanze","Wapol","Whitey Bay","Who's Who","Wire","Wyper","X Drake","Yama","Yamakaji","Yamato","Yasopp","Yokozuna","Yosaku","Yuda","Zala","Zambai","Zeff","Zeo","Zephyr","Zepo","Zeus","Zodia","Zunesha","Toko","Vegapunk York","Hachi","Momousagi","Chaton","Shamrock","Woop Slap","Shakky","Margaret"],"bleach":["Ichigo Kurosaki","Rukia Kuchiki","Renji Abarai","Byakuya Kuchiki","Toshiro Hitsugaya","Kenpachi Zaraki","Sosuke Aizen","Uryu Ishida","Grimmjow Jaegerjaquez","Ulquiorra Cifer","Kisuke Urahara","Yhwach","Acidwire","Akon","As Nodt","Asguiaro Ebern","Ashido Kano","Bambietta Basterbine","Baraggan Louisenbairn","Bazz-B","BG9","Bonnie","Chojiro Sasakibe","Cirucci Sanderwicci","Coyote Starrk","Cyan Sung-Sun","Danon","Di Roy Rinker","Edrad Liones","Eikichirō Saidō","Ganryu","Garogai","Genryusai Shigekuni Yamamoto","Gerard Valkyrie","Gin Ichimaru","Ginrei Kuchiki","Giriko Kutsuzawa","Giselle Gewelle","Grand Fisher","Gremmy Thoumeaux","Shuhei Hisagi","Hisana Kuchiki","Ichibe Hyosube","Isane Kotetsu","Isshin Kurosaki","Jugram Haschwalth","Jushiro Ukitake","Lille Barro","Oetsu Nimaiya","Orihime Inoue","Ouko Yushima","Pernida Parnkgjas","Rangiku Matsumoto","Retsu Unohana","Shinji Hirako","Shunsui Kyoraku","Soi Fon","Soken Ishida","Soul King","Szayelaporro Granz","Tier Harribel","Yachiru Kusajishi","Yoruichi Shihoin","Yylfordt Granz","Zangetsu","Zennosuke Kurumadani","Zommari Rureaux","Mayuri Kurotsuchi","Kaname Tosen","Nnoitra Gilga","Askin Nakk Le Vaar","Aaroniero Arruruerie","Abirama Redder","Aura Michibane","Baishin","Baura","Bawabawa","Berenice Gabrielli","Candice Catnipp","Cang Du","Charlotte Chuhlhourne","Chizuru Honsho","Choe Neng Poww","Don Kanonji","Dondochakka Birstanne","Dordoni Alessandro Del Socaccio","Driscoll Berci","Emilou Apacci","Enryu","Enzo","Fērum","Findorr Calius","Fishbone D","Franceska Mila Rose","Ganju Shiba","Gantenbainne Mosqueda","Genshiro Okikiba","Ggio Vega","Guenael Lee","Gunjo","Hachi","Hachigen Ushoda","Hanataro Yamada","Hanza Nukui","Hexapodus","Hikone Ubuginu","Hiyori Sarugaki","Hiyosu","Homura","Ikkaku Madarame","Ikumi Unagiya","Inose","Izuru Kira","Jackie Tristan","Jerome Guizbatt","Jidanbo Ikkanzaka","Jinnai Doko","Jinta Hanakari","Kageroza Inaba","Kaien Shiba","Kanae Katagiri","Karin Kurosaki","Kazui Kurosaki","Keigo Asano","Kenryu","Kensei Muguruma","Kirio Hikifune","Kiyone Kotetsu","Koga Kuchiki","Kokuto","Kon","Kugo Ginjo","Kukaku Shiba","Kumoi","Liltotto Lamperd","Lilynette Gingerbuck","Lisa Yadomaru","Loly Aivirrne","Love Aikawa","Loyd Lloyd","Luppi Antenor","Mahana Natsui","Maki Ichinose","Makoto Kibune","Marechiyo Omaeda","Marenoshin Ōmaeda","Masaki Kurosaki","Mashiro Kuna","Mask De Masculine","Meninas McAllon","Menis","Menoly Mallia","Michiru Ogawa","Mimihagi","Miyako Shiba","Mizuiro Kojima","Moe Shishigawara","Momo Hinamori","Muramasa","Nakeem Grindina","NaNaNa Najahkoop","Nanao Ise","Nelliel Tu Odelschwanck","Nemu Kurotsuchi","Nianzol Weizol","Ninny Spangcole","Nirgge Parduoc","Nozomi Kujo","Numb Chandelier","Pepe Waccabrada","Pesche Guatiche","Quilge Opie","Rin Tsubokura","Riruka Dokugamine","Riyan","Robert Accutrone","Rōjūrō Otoribashi","Royd Lloyd","Rudbornn Chelute","Rurichiyo Kasumioji","Ryo Kunieda","Ryuken Ishida","Ryusei Kenzaki","Sajin Komamura","Seinosuke Yamada","Senjumaru Shutara","Senna","Sentaro Kotsubaki","Shawlong Koufang","Shaz Domino","Shino Madarame","Shizuku","Shrieker","Shukuro Tsukishima","Shuren","Shusuke Amagai","Sojiro Kusaka","Sojun Kuchiki","Sora Inoue","Taikon","Tatsuki Arisawa","Tenjiro Kirinji","Tesla Lindocruz","Tessai Tsukabishi","Tetsuzaemon Iba","Tokinada Tsunayashiro","Ururu Tsumugiya","Wonderweiss Margela","Yammy Llargo","Yasutora Sado","Yukio Hans Vorarlberna","Yumichika Ayasegawa","Yūshirō Shihōin","Yuzu Kurosaki","Ichika Abarai"],"hxh":["Gon Freecss","Killua Zoldyck","Kurapika","Leorio Paradinight","Hisoka Morow","Chrollo Lucilfer","Illumi Zoldyck","Meruem","Isaac Netero","Neferpitou","Ging Freecss","Kite","Biscuit Krueger","Zeno Zoldyck","Silva Zoldyck","Kikyo Zoldyck","Milluki Zoldyck","Alluka Zoldyck","Nanika","Kalluto Zoldyck","Gotoh","Canary","Tsubone","Amane","Satotz","Menchi","Buhara","Lippo","Hanzo","Pokkle","Ponzu","Tonpa","Bodoro","Geretta","Melody","Basho","Squala","Baise","Dalzollene","Neon Nostrade","Light Nostrade","Nobunaga Hazama","Feitan Portor","Machi Komacine","Phinks Magcub","Franklin Bordeau","Shizuku Murasaki","Bonolenov Ndongo","Pakunoda","Uvogin","Shalnark","Kortopi","Razor","Genthru","Sub","Bara","Tsezguerra","Goreinu","Abengane","Shaiapouf","Menthuthuyoupi","Colt","Reina","Cheetu","Leol","Welfin","Bloster","Ikalgo","Meleoron","Zazan","Pike","Rammot","Morel Mackernasey","Knov","Knuckle Bine","Shoot McMahon","Palm Siberia","Komugi","Gyro","Wing","Zushi","Kastro","Riehlvelt","Sadaso","Gido","Mito Freecss","Beans","Cheadle Yorkshire","Pariston Hill","Mizaistom Nana","Botobai Gigante","Ginta","Kanzai","Saccho Kobayakawa","Cluck","Pyon","Gel","Linne Horsdoeuvre","Saiyu","Beyond Netero","Nasubi Hui Guo Rou","Benjamin Hui Guo Rou","Camilla Hui Guo Rou","Tserriednich Hui Guo Rou","Halkenburg Hui Guo Rou","Tubeppa Hui Guo Rou","Tyson Hui Guo Rou","Momoze Hui Guo Rou","Oito Hui Guo Rou","Woble Hui Guo Rou","Kacho Hui Guo Rou","Fugetsu Hui Guo Rou","Luzurus Hui Guo Rou","Theta","Salé-Salé","Bill","Hinrigh Vielopolsky","Morena Prudo","Koala","Hagya","Peggy","Brovada","Flutter","Hina","Eeta","Elena","Bopobo","Nickes","Maha Zoldyck","Zenji","Senritsu"],"snk":["Eren Yeager","Mikasa Ackerman","Armin Arlert","Levi Ackerman","Reiner Braun","Annie Leonhart","Zeke Yeager","Erwin Smith","Hange Zoë","Jean Kirstein","Connie Springer","Sasha Blouse","Historia Reiss","Ymir","Bertholdt Hoover","Marco Bott","Floch Forster","Petra Ral","Oluo Bozado","Eld Jinn","Gunther Schultz","Miche Zacharius","Moblit Berner","Keith Shadis","Dot Pixis","Darius Zackly","Kenny Ackerman","Rod Reiss","Frieda Reiss","Grisha Yeager","Dina Fritz","Pieck Finger","Porco Galliard","Marcel Galliard","Gabi Braun","Falco Grice","Theo Magath","Yelena","Onyankopon","Niccolo","Nanaba","Nile Dok","Uri Reiss","Carla Jäger","Eren Kruger","Colt Grice","Willy Tybur","Lara Tybur","Ymir Fritz","Hannes","Kiyomi Azumabito","Rico Brzenska","Mina Carolina","Thomas Wagner","Franz Kefka","Hannah Diamant","Samuel Linke-Jackson","Mylius Zeramuski","Nac Tius","Daz","Hitch Dreyse","Marlowe Freudenberg","Boris Feulner","Djel Sannes","Traute Carven","Kaya","Nifa","Ian Dietrich","Mitabi Jarnach","Gustav","Ilse Langnar","Anka Rheinberger","Karl Fritz","Tom Ksaver","Faye Yeager","Zofia","Udo","Calvi","Artur Braus","Alma","Karina Braun","Lobov","Gross","Louise","Ralph","Mr. Leonhart"],"sds":["Meliodas","Ban","King","Diane","Gowther","Merlin","Escanor","Elizabeth Liones","Zeldris","Estarossa","Mael","Hawk","Aldrich","Anne","Arthur Pendragon","Bartra Liones","Bellion","Burgie","Cain Barzad","Cath","Chandler","Chaos","Dale","Dalmally","Dana","Derieri","Dolores","Dreyfus","Drole","Elaine","Fraudrin","Galand","Gilthunder","Gloxinia","Griamore","Guila","Howzer","Hawk Mama","Helbram","Hendrickson","Jericho","Lancelot","Liz","Margaret Liones","Matrona","Melascula","Monspeet","Slader","Tristan","Twigo","Veronica Liones","Vivian","Zaneri","Zaratras","Zhivago","Ludociel","Sariel","Tarmiel","Cusack","Aranak","Arden","Atra","Cath Palug","Chion","Dahaka","Dahlia","Deathpierce","Deldry","Demon King","Denzel Liones","Dogedo","Dolor","Donny","Doronach","Dubs","Edlin","Ellatte","Fiddich","Friesia","Galla","Gannon","Gara","Gawain","Gelda","Gerheade","Golgius","Grayroad","Guinevere","Gustaf","Hugo","Ironside","Isolde","Jade","Jenna","Jenny","Jude","Kay","Lady of the Lake","Macduff","Marmas","Mild","Mod","Mortlach","Nadja Liones","Nanashi","Nasiens","Nerobasta","Ordo","Orlondi","Oslo","Pelio","Pellegarde","Pelliot","Percival","Ren","Rosa","Rou","Selion","Sennett","Simon","Solaad","Supreme Deity","Talisker","Tamdhu","Teaninich","Threader","Varghese","Waillo","Weinheidt","Wild","Zeal","Zoria"],"deathnote":["Light Yagami","L Lawliet","Misa Amane","Near","Mello","Ryuk","Rem","Teru Mikami","Soichiro Yagami","Touta Matsuda","Sachiko Yagami","Sayu Yagami","Shuichi Aizawa","Kanzo Mogi","Hideki Ide","Hirokazu Ukita","Watari","Kiyomi Takada","Naomi Misora","Raye Penber","Kyosuke Higuchi","Reiji Namikawa","Wedy","Aiber","Matt","Sidoh","Gelus","Halle Lidner","Stephen Gevanni","Anthony Rester","Rod Ross","Armonia Justin Beyondormason","Hitoshi Demegawa","Masahiko Kida","Shingo Mido","Arayoshi Hatori","Eiichi Takahashi","Suguru Shimura","Beyond Birthday","Jack Neylon","Roger Ruvie","Gook","Zellogi","Calikarcha","Deridovely","Midora","Nu","Jealous","Takeshi Ooi"],"cote":["Kiyotaka Ayanokoji","Suzune Horikita","Kikyo Kushida","Kei Karuizawa","Kakeru Ryuen","Arisu Sakayanagi","Honami Ichinose","Rokusuke Koenji","Manabu Horikita","Miyabi Nagumo","Yosuke Hirata","Ken Sudo","Kanji Ike","Haruki Yamauchi","Airi Sakura","Akito Miyake","Haruka Hasebe","Hiyori Shiina","Albert Yamada","Mio Ibuki","Ryuji Kanzaki","Masayoshi Hashimoto","Masumi Kamuro","Sae Chabashira","Chie Hoshinomiya","Ichika Amasawa","Takuya Yagami","Keisei Yukimura","Chiaki Matsushita","Maya Sato","Kokoro Inogashira","Kohei Katsuragi","Daichi Ishizaki","Nanase Tsubasa","Kazuomi Hosen","Fuka Kiryuin","Mei-Yu Wang","Akane Tachibana","Kazuma Sakagami","Atsuomi Ayanokoji","Nazuna Asahina","Tomonari Mashima","Narumori Sakayanagi","Tsukishiro","Satoru Kaneda","Hayato Kito","Miki Yamamura","Ai Morishita","Hiroya Tokito","Kayano Onodera","Mako Amikura","Satsuki Shinohara","Yuki Himeno","Tetsuya Machida","Ikuto Kiriyama","Tetsuya Hamaguchi","Kosei Sanada","Sotomura Hideo"],"solo":["Sung Jinwoo","Cha Hae-In","Choi Jong-In","Baek Yoonho","Yoo Jinho","Thomas Andre","Liu Zhigang","Igris","Beru","Antares","Sung Jinah","Park Kyung-Hye","Lee Joohee","Song Chi-Yul","Kim Sangshik","Hwang Dongsuk","Kang Taeshik","Hwang Dongsoo","Woo Jinchul","Go Gunhee","Lim Tae-Gyu","Ma Dongwook","Min Byung-Gyu","Christopher Reed","Siddharth Bachchan","Norma Selner","Bellion","Tusk","Iron","Tank","Kaisel","Ashborn","Baran","Rakan","Sillad","Querehsha","Tarnak","Legia","Yogumunt","Kandiaru","Esil Radiru","Kamish","Architect","Goto Ryuji","Vulcan","Metus","Cerberus","Kasaka","Barka","Fangs","Jima","Sung Il-Hwan","Yoo Soohyun","Lennart Niermann","Adam White","Yoo Myunghan","Han Songyi"],"clover":["Asta","Yuno","Noelle Silva","Yami Sukehiro","Luck Voltia","Magna Swing","Fuegoleon Vermillion","Mereoleona Vermillion","Julius Novachrono","Nacht Faust","Finral Roulacase","Vanessa Enoteca","Acier Silva","Alecdora Sandler","Charlotte Roselei","Charmy Pappitson","Ciel Grinberryall","Conrad Leto","Damnatio Kira","Dante Zogratis","Fana","Ichika Yami","Jack the Ripper","Kirsch Vermillion","Klaus Lunettes","Langris Vaude","Leopold Vermillion","Licht","Liebe","Lilith","Lolopechka","Lucifero","Lucius Zogratis","Marx Francois","Megicula","Mimosa Vermillion","Nero","Nozel Silva","Rill Boismortier","Sekke Bronzazza","Sister Lily","Sister Theresa","Undine","Vanica Zogratis","William Vangeance","Zenon Zogratis","Gauche Adlai","Gordon Agrippa","Grey","Dorothy Unsworth","Kaiser Granvorka","Zora Ideale","Patolli","Zagred","Adrammelech","Allen Fiarain","Aruru","Augustus Kira Clover XIII","Baro","Baval","Beelzebub","Broccos","Catherine","Charla","Daizaemon O'oka","David Swallow","Digit Taliss","Dominante Code","Drowa","Eclat","Ecthel","Edward Avalache","En Ringard","Fanzell Kruger","Father Fuego","Floga","Foyal Migusteau","Fragil Tormenta","Fujio","Gaderois Godroc","Gadjah","Gifso","Gimodelo","Ginnojomorifuyu Kezoukaku","Gueldre Poizot","Halbet Chevour","Hamon Caseus","Heath Grice","Henry Legolant","Hollo","Jester Garandros","Kabwe Carillon","Kahono","Kiato","Kivn","Komari Imari","Ladros","Letoile Becquerel","Lotus Whomalt","Loyce Grinberryall","Lucifugus","Lumiere Silvamillion Clover","Marie Adlai","Mariella","Mars","Milly Maxwell","Morgen Faust","Morris Libardirt","Mushogatake Yosuga","Naamah","Nash","Nathan Agrippa","Nebra Silva","Neige","Noze","Orsi Orfai","Owen","Plumede","Potrof","Princia Funnybunny","Puli Angel","Rades Spirito","Ragus","Raia","Ralph Niaflem","Randall Luftair","Rebecca Scarlet","Recca","Revchi Salik","Rhya","Richita","Robero Ringert","Roland","Ronne","Rufel","Ryudo Ryuya","Salim of Hapshass","Sally","Secre Swallowtail","Siren Tium","Sivoir Snyle","Slotos","Sol Marron","Solid Silva","Svenkin Gatard","Tetia","Valtos","Vetto","Walgner","Xerx Lugner","Yagos"],"fireforce":["Shinra Kusakabe","Arthur Boyle","Maki Oze","Tamaki Kotatsu","Akitaru Obi","Takehisa Hinawa","Benimaru Shinmon","Leonard Burns","Sho Kusakabe","Haumea","Iris","Viktor Licht","Vulcan Joseph","Lisa Isaribe","Yu","Konro Sagamiya","Hibana","Karim Flam","Rekka Hoshimiya","Ogun Montgomery","Pan Ko Paat","Joker","Charon","Arrow","Inca Kasugatani","Ritsu","Yona","Assault","Dragon","Giovanni","Nataku Son","Amaterasu","Yuichiro Kurono","Juggernaut","Kayoko Huang","Sumire"],"mushoku":["Rudeus Greyrat","Roxy Migurdia","Sylphiette","Eris Boreas Greyrat","Ruijerd Superdia","Orsted","Paul Greyrat","Ghislaine Dedoldia","Nanahoshi Shizuka","Zenith Greyrat","Lilia Greyrat","Norn Greyrat","Aisha Greyrat","Hitogami","Kishirika Kishirisu","Badigadi","Luke Notos Greyrat","Zanoba Shirone","Elinalise Dragonroad","Philip Boreas Greyrat","Hilda Boreas Greyrat","Sauros Boreas Greyrat","Perugius Dola","Almanfi","Soldat Heckler","Sara","Linia Dedoldia","Pursena Adoldia","Pax Shirone","Randolph Marianne","Ariel Anemoi Asura","Talhand","Geese Nukadia","Atofe","Cliff Grimoire","Julie","Laplace","Moore","Nina Farion","Jino Britts","Isolde Cruel","Auber Corbett","Wi Ta","Ginger York","Benedikte","Lara Greyrat","Lucie Greyrat","Darius Silva Garganti","Gall Falion","Alphonse","Reida Lia","Timothy Mayers"],"rezero":["Subaru Natsuki","Emilia","Rem","Ram","Beatrice","Roswaal L. Mathers","Reinhard van Astrea","Crusch Karsten","Priscilla Barielle","Regulus Corneas","Puck","Otto Suwen","Garfiel Tinsel","Frederica Baumann","Petra Leyte","Patrasche","Felt","Felix Argyle","Wilhelm van Astrea","Theresia van Astrea","Anastasia Hoshin","Julius Juukulius","Ricardo Welkin","Hetaro","Tivey","Al","Echidna","Satella","Minerva","Typhon","Daphne","Sekhmet","Carmilla","Pandora","Petelgeuse Romanee-Conti","Sirius Romanee-Conti","Capella Emerada Lugunica","Lye Batenkaitos","Roy Alphard","Louis Arneb","Elsa Granhiert","Meili Portroute","Mimi Pearlbaton","Fortuna","Liliana Masquerade","Clind","Kiritaka Muse","Halibel","Schult","Heinkel van Astrea","Russel Fellow","Flam","Grassis","Vincent Vollachia","Volcanica","Shaula","Ryuzu Meyer","Rom","Kadomon Risch","Joshua Juukulius"],"fairy":["Natsu Dragneel","Lucy Heartfilia","Gray Fullbuster","Erza Scarlet","Wendy Marvell","Gajeel Redfox","Laxus Dreyar","Juvia Lockser","Mirajane Strauss","Makarov Dreyar","Sting Eucliffe","Rogue Cheney","Acnologia","Aldoron","Alzack Connell","Anna Heartfilia","Aquarius","Arcadios","Aries","Athena","Bisca Connell","Cana Alberona","Cancer","Capricorn","Carla","Cobra","Coco","Deliora","Droy","Duke Barbaroa","Eve Tearm","Evergreen","Mavis Vermillion","Freed Justine","Frosch","Gemini","Gildarts Clive","Hades","Happy","Ichiya","Igneel","Jellal Fernandes","Jose Porla","Jura Neekis","Kagura Mikazuchi","Lector","Loke","Lyon Vastia","Macao Conbolt","Mest Gryder","Metalicana","Nadi","Neinhart","Nichiya","Org","Panther Lily","Racer","Ren Akatsuki","Romeo Conbolt","Scorpio","Sherria Blendy","Virgo","Wakaba Mine","Wally Buchanan","Warren Rocko","Warrod Sequen","Weisslogia","Wolfheim","Yajima","Yomazu","Yuka Suzuki","Yukino Agria","Yuri Dreyar","Yury","Zancrow","Zentopia","Zera","Zeref Dragneel","Zirconis","Zoldeo","Levy McGarden","Lisanna Strauss","Minerva Orland","Brandish μ","Irene Belserion","August","Dimaria Yesta","Larcade Dragneel","Ajeel Raml","Arana Webb","Aria","Asuka Connell","Atlas Flame","Azuma","Belno","Beth Vanderwood","Bickslow","Bloodman","Bluenote Stinger","Bob","Bora","Brain","Byro Cracy","Chapati Lola","Crux","Darton","Deneb","Dobengal","Dogramag","Duke Everlue","Elefseria","Elfman Strauss","Erigor","Extalia Queen","Ezel","Faris","Faust","Flare Corona","Franmalth","Georg Reizen","God Serena","Goldmine","Grandeeney","Guttman","Hibiki Lates","Hisui E. Fiore","Horologium","Hoteye","Hughes","Ignia","Ikaruga","Imitatia","Invel Yura","Jackal","Jackpot","Jacob Lessio","Jason","Jenny Realight","Jet","Jiemma","Jude Heartfilia","Kageyama","Kain Hikaru","Karen Lilica","Kawazu","Keith","Keyes","Kinana","Kurohebi","Kyoka","Laki Olietta","Layla Heartfilia","Leiji","Libra","Lyra","Mard Geer","Max Alors","Mercphobia","Meredy","Michelle Lobster","Michello","Midnight","Millianna","Motherglare","Mystogan","Nab Lasaro","Nullpudding","Obra","Ooba Babasaama","Ophiuchus","Orga Nanagear","Plue","Polaris","Porlyusica","Pyxis","Reedus Jonah","Risley Law","Rocker","Rufus Lore","Rustyrose","Sagittarius","Samuel","Sayla","Seilah","Selene","Semmes","Shagotte","Sherry Blendy","Sho","Silver Fullbuster","Simon","Skiadrum","Sorano Agria","Sugarboy","Taurus","Tempester","Toby Horhorta","Toma E. Fiore","Torafuzar","Touka","Ultear Milkovich","Ur","Vidaldus Taka","Viernes","Vijeeter Ecor","Wahl Icht"],"bluelock":["Yoichi Isagi","Rin Itoshi","Meguru Bachira","Seishiro Nagi","Reo Mikage","Shoei Barou","Hyoma Chigiri","Ryusei Shidou","Michael Kaiser","Sae Itoshi","Oliver Aiku","Gin Gagamaru","Rensuke Kunigami","Jyubei Aryu","Aoshi Tokimitsu","Ikki Niko","Raichi Jingo","Tabito Karasu","Eita Otoya","Kenyu Yukimiya","Yo Hiori","Ranze Kurona","Kiyora Jin","Alexis Ness","Don Lorenzo","Charles Chevalier","Noel Noa","Julian Loki","Lavinho","Chris Prince","Marc Snuffy","Jinpachi Ego","Anri Teieri","Shuto Sendou","Gurimu Igarashi","Asahi Naruhaya","Wataru Kuon","Yudai Imamura","Junichi Wanima","Keisuke Wanima","Nijiro Nanase","Miroku Darai","Teppei Neru","Kazuma Niou","Gen Fukaku","Ryosuke Kira","Zantetsu Tsurugi","Okuhito Iemon","Yukio Ishikari","Adam Blake"],"fma":["Edward Elric","Alphonse Elric","Roy Mustang","Riza Hawkeye","Scar","Winry Rockbell","King Bradley","Greed","Envy","Father","Pinako Rockbell","Van Hohenheim","Trisha Elric","Jean Havoc","Heymans Breda","Vato Falman","Kain Fuery","Maes Hughes","Gracia Hughes","Elicia Hughes","Alex Louis Armstrong","Olivier Mira Armstrong","Buccaneer","Miles","Grumman","Basque Grand","May Chang","Ling Yao","Lan Fan","Fu","Yoki","Tim Marcoh","Izumi Curtis","Sig Curtis","Selim Bradley","Lust","Gluttony","Sloth","Shou Tucker","Nina Tucker","Alexander","Barry the Chopper","Maria Ross","Denny Brosh","Pride","Solf J. Kimblee","Isaac McDougal","Frank Archer","Zampano","Jerso","Darius","Heinkel","Rose Thomas","Cornello","Dominic LeCoulte","Paninya","Hakuro","Raven","Rebecca Catalina","Xiao Mei","Chris Mustang","Black Hayate","Berthold Hawkeye"],"chainsaw":["Denji","Power","Aki Hayakawa","Makima","Kobeni Higashiyama","Himeno","Reze","Katana Man","Angel Devil","Pochita","Kishibe","Hirokazu Arai","Madoka","Beam","Violence Fiend","Princi","Future Devil","Curse Devil","Fox Devil","Ghost Devil","Akane Sawatari","Quanxi","Cosmo","Pingtsi","Long","Tsugihagi","Santa Claus","Tolka","Aldo","Asa Mitaka","Yoru","Nayuta","Hirofumi Yoshida","Fami","Haruka Iseumi","Seigi Akoku","Nobana Higashiyama","Barem Bridge","Miri Sugo","Whip Hybrid","Spear Hybrid","Fumiko Mifune","Bat Devil","Leech Devil","Eternity Devil","Tomato Devil","Zombie Devil","Gun Devil","Darkness Devil","Aging Devil","Falling Devil","Justice Devil","Hell Devil","Spider Devil","Chicken Devil","Michiko Tendo","Yutaro Kurose","Yuko"],"wakfu":["Yugo","Tristepin de Percedal","Amalia Sheran Sharm","Evangelyne","Ruel Stroud","Adamai","Qilby","Nox","Oropo","Goultard","Az","Grougaloragran","Alibert","Shinonome","Phaeris","Chibi","Mina","Glip","Baltazar","Echo","Harebourg","Ush Galesh","Black Bump","Rubilax","Elely","Flopin","Pin","Joris Jurgen","Kerubim Crepin","Atcham","Remington Smisse","Grany Smisse","Maskemane","Kabrok","Miranda","Armand Sheran Sharm","Aurora","Moon","Ogrest","Rushu","Kriss la Krass","Dathura","Lou","Toross Mordal"],"demonslayer":["Tanjiro Kamado","Nezuko Kamado","Zenitsu Agatsuma","Inosuke Hashibira","Giyu Tomioka","Kyojuro Rengoku","Shinobu Kocho","Muzan Kibutsuji","Kokushibo","Akaza","Kanao Tsuyuri","Genya Shinazugawa","Tengen Uzui","Mitsuri Kanroji","Muichiro Tokito","Sanemi Shinazugawa","Gyomei Himejima","Obanai Iguro","Kanae Kocho","Kagaya Ubuyashiki","Amane Ubuyashiki","Sakonji Urokodaki","Sabito","Makomo","Jigoro Kuwajima","Shinjuro Rengoku","Senjuro Rengoku","Doma","Hantengu","Gyokko","Gyutaro","Daki","Nakime","Kaigaku","Enmu","Rui","Kyogai","Susamaru","Yahaba","Tamayo","Yushiro","Yoriichi Tsugikuni","Murata","Aoi Kanzaki","Michikatsu Tsugikuni","Hotaru Haganezuka","Hand Demon","Swamp Demon","Kamanue","Mukago","Rokuro","Wakuraba","Kotetsu","Tecchin Tecchikawahara","Sumi Nakahara","Kiyo Terauchi","Naho Takada","Tanjuro Kamado","Kie Kamado","Kanata Ubuyashiki","Kiriya Ubuyashiki","Koyuki","Ruka Rengoku","Tsutako Tomioka","Goto","Suma","Makio","Hinatsuru"],"pokemon":["Pikachu","Dracaufeu","Bulbizarre","Carapuce","Ectoplasma","Mewtwo","Lucario","Gardevoir","Dracolosse","Amphinobi","Rayquaza","Arceus","Raichu","Charmeleon","Wartortle","Blastoise","Caterpie","Butterfree","Pidgeot","Rattata","Spearow","Ekans","Arbok","Sandshrew","Nidoran","Clefairy","Vulpix","Jigglypuff","Zubat","Oddish","Paras","Venonat","Diglett","Meowth","Psyduck","Mankey","Growlithe","Poliwag","Abra","Machop","Bellsprout","Tentacool","Geodude","Ponyta","Slowpoke","Magnemite","Farfetch'd","Doduo","Seel","Grimer","Shellder","Gastly","Haunter","Onix","Drowzee","Krabby","Voltorb","Exeggcute","Cubone","Hitmonlee","Hitmonchan","Lickitung","Koffing","Rhyhorn","Chansey","Tangela","Kangaskhan","Horsea","Goldeen","Staryu","Mr. Mime","Scyther","Jynx","Electabuzz","Magmar","Pinsir","Tauros","Magikarp","Gyarados","Lapras","Ditto","Eevee","Vaporeon","Jolteon","Flareon","Porygon","Omanyte","Kabuto","Aerodactyl","Snorlax","Articuno","Zapdos","Moltres","Dratini","Dragonair","Mew","Lugia","Ho-Oh","Celebi","Groudon","Kyogre","Jirachi","Deoxys","Dialga","Palkia","Giratina","Reshiram","Zekrom","Kyurem","Xerneas","Yveltal","Zygarde","Solgaleo","Lunala","Necrozma","Zacian","Zamazenta","Eternatus","Koraidon","Miraidon","Ivysaur","Venusaur","Charmander","Ash Ketchum","Misty","Brock","Gary Oak","Professor Oak","Jessie","James","Giovanni","Tracey","May","Max","Dawn","Iris","Cilan","Serena","Clemont","Bonnie","Lillie","Kiawe","Lana","Mallow","Sophocles","Goh","Leon","Cynthia","Steven Stone","Lance","Diantha","Alder","Raihan","Paul","Alain","Arcanine","Alakazam","Machamp","Golem","Espeon","Umbreon","Tyranitar","Houndoom","Sceptile","Blaziken","Swampert","Absol","Metagross","Garchomp","Piplup","Chimchar","Turtwig","Glaceon","Leafeon","Sylveon","Mimikyu","Metapod","Weedle","Kakuna","Beedrill","Pidgey","Pidgeotto","Raticate","Fearow","Sandslash","Nidorina","Nidoqueen","Nidorino","Nidoking","Clefable","Ninetales","Wigglytuff","Golbat","Gloom","Vileplume","Parasect","Venomoth","Dugtrio","Persian","Golduck","Primeape","Poliwhirl","Poliwrath","Kadabra","Machoke","Weepinbell","Victreebel","Tentacruel","Graveler","Rapidash","Slowbro","Magneton","Dodrio","Dewgong","Muk","Cloyster","Hypno","Kingler","Electrode","Exeggutor","Marowak","Weezing","Rhydon","Seadra","Seaking","Starmie","Omastar","Kabutops","Chikorita","Cyndaquil","Totodile","Pichu","Togepi","Marill","Sudowoodo","Wooper","Steelix","Scizor","Heracross","Ampharos","Raikou","Entei","Suicune","Treecko","Torchic","Mudkip","Ralts","Salamence","Milotic","Latias","Latios","Torterra","Infernape","Empoleon","Shinx","Luxray","Bidoof","Riolu","Gible","Lopunny","Spiritomb","Togekiss","Weavile","Magnezone","Mamoswine","Gallade","Rotom","Heatran","Regigigas","Cresselia","Darkrai","Shaymin","Manaphy","Victini","Snivy","Tepig","Oshawott","Zorua","Zoroark","Hydreigon","Volcarona","Keldeo","Meloetta","Genesect","Chespin","Fennekin","Froakie","Aegislash","Diancie","Hoopa","Volcanion","Rowlet","Litten","Incineroar","Popplio","Tapu Koko","Cosmog","Magearna","Marshadow","Zeraora","Meltan","Melmetal","Grookey","Scorbunny","Sobble","Corviknight","Toxtricity","Dragapult","Kubfu","Urshifu","Calyrex","Sprigatito","Fuecoco","Quaxly"],"dragonball":["Son Goku","Vegeta","Son Gohan","Piccolo","Freezer","Cell","Majin Buu","Beerus","Jiren","Broly","Gogeta","Vegito","Goten","Trunks","Krillin","Tien Shinhan","Chiaotzu","Yamcha","Master Roshi","Bulma","Chi-Chi","Videl","Pan","Mr. Satan","Uub","Bardock","Gine","Raditz","Nappa","King Vegeta","Tarble","King Cold","Cooler","Zarbon","Dodoria","Captain Ginyu","Jeice","Burter","Recoome","Guldo","Android 16","Android 17","Android 18","Android 19","Dr. Gero","Babidi","Dabura","Supreme Kai","Kibito","Whis","Champa","Vados","Zeno","Grand Priest","Hit","Cabba","Caulifla","Kale","Kefla","Frost","Botamo","Magetta","Toppo","Dyspo","Zamasu","Paragus","Gotenks","Moro","Merus","Granolah","Gas","Elec","Dende","Janemba","Nail","Kami","Mr. Popo","Korin","Yajirobe","Launch","Oolong","Puar","King Kai","Guru","Android 13","Android 21","Baby","Omega Shenron","Shenron","Porunga","Bojack","Turles","Lord Slug","Garlic Jr.","Pilaf","Mai","Shu","Mercenary Tao","General Blue","Commander Red","Upa","Jaco","Sorbet","Tagoma","Ribrianne","Belmod","Marcarita","Quitela","Heles","Obuni","Hirudegarn","Towa","Mira","Fu","Cumber","Hearts","Zangya","Nuova Shenron","Kakunsa","Hatchiyack","Gamma 1","Gamma 2","Dr. Hedo","Magenta","Carmine","Bra","Marron","Cus"],"hellsparadise":["Gabimaru","Yamada Asaemon Sagiri","Yuzuriha","Aza Chobei","Aza Toma","Yamada Asaemon Shion","Yamada Asaemon Tenza","Tamiya Gantetsusai","Rien","Mei","Yamada Asaemon Fuchi","Nurugai","Yamada Asaemon Senta","Yamada Asaemon Eizen","Yamada Asaemon Genji","Yamada Asaemon Kisho","Yamada Asaemon Jikka","Yamada Asaemon Shugen","Isuzu","Kiyomaru","Zhu Jin","Mu Dan","Ju Fa","Tao Fa","Gui Fa","Hoko","Yui","Lan Ban"],"gachiakuta":["Rudo Surebrec","Enjin","Zanka Nijiku","Riyo Reaper","Jabber Wonger","Zodyl Typhon","Tamsy Caines","Semiu Grier","Regto Surebrec","Amo Empool","Delmon","Bro","Dear","Guita","Gris","Follo","Tomme","Corvus","August","Eishia","Cthoni","Noerde","Fu","Bundus","Chiwa","Alice","Remlin"],"haikyuu":["Shoyo Hinata","Tobio Kageyama","Kei Tsukishima","Yu Nishinoya","Toru Oikawa","Wakatoshi Ushijima","Kotaro Bokuto","Kenma Kozume","Tetsuro Kuroo","Atsumu Miya","Osamu Miya","Kiyoomi Sakusa","Tadashi Yamaguchi","Daichi Sawamura","Koshi Sugawara","Asahi Azumane","Ryunosuke Tanaka","Chikara Ennoshita","Hisashi Kinoshita","Kazuhito Narita","Kiyoko Shimizu","Hitoka Yachi","Ittetsu Takeda","Keishin Ukai","Hajime Iwaizumi","Issei Matsukawa","Takahiro Hanamaki","Shinji Watari","Shigeru Yahaba","Yutaro Kindaichi","Akira Kunimi","Morisuke Yaku","Nobuyuki Kai","Taketora Yamamoto","Shohei Fukunaga","Lev Haiba","So Inuoka","Tamahiko Teshiro","Keiji Akaashi","Akinori Konoha","Satori Tendo","Tsutomu Goshiki","Kenjiro Shirabu","Eita Semi","Reon Ohira","Taichi Kawanishi","Shinsuke Kita","Rintaro Suna","Aran Ojiro","Korai Hoshiumi","Sachiro Hirugami","Motoya Komori","Takanobu Aone","Kenji Futakuchi","Kanji Koganegawa","Yuji Terushima","Suguru Daisho","Kentaro Kyotani","Yusuke Takinoue","Makoto Shimada","Saeko Tanaka","Akiteru Tsukishima","Natsu Hinata","Ikkei Ukai","Yasufumi Nekomata","Yuki Shibayama","Tatsuki Washio","Haruki Komi","Wataru Onaga","Yamato Sarukui","Hayato Yamagata","Tanji Washijo","Hitoshi Ginjima","Michinari Akagi","Ren Omimi","Gao Hakuba","Kaname Moniwa","Yasushi Kamasaki","Takeru Nakashima","Yudai Hyakuzawa"],"jjk":["Yuji Itadori","Megumi Fushiguro","Nobara Kugisaki","Satoru Gojo","Yuta Okkotsu","Maki Zenin","Suguru Geto","Ryomen Sukuna","Mahito","Kento Nanami","Toji Fushiguro","Aoi Todo","Toge Inumaki","Panda","Masamichi Yaga","Shoko Ieiri","Kiyotaka Ijichi","Atsuya Kusakabe","Mai Zenin","Kasumi Miwa","Mechamaru","Noritoshi Kamo","Momo Nishimiya","Utahime Iori","Kenjaku","Riko Amanai","Jogo","Hanami","Dagon","Choso","Eso","Kechizu","Uraume","Mei Mei","Ui Ui","Yuki Tsukumo","Tengen","Naobito Zenin","Naoya Zenin","Ogi Zenin","Jinichi Zenin","Kinji Hakari","Hiromi Higuruma","Hajime Kashimo","Reggie Star","Yoshinobu Gakuganji","Misato Kuroi","Yu Haibara","Kirara Hoshi","Fumihiko Takaba","Remi","Rin Amai","Iori Hazenoki","Chizuru Hari","Ryu Ishigori","Takako Uro","Dhruv Lakdawalla","Kurourushi","Hana Kurusu","Charles Bernard","Yorozu","Rika Orimoto","Tsumiki Fushiguro","Takuma Ino","Arata Nitta","Akari Nitta","Nanako Hasaba","Mimiko Hasaba","Miguel","Larue","Juzo Kumiya","Haruta Shigemo","Granny Ogami","Jiro Awasaka","Wasuke Itadori","Jin Itadori","Smallpox Deity","Shiu Kong"],"jojo":["Jonathan Joestar","Joseph Joestar","Jotaro Kujo","Josuke Higashikata","Giorno Giovanna","Jolyne Cujoh","Johnny Joestar","Josuke Higashikata Gappy","Dio Brando","Robert E. O. Speedwagon","Will A. Zeppeli","Erina Pendleton","Dire","Straizo","Caesar Zeppeli","Lisa Lisa","Rudol von Stroheim","Santana","Wamuu","Esidisi","Kars","Suzi Q","Muhammad Avdol","Noriaki Kakyoin","Jean Pierre Polnareff","Iggy","Hol Horse","Enya","Vanilla Ice","Oingo","Boingo","Mariah","Pet Shop","Koichi Hirose","Okuyasu Nijimura","Rohan Kishibe","Yukako Yamagishi","Shigekiyo Yangu","Tonio Trussardi","Akira Otoishi","Reimi Sugimoto","Yoshikage Kira","Bruno Bucciarati","Guido Mista","Narancia Ghirga","Leone Abbacchio","Pannacotta Fugo","Trish Una","Diavolo","Vinegar Doppio","Risotto Nero","Prosciutto","Pesci","Ghiaccio","Melone","Formaggio","Illuso","Ermes Costello","Foo Fighters","Weather Report","Narciso Anasui","Emporio Alnino","Enrico Pucci","Gyro Zeppeli","Diego Brando","Funny Valentine","Hot Pants","Lucy Steel","George Joestar","Wang Chan","Poco","Tarkus","Bruford","Dario Brando","Messina","Loggins","Holy Kujo","N'Doul","Gray Fly","Devo","Steely Dan","Rubber Soul","J. Geil","Mannish Boy","Cameo","Alessi","Daniel J. D'Arby","Telence T. D'Arby","Kenny G","Arabia Fats","Nena","ZZ","Midler","Tomoko Higashikata","Toshikazu Hazamada","Yuya Fungami","Mikitaka Hazekura","Keicho Nijimura","Kosaku Kawajiri","Hayato Kawajiri","Shinobu Kawajiri","Terunosuke Miyamoto","Aya Tsuji","Tamami Kobayashi","Ken Oyanagi","Toyohiro Kanedaichi","Yoshihiro Kira","Squalo","Tiziano","Cioccolata","Secco","Carne","Sale","Zucchero","Polpo","Luca","Gwess","Johngalli A","Thunder McQueen","Miraschon","Sports Maxx","Lang Rangler","Viviano Westwood","Kenzou","D an G","Guccio","Ungaro","Rikiel","Versus","Sandman","Mountain Tim","Pocoloco","Blackmore","Ringo Roadagain","Wekapipo","Magent Magent","Axl RO","Dr. Ferdinand","Oyecomova","Mike O","Yasuho Hirose","Joshu Higashikata","Norisuke Higashikata IV","Tsurugi Higashikata","Kei Nijimura","Toru","Jobin Higashikata","Rai Mamezuku","Hato Higashikata"],"tensura":["Rimuru Tempest","Veldora Tempest","Milim Nava","Diablo","Benimaru","Shion","Guy Crimson","Luminous Valentine","Hinata Sakaguchi","Gobta","Shizue Izawa","Shuna","Souei","Hakuro","Kurobe","Rigurd","Rigur","Ranga","Geld","Gabiru","Testarossa","Carrera","Ultima","Zegion","Apito","Kumara","Adalmann","Ramiris","Leon Cromwell","Dagruel","Dino","Frey","Carrion","Clayman","Chloe Aubert","Yuuki Kagurazaka","Kagali","Laplace","Tear","Footman","Velgrynd","Velzard","Treyni","Beretta","Kaijin","Gazel Dwargo","Gobzo","Haruna","Momiji","Alvis","Sufia","Phobio","Elmesia El-Ru Sarion","Eren Grimwald","Kabal","Gido","Fuze","Vester","Myulan","Grucius","Yohm","Razen","Shogo Taguchi","Kyoya Tachibana","Kirara Mizutani","Masayuki Honjo","Veldanava","Feldway","Vega","Hiiro","Charybdis","Albert","Wenty","Gadora","Tatsuya Kondo","Rudra","Garm","Dold","Mildo"],"opm":["Saitama","Genos","Tatsumaki","Bang","King","Fubuki","Garou","Boros","Mumen Rider","Flashy Flash","Bomb","Blast","Atomic Samurai","Child Emperor","Metal Knight","Zombieman","Drive Knight","Pig God","Superalloy Darkshine","Watchdog Man","Tanktop Master","Metal Bat","Puri-Puri Prisoner","Amai Mask","Iaian","Okamaitachi","Bushidrill","Spring Mustachio","Golden Ball","Tanktop Tiger","Tanktop Black Hole","Speed-o'-Sound Sonic","Suiryu","Melzargard","Geryuganshoop","Groribas","Orochi","Psykos","Gyoro Gyoro","Black Sperm","Homeless Emperor","Elder Centipede","Gouketsu","Fuhrer Ugly","Nyan","Phoenix Man","Deep Sea King","Vaccine Man","Carnage Kabuto","Mosquito Girl","Beast King","Armored Gorilla","Dr. Genus","Charanko","Snek","Stinger","Lightning Max","Death Gatling","Smile Man","Blue Fire","Sansetsukon Lily","Mountain Ape","Eyelashes","Glasses","Sekingar","Tareo","Awakened Cockroach","Subterranean King","Hammerhead","Marugori","Bakuzan","Evil Natural Water","Do-S","Overgrown Rover","Royal Ripper","Waganma","Sitch","Madame Shibabawa","Suiko"],"sao":["Kirito","Asuna Yuuki","Sinon","Leafa","Klein","Agil","Yuuki Konno","Alice Zuberg","Eugeo","Heathcliff","Yui","Silica","Lisbeth","Sachi","Argo","Diavel","Kibaou","Oberon","Death Gun","XaXa","Vassago Casals","Selka Zuberg","Ronie Arabel","Tiese Shtolienen","Cardinal","Administrator","Chudelkin","Bercouli Synthesis One","Fanatio Synthesis Two","Gabriel Miller","Deusolbert Synthesis Seven","Sakuya","Alicia Rue","Recon","Sheyta","Iskahn","Llenn","Pitohui","Fukaziroh","M","Eiji","Yuna","Kuradeel","Godfree","Thinker","Yulier","Johnny Black","Grimlock","Schmitt","Yolko","Caynz","Rosalia","Kizmel","Seijirou Kikouka","Rinko Koujiro","Siune","Jun","Talken","Tecchi","Nori","Raios Antinous","Humbert Zizek","Sortiliena Serlut","Golgorosso Ballto","Renly Synthesis Twenty-Seven","Eldrie Synthesis Thirty-One","Dee Ai Ell","Lilpilin","Shasta","Garitta","Medina Orthinanos","Eugene","Mortimer"],"tokyoghoul":["Ken Kaneki","Touka Kirishima","Kishou Arima","Juuzou Suzuya","Eto Yoshimura","Shu Tsukiyama","Hinami Fueguchi","Ayato Kirishima","Kotaro Amon","Nishiki Nishio","Rize Kamishiro","Hideyoshi Nagachika","Kimi Nishino","Yoshimura","Renji Yomo","Uta","Itori","Roma Hoito","Kaya Irimi","Enji Koma","Akira Mado","Kureo Mado","Seidou Takizawa","Yukinori Shinohara","Iwao Kuroiwa","Koori Ui","Naki","Tatara","Donato Porpora","Kurona Yasuhisa","Take Hirako","Mougan Tanakamaru","Yakumo Oomori","Jason","Noro","Shachi","Kuki Urie","Ginshi Shirazu","Tooru Mutsuki","Saiko Yonebayashi","Shinsanpei Aura","Hairu Ihei","Nimura Furuta","Kanae von Rosewald","Nashiro Yasuhisa","Kazuichi Banjou","Ichimi","Jiro","Nico","Houji Kasuka","Itou Kuramoto","Akihiro Kanou","Tokuyuki Marude","Tsuneyoshi Washuu","Matsuri Washuu","Yoshitoki Washuu","Hanbee Abara","Arata Kirishima","Chie Hori","Kiyoko Aura","Hsiao","Shiki Kijima","Big Madam","Mirumo Tsukiyama","Matsumae"],"tokyorevengers":["Takemichi Hanagaki","Manjiro Sano","Ken Ryuguji","Keisuke Baji","Chifuyu Matsuno","Takashi Mitsuya","Kazutora Hanemiya","Tetta Kisaki","Izana Kurokawa","Taiju Shiba","Haruki Hayashida","Ryohei Hayashi","Nahoya Kawata","Souya Kawata","Hakkai Shiba","Atsushi Sendo","Takuya Yamamoto","Makoto Suzuki","Kazushi Yamagishi","Hinata Tachibana","Naoto Tachibana","Emma Sano","Shinichiro Sano","Shuji Hanma","Nobutaka Osanai","Yuzuha Shiba","Seishu Inui","Hajime Kokonoi","Kakucho","Kanji Mochizuki","Shion Madarame","Ran Haitani","Rindo Haitani","Yasuhiro Muto","Haruchiyo Sanzu","South Terano","Senju Kawaragi","Takeomi Akashi","Wakasa Imaushi","Keizo Arashi","Masataka Kiyomizu","Luna Mitsuya","Mana Mitsuya"]};

// Alias propres à un univers (formes / surnoms renvoyant au personnage unique du pool)
const RG_EXTRA_ALIASES = {"naruto":{"pain":"nagato","tobi":"obito uchiha","tenzo":"yamato","sasuke uchiwa":"sasuke uchiha","itachi uchiwa":"itachi uchiha","madara uchiwa":"madara uchiha","obito uchiwa":"obito uchiha","shisui uchiwa":"shisui uchiha"},"dragonball":{"goku black":"zamasu","black goku":"zamasu","future trunks":"trunks","trunks du futur":"trunks","fused zamasu":"zamasu","zamasu fusionne":"zamasu","freezer":"freezer","frieza":"freezer","sangoku":"son goku","san goku":"son goku","goku":"son goku","gohan":"son gohan","sangohan":"son gohan","krilin":"krillin","tortue geniale":"master roshi","satan":"mr satan","hercule":"mr satan"},"tokyoghoul":{"haise sasaki":"ken kaneki","haise":"ken kaneki","sasaki haise":"ken kaneki","yamori":"jason"},"jjk":{"kokichi muta":"mechamaru","kokichi":"mechamaru","angel":"hana kurusu"},"tokyorevengers":{"pah chin":"haruki hayashida","pahchin":"haruki hayashida","peh yan":"ryohei hayashi","pehyan":"ryohei hayashi","mikey":"manjiro sano","draken":"ken ryuguji","smiley":"nahoya kawata","angry":"souya kawata","mucho":"yasuhiro muto"},"solo":{"greed":"hwang dongsuk"},"sao":{"shino asada":"sinon","nobuyuki sugou":"oberon","sugou":"oberon","poh":"vassago casals","deusolbert":"deusolbert synthesis seven","kayaba akihiko":"heathcliff","akihiko kayaba":"heathcliff","kayaba":"heathcliff","suguha":"leafa","suguha kirigaya":"leafa","kazuto kirigaya":"kirito","kazuto":"kirito","keiko ayano":"silica","rika shinozaki":"lisbeth","quinella":"administrator"},"fairy":{"angel":"sorano agria","angel sorano":"sorano agria","zero":"brain","precht":"hades","precht gaebolg":"hades","meldy":"meredy","doranbalt":"mest gryder","belserion":"irene belserion","silver":"silver fullbuster","tauros":"taurus","caprico":"capricorn","chelia":"sherria blendy","chelia blendy":"sherria blendy","erza knightwalker":"erza scarlet","hot eye":"hoteye","blue note":"bluenote stinger"},"bleach":{"tensa zangetsu":"zangetsu","rose":"rojuro otoribashi","rose otoribashi":"rojuro otoribashi","hisagi":"shuhei hisagi","kaien":"kaien shiba","kensei":"kensei muguruma","nanao":"nanao ise","askin":"askin nakk le vaar","tsukishima":"shukuro tsukishima","lilinette":"lilynette gingerbuck","lilinette gingerback":"lilynette gingerbuck"},"sds":{"chaos arthur":"arthur pendragon","gowther doll":"gowther","elaine's brother":"king","hauser":"howzer","baltra":"bartra liones"},"onepiece":{"miss all sunday":"nico robin","lola":"charlotte lola","dadan":"curly dadan","squard":"squardo","hitetsu":"tenguyama hitetsu","san juan wolf":"sanjuan wolf","cindry":"victoria cindry"},"clover":{"wizard king":"julius novachrono","gaja":"gadjah","siren tium":"siren tium","shiren tium":"siren tium"}};

/* ================= Rolland Garos : logique de partie ================= */

// Repère les prénoms/noms de famille partagés par plusieurs personnages (Charlotte, Uchiha,
// Vinsmoke, Ōtsutsuki...). Ces mots seuls ne valident plus une réponse : il faut le nom complet.
function buildAmbiguousTokens(pool) {
    const compteur = {};
    pool.forEach(name => {
        const n = normalizeRG(name);
        const parts = n.split(' ');
        const tokens = new Set([parts[0], parts[parts.length - 1]]);
        tokens.forEach(t => {
            if (!t) return;
            compteur[t] = compteur[t] || new Set();
            compteur[t].add(n);
        });
    });

    const ambigus = new Set();
    Object.keys(compteur).forEach(t => {
        // ambigu si le mot désigne plusieurs persos, sauf si c'est le nom complet de l'un d'eux
        const noms = compteur[t];
        if (noms.size > 1 && !noms.has(t)) ambigus.add(t);
    });
    return ambigus;
}

function startRollandGaros(room, roomCode) {
    const key = RG_UNIVERSES[room.subMode] ? room.subMode : 'naruto';
    const universe = RG_UNIVERSES[key];
    const pool = rgMasterPoolForUniverse(key, universe.raw);

    rgPools[roomCode] = {
        universeKey: key,
        pool,
        usedNorm: new Set(),
        ambigus: buildAmbiguousTokens(pool)
    };

    // Vies individuelles : chaque joueur a ses 2 propres vies
    room.players.forEach(p => {
        p.rgLives = 2;
        p.rgAlive = true;
    });

    room.status = 'rg_playing';
    room.rg = {
        universeKey: key,
        universeName: universe.name,
        score: 0,
        turnIndex: 0,
        timeLeft: 10,
        found: [],
        poolSize: pool.length,
        winnerName: null
    };

    io.to(roomCode).emit('rg_state', room);
    startRgTimer(room, roomCode);
}

function startRgTimer(room, roomCode) {
    if (rgTimers[roomCode]) clearInterval(rgTimers[roomCode]);
    if (!room.rg) return;
    room.rg.timeLeft = 10;
    rgTimers[roomCode] = setInterval(() => {
        try {
            if (!rooms[roomCode] || !room.rg || room.status !== 'rg_playing') {
                clearInterval(rgTimers[roomCode]);
                delete rgTimers[roomCode];
                return;
            }
            room.rg.timeLeft--;
            io.to(roomCode).emit('rg_tick', { timeLeft: Math.max(room.rg.timeLeft, 0) });
            if (room.rg.timeLeft <= 0) {
                clearInterval(rgTimers[roomCode]);
                delete rgTimers[roomCode];
                rgLoseLife(room, roomCode, "⏱ Trop lent, un personnage manqué !");
            }
        } catch (e) {
            // Une erreur dans le chrono ne doit jamais tuer le serveur
            console.error('[chrono Rolland Garos]', e);
            clearInterval(rgTimers[roomCode]);
            delete rgTimers[roomCode];
        }
    }, 1000);
}

function rgAlivePlayers(room) {
    return room.players.filter(p => p.rgAlive);
}

function rgAdvanceTurn(room) {
    if (room.players.length === 0) return;
    if (rgAlivePlayers(room).length === 0) return;
    let idx = room.rg.turnIndex;
    let guard = 0;
    do {
        idx = (idx + 1) % room.players.length;
        guard++;
    } while (!room.players[idx].rgAlive && guard <= room.players.length);
    room.rg.turnIndex = idx;
}

function rgLoseLife(room, roomCode, reason) {
    const player = room.players[room.rg.turnIndex];
    if (!player) return;

    player.rgLives = Math.max((player.rgLives || 0) - 1, 0);
    let message = `${reason} — ${player.name} perd une vie.`;
    if (player.rgLives <= 0) {
        player.rgAlive = false;
        message = `${reason} — 💀 ${player.name} est éliminé !`;
    }
    io.to(roomCode).emit('rg_feedback', { ok: false, message });

    const alive = rgAlivePlayers(room);
    if (alive.length <= 1) {
        rgEndGame(room, roomCode, alive[0] || null);
        return;
    }

    rgAdvanceTurn(room);
    io.to(roomCode).emit('rg_state', room);
    startRgTimer(room, roomCode);
}

function rgEndGame(room, roomCode, winner) {
    if (rgTimers[roomCode]) {
        clearInterval(rgTimers[roomCode]);
        delete rgTimers[roomCode];
    }
    room.status = 'rg_over';
    room.rg.winnerName = winner ? winner.name : null;
    applyRollandGarosRanking(room, winner);
    io.to(roomCode).emit('rg_game_over', { room });
}

/* ================= Enchère : logique de partie (mode indépendant) ================= */
// Nouveau mode 1v1 : chacun a 50M pour construire une équipe de 4 persos via des enchères tour par tour.

const ENCHERE_NARUTO = [
    { name: 'Kaguya Ōtsutsuki', value: 110 },
    { name: 'Hagoromo Ōtsutsuki', value: 109 },
    { name: 'Naruto — Mode Baryon', value: 108 },
    { name: 'Madara — Jinchūriki du Jûbi', value: 107 },
    { name: 'Sasuke — Rinnegan', value: 105 },
    { name: 'Kakashi — Double Mangekyō', value: 104 },
    { name: 'Obito — Jinchūriki du Jûbi', value: 103 },
    { name: 'Hamura Ōtsutsuki', value: 102 },
    { name: 'Indra Ōtsutsuki', value: 100 },
    { name: 'Ashura Ōtsutsuki', value: 99 },
    { name: 'Might Guy — 8e porte', value: 98 },
    { name: 'Toneri Ōtsutsuki', value: 97 },
    { name: 'Hashirama Senju', value: 95 },
    { name: 'Minato Namikaze', value: 93 },
    { name: 'Tobirama Senju', value: 90 },
    { name: 'Itachi Uchiha', value: 89 },
    { name: 'Nagato Uzumaki', value: 88 },
    { name: 'Kabuto — Mode Ermite', value: 87 },
    { name: 'Orochimaru', value: 85 },
    { name: 'Killer B', value: 84 },
    { name: '3e Raikage', value: 83 },
    { name: 'Mû', value: 81 },
    { name: 'Gengetsu Hōzuki', value: 80 },
    { name: 'Ōnoki', value: 79 },
    { name: 'Jiraiya — Mode Ermite', value: 78 },
    { name: 'Hiruzen Sarutobi', value: 77 },
    { name: 'Kisame Hoshigaki', value: 75 },
    { name: 'Gaara', value: 73 },
    { name: 'Kakashi', value: 72 },
    { name: 'Deidara', value: 71 },
    { name: 'Sasori', value: 70 },
    { name: 'Konan', value: 67 },
    { name: 'Darui', value: 65 },
    { name: 'Rock Lee', value: 64 },
    { name: 'Shikamaru', value: 60 },
    { name: 'Neji', value: 59 },
    { name: 'Temari', value: 58 },
    { name: 'Kankurō', value: 56 },
    { name: 'Sai', value: 55 },
    { name: 'Chōji', value: 54 },
    { name: 'Yamato', value: 53 },
    { name: 'Shino', value: 52 },
    { name: 'Kiba', value: 50 },
    { name: 'Hinata', value: 49 },
    { name: 'Tenten', value: 44 },
    { name: 'Ino', value: 43 },
    { name: 'Sakura — début Shippuden', value: 42 },
    { name: 'Iruka', value: 25 },
    { name: 'Konohamaru — début Shippuden', value: 22 },
    { name: 'Mizuki', value: 12 }
];

const ENCHERE_ONEPIECE = [
    { name: 'Joy Boy', value: 110 },
    { name: 'Imu', value: 109 },
    { name: 'Rocks D. Xebec', value: 108 },
    { name: 'Gol D. Roger', value: 108 },
    { name: 'Barbe Blanche prime', value: 107 },
    { name: 'Garp prime', value: 106 },
    { name: 'Shanks', value: 105 },
    { name: 'Kaido', value: 104 },
    { name: 'Luffy Gear 5', value: 103 },
    { name: 'Barbe Noire', value: 102 },
    { name: 'Mihawk', value: 101 },
    { name: 'Sengoku prime', value: 100 },
    { name: 'Akainu', value: 98 },
    { name: 'Big Mom', value: 97 },
    { name: 'Rayleigh prime', value: 96 },
    { name: 'Kuzan', value: 95 },
    { name: 'Kizaru', value: 93 },
    { name: 'Fujitora', value: 91 },
    { name: 'Ryokugyu', value: 90 },
    { name: 'Benn Beckman', value: 88 },
    { name: 'Marco', value: 86 },
    { name: 'Yamato', value: 85 },
    { name: 'Sabo', value: 84 },
    { name: 'Law', value: 83 },
    { name: 'Kid', value: 82 },
    { name: 'Zoro', value: 81 },
    { name: 'Shiryu', value: 80 },
    { name: 'Katakuri', value: 78 },
    { name: 'King', value: 77 },
    { name: 'Sanji', value: 76 },
    { name: 'Boa Hancock', value: 75 },
    { name: 'Crocodile', value: 74 },
    { name: 'Doflamingo', value: 72 },
    { name: 'Rob Lucci', value: 70 },
    { name: 'Jinbe', value: 68 },
    { name: 'Queen', value: 67 },
    { name: 'Jack', value: 64 },
    { name: 'Killer', value: 63 },
    { name: 'Kuma', value: 62 },
    { name: 'Magellan', value: 61 },
    { name: 'Franky', value: 55 },
    { name: 'Brook', value: 53 },
    { name: 'Robin', value: 52 },
    { name: 'Nami', value: 50 },
    { name: 'Usopp', value: 43 },
    { name: 'Chopper', value: 42 },
    { name: 'Bonney', value: 40 },
    { name: 'Carrot', value: 38 },
    { name: 'Tashigi', value: 30 },
    { name: 'Koby', value: 28 }
];

const ENCHERE_BLEACH = [
    { name: 'Yhwach', value: 110 },
    { name: 'Ichigo forme finale', value: 108 },
    { name: 'Ichibē Hyōsube', value: 107 },
    { name: 'Aizen', value: 106 },
    { name: 'Yamamoto', value: 102 },
    { name: 'Kenpachi', value: 100 },
    { name: 'Gerard Valkyrie', value: 99 },
    { name: 'Jugram Haschwalth', value: 98 },
    { name: 'Lille Barro', value: 97 },
    { name: 'Ōetsu Nimaiya', value: 96 },
    { name: 'Shunsui Kyōraku', value: 94 },
    { name: 'Urahara', value: 93 },
    { name: 'Byakuya', value: 92 },
    { name: 'Tōshirō adulte', value: 91 },
    { name: 'Unohana', value: 90 },
    { name: 'Askin Nakk Le Vaar', value: 89 },
    { name: 'Uryū Ishida', value: 88 },
    { name: 'Mayuri', value: 86 },
    { name: 'Senjumaru', value: 85 },
    { name: 'Pernida', value: 84 },
    { name: 'Ulquiorra', value: 83 },
    { name: 'Yoruichi', value: 82 },
    { name: 'Kisuke Tessai', value: 80 },
    { name: 'Renji', value: 78 },
    { name: 'Rukia', value: 77 },
    { name: 'Grimmjow', value: 76 },
    { name: 'Starrk', value: 75 },
    { name: 'Barragan', value: 74 },
    { name: 'Byakuya début', value: 72 },
    { name: 'Soi Fon', value: 70 },
    { name: 'Gin Ichimaru', value: 69 },
    { name: 'Tōsen', value: 68 },
    { name: 'Komamura', value: 67 },
    { name: 'Shinji', value: 66 },
    { name: 'Rose', value: 63 },
    { name: 'Kensei', value: 62 },
    { name: 'Ikkaku', value: 58 },
    { name: 'Yumichika', value: 56 },
    { name: 'Chad', value: 55 },
    { name: 'Orihime', value: 54 },
    { name: 'Nnoitra', value: 53 },
    { name: 'Szayelaporro', value: 51 },
    { name: 'Aaroniero', value: 45 },
    { name: 'Hanatarō', value: 30 },
    { name: 'Kon', value: 25 },
    { name: 'Ganju', value: 24 },
    { name: 'Don Kanonji', value: 20 },
    { name: 'Jinta', value: 18 },
    { name: 'Ururu', value: 17 },
    { name: 'Mizuiro', value: 10 }
];

const ENCHERE_SDS = [
    { name: 'Chaos', value: 110 },
    { name: 'Arthur Chaos', value: 109 },
    { name: 'Démon Originel', value: 107 },
    { name: 'Meliodas', value: 106 },
    { name: 'Escanor The One Ultimate', value: 104 },
    { name: 'Ban post-Purgatoire', value: 101 },
    { name: 'Mael', value: 99 },
    { name: 'King ailes complètes', value: 98 },
    { name: 'Elizabeth', value: 96 },
    { name: 'Zeldris', value: 94 },
    { name: 'Merlin', value: 92 },
    { name: 'Ludociel', value: 90 },
    { name: 'Diane', value: 87 },
    { name: 'Gowther', value: 85 },
    { name: 'Chandler', value: 84 },
    { name: 'Cusack', value: 83 },
    { name: 'Sariel', value: 81 },
    { name: 'Tarmiel', value: 80 },
    { name: 'Drole', value: 78 },
    { name: 'Gloxinia', value: 77 },
    { name: 'Monspeet', value: 76 },
    { name: 'Derieri', value: 75 },
    { name: 'Estarossa', value: 74 },
    { name: 'Galand', value: 70 },
    { name: 'Grayroad', value: 68 },
    { name: 'Melascula', value: 66 },
    { name: 'Gloxinia début', value: 64 },
    { name: 'Hendrickson', value: 61 },
    { name: 'Dreyfus', value: 60 },
    { name: 'Howzer', value: 58 },
    { name: 'Gilthunder', value: 56 },
    { name: 'Jericho', value: 52 },
    { name: 'Slader', value: 50 },
    { name: 'Guila', value: 48 },
    { name: 'Diane début', value: 47 },
    { name: 'Matrona', value: 45 },
    { name: 'Helbram', value: 43 },
    { name: 'Arthur début', value: 40 },
    { name: 'Veronica', value: 28 },
    { name: 'Elaine', value: 27 },
    { name: 'Hawk', value: 20 },
    { name: 'Twigo', value: 18 },
    { name: 'Vivian', value: 16 },
    { name: 'Margaret', value: 14 },
    { name: 'Gil', value: 13 },
    { name: 'Howzer début', value: 12 },
    { name: 'Guila début', value: 11 },
    { name: 'Cain', value: 10 },
    { name: 'Slater début', value: 9 }
];

const ENCHERE_MHA = [
    { name: 'Shigaraki forme finale', value: 110 },
    { name: 'All For One prime', value: 108 },
    { name: 'Deku maximum', value: 106 },
    { name: 'All Might prime', value: 104 },
    { name: 'Star and Stripe', value: 98 },
    { name: 'Bakugo fin de série', value: 95 },
    { name: 'Endeavor', value: 91 },
    { name: 'Dabi', value: 89 },
    { name: 'Todoroki', value: 88 },
    { name: 'Gigantomachia', value: 86 },
    { name: 'Mirko', value: 82 },
    { name: 'Hawks', value: 80 },
    { name: 'Tokoyami', value: 78 },
    { name: 'Aizawa', value: 76 },
    { name: 'Best Jeanist', value: 74 },
    { name: 'Lemillion', value: 73 },
    { name: 'Overhaul', value: 71 },
    { name: 'Re-Destro', value: 69 },
    { name: 'Tamaki', value: 66 },
    { name: 'Twice', value: 65 },
    { name: 'Stain', value: 62 },
    { name: 'Lady Nagant', value: 61 },
    { name: 'Muscular', value: 59 },
    { name: 'Mt. Lady', value: 57 },
    { name: 'Gang Orca', value: 56 },
    { name: 'Edgeshot', value: 55 },
    { name: 'Kamui Woods', value: 53 },
    { name: 'Fat Gum', value: 52 },
    { name: 'Nejire', value: 51 },
    { name: 'Mirio début', value: 50 },
    { name: 'Iida', value: 48 },
    { name: 'Kirishima', value: 47 },
    { name: 'Mina', value: 43 },
    { name: 'Sero', value: 41 },
    { name: 'Shoji', value: 40 },
    { name: 'Jirō', value: 39 },
    { name: 'Momo', value: 38 },
    { name: 'Kaminari', value: 37 },
    { name: 'Tsuyu', value: 36 },
    { name: 'Ojiro', value: 32 },
    { name: 'Koda', value: 30 },
    { name: 'Hagakure', value: 28 },
    { name: 'Mineta', value: 25 },
    { name: 'Monoma', value: 24 },
    { name: 'Gentle Criminal', value: 23 },
    { name: 'La Brava', value: 18 },
    { name: 'Ectoplasm', value: 17 },
    { name: 'Cementoss', value: 16 },
    { name: 'Present Mic', value: 15 },
    { name: 'Recovery Girl', value: 5 }
];

const ENCHERE_CLOVER = [
    { name: 'Lucius Zogratis', value: 110 },
    { name: 'Asta forme ultime', value: 107 },
    { name: 'Yuno fin de série', value: 106 },
    { name: 'Lucifero', value: 104 },
    { name: 'Julius Novachrono', value: 102 },
    { name: 'Mereoleona', value: 99 },
    { name: 'Noelle forme ultime', value: 96 },
    { name: 'Yami', value: 94 },
    { name: 'Nacht', value: 90 },
    { name: 'Acier Silva', value: 89 },
    { name: 'Fuegoleon', value: 87 },
    { name: 'Dorothy', value: 85 },
    { name: 'Zenon', value: 84 },
    { name: 'Dante', value: 82 },
    { name: 'Vanica', value: 80 },
    { name: 'Morris', value: 79 },
    { name: 'William', value: 78 },
    { name: 'Nozel', value: 77 },
    { name: 'Luck', value: 76 },
    { name: 'Magna', value: 73 },
    { name: 'Mereoleona début', value: 72 },
    { name: 'Jack', value: 71 },
    { name: 'Charlotte', value: 70 },
    { name: 'Rill', value: 68 },
    { name: 'Leopold', value: 66 },
    { name: 'Gadjah', value: 65 },
    { name: 'Lolopechka', value: 64 },
    { name: 'Langris', value: 63 },
    { name: 'Charmy', value: 62 },
    { name: 'Gauche', value: 60 },
    { name: 'Finral', value: 58 },
    { name: 'Vanessa', value: 57 },
    { name: 'Gordon', value: 55 },
    { name: 'Grey', value: 53 },
    { name: 'Zora', value: 52 },
    { name: 'Sekke', value: 35 },
    { name: 'Klaus', value: 34 },
    { name: 'Mimosa', value: 33 },
    { name: 'Sol Marron', value: 32 },
    { name: 'Kirsch', value: 30 },
    { name: 'Fragil', value: 28 },
    { name: 'En', value: 27 },
    { name: 'Magna début', value: 25 },
    { name: 'Luck début', value: 24 },
    { name: 'Leopold début', value: 23 },
    { name: 'Klaus début', value: 22 },
    { name: 'Mars', value: 21 },
    { name: 'Sally', value: 20 },
    { name: 'Revchi', value: 15 },
    { name: 'Sekke début', value: 10 }
];

const ENCHERE_FAIRY = [
    { name: 'Acnologia', value: 110 },
    { name: 'Zeref Fairy Heart', value: 109 },
    { name: 'Natsu forme ultime', value: 106 },
    { name: 'Ignia', value: 105 },
    { name: 'Gildarts', value: 101 },
    { name: 'August', value: 100 },
    { name: 'Irene Belserion', value: 99 },
    { name: 'Laxus', value: 96 },
    { name: 'Erza', value: 94 },
    { name: 'Gray', value: 91 },
    { name: 'Jellal', value: 89 },
    { name: 'Mirajane', value: 87 },
    { name: 'Wendy', value: 85 },
    { name: 'Brandish', value: 83 },
    { name: 'Makarov', value: 80 },
    { name: 'Gildarts début', value: 78 },
    { name: 'Lucy', value: 77 },
    { name: 'Gajeel', value: 75 },
    { name: 'Sting', value: 73 },
    { name: 'Rogue', value: 71 },
    { name: 'Cobra', value: 69 },
    { name: 'Minerva', value: 67 },
    { name: 'Kagura', value: 66 },
    { name: 'Hades', value: 65 },
    { name: 'Mard Geer', value: 64 },
    { name: 'Larcade', value: 63 },
    { name: 'God Serena', value: 62 },
    { name: 'Elfman', value: 60 },
    { name: 'Freed', value: 58 },
    { name: 'Cana', value: 57 },
    { name: 'Lisanna', value: 53 },
    { name: 'Bickslow', value: 52 },
    { name: 'Evergreen', value: 51 },
    { name: 'Lucy début', value: 49 },
    { name: 'Juvia', value: 48 },
    { name: 'Mirajane début', value: 46 },
    { name: 'Natsu début', value: 45 },
    { name: 'Gray début', value: 44 },
    { name: 'Happy', value: 30 },
    { name: 'Panther Lily', value: 29 },
    { name: 'Macao', value: 27 },
    { name: 'Wakaba', value: 25 },
    { name: 'Romeo', value: 23 },
    { name: 'Alzack', value: 21 },
    { name: 'Bisca', value: 20 },
    { name: 'Nab', value: 18 },
    { name: 'Jet', value: 17 },
    { name: 'Droy', value: 16 },
    { name: 'Max', value: 15 },
    { name: 'Wakaba début', value: 12 }
];

// Construit une base Enchère de 50 personnages exactement par univers.
// Les valeurs sont une échelle de puissance de jeu de 1 à 100.
const ENCHERE_EXTRAS = {"snk": ["Carla Yeager", "Keith Shadis", "Daz"], "deathnote": ["Raye Penber", "Naomi Misora", "Watari", "Aiber", "Wedy", "Halle Lidner", "Stephen Gevanni", "Anthony Rester", "Demegawa", "Sachiko Yagami", "Sayu Yagami", "Kiyomi Takada", "Teru Mikami", "Gelus", "Sidoh", "Mido", "Nameless Shinigami", "Rod Ross", "Jack Neylon", "Matt", "Roger Ruvie", "Lind L. Tailor", "Armonia Justin Beyondormason", "Touta Matsuda", "Kanzo Mogi", "Shuichi Aizawa", "Hideki Ide", "Hitoshi Demegawa", "Kyosuke Higuchi", "Reiji Namikawa", "Shingo Mido", "Masahiko Kida", "Eiichi Takahashi", "Arayoshi Hatori", "Suguru Shimura", "Takuo Shibuimaru", "Kiichiro Osoreda", "Yuri", "Steve Mason", "George Sairas", "Yamamoto"], "cote": ["Hiyori Shiina", "Albert Yamada", "Mio Ibuki", "Daichi Ishizaki", "Rokusuke Koenji", "Teruhiko Yukimura", "Haruka Hasebe", "Akito Miyake", "Airi Sakura", "Chiaki Matsushita", "Maya Sato", "Yosuke Hirata", "Honami Ichinose", "Ryuji Kanzaki", "Masayoshi Hashimoto", "Kakeru Ryuen", "Arisu Sakayanagi", "Kei Karuizawa", "Sae Chabashira", "Chie Hoshinomiya", "Tsubasa Nanase", "Ichika Amasawa", "Takuya Yagami", "Kyo Ishigami", "Riku Utomiya", "Sakurako Tsubaki", "Nanase Tsubasa", "Fuka Kiryuin", "Nazuna Asahina", "Miki Yamamura", "Tokito Hiroya", "Kito Hayato", "Kamuro Masumi", "Yuki Himeno", "Katsuragi Kohei", "Miyabi Nagumo", "Kiriyama Ikuto", "Mako Amikura"], "solo": ["Go Gunhee", "Woo Jinchul", "Min Byung-Gyu", "Ma Dongwook", "Lim Tae-Gyu", "Hwang Dongsoo", "Hwang Dongsuk", "Kang Taeshik", "Song Chi-Yul", "Kim Chul", "Iron", "Tank", "Tusk", "Bellion", "Kaisel", "Kamish", "Yoo Myunghan", "Yoo Soohyun", "Han Song-Yi", "Park Heejin", "Park Kyung-Hye", "Sung Jinah", "Lee Minsung", "Park Jongsoo", "Goto Ryuji", "Kanae Tawata"], "fireforce": ["Akitaru Obi", "Takehisa Hinawa", "Viktor Licht", "Vulcan Joseph", "Lisa Isaribi", "Yu", "Karim Flam", "Foien Li", "Onyango", "Rekka Hoshimiya", "Arrow", "Haumea", "Charon", "Inca Kasugatani", "Ritsu", "Dragon", "Giovanni", "Yona", "Assault", "Tempe", "Sumire", "Faerie", "Pan Ko Paat", "Ogun Montgomery", "Asako Hague", "Dr. Giovanni", "Gold", "Stream", "Iron", "Sasori", "Flail", "Mirage", "Haran", "Nataku Son", "Kurono Yuichiro", "Raffles III", "Anton"], "mushoku": ["Elinalise Dragonroad", "Talhand", "Geese Nukadia", "Cliff Grimoire", "Zanoba Shirone", "Julie", "Aisha Greyrat", "Norn Greyrat", "Pax Shirone", "Perugius Dola", "Nanahoshi Shizuka", "Badigadi", "Kishirika Kishirisu", "Atofe Raibaku", "Kalman II", "Kalman III", "Doga", "Sandor von Grandeur", "Arumanfi", "Sylvaril", "Luke Notos Greyrat", "Derrick Redbat", "Tristina Purplehorse", "Isolte Cruel", "Nina Farion", "Jino Britts", "Gal Farion", "Reida Reia", "Randolph Marianne", "Moore", "Soldat Heckler", "Sara", "Suzanne"], "rezero": ["Felt", "Rom", "Priscilla Barielle", "Al", "Anastasia Hoshin", "Julius Juukulius", "Wilhelm van Astrea", "Theresia van Astrea", "Felix Argyle", "Petelgeuse Romanee-Conti", "Regulus Corneas", "Capella Emerada Lugunica", "Sirius Romanee-Conti", "Lye Batenkaitos", "Roy Alphard", "Louis Arneb", "Pandora", "Hector", "Shaula", "Reid Astrea", "Crusch Karsten", "Ricardo Welkin", "Mimi Pearlbaton", "Hetaro Pearlbaton", "Tivey Pearlbaton", "Joshua Juukulius", "Meili Portroute", "Elsa Granhiert", "Frederica Baumann", "Garfiel Tinsel"], "bluelock": ["Yo Hiori", "Ranze Kurona", "Jingo Raichi", "Gin Gagamaru", "Jyubei Aryu", "Aoshi Tokimitsu", "Tabito Karasu", "Eita Otoya", "Kenyu Yukimiya", "Ikki Niko", "Oliver Aiku", "Shuto Sendou", "Ryusei Shidou", "Michael Kaiser", "Alexis Ness", "Don Lorenzo", "Marc Snuffy", "Chris Prince", "Lavinho", "Julian Loki", "Nanase Nijiro", "Zantetsu Tsurugi", "Hajime Nishioka", "Hibiki Okawa", "Wataru Kuon", "Yudai Imamura", "Asahi Naruhaya", "Okuhito Iemon", "Gurimu Igarashi", "Ryunosuke Kira"], "fma": ["Solf J. Kimblee", "Paninya", "Rose Thomas", "Darius", "Heinkel", "Jerso", "Zampano", "Martel", "Dolcetto", "Roa"], "chainsaw": ["Fumiko Mifune", "Yuko", "Joey", "Nail Fiend", "Bucky", "Falling Devil", "Darkness Devil", "Gun Devil", "Control Devil", "War Devil", "Famine Devil", "Death Devil"], "wakfu": ["Ogrest", "Otomaï", "Dathura", "Nora", "Efrim", "Yugo le Eliatrope", "Pandiego de la Vega", "Eva la Cra", "Maître Joris", "Bonta Guard", "Brakmar Guard", "Sipho", "Coqueline", "Poo", "Pandora"], "demonslayer": ["Hotaru Haganezuka", "Kotetsu", "Tecchin Tecchikawahara", "Suma", "Makio", "Hinatsuru", "Kiyo Terauchi", "Naho Takada", "Sumi Nakahara", "Goto", "Ozaki", "Spider Demon Father", "Spider Demon Mother", "Spider Demon Brother"], "hellsparadise": ["Rokurota", "Horubo", "Moro Makiya", "Akaginu", "Kido Maru", "Aza Chobei", "Aza Toma", "Yamada Asaemon Kisho", "Yamada Asaemon Jikka", "Yamada Asaemon Shugen", "Yamada Asaemon Isuzu", "Yamada Asaemon Kiyomaru", "Yamada Asaemon Tsumutsumu", "Yamada Asaemon Gagaimo", "Yamada Asaemon Aoki", "Yamada Asaemon Makiya", "Yamada Asaemon Saki", "Doshi", "Hoko", "Mu Dan Flower Tao", "Ju Fa Flower Tao", "Tao Fa Flower Tao", "Gui Fa Flower Tao", "Mei Child Form", "Rien Tensen", "Yamada Asaemon Eizen", "Yamada Asaemon Genji", "Yamada Asaemon Senta", "Yamada Asaemon Fuchi", "Yamada Asaemon Tenza", "Yamada Asaemon Shion", "Nurugai", "Tamiya Gantetsusai", "Gabimaru Wife", "Yui", "Yamada Asaemon Tetsushin", "Yamada Asaemon Kiyomaru II", "Iwagakure Chief"], "gachiakuta": ["Arkha", "Canis Surebrec", "Tomme", "Zanka Nijiku", "Riyo Reaper", "Semiu Grier", "Gris Rubion", "Follo Tunito", "Tamsy Caines", "Delmon Gates", "Eishia Stilza", "August Stilza", "Guita Hebby Fantasia", "Dear Santa", "Bro Santa", "Jabber Wonger", "Zodyl Typhon", "Cthoni Andor", "Noerde Hew Amozo", "Fu Orostor", "Bundus Begalkeit", "Remlin Tysark", "Alice", "Amo Empool", "Regto Surebrec"], "sao": ["Sachi", "Argo", "Diavel", "Kibaou", "Sakuya", "Alicia Rue", "Recon", "Oberon", "Nobuyuki Sugou", "Death Gun", "XaXa", "PoH", "Vassago Casals", "Ronie Arabel", "Tiese Shtolienen", "Selka Zuberg", "Chudelkin", "Sheyta Synthesis Twelve", "Iskahn", "Sortiliena Serlut", "Eiji Nochizawa", "Yuna Shigemura", "Professor Shigemura", "Mito", "Misumi Tozawa", "Kyouji Shinkawa", "Shouichi Shinkawa", "Musketeer X", "Pitohui", "Llenn"], "tensura": ["Zegion", "Apito", "Geld", "Gabiru", "Beretta", "Feldway", "Michael", "Veldanava", "Granbell Rosso", "Razul", "Masayuki Honjo", "Rudra Nam Ul Nasca", "Kondou Tatsuya", "Damrada", "Moss"], "tokyoghoul": ["Shachi", "Kurona Yasuhisa", "Nashiro Yasuhisa", "Miza Kusakari", "Naki", "Hooguro", "Shousei Idera", "Hanbee Abara", "Shinsanpei Aura", "Mizurou Tamaki"], "tokyorevengers": ["Ryoko Baji", "Akane Inui", "Mana Mitsuya", "Luna Mitsuya", "Masato Tachibana", "Sakurai"]};

function buildEnchere50(raw, extras = []) {
    const names = [...parseRGList(raw), ...extras];
    const unique = [];
    const seen = new Set();
    for (const name of names) {
        const key = normalizeRG(name);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        unique.push(name);
        if (unique.length === 50) break;
    }
    // 100 -> 1 sur 50 rangs. Le rang suit l'ordre de la base de l'univers.
    return unique.map((name, i) => ({
        name,
        value: Math.max(1, Math.round(100 - (i * 99 / 49)))
    }));
}

function clampEncherePool(pool, fallbackRaw, extras = []) {
    const base = (pool || []).map(c => ({ ...c, value: Math.max(1, Math.min(100, Number(c.value) || 1)) }));
    const seen = new Set(base.map(c => normalizeRG(c.name)));
    for (const c of buildEnchere50(fallbackRaw, extras)) {
        if (base.length >= 50) break;
        if (seen.has(normalizeRG(c.name))) continue;
        seen.add(normalizeRG(c.name));
        base.push(c);
    }
    return base.slice(0, 50);
}


// Notes de puissance/niveau réellement utilisées par les deux modes Enchère.
// Elles sont indépendantes de l'ordre des listes Rolland Garos.
const ENCHERE_POWER_OVERRIDES = {
  hxh: {"Meruem":100,"Isaac Netero":96,"Adult Gon":98,"Gon Freecss":70,"Killua Zoldyck":76,"Ging Freecss":93,"Beyond Netero":90,"Chrollo Lucilfer":89,"Hisoka Morow":87,"Illumi Zoldyck":84,"Zeno Zoldyck":91,"Silva Zoldyck":90,"Neferpitou":92,"Shaiapouf":90,"Menthuthuyoupi":91,"Kurapika":82,"Biscuit Krueger":80,"Kite":79,"Feitan Portor":78,"Razor":83,"Morel Mackernasey":77,"Knuckle Bine":68,"Shoot McMahon":67,"Leorio Paradinight":35},
  snk: {"Eren Yeager":100,"Ymir Fritz":100,"Armin Arlert":88,"Reiner Braun":82,"Zeke Yeager":91,"Levi Ackerman":90,"Mikasa Ackerman":86,"Annie Leonhart":80,"Bertholdt Hoover":83,"Pieck Finger":72,"Porco Galliard":76,"Falco Grice":79,"Lara Tybur":84,"Erwin Smith":35,"Hange Zoe":32,"Jean Kirstein":28,"Connie Springer":25,"Sasha Blouse":24,"Gabi Braun":26},
  deathnote: {"Light Yagami":100,"L Lawliet":95,"Near":88,"Mello":84,"Ryuk":90,"Rem":90,"Teru Mikami":82,"Misa Amane":78,"Kiyomi Takada":70,"Soichiro Yagami":45,"Naomi Misora":52,"Touta Matsuda":30,"Shuichi Aizawa":38,"Kanzo Mogi":37,"Watari":40,"Raye Penber":34,"Kyosuke Higuchi":60,"Gelus":75,"Sidoh":72},
  cote: {"Kiyotaka Ayanokoji":100,"Koenji Rokusuke":96,"Takuya Yagami":94,"Ichika Amasawa":91,"Manabu Horikita":88,"Miyabi Nagumo":86,"Arisu Sakayanagi":84,"Kakeru Ryuen":82,"Suzune Horikita":76,"Honami Ichinose":75,"Kei Karuizawa":58,"Albert Yamada":78,"Mio Ibuki":72,"Ken Sudo":65,"Yosuke Hirata":68,"Kikyo Kushida":64,"Hiyori Shiina":62,"Haruka Hasebe":48,"Airi Sakura":28},
  solo: {"Sung Jinwoo":100,"Antares":98,"Ashborn":97,"Absolute Being":99,"Bellion":93,"Beru":90,"Igris":86,"Thomas Andre":89,"Liu Zhigang":87,"Christopher Reed":86,"Go Gunhee":82,"Cha Hae-In":78,"Choi Jong-In":72,"Baek Yoonho":71,"Goto Ryuji":69,"Woo Jinchul":62,"Hwang Dongsoo":61,"Min Byung-Gyu":58,"Yoo Jinho":28,"Lee Joohee":25},
  fireforce: {"Shinra Kusakabe":100,"Haumea":96,"Dragon":95,"Benimaru Shinmon":92,"Sho Kusakabe":90,"Arthur Boyle":91,"Charon":85,"Burns":82,"Joker":80,"Kurono Yuichiro":79,"Ogun Montgomery":73,"Maki Oze":64,"Takehisa Hinawa":62,"Tamaki Kotatsu":55,"Hibana":58,"Akitaru Obi":45,"Viktor Licht":20,"Vulcan Joseph":18,"Iris":10},
  mushoku: {"Orsted":100,"Hitogami":99,"Rudeus Greyrat":94,"Laplace":98,"Badigadi":91,"Atofe Raibaku":89,"Jino Britts":92,"Gal Farion":90,"Reida Reia":88,"Randolph Marianne":86,"Ruijerd Superdia":80,"Eris Boreas Greyrat":83,"Roxy Migurdia":74,"Sylphiette":72,"Ghislaine Dedoldia":75,"Paul Greyrat":64,"Cliff Grimoire":50,"Elinalise Dragonroad":58,"Zanoba Shirone":45,"Geese Nukadia":20},
  rezero: {"Reinhard van Astrea":100,"Satella":100,"Reid Astrea":97,"Regulus Corneas":95,"Pandora":94,"Sekhmet":93,"Puck":90,"Roswaal L Mathers":87,"Volcanica":96,"Cecilus Segmunt":94,"Subaru Natsuki":72,"Emilia":82,"Beatrice":78,"Garfiel Tinsel":75,"Wilhelm van Astrea":80,"Theresia van Astrea":84,"Julius Juukulius":77,"Elsa Granhiert":66,"Rem":55,"Ram":70,"Otto Suwen":25},
  bluelock: {"Noel Noa":100,"Julian Loki":99,"Marc Snuffy":98,"Chris Prince":97,"Lavinho":96,"Michael Kaiser":94,"Sae Itoshi":93,"Rin Itoshi":91,"Don Lorenzo":91,"Ryusei Shidou":89,"Yoichi Isagi":88,"Shoei Barou":86,"Alexis Ness":84,"Rensuke Kunigami":83,"Meguru Bachira":82,"Seishiro Nagi":81,"Hyoma Chigiri":80,"Oliver Aiku":79,"Tabito Karasu":78,"Kenyu Yukimiya":77,"Eita Otoya":76,"Reo Mikage":75,"Gin Gagamaru":74,"Yo Hiori":73,"Ranze Kurona":70,"Ikki Niko":69,"Jyubei Aryu":68,"Aoshi Tokimitsu":67,"Jingo Raichi":63,"Raichi Jingo":63,"Zantetsu Tsurugi":62,"Shuto Sendou":61,"Nijiro Nanase":55,"Nanase Nijiro":55,"Hajime Nishioka":52,"Hibiki Okawa":45,"Ryunosuke Kira":44,"Wataru Kuon":38,"Asahi Naruhaya":35,"Okuhito Iemon":34,"Yudai Imamura":32,"Gurimu Igarashi":18,"Jinpachi Ego":8,"Anri Teieri":3},
  fma: {"Father":100,"Van Hohenheim":98,"Pride":91,"King Bradley":90,"Roy Mustang":87,"Scar":84,"Greed":81,"Solf J. Kimblee":78,"Edward Elric":76,"Alphonse Elric":74,"Izumi Curtis":73,"Alex Louis Armstrong":67,"Olivier Mira Armstrong":62,"Envy":61,"Lust":58,"Sloth":56,"Gluttony":54,"Ling Yao":52,"Riza Hawkeye":48,"May Chang":47,"Winry Rockbell":12,"Nina Tucker":2},
  chainsaw: {"Death Devil":100,"Darkness Devil":99,"Falling Devil":96,"Pochita":95,"Gun Devil":92,"Makima":90,"Yoru":88,"Fami":86,"Quanxi":80,"Santa Claus":79,"Denji":76,"Reze":74,"Kishibe":70,"Power":58,"Aki Hayakawa":55,"Angel Devil":54,"Katana Man":53,"Beam":45,"Himeno":40,"Kobeni Higashiyama":35,"Bucky":5},
  wakfu: {"Ogrest":100,"Yugo":96,"Oropo":95,"Qilby":92,"Goultard":91,"Adamai":88,"Nox":83,"Tristepin de Percedal":80,"Rubilax":78,"Joris Jurgen":77,"Phaeris":75,"Grougaloragran":74,"Echo":72,"Harebourg":70,"Amalia Sheran Sharm":60,"Evangelyne":58,"Ruel Stroud":45,"Alibert":18,"Az":12},
  demonslayer: {"Yoriichi Tsugikuni":100,"Muzan Kibutsuji":98,"Kokushibo":94,"Doma":90,"Akaza":86,"Tanjiro Kamado":84,"Gyomei Himejima":83,"Sanemi Shinazugawa":79,"Giyu Tomioka":76,"Obanai Iguro":75,"Muichiro Tokito":74,"Kyojuro Rengoku":72,"Mitsuri Kanroji":70,"Hantengu":68,"Tengen Uzui":66,"Nezuko Kamado":65,"Gyutaro":64,"Zenitsu Agatsuma":62,"Shinobu Kocho":61,"Gyokko":60,"Inosuke Hashibira":58,"Murata":20},
  pokemon: {"Arceus":100,"Giratina":96,"Dialga":95,"Palkia":95,"Rayquaza":94,"Mewtwo":91,"Groudon":90,"Kyogre":90,"Necrozma":89,"Éthernatos":88,"Zygarde":88,"Lugia":86,"Ho-Oh":86,"Reshiram":84,"Zekrom":84,"Kyurem":83,"Xerneas":82,"Yveltal":82,"Zacian":81,"Solgaleo":80,"Lunala":80,"Zamazenta":80,"Mew":79,"Dracolosse":70,"Dracaufeu":67,"Léviator":62,"Ectoplasma":61,"Alakazam":60,"Pikachu":55,"Magicarpe":5,"Chenipan":4},
  dragonball: {"Zeno":100,"Grand Priest":99,"Whis":97,"Beerus":95,"Gogeta":94,"Vegito":94,"Son Goku":93,"Vegeta":92,"Broly":92,"Jiren":91,"Son Gohan":90,"Frieza":90,"Cell Max":87,"Piccolo":86,"Toppo":82,"Hit":80,"Goku Black":79,"Zamasu":78,"Majin Buu":73,"Android 17":70,"Future Trunks":68,"Krillin":45,"Tien Shinhan":43,"Yamcha":30,"Mr. Satan":5},
  hellsparadise: {"Rien":100,"Ju Fa":94,"Tao Fa":93,"Mu Dan":91,"Zhu Jin":90,"Gui Fa":89,"Gabimaru":84,"Shion":78,"Chobei Aza":76,"Yamada Asaemon Sagiri":68,"Yuzuriha":66,"Tamiya Gantetsusai":64,"Aza Toma":60,"Yamada Asaemon Fuchi":58,"Yamada Asaemon Tenza":55,"Nurugai":28},
  gachiakuta: {"Zodyl Typhon":95,"Enjin":90,"Jabber Wonger":86,"Rudo":84,"Tamsy Caines":82,"Zanka":75,"Riyo":74,"Cthoni Andor":70,"Delmon":68,"Semiu Grier":62,"Gris Rubion":58,"Guita":55,"Follo":45,"Regto":40,"Chiwa":15},
  haikyuu: {"Wakatoshi Ushijima":97,"Kiyoomi Sakusa":96,"Kotaro Bokuto":94,"Atsumu Miya":93,"Toru Oikawa":92,"Korai Hoshiumi":91,"Tobio Kageyama":90,"Aran Ojiro":89,"Shoyo Hinata":88,"Sachiro Hirugami":87,"Tetsuro Kuroo":85,"Morisuke Yaku":84,"Rintaro Suna":83,"Keiji Akaashi":82,"Kenma Kozume":80,"Yu Nishinoya":79,"Osamu Miya":78,"Asahi Azumane":76,"Satori Tendo":75,"Tsutomu Goshiki":74,"Kei Tsukishima":73,"Daichi Sawamura":70,"Reon Ohira":69,"Eita Semi":68,"Ryunosuke Tanaka":66,"Kenjiro Shirabu":65,"Taketora Yamamoto":64,"Nobuyuki Kai":62,"Hajime Iwaizumi":61,"Shohei Fukunaga":60,"Shinsuke Kita":59,"Lev Haiba":58,"Akira Kunimi":56,"Yutaro Kindaichi":55,"Tadashi Yamaguchi":52,"Koshi Sugawara":51,"Shigeru Yahaba":48,"Shinji Watari":47,"Issei Matsukawa":46,"Takahiro Hanamaki":45,"So Inuoka":44,"Taichi Kawanishi":43,"Chikara Ennoshita":41,"Hisashi Kinoshita":36,"Kazuhito Narita":34,"Tamahiko Teshiro":33,"Keishin Ukai":10,"Ittetsu Takeda":5,"Kiyoko Shimizu":3,"Hitoka Yachi":2},
  jjk: {"Ryomen Sukuna":100,"Satoru Gojo":99,"Yuta Okkotsu":94,"Kenjaku":92,"Yuki Tsukumo":91,"Hajime Kashimo":89,"Maki Zenin":86,"Toji Fushiguro":86,"Kinji Hakari":84,"Yuji Itadori":83,"Jogo":78,"Mahito":77,"Choso":74,"Megumi Fushiguro":70,"Kento Nanami":63,"Aoi Todo":62,"Nobara Kugisaki":52,"Panda":48,"Kasumi Miwa":30},
  jojo: {"Giorno Giovanna":100,"Enrico Pucci":98,"Tooru":97,"Funny Valentine":96,"Johnny Joestar":95,"Jotaro Kujo":91,"Dio Brando":90,"Diavolo":88,"Josuke Higashikata Gappy":87,"Kars":84,"Josuke Higashikata":80,"Weather Report":79,"Bruno Bucciarati":72,"Rohan Kishibe":71,"Jean Pierre Polnareff":68,"Joseph Joestar":67,"Jonathan Joestar":62,"Guido Mista":55,"Robert E. O. Speedwagon":15},
  tensura: {"Veldanava":100,"Rimuru Tempest":99,"Guy Crimson":97,"Milim Nava":96,"Velzard":95,"Velgrynd":94,"Feldway":93,"Michael":92,"Veldora Tempest":91,"Diablo":88,"Zegion":87,"Chloe Aubert":86,"Testarossa":85,"Carrera":84,"Ultima":82,"Dagruel":81,"Luminous Valentine":78,"Leon Cromwell":77,"Benimaru":73,"Shion":68,"Gobta":30},
  opm: {"Saitama":100,"Garou":98,"Blast":96,"Boros":92,"Tatsumaki":89,"Psykos":84,"Orochi":83,"Flashy Flash":78,"Bang":76,"Atomic Samurai":73,"Genos":72,"Superalloy Darkshine":70,"Metal Bat":67,"Drive Knight":66,"Child Emperor":62,"Speed-o'-Sound Sonic":60,"Fubuki":55,"Mumen Rider":10},
  sao: {"Administrator":96,"Quinella":96,"Kirito":95,"Gabriel Miller":94,"Alice Zuberg":92,"Eugeo":90,"Bercouli Synthesis One":89,"Asuna Yuuki":87,"Yuuki Konno":86,"Sinon":82,"Fanatio Synthesis Two":80,"Sheyta Synthesis Twelve":79,"Leafa":78,"Iskahn":77,"Klein":62,"Agil":60,"Lisbeth":45,"Silica":43,"Yui":35,"Sachi":30},
  tokyoghoul: {"Ken Kaneki":100,"Kishou Arima":97,"Eto Yoshimura":94,"Nimura Furuta":92,"Juuzou Suzuya":89,"Shachi":86,"Seidou Takizawa":85,"Yakumo Oomori":80,"Kotaro Amon":76,"Renji Yomo":73,"Touka Kirishima":72,"Ayato Kirishima":70,"Shu Tsukiyama":68,"Hinami Fueguchi":64,"Nishiki Nishio":58,"Hideyoshi Nagachika":12},
  tokyorevengers: {"South Terano":100,"Manjiro Sano":99,"Izana Kurokawa":96,"Senju Kawaragi":92,"Wakasa Imaushi":90,"Keizo Arashi":89,"Taiju Shiba":87,"Kakucho":85,"Ken Ryuguji":82,"Keisuke Baji":78,"Haruchiyo Sanzu":76,"Ran Haitani":72,"Rindo Haitani":70,"Takashi Mitsuya":68,"Chifuyu Matsuno":62,"Kazutora Hanemiya":61,"Takemichi Hanagaki":45,"Tetta Kisaki":25,"Hinata Tachibana":5}
};

const ENCHERE_UNIVERSES = {
    naruto: { name: 'Naruto', characters: clampEncherePool(ENCHERE_NARUTO, NARUTO_RAW) },
    onepiece: { name: 'One Piece', characters: clampEncherePool(ENCHERE_ONEPIECE, ONEPIECE_RAW) },
    bleach: { name: 'Bleach', characters: clampEncherePool(ENCHERE_BLEACH, BLEACH_RAW) },
    hxh: { name: 'Hunter x Hunter', characters: buildEnchere50(RG_HXH_RAW, ENCHERE_EXTRAS.hxh) },
    snk: { name: "SNK / L'Attaque des Titans", characters: buildEnchere50(RG_SNK_RAW, ENCHERE_EXTRAS.snk) },
    sds: { name: 'Seven Deadly Sins', characters: clampEncherePool(ENCHERE_SDS, SDS_RAW) },
    deathnote: { name: 'Death Note', characters: buildEnchere50(RG_DEATHNOTE_RAW, ENCHERE_EXTRAS.deathnote) },
    cote: { name: 'Classroom of the Elite', characters: buildEnchere50(RG_COTE_RAW, ENCHERE_EXTRAS.cote) },
    solo: { name: 'Solo Leveling', characters: buildEnchere50(RG_SOLO_RAW, ENCHERE_EXTRAS.solo) },
    clover: { name: 'Black Clover', characters: clampEncherePool(ENCHERE_CLOVER, CLOVER_RAW) },
    fireforce: { name: 'Fire Force', characters: buildEnchere50(RG_FIREFORCE_RAW, ENCHERE_EXTRAS.fireforce) },
    mushoku: { name: 'Mushoku Tensei', characters: buildEnchere50(RG_MUSHOKU_RAW, ENCHERE_EXTRAS.mushoku) },
    rezero: { name: 'Re:Zero', characters: buildEnchere50(RG_REZERO_RAW, ENCHERE_EXTRAS.rezero) },
    fairy: { name: 'Fairy Tail', characters: clampEncherePool(ENCHERE_FAIRY, FAIRY_RAW) },
    bluelock: { name: 'Blue Lock', characters: buildEnchere50(RG_BLUELOCK_RAW, ENCHERE_EXTRAS.bluelock) },
    fma: { name: 'Fullmetal Alchemist', characters: buildEnchere50(RG_FMA_RAW, ENCHERE_EXTRAS.fma) },
    chainsaw: { name: 'Chainsaw Man', characters: buildEnchere50(RG_CHAINSAW_RAW, ENCHERE_EXTRAS.chainsaw) },
    wakfu: { name: 'Wakfu', characters: buildEnchere50(RG_WAKFU_RAW, ENCHERE_EXTRAS.wakfu) },
    demonslayer: { name: 'Demon Slayer', characters: buildEnchere50(RG_DEMONSLAYER_RAW, ENCHERE_EXTRAS.demonslayer) },
    pokemon: { name: 'Pokémon', characters: buildEnchere50(RG_POKEMON_RAW) },
    dragonball: { name: 'Dragon Ball', characters: buildEnchere50(RG_DRAGONBALL_RAW) },
    hellsparadise: { name: "Hell's Paradise", characters: buildEnchere50(RG_HELLSPARADISE_RAW, ENCHERE_EXTRAS.hellsparadise) },
    gachiakuta: { name: 'Gachiakuta', characters: buildEnchere50(RG_GACHIAKUTA_RAW, ENCHERE_EXTRAS.gachiakuta) },
    haikyuu: { name: 'Haikyuu', characters: buildEnchere50(RG_HAIKYUU_RAW) },
    jjk: { name: 'Jujutsu Kaisen', characters: buildEnchere50(RG_JJK_RAW) },
    jojo: { name: "JoJo's Bizarre Adventure", characters: buildEnchere50(RG_JOJO_RAW) },
    tensura: { name: 'Tensura', characters: buildEnchere50(RG_TENSURA_RAW, ENCHERE_EXTRAS.tensura) },
    opm: { name: 'One Punch Man', characters: buildEnchere50(RG_OPM_RAW) },
    sao: { name: 'Sword Art Online', characters: buildEnchere50(RG_SAO_RAW, ENCHERE_EXTRAS.sao) },
    tokyoghoul: { name: 'Tokyo Ghoul', characters: buildEnchere50(RG_TOKYOGHOUL_RAW, ENCHERE_EXTRAS.tokyoghoul) },
    tokyorevengers: { name: 'Tokyo Revengers', characters: buildEnchere50(RG_TOKYOREVENGERS_RAW, ENCHERE_EXTRAS.tokyorevengers) }
};


// Applique les notes explicites. Un personnage non audité reste volontairement
// dans une zone basse/moyenne au lieu de recevoir artificiellement 80-100 selon sa position.
for (const [universeKey, universe] of Object.entries(ENCHERE_UNIVERSES)) {
    const overrides = ENCHERE_POWER_OVERRIDES[universeKey] || {};
    universe.characters = universe.characters.map((character, index) => {
        if (overrides[character.name] != null) {
            return { ...character, value: overrides[character.name] };
        }
        // Les six anciennes bases étaient déjà notées à la main : on conserve leur note bornée à 100.
        if (['naruto','onepiece','bleach','sds','clover','fairy'].includes(universeKey)) {
            return { ...character, value: Math.max(1, Math.min(100, Number(character.value) || 30)) };
        }
        // Sécurité anti-aberration : jamais de top-tier automatique pour un nom non évalué.
        return { ...character, value: Math.max(10, Math.min(58, 58 - Math.floor(index * 0.55))) };
    });
}

function shuffleEnchereDeck(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function startEnchere(room, roomCode) {
    const key = ENCHERE_UNIVERSES[room.subMode] ? room.subMode : 'naruto';
    const universe = ENCHERE_UNIVERSES[key];

    room.status = 'enchere_playing';
    const budgets = {};
    const teams = {};
    room.players.forEach(p => {
        budgets[p.id] = 50;
        teams[p.id] = [];
    });

    room.enchere = {
        universeKey: key,
        universeName: universe.name,
        pool: shuffleEnchereDeck(universe.characters),
        budgets,
        teams,
        currentCharacter: null,
        currentBid: 0,
        currentBidderId: null,
        turnPlayerId: null,
        starterIndex: 0,
        declinedPlayers: []
    };

    startEnchereRound(room, roomCode);
}

function enchereActivePlayers(room) {
    return room.players.filter(p => (room.enchere.teams[p.id] || []).length < 4);
}

function startEnchereRound(room, roomCode) {
    const e = room.enchere;

    if (room.players.length > 0 && room.players.every(p => (e.teams[p.id] || []).length >= 4)) {
        return endEnchere(room, roomCode);
    }

    const active = enchereActivePlayers(room);
    if (active.length === 0 || e.pool.length === 0) {
        return endEnchere(room, roomCode);
    }

    if (active.length === 1) {
        // Un seul joueur a encore de la place libre : il récupère le perso suivant direct, sans enchère
        const freePlayer = active[0];
        const character = e.pool.pop();
        e.teams[freePlayer.id].push(character);
        io.to(roomCode).emit('enchere_state', room);
        return startEnchereRound(room, roomCode);
    }

    const character = e.pool.pop();
    e.currentCharacter = character;
    e.currentBid = 0;
    e.currentBidderId = null;
    e.declinedPlayers = [];

    const starter = active[e.starterIndex % active.length];
    e.starterIndex++;
    e.turnPlayerId = starter.id;

    io.to(roomCode).emit('enchere_state', room);
    maybeAutoResolveEnchereTurn(room, roomCode);
}

function maybeAutoResolveEnchereTurn(room, roomCode) {
    const e = room.enchere;
    if (!e.turnPlayerId) return;
    const budget = e.budgets[e.turnPlayerId] ?? 0;

    // Si le joueur dont c'est le tour ne peut même pas mettre +1M de plus, il est traité comme s'il laissait
    if (budget < e.currentBid + 1) {
        resolveEncherePass(room, roomCode, e.turnPlayerId);
    }
}

function discardCurrentEnchereCharacter(room, roomCode) {
    const e = room.enchere;
    e.currentCharacter = null;
    e.currentBid = 0;
    e.currentBidderId = null;
    e.turnPlayerId = null;
    e.declinedPlayers = [];
    startEnchereRound(room, roomCode);
}

function resolveEncherePass(room, roomCode, passingPlayerId) {
    const e = room.enchere;
    const opponent = room.players.find(p => p.id !== passingPlayerId);

    // Cas 1 : quelqu'un avait déjà enchéri sur ce perso — l'autre laisse, le perso part au dernier
    // enchérisseur au prix de sa dernière enchère.
    if (e.currentBidderId) {
        const winnerId = e.currentBidderId;
        const finalBid = e.currentBid;

        e.budgets[winnerId] = Math.max((e.budgets[winnerId] ?? 0) - finalBid, 0);
        e.teams[winnerId] = e.teams[winnerId] || [];
        e.teams[winnerId].push(e.currentCharacter);

        e.currentCharacter = null;
        e.currentBid = 0;
        e.currentBidderId = null;
        e.turnPlayerId = null;
        e.declinedPlayers = [];
        return startEnchereRound(room, roomCode);
    }

    // Cas 2 : personne n'a encore misé sur ce perso.
    e.declinedPlayers = e.declinedPlayers || [];
    if (!e.declinedPlayers.includes(passingPlayerId)) {
        e.declinedPlayers.push(passingPlayerId);
    }

    const activeIds = enchereActivePlayers(room).map(p => p.id);
    const everyoneDeclined = activeIds.length > 0 && activeIds.every(id => e.declinedPlayers.includes(id));

    if (everyoneDeclined || !opponent) {
        // Personne n'en veut : le perso est écarté (donné à personne), on en tire un nouveau
        return discardCurrentEnchereCharacter(room, roomCode);
    }

    // On laisse sa chance à l'autre joueur de miser dessus
    e.turnPlayerId = opponent.id;
    io.to(roomCode).emit('enchere_state', room);
    maybeAutoResolveEnchereTurn(room, roomCode);
}

function endEnchere(room, roomCode) {
    room.status = 'enchere_over';
    const e = room.enchere;

    const totals = {};
    room.players.forEach(p => {
        totals[p.id] = (e.teams[p.id] || []).reduce((sum, c) => sum + c.value, 0);
    });

    let winnerId = null;
    let message = "Égalité parfaite !";

    if (room.players.length === 2) {
        const [p1, p2] = room.players;
        if (totals[p1.id] > totals[p2.id]) {
            winnerId = p1.id;
            message = `🏆 ${p1.name} remporte l'enchère avec ${totals[p1.id]} pts !`;
        } else if (totals[p2.id] > totals[p1.id]) {
            winnerId = p2.id;
            message = `🏆 ${p2.name} remporte l'enchère avec ${totals[p2.id]} pts !`;
        }
    }

    e.totals = totals;
    e.winnerId = winnerId;

    io.to(roomCode).emit('enchere_game_over', { room, message });
}

/* ================= Enchère à l'aveugle : logique de partie (mode indépendant) ================= */
// Même principe que l'Enchère normale (mêmes univers/persos/valeurs), mais à chaque tour un seul
// des deux joueurs voit le personnage tiré (le "voyant"), l'autre mise à l'aveugle. Le rôle de voyant
// alterne à chaque manche. Impossible de "Laisser" tant qu'aucune mise n'a été posée (minimum 1 mise).

function startEnchereAveugle(room, roomCode) {
    const key = ENCHERE_UNIVERSES[room.subMode] ? room.subMode : 'naruto';
    const universe = ENCHERE_UNIVERSES[key];

    room.status = 'enchereaveugle_playing';
    const budgets = {};
    const teams = {};
    room.players.forEach(p => {
        budgets[p.id] = 50;
        teams[p.id] = [];
    });

    room.enchereAveugle = {
        universeKey: key,
        universeName: universe.name,
        pool: shuffleEnchereDeck(universe.characters),
        budgets,
        teams,
        currentCharacter: null,
        currentBid: 0,
        currentBidderId: null,
        turnPlayerId: null,
        seerId: null,
        starterIndex: 0
    };

    startEnchereAveugleRound(room, roomCode);
}

function enchereAveugleActivePlayers(room) {
    return room.players.filter(p => (room.enchereAveugle.teams[p.id] || []).length < 4);
}

function enchereAveugleSnapshotFor(room, revealAll) {
    const ea = room.enchereAveugle;
    return function (viewerId) {
        const isSeer = revealAll || ea.seerId === viewerId;
        const currentCharacter = ea.currentCharacter
            ? (isSeer ? ea.currentCharacter : { name: '??? Mystère', value: null, hidden: true })
            : null;

        return {
            code: room.code,
            players: room.players.map(p => ({ id: p.id, name: p.name })),
            enchereAveugle: {
                universeKey: ea.universeKey,
                universeName: ea.universeName,
                budgets: ea.budgets,
                teams: ea.teams,
                currentCharacter,
                currentBid: ea.currentBid,
                currentBidderId: ea.currentBidderId,
                turnPlayerId: ea.turnPlayerId,
                seerId: revealAll ? null : ea.seerId,
                totals: ea.totals || null,
                winnerId: ea.winnerId || null
            }
        };
    };
}

function emitEnchereAveugleState(room, roomCode) {
    const buildSnapshot = enchereAveugleSnapshotFor(room, false);
    room.players.forEach(p => {
        io.to(p.id).emit('enchereaveugle_state', buildSnapshot(p.id));
    });
}

function startEnchereAveugleRound(room, roomCode) {
    const ea = room.enchereAveugle;

    if (room.players.length > 0 && room.players.every(p => (ea.teams[p.id] || []).length >= 4)) {
        return endEnchereAveugle(room, roomCode);
    }

    const active = enchereAveugleActivePlayers(room);
    if (active.length === 0 || ea.pool.length === 0) {
        return endEnchereAveugle(room, roomCode);
    }

    if (active.length === 1) {
        // Un seul joueur a encore de la place libre : il récupère le perso suivant direct, révélé, sans enchère
        const freePlayer = active[0];
        const character = ea.pool.pop();
        ea.teams[freePlayer.id].push(character);
        emitEnchereAveugleState(room, roomCode);
        return startEnchereAveugleRound(room, roomCode);
    }

    const character = ea.pool.pop();
    ea.currentCharacter = character;
    ea.currentBid = 0;
    ea.currentBidderId = null;

    const seer = active[ea.starterIndex % active.length];
    ea.starterIndex++;

    ea.seerId = seer.id;
    ea.turnPlayerId = seer.id; // le voyant mise en premier, l'aveugle répond ensuite

    emitEnchereAveugleState(room, roomCode);
    maybeAutoResolveEnchereAveugleTurn(room, roomCode);
}

function maybeAutoResolveEnchereAveugleTurn(room, roomCode) {
    const ea = room.enchereAveugle;
    if (!ea.turnPlayerId) return;
    const budget = ea.budgets[ea.turnPlayerId] ?? 0;

    if (budget >= ea.currentBid + 1) return; // il peut encore agir normalement

    if (ea.currentBid > 0) {
        // Une mise existe déjà : impossible d'enchérir plus, équivalent à un "Laisser" forcé
        resolveEnchereAveuglePass(room, roomCode, ea.turnPlayerId, true);
    } else {
        // Aucune mise possible dès le départ (0 budget) : cas limite, le perso part gratuitement à l'autre
        const opponent = room.players.find(p => p.id !== ea.turnPlayerId);
        if (opponent) {
            ea.teams[opponent.id] = ea.teams[opponent.id] || [];
            ea.teams[opponent.id].push(ea.currentCharacter);
        }
        ea.currentCharacter = null;
        ea.currentBid = 0;
        ea.currentBidderId = null;
        ea.turnPlayerId = null;
        ea.seerId = null;
        startEnchereAveugleRound(room, roomCode);
    }
}

function resolveEnchereAveuglePass(room, roomCode, passingPlayerId, forced) {
    const ea = room.enchereAveugle;

    // Règle du mode : impossible de laisser tant qu'aucune mise n'a été posée
    if (ea.currentBid <= 0 && !forced) return;

    const winnerId = ea.currentBidderId;
    const finalBid = ea.currentBid;

    if (winnerId) {
        ea.budgets[winnerId] = Math.max((ea.budgets[winnerId] ?? 0) - finalBid, 0);
        ea.teams[winnerId] = ea.teams[winnerId] || [];
        ea.teams[winnerId].push(ea.currentCharacter);
    }

    ea.currentCharacter = null;
    ea.currentBid = 0;
    ea.currentBidderId = null;
    ea.turnPlayerId = null;
    ea.seerId = null;

    startEnchereAveugleRound(room, roomCode);
}

function endEnchereAveugle(room, roomCode) {
    room.status = 'enchereaveugle_over';
    const ea = room.enchereAveugle;

    const totals = {};
    room.players.forEach(p => {
        totals[p.id] = (ea.teams[p.id] || []).reduce((sum, c) => sum + c.value, 0);
    });

    let winnerId = null;
    let message = "Égalité parfaite !";

    if (room.players.length === 2) {
        const [p1, p2] = room.players;
        if (totals[p1.id] > totals[p2.id]) {
            winnerId = p1.id;
            message = `🏆 ${p1.name} remporte l'enchère à l'aveugle avec ${totals[p1.id]} pts !`;
        } else if (totals[p2.id] > totals[p1.id]) {
            winnerId = p2.id;
            message = `🏆 ${p2.name} remporte l'enchère à l'aveugle avec ${totals[p2.id]} pts !`;
        }
    }

    ea.totals = totals;
    ea.winnerId = winnerId;

    // Fin de partie : tout est révélé pour tout le monde
    const buildSnapshot = enchereAveugleSnapshotFor(room, true);
    room.players.forEach(p => {
        io.to(p.id).emit('enchereaveugle_game_over', { room: buildSnapshot(p.id), message });
    });
}

/* ================= Jeu de connexion : logique de partie (mode indépendant) ================= */
// Chaque joueur écrit un mot en secret. Quand tout le monde a écrit, les mots sont révélés.
// Si tout le monde a écrit le même mot -> victoire commune. Sinon on repart pour un tour.

function normalizeConnexionWord(s) {
    return String(s)
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]/g, '')
        .replace(/s$/, ''); // tolère le pluriel simple
}

function startConnexion(room, roomCode) {
    room.status = 'connexion_playing';
    room.connexion = {
        round: 1,
        words: {},          // playerId -> mot du tour en cours (secret)
        history: [],        // [{ round, entries: [{name, word}] }]
        revealed: false
    };
    emitConnexionState(room, roomCode);
}

function connexionSnapshot(room, viewerId) {
    const c = room.connexion;
    return {
        code: room.code,
        players: room.players.map(p => ({
            id: p.id,
            name: p.name,
            hasSubmitted: Object.prototype.hasOwnProperty.call(c.words, p.id)
        })),
        connexion: {
            round: c.round,
            myWord: c.words[viewerId] || null,
            submittedCount: Object.keys(c.words).length,
            totalPlayers: room.players.length,
            history: c.history,
            revealed: c.revealed
        }
    };
}

function emitConnexionState(room, roomCode) {
    room.players.forEach(p => {
        io.to(p.id).emit('connexion_state', connexionSnapshot(room, p.id));
    });
}

function resolveConnexionRound(room, roomCode) {
    const c = room.connexion;

    const entries = room.players.map(p => ({
        name: p.name,
        word: c.words[p.id] || ''
    }));

    const normalized = room.players.map(p => normalizeConnexionWord(c.words[p.id] || ''));
    const allMatch = normalized.length > 1 && normalized.every(w => w && w === normalized[0]);

    c.history.unshift({ round: c.round, entries, matched: allMatch });

    if (allMatch) {
        room.status = 'connexion_over';
        const finalWord = entries[0].word;
        room.players.forEach(p => {
            io.to(p.id).emit('connexion_game_over', {
                room: connexionSnapshot(room, p.id),
                message: `🎉 Connexion établie sur « ${finalWord} » au tour ${c.round} !`
            });
        });
        return;
    }

    // Pas de convergence : on repart pour un tour
    c.round++;
    c.words = {};
    emitConnexionState(room, roomCode);
}


/* ================= AnimeDLE V2 =================
   31 DLE séparés : chaque univers a ses propres catégories et sa propre base.
================================================ */
const DLE_UNIVERSES = {"naruto":{"name":"Naruto","categories":[{"key":"c0","label":"Village","type":"text"},{"key":"c1","label":"Rang","type":"text"},{"key":"c2","label":"Clan","type":"text"},{"key":"c3","label":"Nature chakra","type":"text"},{"key":"c4","label":"Dōjutsu","type":"text"},{"key":"c5","label":"Jinchūriki","type":"text"}],"characters":[{"name":"Naruto Uzumaki","attrs":{"c0":"Konoha","c1":"Hokage","c2":"Uzumaki","c3":"Vent","c4":"Aucun","c5":"Oui"}},{"name":"Sasuke Uchiha","attrs":{"c0":"Konoha","c1":"Nukenin","c2":"Uchiha","c3":"Foudre","c4":"Sharingan/Rinnegan","c5":"Non"}},{"name":"Sakura Haruno","attrs":{"c0":"Konoha","c1":"Jōnin","c2":"Aucun","c3":"Terre/Eau","c4":"Aucun","c5":"Non"}},{"name":"Kakashi Hatake","attrs":{"c0":"Konoha","c1":"Hokage","c2":"Hatake","c3":"Foudre","c4":"Sharingan","c5":"Non"}},{"name":"Itachi Uchiha","attrs":{"c0":"Konoha","c1":"Nukenin","c2":"Uchiha","c3":"Feu","c4":"Sharingan","c5":"Non"}},{"name":"Hinata Hyūga","attrs":{"c0":"Konoha","c1":"Chūnin","c2":"Hyūga","c3":"Feu/Foudre","c4":"Byakugan","c5":"Non"}},{"name":"Gaara","attrs":{"c0":"Suna","c1":"Kazekage","c2":"Kazekage","c3":"Vent","c4":"Aucun","c5":"Ancien"}},{"name":"Minato Namikaze","attrs":{"c0":"Konoha","c1":"Hokage","c2":"Namikaze","c3":"Vent/Foudre/Feu","c4":"Aucun","c5":"Non"}},{"name":"Madara Uchiha","attrs":{"c0":"Konoha","c1":"Nukenin","c2":"Uchiha","c3":"Feu","c4":"Sharingan/Rinnegan","c5":"Oui"}},{"name":"Hashirama Senju","attrs":{"c0":"Konoha","c1":"Hokage","c2":"Senju","c3":"Bois","c4":"Aucun","c5":"Non"}},{"name":"Neji Hyūga","attrs":{"c0":"Konoha","c1":"Jōnin","c2":"Hyūga","c3":"Feu/Eau/Terre","c4":"Byakugan","c5":"Non"}},{"name":"Jiraiya","attrs":{"c0":"Konoha","c1":"Sannin","c2":"Aucun","c3":"Feu/Terre","c4":"Aucun","c5":"Non"}}]},"onepiece":{"name":"One Piece","categories":[{"key":"c0","label":"Équipage/Org.","type":"text"},{"key":"c1","label":"Rôle","type":"text"},{"key":"c2","label":"Fruit du démon","type":"text"},{"key":"c3","label":"Type de fruit","type":"text"},{"key":"c4","label":"Haki royal","type":"text"},{"key":"c5","label":"Origine","type":"text"}],"characters":[{"name":"Monkey D. Luffy","attrs":{"c0":"Chapeau de paille","c1":"Capitaine","c2":"Gomu Gomu / Nika","c3":"Paramecia/Mythique","c4":"Oui","c5":"East Blue"}},{"name":"Roronoa Zoro","attrs":{"c0":"Chapeau de paille","c1":"Épéiste","c2":"Aucun","c3":"Aucun","c4":"Oui","c5":"East Blue"}},{"name":"Nami","attrs":{"c0":"Chapeau de paille","c1":"Navigatrice","c2":"Aucun","c3":"Aucun","c4":"Non","c5":"East Blue"}},{"name":"Sanji","attrs":{"c0":"Chapeau de paille","c1":"Cuisinier","c2":"Aucun","c3":"Aucun","c4":"Non","c5":"North Blue"}},{"name":"Nico Robin","attrs":{"c0":"Chapeau de paille","c1":"Archéologue","c2":"Hana Hana","c3":"Paramecia","c4":"Non","c5":"West Blue"}},{"name":"Trafalgar Law","attrs":{"c0":"Heart","c1":"Capitaine","c2":"Ope Ope","c3":"Paramecia","c4":"Non","c5":"North Blue"}},{"name":"Shanks","attrs":{"c0":"Roux","c1":"Capitaine","c2":"Aucun","c3":"Aucun","c4":"Oui","c5":"West Blue"}},{"name":"Portgas D. Ace","attrs":{"c0":"Barbe Blanche","c1":"Commandant","c2":"Mera Mera","c3":"Logia","c4":"Oui","c5":"South Blue"}},{"name":"Marshall D. Teach","attrs":{"c0":"Barbe Noire","c1":"Capitaine","c2":"Yami Yami + Gura Gura","c3":"Logia/Paramecia","c4":"Non","c5":"Grand Line"}},{"name":"Kaido","attrs":{"c0":"Cent Bêtes","c1":"Capitaine","c2":"Uo Uo modèle Seiryu","c3":"Zoan mythique","c4":"Oui","c5":"Grand Line"}},{"name":"Boa Hancock","attrs":{"c0":"Kuja","c1":"Capitaine","c2":"Mero Mero","c3":"Paramecia","c4":"Oui","c5":"Calm Belt"}},{"name":"Sabo","attrs":{"c0":"Armée révolutionnaire","c1":"Chef d'état-major","c2":"Mera Mera","c3":"Logia","c4":"Non","c5":"East Blue"}}]},"bleach":{"name":"Bleach","categories":[{"key":"c0","label":"Race","type":"text"},{"key":"c1","label":"Affiliation","type":"text"},{"key":"c2","label":"Division","type":"text"},{"key":"c3","label":"Arme/Pouvoir","type":"text"},{"key":"c4","label":"Bankai","type":"text"},{"key":"c5","label":"Origine","type":"text"}],"characters":[{"name":"Ichigo Kurosaki","attrs":{"c0":"Hybride","c1":"Substitut Shinigami","c2":"Aucune","c3":"Zangetsu","c4":"Oui","c5":"Karakura"}},{"name":"Rukia Kuchiki","attrs":{"c0":"Shinigami","c1":"Gotei 13","c2":"13e","c3":"Sode no Shirayuki","c4":"Oui","c5":"Rukongai"}},{"name":"Renji Abarai","attrs":{"c0":"Shinigami","c1":"Gotei 13","c2":"6e","c3":"Zabimaru","c4":"Oui","c5":"Rukongai"}},{"name":"Byakuya Kuchiki","attrs":{"c0":"Shinigami","c1":"Gotei 13","c2":"6e","c3":"Senbonzakura","c4":"Oui","c5":"Soul Society"}},{"name":"Toshiro Hitsugaya","attrs":{"c0":"Shinigami","c1":"Gotei 13","c2":"10e","c3":"Hyorinmaru","c4":"Oui","c5":"Rukongai"}},{"name":"Kenpachi Zaraki","attrs":{"c0":"Shinigami","c1":"Gotei 13","c2":"11e","c3":"Nozarashi","c4":"Oui","c5":"Rukongai"}},{"name":"Sosuke Aizen","attrs":{"c0":"Shinigami","c1":"Arrancar","c2":"Ancienne 5e","c3":"Kyoka Suigetsu","c4":"Non révélé","c5":"Soul Society"}},{"name":"Uryu Ishida","attrs":{"c0":"Quincy","c1":"Wandenreich","c2":"Sternritter A","c3":"Arc/Heilig Bogen","c4":"Non","c5":"Karakura"}},{"name":"Grimmjow Jaegerjaquez","attrs":{"c0":"Arrancar","c1":"Espada","c2":"6e Espada","c3":"Pantera","c4":"Non","c5":"Hueco Mundo"}},{"name":"Ulquiorra Cifer","attrs":{"c0":"Arrancar","c1":"Espada","c2":"4e Espada","c3":"Murciélago","c4":"Non","c5":"Hueco Mundo"}},{"name":"Kisuke Urahara","attrs":{"c0":"Shinigami","c1":"Ex-Gotei 13","c2":"Ex-12e","c3":"Benihime","c4":"Oui","c5":"Soul Society"}},{"name":"Yhwach","attrs":{"c0":"Quincy","c1":"Wandenreich","c2":"Empereur","c3":"The Almighty","c4":"Non","c5":"Quincy"}}]},"hxh":{"name":"Hunter x Hunter","categories":[{"key":"c0","label":"Statut","type":"text"},{"key":"c1","label":"Type de Nen","type":"text"},{"key":"c2","label":"Affiliation","type":"text"},{"key":"c3","label":"Arme/Style","type":"text"},{"key":"c4","label":"Famille","type":"text"},{"key":"c5","label":"Arc d'intro","type":"text"}],"characters":[{"name":"Gon Freecss","attrs":{"c0":"Hunter","c1":"Renforcement","c2":"Aucune","c3":"Jajanken","c4":"Freecss","c5":"Examen Hunter"}},{"name":"Killua Zoldyck","attrs":{"c0":"Hunter","c1":"Transformation","c2":"Aucune","c3":"Électricité","c4":"Zoldyck","c5":"Examen Hunter"}},{"name":"Kurapika","attrs":{"c0":"Hunter","c1":"Matérialisation","c2":"Aucune","c3":"Chaînes","c4":"Kurta","c5":"Examen Hunter"}},{"name":"Leorio Paradinight","attrs":{"c0":"Hunter","c1":"Émission","c2":"Association Hunter","c3":"Poings","c4":"Aucune","c5":"Examen Hunter"}},{"name":"Hisoka Morow","attrs":{"c0":"Hunter","c1":"Transformation","c2":"Brigade (ancien)","c3":"Bungee Gum/cartes","c4":"Aucune","c5":"Examen Hunter"}},{"name":"Chrollo Lucilfer","attrs":{"c0":"Criminel","c1":"Spécialisation","c2":"Brigade Fantôme","c3":"Skill Hunter","c4":"Aucune","c5":"Yorknew"}},{"name":"Illumi Zoldyck","attrs":{"c0":"Hunter","c1":"Manipulation","c2":"Zoldyck","c3":"Aiguilles","c4":"Zoldyck","c5":"Examen Hunter"}},{"name":"Meruem","attrs":{"c0":"Roi Chimère","c1":"Spécialisation","c2":"Fourmis-Chimères","c3":"Combat","c4":"Fourmi-Chimère","c5":"Chimera Ant"}},{"name":"Isaac Netero","attrs":{"c0":"Hunter","c1":"Renforcement","c2":"Association Hunter","c3":"Hyakushiki Kannon","c4":"Aucune","c5":"Examen Hunter"}},{"name":"Neferpitou","attrs":{"c0":"Garde royal","c1":"Spécialisation","c2":"Fourmis-Chimères","c3":"Doctor Blythe","c4":"Fourmi-Chimère","c5":"Chimera Ant"}}]},"snk":{"name":"SNK","categories":[{"key":"c0","label":"Camp","type":"text"},{"key":"c1","label":"Unité","type":"text"},{"key":"c2","label":"Titan","type":"text"},{"key":"c3","label":"Origine","type":"text"},{"key":"c4","label":"Lien Ackerman","type":"text"},{"key":"c5","label":"Cheveux","type":"text"}],"characters":[{"name":"Eren Yeager","attrs":{"c0":"Paradis","c1":"Bataillon","c2":"Assaillant/Fondateur/Marteau","c3":"Shiganshina","c4":"Non","c5":"Brun"}},{"name":"Mikasa Ackerman","attrs":{"c0":"Paradis","c1":"Bataillon","c2":"Aucun","c3":"Shiganshina","c4":"Oui","c5":"Noir"}},{"name":"Armin Arlert","attrs":{"c0":"Paradis","c1":"Bataillon","c2":"Colossal","c3":"Shiganshina","c4":"Non","c5":"Blond"}},{"name":"Levi Ackerman","attrs":{"c0":"Paradis","c1":"Bataillon","c2":"Aucun","c3":"Souterrains","c4":"Oui","c5":"Noir"}},{"name":"Reiner Braun","attrs":{"c0":"Marley","c1":"Guerriers","c2":"Cuirassé","c3":"Liberio","c4":"Non","c5":"Blond"}},{"name":"Annie Leonhart","attrs":{"c0":"Marley","c1":"Guerriers","c2":"Féminin","c3":"Marley","c4":"Non","c5":"Blond"}},{"name":"Zeke Yeager","attrs":{"c0":"Marley","c1":"Guerriers","c2":"Bestial","c3":"Liberio","c4":"Non","c5":"Blond"}},{"name":"Erwin Smith","attrs":{"c0":"Paradis","c1":"Bataillon","c2":"Aucun","c3":"Paradis","c4":"Non","c5":"Blond"}},{"name":"Hange Zoë","attrs":{"c0":"Paradis","c1":"Bataillon","c2":"Aucun","c3":"Paradis","c4":"Non","c5":"Brun"}},{"name":"Jean Kirstein","attrs":{"c0":"Paradis","c1":"Bataillon","c2":"Aucun","c3":"Trost","c4":"Non","c5":"Brun"}}]},"sds":{"name":"Seven Deadly Sins","categories":[{"key":"c0","label":"Race","type":"text"},{"key":"c1","label":"Affiliation","type":"text"},{"key":"c2","label":"Péché/Commandement","type":"text"},{"key":"c3","label":"Magie","type":"text"},{"key":"c4","label":"Trésor sacré","type":"text"},{"key":"c5","label":"Marque démoniaque","type":"text"}],"characters":[{"name":"Meliodas","attrs":{"c0":"Démon","c1":"Seven Deadly Sins","c2":"Colère","c3":"Full Counter","c4":"Lostvayne","c5":"Oui"}},{"name":"Ban","attrs":{"c0":"Humain","c1":"Seven Deadly Sins","c2":"Avarice","c3":"Snatch","c4":"Courechouse","c5":"Non"}},{"name":"King","attrs":{"c0":"Fée","c1":"Seven Deadly Sins","c2":"Paresse","c3":"Disaster","c4":"Chastiefol","c5":"Non"}},{"name":"Diane","attrs":{"c0":"Géante","c1":"Seven Deadly Sins","c2":"Envie","c3":"Creation","c4":"Gideon","c5":"Non"}},{"name":"Gowther","attrs":{"c0":"Poupée","c1":"Seven Deadly Sins","c2":"Luxure","c3":"Invasion","c4":"Herritt","c5":"Non"}},{"name":"Merlin","attrs":{"c0":"Humaine","c1":"Seven Deadly Sins","c2":"Gourmandise","c3":"Infinity","c4":"Aldan","c5":"Non"}},{"name":"Escanor","attrs":{"c0":"Humain","c1":"Seven Deadly Sins","c2":"Orgueil","c3":"Sunshine","c4":"Rhitta","c5":"Non"}},{"name":"Elizabeth Liones","attrs":{"c0":"Déesse","c1":"Liones","c2":"Aucun","c3":"Ark","c4":"Aucun","c5":"Non"}},{"name":"Zeldris","attrs":{"c0":"Démon","c1":"Dix Commandements","c2":"Piété","c3":"Ominous Nebula","c4":"Aucun","c5":"Oui"}},{"name":"Estarossa","attrs":{"c0":"Déesse/Démon","c1":"Dix Commandements","c2":"Amour","c3":"Full Counter","c4":"Aucun","c5":"Oui"}},{"name":"Mael","attrs":{"c0":"Déesse","c1":"Quatre Archanges","c2":"Aucun","c3":"Sunshine","c4":"Aucun","c5":"Non"}},{"name":"Hawk","attrs":{"c0":"Créature","c1":"Seven Deadly Sins","c2":"Aucun","c3":"Transpork","c4":"Aucun","c5":"Non"}}]},"deathnote":{"name":"Death Note","categories":[{"key":"c0","label":"Camp","type":"text"},{"key":"c1","label":"Rôle","type":"text"},{"key":"c2","label":"Death Note possédé","type":"text"},{"key":"c3","label":"Yeux de Shinigami","type":"text"},{"key":"c4","label":"Profession","type":"text"},{"key":"c5","label":"Humain/Shinigami","type":"text"}],"characters":[{"name":"Light Yagami","attrs":{"c0":"Kira","c1":"Kira","c2":"Oui","c3":"Non","c4":"Étudiant/Enquêteur","c5":"Humain"}},{"name":"L Lawliet","attrs":{"c0":"Enquête","c1":"Détective","c2":"Non","c3":"Non","c4":"Détective","c5":"Humain"}},{"name":"Misa Amane","attrs":{"c0":"Kira","c1":"Second Kira","c2":"Oui","c3":"Oui","c4":"Mannequin","c5":"Humain"}},{"name":"Near","attrs":{"c0":"Enquête","c1":"Successeur de L","c2":"Non","c3":"Non","c4":"Détective","c5":"Humain"}},{"name":"Mello","attrs":{"c0":"Enquête","c1":"Successeur de L","c2":"Non","c3":"Non","c4":"Mafia/Enquêteur","c5":"Humain"}},{"name":"Ryuk","attrs":{"c0":"Neutre","c1":"Shinigami","c2":"Oui","c3":"Oui natifs","c4":"Shinigami","c5":"Shinigami"}},{"name":"Rem","attrs":{"c0":"Misa","c1":"Shinigami","c2":"Oui","c3":"Oui natifs","c4":"Shinigami","c5":"Shinigami"}},{"name":"Teru Mikami","attrs":{"c0":"Kira","c1":"X-Kira","c2":"Oui","c3":"Oui","c4":"Procureur","c5":"Humain"}},{"name":"Soichiro Yagami","attrs":{"c0":"Enquête","c1":"Chef de la cellule","c2":"Temporaire","c3":"Oui temporaire","c4":"Policier","c5":"Humain"}},{"name":"Touta Matsuda","attrs":{"c0":"Enquête","c1":"Membre de la cellule","c2":"Non","c3":"Non","c4":"Policier","c5":"Humain"}}]},"cote":{"name":"Classroom of the Elite","categories":[{"key":"c0","label":"Classe","type":"text"},{"key":"c1","label":"Année","type":"text"},{"key":"c2","label":"Conseil étudiant","type":"text"},{"key":"c3","label":"White Room","type":"text"},{"key":"c4","label":"Sexe","type":"text"},{"key":"c5","label":"Cheveux","type":"text"}],"characters":[{"name":"Kiyotaka Ayanokoji","attrs":{"c0":"D","c1":"1re","c2":"Non","c3":"Oui","c4":"Homme","c5":"Brun"}},{"name":"Suzune Horikita","attrs":{"c0":"D","c1":"1re","c2":"Oui plus tard","c3":"Non","c4":"Femme","c5":"Noir"}},{"name":"Kikyo Kushida","attrs":{"c0":"D","c1":"1re","c2":"Non","c3":"Non","c4":"Femme","c5":"Blond"}},{"name":"Kei Karuizawa","attrs":{"c0":"D","c1":"1re","c2":"Non","c3":"Non","c4":"Femme","c5":"Blond"}},{"name":"Kakeru Ryuen","attrs":{"c0":"C","c1":"1re","c2":"Non","c3":"Non","c4":"Homme","c5":"Noir"}},{"name":"Arisu Sakayanagi","attrs":{"c0":"A","c1":"1re","c2":"Non","c3":"Non","c4":"Femme","c5":"Lilac"}},{"name":"Honami Ichinose","attrs":{"c0":"B","c1":"1re","c2":"Oui","c3":"Non","c4":"Femme","c5":"Rose"}},{"name":"Rokusuke Koenji","attrs":{"c0":"D","c1":"1re","c2":"Non","c3":"Non","c4":"Homme","c5":"Blond"}},{"name":"Manabu Horikita","attrs":{"c0":"A","c1":"3e","c2":"Président","c3":"Non","c4":"Homme","c5":"Noir"}},{"name":"Miyabi Nagumo","attrs":{"c0":"B","c1":"2e/3e","c2":"Président","c3":"Non","c4":"Homme","c5":"Blond"}}]},"solo":{"name":"Solo Leveling","categories":[{"key":"c0","label":"Race","type":"text"},{"key":"c1","label":"Rang","type":"text"},{"key":"c2","label":"Classe/Rôle","type":"text"},{"key":"c3","label":"Guilde","type":"text"},{"key":"c4","label":"Pouvoir notable","type":"text"},{"key":"c5","label":"Nation-level","type":"text"}],"characters":[{"name":"Sung Jinwoo","attrs":{"c0":"Humain/Monarque","c1":"S","c2":"Nécromancien","c3":"Ahjin","c4":"Extraction d'ombre","c5":"Oui"}},{"name":"Cha Hae-In","attrs":{"c0":"Humaine","c1":"S","c2":"Combattante","c3":"Hunters","c4":"Épée/odorat mana","c5":"Non"}},{"name":"Choi Jong-In","attrs":{"c0":"Humain","c1":"S","c2":"Mage","c3":"Hunters","c4":"Feu","c5":"Non"}},{"name":"Baek Yoonho","attrs":{"c0":"Humain","c1":"S","c2":"Tank/Combattant","c3":"White Tiger","c4":"Transformation","c5":"Non"}},{"name":"Yoo Jinho","attrs":{"c0":"Humain","c1":"D","c2":"Tank","c3":"Ahjin","c4":"Équipement","c5":"Non"}},{"name":"Thomas Andre","attrs":{"c0":"Humain","c1":"S","c2":"Tank","c3":"Scavenger","c4":"Renforcement","c5":"Oui"}},{"name":"Liu Zhigang","attrs":{"c0":"Humain","c1":"S","c2":"Combattant","c3":"Chine","c4":"Épées","c5":"Oui"}},{"name":"Igris","attrs":{"c0":"Ombre","c1":"Maréchal","c2":"Chevalier","c3":"Armée des ombres","c4":"Épée","c5":"Non"}},{"name":"Beru","attrs":{"c0":"Ombre","c1":"Maréchal","c2":"Assassin","c3":"Armée des ombres","c4":"Vitesse/griffes","c5":"Non"}},{"name":"Antares","attrs":{"c0":"Monarque","c1":"—","c2":"Monarque des Dragons","c3":"Monarques","c4":"Destruction","c5":"Non"}}]},"clover":{"name":"Black Clover","categories":[{"key":"c0","label":"Compagnie","type":"text"},{"key":"c1","label":"Type de magie","type":"text"},{"key":"c2","label":"Grimoire","type":"text"},{"key":"c3","label":"Royaume","type":"text"},{"key":"c4","label":"Noble/Royal","type":"text"},{"key":"c5","label":"Esprit/Démon","type":"text"}],"characters":[{"name":"Asta","attrs":{"c0":"Taureau Noir","c1":"Anti-magie","c2":"5 feuilles","c3":"Clover","c4":"Paysan","c5":"Démon"}},{"name":"Yuno","attrs":{"c0":"Aube d'Or","c1":"Vent/Étoile","c2":"4 feuilles","c3":"Clover/Spade","c4":"Royal","c5":"Esprit"}},{"name":"Noelle Silva","attrs":{"c0":"Taureau Noir","c1":"Eau","c2":"3 feuilles","c3":"Clover","c4":"Royale","c5":"Esprit"}},{"name":"Yami Sukehiro","attrs":{"c0":"Taureau Noir","c1":"Ténèbres","c2":"3 feuilles","c3":"Clover","c4":"Étranger","c5":"Aucun"}},{"name":"Luck Voltia","attrs":{"c0":"Taureau Noir","c1":"Foudre","c2":"3 feuilles","c3":"Clover","c4":"Commun","c5":"Aucun"}},{"name":"Magna Swing","attrs":{"c0":"Taureau Noir","c1":"Feu","c2":"3 feuilles","c3":"Clover","c4":"Paysan","c5":"Aucun"}},{"name":"Fuegoleon Vermillion","attrs":{"c0":"Lion Pourpre","c1":"Feu","c2":"3 feuilles","c3":"Clover","c4":"Royal","c5":"Esprit"}},{"name":"Mereoleona Vermillion","attrs":{"c0":"Lion Pourpre","c1":"Feu","c2":"3 feuilles","c3":"Clover","c4":"Royale","c5":"Aucun"}},{"name":"Julius Novachrono","attrs":{"c0":"Empereur-Mage","c1":"Temps","c2":"3 feuilles","c3":"Clover","c4":"Noble","c5":"Démon lié"}},{"name":"Nacht Faust","attrs":{"c0":"Taureau Noir","c1":"Ombre","c2":"3 feuilles","c3":"Clover","c4":"Noble","c5":"Démons"}},{"name":"Finral Roulacase","attrs":{"c0":"Taureau Noir","c1":"Espace","c2":"3 feuilles","c3":"Clover","c4":"Noble","c5":"Aucun"}},{"name":"Vanessa Enoteca","attrs":{"c0":"Taureau Noir","c1":"Fil","c2":"3 feuilles","c3":"Clover","c4":"Sorcières","c5":"Aucun"}}]},"fireforce":{"name":"Fire Force","categories":[{"key":"c0","label":"Compagnie","type":"text"},{"key":"c1","label":"Génération","type":"text"},{"key":"c2","label":"Adolla Burst","type":"text"},{"key":"c3","label":"Rôle","type":"text"},{"key":"c4","label":"Arme/Style","type":"text"},{"key":"c5","label":"Cheveux","type":"text"}],"characters":[{"name":"Shinra Kusakabe","attrs":{"c0":"8e","c1":"3e","c2":"Oui","c3":"Soldat du feu","c4":"Pieds enflammés","c5":"Noir"}},{"name":"Arthur Boyle","attrs":{"c0":"8e","c1":"3e","c2":"Non","c3":"Soldat du feu","c4":"Excalibur plasma","c5":"Blond"}},{"name":"Maki Oze","attrs":{"c0":"8e","c1":"2e","c2":"Non","c3":"Soldate du feu","c4":"Contrôle des flammes","c5":"Noir"}},{"name":"Tamaki Kotatsu","attrs":{"c0":"8e","c1":"3e","c2":"Non","c3":"Soldate du feu","c4":"Nekomata","c5":"Noir"}},{"name":"Akitaru Obi","attrs":{"c0":"8e","c1":"Aucune","c2":"Non","c3":"Capitaine","c4":"Force physique","c5":"Noir"}},{"name":"Takehisa Hinawa","attrs":{"c0":"8e","c1":"2e","c2":"Non","c3":"Lieutenant","c4":"Armes à feu","c5":"Noir"}},{"name":"Benimaru Shinmon","attrs":{"c0":"7e","c1":"2e/3e","c2":"Non","c3":"Capitaine","c4":"Iai/pyrokinésie","c5":"Noir"}},{"name":"Leonard Burns","attrs":{"c0":"1re","c1":"3e","c2":"Non","c3":"Capitaine","c4":"Voltage Nova","c5":"Blanc"}},{"name":"Sho Kusakabe","attrs":{"c0":"White-Clad","c1":"3e","c2":"Oui","c3":"Commandant","c4":"Severed Universe","c5":"Blanc"}},{"name":"Haumea","attrs":{"c0":"White-Clad","c1":"3e","c2":"Oui","c3":"Pilier","c4":"Électricité","c5":"Blond"}}]},"mushoku":{"name":"Mushoku Tensei","categories":[{"key":"c0","label":"Race","type":"text"},{"key":"c1","label":"Classe","type":"text"},{"key":"c2","label":"Magie","type":"text"},{"key":"c3","label":"Style combat","type":"text"},{"key":"c4","label":"Affiliation","type":"text"},{"key":"c5","label":"Cheveux","type":"text"}],"characters":[{"name":"Rudeus Greyrat","attrs":{"c0":"Humain","c1":"Mage","c2":"Multi-élément","c3":"Magie sans incantation","c4":"Greyrat","c5":"Brun"}},{"name":"Roxy Migurdia","attrs":{"c0":"Démon Migurd","c1":"Mage","c2":"Eau","c3":"Magie","c4":"Université de magie","c5":"Bleu"}},{"name":"Sylphiette","attrs":{"c0":"Elfe/Humaine","c1":"Mage","c2":"Vent/Eau","c3":"Magie sans incantation","c4":"Ariel","c5":"Vert/Blanc"}},{"name":"Eris Boreas Greyrat","attrs":{"c0":"Humaine","c1":"Épéiste","c2":"Faible","c3":"Sword God","c4":"Greyrat","c5":"Rouge"}},{"name":"Ruijerd Superdia","attrs":{"c0":"Superd","c1":"Guerrier","c2":"Aucune","c3":"Lance","c4":"Dead End","c5":"Vert"}},{"name":"Orsted","attrs":{"c0":"Dragon","c1":"Dragon God","c2":"Multi","c3":"Arts martiaux/magie","c4":"Dragon Tribe","c5":"Blanc"}},{"name":"Paul Greyrat","attrs":{"c0":"Humain","c1":"Épéiste","c2":"Aucune","c3":"3 écoles","c4":"Greyrat","c5":"Brun"}},{"name":"Ghislaine Dedoldia","attrs":{"c0":"Beastfolk","c1":"Sword King","c2":"Aucune","c3":"Sword God","c4":"Boreas","c5":"Brun"}},{"name":"Nanahoshi Shizuka","attrs":{"c0":"Humaine","c1":"Invocatrice","c2":"Objets magiques","c3":"Recherche","c4":"Université","c5":"Noir"}},{"name":"Cliff Grimoire","attrs":{"c0":"Humain","c1":"Mage","c2":"Multi","c3":"Magie","c4":"Université","c5":"Rouge"}}]},"rezero":{"name":"Re:Zero","categories":[{"key":"c0","label":"Race","type":"text"},{"key":"c1","label":"Camp","type":"text"},{"key":"c2","label":"Pouvoir/Autorité","type":"text"},{"key":"c3","label":"Esprit contracté","type":"text"},{"key":"c4","label":"Candidate royale","type":"text"},{"key":"c5","label":"Cheveux","type":"text"}],"characters":[{"name":"Subaru Natsuki","attrs":{"c0":"Humain","c1":"Emilia","c2":"Return by Death","c3":"Beatrice","c4":"Non","c5":"Noir"}},{"name":"Emilia","attrs":{"c0":"Demi-elfe","c1":"Emilia","c2":"Glace","c3":"Puck","c4":"Oui","c5":"Argent"}},{"name":"Rem","attrs":{"c0":"Oni","c1":"Emilia","c2":"Eau","c3":"Aucun","c4":"Non","c5":"Bleu"}},{"name":"Ram","attrs":{"c0":"Oni","c1":"Emilia","c2":"Vent","c3":"Aucun","c4":"Non","c5":"Rose"}},{"name":"Beatrice","attrs":{"c0":"Esprit","c1":"Emilia","c2":"Yin","c3":"Subaru","c4":"Non","c5":"Blond"}},{"name":"Roswaal L. Mathers","attrs":{"c0":"Humain","c1":"Emilia","c2":"Multi-magie","c3":"Aucun","c4":"Non","c5":"Bleu"}},{"name":"Reinhard van Astrea","attrs":{"c0":"Humain","c1":"Felt","c2":"Protections divines","c3":"Aucun","c4":"Non","c5":"Rouge"}},{"name":"Crusch Karsten","attrs":{"c0":"Humaine","c1":"Crusch","c2":"Vent","c3":"Aucun","c4":"Oui","c5":"Vert"}},{"name":"Priscilla Barielle","attrs":{"c0":"Humaine","c1":"Priscilla","c2":"Yang","c3":"Aucun","c4":"Oui","c5":"Orange"}},{"name":"Regulus Corneas","attrs":{"c0":"Humain","c1":"Culte","c2":"Avidité","c3":"Aucun","c4":"Non","c5":"Blanc"}}]},"fairy":{"name":"Fairy Tail","categories":[{"key":"c0","label":"Guilde","type":"text"},{"key":"c1","label":"Type de magie","type":"text"},{"key":"c2","label":"Dragon Slayer","type":"text"},{"key":"c3","label":"Élément","type":"text"},{"key":"c4","label":"Sexe","type":"text"},{"key":"c5","label":"Cheveux","type":"text"}],"characters":[{"name":"Natsu Dragneel","attrs":{"c0":"Fairy Tail","c1":"Dragon Slayer","c2":"Oui","c3":"Feu","c4":"Homme","c5":"Rose"}},{"name":"Lucy Heartfilia","attrs":{"c0":"Fairy Tail","c1":"Stellaire","c2":"Non","c3":"Esprits","c4":"Femme","c5":"Blond"}},{"name":"Gray Fullbuster","attrs":{"c0":"Fairy Tail","c1":"Ice-Make","c2":"Non","c3":"Glace","c4":"Homme","c5":"Noir"}},{"name":"Erza Scarlet","attrs":{"c0":"Fairy Tail","c1":"Requip","c2":"Non","c3":"Armures","c4":"Femme","c5":"Rouge"}},{"name":"Wendy Marvell","attrs":{"c0":"Fairy Tail","c1":"Dragon Slayer","c2":"Oui","c3":"Ciel","c4":"Femme","c5":"Bleu"}},{"name":"Gajeel Redfox","attrs":{"c0":"Fairy Tail","c1":"Dragon Slayer","c2":"Oui","c3":"Fer","c4":"Homme","c5":"Noir"}},{"name":"Laxus Dreyar","attrs":{"c0":"Fairy Tail","c1":"Dragon Slayer","c2":"Oui","c3":"Foudre","c4":"Homme","c5":"Blond"}},{"name":"Juvia Lockser","attrs":{"c0":"Fairy Tail","c1":"Eau","c2":"Non","c3":"Eau","c4":"Femme","c5":"Bleu"}},{"name":"Mirajane Strauss","attrs":{"c0":"Fairy Tail","c1":"Take Over","c2":"Non","c3":"Démon","c4":"Femme","c5":"Blanc"}},{"name":"Makarov Dreyar","attrs":{"c0":"Fairy Tail","c1":"Géant/Lumière","c2":"Non","c3":"Lumière","c4":"Homme","c5":"Blond"}},{"name":"Sting Eucliffe","attrs":{"c0":"Sabertooth","c1":"Dragon Slayer","c2":"Oui","c3":"Lumière","c4":"Homme","c5":"Blond"}},{"name":"Rogue Cheney","attrs":{"c0":"Sabertooth","c1":"Dragon Slayer","c2":"Oui","c3":"Ombre","c4":"Homme","c5":"Noir"}}]},"bluelock":{"name":"Blue Lock","categories":[{"key":"c0","label":"Poste","type":"text"},{"key":"c1","label":"Pied fort","type":"text"},{"key":"c2","label":"Arme principale","type":"text"},{"key":"c3","label":"Équipe NEL","type":"text"},{"key":"c4","label":"New Gen XI","type":"text"},{"key":"c5","label":"Cheveux","type":"text"}],"characters":[{"name":"Yoichi Isagi","attrs":{"c0":"Attaquant","c1":"Droit","c2":"Meta Vision","c3":"Bastard München","c4":"Non","c5":"Bleu"}},{"name":"Rin Itoshi","attrs":{"c0":"Attaquant","c1":"Droit","c2":"Tir/vision","c3":"Paris X Gen","c4":"Non","c5":"Bleu"}},{"name":"Meguru Bachira","attrs":{"c0":"Attaquant","c1":"Droit","c2":"Dribble","c3":"FC Barcha","c4":"Non","c5":"Noir/Jaune"}},{"name":"Seishiro Nagi","attrs":{"c0":"Attaquant","c1":"Droit","c2":"Contrôle","c3":"Manshine City","c4":"Non","c5":"Blanc"}},{"name":"Reo Mikage","attrs":{"c0":"Milieu","c1":"Droit","c2":"Copie","c3":"Manshine City","c4":"Non","c5":"Violet"}},{"name":"Shoei Barou","attrs":{"c0":"Attaquant","c1":"Droit","c2":"Puissance/tir","c3":"Ubers","c4":"Non","c5":"Noir"}},{"name":"Hyoma Chigiri","attrs":{"c0":"Ailier","c1":"Droit","c2":"Vitesse","c3":"Manshine City","c4":"Non","c5":"Rouge"}},{"name":"Ryusei Shidou","attrs":{"c0":"Attaquant","c1":"Droit","c2":"Finition acrobatique","c3":"Paris X Gen","c4":"Non","c5":"Rose"}},{"name":"Michael Kaiser","attrs":{"c0":"Attaquant","c1":"Droit","c2":"Kaiser Impact","c3":"Bastard München","c4":"Oui","c5":"Blond/Bleu"}},{"name":"Sae Itoshi","attrs":{"c0":"Milieu","c1":"Gauche","c2":"Passe/dribble","c3":"Real Madrid youth","c4":"Oui","c5":"Rouge"}},{"name":"Oliver Aiku","attrs":{"c0":"Défenseur","c1":"Droit","c2":"Lecture défensive","c3":"Ubers","c4":"Non","c5":"Vert"}},{"name":"Gin Gagamaru","attrs":{"c0":"Gardien","c1":"Droit","c2":"Réflexes","c3":"Bastard München","c4":"Non","c5":"Noir"}}]},"fma":{"name":"Fullmetal Alchemist","categories":[{"key":"c0","label":"Nature","type":"text"},{"key":"c1","label":"Affiliation","type":"text"},{"key":"c2","label":"Alchimiste d'État","type":"text"},{"key":"c3","label":"Type d'alchimie","type":"text"},{"key":"c4","label":"Pierre philosophale","type":"text"},{"key":"c5","label":"Cheveux","type":"text"}],"characters":[{"name":"Edward Elric","attrs":{"c0":"Humain","c1":"Amestris","c2":"Oui","c3":"Transmutation sans cercle","c4":"Non","c5":"Blond"}},{"name":"Alphonse Elric","attrs":{"c0":"Âme/Armure","c1":"Amestris","c2":"Non","c3":"Transmutation sans cercle","c4":"Non","c5":"Aucun"}},{"name":"Roy Mustang","attrs":{"c0":"Humain","c1":"Armée","c2":"Oui","c3":"Flamme","c4":"Non","c5":"Noir"}},{"name":"Riza Hawkeye","attrs":{"c0":"Humaine","c1":"Armée","c2":"Non","c3":"Aucune","c4":"Non","c5":"Blond"}},{"name":"Scar","attrs":{"c0":"Humain","c1":"Ishval","c2":"Non","c3":"Déconstruction","c4":"Bras pierre","c5":"Blanc"}},{"name":"Winry Rockbell","attrs":{"c0":"Humaine","c1":"Resembool","c2":"Non","c3":"Aucune","c4":"Non","c5":"Blond"}},{"name":"King Bradley","attrs":{"c0":"Homunculus","c1":"Armée","c2":"Non","c3":"Aucune","c4":"Oui","c5":"Noir"}},{"name":"Greed","attrs":{"c0":"Homunculus","c1":"Homunculi","c2":"Non","c3":"Bouclier ultime","c4":"Oui","c5":"Noir"}},{"name":"Envy","attrs":{"c0":"Homunculus","c1":"Homunculi","c2":"Non","c3":"Métamorphose","c4":"Oui","c5":"Vert"}},{"name":"Father","attrs":{"c0":"Homunculus","c1":"Homunculi","c2":"Non","c3":"Alchimie avancée","c4":"Oui","c5":"Blanc"}}]},"chainsaw":{"name":"Chainsaw Man","categories":[{"key":"c0","label":"Nature","type":"text"},{"key":"c1","label":"Affiliation","type":"text"},{"key":"c2","label":"Démon associé","type":"text"},{"key":"c3","label":"Hybride","type":"text"},{"key":"c4","label":"Sexe","type":"text"},{"key":"c5","label":"Cheveux","type":"text"}],"characters":[{"name":"Denji","attrs":{"c0":"Hybride","c1":"Public Safety","c2":"Chainsaw","c3":"Oui","c4":"Homme","c5":"Blond"}},{"name":"Power","attrs":{"c0":"Fiend","c1":"Public Safety","c2":"Blood","c3":"Non","c4":"Femme","c5":"Blond"}},{"name":"Aki Hayakawa","attrs":{"c0":"Humain/Fiend","c1":"Public Safety","c2":"Fox/Curse/Future","c3":"Non","c4":"Homme","c5":"Noir"}},{"name":"Makima","attrs":{"c0":"Démon","c1":"Public Safety","c2":"Control","c3":"Non","c4":"Femme","c5":"Rouge"}},{"name":"Kobeni Higashiyama","attrs":{"c0":"Humaine","c1":"Public Safety","c2":"Inconnu","c3":"Non","c4":"Femme","c5":"Noir"}},{"name":"Himeno","attrs":{"c0":"Humaine","c1":"Public Safety","c2":"Ghost","c3":"Non","c4":"Femme","c5":"Noir"}},{"name":"Reze","attrs":{"c0":"Hybride","c1":"URSS","c2":"Bomb","c3":"Oui","c4":"Femme","c5":"Violet"}},{"name":"Katana Man","attrs":{"c0":"Hybride","c1":"Yakuza","c2":"Katana","c3":"Oui","c4":"Homme","c5":"Noir"}},{"name":"Angel Devil","attrs":{"c0":"Démon","c1":"Public Safety","c2":"Angel","c3":"Non","c4":"Homme","c5":"Rouge"}},{"name":"Pochita","attrs":{"c0":"Démon","c1":"Denji","c2":"Chainsaw","c3":"Non","c4":"Mâle","c5":"Orange"}}]},"wakfu":{"name":"Wakfu","categories":[{"key":"c0","label":"Race/Classe","type":"text"},{"key":"c1","label":"Groupe","type":"text"},{"key":"c2","label":"Élément/Énergie","type":"text"},{"key":"c3","label":"Arme","type":"text"},{"key":"c4","label":"Sexe","type":"text"},{"key":"c5","label":"Cheveux","type":"text"}],"characters":[{"name":"Yugo","attrs":{"c0":"Eliatrope","c1":"Confrérie du Tofu","c2":"Wakfu","c3":"Portails","c4":"Homme","c5":"Bleu"}},{"name":"Tristepin de Percedal","attrs":{"c0":"Iop","c1":"Confrérie du Tofu","c2":"Force","c3":"Épée/Shushu","c4":"Homme","c5":"Roux"}},{"name":"Amalia Sheran Sharm","attrs":{"c0":"Sadida","c1":"Confrérie du Tofu","c2":"Nature","c3":"Poupées","c4":"Femme","c5":"Vert"}},{"name":"Evangelyne","attrs":{"c0":"Cra","c1":"Confrérie du Tofu","c2":"Flèches","c3":"Arc","c4":"Femme","c5":"Blond"}},{"name":"Ruel Stroud","attrs":{"c0":"Enutrof","c1":"Confrérie du Tofu","c2":"Terre","c3":"Pelle","c4":"Homme","c5":"Blanc"}},{"name":"Adamai","attrs":{"c0":"Dragon","c1":"Eliatropes","c2":"Wakfu","c3":"Transformation","c4":"Homme","c5":"Blanc"}},{"name":"Qilby","attrs":{"c0":"Eliatrope","c1":"Eliatropes","c2":"Wakfu","c3":"Portails","c4":"Homme","c5":"Blanc"}},{"name":"Nox","attrs":{"c0":"Xelor","c1":"Seul","c2":"Wakfu","c3":"Temps","c4":"Homme","c5":"Bleu"}},{"name":"Oropo","attrs":{"c0":"Eliotrope","c1":"Fratrie des Oubliés","c2":"Wakfu","c3":"Portails","c4":"Homme","c5":"Noir"}},{"name":"Goultard","attrs":{"c0":"Iop/Demi-dieu","c1":"Iops","c2":"Force","c3":"Épée","c4":"Homme","c5":"Noir"}}]},"demonslayer":{"name":"Demon Slayer","categories":[{"key":"c0","label":"Camp","type":"text"},{"key":"c1","label":"Rang","type":"text"},{"key":"c2","label":"Souffle/Art","type":"text"},{"key":"c3","label":"Pilier","type":"text"},{"key":"c4","label":"Démon","type":"text"},{"key":"c5","label":"Cheveux","type":"text"}],"characters":[{"name":"Tanjiro Kamado","attrs":{"c0":"Pourfendeurs","c1":"Kinoe","c2":"Eau/Soleil","c3":"Non","c4":"Non","c5":"Rouge/Noir"}},{"name":"Nezuko Kamado","attrs":{"c0":"Démons","c1":"—","c2":"Art du sang","c3":"Non","c4":"Oui","c5":"Noir"}},{"name":"Zenitsu Agatsuma","attrs":{"c0":"Pourfendeurs","c1":"Kinoe","c2":"Foudre","c3":"Non","c4":"Non","c5":"Jaune"}},{"name":"Inosuke Hashibira","attrs":{"c0":"Pourfendeurs","c1":"Kinoe","c2":"Bête","c3":"Non","c4":"Non","c5":"Noir/Bleu"}},{"name":"Giyu Tomioka","attrs":{"c0":"Pourfendeurs","c1":"Hashira","c2":"Eau","c3":"Oui","c4":"Non","c5":"Noir"}},{"name":"Kyojuro Rengoku","attrs":{"c0":"Pourfendeurs","c1":"Hashira","c2":"Flamme","c3":"Oui","c4":"Non","c5":"Jaune/Rouge"}},{"name":"Shinobu Kocho","attrs":{"c0":"Pourfendeurs","c1":"Hashira","c2":"Insecte","c3":"Oui","c4":"Non","c5":"Noir/Violet"}},{"name":"Muzan Kibutsuji","attrs":{"c0":"Démons","c1":"Roi","c2":"Art du sang","c3":"Non","c4":"Oui","c5":"Noir"}},{"name":"Kokushibo","attrs":{"c0":"Démons","c1":"Lune sup. 1","c2":"Lune","c3":"Non","c4":"Oui","c5":"Noir/Rouge"}},{"name":"Akaza","attrs":{"c0":"Démons","c1":"Lune sup. 3","c2":"Destruction","c3":"Non","c4":"Oui","c5":"Rose"}}]},"pokemon":{"name":"Pokémon","categories":[{"key":"c0","label":"Type 1","type":"text"},{"key":"c1","label":"Type 2","type":"text"},{"key":"c2","label":"Génération","type":"text"},{"key":"c3","label":"Légendaire","type":"text"},{"key":"c4","label":"Évolution","type":"text"},{"key":"c5","label":"Couleur dominante","type":"text"}],"characters":[{"name":"Pikachu","attrs":{"c0":"Électrik","c1":"—","c2":"1","c3":"Non","c4":"Évolue","c5":"Jaune"}},{"name":"Dracaufeu","attrs":{"c0":"Feu","c1":"Vol","c2":"1","c3":"Non","c4":"Finale","c5":"Orange"}},{"name":"Bulbizarre","attrs":{"c0":"Plante","c1":"Poison","c2":"1","c3":"Non","c4":"Base","c5":"Vert"}},{"name":"Carapuce","attrs":{"c0":"Eau","c1":"—","c2":"1","c3":"Non","c4":"Base","c5":"Bleu"}},{"name":"Ectoplasma","attrs":{"c0":"Spectre","c1":"Poison","c2":"1","c3":"Non","c4":"Finale","c5":"Violet"}},{"name":"Mewtwo","attrs":{"c0":"Psy","c1":"—","c2":"1","c3":"Oui","c4":"Unique","c5":"Violet"}},{"name":"Lucario","attrs":{"c0":"Combat","c1":"Acier","c2":"4","c3":"Non","c4":"Finale","c5":"Bleu"}},{"name":"Gardevoir","attrs":{"c0":"Psy","c1":"Fée","c2":"3","c3":"Non","c4":"Finale","c5":"Blanc/Vert"}},{"name":"Dracolosse","attrs":{"c0":"Dragon","c1":"Vol","c2":"1","c3":"Non","c4":"Finale","c5":"Orange"}},{"name":"Amphinobi","attrs":{"c0":"Eau","c1":"Ténèbres","c2":"6","c3":"Non","c4":"Finale","c5":"Bleu"}},{"name":"Rayquaza","attrs":{"c0":"Dragon","c1":"Vol","c2":"3","c3":"Oui","c4":"Unique","c5":"Vert"}},{"name":"Arceus","attrs":{"c0":"Normal","c1":"—","c2":"4","c3":"Mythique","c4":"Unique","c5":"Blanc"}}]},"dragonball":{"name":"Dragon Ball","categories":[{"key":"c0","label":"Race","type":"text"},{"key":"c1","label":"Camp","type":"text"},{"key":"c2","label":"Transformation","type":"text"},{"key":"c3","label":"Univers","type":"text"},{"key":"c4","label":"Fusion","type":"text"},{"key":"c5","label":"Cheveux base","type":"text"}],"characters":[{"name":"Son Goku","attrs":{"c0":"Saiyan","c1":"Héros","c2":"Ultra Instinct","c3":"7","c4":"Non","c5":"Noir"}},{"name":"Vegeta","attrs":{"c0":"Saiyan","c1":"Héros","c2":"Ultra Ego","c3":"7","c4":"Non","c5":"Noir"}},{"name":"Son Gohan","attrs":{"c0":"Demi-Saiyan","c1":"Héros","c2":"Beast","c3":"7","c4":"Non","c5":"Noir"}},{"name":"Piccolo","attrs":{"c0":"Namek","c1":"Héros","c2":"Orange Piccolo","c3":"7","c4":"Non","c5":"Vert"}},{"name":"Freezer","attrs":{"c0":"Race de Freezer","c1":"Ennemi","c2":"Black Freezer","c3":"7","c4":"Non","c5":"Aucun"}},{"name":"Cell","attrs":{"c0":"Bio-androïde","c1":"Ennemi","c2":"Perfect","c3":"7","c4":"Non","c5":"Aucun"}},{"name":"Majin Buu","attrs":{"c0":"Majin","c1":"Variable","c2":"Formes multiples","c3":"7","c4":"Non","c5":"Aucun"}},{"name":"Beerus","attrs":{"c0":"Dieu","c1":"Neutre","c2":"Dieu de la destruction","c3":"7","c4":"Non","c5":"Aucun"}},{"name":"Jiren","attrs":{"c0":"Alien","c1":"Pride Troopers","c2":"Full Power","c3":"11","c4":"Non","c5":"Aucun"}},{"name":"Broly","attrs":{"c0":"Saiyan","c1":"Héros","c2":"Super Saiyan Full Power","c3":"7","c4":"Non","c5":"Noir"}},{"name":"Gogeta","attrs":{"c0":"Fusion Saiyan","c1":"Héros","c2":"Super Saiyan Blue","c3":"7","c4":"Oui","c5":"Noir"}},{"name":"Vegito","attrs":{"c0":"Fusion Saiyan","c1":"Héros","c2":"Super Saiyan Blue","c3":"7","c4":"Oui","c5":"Noir"}}]},"hellsparadise":{"name":"Hell's Paradise","categories":[{"key":"c0","label":"Camp","type":"text"},{"key":"c1","label":"Statut","type":"text"},{"key":"c2","label":"Tao","type":"text"},{"key":"c3","label":"Arme","type":"text"},{"key":"c4","label":"Sexe","type":"text"},{"key":"c5","label":"Cheveux","type":"text"}],"characters":[{"name":"Gabimaru","attrs":{"c0":"Condamnés","c1":"Shinobi","c2":"Feu","c3":"Ninjutsu","c4":"Homme","c5":"Blanc"}},{"name":"Yamada Asaemon Sagiri","attrs":{"c0":"Asaemon","c1":"Exécuteur","c2":"Bois","c3":"Katana","c4":"Femme","c5":"Noir"}},{"name":"Yuzuriha","attrs":{"c0":"Condamnée","c1":"Kunoichi","c2":"Terre","c3":"Ninjutsu","c4":"Femme","c5":"Violet"}},{"name":"Aza Chobei","attrs":{"c0":"Condamné","c1":"Bandit","c2":"Métal","c3":"Combat","c4":"Homme","c5":"Blond"}},{"name":"Aza Toma","attrs":{"c0":"Asaemon","c1":"Exécuteur","c2":"Bois","c3":"Katana","c4":"Homme","c5":"Blond"}},{"name":"Yamada Asaemon Shion","attrs":{"c0":"Asaemon","c1":"Exécuteur","c2":"Bois","c3":"Katana","c4":"Homme","c5":"Noir"}},{"name":"Yamada Asaemon Tenza","attrs":{"c0":"Asaemon","c1":"Exécuteur","c2":"Bois","c3":"Katana","c4":"Homme","c5":"Blond"}},{"name":"Tamiya Gantetsusai","attrs":{"c0":"Condamné","c1":"Samouraï","c2":"Feu","c3":"Katana","c4":"Homme","c5":"Noir"}},{"name":"Rien","attrs":{"c0":"Tensen","c1":"Chef","c2":"Tao","c3":"Tao","c4":"Femme","c5":"Blanc"}},{"name":"Mei","attrs":{"c0":"Tensen","c1":"Enfant","c2":"Tao","c3":"Tao","c4":"Femme","c5":"Rose"}}]},"gachiakuta":{"name":"Gachiakuta","categories":[{"key":"c0","label":"Camp","type":"text"},{"key":"c1","label":"Rôle","type":"text"},{"key":"c2","label":"Jinki","type":"text"},{"key":"c3","label":"Type de Jinki","type":"text"},{"key":"c4","label":"Origine","type":"text"},{"key":"c5","label":"Cheveux","type":"text"}],"characters":[{"name":"Rudo Surebrec","attrs":{"c0":"Cleaners","c1":"Giver","c2":"3R","c3":"Gants","c4":"Sphère","c5":"Noir/Blanc"}},{"name":"Enjin","attrs":{"c0":"Cleaners","c1":"Giver","c2":"Umbreaker","c3":"Parapluie","c4":"Ground","c5":"Blond"}},{"name":"Zanka Nijiku","attrs":{"c0":"Cleaners","c1":"Giver","c2":"Lovely Assistaff","c3":"Bâton","c4":"Ground","c5":"Noir"}},{"name":"Riyo Reaper","attrs":{"c0":"Cleaners","c1":"Giver","c2":"The Ripper","c3":"Ciseaux","c4":"Ground","c5":"Blond"}},{"name":"Jabber Wonger","attrs":{"c0":"Raiders","c1":"Giver","c2":"Mankira","c3":"Anneaux/griffes","c4":"Ground","c5":"Noir"}},{"name":"Zodyl Typhon","attrs":{"c0":"Raiders","c1":"Chef","c2":"Mishra","c3":"Manteau","c4":"Ground","c5":"Noir"}},{"name":"Tamsy Caines","attrs":{"c0":"Cleaners","c1":"Giver","c2":"Tokushin","c3":"Fuseau/fil","c4":"Ground","c5":"Blond"}},{"name":"Semiu Grier","attrs":{"c0":"Cleaners","c1":"Support","c2":"Eyes","c3":"Lunettes","c4":"Ground","c5":"Noir"}},{"name":"Regto Surebrec","attrs":{"c0":"Sphère","c1":"Tuteur","c2":"Inconnu","c3":"Inconnu","c4":"Sphère","c5":"Blanc"}},{"name":"Amo Empool","attrs":{"c0":"Indépendante","c1":"Giver","c2":"Inconnu","c3":"Bottes","c4":"Ground","c5":"Blond"}}]},"haikyuu":{"name":"Haikyuu","categories":[{"key":"c0","label":"Équipe lycée","type":"text"},{"key":"c1","label":"Poste","type":"text"},{"key":"c2","label":"Année","type":"text"},{"key":"c3","label":"Numéro","type":"text"},{"key":"c4","label":"Main dominante","type":"text"},{"key":"c5","label":"Cheveux","type":"text"}],"characters":[{"name":"Shoyo Hinata","attrs":{"c0":"Karasuno","c1":"Central","c2":"1re","c3":"10","c4":"Droite","c5":"Orange"}},{"name":"Tobio Kageyama","attrs":{"c0":"Karasuno","c1":"Passeur","c2":"1re","c3":"9","c4":"Droite","c5":"Noir"}},{"name":"Kei Tsukishima","attrs":{"c0":"Karasuno","c1":"Central","c2":"1re","c3":"11","c4":"Droite","c5":"Blond"}},{"name":"Yu Nishinoya","attrs":{"c0":"Karasuno","c1":"Libéro","c2":"2e","c3":"4","c4":"Droite","c5":"Noir/Blond"}},{"name":"Toru Oikawa","attrs":{"c0":"Aoba Johsai","c1":"Passeur","c2":"3e","c3":"1","c4":"Droite","c5":"Brun"}},{"name":"Wakatoshi Ushijima","attrs":{"c0":"Shiratorizawa","c1":"Opposé","c2":"3e","c3":"1","c4":"Gauche","c5":"Brun"}},{"name":"Kotaro Bokuto","attrs":{"c0":"Fukurodani","c1":"Ailier","c2":"3e","c3":"4","c4":"Droite","c5":"Noir/Blanc"}},{"name":"Kenma Kozume","attrs":{"c0":"Nekoma","c1":"Passeur","c2":"2e","c3":"5","c4":"Droite","c5":"Blond/Noir"}},{"name":"Tetsuro Kuroo","attrs":{"c0":"Nekoma","c1":"Central","c2":"3e","c3":"1","c4":"Droite","c5":"Noir"}},{"name":"Atsumu Miya","attrs":{"c0":"Inarizaki","c1":"Passeur","c2":"2e","c3":"7","c4":"Droite","c5":"Blond"}},{"name":"Osamu Miya","attrs":{"c0":"Inarizaki","c1":"Opposé","c2":"2e","c3":"11","c4":"Droite","c5":"Gris"}},{"name":"Kiyoomi Sakusa","attrs":{"c0":"Itachiyama","c1":"Ailier","c2":"2e","c3":"10","c4":"Droite","c5":"Noir"}}]},"jjk":{"name":"Jujutsu Kaisen","categories":[{"key":"c0","label":"Camp","type":"text"},{"key":"c1","label":"Grade","type":"text"},{"key":"c2","label":"Technique","type":"text"},{"key":"c3","label":"Extension domaine","type":"text"},{"key":"c4","label":"Énergie maudite","type":"text"},{"key":"c5","label":"Cheveux","type":"text"}],"characters":[{"name":"Yuji Itadori","attrs":{"c0":"Exorcistes","c1":"Spécial potentiel","c2":"Corps à corps/Shrine","c3":"Oui","c4":"Oui","c5":"Rose"}},{"name":"Megumi Fushiguro","attrs":{"c0":"Exorcistes","c1":"Grade 2","c2":"Ten Shadows","c3":"Oui","c4":"Oui","c5":"Noir"}},{"name":"Nobara Kugisaki","attrs":{"c0":"Exorcistes","c1":"Grade 3","c2":"Straw Doll","c3":"Non","c4":"Oui","c5":"Orange"}},{"name":"Satoru Gojo","attrs":{"c0":"Exorcistes","c1":"Spécial","c2":"Limitless/Six Eyes","c3":"Oui","c4":"Oui","c5":"Blanc"}},{"name":"Yuta Okkotsu","attrs":{"c0":"Exorcistes","c1":"Spécial","c2":"Copie/Rika","c3":"Oui","c4":"Oui","c5":"Noir"}},{"name":"Maki Zenin","attrs":{"c0":"Exorcistes","c1":"Grade 4/élite","c2":"Restriction céleste","c3":"Non","c4":"Quasi nulle","c5":"Vert"}},{"name":"Suguru Geto","attrs":{"c0":"Fléau utilisateur","c1":"Spécial","c2":"Manipulation des fléaux","c3":"Oui","c4":"Oui","c5":"Noir"}},{"name":"Ryomen Sukuna","attrs":{"c0":"Fléau","c1":"Spécial","c2":"Shrine","c3":"Oui","c4":"Oui","c5":"Rose"}},{"name":"Mahito","attrs":{"c0":"Fléau","c1":"Spécial","c2":"Idle Transfiguration","c3":"Oui","c4":"Oui","c5":"Bleu"}},{"name":"Kento Nanami","attrs":{"c0":"Exorcistes","c1":"Grade 1","c2":"Ratio","c3":"Non","c4":"Oui","c5":"Blond"}},{"name":"Toji Fushiguro","attrs":{"c0":"Indépendant","c1":"Sans grade","c2":"Restriction céleste","c3":"Non","c4":"Nulle","c5":"Noir"}},{"name":"Aoi Todo","attrs":{"c0":"Exorcistes","c1":"Grade 1","c2":"Boogie Woogie","c3":"Non","c4":"Oui","c5":"Noir"}}]},"jojo":{"name":"JoJo","categories":[{"key":"c0","label":"Partie","type":"text"},{"key":"c1","label":"Camp","type":"text"},{"key":"c2","label":"Stand","type":"text"},{"key":"c3","label":"Type de Stand","type":"text"},{"key":"c4","label":"Hamon","type":"text"},{"key":"c5","label":"Famille Joestar","type":"text"}],"characters":[{"name":"Jonathan Joestar","attrs":{"c0":"1","c1":"Héros","c2":"Aucun","c3":"—","c4":"Oui","c5":"Oui"}},{"name":"Joseph Joestar","attrs":{"c0":"2/3","c1":"Héros","c2":"Hermit Purple","c3":"Distance","c4":"Oui","c5":"Oui"}},{"name":"Jotaro Kujo","attrs":{"c0":"3/4/6","c1":"Héros","c2":"Star Platinum","c3":"Courte portée","c4":"Non","c5":"Oui"}},{"name":"Josuke Higashikata","attrs":{"c0":"4","c1":"Héros","c2":"Crazy Diamond","c3":"Courte portée","c4":"Non","c5":"Oui"}},{"name":"Giorno Giovanna","attrs":{"c0":"5","c1":"Héros","c2":"Gold Experience","c3":"Courte portée","c4":"Non","c5":"Oui"}},{"name":"Jolyne Cujoh","attrs":{"c0":"6","c1":"Héros","c2":"Stone Free","c3":"Courte portée","c4":"Non","c5":"Oui"}},{"name":"Dio Brando","attrs":{"c0":"1/3","c1":"Ennemi","c2":"The World","c3":"Courte portée","c4":"Non","c5":"Non"}},{"name":"Yoshikage Kira","attrs":{"c0":"4","c1":"Ennemi","c2":"Killer Queen","c3":"Courte portée","c4":"Non","c5":"Non"}},{"name":"Diavolo","attrs":{"c0":"5","c1":"Ennemi","c2":"King Crimson","c3":"Courte portée","c4":"Non","c5":"Non"}},{"name":"Enrico Pucci","attrs":{"c0":"6","c1":"Ennemi","c2":"Made in Heaven","c3":"Évolutif","c4":"Non","c5":"Non"}},{"name":"Bruno Bucciarati","attrs":{"c0":"5","c1":"Héros","c2":"Sticky Fingers","c3":"Courte portée","c4":"Non","c5":"Non"}},{"name":"Jean Pierre Polnareff","attrs":{"c0":"3/5","c1":"Héros","c2":"Silver Chariot","c3":"Courte portée","c4":"Non","c5":"Non"}}]},"tensura":{"name":"Tensura","categories":[{"key":"c0","label":"Race","type":"text"},{"key":"c1","label":"Affiliation","type":"text"},{"key":"c2","label":"Rang","type":"text"},{"key":"c3","label":"Compétence ultime","type":"text"},{"key":"c4","label":"Demon Lord","type":"text"},{"key":"c5","label":"Cheveux","type":"text"}],"characters":[{"name":"Rimuru Tempest","attrs":{"c0":"Slime/True Dragon","c1":"Tempest","c2":"Demon Lord","c3":"Raphael/Azathoth","c4":"Oui","c5":"Bleu"}},{"name":"Veldora Tempest","attrs":{"c0":"True Dragon","c1":"Tempest","c2":"True Dragon","c3":"Faust","c4":"Non","c5":"Blond"}},{"name":"Milim Nava","attrs":{"c0":"Dragonoid","c1":"Octagram","c2":"Demon Lord","c3":"Satanael","c4":"Oui","c5":"Rose"}},{"name":"Diablo","attrs":{"c0":"Démon primordial","c1":"Tempest","c2":"Demon Peer","c3":"Azazel","c4":"Non","c5":"Noir"}},{"name":"Benimaru","attrs":{"c0":"Ogre/Kijin","c1":"Tempest","c2":"Général","c3":"Amaterasu","c4":"Non","c5":"Rouge"}},{"name":"Shion","attrs":{"c0":"Ogre/Kijin","c1":"Tempest","c2":"Secrétaire","c3":"Susanoo","c4":"Non","c5":"Violet"}},{"name":"Guy Crimson","attrs":{"c0":"Démon primordial","c1":"Octagram","c2":"Demon Lord","c3":"Lucifer","c4":"Oui","c5":"Rouge"}},{"name":"Luminous Valentine","attrs":{"c0":"Vampire","c1":"Lubelius","c2":"Demon Lord","c3":"Asmodeus","c4":"Oui","c5":"Argent"}},{"name":"Hinata Sakaguchi","attrs":{"c0":"Humaine","c1":"Église","c2":"Saint","c3":"Fortuna","c4":"Non","c5":"Bleu"}},{"name":"Gobta","attrs":{"c0":"Hobgoblin","c1":"Tempest","c2":"Capitaine","c3":"Inconnu","c4":"Non","c5":"Noir"}}]},"opm":{"name":"One Punch Man","categories":[{"key":"c0","label":"Camp","type":"text"},{"key":"c1","label":"Classe héros","type":"text"},{"key":"c2","label":"Rang","type":"text"},{"key":"c3","label":"Pouvoir/Style","type":"text"},{"key":"c4","label":"Cyborg","type":"text"},{"key":"c5","label":"Cheveux","type":"text"}],"characters":[{"name":"Saitama","attrs":{"c0":"Héros","c1":"Classe A (ex-B/C)","c2":"39","c3":"Force physique","c4":"Non","c5":"Chauve"}},{"name":"Genos","attrs":{"c0":"Héros","c1":"Classe S","c2":"14","c3":"Cyborg/incinération","c4":"Oui","c5":"Blond"}},{"name":"Tatsumaki","attrs":{"c0":"Héros","c1":"Classe S","c2":"2","c3":"Télékinésie","c4":"Non","c5":"Vert"}},{"name":"Bang","attrs":{"c0":"Héros","c1":"Classe S","c2":"3","c3":"Arts martiaux","c4":"Non","c5":"Blanc"}},{"name":"King","attrs":{"c0":"Héros","c1":"Classe S","c2":"7","c3":"Réputation","c4":"Non","c5":"Blond"}},{"name":"Fubuki","attrs":{"c0":"Héros","c1":"Classe B","c2":"1","c3":"Télékinésie","c4":"Non","c5":"Vert"}},{"name":"Garou","attrs":{"c0":"Monstre/Humain","c1":"—","c2":"—","c3":"Arts martiaux/copie","c4":"Non","c5":"Argent"}},{"name":"Boros","attrs":{"c0":"Monstre","c1":"—","c2":"—","c3":"Énergie/régénération","c4":"Non","c5":"Rose"}},{"name":"Mumen Rider","attrs":{"c0":"Héros","c1":"Classe C","c2":"1","c3":"Cyclisme/courage","c4":"Non","c5":"Brun"}},{"name":"Flashy Flash","attrs":{"c0":"Héros","c1":"Classe S","c2":"13","c3":"Vitesse/épée","c4":"Non","c5":"Blond"}}]},"sao":{"name":"Sword Art Online","categories":[{"key":"c0","label":"Jeu principal","type":"text"},{"key":"c1","label":"Race/Avatar","type":"text"},{"key":"c2","label":"Arme","type":"text"},{"key":"c3","label":"Guilde","type":"text"},{"key":"c4","label":"Sexe","type":"text"},{"key":"c5","label":"Cheveux avatar","type":"text"}],"characters":[{"name":"Kirito","attrs":{"c0":"SAO","c1":"Humain","c2":"Épées doubles","c3":"Solo","c4":"Homme","c5":"Noir"}},{"name":"Asuna Yuuki","attrs":{"c0":"SAO","c1":"Humaine","c2":"Rapière","c3":"Knights of Blood","c4":"Femme","c5":"Châtain"}},{"name":"Sinon","attrs":{"c0":"GGO","c1":"Humaine","c2":"Fusil","c3":"Solo","c4":"Femme","c5":"Bleu"}},{"name":"Leafa","attrs":{"c0":"ALO","c1":"Sylphe","c2":"Épée","c3":"Sylphes","c4":"Femme","c5":"Blond"}},{"name":"Klein","attrs":{"c0":"SAO","c1":"Humain","c2":"Katana","c3":"Fuurinkazan","c4":"Homme","c5":"Rouge"}},{"name":"Agil","attrs":{"c0":"SAO","c1":"Humain","c2":"Hache","c3":"Marchand","c4":"Homme","c5":"Chauve"}},{"name":"Yuuki Konno","attrs":{"c0":"ALO","c1":"Imp","c2":"Épée","c3":"Sleeping Knights","c4":"Femme","c5":"Violet"}},{"name":"Alice Zuberg","attrs":{"c0":"Underworld","c1":"Integrity Knight","c2":"Épée","c3":"Axiom Church","c4":"Femme","c5":"Blond"}},{"name":"Eugeo","attrs":{"c0":"Underworld","c1":"Humain","c2":"Blue Rose Sword","c3":"Axiom Church","c4":"Homme","c5":"Blond"}},{"name":"Heathcliff","attrs":{"c0":"SAO","c1":"Humain","c2":"Épée+bouclier","c3":"Knights of Blood","c4":"Homme","c5":"Rouge"}}]},"tokyoghoul":{"name":"Tokyo Ghoul","categories":[{"key":"c0","label":"Nature","type":"text"},{"key":"c1","label":"Affiliation","type":"text"},{"key":"c2","label":"Type de kagune","type":"text"},{"key":"c3","label":"Kakuja","type":"text"},{"key":"c4","label":"CCG rang","type":"text"},{"key":"c5","label":"Cheveux","type":"text"}],"characters":[{"name":"Ken Kaneki","attrs":{"c0":"Ghoul artificiel","c1":"Anteiku/Goat","c2":"Rinkaku","c3":"Oui","c4":"—","c5":"Noir/Blanc"}},{"name":"Touka Kirishima","attrs":{"c0":"Ghoul","c1":"Anteiku/Goat","c2":"Ukaku","c3":"Non","c4":"—","c5":"Bleu"}},{"name":"Kishou Arima","attrs":{"c0":"Humain","c1":"CCG","c2":"Aucun","c3":"Non","c4":"Spécial","c5":"Blanc"}},{"name":"Juuzou Suzuya","attrs":{"c0":"Humain","c1":"CCG","c2":"Aucun","c3":"Non","c4":"Spécial","c5":"Blanc"}},{"name":"Eto Yoshimura","attrs":{"c0":"Demi-ghoul","c1":"Aogiri","c2":"Ukaku","c3":"Oui","c4":"—","c5":"Vert"}},{"name":"Shu Tsukiyama","attrs":{"c0":"Ghoul","c1":"Ghoul Restaurant","c2":"Koukaku","c3":"Non","c4":"—","c5":"Violet"}},{"name":"Hinami Fueguchi","attrs":{"c0":"Ghoul","c1":"Anteiku/Goat","c2":"Rinkaku/Koukaku","c3":"Non","c4":"—","c5":"Brun"}},{"name":"Ayato Kirishima","attrs":{"c0":"Ghoul","c1":"Aogiri","c2":"Ukaku","c3":"Non","c4":"—","c5":"Bleu"}},{"name":"Kotaro Amon","attrs":{"c0":"Humain/Ghoul artificiel","c1":"CCG","c2":"Koukaku","c3":"Oui","c4":"Premier","c5":"Noir"}},{"name":"Nishiki Nishio","attrs":{"c0":"Ghoul","c1":"Anteiku","c2":"Bikaku","c3":"Non","c4":"—","c5":"Brun"}}]},"tokyorevengers":{"name":"Tokyo Revengers","categories":[{"key":"c0","label":"Gang","type":"text"},{"key":"c1","label":"Rôle","type":"text"},{"key":"c2","label":"Division","type":"text"},{"key":"c3","label":"Voyageur temporel","type":"text"},{"key":"c4","label":"Sexe","type":"text"},{"key":"c5","label":"Cheveux","type":"text"}],"characters":[{"name":"Takemichi Hanagaki","attrs":{"c0":"Toman","c1":"Membre/Président futur","c2":"1re","c3":"Oui","c4":"Homme","c5":"Blond"}},{"name":"Manjiro Sano","attrs":{"c0":"Toman","c1":"Président","c2":"—","c3":"Non","c4":"Homme","c5":"Blond"}},{"name":"Ken Ryuguji","attrs":{"c0":"Toman","c1":"Vice-président","c2":"—","c3":"Non","c4":"Homme","c5":"Blond"}},{"name":"Keisuke Baji","attrs":{"c0":"Toman","c1":"Capitaine","c2":"1re","c3":"Non","c4":"Homme","c5":"Noir"}},{"name":"Chifuyu Matsuno","attrs":{"c0":"Toman","c1":"Vice-capitaine","c2":"1re","c3":"Non","c4":"Homme","c5":"Blond"}},{"name":"Takashi Mitsuya","attrs":{"c0":"Toman","c1":"Capitaine","c2":"2e","c3":"Non","c4":"Homme","c5":"Lavande"}},{"name":"Kazutora Hanemiya","attrs":{"c0":"Valhalla","c1":"Membre","c2":"—","c3":"Non","c4":"Homme","c5":"Noir/Jaune"}},{"name":"Tetta Kisaki","attrs":{"c0":"Toman/Tenjiku","c1":"Capitaine","c2":"3e","c3":"Non","c4":"Homme","c5":"Blond"}},{"name":"Izana Kurokawa","attrs":{"c0":"Tenjiku","c1":"Président","c2":"—","c3":"Non","c4":"Homme","c5":"Blanc"}},{"name":"Taiju Shiba","attrs":{"c0":"Black Dragons","c1":"Président","c2":"—","c3":"Non","c4":"Homme","c5":"Bleu/Blanc"}}]}};

function normalizeDle(s) {
    return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function dleBaseUniverse(key) {
    return DLE_UNIVERSES[key] || DLE_UNIVERSES.naruto;
}

function dleNameMeta(name) {
    const compact = String(name || '').replace(/[^A-Za-zÀ-ÿ0-9]/g, '');
    const words = String(name || '').trim().split(/\s+/).filter(Boolean);
    const letters = [...compact];
    return {
        __initial: letters.length ? letters[0].toUpperCase() : '?',
        __last: letters.length ? letters[letters.length - 1].toUpperCase() : '?',
        __len: letters.length,
        __words: words.length
    };
}


/* ================= AnimeDLE V5 — expansion massive =================
   IMPORTANT :
   - Les catégories thématiques de la V2 restent STRICTEMENT inchangées.
   - On agrège les gros pools locaux + plusieurs sources publiques par univers.
   - Aucun univers n'est mélangé avec un autre.
   - Si Internet est indisponible, le jeu retombe proprement sur les pools locaux.
===================================================================== */

const DLE_LIVE_POOLS = Object.fromEntries(Object.keys(DLE_UNIVERSES).map(k => [k, new Set()]));
let dleLiveExpansionReady = false;
let dleLiveExpansionStarted = false;
let dleLiveExpansionPromise = null;

const DLE_FANDOM_SOURCES = {
    naruto:          [{ host:'naruto.fandom.com', category:'Characters' }],
    onepiece:        [{ host:'onepiece.fandom.com', category:'Characters' }],
    bleach:          [{ host:'bleach.fandom.com', category:'Characters' }],
    hxh:             [{ host:'hunterxhunter.fandom.com', category:'Characters' }],
    snk:             [{ host:'attackontitan.fandom.com', category:'Characters' }],
    sds:             [{ host:'nanatsu-no-taizai.fandom.com', category:'Characters' }],
    deathnote:       [{ host:'deathnote.fandom.com', category:'Characters' }],
    cote:            [{ host:'you-zitsu.fandom.com', category:'Characters' }],
    solo:            [{ host:'solo-leveling.fandom.com', category:'Characters' }],
    clover:          [{ host:'blackclover.fandom.com', category:'Characters' }],
    fireforce:       [{ host:'fire-force.fandom.com', category:'Characters' }],
    mushoku:         [{ host:'mushokutensei.fandom.com', category:'Characters' }],
    rezero:          [{ host:'rezero.fandom.com', category:'Characters' }],
    fairy:           [{ host:'fairytail.fandom.com', category:'Characters' }],
    bluelock:        [{ host:'bluelock.fandom.com', category:'Characters' }],
    fma:             [{ host:'fma.fandom.com', category:'Characters' }],
    chainsaw:        [{ host:'chainsaw-man.fandom.com', category:'Characters' }],
    wakfu:           [{ host:'wakfu.fandom.com', category:'Characters' }],
    demonslayer:     [{ host:'kimetsu-no-yaiba.fandom.com', category:'Characters' }],
    pokemon:         [
        { host:'pokemon.fandom.com', category:'Characters' },
        { host:'pokemon.fandom.com', category:'Pokémon' }
    ],
    dragonball:      [{ host:'dragonball.fandom.com', category:'Characters' }],
    hellsparadise:   [{ host:'jigokuraku.fandom.com', category:'Characters' }],
    gachiakuta:      [{ host:'gachiakuta.fandom.com', category:'Characters' }],
    haikyuu:         [{ host:'haikyuu.fandom.com', category:'Characters' }],
    jjk:             [{ host:'jujutsu-kaisen.fandom.com', category:'Characters' }],
    jojo:            [{ host:'jojo.fandom.com', category:'Characters' }],
    tensura:         [{ host:'tensura.fandom.com', category:'Characters' }],
    opm:             [{ host:'onepunchman.fandom.com', category:'Characters' }],
    sao:             [{ host:'swordartonline.fandom.com', category:'Characters' }],
    tokyoghoul:      [{ host:'tokyoghoul.fandom.com', category:'Characters' }],
    tokyorevengers:  [{ host:'tokyorevengers.fandom.com', category:'Characters' }]
};

// Titres de franchise reconnus dans la base MyAnimeList/Jikan publique.
const DLE_FRANCHISE_PATTERNS = {
    naruto: [/naruto/i, /boruto/i],
    onepiece: [/one piece/i],
    bleach: [/bleach/i],
    hxh: [/hunter x hunter/i, /hunter × hunter/i],
    snk: [/shingeki no kyojin/i, /attack on titan/i],
    sds: [/nanatsu no taizai/i, /seven deadly sins/i],
    deathnote: [/death note/i],
    cote: [/youkoso jitsuryoku/i, /classroom of the elite/i],
    solo: [/solo leveling/i, /ore dake level up/i],
    clover: [/black clover/i],
    fireforce: [/enen no shouboutai/i, /fire force/i],
    mushoku: [/mushoku tensei/i],
    rezero: [/re:?zero/i],
    fairy: [/fairy tail/i],
    bluelock: [/blue lock/i],
    fma: [/fullmetal alchemist/i, /hagane no renkinjutsushi/i],
    chainsaw: [/chainsaw man/i],
    wakfu: [/wakfu/i],
    demonslayer: [/kimetsu no yaiba/i, /demon slayer/i],
    pokemon: [/pok[eé]mon/i, /pokemon/i],
    dragonball: [/dragon ball/i],
    hellsparadise: [/jigokuraku/i, /hell'?s paradise/i],
    gachiakuta: [/gachiakuta/i],
    haikyuu: [/haikyuu/i, /haikyuu!!/i],
    jjk: [/jujutsu kaisen/i],
    jojo: [/jojo/i, /jojo'?s bizarre adventure/i],
    tensura: [/tensei shitara slime/i, /tensura/i, /that time i got reincarnated as a slime/i],
    opm: [/one punch man/i],
    sao: [/sword art online/i],
    tokyoghoul: [/tokyo ghoul/i],
    tokyorevengers: [/tokyo revengers/i]
};

function cleanDleExternalTitle(title) {
    const s = String(title || '').trim()
        .replace(/_/g, ' ')
        .replace(/\s+/g, ' ');
    if (!s) return null;
    if (/^(category|file|template|portal|help|user|special|list of|chapter|episode|volume|arc|location|organization|technique|ability|item|weapon|soundtrack|gallery|timeline)\b/i.test(s)) return null;
    if (s.length > 100) return null;
    return s;
}

async function fetchJsonWithTimeout(url, timeoutMs = 15000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const res = await fetch(url, {
            signal: ctrl.signal,
            headers: {
                'User-Agent': 'AnimeGame-DLE/1.0 (+public-game-data)',
                'Accept': 'application/json,text/plain;q=0.9,*/*;q=0.8'
            }
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
    } finally {
        clearTimeout(timer);
    }
}

async function fetchFandomCategoryRecursive(host, rootCategory, opts = {}) {
    const maxDepth = Number.isFinite(opts.maxDepth) ? opts.maxDepth : 3;
    const maxNames = Number.isFinite(opts.maxNames) ? opts.maxNames : 2500;
    const out = new Set();
    const seenCats = new Set();
    const queue = [{ cat: rootCategory, depth: 0 }];

    while (queue.length && out.size < maxNames) {
        const { cat, depth } = queue.shift();
        const catKey = String(cat).toLowerCase();
        if (seenCats.has(catKey)) continue;
        seenCats.add(catKey);

        let cont = null;
        let pages = 0;

        do {
            const params = new URLSearchParams({
                action: 'query',
                list: 'categorymembers',
                cmtitle: `Category:${cat}`,
                cmlimit: '500',
                cmnamespace: '0|14',
                format: 'json',
                origin: '*'
            });
            if (cont) params.set('cmcontinue', cont);

            const url = `https://${host}/api.php?${params.toString()}`;
            let data;
            try {
                data = await fetchJsonWithTimeout(url, 12000);
            } catch (e) {
                break;
            }

            const members = data?.query?.categorymembers || [];
            for (const member of members) {
                if (member.ns === 0) {
                    const name = cleanDleExternalTitle(member.title);
                    if (name) out.add(name);
                } else if (member.ns === 14 && depth < maxDepth) {
                    const sub = String(member.title || '').replace(/^Category:/i, '').trim();
                    // On ne descend que dans des sous-catégories plausiblement liées aux personnages.
                    if (sub && !/gallery|image|episode|chapter|volume|location|item|weapon|technique|ability|music|staff/i.test(sub)) {
                        queue.push({ cat: sub, depth: depth + 1 });
                    }
                }
                if (out.size >= maxNames) break;
            }

            cont = data?.continue?.cmcontinue || null;
            pages++;
        } while (cont && pages < 12 && out.size < maxNames);
    }

    return [...out];
}

async function loadGlobalOfflineCharacterDb() {
    // Base publique dérivée de Jikan/MAL. La branche prod est la branche réellement publiée.
    const url = 'https://raw.githubusercontent.com/arda-/anime-character-offline-database/main/latest/characters.min.json';
    try {
        const db = await fetchJsonWithTimeout(url, 45000);
        const rows = Array.isArray(db?.data) ? db.data : [];

        for (const row of rows) {
            const name = cleanDleExternalTitle(row?.name);
            if (!name) continue;

            const appearances = Array.isArray(row?.animeAppearances) ? row.animeAppearances : [];
            const titles = appearances.map(a => String(a?.anime?.title || '')).filter(Boolean);
            if (!titles.length) continue;

            for (const [key, patterns] of Object.entries(DLE_FRANCHISE_PATTERNS)) {
                if (titles.some(t => patterns.some(rx => rx.test(t)))) {
                    DLE_LIVE_POOLS[key]?.add(name);
                }
            }
        }

        console.log(`[AnimeDLE] Base publique chargée : ${rows.length} personnages inspectés.`);
    } catch (e) {
        console.warn('[AnimeDLE] Base publique Jikan/MAL indisponible :', e.message);
    }
}

async function loadFandomPools() {
    const jobs = [];
    for (const [key, sources] of Object.entries(DLE_FANDOM_SOURCES)) {
        for (const source of sources) jobs.push({ key, ...source });
    }

    // Concurrence volontairement limitée pour ne pas marteler les wikis.
    const concurrency = 4;
    let cursor = 0;

    async function worker() {
        while (cursor < jobs.length) {
            const job = jobs[cursor++];
            try {
                const names = await fetchFandomCategoryRecursive(job.host, job.category, {
                    maxDepth: 3,
                    maxNames: job.key === 'pokemon' ? 4500 : 2800
                });
                for (const name of names) DLE_LIVE_POOLS[job.key]?.add(name);
                console.log(`[AnimeDLE] ${job.key}: +${names.length} depuis ${job.host}/${job.category}`);
            } catch (e) {
                console.warn(`[AnimeDLE] Source ${job.host} indisponible:`, e.message);
            }
        }
    }

    await Promise.all(Array.from({ length: concurrency }, () => worker()));
}

function getDleGlobalPoolStats() {
    const perUniverse = {};
    let total = 0;

    for (const key of Object.keys(DLE_UNIVERSES)) {
        const base = dleBaseUniverse(key);
        const merged = new Set();

        for (const c of (base.characters || [])) merged.add(normalizeDle(c.name));

        const rg = RG_UNIVERSES[key];
        if (rg) {
            for (const n of parseRGList(rg.raw)) merged.add(normalizeDle(n));
        }

        for (const n of (DLE_LIVE_POOLS[key] || [])) merged.add(normalizeDle(n));

        perUniverse[key] = merged.size;
        total += merged.size;
    }

    return { total, perUniverse, ready: dleLiveExpansionReady };
}


const DLE_UNIVERSE_EXPANSION_PROMISES = new Map();

async function ensureDleUniverseExpansion(universeKey) {
    if (DLE_UNIVERSE_EXPANSION_PROMISES.has(universeKey)) {
        return DLE_UNIVERSE_EXPANSION_PROMISES.get(universeKey);
    }

    const promise = (async () => {
        const sources = DLE_FANDOM_SOURCES[universeKey] || [];

        for (const source of sources) {
            try {
                const names = await fetchFandomCategoryRecursive(source.host, source.category, {
                    maxDepth: 3,
                    maxNames: universeKey === "pokemon" ? 5000 : 3000
                });
                for (const name of names) DLE_LIVE_POOLS[universeKey]?.add(name);
            } catch (_) {}
        }

        return DLE_LIVE_POOLS[universeKey]?.size || 0;
    })();

    DLE_UNIVERSE_EXPANSION_PROMISES.set(universeKey, promise);
    return promise;
}

async function startDleLiveExpansion() {
    if (dleLiveExpansionPromise) return dleLiveExpansionPromise;

    dleLiveExpansionStarted = true;
    dleLiveExpansionPromise = (async () => {
        console.log('[AnimeDLE] Expansion massive démarrée…');

        await Promise.allSettled([
            loadGlobalOfflineCharacterDb(),
            loadFandomPools()
        ]);

        dleLiveExpansionReady = true;
        const stats = getDleGlobalPoolStats();
        console.log(`[AnimeDLE] Expansion terminée : ${stats.total} entrées uniques réparties sur 31 univers.`);
        if (stats.total < 12000) {
            console.warn(`[AnimeDLE] Total actuellement chargé : ${stats.total}. Certaines sources externes peuvent être indisponibles.`);
        }
        return stats;
    })();

    return dleLiveExpansionPromise;
}


/* ================= AnimeDLE V6 — profils complets =================
   - Aucun personnage supprimé.
   - Catégories V2 conservées.
   - Enrichissement du personnage au premier usage depuis le wiki de son univers.
   - Cache mémoire pour ne pas refaire les requêtes.
   - Jamais de cellule "?" : si une donnée n'est pas documentée, on affiche
     explicitement "Non révélé / non précisé" plutôt que d'inventer.
==================================================================== */

const DLE_PROFILE_CACHE = new Map();

// ================= AnimeDLE V10 — pool propre et dédoublonné =================
const DLE_MASTER_NAMES = {"naruto":["Naruto Uzumaki","Sasuke Uchiha","Sakura Haruno","Kakashi Hatake","Itachi Uchiha","Hinata Hyūga","Gaara","Minato Namikaze","Madara Uchiha","Hashirama Senju","Neji Hyūga","Jiraiya","Agara","Ageha","Akahoshi","Akamaru","Akatsuchi","Akino","Anko Mitarashi","Ao","Aoi Rokushô","Arashi Fûma","Ashina Uzumaki","Asura Ōtsutsuki","Asuma Sarutobi","Ayame","Black Zetsu","Boruto Uzumaki","Chino","Chiriku","Chiyo","Chôchô Akimichi","Chôji Akimichi","Chôza Akimichi","Daemon","Danzô Shimura","Darui","Deidara","Denki Kaminarimon","Ebisu","Fû","Fū Yamanaka","Fubuki Kakuyoku","Fugaku Uchiha","Might Guy","Gakidô","Gama","Gamabunta","Gamakichi","Hagoromo Ôtsutsuki","Haku","Hamura Ôtsutsuki","Hanabi Hyûga","Hanzô","Hayate Gekkô","Hiashi Hyûga","Hidan","Himawari Uzumaki","Hiruzen Sarutobi","Ibiki Morino","Indra Ôtsutsuki","Ino Yamanaka","Inoichi Yamanaka","Inojin Yamanaka","Iruka Umino","Izumi Uchiha","Jigen","Akebino","Jinpachi Munashi","Jirôbô","Jirocho","Jōseki","Jûbi","Jûgo","Jūjin","Jūzō Biwa","Kabuto Yakushi","Kagami Uchiha","Kagari","Kaguya Ôtsutsuki","Kakuzu","Kankurô","Karin Uzumaki","Karui","Katsuyu","Kawaki","Kiba","Killer Bee","Kimimaro","Kisame Hoshigaki","Konan","Konohamaru Sarutobi","Kurama","Kurenaï","Kushina Uzumaki","Matatabi","Meï Terumi","Metal Lee","Might Duy","Mito Uzumaki","Mitsuki","Momoshiki Ôtsutsuki","Mû","Nagato","Obito Uchiha","Omoï","Onoki","Orochimaru","Pain","Pakkun","Rin Nohara","Rock Lee","Saï","Samui","Sarada Uchiha","Sasori","Shikadai Nara","Shikaku Nara","Shikamaru Nara","Shino Aburame","Shisui Uchiha","Shukaku","Son Gokû","Suzume","Temari","Tenten","Tobirama Senju","Tsunade","Utakata","White Zetsu","Yahiko","Yamato","Zōmei","Zôri"],"onepiece":["Monkey D. Luffy","Roronoa Zoro","Nami","Sanji","Nico Robin","Trafalgar D. Water Law","Shanks","Portgas D. Ace","Marshall D. Teach","Kaido","Boa Hancock","Sabo","Abdullah","Absalom","Ain","Aisa","Aladine","Alpacaman","Alvida","Charlotte Amande","Andre","Aphelandra","Aramaki","Arlong","Ashura Doji","Atlas","Atmos","Avalo Pizarro","Axe-Hand Morgan","Babanuki","Baby 5","Baccarat","Baggaley","Bakkin","Bao Huang","Bariete","Bartholomew Kuma","Bartolomeo","Basil Hawkins","Bastille","Batman","Bellamy","Bell-mère","Belo Betty","Benn Beckman","Bentham","Bepo","Big Pan","Billy","Binz","Black Maria","Blackback","Blamenco","Blenheim","Blue Gilly","Blueno","Boa Marigold","Boa Sandersonia","Bobbin","Bogard","Jewelry Bonney","Boo","Boodle","Borsalino","Brannew","Briscola","Brogy","Brook","Brownbeard","Buchi","Buffalo","Buggy","Byrnndi World","Cabaji","Caesar Clown","Caimanlady","Kalgara","Camie","Capone Bege","Caribou","Carina","Carmel","Carne","Carrot","Catarina Devon","Cavendish","Chaka","Charlos","Charlotte Anana","Charlotte Anglais","Charlotte Basans","Charlotte Bavarois","Charlotte Brownie","Charlotte Brûlée","Charlotte Chiboust","Charlotte Chiffon","Charlotte Cinnamon","Charlotte Citron","Charlotte Compote","Charlotte Counter","Charlotte Cracker","Charlotte Custard","Charlotte Daifuku","Charlotte Decuple","Charlotte Dolce","Charlotte Dragée","Charlotte Flampe","Charlotte Galette","Charlotte Harumatsu","Charlotte Joconde","Charlotte Joscarpone","Charlotte Kanten","Charlotte Katakuri","Charlotte Kato","Charlotte Linlin","Charlotte Lola","Charlotte Mascarpone","Charlotte Mash","Charlotte Mobile","Charlotte Mont-d'Or","Charlotte Moscato","Charlotte Myukuru","Charlotte Newichi","Charlotte Newji","Charlotte Nougat","Charlotte Nusstorte","Charlotte Opera","Charlotte Oven","Charlotte Perospero","Charlotte Poire","Charlotte Praline","Charlotte Pudding","Charlotte Raisin","Charlotte Smoothie","Charlotte Snack","Charlotte Tablet","Charlotte Yuen","Chess","Chew","Chimney","Cindry","Clover","Conis","Coribou","Crocodile","Crocus","Curiel","Curly Dadan","Dagama","Daifugo","Daikoku","Dalmatian","Dalton","Damask","Daruma","Daz Bones","Dellinger","Demalo Black","Den","Denjiro","Diamante","Dice","Disco","Django","Doberman","Dobon","Doc Q","Doma","Domino","Don Chinjao","Don Krieg","Donquixote Doflamingo","Donquixote Homing","Donquixote Mjosgard","Donquixote Rosinante","Dorry","Dosun","Douglas Bullet","Dr. Hiriluk","Dr. Hogback","Dr. Indigo","Dr. Kureha","Dracule Mihawk","Perona","Drake","Du Feld","Duval","Edison","Edward Newgate","Edward Weevil","Elizabello II","Emporio Ivankov","Enel","Epoida","Saint Ethanbaron V. Nusjuro","Eustass Kid","Farafra","Fisher Tiger","Fossa","Foxy","Franky","Fukaboshi","Fukuro","Fukurokuju","Fukurou","Fullbody","Funkfreed","Scopper Gaban","Gaimon","Galdino","Gambia","Gan Fall","Gasparde","Gazelleman","Gecko Moria","Gedatsu","Genzo","Gerd","Gin","Ginny","Ginrummy","Giolla","Gladius","Gloriosa","Gol D. Roger","Gonbe","Gordon","Gotti","Guernica","Gyaro","Gyukimaru","Hack","Hajrudin","Hamburg","Hammond","Hannyabal","Hanzo","Haredas","Haruta","Hatchan","Hattori","Heat","Helmeppo","Héra","Heracles","Hildon","Hina","Hody Jones","Holdem","Hongo","Hotori","Hyogoro","Hyouzou","Iceburg","Ideo","Igaram","Ikaros Much","Imu","Inazuma","Indigo","Inuarashi","Ipponmatsu","Issho","Isuka","Itomimizu","Izo","Jabra","Jack","Jaguar D. Saul","Jango","Saint Jaygarcia Saturn","Jean Bart","Jeet","Jesus Burgess","Jinbe","Jiro","John","Johnny","Jonathan","Jora","Joy Boy","Jozu","Kaku","Kalifa","Kanjuro","Karasu","Karoo","Kashii","Kawamatsu","Kaya","Kikunojo","Kikyo","Killer","Kin'emon","King","King Neptune","Kingdew","Koala","Koby","Kokoro","Komachiyo","Komurasaki","Kong","Kotori","Koushirou","Koza","Kozuki Hiyori","Kozuki Momonosuke","Kozuki Oden","Kozuki Sukiyaki","Kozuki Toki","Kuina","Kumadori","Kumashi","Kuro","Kuromarimo","Kuroobi","Kurozumi Higurashi","Kurozumi Orochi","Kuzan","Kyoshiro","Kyros","Laboon","Lacroix","Laffitte","Laki","Lao G","Leo","Lilith","Lindbergh","Little Oars Jr.","Loki","Lonz","Lorenz","Lucky Roux","Lulu","Machvise","Macro","Magellan","Makino","Manboshi","Mansherry","Marco","Saint Marcus Mars","Marguerite","Masira","Maynard","McGuy","McKinley","Merry","Minatomo","Miss Doublefinger","Miss Friday","Miss Goldenweek","Miss Merry Christmas","Miss Monday","Miss Valentine","Miyagi","Mohji","Momonga","Monet","Monkey D. Dragon","Monkey D. Garp","Mont Blanc Cricket","Mont Blanc Noland","Morgan","Morgans","Morley","Mouseman","Mousse","Mozambia","Mr. 13","Mr. 4","Mr. 5","Mr. 7","Mr. 9","Namur","Napoléon","Nefertari Cobra","Nefertari D. Lili","Nefertari Vivi","Nekomamushi","Nero","Nezumi","Nico Olvia","Ninjin","Nojiko","Nure-Onna","Nyon","Oars","Ochoku","Ohm","Oimo","Okiku","Onigumo","Onimaru","Orlumbus","O-Tama","Otohime","O-Toko","O-Tsuru","Pagaya","Page One","Pappag","Patty","Paulie","Pearl","Pedro","Pekoms","Pell","Penguin","Pica","Pierre","Porche","Porchemy","Portgas D. Rouge","Pound","Prometheus","Pythagoras","Queen","Rabbitman","Raizo","Raki","Rakuyo","Rebecca","Richie","Riku Doldo III","Rindo","Rob Lucci","Rocks D. Xebec","Rockstar","Roddy","Roshio","Rosward","Rush","Ryuboshi","Ryuma","Sadi","Saga","Sai","Saint Figarland Garling","Saint Shepherd Ju Peter","Saint Topman Warcury","Sakazuki","Saldeath","Salome","Sanjuan Wolf","Sarahebi","Sarquiss","Sarutobi","Sasaki","Satori","S-Bat","S-Bear","Scarlett","Scotch","Scratchmen Apoo","Sengoku","Senor Pink","Sentomaru","S-Flamingo","Shachi","Shaka","Shakuyaku","Shalria","Sham","S-Hawk","Sheepshead","Shiki","Shiryu","Shimotsuki Kozaburo","Shimotsuki Yasuie","Shinobu","Shirahoshi","Shoujou","Shura","Shyarly","Sicilian","Silver Axe","Silvers Rayleigh","Smoker","Solitaire","Spandam","Spandine","Speed","Speed Jill","Squardo","S-Shark","S-Snake","Strawberry","Streusen","Stronger","Stussy","Sugar","Suleiman","Surume","Sweet Pea","Tamago","Tank Lepanto","Tansui","Tararan","Taro","Tashigi","T-Bone","Tenguyama Hitetsu","Terracotta","Tesoro","Thatch","Tilestone","Tom","Tonoyasu","Tony Tony Chopper","Toto","Trebol","Tristan","Tsuru","Ucy","Ulti","Urashima","Urouge","Usopp","Uta","Van Augur","Vander Decken IX","Vasco Shot","Vegapunk","York","Vergo","Victoria Cindry","Vinsmoke Ichiji","Vinsmoke Judge","Vinsmoke Niji","Vinsmoke Reiju","Vinsmoke Sora","Vinsmoke Yonji","Viola","Vista","Vito","Wadatsumi","Wanda","Wanze","Wapol","Whitey Bay","Who's Who","Wire","Wyper","X Drake","Yama","Yamakaji","Yamato","Yasopp","Yokozuna","Yosaku","Yuda","Zala","Zambai","Zeff","Zeo","Zephyr","Zepo","Zeus","Zodia","Zunesha"],"hxh":["Gon Freecss","Killua Zoldyck","Kurapika","Leorio Paradinight","Hisoka Morow","Chrollo Lucilfer","Illumi Zoldyck","Meruem","Isaac Netero","Neferpitou","Ging Freecss","Kite","Biscuit Krueger","Zeno Zoldyck","Silva Zoldyck","Kikyo Zoldyck","Milluki Zoldyck","Alluka Zoldyck","Nanika","Kalluto Zoldyck","Gotoh","Canary","Tsubone","Amane","Satotz","Menchi","Buhara","Lippo","Hanzo","Pokkle","Ponzu","Tonpa","Bodoro","Geretta","Melody","Basho","Squala","Baise","Dalzollene","Neon Nostrade","Light Nostrade","Nobunaga Hazama","Feitan Portor","Machi Komacine","Phinks Magcub","Franklin Bordeau","Shizuku Murasaki","Bonolenov Ndongo","Pakunoda","Uvogin","Shalnark","Kortopi","Razor","Genthru","Sub","Bara","Tsezguerra","Goreinu","Abengane","Shaiapouf","Menthuthuyoupi","Colt","Reina","Cheetu","Leol","Welfin","Bloster","Ikalgo","Meleoron","Zazan","Pike","Rammot","Morel Mackernasey","Knov","Knuckle Bine","Shoot McMahon","Palm Siberia","Komugi","Gyro"],"sds":["Meliodas","Ban","King","Diane","Gowther","Merlin","Escanor","Elizabeth Liones","Zeldris","Estarossa","Mael","Hawk","Aldrich","Anne","Arthur Pendragon","Bartra Liones","Bellion","Burgie","Cain Barzad","Cath","Chandler","Chaos","Dale","Dalmally","Dana","Derieri","Dolores","Dreyfus","Drole","Elaine","Fraudrin","Galand","Gilthunder","Gloxinia","Griamore","Guila","Howzer","Hawk Mama","Helbram","Hendrickson","Jericho","Lancelot","Liz","Margaret Liones","Matrona","Melascula","Monspeet","Slader","Tristan","Twigo","Veronica Liones","Vivian","Zaneri","Zaratras","Zhivago"],"fairy":["Natsu Dragneel","Lucy Heartfilia","Gray Fullbuster","Erza Scarlet","Wendy Marvell","Gajeel Redfox","Laxus Dreyar","Juvia Lockser","Mirajane Strauss","Makarov Dreyar","Sting Eucliffe","Rogue Cheney","Acnologia","Aldoron","Alzack Connell","Angel","Anna Heartfilia","Aquarius","Arcadios","Aries","Athena","Bisca Connell","Blue Note","Cana Alberona","Cancer","Capricorn","Carla","Cobra","Coco","Deliora","Droy","Duke Barbaroa","Elfman","Eve Tearm","Evergreen","Mavis Vermillion","Freed Justine","Frosch","Gemini","Gildarts Clive","Hades","Happy","Ichiya","Igneel","Jellal Fernandes","Jose Porla","Jura Neekis","Kagura Mikazuchi","Lector","Loke","Lyon Vastia","Macao Conbolt","Mest Gryder","Metalicana","Nadi","Neinhart","Nichiya","Org","Panther Lily","Racer","Ren Akatsuki","Romeo Conbolt","Scorpio","Sherria Blendy","Silver","Tauros","Virgo","Wakaba Mine","Wally Buchanan","Warren Rocko","Warrod Sequen","Weisslogia","Wolfheim","Yajima","Yomazu","Yuka Suzuki","Yukino Agria","Yuri Dreyar","Yury","Zancrow","Zentopia","Zera","Zeref Dragneel","Zero","Zirconis","Zoldeo"],"chainsaw":["Denji","Power","Aki Hayakawa","Makima","Kobeni Higashiyama","Himeno","Reze","Katana Man","Angel Devil","Pochita","Kishibe","Hirokazu Arai","Madoka","Beam","Violence Fiend","Princi","Future Devil","Curse Devil","Fox Devil","Ghost Devil","Akane Sawatari","Quanxi","Cosmo","Pingtsi","Long","Tsugihagi","Santa Claus","Tolka","Aldo","Asa Mitaka","Yoru","Nayuta","Hirofumi Yoshida","Fami","Haruka Iseumi","Seigi Akoku","Nobana Higashiyama","Barem Bridge","Miri Sugo","Whip Hybrid","Spear Hybrid"],"dragonball":["Son Goku","Vegeta","Son Gohan","Piccolo","Freezer","Cell","Majin Buu","Beerus","Jiren","Broly","Gogeta","Vegito","Goten","Trunks","Future Trunks","Krillin","Tien Shinhan","Chiaotzu","Yamcha","Master Roshi","Bulma","Chi-Chi","Videl","Pan","Mr. Satan","Uub","Bardock","Gine","Raditz","Nappa","King Vegeta","Tarble","King Cold","Cooler","Zarbon","Dodoria","Captain Ginyu","Jeice","Burter","Recoome","Guldo","Android 16","Android 17","Android 18","Android 19","Dr. Gero","Babidi","Dabura","Supreme Kai","Kibito","Whis","Champa","Vados","Zeno","Grand Priest","Hit","Cabba","Caulifla","Kale","Kefla","Frost","Botamo","Magetta","Toppo","Dyspo","Goku Black","Zamasu","Fused Zamasu","Paragus","Gotenks","Moro","Merus","Granolah","Gas","Elec"],"haikyuu":["Shoyo Hinata","Tobio Kageyama","Kei Tsukishima","Yu Nishinoya","Toru Oikawa","Wakatoshi Ushijima","Kotaro Bokuto","Kenma Kozume","Tetsuro Kuroo","Atsumu Miya","Osamu Miya","Kiyoomi Sakusa","Tadashi Yamaguchi","Daichi Sawamura","Koshi Sugawara","Asahi Azumane","Ryunosuke Tanaka","Chikara Ennoshita","Hisashi Kinoshita","Kazuhito Narita","Kiyoko Shimizu","Hitoka Yachi","Ittetsu Takeda","Keishin Ukai","Hajime Iwaizumi","Issei Matsukawa","Takahiro Hanamaki","Shinji Watari","Shigeru Yahaba","Yutaro Kindaichi","Akira Kunimi","Morisuke Yaku","Nobuyuki Kai","Taketora Yamamoto","Shohei Fukunaga","Lev Haiba","So Inuoka","Tamahiko Teshiro","Keiji Akaashi","Akinori Konoha","Satori Tendo","Tsutomu Goshiki","Kenjiro Shirabu","Eita Semi","Reon Ohira","Taichi Kawanishi","Shinsuke Kita","Rintaro Suna","Aran Ojiro","Korai Hoshiumi","Sachiro Hirugami","Motoya Komori","Takanobu Aone","Kenji Futakuchi","Kanji Koganegawa","Yuji Terushima","Suguru Daisho"],"opm":["Saitama","Genos","Tatsumaki","Bang","King","Fubuki","Garou","Boros","Mumen Rider","Flashy Flash","Bomb","Blast","Atomic Samurai","Child Emperor","Metal Knight","Zombieman","Drive Knight","Pig God","Superalloy Darkshine","Watchdog Man","Tanktop Master","Metal Bat","Puri-Puri Prisoner","Amai Mask","Iaian","Okamaitachi","Bushidrill","Spring Mustachio","Golden Ball","Tanktop Tiger","Tanktop Black Hole","Speed-o'-Sound Sonic","Suiryu","Melzargard","Geryuganshoop","Groribas","Orochi","Psykos","Gyoro Gyoro","Black Sperm","Homeless Emperor","Elder Centipede","Gouketsu","Fuhrer Ugly","Nyan","Phoenix Man","Deep Sea King","Vaccine Man","Carnage Kabuto","Mosquito Girl","Beast King","Armored Gorilla","Dr. Genus"],"tokyorevengers":["Takemichi Hanagaki","Manjiro Sano","Ken Ryuguji","Keisuke Baji","Chifuyu Matsuno","Takashi Mitsuya","Kazutora Hanemiya","Tetta Kisaki","Izana Kurokawa","Taiju Shiba","Haruki Hayashida","Ryohei Hayashi","Nahoya Kawata","Souya Kawata","Hakkai Shiba","Atsushi Sendo","Takuya Yamamoto","Makoto Suzuki","Kazushi Yamagishi","Hinata Tachibana","Naoto Tachibana","Emma Sano","Shinichiro Sano","Shuji Hanma","Nobutaka Osanai","Yuzuha Shiba","Seishu Inui","Hajime Kokonoi","Kakucho","Kanji Mochizuki","Shion Madarame","Ran Haitani","Rindo Haitani","Yasuhiro Muto","Haruchiyo Sanzu","South Terano","Senju Kawaragi","Takeomi Akashi","Wakasa Imaushi","Keizo Arashi"],"bleach":["Ichigo Kurosaki","Rukia Kuchiki","Renji Abarai","Byakuya Kuchiki","Toshiro Hitsugaya","Kenpachi Zaraki","Sosuke Aizen","Uryu Ishida","Grimmjow Jaegerjaquez","Ulquiorra Cifer","Kisuke Urahara","Yhwach","Acidwire","Akon","As Nodt","Asguiaro Ebern","Ashido Kano","Askin","Bambietta Basterbine","Baraggan Louisenbairn","Bazz-B","BG9","Bonnie","Chojiro Sasakibe","Cirucci Sanderwicci","Coyote Starrk","Cyan Sung-Sun","Danon","Di Roy Rinker","Edrad Liones","Eikichirō Saidō","Ganryu","Garogai","Genryusai Shigekuni Yamamoto","Gerard Valkyrie","Gin Ichimaru","Ginrei Kuchiki","Giriko Kutsuzawa","Giselle Gewelle","Grand Fisher","Gremmy Thoumeaux","Shuhei Hisagi","Hisana Kuchiki","Ichibe Hyosube","Isane Kotetsu","Isshin Kurosaki","Jugram Haschwalth","Jushiro Ukitake","Lille Barro","Oetsu Nimaiya","Orihime Inoue","Ouko Yushima","Pernida Parnkgjas","Rangiku Matsumoto","Retsu Unohana","Shinji Hirako","Shunsui Kyoraku","Sode no Shirayuki","Soi Fon","Soken Ishida","Soul King","Szayelaporro Granz","Tier Harribel","Wabisuke","Yachiru Kusajishi","Yoruichi Shihoin","Yylfordt Granz","Zangetsu","Zennosuke Kurumadani","Zommari Rureaux","Mayuri Kurotsuchi"],"snk":["Eren Yeager","Mikasa Ackerman","Armin Arlert","Levi Ackerman","Reiner Braun","Annie Leonhart","Zeke Yeager","Erwin Smith","Hange Zoë","Jean Kirstein","Connie Springer","Sasha Blouse","Historia Reiss","Ymir","Bertholdt Hoover","Marco Bott","Floch Forster","Petra Ral","Oluo Bozado","Eld Jinn","Gunther Schultz","Miche Zacharius","Moblit Berner","Keith Shadis","Dot Pixis","Darius Zackly","Kenny Ackerman","Rod Reiss","Frieda Reiss","Grisha Yeager","Dina Fritz","Pieck Finger","Porco Galliard","Marcel Galliard","Gabi Braun","Falco Grice","Theo Magath","Yelena","Onyankopon","Niccolo"],"deathnote":["Light Yagami","L Lawliet","Misa Amane","Near","Mello","Ryuk","Rem","Teru Mikami","Soichiro Yagami","Touta Matsuda","Sachiko Yagami","Sayu Yagami","Shuichi Aizawa","Kanzo Mogi","Hideki Ide","Hirokazu Ukita","Watari","Kiyomi Takada","Naomi Misora","Raye Penber","Kyosuke Higuchi","Reiji Namikawa","Wedy","Aiber","Matt","Sidoh","Gelus"],"cote":["Kiyotaka Ayanokoji","Suzune Horikita","Kikyo Kushida","Kei Karuizawa","Kakeru Ryuen","Arisu Sakayanagi","Honami Ichinose","Rokusuke Koenji","Manabu Horikita","Miyabi Nagumo","Yosuke Hirata","Ken Sudo","Kanji Ike","Haruki Yamauchi","Airi Sakura","Akito Miyake","Haruka Hasebe"],"solo":["Sung Jinwoo","Cha Hae-In","Choi Jong-In","Baek Yoonho","Yoo Jinho","Thomas Andre","Liu Zhigang","Igris","Beru","Antares","Sung Jinah","Park Kyung-Hye","Lee Joohee","Song Chi-Yul","Kim Sangshik","Hwang Dongsuk","Kang Taeshik","Hwang Dongsoo","Woo Jinchul","Go Gunhee","Lim Tae-Gyu","Ma Dongwook","Min Byung-Gyu","Christopher Reed","Siddharth Bachchan","Norma Selner","Bellion","Tusk","Iron","Tank","Greed","Kaisel","Ashborn","Baran","Rakan","Sillad","Querehsha","Tarnak","Legia","Yogumunt","Kandiaru","Esil Radiru","Kamish"],"clover":["Asta","Yuno","Noelle Silva","Yami Sukehiro","Luck Voltia","Magna Swing","Fuegoleon Vermillion","Mereoleona Vermillion","Julius Novachrono","Nacht Faust","Finral Roulacase","Vanessa Enoteca","Acier Silva","Alecdora Sandler","Charlotte Roselei","Charmy Pappitson","Ciel Grinberryall","Conrad Leto","Damnatio Kira","Dante Zogratis","Fana","Ichika Yami","Jack the Ripper","Kirsch Vermillion","Klaus Lunettes","Langris Vaude","Leopold Vermillion","Licht","Liebe","Lilith","Lolopechka","Lucifero","Lucius Zogratis","Marx Francois","Megicula","Mimosa Vermillion","Nero","Nozel Silva","Rill Boismortier","Sekke Bronzazza","Sister Lily","Sister Theresa","Undine","Vanica Zogratis","William Vangeance","Zenon Zogratis"],"fireforce":["Shinra Kusakabe","Arthur Boyle","Maki Oze","Tamaki Kotatsu","Akitaru Obi","Takehisa Hinawa","Benimaru Shinmon","Leonard Burns","Sho Kusakabe","Haumea","Iris","Viktor Licht","Vulcan Joseph","Lisa Isaribe","Yu","Konro Sagamiya","Hibana","Karim Flam","Rekka Hoshimiya","Ogun Montgomery","Pan Ko Paat","Joker","Charon","Arrow","Inca Kasugatani","Ritsu","Yona","Assault","Dragon","Giovanni","Nataku Son","Kurono Yuichiro","Amaterasu"],"mushoku":["Rudeus Greyrat","Roxy Migurdia","Sylphiette","Eris Boreas Greyrat","Ruijerd Superdia","Orsted","Paul Greyrat","Ghislaine Dedoldia","Nanahoshi Shizuka","Zenith Greyrat","Lilia Greyrat","Norn Greyrat","Aisha Greyrat","Hitogami","Kishirika Kishirisu","Badigadi","Luke Notos Greyrat","Zanoba Shirone","Elinalise Dragonroad","Philip Boreas Greyrat","Hilda Boreas Greyrat","Sauros Boreas Greyrat","Perugius Dola","Almanfi","Soldat Heckler","Sara","Linia Dedoldia","Pursena Adoldia","Pax Shirone","Randolph Marianne"],"rezero":["Subaru Natsuki","Emilia","Rem","Ram","Beatrice","Roswaal L. Mathers","Reinhard van Astrea","Crusch Karsten","Priscilla Barielle","Regulus Corneas","Puck","Otto Suwen","Garfiel Tinsel","Frederica Baumann","Petra Leyte","Patrasche","Felt","Felix Argyle","Wilhelm van Astrea","Theresia van Astrea","Anastasia Hoshin","Julius Juukulius","Ricardo Welkin","Mimi","Hetaro","Tivey","Al","Echidna","Satella","Minerva","Typhon","Daphne","Sekhmet","Carmilla","Pandora","Petelgeuse Romanee-Conti","Sirius Romanee-Conti","Capella Emerada Lugunica","Lye Batenkaitos","Roy Alphard","Louis Arneb","Elsa Granhiert","Meili Portroute"],"bluelock":["Yoichi Isagi","Rin Itoshi","Meguru Bachira","Seishiro Nagi","Reo Mikage","Shoei Barou","Hyoma Chigiri","Ryusei Shidou","Michael Kaiser","Sae Itoshi","Oliver Aiku","Gin Gagamaru","Rensuke Kunigami","Jyubei Aryu","Aoshi Tokimitsu","Ikki Niko","Raichi Jingo","Tabito Karasu","Eita Otoya","Kenyu Yukimiya","Yo Hiori","Ranze Kurona","Kiyora Jin","Alexis Ness","Don Lorenzo","Charles Chevalier","Noel Noa","Julian Loki","Lavinho","Chris Prince","Marc Snuffy","Jinpachi Ego","Anri Teieri"],"fma":["Edward Elric","Alphonse Elric","Roy Mustang","Riza Hawkeye","Scar","Winry Rockbell","King Bradley","Greed","Envy","Father","Pinako Rockbell","Van Hohenheim","Trisha Elric","Jean Havoc","Heymans Breda","Vato Falman","Kain Fuery","Maes Hughes","Gracia Hughes","Elicia Hughes","Alex Louis Armstrong","Olivier Mira Armstrong","Buccaneer","Miles","Grumman","Basque Grand","May Chang","Ling Yao","Lan Fan","Fu","Yoki","Tim Marcoh","Izumi Curtis","Sig Curtis","Selim Bradley","Lust","Gluttony","Sloth","Shou Tucker","Nina Tucker","Alexander","Barry the Chopper","Maria Ross","Denny Brosh"],"wakfu":["Yugo","Tristepin de Percedal","Amalia Sheran Sharm","Evangelyne","Ruel Stroud","Adamai","Qilby","Nox","Oropo","Goultard","Az","Grougaloragran","Alibert","Shinonome","Phaeris","Chibi","Mina","Glip","Baltazar","Echo","Harebourg","Ush Galesh","Black Bump","Rubilax","Elely","Flopin","Pin","Joris Jurgen","Kerubim Crepin","Atcham","Remington Smisse","Grany Smisse","Maskemane","Kabrok","Miranda","Armand Sheran Sharm","Aurora","Moon"],"demonslayer":["Tanjiro Kamado","Nezuko Kamado","Zenitsu Agatsuma","Inosuke Hashibira","Giyu Tomioka","Kyojuro Rengoku","Shinobu Kocho","Muzan Kibutsuji","Kokushibo","Akaza","Kanao Tsuyuri","Genya Shinazugawa","Tengen Uzui","Mitsuri Kanroji","Muichiro Tokito","Sanemi Shinazugawa","Gyomei Himejima","Obanai Iguro","Kanae Kocho","Kagaya Ubuyashiki","Amane Ubuyashiki","Sakonji Urokodaki","Sabito","Makomo","Jigoro Kuwajima","Shinjuro Rengoku","Senjuro Rengoku","Doma","Hantengu","Gyokko","Gyutaro","Daki","Nakime","Kaigaku","Enmu","Rui","Kyogai","Susamaru","Yahaba","Tamayo","Yushiro","Yoriichi Tsugikuni"],"pokemon":["Pikachu","Dracaufeu","Bulbizarre","Carapuce","Ectoplasma","Mewtwo","Lucario","Gardevoir","Dracolosse","Amphinobi","Rayquaza","Arceus","Raichu","Charmeleon","Wartortle","Blastoise","Caterpie","Butterfree","Pidgeot","Rattata","Spearow","Ekans","Arbok","Sandshrew","Nidoran","Clefairy","Vulpix","Jigglypuff","Zubat","Oddish","Paras","Venonat","Diglett","Meowth","Psyduck","Mankey","Growlithe","Poliwag","Abra","Machop","Bellsprout","Tentacool","Geodude","Ponyta","Slowpoke","Magnemite","Farfetch'd","Doduo","Seel","Grimer","Shellder","Gastly","Haunter","Onix","Drowzee","Krabby","Voltorb","Exeggcute","Cubone","Hitmonlee","Hitmonchan","Lickitung","Koffing","Rhyhorn","Chansey","Tangela","Kangaskhan","Horsea","Goldeen","Staryu","Mr. Mime","Scyther","Jynx","Electabuzz","Magmar","Pinsir","Tauros","Magikarp","Gyarados","Lapras","Ditto","Eevee","Vaporeon","Jolteon","Flareon","Porygon","Omanyte","Kabuto","Aerodactyl","Snorlax","Articuno","Zapdos","Moltres","Dratini","Dragonair","Mew","Lugia","Ho-Oh","Celebi","Groudon","Kyogre","Jirachi","Deoxys","Dialga","Palkia","Giratina","Reshiram","Zekrom","Kyurem","Xerneas","Yveltal","Zygarde","Solgaleo","Lunala","Necrozma","Zacian","Zamazenta","Eternatus","Koraidon","Miraidon"],"hellsparadise":["Gabimaru","Yamada Asaemon Sagiri","Yuzuriha","Aza Chobei","Aza Toma","Yamada Asaemon Shion","Yamada Asaemon Tenza","Tamiya Gantetsusai","Rien","Mei","Yamada Asaemon Fuchi","Nurugai","Yamada Asaemon Senta","Yamada Asaemon Eizen","Yamada Asaemon Genji","Yamada Asaemon Kisho","Yamada Asaemon Jikka","Yamada Asaemon Shugen","Isuzu","Kiyomaru","Zhu Jin","Mu Dan","Ju Fa","Tao Fa","Gui Fa"],"gachiakuta":["Rudo Surebrec","Enjin","Zanka Nijiku","Riyo Reaper","Jabber Wonger","Zodyl Typhon","Tamsy Caines","Semiu Grier","Regto Surebrec","Amo Empool","Delmon","Bro","Dear","Guita","Gris","Follo","Tomme","Corvus","August","Eishia","Cthoni","Noerde","Fu","Bundus","Chiwa","Alice","Remlin"],"jjk":["Yuji Itadori","Megumi Fushiguro","Nobara Kugisaki","Satoru Gojo","Yuta Okkotsu","Maki Zenin","Suguru Geto","Ryomen Sukuna","Mahito","Kento Nanami","Toji Fushiguro","Aoi Todo","Toge Inumaki","Panda","Masamichi Yaga","Shoko Ieiri","Kiyotaka Ijichi","Atsuya Kusakabe","Mai Zenin","Kasumi Miwa","Mechamaru","Noritoshi Kamo","Momo Nishimiya","Utahime Iori","Kenjaku","Riko Amanai","Jogo","Hanami","Dagon","Choso","Eso","Kechizu","Uraume","Mei Mei","Ui Ui","Yuki Tsukumo","Tengen","Naobito Zenin","Naoya Zenin","Ogi Zenin","Jinichi Zenin","Kinji Hakari","Hiromi Higuruma","Hajime Kashimo","Reggie Star","Angel"],"tensura":["Rimuru Tempest","Veldora Tempest","Milim Nava","Diablo","Benimaru","Shion","Guy Crimson","Luminous Valentine","Hinata Sakaguchi","Gobta","Shizue Izawa","Shuna","Souei","Hakuro","Kurobe","Rigurd","Rigur","Ranga","Geld","Gabiru","Testarossa","Carrera","Ultima","Zegion","Apito","Kumara","Adalmann","Ramiris","Leon Cromwell","Dagruel","Dino","Frey","Carrion","Clayman","Chloe Aubert","Yuuki Kagurazaka","Kagali","Laplace","Tear","Footman","Velgrynd","Velzard","Treyni","Beretta","Kaijin","Gazel Dwargo"],"sao":["Kirito","Asuna Yuuki","Sinon","Leafa","Klein","Agil","Yuuki Konno","Alice Zuberg","Eugeo","Heathcliff","Yui","Silica","Lisbeth","Sachi","Argo","Diavel","Kibaou","Oberon","Death Gun","XaXa","Vassago Casals","Selka Zuberg","Ronie Arabel","Tiese Shtolienen","Cardinal","Administrator","Chudelkin","Bercouli Synthesis One","Fanatio Synthesis Two","Deusolbert","Gabriel Miller"],"tokyoghoul":["Ken Kaneki","Touka Kirishima","Kishou Arima","Juuzou Suzuya","Eto Yoshimura","Shu Tsukiyama","Hinami Fueguchi","Ayato Kirishima","Kotaro Amon","Nishiki Nishio","Rize Kamishiro","Hideyoshi Nagachika","Kimi Nishino","Yoshimura","Renji Yomo","Uta","Itori","Roma Hoito","Kaya Irimi","Enji Koma","Akira Mado","Kureo Mado","Seidou Takizawa","Yukinori Shinohara","Iwao Kuroiwa","Koori Ui"],"jojo":["Jonathan Joestar","Joseph Joestar","Jotaro Kujo","Josuke Higashikata","Giorno Giovanna","Jolyne Cujoh","Johnny Joestar","Josuke Higashikata Gappy","Dio Brando","Robert E. O. Speedwagon","Will A. Zeppeli","Erina Pendleton","Dire","Straizo","Caesar Zeppeli","Lisa Lisa","Rudol von Stroheim","Santana","Wamuu","Esidisi","Kars","Suzi Q","Muhammad Avdol","Noriaki Kakyoin","Jean Pierre Polnareff","Iggy","Hol Horse","Enya","Vanilla Ice","Oingo","Boingo","Mariah","Pet Shop","Koichi Hirose","Okuyasu Nijimura","Rohan Kishibe","Yukako Yamagishi","Shigekiyo Yangu","Tonio Trussardi","Akira Otoishi","Reimi Sugimoto","Yoshikage Kira","Bruno Bucciarati","Guido Mista","Narancia Ghirga","Leone Abbacchio","Pannacotta Fugo","Trish Una","Diavolo","Vinegar Doppio","Risotto Nero","Prosciutto","Pesci","Ghiaccio","Melone","Formaggio","Illuso","Ermes Costello","Foo Fighters","Weather Report","Narciso Anasui","Emporio Alnino","Enrico Pucci","Gyro Zeppeli","Diego Brando","Funny Valentine","Hot Pants","Lucy Steel"]};
const DLE_MASTER_ALIASES = {"naruto":{"itachi uchiwa":"itachi uchiha","madara uchiwa":"madara uchiha","rikudo":"hagoromo otsutsuki","zetsu noir":"black zetsu","obito uchiwa":"obito uchiha","fugaku uchiwa":"fugaku uchiha","izumi uchiwa":"izumi uchiha","kagami uchiwa":"kagami uchiha","sarada uchiwa":"sarada uchiha","shisui uchiwa":"shisui uchiha"},"onepiece":{"daz bonez":"daz bones","demaro black":"demalo black","flampe":"charlotte flampe","hogback":"dr hogback","jinbei":"jinbe","lafitte":"laffitte","mjosgard":"donquixote mjosgard","neptune":"king neptune","shepherd ju peter":"saint shepherd ju peter","shutenmaru":"ashura doji","snakeman":"monkey d luffy","tama":"o tama","toko":"o toko","topman warcury":"saint topman warcury","vegapunk atlas":"atlas","vegapunk pythagoras":"pythagoras"},"fairy":{"rogue":"rogue cheney","nineheart":"neinhart"},"chainsaw":{"galgali":"violence fiend"},"dragonball":{"goku":"son goku","gohan":"son gohan","frieza":"freezer"},"tokyorevengers":{"mikey":"manjiro sano","draken":"ken ryuguji","pah chin":"haruki hayashida","peh yan":"ryohei hayashi","smiley":"nahoya kawata","angry":"souya kawata","akkun":"atsushi sendo","mucho":"yasuhiro muto","benkei":"keizo arashi"},"bleach":{"uryu quincy":"uryu ishida","yachiru unohana":"retsu unohana","zaraki kenpachi":"kenpachi zaraki"},"snk":{"eren jager":"eren yeager","grisha jager":"grisha yeager"},"fma":{"wrath":"king bradley"},"pokemon":{"charizard":"dracaufeu","gengar":"ectoplasma","dragonite":"dracolosse"},"gachiakuta":{"rudo":"rudo surebrec","zanka":"zanka nijiku","riyo":"riyo reaper","tamsy":"tamsy caines","semiu":"semiu grier","zodyl":"zodyl typhon","jabber":"jabber wonger","regto":"regto surebrec","amo":"amo empool"},"sao":{"kazuto kirigaya":"kirito","suguha kirigaya":"leafa","akihiko kayaba":"heathcliff","quinella":"administrator"}};


// ================= AnimeDLE V14 — cibles populaires =================
// Jusqu'à environ 100 personnages par univers. Les fiches ne deviennent
// jouables que quand leurs 6 catégories sont réellement remplies.
const DLE_TARGET_NAMES = {"naruto":["Naruto Uzumaki","Sasuke Uchiha","Sakura Haruno","Kakashi Hatake","Itachi Uchiha","Hinata Hyūga","Gaara","Minato Namikaze","Madara Uchiha","Hashirama Senju","Neji Hyūga","Jiraiya","Agara","Ageha","Akahoshi","Akamaru","Akatsuchi","Akino","Anko Mitarashi","Ao","Aoi Rokushô","Arashi Fûma","Ashina Uzumaki","Asura Ōtsutsuki","Asuma Sarutobi","Ayame","Black Zetsu","Boruto Uzumaki","Chino","Chiriku","Chiyo","Chôchô Akimichi","Chôji Akimichi","Chôza Akimichi","Daemon","Danzô Shimura","Darui","Deidara","Denki Kaminarimon","Ebisu","Fû","Fū Yamanaka","Fubuki Kakuyoku","Fugaku Uchiha","Might Guy","Gakidô","Gama","Gamabunta","Gamakichi","Hagoromo Ôtsutsuki","Haku","Hamura Ôtsutsuki","Hanabi Hyûga","Hanzô","Hayate Gekkô","Hiashi Hyûga","Hidan","Himawari Uzumaki","Hiruzen Sarutobi","Ibiki Morino","Indra Ôtsutsuki","Ino Yamanaka","Inoichi Yamanaka","Inojin Yamanaka","Iruka Umino","Izumi Uchiha","Jigen","Akebino","Jinpachi Munashi","Jirôbô","Jirocho","Jōseki","Jûbi","Jûgo","Jūjin","Jūzō Biwa","Kabuto Yakushi","Kagami Uchiha","Kagari","Kaguya Ôtsutsuki","Kakuzu","Kankurô","Karin Uzumaki","Karui","Katsuyu","Kawaki","Kiba","Killer Bee","Kimimaro","Kisame Hoshigaki","Konan","Konohamaru Sarutobi","Kurama","Kurenaï","Kushina Uzumaki","Matatabi","Meï Terumi","Metal Lee","Might Duy","Mito Uzumaki"],"onepiece":["Monkey D. Luffy","Roronoa Zoro","Nami","Sanji","Nico Robin","Trafalgar D. Water Law","Shanks","Portgas D. Ace","Marshall D. Teach","Kaido","Boa Hancock","Sabo","Abdullah","Absalom","Ain","Aisa","Aladine","Alpacaman","Alvida","Charlotte Amande","Andre","Aphelandra","Aramaki","Arlong","Ashura Doji","Atlas","Atmos","Avalo Pizarro","Axe-Hand Morgan","Babanuki","Baby 5","Baccarat","Baggaley","Bakkin","Bao Huang","Bariete","Bartholomew Kuma","Bartolomeo","Basil Hawkins","Bastille","Batman","Bellamy","Bell-mère","Belo Betty","Benn Beckman","Bentham","Bepo","Big Pan","Billy","Binz","Black Maria","Blackback","Blamenco","Blenheim","Blue Gilly","Blueno","Boa Marigold","Boa Sandersonia","Bobbin","Bogard","Jewelry Bonney","Boo","Boodle","Borsalino","Brannew","Briscola","Brogy","Brook","Brownbeard","Buchi","Buffalo","Buggy","Byrnndi World","Cabaji","Caesar Clown","Caimanlady","Kalgara","Camie","Capone Bege","Caribou","Carina","Carmel","Carne","Carrot","Catarina Devon","Cavendish","Chaka","Charlos","Charlotte Anana","Charlotte Anglais","Charlotte Basans","Charlotte Bavarois","Charlotte Brownie","Charlotte Brûlée","Charlotte Chiboust","Charlotte Chiffon","Charlotte Cinnamon","Charlotte Citron","Charlotte Compote","Charlotte Counter"],"hxh":["Gon Freecss","Killua Zoldyck","Kurapika","Leorio Paradinight","Hisoka Morow","Chrollo Lucilfer","Illumi Zoldyck","Meruem","Isaac Netero","Neferpitou","Ging Freecss","Kite","Biscuit Krueger","Zeno Zoldyck","Silva Zoldyck","Kikyo Zoldyck","Milluki Zoldyck","Alluka Zoldyck","Nanika","Kalluto Zoldyck","Gotoh","Canary","Tsubone","Amane","Satotz","Menchi","Buhara","Lippo","Hanzo","Pokkle","Ponzu","Tonpa","Bodoro","Geretta","Melody","Basho","Squala","Baise","Dalzollene","Neon Nostrade","Light Nostrade","Nobunaga Hazama","Feitan Portor","Machi Komacine","Phinks Magcub","Franklin Bordeau","Shizuku Murasaki","Bonolenov Ndongo","Pakunoda","Uvogin","Shalnark","Kortopi","Razor","Genthru","Sub","Bara","Tsezguerra","Goreinu","Abengane","Shaiapouf","Menthuthuyoupi","Colt","Reina","Cheetu","Leol","Welfin","Bloster","Ikalgo","Meleoron","Zazan","Pike","Rammot","Morel Mackernasey","Knov","Knuckle Bine","Shoot McMahon","Palm Siberia","Komugi","Gyro"],"sds":["Meliodas","Ban","King","Diane","Gowther","Merlin","Escanor","Elizabeth Liones","Zeldris","Estarossa","Mael","Hawk","Aldrich","Anne","Arthur Pendragon","Bartra Liones","Bellion","Burgie","Cain Barzad","Cath","Chandler","Chaos","Dale","Dalmally","Dana","Derieri","Dolores","Dreyfus","Drole","Elaine","Fraudrin","Galand","Gilthunder","Gloxinia","Griamore","Guila","Howzer","Hawk Mama","Helbram","Hendrickson","Jericho","Lancelot","Liz","Margaret Liones","Matrona","Melascula","Monspeet","Slader","Tristan","Twigo","Veronica Liones","Vivian","Zaneri","Zaratras","Zhivago","Aranak","Arden","Arthur's sword","Atra","Baltra","Ban's father","Bartra's daughter","Camelot Knight","Cath Palug","Caulifla","Chaos Arthur","Chion","Cusack","Cusack's apprentice","Dahaka","Dahlia","Daz","Deathpierce","Deldry","Demon King","Denzel","Denzel Liones","Dogedo","Dolor","Donny","Doronach","Dubs","Edlin","Elaine's brother","Elizabeth reincarnation","Elizabeth's mother","Ellatte","Escanor's brother","Fiddich","Fraudrin's host","Friesia","Galand's petrification","Galla","Gannon","Gara","Gawain","Gelda","Gerharde","Gerheade","Golgius"],"fairy":["Natsu Dragneel","Lucy Heartfilia","Gray Fullbuster","Erza Scarlet","Wendy Marvell","Gajeel Redfox","Laxus Dreyar","Juvia Lockser","Mirajane Strauss","Makarov Dreyar","Sting Eucliffe","Rogue Cheney","Acnologia","Aldoron","Alzack Connell","Angel","Anna Heartfilia","Aquarius","Arcadios","Aries","Athena","Bisca Connell","Blue Note","Cana Alberona","Cancer","Capricorn","Carla","Cobra","Coco","Deliora","Droy","Duke Barbaroa","Elfman","Eve Tearm","Evergreen","Mavis Vermillion","Freed Justine","Frosch","Gemini","Gildarts Clive","Hades","Happy","Ichiya","Igneel","Jellal Fernandes","Jose Porla","Jura Neekis","Kagura Mikazuchi","Lector","Loke","Lyon Vastia","Macao Conbolt","Mest Gryder","Metalicana","Nadi","Neinhart","Nichiya","Org","Panther Lily","Racer","Ren Akatsuki","Romeo Conbolt","Scorpio","Sherria Blendy","Silver","Tauros","Virgo","Wakaba Mine","Wally Buchanan","Warren Rocko","Warrod Sequen","Weisslogia","Wolfheim","Yajima","Yomazu","Yuka Suzuki","Yukino Agria","Yuri Dreyar","Yury","Zancrow","Zentopia","Zera","Zeref Dragneel","Zero","Zirconis","Zoldeo","Ajeel Raml","Angel Sorano","Arana Webb","Aria","Asuka Connell","Atlas Flame","August","Azuma","Belno","Belserion","Beth Vanderwood","Bickslow","Bloodman","Bluenote Stinger"],"chainsaw":["Denji","Power","Aki Hayakawa","Makima","Kobeni Higashiyama","Himeno","Reze","Katana Man","Angel Devil","Pochita","Kishibe","Hirokazu Arai","Madoka","Beam","Violence Fiend","Princi","Future Devil","Curse Devil","Fox Devil","Ghost Devil","Akane Sawatari","Quanxi","Cosmo","Pingtsi","Long","Tsugihagi","Santa Claus","Tolka","Aldo","Asa Mitaka","Yoru","Nayuta","Hirofumi Yoshida","Fami","Haruka Iseumi","Seigi Akoku","Nobana Higashiyama","Barem Bridge","Miri Sugo","Whip Hybrid","Spear Hybrid"],"dragonball":["Son Goku","Vegeta","Son Gohan","Piccolo","Freezer","Cell","Majin Buu","Beerus","Jiren","Broly","Gogeta","Vegito","Goten","Trunks","Future Trunks","Krillin","Tien Shinhan","Chiaotzu","Yamcha","Master Roshi","Bulma","Chi-Chi","Videl","Pan","Mr. Satan","Uub","Bardock","Gine","Raditz","Nappa","King Vegeta","Tarble","King Cold","Cooler","Zarbon","Dodoria","Captain Ginyu","Jeice","Burter","Recoome","Guldo","Android 16","Android 17","Android 18","Android 19","Dr. Gero","Babidi","Dabura","Supreme Kai","Kibito","Whis","Champa","Vados","Zeno","Grand Priest","Hit","Cabba","Caulifla","Kale","Kefla","Frost","Botamo","Magetta","Toppo","Dyspo","Goku Black","Zamasu","Fused Zamasu","Paragus","Gotenks","Moro","Merus","Granolah","Gas","Elec"],"haikyuu":["Shoyo Hinata","Tobio Kageyama","Kei Tsukishima","Yu Nishinoya","Toru Oikawa","Wakatoshi Ushijima","Kotaro Bokuto","Kenma Kozume","Tetsuro Kuroo","Atsumu Miya","Osamu Miya","Kiyoomi Sakusa","Tadashi Yamaguchi","Daichi Sawamura","Koshi Sugawara","Asahi Azumane","Ryunosuke Tanaka","Chikara Ennoshita","Hisashi Kinoshita","Kazuhito Narita","Kiyoko Shimizu","Hitoka Yachi","Ittetsu Takeda","Keishin Ukai","Hajime Iwaizumi","Issei Matsukawa","Takahiro Hanamaki","Shinji Watari","Shigeru Yahaba","Yutaro Kindaichi","Akira Kunimi","Morisuke Yaku","Nobuyuki Kai","Taketora Yamamoto","Shohei Fukunaga","Lev Haiba","So Inuoka","Tamahiko Teshiro","Keiji Akaashi","Akinori Konoha","Satori Tendo","Tsutomu Goshiki","Kenjiro Shirabu","Eita Semi","Reon Ohira","Taichi Kawanishi","Shinsuke Kita","Rintaro Suna","Aran Ojiro","Korai Hoshiumi","Sachiro Hirugami","Motoya Komori","Takanobu Aone","Kenji Futakuchi","Kanji Koganegawa","Yuji Terushima","Suguru Daisho"],"opm":["Saitama","Genos","Tatsumaki","Bang","King","Fubuki","Garou","Boros","Mumen Rider","Flashy Flash","Bomb","Blast","Atomic Samurai","Child Emperor","Metal Knight","Zombieman","Drive Knight","Pig God","Superalloy Darkshine","Watchdog Man","Tanktop Master","Metal Bat","Puri-Puri Prisoner","Amai Mask","Iaian","Okamaitachi","Bushidrill","Spring Mustachio","Golden Ball","Tanktop Tiger","Tanktop Black Hole","Speed-o'-Sound Sonic","Suiryu","Melzargard","Geryuganshoop","Groribas","Orochi","Psykos","Gyoro Gyoro","Black Sperm","Homeless Emperor","Elder Centipede","Gouketsu","Fuhrer Ugly","Nyan","Phoenix Man","Deep Sea King","Vaccine Man","Carnage Kabuto","Mosquito Girl","Beast King","Armored Gorilla","Dr. Genus"],"tokyorevengers":["Takemichi Hanagaki","Manjiro Sano","Ken Ryuguji","Keisuke Baji","Chifuyu Matsuno","Takashi Mitsuya","Kazutora Hanemiya","Tetta Kisaki","Izana Kurokawa","Taiju Shiba","Haruki Hayashida","Ryohei Hayashi","Nahoya Kawata","Souya Kawata","Hakkai Shiba","Atsushi Sendo","Takuya Yamamoto","Makoto Suzuki","Kazushi Yamagishi","Hinata Tachibana","Naoto Tachibana","Emma Sano","Shinichiro Sano","Shuji Hanma","Nobutaka Osanai","Yuzuha Shiba","Seishu Inui","Hajime Kokonoi","Kakucho","Kanji Mochizuki","Shion Madarame","Ran Haitani","Rindo Haitani","Yasuhiro Muto","Haruchiyo Sanzu","South Terano","Senju Kawaragi","Takeomi Akashi","Wakasa Imaushi","Keizo Arashi"],"bleach":["Ichigo Kurosaki","Rukia Kuchiki","Renji Abarai","Byakuya Kuchiki","Toshiro Hitsugaya","Kenpachi Zaraki","Sosuke Aizen","Uryu Ishida","Grimmjow Jaegerjaquez","Ulquiorra Cifer","Kisuke Urahara","Yhwach","Acidwire","Akon","As Nodt","Asguiaro Ebern","Ashido Kano","Askin","Bambietta Basterbine","Baraggan Louisenbairn","Bazz-B","BG9","Bonnie","Chojiro Sasakibe","Cirucci Sanderwicci","Coyote Starrk","Cyan Sung-Sun","Danon","Di Roy Rinker","Edrad Liones","Eikichirō Saidō","Ganryu","Garogai","Genryusai Shigekuni Yamamoto","Gerard Valkyrie","Gin Ichimaru","Ginrei Kuchiki","Giriko Kutsuzawa","Giselle Gewelle","Grand Fisher","Gremmy Thoumeaux","Shuhei Hisagi","Hisana Kuchiki","Ichibe Hyosube","Isane Kotetsu","Isshin Kurosaki","Jugram Haschwalth","Jushiro Ukitake","Lille Barro","Oetsu Nimaiya","Orihime Inoue","Ouko Yushima","Pernida Parnkgjas","Rangiku Matsumoto","Retsu Unohana","Shinji Hirako","Shunsui Kyoraku","Sode no Shirayuki","Soi Fon","Soken Ishida","Soul King","Szayelaporro Granz","Tier Harribel","Wabisuke","Yachiru Kusajishi","Yoruichi Shihoin","Yylfordt Granz","Zangetsu","Zennosuke Kurumadani","Zommari Rureaux","Mayuri Kurotsuchi","Aaroniero Arruruerie","Abirama Redder","Askin Nakk Le Vaar","Aura Michibane","Baishin","Baura","Bawabawa","Berenice Gabrielli","Candice Catnipp","Cang Du","Charlotte Chuhlhourne","Chizuru Honsho","Choe Neng Poww","Don Kanonji","Dondochakka Bilstin","Dondochakka Birstanne","Dordoni Alessandro Del Socaccio","Driscoll Berci","D-Roy Linker","Emilou Apacci","Enryu","Enzo","Fērum","Findorr Calius","Fishbone D","Franceska Mila Rose","Ganju Shiba","Gantenbainne Mosqueda","Genshiro Okikiba"],"snk":["Eren Yeager","Mikasa Ackerman","Armin Arlert","Levi Ackerman","Reiner Braun","Annie Leonhart","Zeke Yeager","Erwin Smith","Hange Zoë","Jean Kirstein","Connie Springer","Sasha Blouse","Historia Reiss","Ymir","Bertholdt Hoover","Marco Bott","Floch Forster","Petra Ral","Oluo Bozado","Eld Jinn","Gunther Schultz","Miche Zacharius","Moblit Berner","Keith Shadis","Dot Pixis","Darius Zackly","Kenny Ackerman","Rod Reiss","Frieda Reiss","Grisha Yeager","Dina Fritz","Pieck Finger","Porco Galliard","Marcel Galliard","Gabi Braun","Falco Grice","Theo Magath","Yelena","Onyankopon","Niccolo","Nanaba","Nile Dok","Uri Reiss","Carla Jäger","Eren Kruger","Zeke Jäger","Colt Grice","Willy Tybur","Lara Tybur","Ymir Fritz"],"deathnote":["Light Yagami","L Lawliet","Misa Amane","Near","Mello","Ryuk","Rem","Teru Mikami","Soichiro Yagami","Touta Matsuda","Sachiko Yagami","Sayu Yagami","Shuichi Aizawa","Kanzo Mogi","Hideki Ide","Hirokazu Ukita","Watari","Kiyomi Takada","Naomi Misora","Raye Penber","Kyosuke Higuchi","Reiji Namikawa","Wedy","Aiber","Matt","Sidoh","Gelus"],"cote":["Kiyotaka Ayanokoji","Suzune Horikita","Kikyo Kushida","Kei Karuizawa","Kakeru Ryuen","Arisu Sakayanagi","Honami Ichinose","Rokusuke Koenji","Manabu Horikita","Miyabi Nagumo","Yosuke Hirata","Ken Sudo","Kanji Ike","Haruki Yamauchi","Airi Sakura","Akito Miyake","Haruka Hasebe","Keisei Yukimura","Chiaki Matsushita","Maya Sato","Kokoro Inogashira","Kohei Katsuragi","Masayoshi Hashimoto","Masumi Kamuro","Mio Ibuki","Albert Yamada","Daichi Ishizaki","Hiyori Shiina","Ryuji Kanzaki","Chie Hoshinomiya","Sae Chabashira","Takuya Yagami","Ichika Amasawa","Nanase Tsubasa","Kazuomi Hosen","Fuka Kiryuin"],"solo":["Sung Jinwoo","Cha Hae-In","Choi Jong-In","Baek Yoonho","Yoo Jinho","Thomas Andre","Liu Zhigang","Igris","Beru","Antares","Sung Jinah","Park Kyung-Hye","Lee Joohee","Song Chi-Yul","Kim Sangshik","Hwang Dongsuk","Kang Taeshik","Hwang Dongsoo","Woo Jinchul","Go Gunhee","Lim Tae-Gyu","Ma Dongwook","Min Byung-Gyu","Christopher Reed","Siddharth Bachchan","Norma Selner","Bellion","Tusk","Iron","Tank","Greed","Kaisel","Ashborn","Baran","Rakan","Sillad","Querehsha","Tarnak","Legia","Yogumunt","Kandiaru","Esil Radiru","Kamish","Architect"],"clover":["Asta","Yuno","Noelle Silva","Yami Sukehiro","Luck Voltia","Magna Swing","Fuegoleon Vermillion","Mereoleona Vermillion","Julius Novachrono","Nacht Faust","Finral Roulacase","Vanessa Enoteca","Acier Silva","Alecdora Sandler","Charlotte Roselei","Charmy Pappitson","Ciel Grinberryall","Conrad Leto","Damnatio Kira","Dante Zogratis","Fana","Ichika Yami","Jack the Ripper","Kirsch Vermillion","Klaus Lunettes","Langris Vaude","Leopold Vermillion","Licht","Liebe","Lilith","Lolopechka","Lucifero","Lucius Zogratis","Marx Francois","Megicula","Mimosa Vermillion","Nero","Nozel Silva","Rill Boismortier","Sekke Bronzazza","Sister Lily","Sister Theresa","Undine","Vanica Zogratis","William Vangeance","Zenon Zogratis","Adrammelech","Allen Fiarain","Aruru","Asta's parents","Augustus Kira Clover XIII","Baro","Baro's gang","Baval","Beelzebub","Broccos","Catherine","Charla","Charlotte's squad","Clover Kingdom Magic Knights","Daizaemon O'oka","David Swallow","Devil Adrammelech","Devil Beelzebub","Devil Lilith","Devil Lucifero","Devil Megicula","Devil Naamah","Diamond Kingdom Shining Generals","Digit Taliss","Dominante Code","Dorothy Unsworth","Drowa","Dryad","Eclat","Ecthel","Edward Avalache","Elf Charla","Elf Drowa","Elf Eclat","Elf Fana","Elf Kivn","Elf Licht","Elf Patolli","Elf Rhya","Elf Ronne","Elf Vetto","En Ringard","Fanzell Kruger","Father Fuego","Father Orsi Orfai","Floga","Foyal Migusteau","Fragil Tormenta","Fuegoleon's squad","Fujio","Gaderois Godroc","Gadjah","Gaja","Gauche Adlai"],"fireforce":["Shinra Kusakabe","Arthur Boyle","Maki Oze","Tamaki Kotatsu","Akitaru Obi","Takehisa Hinawa","Benimaru Shinmon","Leonard Burns","Sho Kusakabe","Haumea","Iris","Viktor Licht","Vulcan Joseph","Lisa Isaribe","Yu","Konro Sagamiya","Hibana","Karim Flam","Rekka Hoshimiya","Ogun Montgomery","Pan Ko Paat","Joker","Charon","Arrow","Inca Kasugatani","Ritsu","Yona","Assault","Dragon","Giovanni","Nataku Son","Kurono Yuichiro","Amaterasu"],"mushoku":["Rudeus Greyrat","Roxy Migurdia","Sylphiette","Eris Boreas Greyrat","Ruijerd Superdia","Orsted","Paul Greyrat","Ghislaine Dedoldia","Nanahoshi Shizuka","Zenith Greyrat","Lilia Greyrat","Norn Greyrat","Aisha Greyrat","Hitogami","Kishirika Kishirisu","Badigadi","Luke Notos Greyrat","Zanoba Shirone","Elinalise Dragonroad","Philip Boreas Greyrat","Hilda Boreas Greyrat","Sauros Boreas Greyrat","Perugius Dola","Almanfi","Soldat Heckler","Sara","Linia Dedoldia","Pursena Adoldia","Pax Shirone","Randolph Marianne","Atofe","Ariel Anemoi Asura","Cliff Grimoire","Julie","Talhand","Geese Nukadia"],"rezero":["Subaru Natsuki","Emilia","Rem","Ram","Beatrice","Roswaal L. Mathers","Reinhard van Astrea","Crusch Karsten","Priscilla Barielle","Regulus Corneas","Puck","Otto Suwen","Garfiel Tinsel","Frederica Baumann","Petra Leyte","Patrasche","Felt","Felix Argyle","Wilhelm van Astrea","Theresia van Astrea","Anastasia Hoshin","Julius Juukulius","Ricardo Welkin","Mimi","Hetaro","Tivey","Al","Echidna","Satella","Minerva","Typhon","Daphne","Sekhmet","Carmilla","Pandora","Petelgeuse Romanee-Conti","Sirius Romanee-Conti","Capella Emerada Lugunica","Lye Batenkaitos","Roy Alphard","Louis Arneb","Elsa Granhiert","Meili Portroute"],"bluelock":["Yoichi Isagi","Rin Itoshi","Meguru Bachira","Seishiro Nagi","Reo Mikage","Shoei Barou","Hyoma Chigiri","Ryusei Shidou","Michael Kaiser","Sae Itoshi","Oliver Aiku","Gin Gagamaru","Rensuke Kunigami","Jyubei Aryu","Aoshi Tokimitsu","Ikki Niko","Raichi Jingo","Tabito Karasu","Eita Otoya","Kenyu Yukimiya","Yo Hiori","Ranze Kurona","Kiyora Jin","Alexis Ness","Don Lorenzo","Charles Chevalier","Noel Noa","Julian Loki","Lavinho","Chris Prince","Marc Snuffy","Jinpachi Ego","Anri Teieri","Gurimu Igarashi","Asahi Naruhaya","Wataru Kuon","Yudai Imamura","Junichi Wanima","Keisuke Wanima","Nijiro Nanase","Shuto Sendou","Miroku Darai","Teppei Neru","Kazuma Niou","Gen Fukaku"],"fma":["Edward Elric","Alphonse Elric","Roy Mustang","Riza Hawkeye","Scar","Winry Rockbell","King Bradley","Greed","Envy","Father","Pinako Rockbell","Van Hohenheim","Trisha Elric","Jean Havoc","Heymans Breda","Vato Falman","Kain Fuery","Maes Hughes","Gracia Hughes","Elicia Hughes","Alex Louis Armstrong","Olivier Mira Armstrong","Buccaneer","Miles","Grumman","Basque Grand","May Chang","Ling Yao","Lan Fan","Fu","Yoki","Tim Marcoh","Izumi Curtis","Sig Curtis","Selim Bradley","Lust","Gluttony","Sloth","Shou Tucker","Nina Tucker","Alexander","Barry the Chopper","Maria Ross","Denny Brosh","Pride"],"wakfu":["Yugo","Tristepin de Percedal","Amalia Sheran Sharm","Evangelyne","Ruel Stroud","Adamai","Qilby","Nox","Oropo","Goultard","Az","Grougaloragran","Alibert","Shinonome","Phaeris","Chibi","Mina","Glip","Baltazar","Echo","Harebourg","Ush Galesh","Black Bump","Rubilax","Elely","Flopin","Pin","Joris Jurgen","Kerubim Crepin","Atcham","Remington Smisse","Grany Smisse","Maskemane","Kabrok","Miranda","Armand Sheran Sharm","Aurora","Moon"],"demonslayer":["Tanjiro Kamado","Nezuko Kamado","Zenitsu Agatsuma","Inosuke Hashibira","Giyu Tomioka","Kyojuro Rengoku","Shinobu Kocho","Muzan Kibutsuji","Kokushibo","Akaza","Kanao Tsuyuri","Genya Shinazugawa","Tengen Uzui","Mitsuri Kanroji","Muichiro Tokito","Sanemi Shinazugawa","Gyomei Himejima","Obanai Iguro","Kanae Kocho","Kagaya Ubuyashiki","Amane Ubuyashiki","Sakonji Urokodaki","Sabito","Makomo","Jigoro Kuwajima","Shinjuro Rengoku","Senjuro Rengoku","Doma","Hantengu","Gyokko","Gyutaro","Daki","Nakime","Kaigaku","Enmu","Rui","Kyogai","Susamaru","Yahaba","Tamayo","Yushiro","Yoriichi Tsugikuni","Murata","Aoi Kanzaki","Michikatsu Tsugikuni"],"pokemon":["Pikachu","Dracaufeu","Bulbizarre","Carapuce","Ectoplasma","Mewtwo","Lucario","Gardevoir","Dracolosse","Amphinobi","Rayquaza","Arceus","Raichu","Charmeleon","Wartortle","Blastoise","Caterpie","Butterfree","Pidgeot","Rattata","Spearow","Ekans","Arbok","Sandshrew","Nidoran","Clefairy","Vulpix","Jigglypuff","Zubat","Oddish","Paras","Venonat","Diglett","Meowth","Psyduck","Mankey","Growlithe","Poliwag","Abra","Machop","Bellsprout","Tentacool","Geodude","Ponyta","Slowpoke","Magnemite","Farfetch'd","Doduo","Seel","Grimer","Shellder","Gastly","Haunter","Onix","Drowzee","Krabby","Voltorb","Exeggcute","Cubone","Hitmonlee","Hitmonchan","Lickitung","Koffing","Rhyhorn","Chansey","Tangela","Kangaskhan","Horsea","Goldeen","Staryu","Mr. Mime","Scyther","Jynx","Electabuzz","Magmar","Pinsir","Tauros","Magikarp","Gyarados","Lapras","Ditto","Eevee","Vaporeon","Jolteon","Flareon","Porygon","Omanyte","Kabuto","Aerodactyl","Snorlax","Articuno","Zapdos","Moltres","Dratini","Dragonair","Mew","Lugia","Ho-Oh","Celebi","Groudon"],"hellsparadise":["Gabimaru","Yamada Asaemon Sagiri","Yuzuriha","Aza Chobei","Aza Toma","Yamada Asaemon Shion","Yamada Asaemon Tenza","Tamiya Gantetsusai","Rien","Mei","Yamada Asaemon Fuchi","Nurugai","Yamada Asaemon Senta","Yamada Asaemon Eizen","Yamada Asaemon Genji","Yamada Asaemon Kisho","Yamada Asaemon Jikka","Yamada Asaemon Shugen","Isuzu","Kiyomaru","Zhu Jin","Mu Dan","Ju Fa","Tao Fa","Gui Fa"],"gachiakuta":["Rudo Surebrec","Enjin","Zanka Nijiku","Riyo Reaper","Jabber Wonger","Zodyl Typhon","Tamsy Caines","Semiu Grier","Regto Surebrec","Amo Empool","Delmon","Bro","Dear","Guita","Gris","Follo","Tomme","Corvus","August","Eishia","Cthoni","Noerde","Fu","Bundus","Chiwa","Alice","Remlin"],"jjk":["Yuji Itadori","Megumi Fushiguro","Nobara Kugisaki","Satoru Gojo","Yuta Okkotsu","Maki Zenin","Suguru Geto","Ryomen Sukuna","Mahito","Kento Nanami","Toji Fushiguro","Aoi Todo","Toge Inumaki","Panda","Masamichi Yaga","Shoko Ieiri","Kiyotaka Ijichi","Atsuya Kusakabe","Mai Zenin","Kasumi Miwa","Mechamaru","Noritoshi Kamo","Momo Nishimiya","Utahime Iori","Kenjaku","Riko Amanai","Jogo","Hanami","Dagon","Choso","Eso","Kechizu","Uraume","Mei Mei","Ui Ui","Yuki Tsukumo","Tengen","Naobito Zenin","Naoya Zenin","Ogi Zenin","Jinichi Zenin","Kinji Hakari","Hiromi Higuruma","Hajime Kashimo","Reggie Star","Angel","Kokichi Muta","Yoshinobu Gakuganji","Misato Kuroi","Yu Haibara","Kirara Hoshi","Fumihiko Takaba","Remi","Rin Amai","Iori Hazenoki","Chizuru Hari","Ryu Ishigori","Takako Uro","Dhruv Lakdawalla","Kurourushi","Hana Kurusu","Charles Bernard"],"tensura":["Rimuru Tempest","Veldora Tempest","Milim Nava","Diablo","Benimaru","Shion","Guy Crimson","Luminous Valentine","Hinata Sakaguchi","Gobta","Shizue Izawa","Shuna","Souei","Hakuro","Kurobe","Rigurd","Rigur","Ranga","Geld","Gabiru","Testarossa","Carrera","Ultima","Zegion","Apito","Kumara","Adalmann","Ramiris","Leon Cromwell","Dagruel","Dino","Frey","Carrion","Clayman","Chloe Aubert","Yuuki Kagurazaka","Kagali","Laplace","Tear","Footman","Velgrynd","Velzard","Treyni","Beretta","Kaijin","Gazel Dwargo"],"sao":["Kirito","Asuna Yuuki","Sinon","Leafa","Klein","Agil","Yuuki Konno","Alice Zuberg","Eugeo","Heathcliff","Yui","Silica","Lisbeth","Sachi","Argo","Diavel","Kibaou","Oberon","Death Gun","XaXa","Vassago Casals","Selka Zuberg","Ronie Arabel","Tiese Shtolienen","Cardinal","Administrator","Chudelkin","Bercouli Synthesis One","Fanatio Synthesis Two","Deusolbert","Gabriel Miller","Shino Asada","Sakuya","Alicia Rue","Recon","Nobuyuki Sugou","PoH","Sheyta","Iskahn"],"tokyoghoul":["Ken Kaneki","Touka Kirishima","Kishou Arima","Juuzou Suzuya","Eto Yoshimura","Shu Tsukiyama","Hinami Fueguchi","Ayato Kirishima","Kotaro Amon","Nishiki Nishio","Rize Kamishiro","Hideyoshi Nagachika","Kimi Nishino","Yoshimura","Renji Yomo","Uta","Itori","Roma Hoito","Kaya Irimi","Enji Koma","Akira Mado","Kureo Mado","Seidou Takizawa","Yukinori Shinohara","Iwao Kuroiwa","Koori Ui","Take Hirako","Mougan Tanakamaru","Yakumo Oomori","Jason","Naki","Tatara","Noro","Donato Porpora","Shachi","Haise Sasaki","Kuki Urie","Ginshi Shirazu","Tooru Mutsuki","Saiko Yonebayashi","Shinsanpei Aura","Hairu Ihei","Nimura Furuta","Kanae von Rosewald","Kurona Yasuhisa","Nashiro Yasuhisa"],"jojo":["Jonathan Joestar","Joseph Joestar","Jotaro Kujo","Josuke Higashikata","Giorno Giovanna","Jolyne Cujoh","Johnny Joestar","Josuke Higashikata Gappy","Dio Brando","Robert E. O. Speedwagon","Will A. Zeppeli","Erina Pendleton","Dire","Straizo","Caesar Zeppeli","Lisa Lisa","Rudol von Stroheim","Santana","Wamuu","Esidisi","Kars","Suzi Q","Muhammad Avdol","Noriaki Kakyoin","Jean Pierre Polnareff","Iggy","Hol Horse","Enya","Vanilla Ice","Oingo","Boingo","Mariah","Pet Shop","Koichi Hirose","Okuyasu Nijimura","Rohan Kishibe","Yukako Yamagishi","Shigekiyo Yangu","Tonio Trussardi","Akira Otoishi","Reimi Sugimoto","Yoshikage Kira","Bruno Bucciarati","Guido Mista","Narancia Ghirga","Leone Abbacchio","Pannacotta Fugo","Trish Una","Diavolo","Vinegar Doppio","Risotto Nero","Prosciutto","Pesci","Ghiaccio","Melone","Formaggio","Illuso","Ermes Costello","Foo Fighters","Weather Report","Narciso Anasui","Emporio Alnino","Enrico Pucci","Gyro Zeppeli","Diego Brando","Funny Valentine","Hot Pants","Lucy Steel"]};

// ================= AnimeDLE V15 — fiches Naruto réellement remplies =================
// Ici ce ne sont plus des "cibles à enrichir" : les 100 fiches sont déjà dans server.js,
// avec les 6 catégories remplies. Elles sont donc jouables immédiatement.
const DLE_STATIC_PROFILES = {
    naruto: {"Naruto Uzumaki":{"c0":"Konoha","c1":"Hokage","c2":"Uzumaki","c3":"Vent (puis cinq natures)","c4":"Aucun","c5":"Oui — Kurama"},"Sasuke Uchiha":{"c0":"Konoha","c1":"Shinobi indépendant","c2":"Uchiha","c3":"Feu, Foudre","c4":"Sharingan, Rinnegan","c5":"Non"},"Sakura Haruno":{"c0":"Konoha","c1":"Jōnin / ninja médecin","c2":"Haruno","c3":"Terre, Eau","c4":"Aucun","c5":"Non"},"Kakashi Hatake":{"c0":"Konoha","c1":"Ancien Hokage / Jōnin","c2":"Hatake","c3":"Foudre, Terre, Eau, Feu, Vent","c4":"Sharingan (greffé, ancien)","c5":"Non"},"Itachi Uchiha":{"c0":"Konoha / Akatsuki","c1":"ANBU / Nukenin","c2":"Uchiha","c3":"Feu, Eau","c4":"Mangekyō Sharingan","c5":"Non"},"Hinata Hyūga":{"c0":"Konoha","c1":"Chūnin","c2":"Hyūga","c3":"Feu, Foudre","c4":"Byakugan","c5":"Non"},"Gaara":{"c0":"Suna","c1":"Kazekage","c2":"Famille du Kazekage","c3":"Vent, Terre, Magnétisme","c4":"Aucun","c5":"Ancien — Shukaku"},"Minato Namikaze":{"c0":"Konoha","c1":"Hokage","c2":"Namikaze","c3":"Feu, Vent, Foudre","c4":"Aucun","c5":"Non"},"Madara Uchiha":{"c0":"Konoha / Akatsuki","c1":"Chef Uchiha / Nukenin","c2":"Uchiha","c3":"Cinq natures, Yin-Yang","c4":"Mangekyō éternel, Rinnegan","c5":"Ancien — Jūbi"},"Hashirama Senju":{"c0":"Konoha","c1":"Hokage","c2":"Senju","c3":"Eau, Terre, Mokuton, Yin-Yang","c4":"Aucun","c5":"Non"},"Neji Hyūga":{"c0":"Konoha","c1":"Jōnin","c2":"Hyūga","c3":"Feu, Eau","c4":"Byakugan","c5":"Non"},"Jiraiya":{"c0":"Konoha","c1":"Sannin","c2":"Aucun","c3":"Feu, Terre, Eau, Vent","c4":"Aucun","c5":"Non"},"Orochimaru":{"c0":"Konoha / Oto","c1":"Sannin / Nukenin","c2":"Aucun","c3":"Cinq natures, Yin-Yang","c4":"Aucun","c5":"Non"},"Tsunade":{"c0":"Konoha","c1":"Hokage / Sannin","c2":"Senju","c3":"Foudre, Terre, Eau, Feu","c4":"Aucun","c5":"Non"},"Shikamaru Nara":{"c0":"Konoha","c1":"Jōnin / conseiller","c2":"Nara","c3":"Feu, Terre, Yin","c4":"Aucun","c5":"Non"},"Ino Yamanaka":{"c0":"Konoha","c1":"Chūnin / ninja sensoriel","c2":"Yamanaka","c3":"Terre, Eau, Yin, Yang","c4":"Aucun","c5":"Non"},"Chōji Akimichi":{"c0":"Konoha","c1":"Chūnin","c2":"Akimichi","c3":"Feu, Terre, Yang","c4":"Aucun","c5":"Non"},"Rock Lee":{"c0":"Konoha","c1":"Jōnin","c2":"Aucun","c3":"Non élémentaire — taijutsu","c4":"Aucun","c5":"Non"},"Might Guy":{"c0":"Konoha","c1":"Jōnin","c2":"Aucun","c3":"Feu, Foudre","c4":"Aucun","c5":"Non"},"Tenten":{"c0":"Konoha","c1":"Chūnin","c2":"Aucun","c3":"Feu, Eau","c4":"Aucun","c5":"Non"},"Kiba Inuzuka":{"c0":"Konoha","c1":"Chūnin","c2":"Inuzuka","c3":"Terre, Yang","c4":"Aucun","c5":"Non"},"Shino Aburame":{"c0":"Konoha","c1":"Chūnin / professeur","c2":"Aburame","c3":"Terre, Feu, Yang","c4":"Aucun","c5":"Non"},"Asuma Sarutobi":{"c0":"Konoha","c1":"Jōnin","c2":"Sarutobi","c3":"Vent, Feu","c4":"Aucun","c5":"Non"},"Kurenai Yūhi":{"c0":"Konoha","c1":"Jōnin","c2":"Yūhi","c3":"Yin","c4":"Aucun","c5":"Non"},"Hiruzen Sarutobi":{"c0":"Konoha","c1":"Hokage","c2":"Sarutobi","c3":"Cinq natures, Yin-Yang","c4":"Aucun","c5":"Non"},"Konohamaru Sarutobi":{"c0":"Konoha","c1":"Jōnin","c2":"Sarutobi","c3":"Feu, Vent, Foudre, Yang","c4":"Aucun","c5":"Non"},"Iruka Umino":{"c0":"Konoha","c1":"Chūnin / professeur","c2":"Umino","c3":"Feu, Eau, Yin","c4":"Aucun","c5":"Non"},"Sai":{"c0":"Konoha","c1":"ANBU / Jōnin","c2":"Yamanaka","c3":"Terre, Eau, Feu, Yang","c4":"Aucun","c5":"Non"},"Yamato":{"c0":"Konoha","c1":"ANBU / Jōnin","c2":"Aucun","c3":"Eau, Terre, Mokuton","c4":"Aucun","c5":"Non"},"Danzō Shimura":{"c0":"Konoha","c1":"Chef de la Racine","c2":"Shimura","c3":"Vent, Terre, Eau, Feu","c4":"Sharingan (greffés)","c5":"Non"},"Obito Uchiha":{"c0":"Konoha / Akatsuki","c1":"Nukenin","c2":"Uchiha","c3":"Feu, Vent, Foudre, Terre, Eau, Yin-Yang","c4":"Mangekyō Sharingan, Rinnegan (greffé)","c5":"Ancien — Jūbi"},"Rin Nohara":{"c0":"Konoha","c1":"Chūnin / ninja médecin","c2":"Nohara","c3":"Feu, Eau, Yang","c4":"Aucun","c5":"Temporaire — Isobu"},"Kushina Uzumaki":{"c0":"Konoha","c1":"Kunoichi","c2":"Uzumaki","c3":"Eau, Vent, Yin, Yang","c4":"Aucun","c5":"Ancienne — Kurama"},"Nagato":{"c0":"Ame / Akatsuki","c1":"Chef de l'Akatsuki","c2":"Uzumaki","c3":"Cinq natures, Yin-Yang","c4":"Rinnegan","c5":"Non"},"Konan":{"c0":"Ame / Akatsuki","c1":"Kunoichi / Akatsuki","c2":"Aucun","c3":"Vent, Terre, Eau, Yang","c4":"Aucun","c5":"Non"},"Yahiko":{"c0":"Ame","c1":"Chef d'Ame / fondateur Akatsuki","c2":"Aucun","c3":"Feu, Eau, Vent","c4":"Aucun","c5":"Non"},"Deidara":{"c0":"Iwa / Akatsuki","c1":"Nukenin / Akatsuki","c2":"Aucun","c3":"Terre, Foudre, Bakuton","c4":"Aucun","c5":"Non"},"Sasori":{"c0":"Suna / Akatsuki","c1":"Nukenin / Akatsuki","c2":"Aucun","c3":"Terre, Eau","c4":"Aucun","c5":"Non"},"Hidan":{"c0":"Yugakure / Akatsuki","c1":"Nukenin / Akatsuki","c2":"Aucun","c3":"Aucune nature élémentaire","c4":"Aucun","c5":"Non"},"Kakuzu":{"c0":"Taki / Akatsuki","c1":"Nukenin / Akatsuki","c2":"Aucun","c3":"Cinq natures","c4":"Aucun","c5":"Non"},"Kisame Hoshigaki":{"c0":"Kiri / Akatsuki","c1":"Nukenin / Sept Épéistes","c2":"Hoshigaki","c3":"Eau, Terre","c4":"Aucun","c5":"Non"},"Kabuto Yakushi":{"c0":"Konoha / Oto","c1":"Nukenin / espion","c2":"Yakushi","c3":"Cinq natures, Yin-Yang","c4":"Aucun","c5":"Non"},"Killer B":{"c0":"Kumo","c1":"Jinchūriki / shinobi d'élite","c2":"Aucun","c3":"Foudre, Eau, Yang","c4":"Aucun","c5":"Oui — Gyūki"},"A":{"c0":"Kumo","c1":"Raikage","c2":"Aucun","c3":"Foudre","c4":"Aucun","c5":"Non"},"Darui":{"c0":"Kumo","c1":"Raikage","c2":"Aucun","c3":"Foudre, Eau, Ranton","c4":"Aucun","c5":"Non"},"Samui":{"c0":"Kumo","c1":"Chūnin","c2":"Aucun","c3":"Foudre","c4":"Aucun","c5":"Non"},"Omoi":{"c0":"Kumo","c1":"Chūnin","c2":"Aucun","c3":"Foudre","c4":"Aucun","c5":"Non"},"Karui":{"c0":"Kumo / Konoha","c1":"Chūnin","c2":"Aucun","c3":"Foudre","c4":"Aucun","c5":"Non"},"Temari":{"c0":"Suna / Konoha","c1":"Jōnin","c2":"Famille du Kazekage","c3":"Vent","c4":"Aucun","c5":"Non"},"Kankurō":{"c0":"Suna","c1":"Jōnin","c2":"Famille du Kazekage","c3":"Vent, Terre","c4":"Aucun","c5":"Non"},"Chiyo":{"c0":"Suna","c1":"Ancienne / marionnettiste","c2":"Aucun","c3":"Vent, Terre","c4":"Aucun","c5":"Non"},"Rasa":{"c0":"Suna","c1":"Kazekage","c2":"Famille du Kazekage","c3":"Vent, Terre, Magnétisme","c4":"Aucun","c5":"Non"},"Baki":{"c0":"Suna","c1":"Jōnin","c2":"Aucun","c3":"Vent","c4":"Aucun","c5":"Non"},"Mei Terumī":{"c0":"Kiri","c1":"Mizukage","c2":"Terumī","c3":"Eau, Feu, Terre, Futton, Yōton","c4":"Aucun","c5":"Non"},"Ao":{"c0":"Kiri","c1":"Jōnin / capteur","c2":"Aucun","c3":"Eau","c4":"Byakugan (greffé)","c5":"Non"},"Chōjūrō":{"c0":"Kiri","c1":"Mizukage / Sept Épéistes","c2":"Aucun","c3":"Eau","c4":"Aucun","c5":"Non"},"Yagura Karatachi":{"c0":"Kiri","c1":"Mizukage","c2":"Karatachi","c3":"Eau","c4":"Aucun","c5":"Ancien — Isobu"},"Zabuza Momochi":{"c0":"Kiri","c1":"Nukenin / Sept Épéistes","c2":"Momochi","c3":"Eau","c4":"Aucun","c5":"Non"},"Haku":{"c0":"Pays de l'Eau / Kiri","c1":"Nukenin","c2":"Yuki","c3":"Eau, Vent, Hyōton","c4":"Aucun","c5":"Non"},"Suigetsu Hōzuki":{"c0":"Kiri / Taka","c1":"Nukenin","c2":"Hōzuki","c3":"Eau","c4":"Aucun","c5":"Non"},"Karin":{"c0":"Kusa / Taka","c1":"Capteur / Taka","c2":"Uzumaki","c3":"Eau, Terre, Yin, Yang","c4":"Aucun","c5":"Non"},"Jūgo":{"c0":"Oto / Taka","c1":"Taka","c2":"Clan de Jūgo","c3":"Terre, Yang, senjutsu","c4":"Aucun","c5":"Non"},"Mangetsu Hōzuki":{"c0":"Kiri","c1":"Sept Épéistes","c2":"Hōzuki","c3":"Eau","c4":"Aucun","c5":"Non"},"Mū":{"c0":"Iwa","c1":"Tsuchikage","c2":"Aucun","c3":"Vent, Terre, Feu, Jinton","c4":"Aucun","c5":"Non"},"Ōnoki":{"c0":"Iwa","c1":"Tsuchikage","c2":"Aucun","c3":"Vent, Terre, Feu, Jinton","c4":"Aucun","c5":"Non"},"Kurotsuchi":{"c0":"Iwa","c1":"Tsuchikage","c2":"Aucun","c3":"Terre, Feu, Eau, Yōton","c4":"Aucun","c5":"Non"},"Akatsuchi":{"c0":"Iwa","c1":"Jōnin","c2":"Aucun","c3":"Terre","c4":"Aucun","c5":"Non"},"Gengetsu Hōzuki":{"c0":"Kiri","c1":"Mizukage","c2":"Hōzuki","c3":"Eau, Feu, Futton","c4":"Aucun","c5":"Non"},"Hanzō":{"c0":"Ame","c1":"Chef d'Ame","c2":"Aucun","c3":"Feu","c4":"Aucun","c5":"Non"},"Mifune":{"c0":"Pays du Fer","c1":"Général samouraï","c2":"Aucun","c3":"Non élémentaire — kenjutsu","c4":"Aucun","c5":"Non"},"Shisui Uchiha":{"c0":"Konoha","c1":"ANBU","c2":"Uchiha","c3":"Feu, Vent, Foudre","c4":"Mangekyō Sharingan","c5":"Non"},"Fugaku Uchiha":{"c0":"Konoha","c1":"Jōnin / chef de la police","c2":"Uchiha","c3":"Feu, Foudre","c4":"Sharingan","c5":"Non"},"Izuna Uchiha":{"c0":"Clan Uchiha","c1":"Combattant du clan","c2":"Uchiha","c3":"Feu","c4":"Mangekyō Sharingan","c5":"Non"},"Tobirama Senju":{"c0":"Konoha","c1":"Hokage","c2":"Senju","c3":"Eau, Feu, Vent, Foudre, Terre, Yin-Yang","c4":"Aucun","c5":"Non"},"Mito Uzumaki":{"c0":"Konoha","c1":"Kunoichi","c2":"Uzumaki","c3":"Fûinjutsu, Yin-Yang","c4":"Aucun","c5":"Ancienne — Kurama"},"Ashura Ōtsutsuki":{"c0":"Aucun","c1":"Héritier de Hagoromo","c2":"Ōtsutsuki","c3":"Vent, Yin-Yang","c4":"Aucun","c5":"Non"},"Indra Ōtsutsuki":{"c0":"Aucun","c1":"Héritier de Hagoromo","c2":"Ōtsutsuki","c3":"Foudre, Feu, Yin","c4":"Mangekyō Sharingan","c5":"Non"},"Hagoromo Ōtsutsuki":{"c0":"Aucun","c1":"Sage des Six Chemins","c2":"Ōtsutsuki","c3":"Cinq natures, Yin-Yang","c4":"Rinnegan","c5":"Ancien — Jūbi"},"Hamura Ōtsutsuki":{"c0":"Aucun","c1":"Ōtsutsuki","c2":"Ōtsutsuki","c3":"Yin-Yang","c4":"Byakugan","c5":"Non"},"Kaguya Ōtsutsuki":{"c0":"Aucun","c1":"Ōtsutsuki","c2":"Ōtsutsuki","c3":"Cinq natures, Yin-Yang","c4":"Byakugan, Rinne Sharingan","c5":"Ancienne — Jūbi"},"Momoshiki Ōtsutsuki":{"c0":"Aucun","c1":"Ōtsutsuki","c2":"Ōtsutsuki","c3":"Cinq natures, Yin-Yang","c4":"Byakugan, Rinnegan","c5":"Non"},"Kinshiki Ōtsutsuki":{"c0":"Aucun","c1":"Ōtsutsuki","c2":"Ōtsutsuki","c3":"Terre, Yin-Yang","c4":"Byakugan","c5":"Non"},"Isshiki Ōtsutsuki":{"c0":"Aucun / Kara","c1":"Ōtsutsuki","c2":"Ōtsutsuki","c3":"Yin-Yang","c4":"Byakugan, dōjutsu d'Isshiki","c5":"Non"},"Toneri Ōtsutsuki":{"c0":"Lune","c1":"Ōtsutsuki","c2":"Ōtsutsuki","c3":"Vent, Yin-Yang","c4":"Byakugan, Tenseigan","c5":"Non"},"Boruto Uzumaki":{"c0":"Konoha","c1":"Genin","c2":"Uzumaki / Hyūga","c3":"Vent, Foudre, Eau","c4":"Jōgan (anime)","c5":"Non"},"Sarada Uchiha":{"c0":"Konoha","c1":"Chūnin","c2":"Uchiha","c3":"Feu, Foudre","c4":"Sharingan","c5":"Non"},"Mitsuki":{"c0":"Konoha / Oto","c1":"Genin","c2":"Aucun (création d'Orochimaru)","c3":"Vent, Foudre, senjutsu","c4":"Aucun","c5":"Non"},"Kawaki":{"c0":"Konoha / Kara","c1":"Genin / ancien Kara","c2":"Aucun","c3":"Feu, Yin-Yang","c4":"Aucun","c5":"Non"},"Shikadai Nara":{"c0":"Konoha","c1":"Chūnin","c2":"Nara / Kazekage","c3":"Vent, Yin","c4":"Aucun","c5":"Non"},"Inojin Yamanaka":{"c0":"Konoha","c1":"Genin","c2":"Yamanaka","c3":"Eau, Terre, Yang","c4":"Aucun","c5":"Non"},"Chōchō Akimichi":{"c0":"Konoha","c1":"Genin","c2":"Akimichi","c3":"Foudre, Yang","c4":"Aucun","c5":"Non"},"Metal Lee":{"c0":"Konoha","c1":"Genin","c2":"Aucun","c3":"Non élémentaire — taijutsu","c4":"Aucun","c5":"Non"},"Hanabi Hyūga":{"c0":"Konoha","c1":"Jōnin","c2":"Hyūga","c3":"Feu, Foudre","c4":"Byakugan","c5":"Non"},"Hiashi Hyūga":{"c0":"Konoha","c1":"Chef de clan / Jōnin","c2":"Hyūga","c3":"Feu, Foudre","c4":"Byakugan","c5":"Non"},"Kurama":{"c0":"Konoha","c1":"Bijū","c2":"Bijū","c3":"Feu, Vent, Yin-Yang","c4":"Aucun","c5":"Non — c'est un Bijū"},"Shukaku":{"c0":"Suna","c1":"Bijū","c2":"Bijū","c3":"Vent, Terre, Magnétisme","c4":"Aucun","c5":"Non — c'est un Bijū"},"Gyūki":{"c0":"Kumo","c1":"Bijū","c2":"Bijū","c3":"Foudre, Eau","c4":"Aucun","c5":"Non — c'est un Bijū"},"Matatabi":{"c0":"Kumo","c1":"Bijū","c2":"Bijū","c3":"Feu","c4":"Aucun","c5":"Non — c'est un Bijū"},"Isobu":{"c0":"Kiri","c1":"Bijū","c2":"Bijū","c3":"Eau","c4":"Aucun","c5":"Non — c'est un Bijū"},"Son Gokū":{"c0":"Iwa","c1":"Bijū","c2":"Bijū","c3":"Feu, Terre, Yōton","c4":"Aucun","c5":"Non — c'est un Bijū"}}
};

// Pour Naruto, la liste cible = exactement les fiches statiques réellement complètes.
DLE_TARGET_NAMES.naruto = Object.keys(DLE_STATIC_PROFILES.naruto);

// ================= AnimeDLE V16 — extension globale statique =================
// Profils connus ajoutés dans tous les univers, 6 catégories remplies par personnage.
const DLE_STATIC_PROFILES_EXT = {"onepiece":{"Usopp":{"c0":"Chapeau de paille","c1":"Tireur","c2":"Aucun","c3":"Aucun","c4":"Non","c5":"East Blue"},"Tony Tony Chopper":{"c0":"Chapeau de paille","c1":"Médecin","c2":"Hito Hito no Mi","c3":"Zoan","c4":"Non","c5":"Grand Line"},"Franky":{"c0":"Chapeau de paille","c1":"Charpentier","c2":"Aucun","c3":"Aucun","c4":"Non","c5":"South Blue"},"Brook":{"c0":"Chapeau de paille","c1":"Musicien","c2":"Yomi Yomi no Mi","c3":"Paramecia","c4":"Non","c5":"West Blue"},"Jinbe":{"c0":"Chapeau de paille","c1":"Timonier","c2":"Aucun","c3":"Aucun","c4":"Non","c5":"Île des Hommes-Poissons"},"Donquixote Doflamingo":{"c0":"Donquixote Pirates","c1":"Capitaine","c2":"Ito Ito no Mi","c3":"Paramecia","c4":"Oui","c5":"Mary Geoise"},"Charlotte Linlin":{"c0":"Big Mom Pirates","c1":"Capitaine","c2":"Soru Soru no Mi","c3":"Paramecia","c4":"Oui","c5":"Grand Line"},"Charlotte Katakuri":{"c0":"Big Mom Pirates","c1":"Sweet Commander","c2":"Mochi Mochi no Mi","c3":"Paramecia spécial","c4":"Oui","c5":"Grand Line"},"Edward Newgate":{"c0":"Barbe Blanche","c1":"Capitaine","c2":"Gura Gura no Mi","c3":"Paramecia","c4":"Oui","c5":"Grand Line"},"Gol D. Roger":{"c0":"Roger Pirates","c1":"Capitaine","c2":"Aucun","c3":"Aucun","c4":"Oui","c5":"East Blue"},"Monkey D. Garp":{"c0":"Marine","c1":"Vice-amiral","c2":"Aucun","c3":"Aucun","c4":"Oui","c5":"East Blue"},"Sakazuki":{"c0":"Marine","c1":"Amiral en chef","c2":"Magu Magu no Mi","c3":"Logia","c4":"Non","c5":"North Blue"},"Kuzan":{"c0":"Marine/Indépendant","c1":"Ex-amiral","c2":"Hie Hie no Mi","c3":"Logia","c4":"Non","c5":"South Blue"},"Borsalino":{"c0":"Marine","c1":"Amiral","c2":"Pika Pika no Mi","c3":"Logia","c4":"Non","c5":"North Blue"},"Dracule Mihawk":{"c0":"Cross Guild","c1":"Épéiste","c2":"Aucun","c3":"Aucun","c4":"Non","c5":"Grand Line"}},"bleach":{"Orihime Inoue":{"c0":"Humaine","c1":"Karakura","c2":"Aucune","c3":"Shun Shun Rikka","c4":"Non","c5":"Karakura"},"Yoruichi Shihoin":{"c0":"Shinigami","c1":"Ex-Gotei 13","c2":"2e","c3":"Shunko","c4":"Non","c5":"Soul Society"},"Genryusai Shigekuni Yamamoto":{"c0":"Shinigami","c1":"Gotei 13","c2":"1re","c3":"Ryujin Jakka","c4":"Oui","c5":"Soul Society"},"Shunsui Kyoraku":{"c0":"Shinigami","c1":"Gotei 13","c2":"1re","c3":"Katen Kyokotsu","c4":"Oui","c5":"Soul Society"},"Retsu Unohana":{"c0":"Shinigami","c1":"Gotei 13","c2":"4e","c3":"Minazuki","c4":"Oui","c5":"Soul Society"},"Mayuri Kurotsuchi":{"c0":"Shinigami","c1":"Gotei 13","c2":"12e","c3":"Ashisogi Jizo","c4":"Oui","c5":"Soul Society"},"Shinji Hirako":{"c0":"Shinigami","c1":"Gotei 13","c2":"5e","c3":"Sakanade","c4":"Oui","c5":"Soul Society"},"Jugram Haschwalth":{"c0":"Quincy","c1":"Wandenreich","c2":"Sternritter","c3":"The Balance","c4":"Non","c5":"Empire Quincy"},"Bazz-B":{"c0":"Quincy","c1":"Wandenreich","c2":"Sternritter","c3":"The Heat","c4":"Non","c5":"Empire Quincy"},"Coyote Starrk":{"c0":"Arrancar","c1":"Espada","c2":"1","c3":"Los Lobos","c4":"Non","c5":"Hueco Mundo"}},"hxh":{"Ging Freecss":{"c0":"Hunter","c1":"Émission","c2":"Hunter Association","c3":"Polyvalent","c4":"Freecss","c5":"Election"},"Kite":{"c0":"Hunter","c1":"Matérialisation","c2":"Hunter Association","c3":"Crazy Slots","c4":"Aucune","c5":"Yorknew/Chimera Ant"},"Biscuit Krueger":{"c0":"Hunter","c1":"Transformation","c2":"Hunter Association","c3":"Arts martiaux","c4":"Aucune","c5":"Greed Island"},"Zeno Zoldyck":{"c0":"Assassin","c1":"Émission","c2":"Famille Zoldyck","c3":"Dragon Head","c4":"Zoldyck","c5":"Yorknew"},"Silva Zoldyck":{"c0":"Assassin","c1":"Émission","c2":"Famille Zoldyck","c3":"Combat/Orbes d'aura","c4":"Zoldyck","c5":"Zoldyck Family"},"Feitan Portor":{"c0":"Brigand","c1":"Transformation","c2":"Brigade Fantôme","c3":"Pain Packer","c4":"Aucune","c5":"Yorknew"},"Phinks Magcub":{"c0":"Brigand","c1":"Renforcement","c2":"Brigade Fantôme","c3":"Ripper Cyclotron","c4":"Aucune","c5":"Yorknew"},"Machi Komacine":{"c0":"Brigand","c1":"Transformation","c2":"Brigade Fantôme","c3":"Fils de Nen","c4":"Aucune","c5":"Yorknew"},"Shaiapouf":{"c0":"Garde royal","c1":"Manipulation","c2":"Fourmis-Chimères","c3":"Spiritual Message","c4":"Aucune","c5":"Chimera Ant"},"Menthuthuyoupi":{"c0":"Garde royal","c1":"Renforcement","c2":"Fourmis-Chimères","c3":"Métamorphose","c4":"Aucune","c5":"Chimera Ant"}},"snk":{"Connie Springer":{"c0":"Paradis","c1":"Bataillon","c2":"Aucun","c3":"Ragako","c4":"Non","c5":"Brun"},"Sasha Blouse":{"c0":"Paradis","c1":"Bataillon","c2":"Aucun","c3":"Dauper","c4":"Non","c5":"Brun"},"Historia Reiss":{"c0":"Paradis","c1":"104e/Bataillon","c2":"Aucun","c3":"Mur Sina","c4":"Non","c5":"Blond"},"Ymir":{"c0":"Paradis","c1":"104e","c2":"Mâchoire","c3":"Marley","c4":"Non","c5":"Brun"},"Bertholdt Hoover":{"c0":"Marley","c1":"Guerriers","c2":"Colossal","c3":"Marley","c4":"Non","c5":"Brun"},"Pieck Finger":{"c0":"Marley","c1":"Guerriers","c2":"Charrette","c3":"Marley","c4":"Non","c5":"Noir"},"Porco Galliard":{"c0":"Marley","c1":"Guerriers","c2":"Mâchoire","c3":"Marley","c4":"Non","c5":"Blond"},"Gabi Braun":{"c0":"Marley","c1":"Candidate guerrière","c2":"Aucun","c3":"Liberio","c4":"Non","c5":"Brun"},"Falco Grice":{"c0":"Marley","c1":"Candidate guerrier","c2":"Mâchoire","c3":"Liberio","c4":"Non","c5":"Blond"},"Kenny Ackerman":{"c0":"Paradis","c1":"Brigade anti-humaine","c2":"Aucun","c3":"Paradis","c4":"Oui","c5":"Noir"}},"sds":{"Arthur Pendragon":{"c0":"Humain","c1":"Camelot","c2":"Aucun","c3":"Chaos","c4":"Aucun","c5":"Non"},"Elaine":{"c0":"Fée","c1":"Forêt du Roi des Fées","c2":"Aucun","c3":"Vent","c4":"Aucun","c5":"Non"},"Derieri":{"c0":"Démon","c1":"Dix Commandements","c2":"Pureté","c3":"Combo Star","c4":"Aucun","c5":"Oui"},"Monspeet":{"c0":"Démon","c1":"Dix Commandements","c2":"Réticence","c3":"Trick Star","c4":"Aucun","c5":"Oui"},"Galand":{"c0":"Démon","c1":"Dix Commandements","c2":"Vérité","c3":"Critical Over","c4":"Aucun","c5":"Oui"},"Melascula":{"c0":"Démon","c1":"Dix Commandements","c2":"Foi","c3":"Hell Gate","c4":"Aucun","c5":"Oui"},"Gloxinia":{"c0":"Fée","c1":"Dix Commandements","c2":"Repos","c3":"Disaster","c4":"Basquias","c5":"Non"},"Drole":{"c0":"Géant","c1":"Dix Commandements","c2":"Patience","c3":"Ground","c4":"Gideon (ancien)","c5":"Non"},"Hendrickson":{"c0":"Humain","c1":"Chevaliers sacrés","c2":"Aucun","c3":"Acid/Enchant","c4":"Aucun","c5":"Non"},"Gilthunder":{"c0":"Humain","c1":"Chevaliers sacrés","c2":"Aucun","c3":"Foudre","c4":"Aucun","c5":"Non"}},"deathnote":{"Sachiko Yagami":{"c0":"Famille Yagami","c1":"Mère de Light","c2":"Non","c3":"Non","c4":"Femme au foyer","c5":"Humain"},"Sayu Yagami":{"c0":"Famille Yagami","c1":"Sœur de Light","c2":"Non","c3":"Non","c4":"Étudiante","c5":"Humain"},"Shuichi Aizawa":{"c0":"Enquête","c1":"Membre de l'équipe","c2":"Non","c3":"Non","c4":"Policier","c5":"Humain"},"Kanzo Mogi":{"c0":"Enquête","c1":"Membre de l'équipe","c2":"Non","c3":"Non","c4":"Policier","c5":"Humain"},"Watari":{"c0":"Enquête","c1":"Assistant de L","c2":"Non","c3":"Non","c4":"Inventeur/Assistant","c5":"Humain"},"Kiyomi Takada":{"c0":"Kira","c1":"Porte-parole de Kira","c2":"Oui","c3":"Non","c4":"Journaliste","c5":"Humain"},"Naomi Misora":{"c0":"Enquête","c1":"Ex-agent FBI","c2":"Non","c3":"Non","c4":"Ex-agent FBI","c5":"Humain"},"Raye Penber":{"c0":"Enquête","c1":"Agent FBI","c2":"Non","c3":"Non","c4":"Agent FBI","c5":"Humain"},"Kyosuke Higuchi":{"c0":"Kira","c1":"Kira de Yotsuba","c2":"Oui","c3":"Oui","c4":"Cadre Yotsuba","c5":"Humain"},"Sidoh":{"c0":"Shinigami","c1":"Shinigami","c2":"Oui","c3":"Oui","c4":"Shinigami","c5":"Shinigami"}},"cote":{"Yosuke Hirata":{"c0":"D","c1":"1re","c2":"Non","c3":"Non","c4":"Homme","c5":"Blond"},"Ken Sudo":{"c0":"D","c1":"1re","c2":"Non","c3":"Non","c4":"Homme","c5":"Rouge"},"Kanji Ike":{"c0":"D","c1":"1re","c2":"Non","c3":"Non","c4":"Homme","c5":"Brun"},"Haruki Yamauchi":{"c0":"D","c1":"1re","c2":"Non","c3":"Non","c4":"Homme","c5":"Brun"},"Airi Sakura":{"c0":"D","c1":"1re","c2":"Non","c3":"Non","c4":"Femme","c5":"Rose"},"Akito Miyake":{"c0":"D","c1":"1re","c2":"Non","c3":"Non","c4":"Homme","c5":"Bleu"},"Haruka Hasebe":{"c0":"D","c1":"1re","c2":"Non","c3":"Non","c4":"Femme","c5":"Violet"},"Manabu Horikita":{"c0":"A","c1":"3e","c2":"Oui","c3":"Non","c4":"Homme","c5":"Noir"},"Miyabi Nagumo":{"c0":"A","c1":"2e/3e","c2":"Oui","c3":"Non","c4":"Homme","c5":"Blond"},"Rokusuke Koenji":{"c0":"D","c1":"1re","c2":"Non","c3":"Non","c4":"Homme","c5":"Blond"}},"solo":{"Woo Jinchul":{"c0":"Humain","c1":"A","c2":"Inspecteur","c3":"Association coréenne","c4":"Force/vitesse","c5":"Non"},"Go Gunhee":{"c0":"Humain","c1":"S","c2":"Président","c3":"Association coréenne","c4":"Puissance physique","c5":"Non"},"Min Byung-Gyu":{"c0":"Humain","c1":"S","c2":"Soigneur","c3":"Hunters","c4":"Guérison","c5":"Non"},"Lim Tae-Gyu":{"c0":"Humain","c1":"S","c2":"Archer","c3":"Fiend","c4":"Arc magique","c5":"Non"},"Ma Dongwook":{"c0":"Humain","c1":"S","c2":"Tank","c3":"Fame","c4":"Renforcement physique","c5":"Non"},"Christopher Reed":{"c0":"Humain","c1":"Nation","c2":"Hunter","c3":"Aucune","c4":"Manifestation spirituelle","c5":"Oui"},"Bellion":{"c0":"Ombre","c1":"Commandant","c2":"Grand Maréchal","c3":"Armée des Ombres","c4":"Épée fouet","c5":"Non"},"Tusk":{"c0":"Ombre","c1":"Commandant","c2":"Mage","c3":"Armée des Ombres","c4":"Magie","c5":"Non"},"Ashborn":{"c0":"Monarque","c1":"Monarque","c2":"Monarque des Ombres","c3":"Armée des Ombres","c4":"Pouvoir des ombres","c5":"Oui"},"Baran":{"c0":"Monarque","c1":"Monarque","c2":"Monarque des Flammes Blanches","c3":"Démons","c4":"Foudre/armée démoniaque","c5":"Non"}},"clover":{"Charlotte Roselei":{"c0":"Rose Bleue","c1":"Ronce","c2":"3 feuilles","c3":"Clover","c4":"Noble","c5":"Aucun"},"Charmy Pappitson":{"c0":"Taureau Noir","c1":"Coton/Nourriture","c2":"3 feuilles","c3":"Clover","c4":"Aucun","c5":"Esprit loup"},"Jack the Ripper":{"c0":"Mante Verte","c1":"Lames","c2":"3 feuilles","c3":"Clover","c4":"Aucun","c5":"Aucun"},"Leopold Vermillion":{"c0":"Lion Pourpre","c1":"Feu","c2":"3 feuilles","c3":"Clover","c4":"Royal","c5":"Aucun"},"Nozel Silva":{"c0":"Aigle d'Argent","c1":"Mercure","c2":"3 feuilles","c3":"Clover","c4":"Royal","c5":"Aucun"},"Mimosa Vermillion":{"c0":"Aube d'Or","c1":"Plante","c2":"3 feuilles","c3":"Clover","c4":"Royal","c5":"Aucun"},"William Vangeance":{"c0":"Aube d'Or","c1":"Arbre du Monde","c2":"3 feuilles","c3":"Clover","c4":"Noble","c5":"Aucun"},"Rill Boismortier":{"c0":"Cerf Turquoise","c1":"Peinture","c2":"3 feuilles","c3":"Clover","c4":"Noble","c5":"Aucun"},"Dante Zogratis":{"c0":"Triade Sombre","c1":"Corps/Gravité","c2":"5 feuilles","c3":"Spade","c4":"Royal usurpateur","c5":"Lucifero"},"Vanica Zogratis":{"c0":"Triade Sombre","c1":"Sang/Malédiction","c2":"5 feuilles","c3":"Spade","c4":"Royal usurpateur","c5":"Megicula"}},"fireforce":{"Iris":{"c0":"8e","c1":"Aucune","c2":"Non","c3":"Sœur","c4":"Prière","c5":"Blond"},"Viktor Licht":{"c0":"8e","c1":"Aucune","c2":"Non","c3":"Scientifique","c4":"Analyse","c5":"Noir"},"Vulcan Joseph":{"c0":"8e","c1":"Aucune","c2":"Non","c3":"Ingénieur","c4":"Machines","c5":"Rouge"},"Lisa Isaribe":{"c0":"8e","c1":"3e","c2":"Non","c3":"Mécanicienne/Combattante","c4":"Tentacules de feu","c5":"Noir"},"Konro Sagamiya":{"c0":"7e","c1":"2e","c2":"Non","c3":"Lieutenant","c4":"Katana","c5":"Noir"},"Hibana":{"c0":"5e","c1":"3e","c2":"Non","c3":"Capitaine","c4":"Fleurs de feu","c5":"Rose"},"Karim Flam":{"c0":"1re","c1":"2e","c2":"Non","c3":"Lieutenant","c4":"Refroidissement thermique","c5":"Blond"},"Rekka Hoshimiya":{"c0":"1re","c1":"3e","c2":"Non","c3":"Prêtre/Soldat","c4":"Poings de feu","c5":"Brun"},"Joker":{"c0":"Indépendant","c1":"3e","c2":"Adolla Link","c3":"Vigilante","c4":"Cartes enflammées","c5":"Noir"},"Charon":{"c0":"White-Clad","c1":"2e","c2":"Non","c3":"Gardien","c4":"Conversion cinétique","c5":"Blanc"}},"mushoku":{"Zenith Greyrat":{"c0":"Humain","c1":"Guérisseuse","c2":"Guérison","c3":"Magie","c4":"Greyrat","c5":"Blond"},"Lilia Greyrat":{"c0":"Humain","c1":"Servante/Épéiste","c2":"Aucune","c3":"Épée","c4":"Greyrat","c5":"Brun"},"Norn Greyrat":{"c0":"Humain","c1":"Étudiante","c2":"Aucune","c3":"Épée basique","c4":"Greyrat","c5":"Blond"},"Aisha Greyrat":{"c0":"Humain","c1":"Servante/Gestion","c2":"Aucune","c3":"Soutien","c4":"Greyrat","c5":"Brun"},"Hitogami":{"c0":"Dieu","c1":"Divinité","c2":"Clairvoyance","c3":"Manipulation","c4":"Aucune","c5":"Blanc"},"Kishirika Kishirisu":{"c0":"Démon","c1":"Impératrice démon","c2":"Yeux démoniaques","c3":"Magie","c4":"Démons","c5":"Violet"},"Badigadi":{"c0":"Démon","c1":"Roi démon","c2":"Force","c3":"Corps à corps","c4":"Démons","c5":"Noir"},"Zanoba Shirone":{"c0":"Humain","c1":"Prince/Mage","c2":"Terre","c3":"Force/Création","c4":"Shirone","c5":"Bleu"},"Elinalise Dragonroad":{"c0":"Elfe","c1":"Guerrière","c2":"Magie de soutien","c3":"Épée/Bouclier","c4":"Fangs of the Black Wolf","c5":"Blond"},"Perugius Dola":{"c0":"Humain","c1":"Roi dragon blindé","c2":"Invocation","c3":"Magie","c4":"Forteresse céleste","c5":"Blanc"}},"rezero":{"Puck":{"c0":"Esprit","c1":"Emilia","c2":"Glace","c3":"Emilia","c4":"Non","c5":"Gris"},"Otto Suwen":{"c0":"Humain","c1":"Emilia","c2":"Protection divine de langage","c3":"Aucun","c4":"Non","c5":"Gris"},"Garfiel Tinsel":{"c0":"Demi-bête","c1":"Emilia","c2":"Transformation bestiale","c3":"Aucun","c4":"Non","c5":"Blond"},"Frederica Baumann":{"c0":"Demi-bête","c1":"Emilia","c2":"Transformation bestiale","c3":"Aucun","c4":"Non","c5":"Blond"},"Felt":{"c0":"Humain","c1":"Felt","c2":"Protection du vent","c3":"Aucun","c4":"Oui","c5":"Blond"},"Felix Argyle":{"c0":"Demi-bête","c1":"Crusch","c2":"Guérison eau","c3":"Aucun","c4":"Non","c5":"Bleu"},"Wilhelm van Astrea":{"c0":"Humain","c1":"Crusch","c2":"Maîtrise de l'épée","c3":"Aucun","c4":"Non","c5":"Blanc"},"Anastasia Hoshin":{"c0":"Humain","c1":"Anastasia","c2":"Commerce/Esprit artificiel","c3":"Echidna (esprit artificiel)","c4":"Oui","c5":"Violet"},"Julius Juukulius":{"c0":"Humain","c1":"Anastasia","c2":"Arts spirituels","c3":"Six quasi-esprits","c4":"Non","c5":"Violet"},"Echidna":{"c0":"Sorcière","c1":"Sorcières","c2":"Autorité de l'Avarice","c3":"Aucun","c4":"Non","c5":"Blanc"}},"fairy":{"Acnologia":{"c0":"Dragon/Dragon Slayer","c1":"Indépendant","c2":"Dragon Slayer","c3":"Magie","c4":"Homme","c5":"Bleu"},"Gildarts Clive":{"c0":"Fairy Tail","c1":"Crash","c2":"Non","c3":"Destruction","c4":"Homme","c5":"Brun"},"Cana Alberona":{"c0":"Fairy Tail","c1":"Cartes/Fairy Glitter","c2":"Non","c3":"Magie","c4":"Femme","c5":"Brun"},"Elfman":{"c0":"Fairy Tail","c1":"Take Over","c2":"Non","c3":"Beast Soul","c4":"Homme","c5":"Blanc"},"Evergreen":{"c0":"Fairy Tail","c1":"Fairy Magic","c2":"Non","c3":"Pierre","c4":"Femme","c5":"Brun"},"Freed Justine":{"c0":"Fairy Tail","c1":"Runes","c2":"Non","c3":"Runes","c4":"Homme","c5":"Vert"},"Jellal Fernandes":{"c0":"Crime Sorcière","c1":"Corps célestes","c2":"Non","c3":"Lumière","c4":"Homme","c5":"Bleu"},"Zeref Dragneel":{"c0":"Indépendant/Alvarez","c1":"Magie noire","c2":"Non","c3":"Mort","c4":"Homme","c5":"Noir"},"Sting Eucliffe":{"c0":"Sabertooth","c1":"Dragon Slayer","c2":"Oui","c3":"Lumière","c4":"Homme","c5":"Blond"},"Rogue Cheney":{"c0":"Sabertooth","c1":"Dragon Slayer","c2":"Oui","c3":"Ombre","c4":"Homme","c5":"Noir"}},"bluelock":{"Rensuke Kunigami":{"c0":"Attaquant","c1":"Gauche","c2":"Tir puissant","c3":"Bastard München","c4":"Non","c5":"Orange"},"Jyubei Aryu":{"c0":"Défenseur/Attaquant","c1":"Droit","c2":"Portée/jeu aérien","c3":"Ubers","c4":"Non","c5":"Noir"},"Aoshi Tokimitsu":{"c0":"Milieu/Attaquant","c1":"Droit","c2":"Puissance physique","c3":"Paris X Gen","c4":"Non","c5":"Noir"},"Ikki Niko":{"c0":"Défenseur","c1":"Droit","c2":"Vision/anticipation","c3":"Ubers","c4":"Non","c5":"Noir"},"Raichi Jingo":{"c0":"Milieu défensif","c1":"Droit","c2":"Endurance/duels","c3":"Bastard München","c4":"Non","c5":"Blond"},"Tabito Karasu":{"c0":"Milieu","c1":"Droit","c2":"Contrôle/lecture","c3":"Paris X Gen","c4":"Non","c5":"Noir"},"Eita Otoya":{"c0":"Attaquant","c1":"Droit","c2":"Déplacements furtifs","c3":"FC Barcha","c4":"Non","c5":"Noir/Vert"},"Kenyu Yukimiya":{"c0":"Ailier","c1":"Droit","c2":"Dribble 1v1","c3":"Bastard München","c4":"Non","c5":"Noir"},"Alexis Ness":{"c0":"Milieu offensif","c1":"Gauche","c2":"Technique/passes","c3":"Bastard München","c4":"Non","c5":"Magenta"},"Don Lorenzo":{"c0":"Défenseur","c1":"Droit","c2":"Marquage/dribble","c3":"Ubers","c4":"Oui","c5":"Noir/Vert"}},"fma":{"Van Hohenheim":{"c0":"Humain/Pierre vivante","c1":"Xerxès/Amestris","c2":"Non","c3":"Alchimie sans cercle","c4":"Oui","c5":"Blond"},"Jean Havoc":{"c0":"Humain","c1":"Armée d'Amestris","c2":"Non","c3":"Aucune","c4":"Non","c5":"Blond"},"Maes Hughes":{"c0":"Humain","c1":"Armée d'Amestris","c2":"Non","c3":"Aucune","c4":"Non","c5":"Brun"},"Alex Louis Armstrong":{"c0":"Humain","c1":"Armée d'Amestris","c2":"Oui","c3":"Alchimie de combat","c4":"Non","c5":"Blond"},"Olivier Mira Armstrong":{"c0":"Humain","c1":"Fort Briggs","c2":"Non","c3":"Aucune","c4":"Non","c5":"Blond"},"May Chang":{"c0":"Humaine","c1":"Xing","c2":"Non","c3":"Alkahestrie","c4":"Non","c5":"Noir"},"Ling Yao":{"c0":"Humain/Homunculus temporaire","c1":"Xing","c2":"Non","c3":"Arts martiaux","c4":"Oui temporaire","c5":"Noir"},"Lan Fan":{"c0":"Humaine","c1":"Xing","c2":"Non","c3":"Arts martiaux","c4":"Non","c5":"Noir"},"Tim Marcoh":{"c0":"Humain","c1":"Amestris","c2":"Oui","c3":"Alchimie médicale","c4":"Oui","c5":"Gris"},"Izumi Curtis":{"c0":"Humaine","c1":"Indépendante","c2":"Non","c3":"Transmutation sans cercle","c4":"Non","c5":"Noir"}},"chainsaw":{"Kishibe":{"c0":"Humain","c1":"Public Safety","c2":"Griffe/Couteau/Aiguille","c3":"Non","c4":"Homme","c5":"Blond"},"Beam":{"c0":"Fiend","c1":"Public Safety","c2":"Shark","c3":"Non","c4":"Homme","c5":"Noir"},"Violence Fiend":{"c0":"Fiend","c1":"Public Safety","c2":"Violence","c3":"Non","c4":"Homme","c5":"Noir"},"Princi":{"c0":"Démon","c1":"Public Safety","c2":"Spider","c3":"Non","c4":"Femme","c5":"Noir"},"Akane Sawatari":{"c0":"Humaine","c1":"Terroristes","c2":"Snake","c3":"Non","c4":"Femme","c5":"Blond"},"Quanxi":{"c0":"Hybride","c1":"Indépendante/Chine","c2":"Crossbow","c3":"Oui","c4":"Femme","c5":"Blond"},"Santa Claus":{"c0":"Humaine/Marionnette","c1":"Assassins internationaux","c2":"Doll/Darkness","c3":"Non","c4":"Femme","c5":"Blond"},"Asa Mitaka":{"c0":"Humaine/Fiend-like host","c1":"Étudiante","c2":"War","c3":"Non","c4":"Femme","c5":"Noir"},"Yoru":{"c0":"Démon","c1":"War Devil","c2":"War","c3":"Non","c4":"Femme","c5":"Noir"},"Nayuta":{"c0":"Démon","c1":"Famille de Denji","c2":"Control","c3":"Non","c4":"Femme","c5":"Noir"}},"wakfu":{"Grougaloragran":{"c0":"Dragon","c1":"Eliatropes","c2":"Wakfu","c3":"Magie draconique","c4":"Homme","c5":"Blanc"},"Alibert":{"c0":"Humain","c1":"Emelka","c2":"Aucune","c3":"Aucune","c4":"Homme","c5":"Brun"},"Shinonome":{"c0":"Dragon","c1":"Eliatropes","c2":"Wakfu","c3":"Magie draconique","c4":"Femme","c5":"Blanc"},"Phaeris":{"c0":"Dragon","c1":"Eliatropes","c2":"Wakfu","c3":"Magie draconique","c4":"Homme","c5":"Bleu"},"Baltazar":{"c0":"Dragon","c1":"Eliatropes","c2":"Wakfu","c3":"Magie draconique","c4":"Homme","c5":"Blanc"},"Echo":{"c0":"Eliatrope","c1":"Fratrie des Oubliés","c2":"Wakfu","c3":"Magie","c4":"Femme","c5":"Blond"},"Harebourg":{"c0":"Xélor","c1":"Fratrie des Oubliés","c2":"Glace/Temps","c3":"Magie","c4":"Homme","c5":"Blanc"},"Rubilax":{"c0":"Shushu","c1":"Tristepin","c2":"Stasis/Force","c3":"Épée","c4":"Homme","c5":"Rouge"},"Elely":{"c0":"Iop","c1":"Famille Percedal","c2":"Force","c3":"Poings","c4":"Femme","c5":"Roux"},"Flopin":{"c0":"Cra","c1":"Famille Percedal","c2":"Wakfu","c3":"Arc","c4":"Homme","c5":"Blond"}},"demonslayer":{"Kanao Tsuyuri":{"c0":"Pourfendeurs","c1":"Tsuguko","c2":"Fleur","c3":"Non","c4":"Non","c5":"Noir"},"Genya Shinazugawa":{"c0":"Pourfendeurs","c1":"Kinoe","c2":"Armes à feu/consommation démoniaque","c3":"Non","c4":"Non","c5":"Noir"},"Tengen Uzui":{"c0":"Pourfendeurs","c1":"Pilier","c2":"Son","c3":"Oui","c4":"Non","c5":"Blanc"},"Mitsuri Kanroji":{"c0":"Pourfendeurs","c1":"Pilier","c2":"Amour","c3":"Oui","c4":"Non","c5":"Rose/Vert"},"Muichiro Tokito":{"c0":"Pourfendeurs","c1":"Pilier","c2":"Brume","c3":"Oui","c4":"Non","c5":"Noir/Turquoise"},"Sanemi Shinazugawa":{"c0":"Pourfendeurs","c1":"Pilier","c2":"Vent","c3":"Oui","c4":"Non","c5":"Blanc"},"Gyomei Himejima":{"c0":"Pourfendeurs","c1":"Pilier","c2":"Pierre","c3":"Oui","c4":"Non","c5":"Noir"},"Obanai Iguro":{"c0":"Pourfendeurs","c1":"Pilier","c2":"Serpent","c3":"Oui","c4":"Non","c5":"Noir"},"Doma":{"c0":"Démons","c1":"Lune Supérieure 2","c2":"Art du sang de glace","c3":"Non","c4":"Oui","c5":"Blond"},"Gyutaro":{"c0":"Démons","c1":"Lune Supérieure 6","c2":"Art du sang","c3":"Non","c4":"Oui","c5":"Vert/Noir"}},"pokemon":{"Raichu":{"c0":"Électrik","c1":"—","c2":"1","c3":"Non","c4":"Finale","c5":"Orange"},"Charmeleon":{"c0":"Feu","c1":"—","c2":"1","c3":"Non","c4":"Évolue","c5":"Rouge"},"Blastoise":{"c0":"Eau","c1":"—","c2":"1","c3":"Non","c4":"Finale","c5":"Bleu"},"Butterfree":{"c0":"Insecte","c1":"Vol","c2":"1","c3":"Non","c4":"Finale","c5":"Violet"},"Pidgeot":{"c0":"Normal","c1":"Vol","c2":"1","c3":"Non","c4":"Finale","c5":"Brun"},"Vulpix":{"c0":"Feu","c1":"—","c2":"1","c3":"Non","c4":"Évolue","c5":"Rouge"},"Jigglypuff":{"c0":"Normal","c1":"Fée","c2":"1","c3":"Non","c4":"Évolue","c5":"Rose"},"Meowth":{"c0":"Normal","c1":"—","c2":"1","c3":"Non","c4":"Évolue","c5":"Crème"},"Psyduck":{"c0":"Eau","c1":"—","c2":"1","c3":"Non","c4":"Évolue","c5":"Jaune"},"Snorlax":{"c0":"Normal","c1":"—","c2":"1","c3":"Non","c4":"Finale","c5":"Bleu"},"Mew":{"c0":"Psy","c1":"—","c2":"1","c3":"Mythique","c4":"Finale","c5":"Rose"},"Lugia":{"c0":"Psy","c1":"Vol","c2":"2","c3":"Oui","c4":"Finale","c5":"Blanc"},"Ho-Oh":{"c0":"Feu","c1":"Vol","c2":"2","c3":"Oui","c4":"Finale","c5":"Rouge"},"Groudon":{"c0":"Sol","c1":"—","c2":"3","c3":"Oui","c4":"Finale","c5":"Rouge"},"Kyogre":{"c0":"Eau","c1":"—","c2":"3","c3":"Oui","c4":"Finale","c5":"Bleu"}},"dragonball":{"Goten":{"c0":"Saiyan/Humain","c1":"Héros","c2":"Super Saiyan","c3":"7","c4":"Gotenks","c5":"Noir"},"Trunks":{"c0":"Saiyan/Humain","c1":"Héros","c2":"Super Saiyan","c3":"7","c4":"Gotenks","c5":"Violet"},"Future Trunks":{"c0":"Saiyan/Humain","c1":"Héros","c2":"Super Saiyan Rage","c3":"7","c4":"Non","c5":"Bleu/Violet"},"Krillin":{"c0":"Humain","c1":"Héros","c2":"Aucune","c3":"7","c4":"Non","c5":"Chauve/Noir"},"Yamcha":{"c0":"Humain","c1":"Héros","c2":"Aucune","c3":"7","c4":"Non","c5":"Noir"},"Master Roshi":{"c0":"Humain","c1":"Héros","c2":"Max Power","c3":"7","c4":"Non","c5":"Chauve"},"Bulma":{"c0":"Humaine","c1":"Héros","c2":"Aucune","c3":"7","c4":"Non","c5":"Bleu"},"Android 17":{"c0":"Humain modifié","c1":"Héros","c2":"Aucune","c3":"7","c4":"Non","c5":"Noir"},"Android 18":{"c0":"Humaine modifiée","c1":"Héros","c2":"Aucune","c3":"7","c4":"Non","c5":"Blond"},"Hit":{"c0":"Humain extraterrestre","c1":"Univers 6","c2":"Time-Skip","c3":"6","c4":"Non","c5":"Violet"},"Caulifla":{"c0":"Saiyan","c1":"Univers 6","c2":"Super Saiyan 2","c3":"6","c4":"Kefla","c5":"Noir"},"Kale":{"c0":"Saiyan","c1":"Univers 6","c2":"Super Saiyan Berserk","c3":"6","c4":"Kefla","c5":"Noir"},"Toppo":{"c0":"Extraterrestre","c1":"Pride Troopers","c2":"Dieu de la destruction candidat","c3":"11","c4":"Non","c5":"Noir"},"Dyspo":{"c0":"Extraterrestre","c1":"Pride Troopers","c2":"Super vitesse","c3":"11","c4":"Non","c5":"Violet"},"Goku Black":{"c0":"Saiyan/Kaioshin","c1":"Antagoniste","c2":"Super Saiyan Rosé","c3":"7","c4":"Fused Zamasu","c5":"Noir"}},"hellsparadise":{"Yamada Asaemon Fuchi":{"c0":"Asaemon","c1":"Exécuteur","c2":"Métal","c3":"Katana","c4":"Homme","c5":"Noir"},"Nurugai":{"c0":"Condamnés","c1":"Survivante","c2":"Eau","c3":"Armes diverses","c4":"Femme","c5":"Brun"},"Yamada Asaemon Senta":{"c0":"Asaemon","c1":"Exécuteur","c2":"Bois","c3":"Katana","c4":"Homme","c5":"Noir"},"Yamada Asaemon Eizen":{"c0":"Asaemon","c1":"Exécuteur","c2":"Feu","c3":"Katana","c4":"Homme","c5":"Blond"},"Yamada Asaemon Genji":{"c0":"Asaemon","c1":"Exécuteur","c2":"Terre","c3":"Katana","c4":"Homme","c5":"Noir"},"Yamada Asaemon Jikka":{"c0":"Asaemon","c1":"Exécuteur","c2":"Métal","c3":"Katana","c4":"Homme","c5":"Noir"},"Yamada Asaemon Shugen":{"c0":"Asaemon","c1":"Exécuteur","c2":"Feu","c3":"Katana","c4":"Homme","c5":"Noir"},"Zhu Jin":{"c0":"Tensen","c1":"Tensen","c2":"Tao","c3":"Tao/Plantes","c4":"Variable","c5":"Blanc"},"Mu Dan":{"c0":"Tensen","c1":"Tensen","c2":"Tao","c3":"Tao/Plantes","c4":"Variable","c5":"Blanc"},"Ju Fa":{"c0":"Tensen","c1":"Tensen","c2":"Tao","c3":"Tao/Plantes","c4":"Variable","c5":"Blanc"}},"gachiakuta":{"Delmon":{"c0":"Cleaners","c1":"Giver","c2":"Delmon's Jinki","c3":"Objet vital","c4":"Ground","c5":"Noir"},"Bro":{"c0":"Cleaners","c1":"Combattant","c2":"Jinki","c3":"Objet vital","c4":"Ground","c5":"Brun"},"Dear":{"c0":"Cleaners","c1":"Giver","c2":"Jinki","c3":"Objet vital","c4":"Ground","c5":"Clair"},"Guita":{"c0":"Cleaners","c1":"Giver","c2":"Jinki","c3":"Objet vital","c4":"Ground","c5":"Noir"},"Gris":{"c0":"Cleaners","c1":"Support","c2":"Jinki","c3":"Objet vital","c4":"Ground","c5":"Noir"},"Follo":{"c0":"Cleaners","c1":"Support","c2":"Jinki","c3":"Objet vital","c4":"Ground","c5":"Brun"},"Tomme":{"c0":"Cleaners","c1":"Giver","c2":"Jinki","c3":"Objet vital","c4":"Ground","c5":"Clair"},"Corvus":{"c0":"Cleaners","c1":"Chef","c2":"Jinki","c3":"Objet vital","c4":"Ground","c5":"Noir"},"August":{"c0":"Cleaners","c1":"Giver","c2":"Jinki","c3":"Objet vital","c4":"Ground","c5":"Blond"},"Eishia":{"c0":"Cleaners","c1":"Giver","c2":"Jinki","c3":"Objet vital","c4":"Ground","c5":"Noir"}},"haikyuu":{"Tadashi Yamaguchi":{"c0":"Karasuno","c1":"Serveur/Central","c2":"1re","c3":"12","c4":"Droite","c5":"Vert"},"Daichi Sawamura":{"c0":"Karasuno","c1":"Ailier/Réceptionneur","c2":"3e","c3":"1","c4":"Droite","c5":"Noir"},"Koshi Sugawara":{"c0":"Karasuno","c1":"Passeur","c2":"3e","c3":"2","c4":"Droite","c5":"Gris"},"Asahi Azumane":{"c0":"Karasuno","c1":"Ailier/Ace","c2":"3e","c3":"3","c4":"Droite","c5":"Brun"},"Ryunosuke Tanaka":{"c0":"Karasuno","c1":"Ailier","c2":"2e","c3":"5","c4":"Droite","c5":"Noir"},"Hajime Iwaizumi":{"c0":"Aoba Johsai","c1":"Ailier/Ace","c2":"3e","c3":"4","c4":"Droite","c5":"Noir"},"Morisuke Yaku":{"c0":"Nekoma","c1":"Libéro","c2":"3e","c3":"3","c4":"Droite","c5":"Brun"},"Taketora Yamamoto":{"c0":"Nekoma","c1":"Ailier/Ace","c2":"2e","c3":"4","c4":"Droite","c5":"Noir"},"Keiji Akaashi":{"c0":"Fukurodani","c1":"Passeur","c2":"2e","c3":"5","c4":"Droite","c5":"Noir"},"Satori Tendo":{"c0":"Shiratorizawa","c1":"Central","c2":"3e","c3":"5","c4":"Droite","c5":"Rouge"}},"jjk":{"Toge Inumaki":{"c0":"Exorcistes","c1":"Semi-grade 1","c2":"Parole maudite","c3":"Non","c4":"Oui","c5":"Blanc"},"Panda":{"c0":"Exorcistes","c1":"Grade 2","c2":"Corps maudit","c3":"Non","c4":"Oui","c5":"Noir/Blanc"},"Masamichi Yaga":{"c0":"Exorcistes","c1":"Grade 1","c2":"Poupées maudites","c3":"Non","c4":"Oui","c5":"Noir"},"Shoko Ieiri":{"c0":"Exorcistes","c1":"Grade spécial médical","c2":"Technique inversée","c3":"Non","c4":"Oui","c5":"Brun"},"Atsuya Kusakabe":{"c0":"Exorcistes","c1":"Grade 1","c2":"New Shadow Style","c3":"Non","c4":"Oui","c5":"Noir"},"Mai Zenin":{"c0":"Exorcistes","c1":"Grade 3","c2":"Construction","c3":"Non","c4":"Oui","c5":"Vert"},"Kasumi Miwa":{"c0":"Exorcistes","c1":"Grade 3","c2":"New Shadow Style","c3":"Non","c4":"Oui","c5":"Bleu"},"Noritoshi Kamo":{"c0":"Exorcistes","c1":"Semi-grade 1","c2":"Manipulation du sang","c3":"Non","c4":"Oui","c5":"Noir"},"Jogo":{"c0":"Fléaux","c1":"Spécial","c2":"Flammes volcaniques","c3":"Coffin of the Iron Mountain","c4":"Oui","c5":"Chauve"},"Hanami":{"c0":"Fléaux","c1":"Spécial","c2":"Plantes","c3":"Non","c4":"Oui","c5":"Clair"}},"jojo":{"Johnny Joestar":{"c0":"7","c1":"Héros","c2":"Tusk","c3":"Évolution/Actes","c4":"Non","c5":"Oui"},"Josuke Higashikata Gappy":{"c0":"8","c1":"Héros","c2":"Soft & Wet","c3":"Courte portée","c4":"Non","c5":"Oui"},"Robert E. O. Speedwagon":{"c0":"1/2","c1":"Héros","c2":"Aucun","c3":"—","c4":"Non","c5":"Non"},"Will A. Zeppeli":{"c0":"1","c1":"Héros","c2":"Aucun","c3":"—","c4":"Oui","c5":"Non"},"Caesar Zeppeli":{"c0":"2","c1":"Héros","c2":"Aucun","c3":"—","c4":"Oui","c5":"Non"},"Lisa Lisa":{"c0":"2","c1":"Héros","c2":"Aucun","c3":"—","c4":"Oui","c5":"Non"},"Muhammad Avdol":{"c0":"3","c1":"Héros","c2":"Magician's Red","c3":"Courte portée","c4":"Non","c5":"Non"},"Noriaki Kakyoin":{"c0":"3","c1":"Héros","c2":"Hierophant Green","c3":"Longue portée","c4":"Non","c5":"Non"},"Iggy":{"c0":"3","c1":"Héros","c2":"The Fool","c3":"Contrôle du sable","c4":"Non","c5":"Non"},"Koichi Hirose":{"c0":"4","c1":"Héros","c2":"Echoes","c3":"Actes","c4":"Non","c5":"Non"}},"tensura":{"Shizue Izawa":{"c0":"Humaine","c1":"Royaume de Blumund","c2":"Héroïne","c3":"Degenerate","c4":"Non","c5":"Noir"},"Shuna":{"c0":"Ogre/Kijin","c1":"Tempest","c2":"Kijin","c3":"Manufacturer","c4":"Non","c5":"Rose"},"Souei":{"c0":"Ogre/Kijin","c1":"Tempest","c2":"Kijin","c3":"Shadow Striker","c4":"Non","c5":"Bleu"},"Hakuro":{"c0":"Ogre/Kijin","c1":"Tempest","c2":"Kijin","c3":"Maître épéiste","c4":"Non","c5":"Blanc"},"Ranga":{"c0":"Tempest Wolf","c1":"Tempest","c2":"Tempest Star Wolf","c3":"King of Sturm","c4":"Non","c5":"Noir"},"Geld":{"c0":"Orc","c1":"Tempest","c2":"Orc King","c3":"Gourmet","c4":"Non","c5":"Noir"},"Gabiru":{"c0":"Dragonewt","c1":"Tempest","c2":"Chef","c3":"Mood Maker","c4":"Non","c5":"Bleu"},"Testarossa":{"c0":"Primordial Demon","c1":"Tempest","c2":"Demon Peer","c3":"Hell King Belial","c4":"Non","c5":"Blanc"},"Carrera":{"c0":"Primordial Demon","c1":"Tempest","c2":"Demon Peer","c3":"Extinction King Abaddon","c4":"Non","c5":"Blond"},"Ultima":{"c0":"Primordial Demon","c1":"Tempest","c2":"Demon Peer","c3":"Poison King Samael","c4":"Non","c5":"Violet"}},"opm":{"Bomb":{"c0":"Héros allié","c1":"Aucune","c2":"—","c3":"Whirlwind Iron Cutting Fist","c4":"Non","c5":"Blanc"},"Blast":{"c0":"Héros","c1":"Classe S","c2":"1","c3":"Pouvoir spatial","c4":"Non","c5":"Noir"},"Atomic Samurai":{"c0":"Héros","c1":"Classe S","c2":"4","c3":"Maître sabreur","c4":"Non","c5":"Noir"},"Child Emperor":{"c0":"Héros","c1":"Classe S","c2":"5","c3":"Gadgets/robotique","c4":"Non","c5":"Brun"},"Metal Knight":{"c0":"Héros","c1":"Classe S","c2":"6","c3":"Robots/armes","c4":"Non","c5":"Gris"},"Zombieman":{"c0":"Héros","c1":"Classe S","c2":"8","c3":"Régénération/armes","c4":"Non","c5":"Noir"},"Drive Knight":{"c0":"Héros","c1":"Classe S","c2":"9","c3":"Cyborg tactique","c4":"Oui","c5":"Noir"},"Pig God":{"c0":"Héros","c1":"Classe S","c2":"10","c3":"Ingestion/endurance","c4":"Non","c5":"Noir"},"Superalloy Darkshine":{"c0":"Héros","c1":"Classe S","c2":"11","c3":"Force/durabilité","c4":"Non","c5":"Chauve"},"Metal Bat":{"c0":"Héros","c1":"Classe S","c2":"15","c3":"Batte/esprit combatif","c4":"Non","c5":"Noir"}},"sao":{"Yui":{"c0":"SAO","c1":"IA","c2":"Soutien système","c3":"Famille Kirito/Asuna","c4":"Femme","c5":"Noir"},"Silica":{"c0":"SAO","c1":"Humaine","c2":"Dague","c3":"Aucune","c4":"Femme","c5":"Brun"},"Lisbeth":{"c0":"SAO","c1":"Humaine","c2":"Masse","c3":"Aucune","c4":"Femme","c5":"Rose"},"Sachi":{"c0":"SAO","c1":"Humaine","c2":"Lance","c3":"Moonlit Black Cats","c4":"Femme","c5":"Noir"},"Argo":{"c0":"SAO","c1":"Humaine","c2":"Dague","c3":"Solo","c4":"Femme","c5":"Blond"},"Diavel":{"c0":"SAO","c1":"Humain","c2":"Épée","c3":"Groupe de raid","c4":"Homme","c5":"Bleu"},"Oberon":{"c0":"ALO","c1":"Sylphe","c2":"Épée/Magie","c3":"Salamanders/Admin","c4":"Homme","c5":"Blond"},"Death Gun":{"c0":"GGO","c1":"Humain","c2":"Fusil/épée","c3":"Laughing Coffin","c4":"Homme","c5":"Noir"},"Administrator":{"c0":"Underworld","c1":"Humaine d'Underworld","c2":"Arts sacrés","c3":"Église de l'Axiome","c4":"Femme","c5":"Argent"},"Bercouli Synthesis One":{"c0":"Underworld","c1":"Humain d'Underworld","c2":"Time Splitting Sword","c3":"Integrity Knights","c4":"Homme","c5":"Brun"}},"tokyoghoul":{"Rize Kamishiro":{"c0":"Ghoul","c1":"Indépendante","c2":"Rinkaku","c3":"Non","c4":"—","c5":"Violet"},"Hideyoshi Nagachika":{"c0":"Humain","c1":"CCG/ami de Kaneki","c2":"Aucun","c3":"Non","c4":"—","c5":"Blond"},"Yoshimura":{"c0":"Ghoul","c1":"Anteiku","c2":"Ukaku","c3":"Oui","c4":"—","c5":"Gris"},"Renji Yomo":{"c0":"Ghoul","c1":"Anteiku/Goat","c2":"Ukaku","c3":"Non","c4":"—","c5":"Gris"},"Uta":{"c0":"Ghoul","c1":"Clowns","c2":"Ukaku","c3":"Non","c4":"—","c5":"Noir"},"Akira Mado":{"c0":"Humaine","c1":"CCG","c2":"Aucun","c3":"Non","c4":"Inspecteur 1re classe","c5":"Blond"},"Kureo Mado":{"c0":"Humain","c1":"CCG","c2":"Aucun","c3":"Non","c4":"Inspecteur 1re classe","c5":"Gris"},"Seidou Takizawa":{"c0":"Ghoul artificiel","c1":"Aogiri/Indépendant","c2":"Ukaku","c3":"Oui","c4":"Ex-CCG","c5":"Blanc"},"Yukinori Shinohara":{"c0":"Humain","c1":"CCG","c2":"Aucun","c3":"Non","c4":"Inspecteur spécial","c5":"Noir"},"Koori Ui":{"c0":"Humain","c1":"CCG","c2":"Aucun","c3":"Non","c4":"Inspecteur spécial","c5":"Blond"}},"tokyorevengers":{"Haruki Hayashida":{"c0":"Toman","c1":"Capitaine","c2":"3e","c3":"Non","c4":"Homme","c5":"Blond"},"Ryohei Hayashi":{"c0":"Toman","c1":"Vice-capitaine","c2":"3e","c3":"Non","c4":"Homme","c5":"Blond"},"Nahoya Kawata":{"c0":"Toman","c1":"Capitaine","c2":"4e","c3":"Non","c4":"Homme","c5":"Orange"},"Souya Kawata":{"c0":"Toman","c1":"Vice-capitaine","c2":"4e","c3":"Non","c4":"Homme","c5":"Bleu"},"Hakkai Shiba":{"c0":"Toman","c1":"Vice-capitaine","c2":"2e","c3":"Non","c4":"Homme","c5":"Bleu"},"Shuji Hanma":{"c0":"Valhalla/Tenjiku","c1":"Cadre","c2":"—","c3":"Non","c4":"Homme","c5":"Noir"},"Seishu Inui":{"c0":"Black Dragon/Toman","c1":"Cadre","c2":"—","c3":"Non","c4":"Homme","c5":"Blond"},"Hajime Kokonoi":{"c0":"Black Dragon/Tenjiku","c1":"Trésorier/Cadre","c2":"—","c3":"Non","c4":"Homme","c5":"Noir"},"Kakucho":{"c0":"Tenjiku","c1":"Cadre","c2":"—","c3":"Non","c4":"Homme","c5":"Noir"},"Haruchiyo Sanzu":{"c0":"Toman/Bonten","c1":"Vice-capitaine/Cadre","c2":"5e","c3":"Non","c4":"Homme","c5":"Rose"}}};

for (const [universeKey, profiles] of Object.entries(DLE_STATIC_PROFILES_EXT)) {
    DLE_STATIC_PROFILES[universeKey] = {
        ...(DLE_STATIC_PROFILES[universeKey] || {}),
        ...profiles
    };
    const current = DLE_TARGET_NAMES[universeKey] || [];
    const seen = new Set(current.map(normalizeDle));
    for (const name of Object.keys(profiles)) {
        if (!seen.has(normalizeDle(name))) {
            current.push(name);
            seen.add(normalizeDle(name));
        }
    }
    DLE_TARGET_NAMES[universeKey] = current;
}


// ================= AnimeDLE V17 — encore plus de fiches =================
// +300 personnages supplémentaires, avec les 6 catégories déjà remplies.
const DLE_STATIC_PROFILES_MORE = {"onepiece":{"Jewelry Bonney":{"c0":"Bonney Pirates","c1":"Capitaine","c2":"Toshi Toshi no Mi","c3":"Paramecia","c4":"Non","c5":"South Blue"},"Eustass Kid":{"c0":"Kid Pirates","c1":"Capitaine","c2":"Jiki Jiki no Mi","c3":"Paramecia","c4":"Oui","c5":"South Blue"},"Killer":{"c0":"Kid Pirates","c1":"Combattant","c2":"Aucun","c3":"Aucun","c4":"Non","c5":"South Blue"},"Marco":{"c0":"Barbe Blanche","c1":"Commandant 1re division / médecin","c2":"Tori Tori no Mi, modèle Phénix","c3":"Zoan mythique","c4":"Non","c5":"Grand Line"},"Buggy":{"c0":"Cross Guild / Buggy Pirates","c1":"Empereur / capitaine","c2":"Bara Bara no Mi","c3":"Paramecia","c4":"Non","c5":"Grand Line"},"Enel":{"c0":"Armée d'Enel","c1":"Dieu de Skypiea","c2":"Goro Goro no Mi","c3":"Logia","c4":"Non","c5":"Birka"},"Rob Lucci":{"c0":"CP0","c1":"Agent","c2":"Neko Neko no Mi, modèle Léopard","c3":"Zoan","c4":"Non","c5":"Grand Line"},"Smoker":{"c0":"Marine","c1":"Vice-amiral","c2":"Moku Moku no Mi","c3":"Logia","c4":"Non","c5":"Grand Line"},"Nefertari Vivi":{"c0":"Royaume d'Alabasta","c1":"Princesse","c2":"Aucun","c3":"Aucun","c4":"Non","c5":"Alabasta"},"Gecko Moria":{"c0":"Thriller Bark","c1":"Capitaine / ex-Grand Corsaire","c2":"Kage Kage no Mi","c3":"Paramecia","c4":"Non","c5":"West Blue"},"King":{"c0":"Beasts Pirates","c1":"All-Star","c2":"Ryu Ryu no Mi, modèle Ptéranodon","c3":"Zoan antique","c4":"Non","c5":"Red Line"},"Yamato":{"c0":"Allié de Wano","c1":"Combattant","c2":"Inu Inu no Mi, modèle Okuchi no Makami","c3":"Zoan mythique","c4":"Oui","c5":"Wano"}},"bleach":{"Isshin Kurosaki":{"c0":"Shinigami","c1":"Ancien Gotei 13","c2":"10e","c3":"Engetsu","c4":"Oui","c5":"Soul Society"},"Rangiku Matsumoto":{"c0":"Shinigami","c1":"Gotei 13","c2":"10e","c3":"Haineko","c4":"Non","c5":"Soul Society"},"Soi Fon":{"c0":"Shinigami","c1":"Gotei 13 / Onmitsukido","c2":"2e","c3":"Suzumebachi","c4":"Oui","c5":"Soul Society"},"Jushiro Ukitake":{"c0":"Shinigami","c1":"Gotei 13","c2":"13e","c3":"Sogyo no Kotowari","c4":"Non montré","c5":"Soul Society"},"Gin Ichimaru":{"c0":"Shinigami","c1":"Gotei 13 / Aizen","c2":"3e","c3":"Shinso","c4":"Oui","c5":"Soul Society"},"Kaname Tosen":{"c0":"Shinigami","c1":"Gotei 13 / Aizen","c2":"9e","c3":"Suzumushi","c4":"Oui","c5":"Soul Society"},"Tier Harribel":{"c0":"Arrancar","c1":"Espada","c2":"3","c3":"Tiburon","c4":"Non","c5":"Hueco Mundo"},"Nnoitra Gilga":{"c0":"Arrancar","c1":"Espada","c2":"5","c3":"Santa Teresa","c4":"Non","c5":"Hueco Mundo"},"Szayelaporro Granz":{"c0":"Arrancar","c1":"Espada","c2":"8","c3":"Fornicaras","c4":"Non","c5":"Hueco Mundo"},"Askin Nakk Le Vaar":{"c0":"Quincy","c1":"Wandenreich","c2":"Sternritter D","c3":"The Deathdealing","c4":"Non","c5":"Empire Quincy"}},"hxh":{"Nobunaga Hazama":{"c0":"Brigand","c1":"Renforcement","c2":"Brigade Fantôme","c3":"Sabre","c4":"Aucune","c5":"Yorknew"},"Franklin Bordeau":{"c0":"Brigand","c1":"Émission","c2":"Brigade Fantôme","c3":"Double Machine Gun","c4":"Aucune","c5":"Yorknew"},"Shizuku Murasaki":{"c0":"Brigand","c1":"Matérialisation","c2":"Brigade Fantôme","c3":"Blinky","c4":"Aucune","c5":"Yorknew"},"Pakunoda":{"c0":"Brigand","c1":"Spécialisation","c2":"Brigade Fantôme","c3":"Memory Bomb","c4":"Aucune","c5":"Yorknew"},"Uvogin":{"c0":"Brigand","c1":"Renforcement","c2":"Brigade Fantôme","c3":"Force brute","c4":"Aucune","c5":"Yorknew"},"Knuckle Bine":{"c0":"Hunter","c1":"Matérialisation","c2":"Hunter Association","c3":"Hakoware","c4":"Aucune","c5":"Chimera Ant"},"Morel Mackernasey":{"c0":"Hunter","c1":"Manipulation","c2":"Hunter Association","c3":"Deep Purple","c4":"Aucune","c5":"Chimera Ant"},"Palm Siberia":{"c0":"Hunter","c1":"Renforcement","c2":"Hunter Association","c3":"Black Widow","c4":"Aucune","c5":"Chimera Ant"},"Razor":{"c0":"Game Master","c1":"Émission","c2":"Greed Island","c3":"14 Devils","c4":"Aucune","c5":"Greed Island"},"Genthru":{"c0":"Criminel","c1":"Matérialisation","c2":"Bomber","c3":"Little Flower / Countdown","c4":"Aucune","c5":"Greed Island"}},"snk":{"Floch Forster":{"c0":"Paradis","c1":"Bataillon / Jaegeristes","c2":"Aucun","c3":"Paradis","c4":"Non","c5":"Rouge"},"Marco Bott":{"c0":"Paradis","c1":"104e Brigade","c2":"Aucun","c3":"Jinae","c4":"Non","c5":"Brun"},"Petra Ral":{"c0":"Paradis","c1":"Bataillon / Escouade Levi","c2":"Aucun","c3":"Paradis","c4":"Non","c5":"Roux"},"Miche Zacharius":{"c0":"Paradis","c1":"Bataillon","c2":"Aucun","c3":"Paradis","c4":"Non","c5":"Blond"},"Keith Shadis":{"c0":"Paradis","c1":"Corps d'entraînement","c2":"Aucun","c3":"Paradis","c4":"Non","c5":"Brun"},"Dot Pixis":{"c0":"Paradis","c1":"Garnison","c2":"Aucun","c3":"Paradis","c4":"Non","c5":"Chauve"},"Rod Reiss":{"c0":"Paradis","c1":"Famille royale","c2":"Titan pur","c3":"Mur Sina","c4":"Non","c5":"Blond"},"Frieda Reiss":{"c0":"Paradis","c1":"Famille royale","c2":"Originel","c3":"Mur Sina","c4":"Non","c5":"Brun"},"Grisha Yeager":{"c0":"Paradis / Marley","c1":"Restaurateurs eldiennes","c2":"Assaillant / Originel","c3":"Liberio","c4":"Non","c5":"Brun"},"Dina Fritz":{"c0":"Marley","c1":"Restaurateurs eldiennes","c2":"Titan pur","c3":"Liberio","c4":"Non","c5":"Blond"}},"sds":{"Ludociel":{"c0":"Déesse","c1":"Quatre Archanges","c2":"Aucun","c3":"Flash","c4":"Aucun","c5":"Non"},"Sariel":{"c0":"Déesse","c1":"Quatre Archanges","c2":"Aucun","c3":"Tornado","c4":"Aucun","c5":"Non"},"Tarmiel":{"c0":"Déesse","c1":"Quatre Archanges","c2":"Aucun","c3":"Ocean","c4":"Aucun","c5":"Non"},"Chandler":{"c0":"Démon","c1":"Clan des Démons","c2":"Aucun","c3":"Full Counter","c4":"Aucun","c5":"Oui"},"Cusack":{"c0":"Démon","c1":"Clan des Démons","c2":"Aucun","c3":"Resonant","c4":"Aucun","c5":"Oui"},"Zaratras":{"c0":"Humain","c1":"Chevaliers sacrés","c2":"Aucun","c3":"Purification / Foudre","c4":"Aucun","c5":"Non"},"Jericho":{"c0":"Humaine","c1":"Chevaliers sacrés","c2":"Aucun","c3":"Glace","c4":"Aucun","c5":"Non"},"Guila":{"c0":"Humaine","c1":"Chevaliers sacrés","c2":"Aucun","c3":"Explosion","c4":"Aucun","c5":"Non"},"Helbram":{"c0":"Fée","c1":"Chevaliers sacrés","c2":"Aucun","c3":"Link","c4":"Aucun","c5":"Non"},"Fraudrin":{"c0":"Démon","c1":"Dix Commandements","c2":"Altruisme (remplaçant)","c3":"Full Size","c4":"Aucun","c5":"Oui"}},"deathnote":{"Hideki Ide":{"c0":"Enquête","c1":"Membre de l'équipe","c2":"Non","c3":"Non","c4":"Policier","c5":"Humain"},"Hirokazu Ukita":{"c0":"Enquête","c1":"Membre de l'équipe","c2":"Non","c3":"Non","c4":"Policier","c5":"Humain"},"Reiji Namikawa":{"c0":"Yotsuba","c1":"Membre du groupe Yotsuba","c2":"Non","c3":"Non","c4":"Cadre Yotsuba","c5":"Humain"},"Wedy":{"c0":"Enquête","c1":"Collaboratrice de L","c2":"Non","c3":"Non","c4":"Cambrioleuse","c5":"Humain"},"Aiber":{"c0":"Enquête","c1":"Collaborateur de L","c2":"Non","c3":"Non","c4":"Escroc professionnel","c5":"Humain"},"Matt":{"c0":"Mello","c1":"Associé de Mello","c2":"Non","c3":"Non","c4":"Criminel / hacker","c5":"Humain"},"Gelus":{"c0":"Shinigami","c1":"Shinigami","c2":"Oui","c3":"Oui","c4":"Shinigami","c5":"Shinigami"}},"cote":{"Hiyori Shiina":{"c0":"C","c1":"1re","c2":"Non","c3":"Non","c4":"Femme","c5":"Violet"},"Albert Yamada":{"c0":"C","c1":"1re","c2":"Non","c3":"Non","c4":"Homme","c5":"Noir"},"Mio Ibuki":{"c0":"C","c1":"1re","c2":"Non","c3":"Non","c4":"Femme","c5":"Noir"},"Ryuji Kanzaki":{"c0":"B","c1":"1re","c2":"Non","c3":"Non","c4":"Homme","c5":"Noir"},"Masayoshi Hashimoto":{"c0":"A","c1":"1re","c2":"Non","c3":"Non","c4":"Homme","c5":"Noir"},"Masumi Kamuro":{"c0":"A","c1":"1re","c2":"Non","c3":"Non","c4":"Femme","c5":"Brun"},"Sae Chabashira":{"c0":"Professeur classe D","c1":"Professeur","c2":"Non","c3":"Non","c4":"Femme","c5":"Brun"},"Chie Hoshinomiya":{"c0":"Professeur classe B","c1":"Professeur","c2":"Non","c3":"Non","c4":"Femme","c5":"Brun"},"Ichika Amasawa":{"c0":"D","c1":"1re année (nouvelle cohorte)","c2":"Non","c3":"Oui","c4":"Femme","c5":"Rouge"},"Takuya Yagami":{"c0":"B","c1":"1re année (nouvelle cohorte)","c2":"Non","c3":"Oui","c4":"Homme","c5":"Blond"}},"solo":{"Hwang Dongsoo":{"c0":"Humain","c1":"S","c2":"Fighter","c3":"Scavenger","c4":"Force physique","c5":"Non"},"Hwang Dongsuk":{"c0":"Humain","c1":"C","c2":"Tank","c3":"Aucune","c4":"Force / bouclier","c5":"Non"},"Kang Taeshik":{"c0":"Humain","c1":"B","c2":"Assassin","c3":"Association coréenne","c4":"Furtivité","c5":"Non"},"Lee Joohee":{"c0":"Humaine","c1":"B","c2":"Healer","c3":"Aucune","c4":"Guérison","c5":"Non"},"Song Chi-Yul":{"c0":"Humain","c1":"C","c2":"Mage / épéiste","c3":"Aucune","c4":"Magie de feu","c5":"Non"},"Rakan":{"c0":"Monarque","c1":"Monarque","c2":"Monarque des Bêtes","c3":"Monarques","c4":"Transformation bestiale","c5":"Non"},"Sillad":{"c0":"Monarque","c1":"Monarque","c2":"Monarque du Givre","c3":"Monarques","c4":"Glace","c5":"Non"},"Querehsha":{"c0":"Monarque","c1":"Monarque","c2":"Monarque des Fléaux","c3":"Monarques","c4":"Poison / insectes","c5":"Non"},"Tarnak":{"c0":"Monarque","c1":"Monarque","c2":"Monarque du Corps de Fer","c3":"Monarques","c4":"Défense / golems","c5":"Non"},"Esil Radiru":{"c0":"Démon","c1":"Démon noble","c2":"Combattante","c3":"Clan Radiru","c4":"Lance / magie démoniaque","c5":"Non"}},"clover":{"Gauche Adlai":{"c0":"Taureau Noir","c1":"Miroir","c2":"3 feuilles","c3":"Clover","c4":"Noble","c5":"Aucun"},"Gordon Agrippa":{"c0":"Taureau Noir","c1":"Poison / Malédiction","c2":"3 feuilles","c3":"Clover","c4":"Aucun","c5":"Aucun"},"Grey":{"c0":"Taureau Noir","c1":"Transmutation","c2":"3 feuilles","c3":"Clover","c4":"Aucun","c5":"Aucun"},"Dorothy Unsworth":{"c0":"Paon de Corail","c1":"Rêve","c2":"3 feuilles","c3":"Clover","c4":"Aucun","c5":"Aucun"},"Kaiser Granvorka":{"c0":"Orque Pourpre","c1":"Vortex","c2":"3 feuilles","c3":"Clover","c4":"Noble","c5":"Aucun"},"Sekke Bronzazza":{"c0":"Mante Verte","c1":"Bronze","c2":"3 feuilles","c3":"Clover","c4":"Aucun","c5":"Aucun"},"Langris Vaude":{"c0":"Aube d'Or","c1":"Espace","c2":"3 feuilles","c3":"Clover","c4":"Noble","c5":"Aucun"},"Zora Ideale":{"c0":"Taureau Noir","c1":"Piège / Cendre","c2":"3 feuilles","c3":"Clover","c4":"Aucun","c5":"Aucun"},"Patolli":{"c0":"Œil du Soleil de Minuit","c1":"Lumière","c2":"4 feuilles","c3":"Clover","c4":"Elfe","c5":"Aucun"},"Zagred":{"c0":"Démon","c1":"Kotodama","c2":"Aucun","c3":"Monde souterrain","c4":"Aucun","c5":"Démon supérieur"},"Liebe":{"c0":"Démon / Taureau Noir","c1":"Anti-magie","c2":"5 feuilles (avec Asta)","c3":"Clover","c4":"Aucun","c5":"Démon"},"Lucifero":{"c0":"Démon","c1":"Gravité","c2":"Aucun","c3":"Monde souterrain","c4":"Aucun","c5":"Démon suprême"}},"fireforce":{"Ogun Montgomery":{"c0":"4e","c1":"3e","c2":"Non","c3":"Soldat","c4":"Flamy Ink","c5":"Noir"},"Pan Ko Paat":{"c0":"4e","c1":"2e","c2":"Non","c3":"Capitaine","c4":"Buff thermique","c5":"Brun"},"Arrow":{"c0":"White-Clad","c1":"3e","c2":"Non","c3":"Combattante","c4":"Flèches de feu","c5":"Noir"},"Inca Kasugatani":{"c0":"White-Clad","c1":"3e","c2":"Oui","c3":"Pilier","c4":"Détection / lignes de feu","c5":"Rose"},"Assault":{"c0":"White-Clad","c1":"3e","c2":"Non","c3":"Exécuteur","c4":"Projectiles de feu","c5":"Noir"},"Dragon":{"c0":"White-Clad","c1":"3e","c2":"Non","c3":"Destructeur","c4":"Force / feu draconique","c5":"Noir"},"Giovanni":{"c0":"White-Clad / Haijima","c1":"3e","c2":"Non","c3":"Scientifique","c4":"Mécanismes / insectes","c5":"Noir"},"Nataku Son":{"c0":"Haijima","c1":"3e","c2":"Oui","c3":"Pilier","c4":"Rayonnement thermique","c5":"Blond"},"Yuichiro Kurono":{"c0":"Haijima","c1":"2e","c2":"Non","c3":"Combattant","c4":"Fumée noire","c5":"Noir"},"Amaterasu":{"c0":"Amaterasu","c1":"Adolla Burst","c2":"Oui","c3":"Premier Pilier","c4":"Adolla Burst","c5":"Blanc"}},"mushoku":{"Ariel Anemoi Asura":{"c0":"Humaine","c1":"Princesse","c2":"Magie élémentaire basique","c3":"Politique / soutien","c4":"Royaume d'Asura","c5":"Blond"},"Luke Notos Greyrat":{"c0":"Humain","c1":"Chevalier","c2":"Aucune","c3":"Épée","c4":"Ariel","c5":"Blond"},"Talhand":{"c0":"Nain","c1":"Aventurier","c2":"Magie de terre","c3":"Hache / magie","c4":"Fangs of the Black Wolf","c5":"Brun"},"Geese Nukadia":{"c0":"Humain","c1":"Aventurier","c2":"Aucune","c3":"Soutien / stratégie","c4":"Fangs of the Black Wolf","c5":"Brun"},"Soldat Heckler":{"c0":"Humain","c1":"Aventurier rang S","c2":"Aucune","c3":"Épée","c4":"Stepped Leader","c5":"Blond"},"Sara":{"c0":"Humaine","c1":"Aventurière","c2":"Aucune","c3":"Arc","c4":"Counter Arrow","c5":"Blond"},"Linia Dedoldia":{"c0":"Bestiale","c1":"Étudiante / guerrière","c2":"Magie élémentaire","c3":"Corps à corps","c4":"Université de Ranoa","c5":"Brun"},"Pursena Adoldia":{"c0":"Bestiale","c1":"Étudiante / guerrière","c2":"Magie sonore","c3":"Corps à corps","c4":"Université de Ranoa","c5":"Blanc"},"Pax Shirone":{"c0":"Humain","c1":"Prince","c2":"Magie offensive","c3":"Magie","c4":"Shirone","c5":"Noir"},"Randolph Marianne":{"c0":"Humain","c1":"Chevalier de la mort","c2":"Magie / aura","c3":"Épée","c4":"Royaume de Shirone","c5":"Blond"}},"rezero":{"Theresia van Astrea":{"c0":"Humaine","c1":"Astrea","c2":"Protection de la Faucheuse","c3":"Aucun","c4":"Non","c5":"Rouge"},"Ricardo Welkin":{"c0":"Demi-bête","c1":"Anastasia","c2":"Force / combat","c3":"Aucun","c4":"Non","c5":"Brun"},"Mimi Pearlbaton":{"c0":"Demi-bête","c1":"Anastasia","c2":"Magie de feu","c3":"Aucun","c4":"Non","c5":"Orange"},"Al":{"c0":"Humain","c1":"Priscilla","c2":"Autorité / territoire temporel","c3":"Aucun","c4":"Non","c5":"Noir"},"Satella":{"c0":"Demi-elfe","c1":"Sorcières","c2":"Autorité de l'Envie","c3":"Aucun","c4":"Non","c5":"Argent"},"Minerva":{"c0":"Humaine","c1":"Sorcières","c2":"Autorité de la Colère","c3":"Aucun","c4":"Non","c5":"Blond"},"Typhon":{"c0":"Humaine","c1":"Sorcières","c2":"Autorité de l'Orgueil","c3":"Aucun","c4":"Non","c5":"Vert"},"Daphne":{"c0":"Humaine","c1":"Sorcières","c2":"Autorité de la Gourmandise","c3":"Aucun","c4":"Non","c5":"Blanc"},"Sekhmet":{"c0":"Géante","c1":"Sorcières","c2":"Autorité de la Paresse","c3":"Aucun","c4":"Non","c5":"Violet"},"Carmilla":{"c0":"Humaine","c1":"Sorcières","c2":"Autorité de la Luxure","c3":"Aucun","c4":"Non","c5":"Rose"}},"fairy":{"Levy McGarden":{"c0":"Fairy Tail","c1":"Solid Script","c2":"Non","c3":"Écriture","c4":"Femme","c5":"Bleu"},"Lisanna Strauss":{"c0":"Fairy Tail","c1":"Take Over","c2":"Non","c3":"Animal Soul","c4":"Femme","c5":"Blanc"},"Cobra":{"c0":"Crime Sorcière","c1":"Dragon Slayer","c2":"Oui","c3":"Poison","c4":"Homme","c5":"Rouge"},"Minerva Orland":{"c0":"Sabertooth","c1":"Territory","c2":"Non","c3":"Espace","c4":"Femme","c5":"Noir"},"Kagura Mikazuchi":{"c0":"Mermaid Heel","c1":"Gravity Change","c2":"Non","c3":"Gravité","c4":"Femme","c5":"Noir"},"Brandish μ":{"c0":"Alvarez","c1":"Command T","c2":"Non","c3":"Taille / masse","c4":"Femme","c5":"Vert"},"Irene Belserion":{"c0":"Alvarez","c1":"Enchantement / Dragon Slayer","c2":"Oui","c3":"Enchantement","c4":"Femme","c5":"Rouge"},"August":{"c0":"Alvarez","c1":"Copy","c2":"Non","c3":"Variable","c4":"Homme","c5":"Blanc"},"Dimaria Yesta":{"c0":"Alvarez","c1":"Age Seal","c2":"Non","c3":"Temps","c4":"Femme","c5":"Blond"},"Larcade Dragneel":{"c0":"Alvarez","c1":"Pleasure","c2":"Non","c3":"Plaisir / sommeil","c4":"Homme","c5":"Blond"}},"bluelock":{"Ranze Kurona":{"c0":"Latéral / attaquant","c1":"Droit","c2":"Passes courtes / vitesse","c3":"Bastard München","c4":"Non","c5":"Rose"},"Yo Hiori":{"c0":"Milieu","c1":"Gauche","c2":"Passe / vision","c3":"Bastard München","c4":"Non","c5":"Bleu"},"Kiyora Jin":{"c0":"Latéral / milieu","c1":"Droit","c2":"Équilibre / dribble","c3":"Bastard München","c4":"Non","c5":"Noir"},"Charles Chevalier":{"c0":"Milieu offensif","c1":"Gauche","c2":"Passe créative","c3":"Paris X Gen","c4":"Non","c5":"Blond"},"Noel Noa":{"c0":"Attaquant","c1":"Ambidextre","c2":"Finition / ambidextrie","c3":"Bastard München","c4":"Non","c5":"Blond"},"Julian Loki":{"c0":"Attaquant","c1":"Droit","c2":"Vitesse","c3":"Paris X Gen","c4":"Non","c5":"Noir"},"Lavinho":{"c0":"Attaquant","c1":"Droit","c2":"Dribble","c3":"FC Barcha","c4":"Non","c5":"Noir"},"Chris Prince":{"c0":"Attaquant","c1":"Droit","c2":"Physique / tir","c3":"Manshine City","c4":"Non","c5":"Blond"},"Marc Snuffy":{"c0":"Attaquant / meneur","c1":"Droit","c2":"Polyvalence / stratégie","c3":"Ubers","c4":"Non","c5":"Brun"},"Shuto Sendou":{"c0":"Attaquant","c1":"Droit","c2":"Finition","c3":"Ubers","c4":"Non","c5":"Blond"}},"fma":{"Lust":{"c0":"Homunculus","c1":"Homunculus","c2":"Non","c3":"Ultimate Spear","c4":"Oui","c5":"Noir"},"Gluttony":{"c0":"Homunculus","c1":"Homunculus","c2":"Non","c3":"Faux Portail de la Vérité","c4":"Oui","c5":"Chauve"},"Sloth":{"c0":"Homunculus","c1":"Homunculus","c2":"Non","c3":"Force / vitesse","c4":"Oui","c5":"Noir"},"Selim Bradley":{"c0":"Homunculus","c1":"Amestris / Homunculus","c2":"Non","c3":"Ombres","c4":"Oui","c5":"Noir"},"Barry the Chopper":{"c0":"Âme liée à une armure","c1":"Laboratoire 5","c2":"Non","c3":"Aucune","c4":"Non","c5":"—"},"Maria Ross":{"c0":"Humaine","c1":"Armée d'Amestris","c2":"Non","c3":"Aucune","c4":"Non","c5":"Noir"},"Denny Brosh":{"c0":"Humain","c1":"Armée d'Amestris","c2":"Non","c3":"Aucune","c4":"Non","c5":"Brun"},"Buccaneer":{"c0":"Humain / automail","c1":"Fort Briggs","c2":"Non","c3":"Aucune","c4":"Non","c5":"Blond"},"Miles":{"c0":"Humain","c1":"Fort Briggs","c2":"Non","c3":"Aucune","c4":"Non","c5":"Blanc"},"Basque Grand":{"c0":"Humain","c1":"Armée d'Amestris","c2":"Oui","c3":"Alchimie du fer / armes","c4":"Non","c5":"Brun"}},"chainsaw":{"Future Devil":{"c0":"Démon","c1":"Public Safety","c2":"Future","c3":"Non","c4":"Homme","c5":"Noir"},"Fox Devil":{"c0":"Démon","c1":"Public Safety (contrats)","c2":"Fox","c3":"Non","c4":"Femme","c5":"Blanc"},"Ghost Devil":{"c0":"Démon","c1":"Contrat d'Himeno","c2":"Ghost","c3":"Non","c4":"Femme","c5":"Blanc"},"Curse Devil":{"c0":"Démon","c1":"Contrats","c2":"Curse","c3":"Non","c4":"Indéterminé","c5":"Noir"},"Cosmo":{"c0":"Fiend","c1":"Quanxi","c2":"Cosmos","c3":"Non","c4":"Femme","c5":"Rose"},"Long":{"c0":"Fiend","c1":"Quanxi","c2":"Dragon","c3":"Non","c4":"Femme","c5":"Noir"},"Pingtsi":{"c0":"Fiend","c1":"Quanxi","c2":"Fiend inconnu","c3":"Non","c4":"Femme","c5":"Noir"},"Tolka":{"c0":"Humain / poupée","c1":"Santa Claus","c2":"Doll","c3":"Non","c4":"Homme","c5":"Brun"},"Fami":{"c0":"Démon","c1":"Four Horsemen","c2":"Famine","c3":"Non","c4":"Femme","c5":"Brun"},"Hirofumi Yoshida":{"c0":"Humain","c1":"Public Safety","c2":"Octopus","c3":"Non","c4":"Homme","c5":"Noir"}},"wakfu":{"Joris Jurgen":{"c0":"Humain / Eliatrope lié","c1":"Confrérie / Bonta","c2":"Wakfu","c3":"Épée / marteau","c4":"Homme","c5":"Blanc"},"Kerubim Crepin":{"c0":"Ecaflip","c1":"Astrub","c2":"Wakfu / chance","c3":"Épée","c4":"Homme","c5":"Blanc"},"Atcham":{"c0":"Ecaflip","c1":"Indépendant","c2":"Wakfu / chance","c3":"Griffes","c4":"Homme","c5":"Noir"},"Remington Smisse":{"c0":"Roublard","c1":"Indépendant","c2":"Bombes / poudre","c3":"Pistolets","c4":"Homme","c5":"Noir"},"Grany Smisse":{"c0":"Chacha","c1":"Remington","c2":"Aucune","c3":"Griffes","c4":"Homme","c5":"Noir"},"Maskemane":{"c0":"Zobal","c1":"Indépendant","c2":"Wakfu","c3":"Masques / corps à corps","c4":"Homme","c5":"Blanc"},"Kabrok":{"c0":"Osamodas","c1":"Commerçant / aventurier","c2":"Wakfu","c3":"Armes diverses","c4":"Homme","c5":"Brun"},"Miranda":{"c0":"Humaine","c1":"Astrub","c2":"Aucune","c3":"Aucune","c4":"Femme","c5":"Brun"},"Armand Sheran Sharm":{"c0":"Sadida","c1":"Royaume Sadida","c2":"Nature","c3":"Magie sadida","c4":"Homme","c5":"Vert"},"Moon":{"c0":"Singe divin","c1":"Île de Moon","c2":"Énergie divine","c3":"Marteau","c4":"Homme","c5":"Brun"}},"demonslayer":{"Kanae Kocho":{"c0":"Pourfendeurs","c1":"Ancien Pilier","c2":"Fleur","c3":"Oui","c4":"Non","c5":"Noir/Violet"},"Kagaya Ubuyashiki":{"c0":"Pourfendeurs","c1":"Chef","c2":"Aucun","c3":"Non","c4":"Non","c5":"Noir"},"Sakonji Urokodaki":{"c0":"Pourfendeurs","c1":"Ancien Pilier","c2":"Eau","c3":"Ancien Pilier","c4":"Non","c5":"Blanc"},"Sabito":{"c0":"Pourfendeurs","c1":"Apprenti","c2":"Eau","c3":"Non","c4":"Non","c5":"Rose"},"Makomo":{"c0":"Pourfendeurs","c1":"Apprentie","c2":"Eau","c3":"Non","c4":"Non","c5":"Noir"},"Jigoro Kuwajima":{"c0":"Pourfendeurs","c1":"Ancien Pilier","c2":"Foudre","c3":"Ancien Pilier","c4":"Non","c5":"Blanc"},"Shinjuro Rengoku":{"c0":"Pourfendeurs","c1":"Ancien Pilier","c2":"Flamme","c3":"Ancien Pilier","c4":"Non","c5":"Blond/Rouge"},"Senjuro Rengoku":{"c0":"Famille Rengoku","c1":"Civil / apprenti","c2":"Aucun","c3":"Non","c4":"Non","c5":"Blond/Rouge"},"Hantengu":{"c0":"Démons","c1":"Lune Supérieure 4","c2":"Émotions / clones","c3":"Non","c4":"Oui","c5":"Noir"},"Gyokko":{"c0":"Démons","c1":"Lune Supérieure 5","c2":"Vases / poissons","c3":"Non","c4":"Oui","c5":"Aucun"}},"pokemon":{"Eevee":{"c0":"Normal","c1":"—","c2":"1","c3":"Non","c4":"Évolue","c5":"Brun"},"Vaporeon":{"c0":"Eau","c1":"—","c2":"1","c3":"Non","c4":"Finale","c5":"Bleu"},"Jolteon":{"c0":"Électrik","c1":"—","c2":"1","c3":"Non","c4":"Finale","c5":"Jaune"},"Flareon":{"c0":"Feu","c1":"—","c2":"1","c3":"Non","c4":"Finale","c5":"Orange"},"Gyarados":{"c0":"Eau","c1":"Vol","c2":"1","c3":"Non","c4":"Finale","c5":"Bleu"},"Lapras":{"c0":"Eau","c1":"Glace","c2":"1","c3":"Non","c4":"Finale","c5":"Bleu"},"Ditto":{"c0":"Normal","c1":"—","c2":"1","c3":"Non","c4":"Finale","c5":"Violet"},"Scyther":{"c0":"Insecte","c1":"Vol","c2":"1","c3":"Non","c4":"Évolue","c5":"Vert"},"Electabuzz":{"c0":"Électrik","c1":"—","c2":"1","c3":"Non","c4":"Évolue","c5":"Jaune"},"Magmar":{"c0":"Feu","c1":"—","c2":"1","c3":"Non","c4":"Évolue","c5":"Rouge"},"Articuno":{"c0":"Glace","c1":"Vol","c2":"1","c3":"Oui","c4":"Finale","c5":"Bleu"},"Zapdos":{"c0":"Électrik","c1":"Vol","c2":"1","c3":"Oui","c4":"Finale","c5":"Jaune"},"Moltres":{"c0":"Feu","c1":"Vol","c2":"1","c3":"Oui","c4":"Finale","c5":"Orange"},"Celebi":{"c0":"Psy","c1":"Plante","c2":"2","c3":"Mythique","c4":"Finale","c5":"Vert"},"Jirachi":{"c0":"Acier","c1":"Psy","c2":"3","c3":"Mythique","c4":"Finale","c5":"Jaune"},"Deoxys":{"c0":"Psy","c1":"—","c2":"3","c3":"Mythique","c4":"Finale","c5":"Rouge"},"Dialga":{"c0":"Acier","c1":"Dragon","c2":"4","c3":"Oui","c4":"Finale","c5":"Bleu"},"Palkia":{"c0":"Eau","c1":"Dragon","c2":"4","c3":"Oui","c4":"Finale","c5":"Rose"},"Giratina":{"c0":"Spectre","c1":"Dragon","c2":"4","c3":"Oui","c4":"Finale","c5":"Noir"},"Zekrom":{"c0":"Dragon","c1":"Électrik","c2":"5","c3":"Oui","c4":"Finale","c5":"Noir"}},"dragonball":{"Tien Shinhan":{"c0":"Humain","c1":"Héros","c2":"Aucune","c3":"7","c4":"Non","c5":"Chauve"},"Chiaotzu":{"c0":"Humain","c1":"Héros","c2":"Aucune","c3":"7","c4":"Non","c5":"Noir"},"Videl":{"c0":"Humaine","c1":"Héros","c2":"Aucune","c3":"7","c4":"Non","c5":"Noir"},"Pan":{"c0":"Saiyan/Humaine","c1":"Héros","c2":"Aucune","c3":"7","c4":"Non","c5":"Noir"},"Bardock":{"c0":"Saiyan","c1":"Armée de Freezer / rebelle","c2":"Oozaru","c3":"7","c4":"Non","c5":"Noir"},"Raditz":{"c0":"Saiyan","c1":"Armée de Freezer","c2":"Oozaru","c3":"7","c4":"Non","c5":"Noir"},"Nappa":{"c0":"Saiyan","c1":"Armée de Freezer","c2":"Oozaru","c3":"7","c4":"Non","c5":"Chauve"},"Android 16":{"c0":"Androïde","c1":"Héros","c2":"Aucune","c3":"7","c4":"Non","c5":"Orange"},"Cooler":{"c0":"Race de Freezer","c1":"Antagoniste","c2":"Forme finale / 5e forme","c3":"7","c4":"Non","c5":"Aucun"},"Dabura":{"c0":"Démon","c1":"Babidi","c2":"Forme démoniaque","c3":"7","c4":"Non","c5":"Rouge"}},"hellsparadise":{"Yamada Asaemon Kisho":{"c0":"Asaemon","c1":"Exécuteur","c2":"Bois","c3":"Katana","c4":"Homme","c5":"Noir"},"Isuzu":{"c0":"Asaemon","c1":"Exécutrice","c2":"Terre","c3":"Katana","c4":"Femme","c5":"Noir"},"Kiyomaru":{"c0":"Asaemon","c1":"Exécuteur","c2":"Feu","c3":"Katana","c4":"Homme","c5":"Noir"},"Tao Fa":{"c0":"Tensen","c1":"Tensen","c2":"Tao","c3":"Tao / plantes","c4":"Variable","c5":"Blanc"},"Gui Fa":{"c0":"Tensen","c1":"Tensen","c2":"Tao","c3":"Tao / plantes","c4":"Variable","c5":"Blanc"}},"gachiakuta":{"Cthoni":{"c0":"Raiders","c1":"Giver","c2":"Manhole","c3":"Vital Instrument / téléportation","c4":"Ground","c5":"Blanc"},"Noerde":{"c0":"Raiders","c1":"Giver","c2":"Mirei","c3":"Vital Instrument / peigne","c4":"Ground","c5":"Noir"},"Fu":{"c0":"Raiders","c1":"Giver","c2":"Jinki","c3":"Vital Instrument","c4":"Ground","c5":"Noir"},"Bundus":{"c0":"Raiders","c1":"Giver","c2":"Hands","c3":"Six prothèses / Vital Instrument","c4":"Ground","c5":"Gris"}},"haikyuu":{"Shinsuke Kita":{"c0":"Inarizaki","c1":"Ailier / capitaine","c2":"3e","c3":"1","c4":"Droite","c5":"Gris"},"Rintaro Suna":{"c0":"Inarizaki","c1":"Central","c2":"2e","c3":"10","c4":"Droite","c5":"Noir"},"Aran Ojiro":{"c0":"Inarizaki","c1":"Ailier / Ace","c2":"3e","c3":"4","c4":"Droite","c5":"Noir"},"Korai Hoshiumi":{"c0":"Kamomedai","c1":"Ailier / Ace","c2":"2e","c3":"5","c4":"Droite","c5":"Blanc"},"Tsutomu Goshiki":{"c0":"Shiratorizawa","c1":"Ailier","c2":"1re","c3":"8","c4":"Droite","c5":"Noir"},"Kenjiro Shirabu":{"c0":"Shiratorizawa","c1":"Passeur","c2":"2e","c3":"10","c4":"Droite","c5":"Brun"},"Eita Semi":{"c0":"Shiratorizawa","c1":"Passeur","c2":"3e","c3":"3","c4":"Droite","c5":"Blond"},"Takanobu Aone":{"c0":"Date Tech","c1":"Central","c2":"2e","c3":"7","c4":"Droite","c5":"Blanc"},"Kenji Futakuchi":{"c0":"Date Tech","c1":"Ailier / capitaine","c2":"2e","c3":"6","c4":"Droite","c5":"Brun"},"Lev Haiba":{"c0":"Nekoma","c1":"Central","c2":"1re","c3":"11","c4":"Droite","c5":"Gris"}},"jjk":{"Mechamaru":{"c0":"Exorcistes","c1":"Semi-grade 1","c2":"Manipulation de marionnettes","c3":"Non","c4":"Oui","c5":"Brun"},"Momo Nishimiya":{"c0":"Exorcistes","c1":"Grade 2","c2":"Manipulation d'outil","c3":"Non","c4":"Oui","c5":"Blond"},"Utahime Iori":{"c0":"Exorcistes","c1":"Semi-grade 1","c2":"Solo Forbidden Area","c3":"Non","c4":"Oui","c5":"Noir"},"Kenjaku":{"c0":"Fléaux / antagoniste","c1":"Spécial","c2":"Transplantation cérébrale / techniques volées","c3":"Womb Profusion","c4":"Oui","c5":"Variable"},"Riko Amanai":{"c0":"Non-exorciste","c1":"Vaisseau du Plasma Stellaire","c2":"Aucune","c3":"Non","c4":"Non","c5":"Noir"},"Dagon":{"c0":"Fléaux","c1":"Spécial","c2":"Eau / shikigami","c3":"Horizon of the Captivating Skandha","c4":"Oui","c5":"Aucun"},"Choso":{"c0":"Cursed Womb","c1":"Spécial","c2":"Manipulation du sang","c3":"Non","c4":"Oui","c5":"Noir"},"Uraume":{"c0":"Antagoniste","c1":"Inconnu","c2":"Formation de glace","c3":"Non","c4":"Oui","c5":"Blanc"},"Mei Mei":{"c0":"Exorcistes","c1":"Grade 1","c2":"Black Bird Manipulation","c3":"Non","c4":"Oui","c5":"Bleu"},"Yuki Tsukumo":{"c0":"Exorcistes","c1":"Grade spécial","c2":"Star Rage","c3":"Non","c4":"Oui","c5":"Blond"}},"jojo":{"Okuyasu Nijimura":{"c0":"4","c1":"Héros","c2":"The Hand","c3":"Courte portée","c4":"Non","c5":"Non"},"Rohan Kishibe":{"c0":"4","c1":"Héros","c2":"Heaven's Door","c3":"Courte portée","c4":"Non","c5":"Non"},"Trish Una":{"c0":"5","c1":"Héros","c2":"Spice Girl","c3":"Courte portée","c4":"Non","c5":"Non"},"Guido Mista":{"c0":"5","c1":"Héros","c2":"Sex Pistols","c3":"Longue portée","c4":"Non","c5":"Non"},"Narancia Ghirga":{"c0":"5","c1":"Héros","c2":"Aerosmith","c3":"Longue portée","c4":"Non","c5":"Non"},"Pannacotta Fugo":{"c0":"5","c1":"Héros","c2":"Purple Haze","c3":"Courte portée","c4":"Non","c5":"Non"},"Leone Abbacchio":{"c0":"5","c1":"Héros","c2":"Moody Blues","c3":"Courte portée","c4":"Non","c5":"Non"},"Weather Report":{"c0":"6","c1":"Héros","c2":"Weather Report","c3":"Contrôle météo","c4":"Non","c5":"Non"},"Narciso Anasui":{"c0":"6","c1":"Héros","c2":"Diver Down","c3":"Courte portée","c4":"Non","c5":"Non"},"Gyro Zeppeli":{"c0":"7","c1":"Héros","c2":"Ball Breaker","c3":"Rotation / longue portée","c4":"Non","c5":"Non"}},"tensura":{"Zegion":{"c0":"Insectar","c1":"Tempest","c2":"Patron","c3":"Mephisto","c4":"Non","c5":"Noir"},"Apito":{"c0":"Insectar","c1":"Tempest","c2":"Patron","c3":"Aucune","c4":"Non","c5":"Jaune"},"Kumara":{"c0":"Cryptide","c1":"Tempest","c2":"Patron","c3":"Bahamut","c4":"Non","c5":"Blond"},"Adalmann":{"c0":"Mort-vivant","c1":"Tempest","c2":"Patron","c3":"Necronomicon","c4":"Non","c5":"Blanc"},"Ramiris":{"c0":"Esprit / fée","c1":"Labyrinthe","c2":"Demon Lord","c3":"Aucune","c4":"Oui","c5":"Blond"},"Leon Cromwell":{"c0":"Humain / héros","c1":"El Dorado","c2":"Demon Lord","c3":"Purity King Metatron","c4":"Oui","c5":"Blond"},"Dagruel":{"c0":"Géant","c1":"Géants","c2":"Demon Lord","c3":"Aucune","c4":"Oui","c5":"Brun"},"Dino":{"c0":"Ange déchu","c1":"Demon Lords","c2":"Demon Lord","c3":"Slothful King Belphegor","c4":"Oui","c5":"Blond"},"Frey":{"c0":"Harpie","c1":"Fulbrosia","c2":"Ancienne Demon Lord","c3":"Aucune","c4":"Non","c5":"Blanc"},"Carrion":{"c0":"Beastman","c1":"Eurazania","c2":"Ancien Demon Lord","c3":"Aucune","c4":"Non","c5":"Blond"}},"opm":{"Watchdog Man":{"c0":"Héros","c1":"Classe S","c2":"12","c3":"Combat animal / garde de Q-City","c4":"Non","c5":"Noir"},"Tanktop Master":{"c0":"Héros","c1":"Classe S","c2":"16","c3":"Force / Tanktop","c4":"Non","c5":"Noir"},"Puri-Puri Prisoner":{"c0":"Héros","c1":"Classe S","c2":"17","c3":"Force / Angel Style","c4":"Non","c5":"Noir"},"Amai Mask":{"c0":"Héros","c1":"Classe A","c2":"1","c3":"Force / régénération","c4":"Non","c5":"Bleu"},"Iaian":{"c0":"Héros","c1":"Classe A","c2":"2","c3":"Sabre","c4":"Non","c5":"Blond"},"Speed-o'-Sound Sonic":{"c0":"Antihéros","c1":"Aucune","c2":"—","c3":"Ninjutsu / vitesse","c4":"Non","c5":"Noir"},"Suiryu":{"c0":"Artiste martial","c1":"Aucune","c2":"—","c3":"Arts martiaux","c4":"Non","c5":"Noir"},"Orochi":{"c0":"Association des monstres","c1":"Dragon","c2":"—","c3":"Arts martiaux / énergie","c4":"Non","c5":"Noir"},"Psykos":{"c0":"Association des monstres","c1":"Dragon","c2":"—","c3":"Télékinésie","c4":"Non","c5":"Vert"},"Black Sperm":{"c0":"Association des monstres","c1":"Dragon","c2":"—","c3":"Multiplication cellulaire","c4":"Non","c5":"Noir"}},"sao":{"Kibaou":{"c0":"SAO","c1":"Humain","c2":"Épée","c3":"Aincrad Liberation Squad","c4":"Homme","c5":"Brun"},"XaXa":{"c0":"GGO / SAO","c1":"Humain","c2":"Fusil / épée","c3":"Laughing Coffin","c4":"Homme","c5":"Noir"},"Vassago Casals":{"c0":"SAO / Underworld","c1":"Humain","c2":"Dague / Mate Chopper","c3":"Laughing Coffin","c4":"Homme","c5":"Noir"},"Selka Zuberg":{"c0":"Underworld","c1":"Humaine d'Underworld","c2":"Arts sacrés","c3":"Église de Rulid","c4":"Femme","c5":"Blond"},"Ronie Arabel":{"c0":"Underworld","c1":"Humaine d'Underworld","c2":"Épée","c3":"Human Empire","c4":"Femme","c5":"Rouge"},"Tiese Shtolienen":{"c0":"Underworld","c1":"Humaine d'Underworld","c2":"Épée","c3":"Human Empire","c4":"Femme","c5":"Rouge"},"Cardinal":{"c0":"Underworld","c1":"IA / humaine d'Underworld","c2":"Arts sacrés","c3":"Grande Bibliothèque","c4":"Femme","c5":"Brun"},"Fanatio Synthesis Two":{"c0":"Underworld","c1":"Humaine d'Underworld","c2":"Heaven Piercing Sword","c3":"Integrity Knights","c4":"Femme","c5":"Noir"},"Deusolbert Synthesis Seven":{"c0":"Underworld","c1":"Humain d'Underworld","c2":"Conflagrant Flame Bow","c3":"Integrity Knights","c4":"Homme","c5":"Rouge"},"Gabriel Miller":{"c0":"GGO / Underworld","c1":"Humain","c2":"Fusil / Incarnation","c3":"Glowgen Defense / Dark Territory","c4":"Homme","c5":"Blond"}},"tokyoghoul":{"Kimi Nishino":{"c0":"Humaine","c1":"Goat / chercheuse","c2":"Aucun","c3":"Non","c4":"—","c5":"Brun"},"Itori":{"c0":"Ghoul","c1":"Clowns","c2":"Rinkaku","c3":"Non","c4":"—","c5":"Rouge"},"Roma Hoito":{"c0":"Ghoul","c1":"Clowns","c2":"Rinkaku","c3":"Oui","c4":"—","c5":"Rouge"},"Kaya Irimi":{"c0":"Ghoul","c1":"Anteiku","c2":"Ukaku","c3":"Non","c4":"—","c5":"Noir"},"Enji Koma":{"c0":"Ghoul","c1":"Anteiku","c2":"Koukaku","c3":"Non","c4":"—","c5":"Brun"},"Iwao Kuroiwa":{"c0":"Humain","c1":"CCG","c2":"Aucun","c3":"Non","c4":"Inspecteur spécial","c5":"Noir"},"Naki":{"c0":"Ghoul","c1":"Aogiri / White Suits","c2":"Koukaku","c3":"Non","c4":"—","c5":"Blanc"},"Tatara":{"c0":"Ghoul","c1":"Aogiri","c2":"Koukaku","c3":"Oui","c4":"—","c5":"Rouge"},"Donato Porpora":{"c0":"Ghoul","c1":"Aogiri / Clowns","c2":"Koukaku","c3":"Non","c4":"—","c5":"Blanc"},"Kurona Yasuhisa":{"c0":"Ghoul artificielle","c1":"Aogiri / Indépendante","c2":"Rinkaku","c3":"Non","c4":"Ex-CCG candidate","c5":"Noir"}},"tokyorevengers":{"Atsushi Sendo":{"c0":"Toman","c1":"Membre","c2":"—","c3":"Non","c4":"Homme","c5":"Rouge"},"Takuya Yamamoto":{"c0":"Toman","c1":"Membre","c2":"—","c3":"Non","c4":"Homme","c5":"Brun"},"Makoto Suzuki":{"c0":"Toman","c1":"Membre","c2":"—","c3":"Non","c4":"Homme","c5":"Noir"},"Kazushi Yamagishi":{"c0":"Toman","c1":"Membre / informateur","c2":"—","c3":"Non","c4":"Homme","c5":"Noir"},"Hinata Tachibana":{"c0":"Civil","c1":"Proche de Takemichi","c2":"—","c3":"Non","c4":"Femme","c5":"Brun"},"Naoto Tachibana":{"c0":"Police","c1":"Inspecteur","c2":"—","c3":"Non","c4":"Homme","c5":"Noir"},"Emma Sano":{"c0":"Civil / famille Sano","c1":"Proche de Toman","c2":"—","c3":"Non","c4":"Femme","c5":"Blond"},"Shinichiro Sano":{"c0":"Black Dragon","c1":"Fondateur / chef","c2":"—","c3":"Non","c4":"Homme","c5":"Noir"},"Nobutaka Osanai":{"c0":"Moebius","c1":"Chef","c2":"—","c3":"Non","c4":"Homme","c5":"Blond"},"Yuzuha Shiba":{"c0":"Civil / famille Shiba","c1":"—","c2":"—","c3":"Non","c4":"Femme","c5":"Orange"}}};

for (const [universeKey, profiles] of Object.entries(DLE_STATIC_PROFILES_MORE)) {
    DLE_STATIC_PROFILES[universeKey] = {
        ...(DLE_STATIC_PROFILES[universeKey] || {}),
        ...profiles
    };
    const current = DLE_TARGET_NAMES[universeKey] || [];
    const seen = new Set(current.map(normalizeDle));
    for (const name of Object.keys(profiles)) {
        if (!seen.has(normalizeDle(name))) {
            current.push(name);
            seen.add(normalizeDle(name));
        }
    }
    DLE_TARGET_NAMES[universeKey] = current;
}

// ================= AnimeDLE V18 — personnages connus supplémentaires =================
// Fiches complètes (6 catégories). Ajoutées seulement si le personnage n'a pas déjà une fiche.
const DLE_STATIC_PROFILES_V18 = {"naruto":{"Kimimaro":{"c0":"Oto","c1":"Garde d'Orochimaru","c2":"Kaguya","c3":"Non élémentaire — Shikotsumyaku","c4":"Aucun","c5":"Non"},"Yugito Nii":{"c0":"Kumo","c1":"Jinchūriki / kunoichi","c2":"Aucun","c3":"Feu","c4":"Aucun","c5":"Ancienne — Matatabi"},"Rōshi":{"c0":"Iwa","c1":"Jinchūriki","c2":"Aucun","c3":"Feu, Terre, Yōton","c4":"Aucun","c5":"Ancien — Son Gokū"},"Han":{"c0":"Iwa","c1":"Jinchūriki","c2":"Aucun","c3":"Feu, Eau, Futton","c4":"Aucun","c5":"Ancien — Kokuō"},"Utakata":{"c0":"Kiri","c1":"Nukenin / Jinchūriki","c2":"Aucun","c3":"Eau","c4":"Aucun","c5":"Ancien — Saiken"},"Kokuō":{"c0":"Iwa","c1":"Bijū","c2":"Bijū","c3":"Feu, Eau, Futton","c4":"Aucun","c5":"Non — c'est un Bijū"},"Saiken":{"c0":"Kiri","c1":"Bijū","c2":"Bijū","c3":"Eau","c4":"Aucun","c5":"Non — c'est un Bijū"},"Chōmei":{"c0":"Taki","c1":"Bijū","c2":"Bijū","c3":"Vent","c4":"Aucun","c5":"Non — c'est un Bijū"}},"onepiece":{"Trafalgar D. Water Law":{"c0":"Heart Pirates","c1":"Capitaine","c2":"Ope Ope no Mi","c3":"Paramecia","c4":"Non","c5":"North Blue"},"Crocodile":{"c0":"Cross Guild","c1":"Capitaine / ex-Grand Corsaire","c2":"Suna Suna no Mi","c3":"Logia","c4":"Non","c5":"Grand Line"},"Bartholomew Kuma":{"c0":"Armée révolutionnaire","c1":"Ex-Grand Corsaire","c2":"Nikyu Nikyu no Mi","c3":"Paramecia","c4":"Non","c5":"South Blue"},"Kozuki Oden":{"c0":"Roger Pirates","c1":"Samouraï","c2":"Aucun","c3":"Aucun","c4":"Oui","c5":"Wano"},"Emporio Ivankov":{"c0":"Armée révolutionnaire","c1":"Commandant","c2":"Horu Horu no Mi","c3":"Paramecia","c4":"Non","c5":"Grand Line"},"Perona":{"c0":"Thriller Bark","c1":"Officière","c2":"Horo Horo no Mi","c3":"Paramecia","c4":"Non","c5":"West Blue"},"Koby":{"c0":"Marine","c1":"Capitaine","c2":"Aucun","c3":"Aucun","c4":"Non","c5":"East Blue"},"Donquixote Rosinante":{"c0":"Marine","c1":"Commandant","c2":"Nagi Nagi no Mi","c3":"Paramecia","c4":"Non","c5":"Mary Geoise"},"Charlotte Pudding":{"c0":"Big Mom Pirates","c1":"Pâtissière","c2":"Memo Memo no Mi","c3":"Paramecia","c4":"Non","c5":"Grand Line"},"Charlotte Cracker":{"c0":"Big Mom Pirates","c1":"Sweet Commander","c2":"Bisu Bisu no Mi","c3":"Paramecia","c4":"Non","c5":"Grand Line"},"Arlong":{"c0":"Arlong Pirates","c1":"Capitaine","c2":"Aucun","c3":"Aucun","c4":"Non","c5":"Île des Hommes-Poissons"},"Kin'emon":{"c0":"Allié de Wano","c1":"Samouraï","c2":"Fuku Fuku no Mi","c3":"Paramecia","c4":"Non","c5":"Wano"},"Magellan":{"c0":"Impel Down","c1":"Directeur","c2":"Doku Doku no Mi","c3":"Paramecia","c4":"Non","c5":"Grand Line"},"Vegapunk":{"c0":"Gouvernement mondial","c1":"Scientifique","c2":"Nomi Nomi no Mi","c3":"Paramecia","c4":"Non","c5":"North Blue"},"Capone Bege":{"c0":"Fire Tank Pirates","c1":"Capitaine","c2":"Shiro Shiro no Mi","c3":"Paramecia","c4":"Non","c5":"West Blue"},"X Drake":{"c0":"Drake Pirates","c1":"Capitaine","c2":"Ryu Ryu no Mi, modèle Allosaure","c3":"Zoan antique","c4":"Non","c5":"North Blue"},"Caesar Clown":{"c0":"Indépendant","c1":"Scientifique","c2":"Gasu Gasu no Mi","c3":"Logia","c4":"Non","c5":"Grand Line"},"Kurozumi Orochi":{"c0":"Wano","c1":"Shogun","c2":"Hebi Hebi no Mi, modèle Yamata no Orochi","c3":"Zoan mythique","c4":"Non","c5":"Wano"},"Tashigi":{"c0":"Marine","c1":"Capitaine","c2":"Aucun","c3":"Aucun","c4":"Non","c5":"East Blue"}},"bleach":{"Sajin Komamura":{"c0":"Shinigami","c1":"Gotei 13","c2":"7e","c3":"Tenken","c4":"Oui","c5":"Soul Society"},"Ikkaku Madarame":{"c0":"Shinigami","c1":"Gotei 13","c2":"11e","c3":"Hozukimaru","c4":"Oui","c5":"Rukongai"},"Yumichika Ayasegawa":{"c0":"Shinigami","c1":"Gotei 13","c2":"11e","c3":"Ruri'iro Kujaku","c4":"Non","c5":"Rukongai"},"Izuru Kira":{"c0":"Shinigami","c1":"Gotei 13","c2":"3e","c3":"Wabisuke","c4":"Non","c5":"Soul Society"},"Momo Hinamori":{"c0":"Shinigami","c1":"Gotei 13","c2":"5e","c3":"Tobiume","c4":"Non","c5":"Rukongai"},"Shuhei Hisagi":{"c0":"Shinigami","c1":"Gotei 13","c2":"9e","c3":"Kazeshini","c4":"Oui","c5":"Rukongai"},"Kensei Muguruma":{"c0":"Shinigami","c1":"Gotei 13","c2":"9e","c3":"Tachikaze","c4":"Oui","c5":"Soul Society"},"Hiyori Sarugaki":{"c0":"Shinigami","c1":"Visored","c2":"Ex-12e","c3":"Kubikiri Orochi","c4":"Non","c5":"Soul Society"},"Nanao Ise":{"c0":"Shinigami","c1":"Gotei 13","c2":"8e","c3":"Shinken Hakkyoken","c4":"Non","c5":"Soul Society"},"Yachiru Kusajishi":{"c0":"Shinigami","c1":"Gotei 13","c2":"11e","c3":"Sanpo Kenju","c4":"Non","c5":"Rukongai"},"Kaien Shiba":{"c0":"Shinigami","c1":"Gotei 13","c2":"13e","c3":"Nejibana","c4":"Non","c5":"Soul Society"},"Tatsuki Arisawa":{"c0":"Humaine","c1":"Karakura","c2":"Aucune","c3":"Karaté","c4":"Non","c5":"Karakura"},"Ryuken Ishida":{"c0":"Quincy","c1":"Karakura","c2":"Aucune","c3":"Arc","c4":"Non","c5":"Karakura"},"Lille Barro":{"c0":"Quincy","c1":"Wandenreich","c2":"Sternritter X","c3":"The X-Axis","c4":"Non","c5":"Empire Quincy"},"Gerard Valkyrie":{"c0":"Quincy","c1":"Wandenreich","c2":"Sternritter M","c3":"The Miracle","c4":"Non","c5":"Empire Quincy"},"Ichibe Hyosube":{"c0":"Shinigami","c1":"Division Zéro","c2":"Zéro","c3":"Ichimonji","c4":"Oui","c5":"Soul Society"}},"hxh":{"Wing":{"c0":"Hunter","c1":"Renforcement","c2":"Aucune","c3":"Enseignement du Nen","c4":"Aucune","c5":"Heavens Arena"},"Zushi":{"c0":"Apprenti","c1":"Renforcement","c2":"Aucune","c3":"Arts martiaux","c4":"Aucune","c5":"Heavens Arena"},"Kastro":{"c0":"Combattant","c1":"Renforcement","c2":"Aucune","c3":"Double","c4":"Aucune","c5":"Heavens Arena"},"Kalluto Zoldyck":{"c0":"Brigand","c1":"Manipulation","c2":"Brigade Fantôme","c3":"Papiers","c4":"Zoldyck","c5":"Yorknew"},"Shoot McMahon":{"c0":"Hunter","c1":"Manipulation","c2":"Hunter Association","c3":"Hotel Rafflesia","c4":"Aucune","c5":"Chimera Ant"},"Kortopi":{"c0":"Brigand","c1":"Matérialisation","c2":"Brigade Fantôme","c3":"Gallery Fake","c4":"Aucune","c5":"Yorknew"},"Neon Nostrade":{"c0":"Civile","c1":"Spécialisation","c2":"Famille Nostrade","c3":"Lovely Ghostwriter","c4":"Aucune","c5":"Yorknew"},"Komugi":{"c0":"Civile","c1":"Aucun","c2":"Aucune","c3":"Gungi","c4":"Aucune","c5":"Chimera Ant"}},"snk":{"Hannes":{"c0":"Paradis","c1":"Garnison","c2":"Aucun","c3":"Shiganshina","c4":"Non","c5":"Blond"},"Carla Yeager":{"c0":"Paradis","c1":"Civile","c2":"Aucun","c3":"Shiganshina","c4":"Non","c5":"Brun"},"Nile Dok":{"c0":"Paradis","c1":"Brigades spéciales","c2":"Aucun","c3":"Paradis","c4":"Non","c5":"Noir"},"Onyankopon":{"c0":"Volontaires","c1":"Volontaires anti-Marley","c2":"Aucun","c3":"Marley","c4":"Non","c5":"Noir"},"Yelena":{"c0":"Volontaires","c1":"Volontaires anti-Marley","c2":"Aucun","c3":"Marley","c4":"Non","c5":"Blond"},"Theo Magath":{"c0":"Marley","c1":"Armée de Marley","c2":"Aucun","c3":"Marley","c4":"Non","c5":"Gris"},"Willy Tybur":{"c0":"Marley","c1":"Famille Tybur","c2":"Aucun","c3":"Marley","c4":"Non","c5":"Blond"},"Lara Tybur":{"c0":"Marley","c1":"Famille Tybur","c2":"Marteau d'armes","c3":"Marley","c4":"Non","c5":"Blond"},"Marcel Galliard":{"c0":"Marley","c1":"Guerriers","c2":"Mâchoire","c3":"Liberio","c4":"Non","c5":"Blond"},"Colt Grice":{"c0":"Marley","c1":"Candidat guerrier","c2":"Aucun","c3":"Liberio","c4":"Non","c5":"Blond"},"Ymir Fritz":{"c0":"Eldia","c1":"Reine","c2":"Originel","c3":"Eldia antique","c4":"Non","c5":"Blond"},"Moblit Berner":{"c0":"Paradis","c1":"Bataillon","c2":"Aucun","c3":"Paradis","c4":"Non","c5":"Brun"},"Uri Reiss":{"c0":"Paradis","c1":"Famille royale","c2":"Originel","c3":"Paradis","c4":"Non","c5":"Blond"},"Kiyomi Azumabito":{"c0":"Hizuru","c1":"Hizuru","c2":"Aucun","c3":"Hizuru","c4":"Non","c5":"Noir"}},"sds":{"Howzer":{"c0":"Humain","c1":"Chevaliers sacrés","c2":"Aucun","c3":"Tempest","c4":"Aucun","c5":"Non"},"Griamore":{"c0":"Humain","c1":"Chevaliers sacrés","c2":"Aucun","c3":"Wall","c4":"Aucun","c5":"Non"},"Dreyfus":{"c0":"Humain","c1":"Chevaliers sacrés","c2":"Aucun","c3":"Break","c4":"Aucun","c5":"Non"},"Vivian":{"c0":"Humaine","c1":"Chevaliers sacrés","c2":"Aucun","c3":"Téléportation","c4":"Aucun","c5":"Non"},"Bartra Liones":{"c0":"Humain","c1":"Liones","c2":"Aucun","c3":"Clairvoyance","c4":"Aucun","c5":"Non"},"Gustaf":{"c0":"Humain","c1":"Chevaliers sacrés","c2":"Aucun","c3":"Glace","c4":"Aucun","c5":"Non"}},"deathnote":{"Halle Lidner":{"c0":"Enquête","c1":"Membre du SPK","c2":"Non","c3":"Non","c4":"Agent SPK","c5":"Humain"},"Stephen Gevanni":{"c0":"Enquête","c1":"Membre du SPK","c2":"Non","c3":"Non","c4":"Agent FBI","c5":"Humain"},"Anthony Rester":{"c0":"Enquête","c1":"Membre du SPK","c2":"Non","c3":"Non","c4":"Agent FBI","c5":"Humain"},"Rod Ross":{"c0":"Mello","c1":"Chef mafieux","c2":"Non","c3":"Non","c4":"Mafia","c5":"Humain"},"Armonia Justin Beyondormason":{"c0":"Shinigami","c1":"Shinigami","c2":"Oui","c3":"Oui natifs","c4":"Shinigami","c5":"Shinigami"},"Hitoshi Demegawa":{"c0":"Kira","c1":"Présentateur partisan","c2":"Non","c3":"Non","c4":"Journaliste","c5":"Humain"}},"cote":{"Kohei Katsuragi":{"c0":"A","c1":"1re","c2":"Non","c3":"Non","c4":"Homme","c5":"Chauve"},"Keisei Yukimura":{"c0":"D","c1":"1re","c2":"Non","c3":"Non","c4":"Homme","c5":"Noir"},"Mei-Yu Wang":{"c0":"D","c1":"1re","c2":"Non","c3":"Non","c4":"Femme","c5":"Noir"},"Akane Tachibana":{"c0":"A","c1":"3e","c2":"Oui","c3":"Non","c4":"Femme","c5":"Noir"},"Kazuma Sakagami":{"c0":"Professeur classe C","c1":"Professeur","c2":"Non","c3":"Non","c4":"Homme","c5":"Noir"},"Nanase Tsubasa":{"c0":"D","c1":"1re année (nouvelle cohorte)","c2":"Non","c3":"Non","c4":"Femme","c5":"Noir"},"Kazuomi Hosen":{"c0":"D","c1":"1re année (nouvelle cohorte)","c2":"Non","c3":"Non","c4":"Homme","c5":"Blanc"}},"solo":{"Sung Jinah":{"c0":"Humaine","c1":"—","c2":"Civile","c3":"Aucune","c4":"Aucun","c5":"Non"},"Goto Ryuji":{"c0":"Humain","c1":"S","c2":"Combattant","c3":"Japon","c4":"Force physique","c5":"Non"},"Norma Selner":{"c0":"Humaine","c1":"S","c2":"Éveilleuse","c3":"États-Unis","c4":"Éveil des pouvoirs","c5":"Non"},"Legia":{"c0":"Monarque","c1":"Monarque","c2":"Monarque des Géants","c3":"Monarques","c4":"Taille / force","c5":"Non"}},"clover":{"Secre Swallowtail":{"c0":"Taureau Noir","c1":"Scellement","c2":"3 feuilles","c3":"Clover","c4":"Aucun","c5":"Aucun"},"Henry Legolant":{"c0":"Taureau Noir","c1":"Recombinaison","c2":"3 feuilles","c3":"Clover","c4":"Noble","c5":"Aucun"},"Klaus Lunettes":{"c0":"Aube d'Or","c1":"Acier","c2":"3 feuilles","c3":"Clover","c4":"Noble","c5":"Aucun"},"Solid Silva":{"c0":"Aigle d'Argent","c1":"Eau","c2":"3 feuilles","c3":"Clover","c4":"Royal","c5":"Aucun"},"Nebra Silva":{"c0":"Aigle d'Argent","c1":"Illusion","c2":"3 feuilles","c3":"Clover","c4":"Royale","c5":"Aucun"},"Fana":{"c0":"Œil du Soleil de Minuit","c1":"Feu","c2":"3 feuilles","c3":"Clover","c4":"Aucun","c5":"Esprit"},"Rades Spirito":{"c0":"Œil du Soleil de Minuit","c1":"Réanimation","c2":"3 feuilles","c3":"Clover","c4":"Aucun","c5":"Aucun"},"Licht":{"c0":"Elfes","c1":"Épée","c2":"4 feuilles","c3":"Clover","c4":"Elfe","c5":"Aucun"},"Rhya":{"c0":"Œil du Soleil de Minuit","c1":"Copie","c2":"3 feuilles","c3":"Clover","c4":"Aucun","c5":"Aucun"},"Mars":{"c0":"Royaume de Diamond","c1":"Minéraux","c2":"3 feuilles","c3":"Diamond","c4":"Aucun","c5":"Aucun"}},"rezero":{"Petelgeuse Romanee-Conti":{"c0":"Esprit","c1":"Culte","c2":"Autorité de la Paresse","c3":"Aucun","c4":"Non","c5":"Vert"},"Elsa Granhiert":{"c0":"Humaine","c1":"Indépendante","c2":"Régénération","c3":"Aucun","c4":"Non","c5":"Noir"},"Petra Leyte":{"c0":"Humaine","c1":"Emilia","c2":"Aucun","c3":"Aucun","c4":"Non","c5":"Orange"},"Sirius Romanee-Conti":{"c0":"Humaine","c1":"Culte","c2":"Autorité de la Colère","c3":"Aucun","c4":"Non","c5":"Argent"},"Lye Batenkaitos":{"c0":"Humain","c1":"Culte","c2":"Autorité de la Gourmandise","c3":"Aucun","c4":"Non","c5":"Brun"},"Capella Emerada Lugunica":{"c0":"Humaine","c1":"Culte","c2":"Autorité de la Luxure","c3":"Aucun","c4":"Non","c5":"Blond"},"Meili Portroute":{"c0":"Humaine","c1":"Emilia","c2":"Contrôle des bêtes","c3":"Aucun","c4":"Non","c5":"Bleu"}},"fairy":{"Happy":{"c0":"Fairy Tail","c1":"Aera","c2":"Non","c3":"Vol","c4":"Homme","c5":"Bleu"},"Carla":{"c0":"Fairy Tail","c1":"Aera","c2":"Non","c3":"Vol","c4":"Femme","c5":"Blanc"},"Panther Lily":{"c0":"Fairy Tail","c1":"Aera","c2":"Non","c3":"Épée / Vol","c4":"Homme","c5":"Noir"},"Lyon Vastia":{"c0":"Lamia Scale","c1":"Ice-Make","c2":"Non","c3":"Glace","c4":"Homme","c5":"Blanc"},"Ultear Milkovich":{"c0":"Crime Sorcière","c1":"Arc of Time","c2":"Non","c3":"Temps","c4":"Femme","c5":"Noir"},"Meredy":{"c0":"Crime Sorcière","c1":"Maguilty Sense","c2":"Non","c3":"Liaison sensorielle","c4":"Femme","c5":"Rose"},"Jura Neekis":{"c0":"Lamia Scale","c1":"Iron Rock","c2":"Non","c3":"Pierre","c4":"Homme","c5":"Chauve"},"Ichiya":{"c0":"Blue Pegasus","c1":"Parfum","c2":"Non","c3":"Parfum","c4":"Homme","c5":"Orange"},"Mavis Vermillion":{"c0":"Fairy Tail","c1":"Fairy Magic","c2":"Non","c3":"Illusions","c4":"Femme","c5":"Blond"},"Hades":{"c0":"Grimoire Heart","c1":"Maléfice","c2":"Non","c3":"Ténèbres","c4":"Homme","c5":"Blanc"},"Silver Fullbuster":{"c0":"Tartaros","c1":"Ice Devil Slayer","c2":"Non","c3":"Glace","c4":"Homme","c5":"Noir"},"Yukino Agria":{"c0":"Sabertooth","c1":"Stellaire","c2":"Non","c3":"Esprits","c4":"Femme","c5":"Bleu"},"Mard Geer":{"c0":"Tartaros","c1":"Malédiction","c2":"Non","c3":"Épines","c4":"Homme","c5":"Noir"}},"bluelock":{"Gurimu Igarashi":{"c0":"Attaquant","c1":"Droit","c2":"Instinct","c3":"Bastard München","c4":"Non","c5":"Noir"},"Jinpachi Ego":{"c0":"Entraîneur","c1":"Aucun","c2":"Égoïsme","c3":"Blue Lock","c4":"Non","c5":"Noir"}},"fma":{"Solf J. Kimblee":{"c0":"Humain","c1":"Armée d'Amestris","c2":"Oui","c3":"Explosions","c4":"Oui","c5":"Noir"},"Shou Tucker":{"c0":"Humain","c1":"Armée d'Amestris","c2":"Oui","c3":"Chimères","c4":"Non","c5":"Brun"},"Pinako Rockbell":{"c0":"Humaine","c1":"Resembool","c2":"Non","c3":"Aucune","c4":"Non","c5":"Gris"},"Trisha Elric":{"c0":"Humaine","c1":"Resembool","c2":"Non","c3":"Aucune","c4":"Non","c5":"Brun"},"Sig Curtis":{"c0":"Humain","c1":"Amestris","c2":"Non","c3":"Aucune","c4":"Non","c5":"Noir"},"Nina Tucker":{"c0":"Humaine","c1":"Amestris","c2":"Non","c3":"Aucune","c4":"Non","c5":"Brun"},"Fu":{"c0":"Humain","c1":"Xing","c2":"Non","c3":"Arts martiaux","c4":"Non","c5":"Gris"},"Grumman":{"c0":"Humain","c1":"Armée d'Amestris","c2":"Non","c3":"Aucune","c4":"Non","c5":"Blanc"},"Isaac McDougal":{"c0":"Humain","c1":"Indépendant","c2":"Oui","c3":"Glace","c4":"Non","c5":"Noir"}},"chainsaw":{"Barem Bridge":{"c0":"Hybride","c1":"Église de Chainsaw Man","c2":"Flamethrower","c3":"Oui","c4":"Homme","c5":"Noir"},"Fumiko Mifune":{"c0":"Humaine","c1":"Public Safety","c2":"Aucun","c3":"Non","c4":"Femme","c5":"Noir"}},"demonslayer":{"Yoriichi Tsugikuni":{"c0":"Pourfendeurs","c1":"Épéiste légendaire","c2":"Soleil","c3":"Non","c4":"Non","c5":"Noir/Rouge"},"Rui":{"c0":"Démons","c1":"Lune inf. 5","c2":"Art du sang (fils)","c3":"Non","c4":"Oui","c5":"Blanc"},"Enmu":{"c0":"Démons","c1":"Lune inf. 1","c2":"Art du sang (rêves)","c3":"Non","c4":"Oui","c5":"Noir/Vert"},"Daki":{"c0":"Démons","c1":"Lune Supérieure 6","c2":"Art du sang (obi)","c3":"Non","c4":"Oui","c5":"Noir"},"Tamayo":{"c0":"Démons","c1":"—","c2":"Art du sang (parfum)","c3":"Non","c4":"Oui","c5":"Noir"},"Yushiro":{"c0":"Démons","c1":"—","c2":"Art du sang (vision)","c3":"Non","c4":"Oui","c5":"Vert"},"Kaigaku":{"c0":"Démons","c1":"Lune Supérieure 6","c2":"Foudre","c3":"Non","c4":"Oui","c5":"Noir"},"Hotaru Haganezuka":{"c0":"Village des forgerons","c1":"Forgeron","c2":"Aucun","c3":"Non","c4":"Non","c5":"Noir"}},"pokemon":{"Charmander":{"c0":"Feu","c1":"—","c2":"1","c3":"Non","c4":"Base","c5":"Orange"},"Ivysaur":{"c0":"Plante","c1":"Poison","c2":"1","c3":"Non","c4":"Évolue","c5":"Vert"},"Venusaur":{"c0":"Plante","c1":"Poison","c2":"1","c3":"Non","c4":"Finale","c5":"Vert"},"Wartortle":{"c0":"Eau","c1":"—","c2":"1","c3":"Non","c4":"Évolue","c5":"Bleu"},"Magikarp":{"c0":"Eau","c1":"—","c2":"1","c3":"Non","c4":"Base","c5":"Rouge"},"Arcanine":{"c0":"Feu","c1":"—","c2":"1","c3":"Non","c4":"Finale","c5":"Orange"},"Alakazam":{"c0":"Psy","c1":"—","c2":"1","c3":"Non","c4":"Finale","c5":"Jaune"},"Machamp":{"c0":"Combat","c1":"—","c2":"1","c3":"Non","c4":"Finale","c5":"Gris"},"Golem":{"c0":"Roche","c1":"Sol","c2":"1","c3":"Non","c4":"Finale","c5":"Brun"},"Onix":{"c0":"Roche","c1":"Sol","c2":"1","c3":"Non","c4":"Base","c5":"Gris"},"Espeon":{"c0":"Psy","c1":"—","c2":"2","c3":"Non","c4":"Finale","c5":"Violet"},"Umbreon":{"c0":"Ténèbres","c1":"—","c2":"2","c3":"Non","c4":"Finale","c5":"Noir"},"Tyranitar":{"c0":"Roche","c1":"Ténèbres","c2":"2","c3":"Non","c4":"Finale","c5":"Vert"},"Houndoom":{"c0":"Ténèbres","c1":"Feu","c2":"2","c3":"Non","c4":"Finale","c5":"Noir"},"Sceptile":{"c0":"Plante","c1":"—","c2":"3","c3":"Non","c4":"Finale","c5":"Vert"},"Blaziken":{"c0":"Feu","c1":"Combat","c2":"3","c3":"Non","c4":"Finale","c5":"Rouge"},"Swampert":{"c0":"Eau","c1":"Sol","c2":"3","c3":"Non","c4":"Finale","c5":"Bleu"},"Absol":{"c0":"Ténèbres","c1":"—","c2":"3","c3":"Non","c4":"Unique","c5":"Blanc"},"Metagross":{"c0":"Acier","c1":"Psy","c2":"3","c3":"Non","c4":"Finale","c5":"Bleu"},"Garchomp":{"c0":"Dragon","c1":"Sol","c2":"4","c3":"Non","c4":"Finale","c5":"Bleu"},"Piplup":{"c0":"Eau","c1":"—","c2":"4","c3":"Non","c4":"Base","c5":"Bleu"},"Chimchar":{"c0":"Feu","c1":"—","c2":"4","c3":"Non","c4":"Base","c5":"Orange"},"Turtwig":{"c0":"Plante","c1":"—","c2":"4","c3":"Non","c4":"Base","c5":"Vert"},"Glaceon":{"c0":"Glace","c1":"—","c2":"4","c3":"Non","c4":"Finale","c5":"Bleu"},"Leafeon":{"c0":"Plante","c1":"—","c2":"4","c3":"Non","c4":"Finale","c5":"Vert"},"Sylveon":{"c0":"Fée","c1":"—","c2":"6","c3":"Non","c4":"Finale","c5":"Rose"},"Reshiram":{"c0":"Dragon","c1":"Feu","c2":"5","c3":"Oui","c4":"Unique","c5":"Blanc"},"Kyurem":{"c0":"Dragon","c1":"Glace","c2":"5","c3":"Oui","c4":"Unique","c5":"Gris"},"Xerneas":{"c0":"Fée","c1":"—","c2":"6","c3":"Oui","c4":"Unique","c5":"Bleu"},"Yveltal":{"c0":"Ténèbres","c1":"Vol","c2":"6","c3":"Oui","c4":"Unique","c5":"Rouge"},"Solgaleo":{"c0":"Psy","c1":"Acier","c2":"7","c3":"Oui","c4":"Finale","c5":"Blanc"},"Lunala":{"c0":"Psy","c1":"Spectre","c2":"7","c3":"Oui","c4":"Finale","c5":"Violet"},"Mimikyu":{"c0":"Spectre","c1":"Fée","c2":"7","c3":"Non","c4":"Unique","c5":"Jaune"},"Zacian":{"c0":"Fée","c1":"—","c2":"8","c3":"Oui","c4":"Unique","c5":"Bleu"}},"dragonball":{"Whis":{"c0":"Ange","c1":"Neutre","c2":"Aucune","c3":"7","c4":"Non","c5":"Blanc"},"Zeno":{"c0":"Dieu","c1":"Neutre","c2":"Aucune","c3":"Multivers","c4":"Non","c5":"Chauve"},"Zamasu":{"c0":"Kaioshin","c1":"Antagoniste","c2":"Aucune","c3":"10","c4":"Fused Zamasu","c5":"Blanc"},"Mr. Satan":{"c0":"Humain","c1":"Héros","c2":"Aucune","c3":"7","c4":"Non","c5":"Noir"},"Chi-Chi":{"c0":"Humaine","c1":"Héros","c2":"Aucune","c3":"7","c4":"Non","c5":"Noir"},"Dende":{"c0":"Namek","c1":"Héros","c2":"Aucune","c3":"7","c4":"Non","c5":"Vert"},"Captain Ginyu":{"c0":"Extraterrestre","c1":"Armée de Freezer","c2":"Aucune","c3":"7","c4":"Non","c5":"Chauve"},"Zarbon":{"c0":"Extraterrestre","c1":"Armée de Freezer","c2":"Forme monstre","c3":"7","c4":"Non","c5":"Vert"},"Dodoria":{"c0":"Extraterrestre","c1":"Armée de Freezer","c2":"Aucune","c3":"7","c4":"Non","c5":"Chauve"},"Babidi":{"c0":"Alien","c1":"Antagoniste","c2":"Aucune","c3":"7","c4":"Non","c5":"Chauve"},"Janemba":{"c0":"Démon","c1":"Antagoniste","c2":"Super Janemba","c3":"7","c4":"Non","c5":"Aucun"},"Uub":{"c0":"Humain","c1":"Héros","c2":"Aucune","c3":"7","c4":"Non","c5":"Noir"},"Gotenks":{"c0":"Fusion Saiyan","c1":"Héros","c2":"Super Saiyan 3","c3":"7","c4":"Oui","c5":"Noir"},"Supreme Kai":{"c0":"Kaioshin","c1":"Héros","c2":"Aucune","c3":"7","c4":"Kibito Kai","c5":"Blanc"},"Nail":{"c0":"Namek","c1":"Héros","c2":"Aucune","c3":"7","c4":"Piccolo","c5":"Vert"}},"haikyuu":{"Chikara Ennoshita":{"c0":"Karasuno","c1":"Ailier","c2":"2e","c3":"6","c4":"Droite","c5":"Noir"},"Issei Matsukawa":{"c0":"Aoba Johsai","c1":"Central","c2":"3e","c3":"2","c4":"Droite","c5":"Noir"},"Takahiro Hanamaki":{"c0":"Aoba Johsai","c1":"Ailier","c2":"3e","c3":"3","c4":"Droite","c5":"Brun"},"Yutaro Kindaichi":{"c0":"Aoba Johsai","c1":"Central","c2":"1re","c3":"12","c4":"Droite","c5":"Noir"},"Akira Kunimi":{"c0":"Aoba Johsai","c1":"Ailier","c2":"1re","c3":"13","c4":"Droite","c5":"Brun"},"Kentaro Kyotani":{"c0":"Aoba Johsai","c1":"Ailier","c2":"2e","c3":"16","c4":"Droite","c5":"Blond"}},"jjk":{"Kinji Hakari":{"c0":"Exorcistes","c1":"Sans grade","c2":"Idle Death Gamble","c3":"Oui","c4":"Oui","c5":"Gris"},"Kirara Hoshi":{"c0":"Exorcistes","c1":"Sans grade","c2":"Love Rendezvous","c3":"Non","c4":"Oui","c5":"Rose"},"Hiromi Higuruma":{"c0":"Indépendant","c1":"Sans grade","c2":"Deadly Sentencing","c3":"Oui","c4":"Oui","c5":"Noir"},"Naoya Zenin":{"c0":"Exorcistes","c1":"Grade 1","c2":"Projection Sorcery","c3":"Oui","c4":"Oui","c5":"Blond"},"Naobito Zenin":{"c0":"Exorcistes","c1":"Grade 1","c2":"Projection Sorcery","c3":"Non","c4":"Oui","c5":"Gris"},"Hajime Kashimo":{"c0":"Indépendant","c1":"Inconnu","c2":"Électricité","c3":"Non","c4":"Oui","c5":"Bleu"},"Ryu Ishigori":{"c0":"Indépendant","c1":"Inconnu","c2":"Granite Blast","c3":"Non","c4":"Oui","c5":"Noir"},"Takako Uro":{"c0":"Indépendant","c1":"Inconnu","c2":"Sky Manipulation","c3":"Non","c4":"Oui","c5":"Noir"},"Yorozu":{"c0":"Indépendant","c1":"Inconnu","c2":"Construction","c3":"Oui","c4":"Oui","c5":"Noir"},"Fumihiko Takaba":{"c0":"Indépendant","c1":"Sans grade","c2":"Comedian","c3":"Non","c4":"Oui","c5":"Noir"}},"jojo":{"Kars":{"c0":"2","c1":"Ennemi","c2":"Aucun","c3":"—","c4":"Non","c5":"Non"},"Esidisi":{"c0":"2","c1":"Ennemi","c2":"Aucun","c3":"—","c4":"Non","c5":"Non"},"Wamuu":{"c0":"2","c1":"Ennemi","c2":"Aucun","c3":"—","c4":"Non","c5":"Non"},"Rudol von Stroheim":{"c0":"2","c1":"Héros","c2":"Aucun","c3":"—","c4":"Non","c5":"Non"},"Hol Horse":{"c0":"3","c1":"Ennemi","c2":"Emperor","c3":"Longue portée","c4":"Non","c5":"Non"},"Vanilla Ice":{"c0":"3","c1":"Ennemi","c2":"Cream","c3":"Courte portée","c4":"Non","c5":"Non"},"Yukako Yamagishi":{"c0":"4","c1":"Héros","c2":"Love Deluxe","c3":"Distance","c4":"Non","c5":"Non"},"Akira Otoishi":{"c0":"4","c1":"Ennemi","c2":"Red Hot Chili Pepper","c3":"Longue portée","c4":"Non","c5":"Non"},"Shigekiyo Yangu":{"c0":"4","c1":"Héros","c2":"Harvest","c3":"Longue portée","c4":"Non","c5":"Non"},"Risotto Nero":{"c0":"5","c1":"Ennemi","c2":"Metallica","c3":"Distance","c4":"Non","c5":"Non"},"Prosciutto":{"c0":"5","c1":"Ennemi","c2":"The Grateful Dead","c3":"Longue portée","c4":"Non","c5":"Non"},"Ghiaccio":{"c0":"5","c1":"Ennemi","c2":"White Album","c3":"Armure","c4":"Non","c5":"Non"},"Funny Valentine":{"c0":"7","c1":"Ennemi","c2":"D4C","c3":"Courte portée","c4":"Non","c5":"Non"},"Diego Brando":{"c0":"7","c1":"Ennemi","c2":"Scary Monsters","c3":"Transformation","c4":"Non","c5":"Non"},"Hot Pants":{"c0":"7","c1":"Héros","c2":"Cream Starter","c3":"Courte portée","c4":"Non","c5":"Non"},"Ermes Costello":{"c0":"6","c1":"Héros","c2":"Kiss","c3":"Courte portée","c4":"Non","c5":"Non"},"Foo Fighters":{"c0":"6","c1":"Héros","c2":"Foo Fighters","c3":"Colonie","c4":"Non","c5":"Non"},"Emporio Alnino":{"c0":"6","c1":"Héros","c2":"Burning Down the House","c3":"Distance","c4":"Non","c5":"Non"}},"tensura":{"Gazel Dwargo":{"c0":"Nain","c1":"Dwargon","c2":"Roi","c3":"Aucune","c4":"Non","c5":"Brun"},"Kaijin":{"c0":"Nain","c1":"Tempest","c2":"Artisan","c3":"Aucune","c4":"Non","c5":"Brun"},"Treyni":{"c0":"Dryade","c1":"Forêt de Jura","c2":"Gardienne","c3":"Aucune","c4":"Non","c5":"Vert"},"Chloe Aubert":{"c0":"Humaine","c1":"Tempest","c2":"Héroïne","c3":"Chronos","c4":"Non","c5":"Noir"}},"opm":{"Deep Sea King":{"c0":"Monstre","c1":"Aucune","c2":"—","c3":"Force / hydratation","c4":"Non","c5":"Chauve"},"Charanko":{"c0":"Artiste martial","c1":"Aucune","c2":"—","c3":"Arts martiaux","c4":"Non","c5":"Noir"}},"sao":{"Llenn":{"c0":"GGO","c1":"Humaine","c2":"Fusil","c3":"Solo","c4":"Femme","c5":"Rose"},"Pitohui":{"c0":"GGO","c1":"Humaine","c2":"Fusil","c3":"Solo","c4":"Femme","c5":"Noir"}},"tokyoghoul":{"Kuki Urie":{"c0":"Humain/Ghoul artificiel","c1":"CCG","c2":"Koukaku","c3":"Non","c4":"Inspecteur 1re classe","c5":"Noir"},"Nimura Furuta":{"c0":"Demi-ghoul","c1":"Clowns","c2":"Rinkaku","c3":"Non","c4":"Spécial","c5":"Noir"},"Kanae von Rosewald":{"c0":"Ghoul","c1":"Famille Tsukiyama","c2":"Rinkaku","c3":"Non","c4":"—","c5":"Blond"},"Take Hirako":{"c0":"Humain","c1":"CCG","c2":"Aucun","c3":"Non","c4":"Inspecteur spécial","c5":"Noir"}},"tokyorevengers":{"Ran Haitani":{"c0":"Tenjiku","c1":"Cadre","c2":"—","c3":"Non","c4":"Homme","c5":"Noir/Jaune"},"Rindo Haitani":{"c0":"Tenjiku","c1":"Cadre","c2":"—","c3":"Non","c4":"Homme","c5":"Blond"},"Yasuhiro Muto":{"c0":"Toman","c1":"Capitaine","c2":"5e","c3":"Non","c4":"Homme","c5":"Noir"},"Senju Kawaragi":{"c0":"Brahman","c1":"Chef","c2":"—","c3":"Non","c4":"Femme","c5":"Blanc"}}};

for (const [universeKey, profiles] of Object.entries(DLE_STATIC_PROFILES_V18)) {
    const existing = DLE_STATIC_PROFILES[universeKey] || (DLE_STATIC_PROFILES[universeKey] = {});
    const existingNorms = new Set(Object.keys(existing).map(normalizeDle));
    const current = DLE_TARGET_NAMES[universeKey] || (DLE_TARGET_NAMES[universeKey] = []);
    const seen = new Set(current.map(normalizeDle));
    for (const [name, attrs] of Object.entries(profiles)) {
        const n = normalizeDle(name);
        if (existingNorms.has(n)) continue;
        existing[name] = attrs;
        existingNorms.add(n);
        if (!seen.has(n)) { current.push(name); seen.add(n); }
    }
}

// Pokémon : les noms français sont acceptés (Évoli, Tortank, Salamèche...) en plus des noms anglais.
const POKEMON_FR_NAMES = {"Bulbasaur":"Bulbizarre","Ivysaur":"Herbizarre","Venusaur":"Florizarre","Charmander":"Salamèche","Charmeleon":"Reptincel","Charizard":"Dracaufeu","Squirtle":"Carapuce","Wartortle":"Carabaffe","Blastoise":"Tortank","Caterpie":"Chenipan","Metapod":"Chrysacier","Butterfree":"Papilusion","Weedle":"Aspicot","Kakuna":"Coconfort","Beedrill":"Dardargnan","Pidgey":"Roucool","Pidgeotto":"Roucoups","Pidgeot":"Roucarnage","Rattata":"Rattata","Raticate":"Rattatac","Spearow":"Piafabec","Fearow":"Rapasdepic","Ekans":"Abo","Arbok":"Arbok","Pikachu":"Pikachu","Raichu":"Raichu","Sandshrew":"Sabelette","Sandslash":"Sablaireau","Nidoran":"Nidoran","Nidorina":"Nidorina","Nidoqueen":"Nidoqueen","Nidorino":"Nidorino","Nidoking":"Nidoking","Clefairy":"Mélofée","Clefable":"Mélodelfe","Vulpix":"Goupix","Ninetales":"Feunard","Jigglypuff":"Rondoudou","Wigglytuff":"Grodoudou","Zubat":"Nosferapti","Golbat":"Nosferalto","Oddish":"Mystherbe","Gloom":"Ortide","Vileplume":"Rafflesia","Paras":"Paras","Parasect":"Parasect","Venonat":"Mimitoss","Venomoth":"Aéromite","Diglett":"Taupiqueur","Dugtrio":"Triopikeur","Meowth":"Miaouss","Persian":"Persian","Psyduck":"Psykokwak","Golduck":"Akwakwak","Mankey":"Férosinge","Primeape":"Colossinge","Growlithe":"Caninos","Arcanine":"Arcanin","Poliwag":"Ptitard","Poliwhirl":"Têtarte","Poliwrath":"Tartard","Abra":"Abra","Kadabra":"Kadabra","Alakazam":"Alakazam","Machop":"Machoc","Machoke":"Machopeur","Machamp":"Mackogneur","Bellsprout":"Chétiflor","Weepinbell":"Boustiflor","Victreebel":"Empiflor","Tentacool":"Tentacool","Tentacruel":"Tentacruel","Geodude":"Racaillou","Graveler":"Gravalanch","Golem":"Grolem","Ponyta":"Ponyta","Rapidash":"Galopa","Slowpoke":"Ramoloss","Slowbro":"Flagadoss","Magnemite":"Magnéti","Magneton":"Magnéton","Farfetch'd":"Canarticho","Doduo":"Doduo","Dodrio":"Dodrio","Seel":"Otaria","Dewgong":"Lamantine","Grimer":"Tadmorv","Muk":"Grotadmorv","Shellder":"Kokiyas","Cloyster":"Crustabri","Gastly":"Fantominus","Haunter":"Spectrum","Gengar":"Ectoplasma","Onix":"Onix","Drowzee":"Soporifik","Hypno":"Hypnomade","Krabby":"Krabby","Kingler":"Krabboss","Voltorb":"Voltorbe","Electrode":"Électrode","Exeggcute":"Noeunoeuf","Exeggutor":"Noadkoko","Cubone":"Osselait","Marowak":"Ossatueur","Hitmonlee":"Kicklee","Hitmonchan":"Tygnon","Lickitung":"Excelangue","Koffing":"Smogo","Weezing":"Smogogo","Rhyhorn":"Rhinocorne","Rhydon":"Rhinoféros","Chansey":"Leveinard","Tangela":"Saquedeneu","Kangaskhan":"Kangourex","Horsea":"Hypotrempe","Seadra":"Hypocéan","Goldeen":"Poissirène","Seaking":"Poissoroy","Staryu":"Stari","Starmie":"Staross","Mr. Mime":"M. Mime","Scyther":"Insécateur","Jynx":"Lippoutou","Electabuzz":"Élektek","Magmar":"Magmar","Pinsir":"Scarabrute","Tauros":"Tauros","Magikarp":"Magicarpe","Gyarados":"Léviator","Lapras":"Lokhlass","Ditto":"Métamorph","Eevee":"Évoli","Vaporeon":"Aquali","Jolteon":"Voltali","Flareon":"Pyroli","Porygon":"Porygon","Omanyte":"Amonita","Omastar":"Amonistar","Kabuto":"Kabuto","Kabutops":"Kabutops","Aerodactyl":"Ptéra","Snorlax":"Ronflex","Articuno":"Artikodin","Zapdos":"Électhor","Moltres":"Sulfura","Dratini":"Minidraco","Dragonair":"Draco","Dragonite":"Dracolosse","Mewtwo":"Mewtwo","Mew":"Mew","Chikorita":"Germignon","Cyndaquil":"Héricendre","Totodile":"Kaiminus","Pichu":"Pichu","Togepi":"Togepi","Marill":"Marill","Sudowoodo":"Simularbre","Wooper":"Axoloto","Espeon":"Mentali","Umbreon":"Noctali","Steelix":"Steelix","Scizor":"Cizayox","Heracross":"Scarhino","Houndoom":"Démolosse","Ampharos":"Pharamp","Raikou":"Raikou","Entei":"Entei","Suicune":"Suicune","Tyranitar":"Tyranocif","Lugia":"Lugia","Ho-Oh":"Ho-Oh","Celebi":"Celebi","Treecko":"Arcko","Sceptile":"Jungko","Torchic":"Poussifeu","Blaziken":"Braségali","Mudkip":"Gobou","Swampert":"Laggron","Ralts":"Tarsal","Gardevoir":"Gardevoir","Absol":"Absol","Salamence":"Drattak","Metagross":"Métalosse","Milotic":"Milobellus","Latias":"Latias","Latios":"Latios","Groudon":"Groudon","Kyogre":"Kyogre","Rayquaza":"Rayquaza","Jirachi":"Jirachi","Deoxys":"Deoxys","Turtwig":"Tortipouss","Torterra":"Torterra","Chimchar":"Ouisticram","Infernape":"Simiabraz","Piplup":"Tiplouf","Empoleon":"Pingoléon","Shinx":"Lixy","Luxray":"Luxray","Bidoof":"Keunotor","Riolu":"Riolu","Lucario":"Lucario","Gible":"Griknot","Garchomp":"Carchacrok","Lopunny":"Lockpin","Spiritomb":"Spiritomb","Togekiss":"Togekiss","Weavile":"Dimoret","Magnezone":"Magnézone","Mamoswine":"Mammochon","Gallade":"Gallame","Leafeon":"Phyllali","Glaceon":"Givrali","Rotom":"Motisma","Dialga":"Dialga","Palkia":"Palkia","Giratina":"Giratina","Heatran":"Heatran","Regigigas":"Regigigas","Cresselia":"Cresselia","Darkrai":"Darkrai","Shaymin":"Shaymin","Manaphy":"Manaphy","Arceus":"Arceus","Victini":"Victini","Snivy":"Vipélierre","Tepig":"Gruikui","Oshawott":"Moustillon","Zorua":"Zorua","Zoroark":"Zoroark","Hydreigon":"Trioxhydre","Volcarona":"Pyrax","Reshiram":"Reshiram","Zekrom":"Zekrom","Kyurem":"Kyurem","Keldeo":"Keldeo","Meloetta":"Meloetta","Genesect":"Genesect","Chespin":"Marisson","Fennekin":"Feunnec","Froakie":"Grenousse","Greninja":"Amphinobi","Aegislash":"Exagide","Sylveon":"Nymphali","Xerneas":"Xerneas","Yveltal":"Yveltal","Zygarde":"Zygarde","Diancie":"Diancie","Hoopa":"Hoopa","Volcanion":"Volcanion","Rowlet":"Brindibou","Litten":"Flamiaou","Incineroar":"Félinferno","Popplio":"Otaquin","Mimikyu":"Mimiqui","Tapu Koko":"Tokorico","Cosmog":"Cosmog","Solgaleo":"Solgaleo","Lunala":"Lunala","Necrozma":"Necrozma","Magearna":"Magearna","Marshadow":"Marshadow","Zeraora":"Zeraora","Meltan":"Meltan","Melmetal":"Melmetal","Grookey":"Ouistempo","Scorbunny":"Flambino","Sobble":"Larméléon","Corviknight":"Corvaillus","Toxtricity":"Salarsen","Dragapult":"Lanssorien","Zacian":"Zacian","Zamazenta":"Zamazenta","Eternatus":"Éthernatos","Kubfu":"Wushours","Urshifu":"Shifours","Calyrex":"Sylveroy","Sprigatito":"Poussacha","Fuecoco":"Chochodile","Quaxly":"Coiffeton","Koraidon":"Koraidon","Miraidon":"Miraidon"};
(function addPokemonFrenchAliases() {
    const aliases = DLE_MASTER_ALIASES.pokemon || (DLE_MASTER_ALIASES.pokemon = {});
    const known = new Set([...(DLE_MASTER_NAMES.pokemon || []), ...(DLE_TARGET_NAMES.pokemon || [])].map(normalizeDle));
    for (const [en, fr] of Object.entries(POKEMON_FR_NAMES)) {
        for (const norm of [normalizeDle, normalizeRG]) {
            const e = norm(en), f = norm(fr);
            if (!e || !f || e === f) continue;
            if (known.has(normalizeDle(fr))) { if (!aliases[e]) aliases[e] = f; }
            else if (!aliases[f]) aliases[f] = e;
        }
    }
})();


function dleMasterCanonicalNorm(universeKey, rawName) {
    const n = normalizeDle(rawName);
    if (!n) return null;
    const aliased = DLE_MASTER_ALIASES[universeKey]?.[n] || n;
    const names = [
        ...(DLE_TARGET_NAMES[universeKey] || []),
        ...(DLE_MASTER_NAMES[universeKey] || [])
    ];
    return names.some(x => {
        const xn = normalizeDle(x);
        return (DLE_MASTER_ALIASES[universeKey]?.[xn] || xn) === aliased;
    }) ? aliased : null;
}
function dleMasterDisplayName(universeKey, canonicalNorm) {
    const names = [
        ...(DLE_TARGET_NAMES[universeKey] || []),
        ...(DLE_MASTER_NAMES[universeKey] || [])
    ];
    return names.find(x => {
        const xn = normalizeDle(x);
        return (DLE_MASTER_ALIASES[universeKey]?.[xn] || xn) === canonicalNorm;
    }) || null;
}

const DLE_VERIFIED_PROFILES = Object.fromEntries(
    Object.keys(DLE_UNIVERSES).map(k => [k, new Map()])
);
const DLE_ENRICHMENT_STATE = {
    running: false,
    startedAt: null,
    currentUniverse: null,
    checked: 0,
    completed: 0,
    skipped: 0,
    lastError: null
};

function isRealDleValue(v) {
    if (v === undefined || v === null) return false;
    const s = String(v).trim();
    if (!s || s === '?') return false;
    return !/^(non révélé|non precise|non précisé|non précisée|non précisés|non précisées|non révélé \/ non précisé|donnée invalide)$/i
        .test(normalizeDle(s));
}

function isCompleteDleAttrs(attrs, categories) {
    return (categories || []).every(cat => isRealDleValue(attrs?.[cat.key]));
}

async function loadVerifiedDleProfilesFromDb() {
    if (!process.env.DATABASE_URL) return;
    try {
        const result = await pool.query('SELECT universe_key, norm_name, display_name, attrs FROM dle_profiles');
        let duplicatesIgnored = 0, outsideMasterIgnored = 0;
        for (const row of result.rows) {
            const base = DLE_UNIVERSES[row.universe_key];
            if (!base || !DLE_VERIFIED_PROFILES[row.universe_key]) continue;
            if (!isCompleteDleAttrs(row.attrs, base.categories)) continue;
            const canonical = dleMasterCanonicalNorm(row.universe_key, row.display_name || row.norm_name);
            if (!canonical) { outsideMasterIgnored++; continue; }
            const map = DLE_VERIFIED_PROFILES[row.universe_key];
            if (map.has(canonical)) { duplicatesIgnored++; continue; }
            map.set(canonical, {
                name: dleMasterDisplayName(row.universe_key, canonical),
                attrs: row.attrs,
                attrKnown: Object.fromEntries(base.categories.map(cat => [cat.key, true])),
                profiled: true
            });
        }
        console.log(`[AnimeDLE] Profils DB: doublons ignorés=${duplicatesIgnored}, hors liste maître=${outsideMasterIgnored}.`);
    } catch (e) {
        console.warn('[AnimeDLE] Chargement dle_profiles impossible :', e.message);
    }
}

async function saveVerifiedDleProfile(universeKey, character, source='fandom') {
    const base = DLE_UNIVERSES[universeKey];
    if (!base || !character || !isCompleteDleAttrs(character.attrs, base.categories)) return false;
    const canonical = dleMasterCanonicalNorm(universeKey, character.name);
    if (!canonical) return false;
    const displayName = dleMasterDisplayName(universeKey, canonical);
    const verified = {
        name: displayName,
        attrs: { ...character.attrs },
        attrKnown: Object.fromEntries(base.categories.map(cat => [cat.key, true])),
        profiled: true
    };
    DLE_VERIFIED_PROFILES[universeKey].set(canonical, verified);
    if (!process.env.DATABASE_URL) return true;
    try {
        await pool.query(`
            INSERT INTO dle_profiles (universe_key, norm_name, display_name, attrs, source, updated_at)
            VALUES ($1,$2,$3,$4::jsonb,$5,now())
            ON CONFLICT (universe_key, norm_name)
            DO UPDATE SET display_name=EXCLUDED.display_name, attrs=EXCLUDED.attrs, source=EXCLUDED.source, updated_at=now()
        `, [universeKey, canonical, displayName, JSON.stringify(character.attrs), source]);
        return true;
    } catch (e) {
        console.warn(`[AnimeDLE] Sauvegarde profil ${universeKey}/${displayName} impossible:`, e.message);
        return false;
    }
}


const DLE_MANUAL_OVERRIDES = {
    "sao|chudelkin": {
        c0: "Underworld (Alicization)",
        c1: "Humain d'Underworld",
        c2: "Arts sacrés",
        c3: "Église de l'Axiome",
        c4: "Homme",
        c5: "Chauve"
    }
};

const DLE_CATEGORY_ALIASES = {
    "race": ["race","species","espèce","espece","kind","nature"],
    "race/avatar": ["race","species","avatar","virtual / augmented realities","virtual reality"],
    "affiliation": ["affiliation","affiliations","organization","organisation","group","faction","team"],
    "camp": ["affiliation","camp","faction","side","organization","organisation"],
    "groupe": ["affiliation","group","team","faction","organization"],
    "guilde": ["guild","guilde","affiliation","organization","organisation","occupation"],
    "sexe": ["gender","sex","sexe"],
    "cheveux": ["hair color","hair colour","hair","cheveux","couleur des cheveux"],
    "cheveux avatar": ["hair color","hair colour","hair","appearance"],
    "cheveux base": ["hair color","hair colour","hair"],
    "origine": ["origin","birthplace","place of birth","hometown","home","residence","origine"],
    "arme": ["weapon","weapons","arme","equipment","weaponry"],
    "arme/style": ["weapon","weapons","fighting style","style","combat style","abilities"],
    "arme principale": ["weapon","weapons","main weapon","specialty","style"],
    "rang": ["rank","ranking","class","grade","rang"],
    "rôle": ["occupation","role","position","title"],
    "classe/rôle": ["class","occupation","role","position"],
    "statut": ["status","occupation","role","classification"],
    "famille": ["family","relatives","family members","clan"],
    "élément": ["element","elements","attribute","magic","ability"],
    "élément/énergie": ["element","energy","power","ability","magic"],

    "village": ["village","affiliation","residence"],
    "clan": ["clan","family"],
    "nature chakra": ["nature type","chakra nature","nature transformation","chakra affinity","nature"],
    "dōjutsu": ["dōjutsu","dojutsu","kekkei genkai","eye technique","eyes"],
    "jinchūriki": ["jinchūriki","jinchuriki","tailed beast","host"],

    "équipage/org.": ["affiliations","affiliation","crew","organization","occupation"],
    "fruit du démon": ["devil fruit","fruit","devil fruit name"],
    "type de fruit": ["devil fruit type","fruit type","type"],
    "haki royal": ["conqueror haki","haoshoku haki","haki"],

    "division": ["division","position","rank","affiliation"],
    "arme/pouvoir": ["zanpakutō","zanpakuto","weapon","abilities","powers"],
    "bankai": ["bankai"],

    "type de nen": ["nen type","nen","aura type","nen category"],
    "arc d'intro": ["first appearance","debut","arc"],

    "unité": ["unit","branch","occupation","affiliation"],
    "titan": ["titan","titan form","power of the titans"],
    "lien ackerman": ["family","relatives","clan"],

    "péché/commandement": ["sin","commandment","title"],
    "magie": ["magic","magical power","ability","abilities"],
    "trésor sacré": ["sacred treasure","weapon"],
    "marque démoniaque": ["demon mark","demon clan","power"],

    "death note possédé": ["death note","notebook","equipment"],
    "yeux de shinigami": ["shinigami eyes","eyes"],
    "profession": ["occupation","profession","job"],
    "humain/shinigami": ["species","race","nature"],

    "classe": ["class","school class","classroom","rank"],
    "année": ["year","school year","grade"],
    "conseil étudiant": ["student council","occupation","affiliation"],
    "white room": ["white room","affiliation","origin"],

    "pouvoir notable": ["abilities","powers","skills","ability"],
    "nation-level": ["rank","classification","title"],

    "compagnie": ["squad","magic knights squad","company","affiliation","organization"],
    "type de magie": ["magic","magic attribute","attribute","magic type"],
    "grimoire": ["grimoire","clover"],
    "royaume": ["kingdom","origin","residence"],
    "noble/royal": ["social status","nobility","royal","status"],
    "esprit/démon": ["spirit","devil","demon","familiar"],

    "génération": ["generation","pyrokinetic generation","classification"],
    "adolla burst": ["adolla burst","adolla","ability"],

    "style combat": ["fighting style","sword style","combat style","abilities"],

    "pouvoir/autorité": ["authority","divine protection","ability","abilities","magic"],
    "esprit contracté": ["spirit","contracted spirit","contract"],
    "candidate royale": ["royal selection","candidate","occupation"],

    "dragon slayer": ["dragon slayer","magic"],

    "poste": ["position","positions","role"],
    "pied fort": ["dominant foot","foot","preferred foot"],
    "équipe nel": ["team","neo egoist league","affiliation"],
    "new gen xi": ["new generation world xi","new gen xi","title"],

    "nature": ["species","race","nature"],
    "alchimiste d'état": ["state alchemist","occupation","title"],
    "type d'alchimie": ["alchemy","abilities","specialty"],
    "pierre philosophale": ["philosopher's stone","stone","abilities"],

    "démon associé": ["devil","contracted devil","contracts","abilities"],
    "hybride": ["species","nature","hybrid"],

    "souffle/art": ["breathing style","blood demon art","breathing","abilities"],
    "pilier": ["rank","hashira","occupation"],
    "démon": ["species","race","nature"],

    "type 1": ["type","type 1","primary type"],
    "type 2": ["type 2","secondary type"],
    "génération": ["generation","debut","introduced"],
    "légendaire": ["legendary","mythical","classification"],
    "évolution": ["evolution","evolves from","evolves into","evolutionary line"],
    "couleur dominante": ["color","colour","body color"],

    "transformation": ["transformations","transformation","forms","form"],
    "univers": ["universe","affiliation","origin"],
    "fusion": ["fusion","species"],

    "jinki": ["jinki","vital instrument","weapon"],
    "type de jinki": ["jinki","weapon type","type"],

    "équipe lycée": ["team","school","affiliation"],
    "numéro": ["number","jersey number","uniform number"],
    "main dominante": ["dominant hand","handedness"],

    "grade": ["grade","rank"],
    "technique": ["cursed technique","technique","abilities"],
    "extension domaine": ["domain expansion","domain"],
    "énergie maudite": ["cursed energy","energy"],

    "partie": ["part","series","debut"],
    "stand": ["stand","stands"],
    "type de stand": ["stand type","type"],
    "hamon": ["hamon","ripple"],
    "famille joestar": ["family","relatives","joestar"],

    "compétence ultime": ["ultimate skill","skill","abilities"],
    "demon lord": ["demon lord","title","rank"],

    "classe héros": ["hero class","class","rank"],
    "pouvoir/style": ["abilities","powers","fighting style"],
    "cyborg": ["species","race","cyborg"],

    "jeu principal": ["virtual / augmented realities","virtual reality","game","games","world","vr"],

    "type de kagune": ["kagune type","kagune","rc type"],
    "kakuja": ["kakuja"],
    "ccg rang": ["rank","ccg rank"],

    "gang": ["gang","affiliation","organization"],
    "voyageur temporel": ["time leaper","time leap","ability"]
};

const DLE_VALUE_DEFAULTS = {
    "sexe": "Non précisé",
    "cheveux": "Non précisés",
    "cheveux avatar": "Non précisés",
    "cheveux base": "Non précisés",
    "couleur dominante": "Non précisée",
    "affiliation": "Non précisée",
    "guilde": "Non précisée",
    "groupe": "Non précisé",
    "camp": "Non précisé",
    "origine": "Non précisée",
    "arme": "Aucune / non précisée",
    "arme/style": "Non précisé",
    "arme principale": "Non précisée",
    "race": "Non précisée",
    "race/avatar": "Non précisée",
    "rang": "Non classé / non précisé",
    "statut": "Non précisé",
    "rôle": "Non précisé",
    "classe/rôle": "Non précisé",
    "jinchūriki": "Non révélé",
    "haki royal": "Non révélé",
    "bankai": "Non révélé",
    "adolla burst": "Non révélé",
    "dragon slayer": "Non révélé",
    "pilier": "Non révélé",
    "démon": "Non révélé",
    "légendaire": "Non révélé",
    "fusion": "Non révélé",
    "cyborg": "Non révélé",
    "kakuja": "Non révélé",
    "voyageur temporel": "Non révélé",
    "white room": "Non révélé",
    "candidate royale": "Non révélé",
    "new gen xi": "Non révélé",
    "alchimiste d'état": "Non révélé",
    "pierre philosophale": "Non révélée",
    "hybride": "Non révélé",
    "demon lord": "Non révélé"
};

function dleFallbackForLabel(label) {
    return DLE_VALUE_DEFAULTS[normalizeDle(label)] || "Non révélé / non précisé";
}

function cleanWikiValue(value) {
    let s = String(value || "");
    s = s.replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, " ")
         .replace(/<ref[^/>]*\/>/gi, " ")
         .replace(/<!--[\s\S]*?-->/g, " ")
         .replace(/\{\{[^{}]*\}\}/g, " ")
         .replace(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g, "$1")
         .replace(/\[https?:\/\/[^\s\]]+\s*([^\]]*)\]/g, "$1")
         .replace(/<br\s*\/?>/gi, " / ")
         .replace(/<[^>]+>/g, " ")
         .replace(/'{2,}/g, "")
         .replace(/&nbsp;/gi, " ")
         .replace(/&amp;/gi, "&")
         .replace(/&quot;/gi, '"')
         .replace(/\s+/g, " ")
         .trim();
    if (!s || s.length > 180) return null;
    return s;
}

function parseWikiFields(wikitext) {
    const fields = new Map();
    const text = String(wikitext || "");
    const rx = /^\|\s*([^=\n]+?)\s*=\s*([\s\S]*?)(?=^\|\s*[^=\n]+?\s*=|^\}\}|$)/gm;
    let m;
    while ((m = rx.exec(text))) {
        const key = normalizeDle(m[1]);
        const val = cleanWikiValue(m[2]);
        if (key && val && !fields.has(key)) fields.set(key, val);
    }
    return fields;
}

function firstMatchingWikiField(fields, aliases) {
    for (const alias of aliases || []) {
        const a = normalizeDle(alias);
        if (fields.has(a)) return fields.get(a);
    }
    for (const alias of aliases || []) {
        const a = normalizeDle(alias);
        for (const [k, v] of fields) {
            if (k.includes(a) || a.includes(k)) return v;
        }
    }
    return null;
}

async function fetchDleWikiWikitext(universeKey, characterName) {
    const sources = DLE_FANDOM_SOURCES[universeKey] || [];
    const source = sources[0];
    if (!source) return null;

    try {
        const searchParams = new URLSearchParams({
            action:"query",
            list:"search",
            srsearch:String(characterName),
            srlimit:"5",
            format:"json",
            origin:"*"
        });
        const search = await fetchJsonWithTimeout(`https://${source.host}/api.php?${searchParams.toString()}`, 10000);
        const results = search?.query?.search || [];
        if (!results.length) return null;

        const wanted = normalizeDle(characterName);
        const exact = results.find(x => normalizeDle(x.title) === wanted);
        const title = (exact || results[0]).title;

        const parseParams = new URLSearchParams({
            action:"parse",
            page:title,
            prop:"wikitext",
            format:"json",
            origin:"*"
        });
        const parsed = await fetchJsonWithTimeout(`https://${source.host}/api.php?${parseParams.toString()}`, 12000);
        return parsed?.parse?.wikitext?.["*"] || null;
    } catch (_) {
        return null;
    }
}

function inferProfileValues(fields, categories) {
    const attrs = {};
    for (const cat of categories) {
        const labelNorm = normalizeDle(cat.label);
        const aliases = DLE_CATEGORY_ALIASES[labelNorm] || [cat.label];
        const val = firstMatchingWikiField(fields, aliases);
        attrs[cat.key] = val || dleFallbackForLabel(cat.label);
    }
    return attrs;
}

async function ensureDleCharacterProfile(universeKey, character, categories) {
    if (!character) return character;

    const cacheKey = `${universeKey}|${normalizeDle(character.name)}`;

    if (DLE_PROFILE_CACHE.has(cacheKey)) {
        const cached = DLE_PROFILE_CACHE.get(cacheKey);
        character.attrs = { ...(character.attrs || {}), ...(cached.attrs || {}) };
        character.attrKnown = { ...(character.attrKnown || {}), ...(cached.attrKnown || {}) };
        character.profiled = Object.values(character.attrKnown || {}).every(Boolean);
        return character;
    }

    const attrs = { ...(character.attrs || {}) };
    const attrKnown = {};

    // Toute donnée présente dans les fiches V2 est considérée comme réelle.
    for (const cat of categories) {
        const v = attrs[cat.key];
        attrKnown[cat.key] = !(v === undefined || v === null || String(v).trim() === "" || String(v).trim() === "?");
    }

    // Overrides vérifiés manuellement.
    const override = DLE_MANUAL_OVERRIDES[cacheKey];
    if (override) {
        Object.assign(attrs, override);
        for (const cat of categories) {
            if (Object.prototype.hasOwnProperty.call(override, cat.key)) attrKnown[cat.key] = true;
        }
    }

    const stillMissing = categories.some(cat => !attrKnown[cat.key]);

    if (stillMissing) {
        const wikitext = await fetchDleWikiWikitext(universeKey, character.name);
        if (wikitext) {
            const fields = parseWikiFields(wikitext);

            for (const cat of categories) {
                if (attrKnown[cat.key]) continue;

                const labelNorm = normalizeDle(cat.label);
                const aliases = DLE_CATEGORY_ALIASES[labelNorm] || [cat.label];
                const found = firstMatchingWikiField(fields, aliases);

                if (found) {
                    attrs[cat.key] = found;
                    attrKnown[cat.key] = true;
                }
            }
        }
    }

    // IMPORTANT : on ne transforme plus une absence de donnée en faux "match".
    // On garde une phrase lisible, mais attrKnown=false.
    for (const cat of categories) {
        if (!attrKnown[cat.key]) {
            attrs[cat.key] = dleFallbackForLabel(cat.label);
            attrKnown[cat.key] = false;
        }
    }

    character.attrs = attrs;
    character.attrKnown = attrKnown;
    character.profiled = Object.values(attrKnown).every(Boolean) && isCompleteDleAttrs(attrs, categories);

    // On ne met en cache définitif que les fiches réellement complètes.
    // Une fiche incomplète pourra être retentée plus tard si le wiki répond mieux.
    if (character.profiled) {
        DLE_PROFILE_CACHE.set(cacheKey, { attrs:{ ...attrs }, attrKnown:{ ...attrKnown } });
    }
    return character;
}

function dleExpandedUniverse(key) {
    const base = dleBaseUniverse(key);
    const byCanonical = new Map();

    for (const c of (base.characters || [])) {
        const canonical = dleMasterCanonicalNorm(key, c.name);
        if (!canonical || byCanonical.has(canonical)) continue;
        byCanonical.set(canonical, {
            name: dleMasterDisplayName(key, canonical), attrs: { ...(c.attrs || {}) },
            attrKnown: Object.fromEntries((base.categories || []).map(cat => [cat.key, true])), profiled: true
        });
    }

    // Fiches statiques réellement complètes (V15).
    for (const [displayName, attrs] of Object.entries(DLE_STATIC_PROFILES[key] || {})) {
        if (!isCompleteDleAttrs(attrs, base.categories)) continue;
        const canonical = dleMasterCanonicalNorm(key, displayName);
        if (!canonical || byCanonical.has(canonical)) continue;
        byCanonical.set(canonical, {
            name: dleMasterDisplayName(key, canonical) || displayName,
            attrs: { ...attrs },
            attrKnown: Object.fromEntries((base.categories || []).map(cat => [cat.key, true])),
            profiled: true
        });
    }

    for (const [cacheKey, attrs] of Object.entries(DLE_MANUAL_OVERRIDES || {})) {
        const [u, raw] = cacheKey.split('|');
        if (u !== key || !isCompleteDleAttrs(attrs, base.categories)) continue;
        const canonical = dleMasterCanonicalNorm(key, raw);
        if (!canonical || byCanonical.has(canonical)) continue;
        byCanonical.set(canonical, {
            name: dleMasterDisplayName(key, canonical), attrs: { ...attrs },
            attrKnown: Object.fromEntries((base.categories || []).map(cat => [cat.key, true])), profiled: true
        });
    }

    for (const [raw, profile] of (DLE_VERIFIED_PROFILES[key] || new Map())) {
        if (!isCompleteDleAttrs(profile.attrs, base.categories)) continue;
        const canonical = dleMasterCanonicalNorm(key, profile.name || raw);
        if (!canonical || byCanonical.has(canonical)) continue;
        byCanonical.set(canonical, {
            name: dleMasterDisplayName(key, canonical), attrs: { ...profile.attrs },
            attrKnown: Object.fromEntries((base.categories || []).map(cat => [cat.key, true])), profiled: true
        });
    }

    return { name: base.name, categories: [...(base.categories || [])], customCategoryCount:(base.categories||[]).length, characters:[...byCanonical.values()] };
}

function getDleMasterNames(universeKey) {
    const names = new Map();
    const source = DLE_TARGET_NAMES[universeKey] || DLE_MASTER_NAMES[universeKey] || [];
    for (const displayName of source) {
        const n = normalizeDle(displayName);
        const canonical = DLE_MASTER_ALIASES[universeKey]?.[n] || n;
        if (canonical && !names.has(canonical)) names.set(canonical, displayName);
    }
    return names;
}

function dleProfileExists(universeKey, rawNameOrNorm) {
    const canonical = dleMasterCanonicalNorm(universeKey, rawNameOrNorm);
    if (!canonical) return false;
    if (DLE_VERIFIED_PROFILES[universeKey]?.has(canonical)) return true;
    const base = DLE_UNIVERSES[universeKey];
    if ((base?.characters || []).some(c => dleMasterCanonicalNorm(universeKey, c.name) === canonical)) return true;
    if (Object.keys(DLE_STATIC_PROFILES[universeKey] || {}).some(name => dleMasterCanonicalNorm(universeKey, name) === canonical)) return true;
    return Object.entries(DLE_MANUAL_OVERRIDES || {}).some(([k, attrs]) => {
        const [u,n] = k.split('|');
        return u === universeKey && dleMasterCanonicalNorm(universeKey, n) === canonical && isCompleteDleAttrs(attrs, base.categories);
    });
}

function sleepDle(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function enrichOneDleProfile(universeKey, displayName) {
    const base = DLE_UNIVERSES[universeKey];
    if (!base) return false;

    const normName = normalizeDle(displayName);
    if (dleProfileExists(universeKey, normName)) return true;

    const character = {
        name: displayName,
        attrs: {},
        attrKnown: Object.fromEntries(base.categories.map(cat => [cat.key, false])),
        profiled: false
    };

    await ensureDleCharacterProfile(universeKey, character, base.categories);

    if (!character.profiled || !isCompleteDleAttrs(character.attrs, base.categories)) {
        return false;
    }

    return await saveVerifiedDleProfile(universeKey, character, 'fandom');
}

async function enrichDleUniverse(universeKey, { delayMs=350 } = {}) {
    DLE_ENRICHMENT_STATE.currentUniverse = universeKey;

    const names = getDleMasterNames(universeKey);

    for (const [normName, displayName] of names) {
        if (dleProfileExists(universeKey, normName)) continue;

        DLE_ENRICHMENT_STATE.checked++;
        try {
            const ok = await enrichOneDleProfile(universeKey, displayName);
            if (ok) DLE_ENRICHMENT_STATE.completed++;
            else DLE_ENRICHMENT_STATE.skipped++;
        } catch (e) {
            DLE_ENRICHMENT_STATE.skipped++;
            DLE_ENRICHMENT_STATE.lastError = e.message;
        }

        if (delayMs > 0) await sleepDle(delayMs);
    }
}

async function startDleProfileEnrichment() {
    if (DLE_ENRICHMENT_STATE.running) return;
    DLE_ENRICHMENT_STATE.running = true;
    DLE_ENRICHMENT_STATE.startedAt = new Date().toISOString();

    try {
        await loadVerifiedDleProfilesFromDb();

        // Priorité aux univers les plus testés / populaires puis le reste.
        const priority = [
            'sao','naruto','onepiece','jjk','dragonball','demonslayer','bluelock',
            'bleach','fairy','clover','hxh','snk','sds','solo','chainsaw',
            'haikyuu','jojo','opm','tokyoghoul','tokyorevengers','pokemon'
        ];
        const rest = Object.keys(DLE_UNIVERSES).filter(k => !priority.includes(k));

        for (const key of [...priority, ...rest]) {
            await enrichDleUniverse(key, { delayMs: 300 });
        }
    } catch (e) {
        DLE_ENRICHMENT_STATE.lastError = e.message;
        console.warn('[AnimeDLE] Enrichissement global interrompu :', e.message);
    } finally {
        DLE_ENRICHMENT_STATE.currentUniverse = null;
        DLE_ENRICHMENT_STATE.running = false;
    }
}

function getDleCompletionStats() {
    const perUniverse = {};
    let totalMaster = 0;
    let totalComplete = 0;

    for (const key of Object.keys(DLE_UNIVERSES)) {
        const master = getDleMasterNames(key);
        const complete = dleExpandedUniverse(key).characters.length;
        const raw = master.size;
        perUniverse[key] = {
            raw,
            complete,
            staticComplete: Object.keys(DLE_STATIC_PROFILES[key] || {}).length,
            incomplete: Math.max(0, raw - complete)
        };
        totalMaster += raw;
        totalComplete += complete;
    }

    return {
        totalMaster,
        totalComplete,
        totalIncomplete: Math.max(0, totalMaster - totalComplete),
        perUniverse,
        enrichment: { ...DLE_ENRICHMENT_STATE }
    };
}

function dlePublicRoom(room) {
    const d = room.dle;
    return {
        ...room,
        dle: d ? {
            universeKey: d.universeKey,
            universeName: d.universeName,
            categories: d.categories,
            poolSize: d.poolSize,
            profiledSize: d.profiledSize,
            guesses: d.guesses,
            finished: d.finished,
            winnerId: d.winnerId,
            winnerName: d.winnerName,
            winnerAttempts: d.winnerAttempts,
            targetName: d.finished ? d.target.name : null,
            candidates: d.candidates
        } : null
    };
}

function emitDleState(room, roomCode) {
    io.to(roomCode).emit('dle_state', dlePublicRoom(room));
}

async function startDle(room, roomCode) {
    const universeKey = DLE_UNIVERSES[room.subMode] ? room.subMode : 'naruto';

    // Priorité à l'univers sélectionné, sans jamais montrer une fiche incomplète.
    enrichDleUniverse(universeKey, { delayMs: 0 }).catch(() => {});

    const u = dleExpandedUniverse(universeKey);
    if (!u.characters.length) {
        io.to(roomCode).emit('game_error', { message:"Aucun personnage AnimeDLE complet pour cet univers." });
        return;
    }

    const target = u.characters[Math.floor(Math.random() * u.characters.length)];

    room.status = 'dle_playing';
    room.dle = {
        universeKey,
        universeName: u.name,
        categories: u.categories,
        target,
        guesses: [],
        attemptsByPlayer: {},
        finished: false,
        winnerId: null,
        winnerName: null,
        winnerAttempts: 0,
        poolSize: u.characters.length,
        profiledSize: u.characters.length,
        candidates: u.characters
            .map(c => ({ label:c.name, name:c.name }))
            .sort((a,b) => a.label.localeCompare(b.label, 'fr'))
    };
    emitDleState(room, roomCode);
}

function resolveDleGuess(room, rawGuess) {
    const u = dleExpandedUniverse(room.dle.universeKey);
    const canonical = dleMasterCanonicalNorm(room.dle.universeKey, rawGuess);
    if (!canonical) return null;
    return u.characters.find(c => dleMasterCanonicalNorm(room.dle.universeKey, c.name) === canonical) || null;
}

function dleTokenSet(value) {
    return String(value ?? '')
        .split(/[\/,+&|]/)
        .map(x => normalizeDle(x))
        .filter(Boolean);
}

function makeDleComparison(character, target, player, categories) {
    const attrs = {};

    for (const cat of categories) {
        const mine = character.attrs?.[cat.key];
        const wanted = target.attrs?.[cat.key];

        const mineKnown = character.attrKnown?.[cat.key] !== false &&
                          mine !== undefined && mine !== null && String(mine).trim() !== "" &&
                          !/^(non révélé|non précisé|non précisée|non précisés|non précisées|non révélé \/ non précisé)$/i.test(String(mine).trim());
        const targetKnown = target.attrKnown?.[cat.key] !== false &&
                            wanted !== undefined && wanted !== null && String(wanted).trim() !== "" &&
                            !/^(non révélé|non précisé|non précisée|non précisés|non précisées|non révélé \/ non précisé)$/i.test(String(wanted).trim());

        const known = mineKnown && targetKnown;
        let match = false;
        let close = false;
        let direction = null;

        if (known) {
            if (cat.type === "number") {
                const a = Number(mine), b = Number(wanted);
                match = Number.isFinite(a) && Number.isFinite(b) && a === b;
                close = !match && Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 2;
                if (!match && Number.isFinite(a) && Number.isFinite(b)) direction = a < b ? "up" : "down";
            } else {
                match = normalizeDle(mine) === normalizeDle(wanted);
                if (!match && !cat.meta) {
                    const a = dleTokenSet(mine);
                    const b = new Set(dleTokenSet(wanted));
                    close = a.some(x => b.has(x));
                }
            }
        }

        attrs[cat.key] = {
            value: known ? mine : "DONNÉE INVALIDE",
            known,
            match,
            close,
            direction
        };
    }

    return {
        playerId: player.id,
        playerName: player.name,
        name: character.name,
        correct: normalizeDle(character.name) === normalizeDle(target.name),
        attrs
    };
}



function cleanImportedWikiValue(value) {
    return String(value ?? '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\[[^\]]*\]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 240);
}
function normalizeImportedFieldMap(fields) {
    const out = {};
    for (const [k,v] of Object.entries(fields || {})) {
        const nk = normalizeDle(k);
        const nv = cleanImportedWikiValue(v);
        if (nk && nv && !out[nk]) out[nk] = nv;
    }
    return out;
}
function importedFieldLookup(fields, aliases) {
    for (const alias of aliases || []) {
        const a = normalizeDle(alias);
        if (fields[a]) return fields[a];
    }
    for (const alias of aliases || []) {
        const a = normalizeDle(alias);
        for (const [k,v] of Object.entries(fields)) {
            if (k.includes(a) || a.includes(k)) return v;
        }
    }
    return null;
}

app.get('/api/dle-targets', (req, res) => {
    const universeKey = String(req.query.universeKey || '').trim();
    const base = DLE_UNIVERSES[universeKey];
    if (!base) return res.status(404).json({ok:false});

    const completeNames = dleExpandedUniverse(universeKey).characters.map(c => c.name);
    res.json({
        ok:true,
        universeKey,
        universeName:base.name,
        categories:base.categories,
        names:DLE_TARGET_NAMES[universeKey] || [],
        completeNames,
        targetCount:(DLE_TARGET_NAMES[universeKey] || []).length,
        completeCount:completeNames.length
    });
});

app.post('/api/dle-import-fandom-profile', express.json({limit:'250kb'}), async (req, res) => {
    try {
        const universeKey = String(req.body?.universeKey || '').trim();
        const name = String(req.body?.name || '').trim();
        const base = DLE_UNIVERSES[universeKey];
        if (!base || !name) return res.status(400).json({ok:false});

        const canonical = dleMasterCanonicalNorm(universeKey, name);
        if (!canonical) return res.status(400).json({ok:false, reason:'not-target'});

        const fields = normalizeImportedFieldMap(req.body?.fields || {});
        const attrs = {};
        const attrKnown = {};
        const missing = [];

        for (const cat of base.categories) {
            const labelNorm = normalizeDle(cat.label);
            const fieldAliases = DLE_CATEGORY_ALIASES[labelNorm] || [cat.label];
            const found = importedFieldLookup(fields, fieldAliases);
            if (found) {
                attrs[cat.key] = found;
                attrKnown[cat.key] = true;
            } else {
                missing.push(cat.label);
                attrKnown[cat.key] = false;
            }
        }

        if (missing.length) {
            return res.json({ok:false, complete:false, missing});
        }

        const character = {
            name:dleMasterDisplayName(universeKey, canonical) || name,
            attrs,
            attrKnown,
            profiled:true
        };
        const saved = await saveVerifiedDleProfile(universeKey, character, 'fandom-browser');
        res.json({ok:!!saved, complete:!!saved, name:character.name});
    } catch (e) {
        res.status(500).json({ok:false,error:e.message});
    }
});

app.post('/api/character-image-cache', express.json({limit:'50kb'}), async (req, res) => {
    try {
        const universeKey = resolveImageUniverseKey(req.body?.universeKey || req.body?.universe || '');
        const name = String(req.body?.name || '').trim();
        const imageUrl = String(req.body?.imageUrl || '').trim();
        const sourceUrl = String(req.body?.sourceUrl || '').trim();
        if (!universeKey || !name || !/^https?:\/\//i.test(imageUrl)) {
            return res.status(400).json({ok:false});
        }
        await saveCachedCharacterImage(universeKey, name, {
            imageUrl,
            sourceUrl:/^https?:\/\//i.test(sourceUrl) ? sourceUrl : null,
            status:'ok-browser'
        });
        res.json({ok:true});
    } catch (e) {
        res.status(500).json({ok:false,error:e.message});
    }
});

app.get('/api/dle-pool-stats', (req, res) => {
    res.json(getDleCompletionStats());
});


/* ================= V25 — MODE CITATIONS =================
   31 univers × 25 citations = 775 citations.
   Les textes sont des formulations courtes/adaptées en français.
============================================================================ */
const QUOTE_UNIVERSES = {"naruto":{"name":"Naruto","quotes":[{"text":"Je deviendrai Hokage, peu importe combien de fois je tombe.","speaker":"Naruto Uzumaki","recipient":"à Iruka et au village","aliases":["Naruto"]},{"text":"Mon seul but est de tuer un certain homme.","speaker":"Sasuke Uchiha","recipient":"à l'équipe 7","aliases":["Sasuke"]},{"text":"Ceux qui abandonnent leurs amis sont pires que des déchets.","speaker":"Kakashi Hatake","recipient":"à l'équipe 7","aliases":["Kakashi"]},{"text":"Même le plus puissant a une faiblesse.","speaker":"Itachi Uchiha","recipient":"à Sasuke","aliases":["Itachi"]},{"text":"Quand on connaît la douleur, on peut comprendre les autres.","speaker":"Pain","recipient":"à Naruto","aliases":["Nagato","Pain Nagato"]},{"text":"Je protégerai Naruto, même si je dois risquer ma vie.","speaker":"Hinata Hyūga","recipient":"à Pain","aliases":["Hinata","Hinata Hyuga"]},{"text":"La jeunesse est une flamme qui ne s'éteint jamais !","speaker":"Might Guy","recipient":"à Rock Lee","aliases":["Guy","Gai","Gaï Maito"]},{"text":"Les règles sont importantes, mais les camarades le sont encore plus.","speaker":"Obito Uchiha","recipient":"à Kakashi","aliases":["Obito"]},{"text":"Un ninja doit voir derrière ce qui est visible.","speaker":"Jiraiya","recipient":"à Naruto","aliases":[]},{"text":"Je veux créer un monde où les enfants n'auront plus à se battre.","speaker":"Hashirama Senju","recipient":"à Madara","aliases":["Hashirama"]},{"text":"Je ne retirerai jamais ma parole. C'est ma voie de ninja.","speaker":"Naruto Uzumaki","recipient":"à Neji","aliases":["Naruto"]},{"text":"La solitude m'a appris combien les liens sont précieux.","speaker":"Gaara","recipient":"à Naruto","aliases":[]},{"text":"Chaque technique a un point faible. Il suffit de l'observer.","speaker":"Shikamaru Nara","recipient":"à ses coéquipiers","aliases":["Shikamaru"]},{"text":"Une fleur ne choisit pas l'endroit où elle doit pousser.","speaker":"Ino Yamanaka","recipient":"à Sakura","aliases":["Ino"]},{"text":"Je ne laisserai pas le clan Hyûga décider de mon destin.","speaker":"Neji Hyūga","recipient":"à Naruto","aliases":["Neji","Neji Hyuga"]},{"text":"Le feu du village vit dans chaque nouvelle génération.","speaker":"Hiruzen Sarutobi","recipient":"aux ninjas de Konoha","aliases":["Hiruzen","Troisième Hokage"]},{"text":"Je protégerai Konoha parce que c'est ce que mon frère voulait.","speaker":"Tsunade","recipient":"à Jiraiya","aliases":[]},{"text":"Je croyais qu'être fort signifiait ne compter sur personne.","speaker":"Sasuke Uchiha","recipient":"à Naruto","aliases":["Sasuke"]},{"text":"Même un ennemi peut devenir quelqu'un qu'on veut sauver.","speaker":"Sakura Haruno","recipient":"à Naruto","aliases":["Sakura"]},{"text":"Ce monde n'a besoin ni de héros ni de haine, seulement de paix.","speaker":"Madara Uchiha","recipient":"à Obito","aliases":["Madara"]},{"text":"Je prouverai qu'un raté peut dépasser un génie à force de travail.","speaker":"Rock Lee","recipient":"à Neji","aliases":["Lee"]},{"text":"Le village est ma famille. Je donnerai ma vie pour son avenir.","speaker":"Minato Namikaze","recipient":"à Naruto","aliases":["Minato","Quatrième Hokage"]},{"text":"Naruto, n'oublie jamais que tu as été aimé dès ta naissance.","speaker":"Kushina Uzumaki","recipient":"à Naruto","aliases":["Kushina"]},{"text":"La connaissance interdite devient intéressante précisément parce qu'on nous l'interdit.","speaker":"Orochimaru","recipient":"à Sasuke","aliases":[]},{"text":"Un jinchūriki peut transformer sa solitude en rythme et en force.","speaker":"Killer B","recipient":"à Naruto","aliases":["Killer Bee","B"]}]},"onepiece":{"name":"One Piece","quotes":[{"text":"Je serai le Roi des Pirates !","speaker":"Monkey D. Luffy","recipient":"à tous ceux qui doutent de lui","aliases":["Luffy"]},{"text":"Je ne perdrai plus jamais jusqu'à devenir le meilleur sabreur.","speaker":"Roronoa Zoro","recipient":"à Luffy","aliases":["Zoro"]},{"text":"Un homme meurt vraiment lorsqu'il est oublié.","speaker":"Dr. Hiriluk","recipient":"à Chopper","aliases":["Hiriluk","Hiluluk"]},{"text":"Je veux vivre ! Emmenez-moi avec vous !","speaker":"Nico Robin","recipient":"aux Chapeaux de paille","aliases":["Robin"]},{"text":"Merci de m'avoir aimé.","speaker":"Portgas D. Ace","recipient":"à Luffy et ses proches","aliases":["Ace"]},{"text":"Les rêves des hommes ne meurent jamais !","speaker":"Marshall D. Teach","recipient":"à Luffy","aliases":["Teach","Barbe Noire","Blackbeard"]},{"text":"Quand le monde te rejette, regarde devant toi et avance.","speaker":"Shanks","recipient":"à Luffy","aliases":[]},{"text":"Je ne frapperai jamais une femme, même si ça doit me coûter la vie.","speaker":"Sanji","recipient":"à ses adversaires","aliases":[]},{"text":"La justice change selon l'endroit où l'on se tient.","speaker":"Donquixote Doflamingo","recipient":"aux combattants de Marineford","aliases":["Doflamingo","Doffy"]},{"text":"Le One Piece existe !","speaker":"Edward Newgate","recipient":"au monde entier","aliases":["Barbe Blanche","Whitebeard"]},{"text":"Je ne veux pas conquérir la mer. Je veux être le plus libre.","speaker":"Monkey D. Luffy","recipient":"à Rayleigh","aliases":["Luffy"]},{"text":"Un sabreur qui tourne le dos à la mort ne progressera jamais.","speaker":"Roronoa Zoro","recipient":"à Mihawk","aliases":["Zoro"]},{"text":"Je veux dessiner une carte du monde entier.","speaker":"Nami","recipient":"aux Chapeaux de paille","aliases":[]},{"text":"Je trouverai All Blue, même si tout le monde se moque de moi.","speaker":"Sanji","recipient":"à ses compagnons","aliases":[]},{"text":"Je veux devenir un médecin capable de tout soigner.","speaker":"Tony Tony Chopper","recipient":"à ses amis","aliases":["Chopper"]},{"text":"Un navire devient un véritable foyer quand son équipage l'aime.","speaker":"Franky","recipient":"aux Chapeaux de paille","aliases":[]},{"text":"Même mort, je peux encore tenir une promesse.","speaker":"Brook","recipient":"à Laboon","aliases":[]},{"text":"La mer n'appartient à personne. C'est pourquoi je l'aime.","speaker":"Jinbe","recipient":"à Luffy","aliases":["Jinbei"]},{"text":"Si tu veux changer le monde, commence par survivre.","speaker":"Trafalgar D. Water Law","recipient":"à Luffy","aliases":["Law","Trafalgar Law"]},{"text":"Les lâches meurent souvent avant que leur corps ne tombe.","speaker":"Kaido","recipient":"à ses adversaires","aliases":["Kaido des Cent Bêtes"]},{"text":"Même si tout le monde rit, je deviendrai un brave guerrier des mers.","speaker":"Usopp","recipient":"aux Chapeaux de paille","aliases":["Ussop"]},{"text":"Dans ce monde, la confiance est un luxe que seuls les faibles se permettent.","speaker":"Crocodile","recipient":"à Luffy","aliases":["Sir Crocodile"]},{"text":"Je peux pardonner beaucoup de choses, mais pas ceux qui menacent Luffy.","speaker":"Boa Hancock","recipient":"à ses ennemis","aliases":["Hancock"]},{"text":"Je porte la volonté d'Ace et je continuerai d'avancer avec elle.","speaker":"Sabo","recipient":"à Luffy","aliases":[]},{"text":"Le trésor que j'ai laissé appartient à celui qui aura le courage de le trouver.","speaker":"Gol D. Roger","recipient":"au monde entier","aliases":["Roger","Gold Roger"]}]},"bleach":{"name":"Bleach","quotes":[{"text":"Si je ne peux pas protéger ceux que j'aime, à quoi sert ma force ?","speaker":"Ichigo Kurosaki","recipient":"à lui-même","aliases":["Ichigo"]},{"text":"La peur est nécessaire pour comprendre le courage.","speaker":"Rukia Kuchiki","recipient":"à Ichigo","aliases":["Rukia"]},{"text":"La fierté ne sert à rien si elle t'empêche de protéger quelqu'un.","speaker":"Byakuya Kuchiki","recipient":"à Rukia","aliases":["Byakuya"]},{"text":"L'admiration est le sentiment le plus éloigné de la compréhension.","speaker":"Sosuke Aizen","recipient":"à ses adversaires","aliases":["Aizen","Sōsuke Aizen"]},{"text":"Je suis venu ici pour me battre. Rien de plus.","speaker":"Kenpachi Zaraki","recipient":"à Ichigo","aliases":["Kenpachi","Zaraki"]},{"text":"Si un miracle n'arrive qu'une fois, appelle ça plutôt de la chance.","speaker":"Kisuke Urahara","recipient":"à Ichigo","aliases":["Urahara"]},{"text":"Je déteste la pluie. Elle tombe aussi dans mon cœur.","speaker":"Orihime Inoue","recipient":"à elle-même","aliases":["Orihime"]},{"text":"La justice sans pouvoir est vide, le pouvoir sans justice est violence.","speaker":"Genryusai Shigekuni Yamamoto","recipient":"au Gotei 13","aliases":["Yamamoto"]},{"text":"Un combat n'est amusant que si l'adversaire peut te tuer.","speaker":"Grimmjow Jaegerjaquez","recipient":"à Ichigo","aliases":["Grimmjow"]},{"text":"Le cœur n'existe que parce que nous ne pouvons pas le voir.","speaker":"Ulquiorra Cifer","recipient":"à Orihime","aliases":["Ulquiorra"]},{"text":"Je me battrai même sans savoir si je peux gagner.","speaker":"Ichigo Kurosaki","recipient":"à Rukia","aliases":["Ichigo"]},{"text":"Un noble doit rester digne même quand son cœur hésite.","speaker":"Byakuya Kuchiki","recipient":"à Renji","aliases":["Byakuya"]},{"text":"Mon zanpakutō n'est pas une arme. C'est une partie de moi.","speaker":"Renji Abarai","recipient":"à Ichigo","aliases":["Renji"]},{"text":"Je préfère un combat honnête à mille victoires faciles.","speaker":"Kenpachi Zaraki","recipient":"à ses adversaires","aliases":["Kenpachi","Zaraki"]},{"text":"Même un scientifique peut être surpris par ce qu'il ne comprend pas.","speaker":"Mayuri Kurotsuchi","recipient":"à ses ennemis","aliases":["Mayuri"]},{"text":"Ceux qui contrôlent l'information contrôlent souvent le combat.","speaker":"Kisuke Urahara","recipient":"à Ichigo","aliases":["Urahara"]},{"text":"Je ne suis pas faible parce que je veux éviter de tuer.","speaker":"Uryu Ishida","recipient":"à ses adversaires","aliases":["Uryu","Uryū"]},{"text":"Ce n'est pas parce que je souris que je ne suis pas dangereuse.","speaker":"Yoruichi Shihoin","recipient":"à ses adversaires","aliases":["Yoruichi"]},{"text":"Le désespoir est parfois la meilleure arme pour briser quelqu'un.","speaker":"Sosuke Aizen","recipient":"à Ichigo","aliases":["Aizen"]},{"text":"Une lame n'a de sens que si elle protège une conviction.","speaker":"Toshiro Hitsugaya","recipient":"à ses hommes","aliases":["Toshiro","Hitsugaya"]},{"text":"Le sourire d'un guérisseur ne signifie pas qu'il ignore la violence.","speaker":"Retsu Unohana","recipient":"à Kenpachi","aliases":["Unohana"]},{"text":"Je préfère une paix imparfaite à une guerre parfaite.","speaker":"Shunsui Kyoraku","recipient":"au Gotei 13","aliases":["Shunsui","Kyōraku"]},{"text":"Je plaisante beaucoup, mais je prends mon devoir très au sérieux.","speaker":"Rangiku Matsumoto","recipient":"à Hitsugaya","aliases":["Rangiku"]},{"text":"Une technique parfaite n'a aucune valeur si elle manque sa cible.","speaker":"Soi Fon","recipient":"à ses subordonnés","aliases":["Soi-Fon"]},{"text":"Un sourire peut cacher une lame bien plus facilement qu'un fourreau.","speaker":"Gin Ichimaru","recipient":"à Rangiku","aliases":["Gin"]}]},"hxh":{"name":"Hunter x Hunter","quotes":[{"text":"Je veux découvrir pourquoi mon père a préféré être Hunter plutôt que rester avec moi.","speaker":"Gon Freecss","recipient":"à ses amis","aliases":["Gon"]},{"text":"Gon, tu es la lumière. Parfois tu brilles trop fort pour moi.","speaker":"Killua Zoldyck","recipient":"à Gon","aliases":["Killua"]},{"text":"Je ne crains que la colère qui pourrait disparaître un jour.","speaker":"Kurapika","recipient":"à lui-même","aliases":[]},{"text":"Je choisis mes combats selon ce qui m'amuse.","speaker":"Hisoka Morow","recipient":"à ses adversaires","aliases":["Hisoka"]},{"text":"Le potentiel humain d'évolution est presque infini.","speaker":"Isaac Netero","recipient":"à Meruem","aliases":["Netero"]},{"text":"Je ne suis pas né pour devenir roi. Je veux savoir qui je suis.","speaker":"Meruem","recipient":"à Komugi","aliases":[]},{"text":"Si tu veux connaître quelqu'un, découvre ce qui le met en colère.","speaker":"Mito Freecss","recipient":"à Gon","aliases":["Mito"]},{"text":"Les amis n'ont pas besoin de remercier leurs amis.","speaker":"Leorio Paradinight","recipient":"à Kurapika","aliases":["Leorio"]},{"text":"Une famille d'assassins n'a pas besoin d'amour pour fonctionner.","speaker":"Silva Zoldyck","recipient":"à Killua","aliases":["Silva"]},{"text":"Je veux juste que Komugi se réveille.","speaker":"Neferpitou","recipient":"à Gon","aliases":["Pitou","Neferpitou"]},{"text":"Je deviendrai assez fort pour ne plus perdre ceux que j'aime.","speaker":"Gon Freecss","recipient":"à Killua","aliases":["Gon"]},{"text":"Je veux choisir ma vie moi-même, pas suivre les ordres de ma famille.","speaker":"Killua Zoldyck","recipient":"à Gon","aliases":["Killua"]},{"text":"La vengeance peut garder un homme en vie autant qu'elle peut le détruire.","speaker":"Kurapika","recipient":"à Leorio","aliases":[]},{"text":"Les monstres les plus intéressants sont ceux qui ne savent pas encore ce qu'ils sont.","speaker":"Hisoka Morow","recipient":"à Gon","aliases":["Hisoka"]},{"text":"Un Hunter doit savoir quand avancer et quand renoncer.","speaker":"Isaac Netero","recipient":"aux candidats Hunter","aliases":["Netero"]},{"text":"Je veux comprendre pourquoi cette fille me rend heureux.","speaker":"Meruem","recipient":"à Komugi","aliases":[]},{"text":"La famille ne devrait jamais être une cage.","speaker":"Alluka Zoldyck","recipient":"à Killua","aliases":["Alluka"]},{"text":"La meilleure médecine reste inutile si le patient refuse d'être sauvé.","speaker":"Leorio Paradinight","recipient":"à ses amis","aliases":["Leorio"]},{"text":"Une araignée peut perdre une patte sans perdre sa volonté.","speaker":"Chrollo Lucilfer","recipient":"à la Brigade Fantôme","aliases":["Chrollo","Kuroro"]},{"text":"Je veux savoir jusqu'où un humain peut aller quand il n'a plus rien à perdre.","speaker":"Neferpitou","recipient":"à Gon","aliases":["Pitou"]},{"text":"Un bon entraînement doit te faire sourire avant de te faire souffrir.","speaker":"Biscuit Krueger","recipient":"à Gon et Killua","aliases":["Biscuit","Bisky"]},{"text":"Un Hunter doit toujours laisser une trace pour ceux qui viennent après lui.","speaker":"Kite","recipient":"à Gon","aliases":["Kaito"]},{"text":"Le plus beau trésor d'un Hunter est souvent le voyage qu'il n'avait pas prévu.","speaker":"Ging Freecss","recipient":"à Gon","aliases":["Ging"]},{"text":"Un assassin expérimenté n'a pas besoin de gaspiller un mouvement.","speaker":"Zeno Zoldyck","recipient":"à ses adversaires","aliases":["Zeno"]},{"text":"La douleur devient intéressante quand elle peut être rendue à celui qui l'a causée.","speaker":"Feitan Portor","recipient":"à ses ennemis","aliases":["Feitan"]}]},"snk":{"name":"SNK / L'Attaque des Titans","quotes":[{"text":"Si nous ne nous battons pas, nous ne pouvons pas gagner.","speaker":"Eren Yeager","recipient":"à Mikasa","aliases":["Eren","Eren Jäger"]},{"text":"Ce monde est cruel, mais il est aussi magnifique.","speaker":"Mikasa Ackerman","recipient":"à elle-même","aliases":["Mikasa"]},{"text":"Abandonne tes rêves et meurs.","speaker":"Levi Ackerman","recipient":"à Erwin","aliases":["Levi"]},{"text":"Mes soldats avancent ! Mes soldats hurlent !","speaker":"Erwin Smith","recipient":"au Bataillon d'exploration","aliases":["Erwin"]},{"text":"Quelqu'un doit se salir les mains pour changer quelque chose.","speaker":"Armin Arlert","recipient":"à Jean","aliases":["Armin"]},{"text":"Je suis le Titan Cuirassé, et lui le Titan Colossal.","speaker":"Reiner Braun","recipient":"à Eren","aliases":["Reiner"]},{"text":"Je veux simplement rentrer chez moi.","speaker":"Annie Leonhart","recipient":"à elle-même","aliases":["Annie"]},{"text":"Tout ce que je veux, c'est que les gens vivent sans haine.","speaker":"Historia Reiss","recipient":"à son peuple","aliases":["Historia"]},{"text":"Nous sommes tous esclaves de quelque chose.","speaker":"Kenny Ackerman","recipient":"à Levi","aliases":["Kenny"]},{"text":"Je voulais seulement que mon frère ait une longue vie.","speaker":"Zeke Yeager","recipient":"à Eren","aliases":["Zeke","Zeke Jäger"]},{"text":"Je détruirai tous ceux qui veulent enlever notre liberté.","speaker":"Eren Yeager","recipient":"à ses ennemis","aliases":["Eren","Eren Jäger"]},{"text":"Même si le monde entier est contre toi, je resterai là.","speaker":"Mikasa Ackerman","recipient":"à Eren","aliases":["Mikasa"]},{"text":"Le meilleur choix est parfois celui qu'on regrettera toute sa vie.","speaker":"Levi Ackerman","recipient":"à ses soldats","aliases":["Levi"]},{"text":"Un commandant doit parfois sacrifier ce qu'il aime le plus.","speaker":"Erwin Smith","recipient":"au Bataillon","aliases":["Erwin"]},{"text":"Je veux voir l'océan de mes propres yeux.","speaker":"Armin Arlert","recipient":"à Eren","aliases":["Armin"]},{"text":"Nous étions des enfants envoyés pour détruire un monde inconnu.","speaker":"Reiner Braun","recipient":"à Eren","aliases":["Reiner"]},{"text":"Je ne veux pas être une bonne personne. Je veux seulement être libre.","speaker":"Annie Leonhart","recipient":"à Armin","aliases":["Annie"]},{"text":"Je veux vivre pour moi-même, pas pour un nom de famille.","speaker":"Historia Reiss","recipient":"à Ymir","aliases":["Historia"]},{"text":"Même un monstre a besoin de quelqu'un qui le comprenne.","speaker":"Ymir","recipient":"à Historia","aliases":[]},{"text":"Si nous voulons survivre, nous devons accepter ce que nous sommes devenus.","speaker":"Jean Kirstein","recipient":"à ses camarades","aliases":["Jean"]},{"text":"Même au milieu de l'enfer, je refuse de laisser la nourriture se perdre.","speaker":"Sasha Blouse","recipient":"à ses camarades","aliases":["Sasha"]},{"text":"Je n'ai rien d'un héros, mais je veux ramener mes amis chez eux.","speaker":"Connie Springer","recipient":"à ses camarades","aliases":["Connie"]},{"text":"Si une question existe, je veux l'étudier même si elle peut me tuer.","speaker":"Hange Zoe","recipient":"au Bataillon","aliases":["Hange","Hanji Zoe"]},{"text":"Je veux devenir quelqu'un dont ma famille pourra être fière.","speaker":"Gabi Braun","recipient":"aux Guerriers","aliases":["Gabi"]},{"text":"Je veux juste que Gabi et les autres aient la chance de vivre longtemps.","speaker":"Falco Grice","recipient":"à Reiner","aliases":["Falco"]}]},"sds":{"name":"Seven Deadly Sins","quotes":[{"text":"Peu importe tes péchés, je resterai à tes côtés.","speaker":"Meliodas","recipient":"à Elizabeth","aliases":[]},{"text":"Un vrai homme ne revient jamais sur sa parole.","speaker":"Ban","recipient":"à ses amis","aliases":[]},{"text":"Pourquoi haïrais-je quelqu'un de plus faible que moi ?","speaker":"Escanor","recipient":"à Estarossa","aliases":[]},{"text":"Je protégerai toujours la forêt et ceux que j'aime.","speaker":"King","recipient":"à Diane","aliases":["Harlequin"]},{"text":"Je veux être humaine pour comprendre ce que je ressens.","speaker":"Gowther","recipient":"aux Seven Deadly Sins","aliases":[]},{"text":"Je ne regrette pas d'avoir choisi mes amis.","speaker":"Diane","recipient":"à ses compagnons","aliases":[]},{"text":"Le savoir sans cœur peut devenir une malédiction.","speaker":"Merlin","recipient":"aux Seven Deadly Sins","aliases":[]},{"text":"Je n'ai besoin que de mon frère.","speaker":"Zeldris","recipient":"à Meliodas","aliases":[]},{"text":"Je veux sauver tout le monde, même ceux qui me détestent.","speaker":"Elizabeth Liones","recipient":"à Meliodas","aliases":["Elizabeth"]},{"text":"La lumière peut être plus cruelle que les ténèbres.","speaker":"Mael","recipient":"à ses adversaires","aliases":[]},{"text":"Je préfère porter mes péchés plutôt que fuir ceux que j'aime.","speaker":"Meliodas","recipient":"à Elizabeth","aliases":[]},{"text":"Je suis immortel, mais je ne supporte pas de perdre ceux qui comptent.","speaker":"Ban","recipient":"à Elaine","aliases":[]},{"text":"La fierté n'est pas l'arrogance quand on peut la soutenir par sa force.","speaker":"Escanor","recipient":"à ses ennemis","aliases":[]},{"text":"Je veux être digne de Diane, même si je dois devenir roi.","speaker":"King","recipient":"à Diane","aliases":["Harlequin"]},{"text":"Je veux comprendre les émotions, pas seulement les imiter.","speaker":"Gowther","recipient":"à ses compagnons","aliases":[]},{"text":"Je serai forte sans oublier que je suis moi.","speaker":"Diane","recipient":"à Elizabeth","aliases":[]},{"text":"Toute connaissance a un prix, surtout la connaissance interdite.","speaker":"Merlin","recipient":"à Arthur","aliases":[]},{"text":"Je n'ai pas besoin du trône. J'ai besoin de Gelda.","speaker":"Zeldris","recipient":"à Meliodas","aliases":[]},{"text":"Je continuerai de croire en Meliodas quoi qu'il arrive.","speaker":"Elizabeth Liones","recipient":"à ses amis","aliases":["Elizabeth"]},{"text":"Les dieux peuvent commettre des fautes aussi grandes que les démons.","speaker":"Mael","recipient":"à Elizabeth","aliases":[]},{"text":"Un roi doit créer un avenir où ses sujets n'auront plus peur.","speaker":"Arthur Pendragon","recipient":"à Merlin","aliases":["Arthur"]},{"text":"Je veux rester près de Ban, peu importe combien de temps il faudra attendre.","speaker":"Elaine","recipient":"à Ban","aliases":[]},{"text":"Je n'ai plus besoin de devenir quelqu'un d'autre pour savoir ce que je vaux.","speaker":"Jericho","recipient":"à Ban","aliases":[]},{"text":"Je veux être un chevalier digne de ceux qui croient en moi.","speaker":"Gilthunder","recipient":"à Margaret","aliases":[]},{"text":"La lumière des déesses n'est pas automatiquement synonyme de justice.","speaker":"Ludociel","recipient":"aux Archanges","aliases":[]}]},"deathnote":{"name":"Death Note","quotes":[{"text":"Je deviendrai le dieu de ce nouveau monde.","speaker":"Light Yagami","recipient":"à lui-même","aliases":["Light","Kira"]},{"text":"Je suis L.","speaker":"L Lawliet","recipient":"à Light","aliases":["L","Lawliet"]},{"text":"Si Kira est attrapé, alors il est le mal. S'il gagne, il devient la justice.","speaker":"Light Yagami","recipient":"à Ryuk","aliases":["Light","Kira"]},{"text":"Je préfère perdre seule plutôt que vivre dans un monde sans Light.","speaker":"Misa Amane","recipient":"à Rem","aliases":["Misa"]},{"text":"Les humains sont vraiment intéressants.","speaker":"Ryuk","recipient":"à Light","aliases":[]},{"text":"Personne ne peut surpasser L seul, mais ensemble nous le pouvons.","speaker":"Near","recipient":"à Mello","aliases":["Nate River"]},{"text":"Je serai le premier, pas le second.","speaker":"Mello","recipient":"à Near","aliases":["Mihael Keehl"]},{"text":"Je ferai tout pour protéger Misa.","speaker":"Rem","recipient":"à Light","aliases":[]},{"text":"Kira est dieu. Je suis sa main.","speaker":"Teru Mikami","recipient":"à lui-même","aliases":["Mikami"]},{"text":"Un père doit croire en son fils jusqu'au bout.","speaker":"Soichiro Yagami","recipient":"à Light","aliases":["Soichiro"]},{"text":"Si je dois devenir un monstre pour créer un monde parfait, je le ferai.","speaker":"Light Yagami","recipient":"à lui-même","aliases":["Light","Kira"]},{"text":"Je n'accuse jamais quelqu'un sans accepter la possibilité d'avoir tort.","speaker":"L Lawliet","recipient":"à Light","aliases":["L","Lawliet"]},{"text":"Je veux seulement être aimée par Light.","speaker":"Misa Amane","recipient":"à Rem","aliases":["Misa"]},{"text":"Les humains aiment prétendre qu'ils contrôlent leur destin.","speaker":"Ryuk","recipient":"à Light","aliases":[]},{"text":"Je ne veux pas remplacer L. Je veux terminer ce qu'il a commencé.","speaker":"Near","recipient":"à son équipe","aliases":["Nate River"]},{"text":"Je ne laisserai jamais Near me regarder d'en haut.","speaker":"Mello","recipient":"à ses alliés","aliases":["Mihael Keehl"]},{"text":"Même les dieux de la mort peuvent aimer quelqu'un.","speaker":"Rem","recipient":"à Misa","aliases":[]},{"text":"Je suivrai Kira jusqu'à la fin, même si je dois mourir.","speaker":"Teru Mikami","recipient":"à lui-même","aliases":["Mikami"]},{"text":"Un policier doit chercher la vérité même quand elle fait peur.","speaker":"Soichiro Yagami","recipient":"à son équipe","aliases":["Soichiro"]},{"text":"Je n'ai jamais regretté d'avoir aidé L.","speaker":"Watari","recipient":"à L","aliases":[]},{"text":"Une enquête correcte commence par douter même de ce qui semble évident.","speaker":"Naomi Misora","recipient":"à Light","aliases":["Naomi"]},{"text":"Je fais mon travail parce que chaque suspect mérite une enquête sérieuse.","speaker":"Raye Penber","recipient":"à Naomi","aliases":["Raye"]},{"text":"Je refuse de laisser la peur de Kira décider de ce qui est juste.","speaker":"Shuichi Aizawa","recipient":"à l'équipe d'enquête","aliases":["Aizawa"]},{"text":"Je parle peu, mais je n'abandonne jamais une mission commencée.","speaker":"Kanzo Mogi","recipient":"à l'équipe d'enquête","aliases":["Mogi"]},{"text":"La voix de Kira peut transformer une simple journaliste en symbole.","speaker":"Kiyomi Takada","recipient":"à Light","aliases":["Takada"]}]},"cote":{"name":"Classroom of the Elite","quotes":[{"text":"Les gens ne sont que des outils. L'important est de gagner à la fin.","speaker":"Kiyotaka Ayanokoji","recipient":"à lui-même","aliases":["Ayanokoji","Ayanokōji"]},{"text":"Je monterai en classe A par mes propres moyens.","speaker":"Suzune Horikita","recipient":"à Ayanokoji","aliases":["Horikita","Suzune"]},{"text":"Tout le monde a une face qu'il cache aux autres.","speaker":"Kikyo Kushida","recipient":"à Horikita","aliases":["Kushida"]},{"text":"Je ne veux plus être utilisée par les autres.","speaker":"Kei Karuizawa","recipient":"à Ayanokoji","aliases":["Kei","Karuizawa"]},{"text":"La peur est parfois le moyen le plus rapide d'obtenir l'obéissance.","speaker":"Kakeru Ryuen","recipient":"à sa classe","aliases":["Ryuen","Ryūen"]},{"text":"Je veux enfin jouer contre toi à armes égales.","speaker":"Arisu Sakayanagi","recipient":"à Ayanokoji","aliases":["Arisu","Sakayanagi"]},{"text":"Je veux que notre classe avance sans sacrifier personne.","speaker":"Honami Ichinose","recipient":"à sa classe","aliases":["Ichinose"]},{"text":"Je n'ai aucun intérêt pour une compétition dont je connais déjà le résultat.","speaker":"Rokusuke Koenji","recipient":"à ses camarades","aliases":["Koenji","Kōenji"]},{"text":"La force n'a de valeur que si elle est maîtrisée.","speaker":"Manabu Horikita","recipient":"à Suzune","aliases":["Manabu"]},{"text":"Le pouvoir appartient à celui qui sait utiliser les règles.","speaker":"Miyabi Nagumo","recipient":"au conseil étudiant","aliases":["Nagumo"]},{"text":"Je n'ai pas besoin d'être aimé, seulement de comprendre comment gagner.","speaker":"Kiyotaka Ayanokoji","recipient":"à lui-même","aliases":["Ayanokoji","Ayanokōji"]},{"text":"Je veux prouver que la classe A n'est pas inaccessible.","speaker":"Suzune Horikita","recipient":"à sa classe","aliases":["Horikita","Suzune"]},{"text":"Un sourire peut être plus utile qu'une menace.","speaker":"Kikyo Kushida","recipient":"à ses camarades","aliases":["Kushida"]},{"text":"Je veux enfin vivre sans craindre que mon passé soit révélé.","speaker":"Kei Karuizawa","recipient":"à Ayanokoji","aliases":["Kei","Karuizawa"]},{"text":"La classe C obéit parce que je sais exactement jusqu'où aller.","speaker":"Kakeru Ryuen","recipient":"à ses hommes","aliases":["Ryuen","Ryūen"]},{"text":"Je n'ai pas besoin d'être populaire si je peux rester invisible et garder l'avantage.","speaker":"Kiyotaka Ayanokoji","recipient":"à lui-même","aliases":["Ayanokoji","Ayanokōji"]},{"text":"La classe A n'est pas un rêve, c'est un objectif qu'on peut atteindre par le travail.","speaker":"Suzune Horikita","recipient":"à sa classe","aliases":["Horikita","Suzune"]},{"text":"Un sourire bien placé peut cacher beaucoup plus qu'un mensonge.","speaker":"Kikyo Kushida","recipient":"à ses camarades","aliases":["Kushida"]},{"text":"Je veux enfin vivre sans avoir peur que les autres découvrent mon passé.","speaker":"Kei Karuizawa","recipient":"à Ayanokoji","aliases":["Kei","Karuizawa"]},{"text":"Une classe n'obéit pas à celui qui parle le plus fort, mais à celui qui sait imposer ses règles.","speaker":"Kakeru Ryuen","recipient":"à sa classe","aliases":["Ryuen","Ryūen"]},{"text":"Une classe avance mieux quand quelqu'un sait calmer les conflits avant qu'ils explosent.","speaker":"Yosuke Hirata","recipient":"à sa classe","aliases":["Hirata"]},{"text":"Je peux être mauvais en cours et quand même devenir indispensable sur le terrain.","speaker":"Ken Sudo","recipient":"à Horikita","aliases":["Sudo","Sudō"]},{"text":"Je veux être regardée comme moi-même, pas comme l'image que je montre aux autres.","speaker":"Airi Sakura","recipient":"à Ayanokoji","aliases":["Airi","Sakura"]},{"text":"Les livres sont parfois plus faciles à comprendre que les gens.","speaker":"Hiyori Shiina","recipient":"à Ayanokoji","aliases":["Hiyori"]},{"text":"Je préfère une défaite honnête à une victoire offerte par quelqu'un d'autre.","speaker":"Mio Ibuki","recipient":"à Horikita","aliases":["Ibuki"]}]},"solo":{"name":"Solo Leveling","quotes":[{"text":"Si je dois devenir plus fort pour survivre, alors je monterai de niveau.","speaker":"Sung Jinwoo","recipient":"à lui-même","aliases":["Jinwoo","Sung Jin-Woo"]},{"text":"Je veux combattre à tes côtés, pas derrière toi.","speaker":"Cha Hae-In","recipient":"à Jinwoo","aliases":["Cha Hae In","Hae-In"]},{"text":"Je suis peut-être faible, mais je ne t'abandonnerai pas.","speaker":"Yoo Jinho","recipient":"à Jinwoo","aliases":["Jinho"]},{"text":"Un vrai Hunter protège les faibles avant de penser à la gloire.","speaker":"Go Gunhee","recipient":"aux Hunters","aliases":["Go Gun-Hee","Gunhee"]},{"text":"La puissance d'un rang S se reconnaît avant même qu'il attaque.","speaker":"Baek Yoonho","recipient":"aux Hunters","aliases":["Baek"]},{"text":"Tu es le seul adversaire qui mérite que je me batte sérieusement.","speaker":"Thomas Andre","recipient":"à Jinwoo","aliases":["Thomas"]},{"text":"Mon roi, donnez-moi un ordre.","speaker":"Igris","recipient":"à Jinwoo","aliases":[]},{"text":"Mon roi ! Regardez comme je suis utile !","speaker":"Beru","recipient":"à Jinwoo","aliases":[]},{"text":"Le Monarque des Ombres n'est pas un simple humain.","speaker":"Ashborn","recipient":"à Jinwoo","aliases":[]},{"text":"La destruction est la seule fin qui convienne à ce monde.","speaker":"Antares","recipient":"à Jinwoo","aliases":[]},{"text":"Chaque niveau gagné me rapproche du jour où je n'aurai plus peur.","speaker":"Sung Jinwoo","recipient":"à lui-même","aliases":["Jinwoo","Sung Jin-Woo"]},{"text":"Je n'ai jamais rencontré quelqu'un dont la présence m'effraie autant.","speaker":"Cha Hae-In","recipient":"à Jinwoo","aliases":["Cha Hae In","Hae-In"]},{"text":"Hyung, je sais que je suis faible, mais je peux quand même aider.","speaker":"Yoo Jinho","recipient":"à Jinwoo","aliases":["Jinho"]},{"text":"Une association existe d'abord pour éviter que la puissance ne devienne anarchie.","speaker":"Go Gunhee","recipient":"aux Hunters","aliases":["Go Gun-Hee","Gunhee"]},{"text":"Mon roi n'a pas besoin de parler pour que nous sachions quoi faire.","speaker":"Igris","recipient":"aux Ombres","aliases":[]},{"text":"Je ne veux plus jamais être le Hunter que tout le monde doit protéger.","speaker":"Sung Jinwoo","recipient":"à lui-même","aliases":["Jinwoo","Sung Jin-Woo"]},{"text":"Je peux sentir les monstres, mais ta présence est encore plus étrange.","speaker":"Cha Hae-In","recipient":"à Jinwoo","aliases":["Cha Hae In","Hae-In"]},{"text":"Même si je ne suis pas le plus fort, je veux être quelqu'un sur qui Hyung peut compter.","speaker":"Yoo Jinho","recipient":"à Jinwoo","aliases":["Jinho"]},{"text":"Le devoir d'un Hunter puissant est d'empêcher que sa force mette les autres en danger.","speaker":"Go Gunhee","recipient":"aux Hunters","aliases":["Go Gun-Hee","Gunhee"]},{"text":"Mon roi n'a pas besoin de répéter un ordre pour que son armée le comprenne.","speaker":"Igris","recipient":"aux Ombres","aliases":[]},{"text":"Je dois comprendre ce qu'est devenu Jinwoo avant que le monde ne le découvre trop tard.","speaker":"Woo Jinchul","recipient":"à Go Gunhee","aliases":["Woo Jin-Chul","Jinchul"]},{"text":"Un soigneur doit rester debout aussi longtemps que ceux qu'il veut sauver.","speaker":"Min Byung-Gyu","recipient":"à ses camarades","aliases":["Byung-Gyu"]},{"text":"Un bon archer gagne le combat avant que l'ennemi n'arrive à portée.","speaker":"Lim Tae-Gyu","recipient":"aux Hunters","aliases":["Tae-Gyu"]},{"text":"Je suis l'épée qui ouvre le chemin devant le Monarque des Ombres.","speaker":"Bellion","recipient":"à Jinwoo","aliases":[]},{"text":"La magie devient plus terrifiante quand celui qui la lance n'a plus peur de mourir.","speaker":"Tusk","recipient":"aux Ombres","aliases":["Kargalgan"]}]},"clover":{"name":"Black Clover","quotes":[{"text":"Je n'abandonnerai jamais. C'est ça, ma magie !","speaker":"Asta","recipient":"à ses adversaires","aliases":[]},{"text":"Je deviendrai Empereur-Mage.","speaker":"Yuno","recipient":"à Asta","aliases":[]},{"text":"Je suis royale, mais je veux devenir forte par moi-même.","speaker":"Noelle Silva","recipient":"à ses amis","aliases":["Noelle"]},{"text":"Dépasse tes limites, ici et maintenant !","speaker":"Yami Sukehiro","recipient":"au Taureau Noir","aliases":["Yami"]},{"text":"La magie est faite pour protéger les gens, pas pour les dominer.","speaker":"Julius Novachrono","recipient":"aux chevaliers-mages","aliases":["Julius"]},{"text":"Plus mon adversaire est fort, plus j'ai envie de me battre.","speaker":"Luck Voltia","recipient":"à ses adversaires","aliases":["Luck"]},{"text":"Je ne laisserai personne insulter mes camarades.","speaker":"Magna Swing","recipient":"à ses adversaires","aliases":["Magna"]},{"text":"La force ne vient pas du sang royal, mais de ce qu'on choisit de faire.","speaker":"Mereoleona Vermillion","recipient":"aux chevaliers-mages","aliases":["Mereoleona"]},{"text":"Un capitaine doit faire confiance à ses hommes.","speaker":"Fuegoleon Vermillion","recipient":"au Lion Pourpre","aliases":["Fuegoleon"]},{"text":"Je ne laisserai plus mon passé décider de mon avenir.","speaker":"Nacht Faust","recipient":"à Asta","aliases":["Nacht"]},{"text":"Je suis peut-être sans magie, mais je ne suis pas sans avenir.","speaker":"Asta","recipient":"à ses ennemis","aliases":[]},{"text":"Je n'ai pas besoin de parler beaucoup pour prouver que je serai Empereur-Mage.","speaker":"Yuno","recipient":"à Asta","aliases":[]},{"text":"Je refuse d'être définie par les erreurs de ma famille.","speaker":"Noelle Silva","recipient":"à ses frères et sœur","aliases":["Noelle"]},{"text":"Quand tu atteins ta limite, dépasse-la encore.","speaker":"Yami Sukehiro","recipient":"au Taureau Noir","aliases":["Yami"]},{"text":"Je veux un royaume où la naissance ne décide pas de la valeur d'une personne.","speaker":"Julius Novachrono","recipient":"aux chevaliers-mages","aliases":["Julius"]},{"text":"Le combat est bien plus amusant quand on ne connaît pas le résultat.","speaker":"Luck Voltia","recipient":"à Magna","aliases":["Luck"]},{"text":"Je ne suis pas né noble, mais je peux devenir un grand chevalier.","speaker":"Magna Swing","recipient":"à ses camarades","aliases":["Magna"]},{"text":"Un vrai lion ne demande pas la permission de rugir.","speaker":"Mereoleona Vermillion","recipient":"à ses élèves","aliases":["Mereoleona"]},{"text":"Le devoir d'un capitaine est de montrer la voie, pas de tout faire seul.","speaker":"Fuegoleon Vermillion","recipient":"au Lion Pourpre","aliases":["Fuegoleon"]},{"text":"Je déteste les gens qui prétendent être bons sans agir.","speaker":"Nacht Faust","recipient":"à Asta","aliases":["Nacht"]},{"text":"Je ne laisserai plus ma malédiction m'empêcher de diriger mes chevaliers.","speaker":"Charlotte Roselei","recipient":"à Yami","aliases":["Charlotte"]},{"text":"Manger ensemble rend une équipe plus forte, surtout si c'est moi qui cuisine.","speaker":"Charmy Pappitson","recipient":"au Taureau Noir","aliases":["Charmy"]},{"text":"Je peux trancher tout ce qui se trouve devant moi, même une magie inconnue.","speaker":"Jack the Ripper","recipient":"à ses rivaux","aliases":["Jack"]},{"text":"Un Silva doit montrer l'exemple au lieu d'utiliser son nom comme excuse.","speaker":"Nozel Silva","recipient":"à Noelle","aliases":["Nozel"]},{"text":"Je veux utiliser ma magie pour aider ceux qui ne peuvent pas se défendre seuls.","speaker":"Mimosa Vermillion","recipient":"à Asta","aliases":["Mimosa"]}]},"fireforce":{"name":"Fire Force","quotes":[{"text":"Je deviendrai un héros, pas un démon.","speaker":"Shinra Kusakabe","recipient":"à ses camarades","aliases":["Shinra"]},{"text":"Un chevalier ne recule jamais devant le mal.","speaker":"Arthur Boyle","recipient":"à Shinra","aliases":["Arthur"]},{"text":"La force sans contrôle ne sert à rien.","speaker":"Maki Oze","recipient":"à Shinra et Arthur","aliases":["Maki"]},{"text":"La 8e existe pour découvrir la vérité sur les incendies.","speaker":"Akitaru Obi","recipient":"à la 8e brigade","aliases":["Obi"]},{"text":"Le feu est une arme, mais aussi quelque chose qu'on doit comprendre.","speaker":"Takehisa Hinawa","recipient":"à la 8e brigade","aliases":["Hinawa"]},{"text":"Asakusa protège les siens à sa manière.","speaker":"Benimaru Shinmon","recipient":"à Shinra","aliases":["Benimaru"]},{"text":"Je veux savoir pourquoi l'Adolla nous a choisis.","speaker":"Sho Kusakabe","recipient":"à Shinra","aliases":["Sho","Shō"]},{"text":"La foi peut brûler plus fort que n'importe quelle flamme.","speaker":"Haumea","recipient":"aux White-Clad","aliases":[]},{"text":"Je ne suis pas une demoiselle en détresse !","speaker":"Tamaki Kotatsu","recipient":"à ses camarades","aliases":["Tamaki"]},{"text":"Les faits sont plus intéressants que les croyances.","speaker":"Viktor Licht","recipient":"à la 8e brigade","aliases":["Licht"]},{"text":"Je veux un sourire qui ressemble à celui d'un héros, pas à celui d'un démon.","speaker":"Shinra Kusakabe","recipient":"à Iris","aliases":["Shinra"]},{"text":"Un vrai chevalier trouve toujours une façon élégante de gagner.","speaker":"Arthur Boyle","recipient":"à Shinra","aliases":["Arthur"]},{"text":"La force la plus impressionnante est celle qu'on contrôle parfaitement.","speaker":"Maki Oze","recipient":"à Arthur","aliases":["Maki"]},{"text":"Notre compagnie existe pour sauver les gens avant de chercher des réponses.","speaker":"Akitaru Obi","recipient":"à la 8e brigade","aliases":["Obi"]},{"text":"Le feu révèle les erreurs de ceux qui ne le respectent pas.","speaker":"Benimaru Shinmon","recipient":"à Shinra","aliases":["Benimaru"]},{"text":"Je veux que mon sourire fasse penser à un héros, pas à un démon.","speaker":"Shinra Kusakabe","recipient":"à Iris","aliases":["Shinra"]},{"text":"Un chevalier digne de ce nom ne recule pas devant un dragon.","speaker":"Arthur Boyle","recipient":"à Shinra","aliases":["Arthur"]},{"text":"La vraie puissance, c'est de pouvoir s'arrêter avant de blesser quelqu'un.","speaker":"Maki Oze","recipient":"à Shinra et Arthur","aliases":["Maki"]},{"text":"La 8e doit sauver des vies avant même de chercher qui a raison.","speaker":"Akitaru Obi","recipient":"à sa brigade","aliases":["Obi"]},{"text":"Asakusa n'a pas besoin d'un héros extérieur pour savoir se défendre.","speaker":"Benimaru Shinmon","recipient":"à Shinra","aliases":["Benimaru"]},{"text":"Je prie pour les Infernaux parce qu'ils étaient des humains avant tout.","speaker":"Iris","recipient":"à Shinra","aliases":["Sister Iris"]},{"text":"Une machine bien conçue peut sauver autant de vies qu'un soldat.","speaker":"Vulcan Joseph","recipient":"à la 8e brigade","aliases":["Vulcan"]},{"text":"Je veux construire quelque chose au lieu de simplement brûler ce qui m'entoure.","speaker":"Lisa Isaribe","recipient":"à Vulcan","aliases":["Lisa"]},{"text":"Asakusa n'a pas besoin de beaucoup de mots quand nos sabres parlent à notre place.","speaker":"Konro Sagamiya","recipient":"à Benimaru","aliases":["Konro"]},{"text":"Je suis devenue capitaine parce que personne ne me donnera plus jamais d'ordre en me regardant de haut.","speaker":"Hibana","recipient":"à ses subordonnés","aliases":["Princess Hibana"]}]},"mushoku":{"name":"Mushoku Tensei","quotes":[{"text":"Cette fois, je veux vivre sans regrets.","speaker":"Rudeus Greyrat","recipient":"à lui-même","aliases":["Rudeus"]},{"text":"La magie devient simple quand on comprend ce qu'on imagine.","speaker":"Roxy Migurdia","recipient":"à Rudeus","aliases":["Roxy"]},{"text":"Je veux rester à tes côtés, même si je change.","speaker":"Sylphiette","recipient":"à Rudeus","aliases":["Sylphy","Fitz"]},{"text":"Je serai assez forte pour ne plus dépendre de personne.","speaker":"Eris Boreas Greyrat","recipient":"à Rudeus","aliases":["Eris"]},{"text":"Un guerrier doit protéger les enfants avant son honneur.","speaker":"Ruijerd Superdia","recipient":"à Rudeus","aliases":["Ruijerd"]},{"text":"Ne te fie jamais à l'Homme-Dieu.","speaker":"Orsted","recipient":"à Rudeus","aliases":[]},{"text":"Être père ne veut pas dire savoir toujours quoi faire.","speaker":"Paul Greyrat","recipient":"à Rudeus","aliases":["Paul"]},{"text":"L'épée répond à celui qui n'hésite pas.","speaker":"Ghislaine Dedoldia","recipient":"à Eris","aliases":["Ghislaine"]},{"text":"Je veux rentrer dans mon monde, même si personne ne me comprend.","speaker":"Nanahoshi Shizuka","recipient":"à Rudeus","aliases":["Nanahoshi"]},{"text":"La connaissance magique mérite qu'on lui consacre sa vie.","speaker":"Cliff Grimoire","recipient":"à ses camarades","aliases":["Cliff"]},{"text":"Je ne peux pas changer mon ancienne vie, mais je peux changer celle-ci.","speaker":"Rudeus Greyrat","recipient":"à lui-même","aliases":["Rudeus"]},{"text":"La magie devient magnifique quand l'élève cesse d'avoir peur d'échouer.","speaker":"Roxy Migurdia","recipient":"à Rudeus","aliases":["Roxy"]},{"text":"Je veux que Rudeus me voie comme moi, pas comme Fitz.","speaker":"Sylphiette","recipient":"à elle-même","aliases":["Sylphy","Fitz"]},{"text":"Je reviendrai seulement quand je serai assez forte pour marcher à ses côtés.","speaker":"Eris Boreas Greyrat","recipient":"à elle-même","aliases":["Eris"]},{"text":"Un Superd doit être jugé par ce qu'il fait aujourd'hui, pas par une vieille légende.","speaker":"Ruijerd Superdia","recipient":"à Rudeus","aliases":["Ruijerd"]},{"text":"Je ne peux pas réparer mon ancienne vie, alors je veux au moins réussir celle-ci.","speaker":"Rudeus Greyrat","recipient":"à lui-même","aliases":["Rudeus"]},{"text":"Un bon mage commence par imaginer clairement ce qu'il veut créer.","speaker":"Roxy Migurdia","recipient":"à Rudeus","aliases":["Roxy"]},{"text":"Je veux qu'il reconnaisse Sylphiette, pas seulement Fitz.","speaker":"Sylphiette","recipient":"à elle-même","aliases":["Sylphy","Fitz"]},{"text":"Je reviendrai quand je serai assez forte pour ne plus rester derrière lui.","speaker":"Eris Boreas Greyrat","recipient":"à elle-même","aliases":["Eris"]},{"text":"Les Superds ne devraient pas être condamnés pour une histoire que les enfants n'ont jamais vécue.","speaker":"Ruijerd Superdia","recipient":"à Rudeus","aliases":["Ruijerd"]},{"text":"Je veux que mes enfants puissent vivre mieux que moi, même si je fais des erreurs en chemin.","speaker":"Zenith Greyrat","recipient":"à sa famille","aliases":["Zenith"]},{"text":"Servir cette famille est devenu un choix, pas seulement un devoir.","speaker":"Lilia Greyrat","recipient":"à Rudeus","aliases":["Lilia"]},{"text":"Je veux trouver ma propre valeur sans être seulement la petite sœur de Rudeus.","speaker":"Norn Greyrat","recipient":"à elle-même","aliases":["Norn"]},{"text":"Je n'ai pas besoin de magie exceptionnelle pour rendre cette famille plus forte.","speaker":"Aisha Greyrat","recipient":"à Rudeus","aliases":["Aisha"]},{"text":"Je n'offre jamais un conseil sans raison, même si la raison n'est pas celle que tu imagines.","speaker":"Hitogami","recipient":"à Rudeus","aliases":["Homme-Dieu","Man-God"]}]},"rezero":{"name":"Re:Zero","quotes":[{"text":"Je recommencerai autant de fois qu'il le faudra pour vous sauver.","speaker":"Subaru Natsuki","recipient":"à Emilia","aliases":["Subaru"]},{"text":"Je suis Emilia. Juste Emilia.","speaker":"Emilia","recipient":"à Subaru","aliases":[]},{"text":"Subaru est le héros de Rem.","speaker":"Rem","recipient":"à Subaru","aliases":[]},{"text":"Ram n'attend pas grand-chose de Barusu.","speaker":"Ram","recipient":"à Subaru","aliases":[]},{"text":"Je suppose que je vais t'aider, je suppose.","speaker":"Beatrice","recipient":"à Subaru","aliases":["Betty"]},{"text":"Tout est pour atteindre mon objectif, même cette douleur.","speaker":"Roswaal L. Mathers","recipient":"à Subaru","aliases":["Roswaal"]},{"text":"Si tu me demandes de te sauver, je le ferai.","speaker":"Reinhard van Astrea","recipient":"à Felt","aliases":["Reinhard"]},{"text":"Un chef doit porter les conséquences de ses choix.","speaker":"Crusch Karsten","recipient":"à Subaru","aliases":["Crusch"]},{"text":"Le monde devrait être reconnaissant de pouvoir m'admirer.","speaker":"Priscilla Barielle","recipient":"à son entourage","aliases":["Priscilla"]},{"text":"Pourquoi devrais-je souffrir pour le bonheur de quelqu'un d'autre ?","speaker":"Regulus Corneas","recipient":"à ses victimes","aliases":["Regulus"]},{"text":"Je ne peux pas expliquer ma douleur, alors je dois simplement continuer.","speaker":"Subaru Natsuki","recipient":"à lui-même","aliases":["Subaru"]},{"text":"Je veux être choisie pour ce que je suis, pas pour mon apparence.","speaker":"Emilia","recipient":"à Subaru","aliases":[]},{"text":"Même si Subaru ne croit plus en lui, Rem continuera d'y croire.","speaker":"Rem","recipient":"à Subaru","aliases":[]},{"text":"Barusu reste bruyant, inutile et parfois étonnamment fiable.","speaker":"Ram","recipient":"à Subaru","aliases":[]},{"text":"Je suppose que tu peux compter sur Betty, je suppose.","speaker":"Beatrice","recipient":"à Subaru","aliases":["Betty"]},{"text":"Je ne peux pas expliquer ce que j'ai vécu, mais je peux encore choisir d'avancer.","speaker":"Subaru Natsuki","recipient":"à lui-même","aliases":["Subaru"]},{"text":"Je veux être jugée comme Emilia, pas comme quelqu'un qui lui ressemble.","speaker":"Emilia","recipient":"à Subaru","aliases":[]},{"text":"Même si Subaru oublie sa propre valeur, Rem ne l'oubliera pas.","speaker":"Rem","recipient":"à Subaru","aliases":[]},{"text":"Barusu est pénible, mais il sait parfois accomplir l'impossible.","speaker":"Ram","recipient":"à Subaru","aliases":[]},{"text":"Betty restera avec toi tant que tu ne l'abandonnes pas, je suppose.","speaker":"Beatrice","recipient":"à Subaru","aliases":["Betty"]},{"text":"Je resterai près d'Emilia tant qu'elle aura besoin de moi.","speaker":"Puck","recipient":"à Emilia","aliases":[]},{"text":"Un marchand survit parce qu'il sait transformer les problèmes en opportunités.","speaker":"Otto Suwen","recipient":"à Subaru","aliases":["Otto"]},{"text":"Je vais protéger cet endroit avec mes crocs, peu importe qui arrive.","speaker":"Garfiel Tinsel","recipient":"à Subaru","aliases":["Garfiel"]},{"text":"Je n'ai peut-être rien, mais je veux décider moi-même de ce que je deviendrai.","speaker":"Felt","recipient":"à Reinhard","aliases":[]},{"text":"Une épée portée pour quelqu'un qu'on aime pèse moins lourd que le regret.","speaker":"Wilhelm van Astrea","recipient":"à Subaru","aliases":["Wilhelm"]}]},"fairy":{"name":"Fairy Tail","quotes":[{"text":"Je n'abandonnerai jamais un membre de Fairy Tail.","speaker":"Natsu Dragneel","recipient":"à ses ennemis","aliases":["Natsu"]},{"text":"Les souvenirs de mes amis me donnent la force d'avancer.","speaker":"Lucy Heartfilia","recipient":"à ses amis","aliases":["Lucy"]},{"text":"Je ne veux plus perdre quelqu'un qui compte pour moi.","speaker":"Gray Fullbuster","recipient":"à Natsu","aliases":["Gray"]},{"text":"Quand mes amis pleurent, je deviens plus forte.","speaker":"Erza Scarlet","recipient":"à ses ennemis","aliases":["Erza"]},{"text":"Même petite, je peux protéger ma guilde.","speaker":"Wendy Marvell","recipient":"à Fairy Tail","aliases":["Wendy"]},{"text":"Je ne suis plus ton ennemi. Fairy Tail est ma famille.","speaker":"Gajeel Redfox","recipient":"à ses camarades","aliases":["Gajeel"]},{"text":"La vraie force ne vient pas de la peur qu'on inspire.","speaker":"Laxus Dreyar","recipient":"à Fairy Tail","aliases":["Laxus"]},{"text":"Juvia vit pour protéger ceux qu'elle aime.","speaker":"Juvia Lockser","recipient":"à Gray","aliases":["Juvia"]},{"text":"Il n'existe pas de magie plus forte que celle des liens.","speaker":"Makarov Dreyar","recipient":"à Fairy Tail","aliases":["Makarov"]},{"text":"La mort n'est pas une punition suffisante pour mon immortalité.","speaker":"Zeref Dragneel","recipient":"à Natsu","aliases":["Zeref"]},{"text":"Je trouverai toujours le chemin qui ramène mes amis à la maison.","speaker":"Natsu Dragneel","recipient":"à Fairy Tail","aliases":["Natsu"]},{"text":"Je ne suis pas faible parce que j'ai peur de perdre mes amis.","speaker":"Lucy Heartfilia","recipient":"à Natsu","aliases":["Lucy"]},{"text":"Je veux devenir plus fort sans perdre l'homme que je suis.","speaker":"Gray Fullbuster","recipient":"à ses amis","aliases":["Gray"]},{"text":"Une armure ne sert à rien si le cœur à l'intérieur est brisé.","speaker":"Erza Scarlet","recipient":"à ses camarades","aliases":["Erza"]},{"text":"Je veux devenir une Dragon Slayer dont les autres seront fiers.","speaker":"Wendy Marvell","recipient":"à Carla","aliases":["Wendy"]},{"text":"Une guilde, c'est quand quelqu'un t'attend même après tes erreurs.","speaker":"Gajeel Redfox","recipient":"à Levy","aliases":["Gajeel"]},{"text":"Je n'ai pas besoin d'être le plus fort pour protéger Fairy Tail.","speaker":"Laxus Dreyar","recipient":"à la guilde","aliases":["Laxus"]},{"text":"Juvia n'a plus peur de la pluie depuis qu'elle a trouvé Fairy Tail.","speaker":"Juvia Lockser","recipient":"à Gray","aliases":["Juvia"]},{"text":"Un maître de guilde doit parfois croire en ses enfants plus qu'en lui-même.","speaker":"Makarov Dreyar","recipient":"à Fairy Tail","aliases":["Makarov"]},{"text":"Je veux mourir, mais seulement après avoir réparé ce que j'ai détruit.","speaker":"Zeref Dragneel","recipient":"à Mavis","aliases":["Zeref"]},{"text":"Si un dragon veut détruire ce monde, alors je deviendrai l'homme capable de l'affronter.","speaker":"Acnologia","recipient":"à ses ennemis","aliases":[]},{"text":"Je reviens toujours à Fairy Tail, même quand je passe mon temps sur les routes.","speaker":"Gildarts Clive","recipient":"à Natsu","aliases":["Gildarts"]},{"text":"Les cartes ne décident pas de mon avenir, elles m'aident seulement à choisir comment le jouer.","speaker":"Cana Alberona","recipient":"à ses amis","aliases":["Cana"]},{"text":"Un homme doit devenir assez fort pour protéger sa famille sans avoir honte de ses larmes.","speaker":"Elfman Strauss","recipient":"à ses sœurs","aliases":["Elfman"]},{"text":"Je veux réparer ce que j'ai détruit au lieu de continuer à courir loin de mon passé.","speaker":"Jellal Fernandes","recipient":"à Erza","aliases":["Jellal"]}]},"bluelock":{"name":"Blue Lock","quotes":[{"text":"Je vais dévorer tous les génies sur ce terrain.","speaker":"Yoichi Isagi","recipient":"à ses rivaux","aliases":["Isagi"]},{"text":"Le football est un jeu où celui qui marque le plus est le meilleur.","speaker":"Jinpachi Ego","recipient":"aux joueurs de Blue Lock","aliases":["Ego"]},{"text":"Je veux jouer au football avec mon monstre intérieur.","speaker":"Meguru Bachira","recipient":"à Isagi","aliases":["Bachira"]},{"text":"Je veux seulement battre mon frère.","speaker":"Rin Itoshi","recipient":"à Isagi","aliases":["Rin"]},{"text":"Tout est une corvée, sauf quand le football devient intéressant.","speaker":"Seishiro Nagi","recipient":"à Reo","aliases":["Nagi"]},{"text":"Je serai celui qui fait de Nagi le meilleur du monde.","speaker":"Reo Mikage","recipient":"à Nagi","aliases":["Reo"]},{"text":"Le roi ne s'agenouille devant personne.","speaker":"Shoei Barou","recipient":"à ses rivaux","aliases":["Barou"]},{"text":"Ma vitesse est l'arme que personne ne peut m'enlever.","speaker":"Hyoma Chigiri","recipient":"à ses rivaux","aliases":["Chigiri"]},{"text":"Je veux écraser tout ce qui est beau devant moi.","speaker":"Ryusei Shidou","recipient":"à ses adversaires","aliases":["Shidou","Shidō"]},{"text":"Tu n'es qu'un obstacle sur le chemin de mon but.","speaker":"Michael Kaiser","recipient":"à Isagi","aliases":["Kaiser"]},{"text":"Je transformerai chaque erreur en pièce de mon prochain but.","speaker":"Yoichi Isagi","recipient":"à lui-même","aliases":["Isagi"]},{"text":"Un attaquant qui pense d'abord aux autres ne sera jamais numéro un.","speaker":"Jinpachi Ego","recipient":"aux joueurs de Blue Lock","aliases":["Ego"]},{"text":"Je veux un partenaire qui entende le même monstre que moi.","speaker":"Meguru Bachira","recipient":"à Isagi","aliases":["Bachira"]},{"text":"Je détruirai tous ceux qui m'empêchent de dépasser Sae.","speaker":"Rin Itoshi","recipient":"à ses rivaux","aliases":["Rin"]},{"text":"Quand je trouve quelque chose d'intéressant, même l'effort devient amusant.","speaker":"Seishiro Nagi","recipient":"à Reo","aliases":["Nagi"]},{"text":"Je veux créer l'équipe dont nous rêvions, avec ou sans toi.","speaker":"Reo Mikage","recipient":"à Nagi","aliases":["Reo"]},{"text":"Je suis le roi. Vous n'êtes que des pions sur mon terrain.","speaker":"Shoei Barou","recipient":"à ses coéquipiers","aliases":["Barou"]},{"text":"Je cours parce que c'est la seule chose qui me fait me sentir libre.","speaker":"Hyoma Chigiri","recipient":"à Isagi","aliases":["Chigiri"]},{"text":"Je veux un football qui explose comme un feu d'artifice.","speaker":"Ryusei Shidou","recipient":"à ses rivaux","aliases":["Shidou","Shidō"]},{"text":"Tu ne deviendras jamais le héros de ce terrain tant que je serai là.","speaker":"Michael Kaiser","recipient":"à Isagi","aliases":["Kaiser"]},{"text":"Mon tir doit être assez puissant pour briser le match en une seule action.","speaker":"Rensuke Kunigami","recipient":"à ses rivaux","aliases":["Kunigami"]},{"text":"Mon corps me donne une portée que personne d'autre ne peut reproduire.","speaker":"Jyubei Aryu","recipient":"à ses rivaux","aliases":["Aryu"]},{"text":"Je vois les espaces avant que les autres comprennent qu'ils existent.","speaker":"Ikki Niko","recipient":"à Isagi","aliases":["Niko"]},{"text":"Je préfère contrôler le point faible de l'adversaire plutôt que courir après le ballon.","speaker":"Tabito Karasu","recipient":"à ses rivaux","aliases":["Karasu"]},{"text":"Un duel en un contre un est l'endroit où je peux montrer toute ma valeur.","speaker":"Kenyu Yukimiya","recipient":"à Isagi","aliases":["Yukimiya"]}]},"fma":{"name":"Fullmetal Alchemist","quotes":[{"text":"Un cœur fait d'acier peut encore ressentir la douleur.","speaker":"Edward Elric","recipient":"à ses proches","aliases":["Edward","Ed"]},{"text":"Je veux retrouver nos corps, pas obtenir une victoire facile.","speaker":"Alphonse Elric","recipient":"à Edward","aliases":["Alphonse","Al"]},{"text":"Il pleut aujourd'hui.","speaker":"Roy Mustang","recipient":"à Hawkeye","aliases":["Mustang","Roy"]},{"text":"La guerre ne laisse personne propre.","speaker":"Riza Hawkeye","recipient":"à Roy Mustang","aliases":["Hawkeye","Riza"]},{"text":"Un homme qui a perdu sa voie peut encore choisir sa prochaine étape.","speaker":"Scar","recipient":"à lui-même","aliases":[]},{"text":"Je ne supporte pas de voir Ed abandonner.","speaker":"Winry Rockbell","recipient":"à Edward","aliases":["Winry"]},{"text":"Un roi existe pour son peuple, pas l'inverse.","speaker":"Ling Yao","recipient":"à Greed","aliases":["Ling"]},{"text":"Je veux tout : les femmes, l'argent, le pouvoir… et mes amis.","speaker":"Greed","recipient":"à ses compagnons","aliases":[]},{"text":"Les humains sont de petites créatures, mais leur volonté est immense.","speaker":"Van Hohenheim","recipient":"à Father","aliases":["Hohenheim"]},{"text":"Je suis ce que vous appelez Dieu, le Monde, l'Univers… et aussi toi.","speaker":"Truth","recipient":"aux alchimistes","aliases":["La Vérité","Vérité"]},{"text":"Je ne sacrifierai plus personne pour récupérer ce que j'ai perdu.","speaker":"Edward Elric","recipient":"à Alphonse","aliases":["Edward","Ed"]},{"text":"Un corps n'est pas ce qui fait de quelqu'un un être humain.","speaker":"Alphonse Elric","recipient":"à Edward","aliases":["Alphonse","Al"]},{"text":"Je veux devenir Führer pour changer ce pays de l'intérieur.","speaker":"Roy Mustang","recipient":"à Hawkeye","aliases":["Mustang","Roy"]},{"text":"Si le colonel avance, je couvrirai toujours ses arrières.","speaker":"Riza Hawkeye","recipient":"à Roy Mustang","aliases":["Hawkeye","Riza"]},{"text":"La vengeance m'a donné une direction, mais pas une paix.","speaker":"Scar","recipient":"à lui-même","aliases":[]},{"text":"Je ne sacrifierai plus personne pour récupérer ce que mon frère et moi avons perdu.","speaker":"Edward Elric","recipient":"à Alphonse","aliases":["Edward","Ed"]},{"text":"Un corps est important, mais ce sont nos choix qui font de nous des humains.","speaker":"Alphonse Elric","recipient":"à Edward","aliases":["Alphonse","Al"]},{"text":"Je veux atteindre le sommet pour que plus jamais un ordre injuste ne soit inévitable.","speaker":"Roy Mustang","recipient":"à Hawkeye","aliases":["Mustang","Roy"]},{"text":"Si le colonel avance vers son objectif, je resterai derrière lui pour couvrir ses erreurs.","speaker":"Riza Hawkeye","recipient":"à Roy Mustang","aliases":["Hawkeye","Riza"]},{"text":"La vengeance m'a montré où marcher, mais elle ne m'a jamais apporté la paix.","speaker":"Scar","recipient":"à lui-même","aliases":[]},{"text":"Je peux séduire, tromper et tuer sans jamais perdre mon calme.","speaker":"Lust","recipient":"à ses ennemis","aliases":[]},{"text":"J'ai toujours faim, peu importe combien je dévore.","speaker":"Gluttony","recipient":"à Lust","aliases":[]},{"text":"Un roi n'a pas besoin de demander la permission pour éliminer une menace.","speaker":"King Bradley","recipient":"à ses ennemis","aliases":["Wrath","Bradley"]},{"text":"Je déteste les humains parce qu'ils possèdent quelque chose que je ne comprends pas.","speaker":"Envy","recipient":"à Edward","aliases":[]},{"text":"Un maître n'apprend rien à un élève qui refuse d'abord de survivre seul.","speaker":"Izumi Curtis","recipient":"à Edward et Alphonse","aliases":["Izumi"]}]},"chainsaw":{"name":"Chainsaw Man","quotes":[{"text":"Je veux juste manger de bonnes choses et vivre une vie normale.","speaker":"Denji","recipient":"à lui-même","aliases":[]},{"text":"Les chats valent plus que les humains.","speaker":"Power","recipient":"à Denji","aliases":[]},{"text":"Je veux tuer le Démon-Flingue, quoi qu'il m'en coûte.","speaker":"Aki Hayakawa","recipient":"à ses collègues","aliases":["Aki"]},{"text":"Un chien obéissant mérite une récompense.","speaker":"Makima","recipient":"à Denji","aliases":[]},{"text":"Je ne veux pas mourir !","speaker":"Kobeni Higashiyama","recipient":"à ses collègues","aliases":["Kobeni"]},{"text":"On devient plus fort quand on a quelque chose à perdre.","speaker":"Himeno","recipient":"à Aki","aliases":[]},{"text":"Si tu venais avec moi, on pourrait tout oublier.","speaker":"Reze","recipient":"à Denji","aliases":[]},{"text":"Le futur est génial !","speaker":"Future Devil","recipient":"à Aki","aliases":["Démon du Futur","Future"]},{"text":"Même les chasseurs de démons ont peur de quelque chose.","speaker":"Kishibe","recipient":"à Denji et Power","aliases":[]},{"text":"Je veux transformer mes peurs en armes.","speaker":"Asa Mitaka","recipient":"à elle-même","aliases":["Asa"]},{"text":"Je préfère un rêve idiot à une vie vide.","speaker":"Denji","recipient":"à lui-même","aliases":[]},{"text":"Un humain qui nourrit bien Power mérite peut-être de vivre.","speaker":"Power","recipient":"à Denji","aliases":[]},{"text":"Je ne peux pas oublier ma famille, même si je continue d'avancer.","speaker":"Aki Hayakawa","recipient":"à Himeno","aliases":["Aki"]},{"text":"Les gens sont plus faciles à contrôler quand ils veulent être aimés.","speaker":"Makima","recipient":"à Denji","aliases":[]},{"text":"Je déteste ce travail, mais j'ai encore plus peur de mourir.","speaker":"Kobeni Higashiyama","recipient":"à ses collègues","aliases":["Kobeni"]},{"text":"Je veux qu'Aki vive assez longtemps pour regretter mes blagues.","speaker":"Himeno","recipient":"à Denji","aliases":[]},{"text":"On pourrait fuir ensemble et oublier tout le reste.","speaker":"Reze","recipient":"à Denji","aliases":[]},{"text":"La peur de l'avenir nourrit l'avenir lui-même.","speaker":"Future Devil","recipient":"à Aki","aliases":["Démon du Futur","Future"]},{"text":"Les chasseurs les plus dangereux sont ceux qui ont encore quelque chose à perdre.","speaker":"Kishibe","recipient":"à Denji","aliases":[]},{"text":"Je veux vivre sans être jugée pour tout ce que je pense.","speaker":"Asa Mitaka","recipient":"à elle-même","aliases":["Asa"]},{"text":"Je préfère une vie courte que je choisis à une longue vie décidée par quelqu'un d'autre.","speaker":"Quanxi","recipient":"à ses compagnes","aliases":[]},{"text":"Un contrat devient vraiment intéressant quand l'autre personne croit encore avoir le choix.","speaker":"Santa Claus","recipient":"à ses victimes","aliases":[]},{"text":"Je veux une famille, même si je ne comprends pas encore très bien comment ça fonctionne.","speaker":"Nayuta","recipient":"à Denji","aliases":[]},{"text":"La faim peut prendre bien plus de formes que le simple besoin de manger.","speaker":"Fami","recipient":"à Asa","aliases":["Famine Devil"]},{"text":"Tout ce qu'Asa possède peut devenir une arme si elle se sent assez coupable.","speaker":"Yoru","recipient":"à Asa","aliases":["War Devil"]}]},"wakfu":{"name":"Wakfu","quotes":[{"text":"Je retrouverai ma famille et la vérité sur les Eliatropes.","speaker":"Yugo","recipient":"à ses amis","aliases":[]},{"text":"Un Iop n'abandonne jamais un combat !","speaker":"Tristepin de Percedal","recipient":"à ses ennemis","aliases":["Tristepin","Percedal","Pinpin"]},{"text":"Mon peuple passe avant mon confort.","speaker":"Amalia Sheran Sharm","recipient":"à ses amis","aliases":["Amalia"]},{"text":"Je ne rate jamais deux fois la même cible.","speaker":"Evangelyne","recipient":"à ses adversaires","aliases":["Eva"]},{"text":"L'expérience vaut parfois plus que toutes les kamas du monde.","speaker":"Ruel Stroud","recipient":"à la Confrérie","aliases":["Ruel"]},{"text":"Le temps est la seule chose que personne ne peut vaincre.","speaker":"Nox","recipient":"à Yugo","aliases":["Noximilien"]},{"text":"Je voulais seulement réparer ce qui nous a été pris.","speaker":"Qilby","recipient":"à Yugo","aliases":[]},{"text":"Je ne suis pas ton ombre, Yugo.","speaker":"Adamai","recipient":"à Yugo","aliases":["Adamaï"]},{"text":"Les dieux jouent avec les mortels comme avec des pions.","speaker":"Oropo","recipient":"à Yugo","aliases":[]},{"text":"La force d'un Iop vient aussi de son cœur.","speaker":"Goultard","recipient":"à Tristepin","aliases":[]},{"text":"Je ne sais pas encore ce que signifie être Eliatrope, mais je veux l'apprendre.","speaker":"Yugo","recipient":"à Adamai","aliases":[]},{"text":"Un vrai Iop fonce d'abord et réfléchit ensuite !","speaker":"Tristepin de Percedal","recipient":"à ses amis","aliases":["Tristepin","Percedal","Pinpin"]},{"text":"Je veux sauver mon peuple sans perdre ceux qui sont devenus ma famille.","speaker":"Amalia Sheran Sharm","recipient":"à Yugo","aliases":["Amalia"]},{"text":"Une flèche bien placée vaut mieux qu'un long discours.","speaker":"Evangelyne","recipient":"à Tristepin","aliases":["Eva"]},{"text":"Le temps ne rend rien. C'est pour ça que je dois lui reprendre ce qu'il m'a volé.","speaker":"Nox","recipient":"à Yugo","aliases":["Noximilien"]},{"text":"Je ne comprends pas encore tout de mon peuple, mais je découvrirai la vérité par moi-même.","speaker":"Yugo","recipient":"à Adamai","aliases":[]},{"text":"Un Iop réfléchit parfois… généralement après le combat !","speaker":"Tristepin de Percedal","recipient":"à ses amis","aliases":["Tristepin","Percedal","Pinpin"]},{"text":"Je veux sauver le royaume Sadida sans perdre ceux qui sont devenus ma famille.","speaker":"Amalia Sheran Sharm","recipient":"à Yugo","aliases":["Amalia"]},{"text":"Une bonne flèche résout souvent ce qu'un long discours complique.","speaker":"Evangelyne","recipient":"à Tristepin","aliases":["Eva"]},{"text":"Le temps m'a tout pris. Je consacrerai le reste de ma vie à lui reprendre ce qu'il me doit.","speaker":"Nox","recipient":"à Yugo","aliases":["Noximilien"]},{"text":"Je porte une histoire beaucoup plus ancienne que mon apparence ne le laisse croire.","speaker":"Joris Jurgen","recipient":"à ses alliés","aliases":["Joris"]},{"text":"Un Ecaflip sait qu'un bon pari n'est jamais entièrement laissé au hasard.","speaker":"Kerubim Crepin","recipient":"à Joris","aliases":["Kerubim"]},{"text":"Je préfère mes griffes aux belles paroles quand quelqu'un menace ma famille.","speaker":"Atcham","recipient":"à Kerubim","aliases":[]},{"text":"Une bonne affaire est celle où je repars avec l'argent et l'aventure.","speaker":"Remington Smisse","recipient":"à ses partenaires","aliases":["Remington"]},{"text":"Je suis peut-être enfermé dans une épée, mais je reste le plus beau Shushu du coin.","speaker":"Rubilax","recipient":"à Tristepin","aliases":[]}]},"demonslayer":{"name":"Demon Slayer","quotes":[{"text":"Je transformerai Nezuko en humaine.","speaker":"Tanjiro Kamado","recipient":"à lui-même","aliases":["Tanjiro","Tanjirō"]},{"text":"Même un démon peut protéger quelqu'un qu'il aime.","speaker":"Nezuko Kamado","recipient":"à Tanjiro","aliases":["Nezuko"]},{"text":"Je suis peut-être terrifié, mais je dois quand même avancer.","speaker":"Zenitsu Agatsuma","recipient":"à lui-même","aliases":["Zenitsu"]},{"text":"Je suis le roi de la montagne !","speaker":"Inosuke Hashibira","recipient":"à ses adversaires","aliases":["Inosuke"]},{"text":"Ne pleure pas. Avance et deviens plus fort.","speaker":"Kyojuro Rengoku","recipient":"à Tanjiro","aliases":["Rengoku","Kyōjurō"]},{"text":"Je ne suis pas détesté par les autres.","speaker":"Giyu Tomioka","recipient":"à Shinobu","aliases":["Giyu","Giyū"]},{"text":"La colère ne disparaît pas simplement parce que je souris.","speaker":"Shinobu Kocho","recipient":"à Tanjiro","aliases":["Shinobu","Shinobu Kochō"]},{"text":"Je ne pardonnerai jamais aux démons.","speaker":"Sanemi Shinazugawa","recipient":"à Tanjiro","aliases":["Sanemi"]},{"text":"Je veux devenir quelqu'un dont ma famille serait fière.","speaker":"Muichiro Tokito","recipient":"à lui-même","aliases":["Muichiro"]},{"text":"Je suis une catastrophe naturelle. Les humains ne peuvent rien contre moi.","speaker":"Muzan Kibutsuji","recipient":"aux Pourfendeurs","aliases":["Muzan"]},{"text":"Je ne laisserai pas la haine me transformer en quelqu'un que Nezuko détesterait.","speaker":"Tanjiro Kamado","recipient":"à lui-même","aliases":["Tanjiro","Tanjirō"]},{"text":"Je protégerai mon frère même si je ne peux pas parler.","speaker":"Nezuko Kamado","recipient":"à Tanjiro","aliases":["Nezuko"]},{"text":"Quand je dors, au moins mon corps se souvient d'être courageux.","speaker":"Zenitsu Agatsuma","recipient":"à lui-même","aliases":["Zenitsu"]},{"text":"Si quelqu'un est plus fort que moi, je n'ai qu'à devenir plus fort.","speaker":"Inosuke Hashibira","recipient":"à Tanjiro","aliases":["Inosuke"]},{"text":"La vie est précieuse justement parce qu'elle a une fin.","speaker":"Kyojuro Rengoku","recipient":"à Akaza","aliases":["Rengoku","Kyōjurō"]},{"text":"Je n'ai pas besoin d'être compris pour accomplir mon devoir.","speaker":"Giyu Tomioka","recipient":"à Tanjiro","aliases":["Giyu","Giyū"]},{"text":"Je souris parce que ma sœur aurait voulu que je continue.","speaker":"Shinobu Kocho","recipient":"à Tanjiro","aliases":["Shinobu","Shinobu Kochō"]},{"text":"Je ne ferai jamais confiance à un démon.","speaker":"Sanemi Shinazugawa","recipient":"à Tanjiro","aliases":["Sanemi"]},{"text":"Mes souvenirs comptent davantage que le brouillard qui les cache.","speaker":"Muichiro Tokito","recipient":"à lui-même","aliases":["Muichiro"]},{"text":"Les humains sont des créatures jetables. Moi, je suis éternel.","speaker":"Muzan Kibutsuji","recipient":"aux Pourfendeurs","aliases":["Muzan"]},{"text":"Je veux devenir assez forte pour faire honneur à ceux qui m'ont sauvée.","speaker":"Kanao Tsuyuri","recipient":"à Tanjiro","aliases":["Kanao"]},{"text":"Je n'utilise peut-être pas de souffle, mais je peux quand même combattre les démons.","speaker":"Genya Shinazugawa","recipient":"à Tanjiro","aliases":["Genya"]},{"text":"Un combat digne de moi doit être flamboyant du début à la fin.","speaker":"Tengen Uzui","recipient":"à ses compagnons","aliases":["Tengen"]},{"text":"J'ai rejoint les Pourfendeurs parce que je veux trouver quelqu'un qui accepte toute ma force.","speaker":"Mitsuri Kanroji","recipient":"à ses amis","aliases":["Mitsuri"]},{"text":"Deviens un démon et nous pourrons nous battre pour l'éternité.","speaker":"Akaza","recipient":"à Rengoku","aliases":[]}]},"pokemon":{"name":"Pokémon","quotes":[{"text":"Je veux devenir Maître Pokémon !","speaker":"Ash Ketchum","recipient":"à ses amis","aliases":["Sacha","Ash"]},{"text":"Pikachu !","speaker":"Ash Ketchum","recipient":"à Pikachu","aliases":["Sacha","Ash"]},{"text":"La Team Rocket s'envole vers d'autres cieux !","speaker":"Jessie","recipient":"à ses adversaires","aliases":[]},{"text":"Pour protéger le monde de la dévastation !","speaker":"Jessie","recipient":"à ceux qui rencontrent la Team Rocket","aliases":[]},{"text":"Pour rallier tous les peuples à notre nation !","speaker":"James","recipient":"à ceux qui rencontrent la Team Rocket","aliases":[]},{"text":"Miaouss, oui la guerre !","speaker":"Meowth","recipient":"à Jessie et James","aliases":["Miaouss"]},{"text":"Un vrai Dresseur apprend autant de ses défaites que de ses victoires.","speaker":"Brock","recipient":"à Ash","aliases":["Pierre"]},{"text":"Les Pokémon Eau sont les meilleurs !","speaker":"Misty","recipient":"à Ash","aliases":["Ondine"]},{"text":"Il n'y a pas de Pokémon faible, seulement des stratégies différentes.","speaker":"Cynthia","recipient":"à ses challengers","aliases":["Cynthia Shirona"]},{"text":"Pour comprendre un Pokémon, il faut d'abord l'écouter.","speaker":"Professor Oak","recipient":"aux jeunes Dresseurs","aliases":["Professeur Chen","Oak"]},{"text":"Je veux rencontrer tous les Pokémon du monde.","speaker":"Ash Ketchum","recipient":"à ses amis","aliases":["Sacha","Ash"]},{"text":"On peut perdre un combat sans perdre l'envie de progresser.","speaker":"Ash Ketchum","recipient":"à ses compagnons","aliases":["Sacha","Ash"]},{"text":"Un Pokémon n'est pas un outil. C'est un partenaire.","speaker":"Brock","recipient":"à de jeunes Dresseurs","aliases":["Pierre"]},{"text":"Un bon Dresseur doit comprendre les émotions de son Pokémon.","speaker":"Misty","recipient":"à Ash","aliases":["Ondine"]},{"text":"Même les meilleurs champions continuent d'apprendre.","speaker":"Cynthia","recipient":"à ses challengers","aliases":["Cynthia Shirona"]},{"text":"La recherche commence souvent par une question simple.","speaker":"Professor Oak","recipient":"aux jeunes Dresseurs","aliases":["Professeur Chen","Oak"]},{"text":"Un Pokémon rare n'est pas forcément un Pokémon heureux.","speaker":"Jessie","recipient":"à James","aliases":[]},{"text":"La Team Rocket mérite enfin une victoire !","speaker":"James","recipient":"à Jessie","aliases":[]},{"text":"Miaouss mérite aussi sa part du butin !","speaker":"Meowth","recipient":"à Jessie et James","aliases":["Miaouss"]},{"text":"La vraie force vient du lien entre Dresseur et Pokémon.","speaker":"Leon","recipient":"à Ash","aliases":["Tarak"]},{"text":"Le monde appartient à ceux qui ont assez d'ambition pour prendre ce qu'ils veulent.","speaker":"Giovanni","recipient":"à la Team Rocket","aliases":[]},{"text":"Je ne veux pas seulement battre Ash, je veux prouver que ma méthode fonctionne.","speaker":"Gary Oak","recipient":"à Ash","aliases":["Régis","Gary"]},{"text":"Chaque concours est une chance de montrer à quel point mon partenaire et moi avons progressé.","speaker":"May","recipient":"à ses Pokémon","aliases":["Flora"]},{"text":"Une performance réussie commence par la confiance entre le Dresseur et son Pokémon.","speaker":"Dawn","recipient":"à ses Pokémon","aliases":["Aurore"]},{"text":"Je veux trouver mon propre rêve sans simplement suivre celui des autres.","speaker":"Serena","recipient":"à Ash","aliases":[]}]},"dragonball":{"name":"Dragon Ball","quotes":[{"text":"Je suis Son Goku, et je viens de la Terre !","speaker":"Son Goku","recipient":"à ses adversaires","aliases":["Goku","Sangoku"]},{"text":"Je suis le prince de tous les Saiyans.","speaker":"Vegeta","recipient":"à ses adversaires","aliases":[]},{"text":"Je me battrai pour protéger ceux que j'aime.","speaker":"Son Gohan","recipient":"à Cell","aliases":["Gohan"]},{"text":"Parfois, un ancien ennemi devient le meilleur allié.","speaker":"Piccolo","recipient":"à Gohan","aliases":[]},{"text":"Vous allez connaître la puissance de l'empereur de l'univers.","speaker":"Freezer","recipient":"à Goku","aliases":["Frieza"]},{"text":"Je suis la perfection.","speaker":"Cell","recipient":"aux Z-Fighters","aliases":["Perfect Cell"]},{"text":"Je ne détruis pas pour le plaisir. C'est simplement mon travail.","speaker":"Beerus","recipient":"à Goku","aliases":["Bills"]},{"text":"La force sans maîtrise n'est rien.","speaker":"Whis","recipient":"à Goku et Vegeta","aliases":[]},{"text":"La justice de mon univers exige que je gagne.","speaker":"Jiren","recipient":"à Goku","aliases":[]},{"text":"Kakarot !","speaker":"Broly","recipient":"à Goku","aliases":[]},{"text":"Je me bats parce que j'aime voir jusqu'où je peux aller.","speaker":"Son Goku","recipient":"à Vegeta","aliases":["Goku","Sangoku"]},{"text":"Je refuse d'être éternellement derrière Kakarot.","speaker":"Vegeta","recipient":"à lui-même","aliases":[]},{"text":"Je n'aime pas me battre, mais je le ferai pour protéger ma famille.","speaker":"Son Gohan","recipient":"à ses ennemis","aliases":["Gohan"]},{"text":"Je ne suis plus le démon que j'étais autrefois.","speaker":"Piccolo","recipient":"à Gohan","aliases":[]},{"text":"La peur est le meilleur moyen de gouverner une galaxie.","speaker":"Freezer","recipient":"à ses soldats","aliases":["Frieza"]},{"text":"Je suis l'évolution parfaite de toutes les formes de vie.","speaker":"Cell","recipient":"à Gohan","aliases":["Perfect Cell"]},{"text":"Un dieu de la destruction n'a pas besoin de justification.","speaker":"Beerus","recipient":"à Goku","aliases":["Bills"]},{"text":"Le calme peut rendre un combattant bien plus dangereux que la colère.","speaker":"Whis","recipient":"à Goku","aliases":[]},{"text":"Je n'ai pas besoin de comprendre mes adversaires pour les dépasser.","speaker":"Jiren","recipient":"à Goku","aliases":[]},{"text":"Ma colère est la seule chose que je ne peux pas contrôler.","speaker":"Broly","recipient":"à lui-même","aliases":[]},{"text":"Je ne suis peut-être pas un Saiyan, mais je n'abandonnerai jamais mes amis.","speaker":"Krillin","recipient":"à Goku","aliases":["Krilin"]},{"text":"Je suis venu du futur pour empêcher que le vôtre devienne le même enfer.","speaker":"Future Trunks","recipient":"à Goku","aliases":["Trunks du futur"]},{"text":"Je protège cette île parce que j'ai enfin trouvé une vie qui m'appartient.","speaker":"Android 17","recipient":"à ses alliés","aliases":["C-17","C17"]},{"text":"Je n'ai pas besoin d'être humaine pour savoir ce que ma famille représente pour moi.","speaker":"Android 18","recipient":"à Krillin","aliases":["C-18","C18"]},{"text":"Un vrai maître sait que la discipline compte autant que la puissance.","speaker":"Master Roshi","recipient":"à Goku et Krillin","aliases":["Tortue Géniale","Roshi"]}]},"hellsparadise":{"name":"Hell's Paradise","quotes":[{"text":"Je veux rentrer vivant auprès de ma femme.","speaker":"Gabimaru","recipient":"à Sagiri","aliases":[]},{"text":"La peur de mourir prouve que tu tiens encore à la vie.","speaker":"Yamada Asaemon Sagiri","recipient":"à Gabimaru","aliases":["Sagiri"]},{"text":"Je survivrai parce que mourir serait vraiment trop ennuyeux.","speaker":"Yuzuriha","recipient":"à Sagiri","aliases":[]},{"text":"La liberté vaut plus que les chaînes de n'importe quel clan.","speaker":"Aza Chobei","recipient":"à Toma","aliases":["Chobei","Chōbei"]},{"text":"Je suivrai mon frère jusqu'au bout.","speaker":"Aza Toma","recipient":"à Chobei","aliases":["Toma","Tōma"]},{"text":"Un sabre hésitant tue celui qui le tient.","speaker":"Yamada Asaemon Shion","recipient":"à Tenza","aliases":["Shion"]},{"text":"Je veux choisir moi-même la façon dont je vais vivre.","speaker":"Yamada Asaemon Tenza","recipient":"à Nurugai","aliases":["Tenza"]},{"text":"Je deviendrai plus fort pour que personne ne décide à ma place.","speaker":"Nurugai","recipient":"à Tenza","aliases":[]},{"text":"L'immortalité n'est pas un cadeau si elle détruit ce que nous sommes.","speaker":"Mei","recipient":"à Gabimaru","aliases":[]},{"text":"Les humains cherchent toujours l'éternité sans comprendre son prix.","speaker":"Rien","recipient":"aux intrus","aliases":[]},{"text":"Je ne suis pas vide. Ma femme me donne une raison de vivre.","speaker":"Gabimaru","recipient":"à Sagiri","aliases":[]},{"text":"Un exécuteur doit voir l'humain avant le condamné.","speaker":"Yamada Asaemon Sagiri","recipient":"à Gabimaru","aliases":["Sagiri"]},{"text":"Je ne fais confiance à personne, mais je sais reconnaître une bonne occasion.","speaker":"Yuzuriha","recipient":"à Gabimaru","aliases":[]},{"text":"Mon frère est la seule personne dont je ne peux pas me séparer.","speaker":"Aza Chobei","recipient":"à Toma","aliases":["Chobei","Chōbei"]},{"text":"Je suivrai Chobei même si son chemin mène en enfer.","speaker":"Aza Toma","recipient":"à lui-même","aliases":["Toma","Tōma"]},{"text":"Je pensais être vide, mais l'idée de revoir ma femme me prouve le contraire.","speaker":"Gabimaru","recipient":"à Sagiri","aliases":[]},{"text":"Un exécuteur ne devrait pas oublier qu'un condamné reste un être humain.","speaker":"Yamada Asaemon Sagiri","recipient":"à Gabimaru","aliases":["Sagiri"]},{"text":"Je ne fais confiance à personne, mais je sais reconnaître une alliance utile.","speaker":"Yuzuriha","recipient":"à Gabimaru","aliases":[]},{"text":"Je peux perdre tout le reste, mais pas mon petit frère.","speaker":"Aza Chobei","recipient":"à Toma","aliases":["Chobei","Chōbei"]},{"text":"Si mon frère avance vers l'enfer, alors je marcherai derrière lui.","speaker":"Aza Toma","recipient":"à lui-même","aliases":["Toma","Tōma"]},{"text":"Un Asaemon doit savoir exactement où frapper pour que la souffrance soit la plus courte possible.","speaker":"Yamada Asaemon Fuchi","recipient":"à ses camarades","aliases":["Fuchi"]},{"text":"Je préfère réfléchir avant de lever mon sabre, même si les autres trouvent ça lâche.","speaker":"Yamada Asaemon Senta","recipient":"à Yuzuriha","aliases":["Senta"]},{"text":"Je ne vois aucune raison de mourir pour un honneur qui ne me rapporte rien.","speaker":"Yamada Asaemon Jikka","recipient":"à ses collègues","aliases":["Jikka"]},{"text":"Le devoir d'un Asaemon passe avant la peur, le doute et même la compassion.","speaker":"Yamada Asaemon Shugen","recipient":"aux Asaemon","aliases":["Shugen"]},{"text":"Les humains pensent tout comprendre dès qu'ils donnent un nom à quelque chose.","speaker":"Zhu Jin","recipient":"aux intrus","aliases":[]}]},"gachiakuta":{"name":"Gachiakuta","quotes":[{"text":"Je vais remonter là-haut et découvrir qui a tué Regto.","speaker":"Rudo Surebrec","recipient":"à lui-même","aliases":["Rudo"]},{"text":"Un objet aimé longtemps finit par porter quelque chose de son propriétaire.","speaker":"Enjin","recipient":"à Rudo","aliases":[]},{"text":"Tu n'es pas spécial juste parce que tu souffres.","speaker":"Zanka Nijiku","recipient":"à Rudo","aliases":["Zanka"]},{"text":"Je préfère sourire quand je me bats.","speaker":"Riyo Reaper","recipient":"à ses adversaires","aliases":["Riyo"]},{"text":"Les gens sont bien plus amusants quand on les pousse à bout.","speaker":"Jabber Wonger","recipient":"à Rudo","aliases":["Jabber"]},{"text":"Le monde d'en haut jette tout ce qu'il ne veut plus voir.","speaker":"Zodyl Typhon","recipient":"à ses alliés","aliases":["Zodyl"]},{"text":"La confiance est fragile. C'est ce qui la rend utile.","speaker":"Tamsy Caines","recipient":"à ses compagnons","aliases":["Tamsy"]},{"text":"Même les ordures ont une histoire.","speaker":"Regto Surebrec","recipient":"à Rudo","aliases":["Regto"]},{"text":"Je veux juste un endroit où personne ne me rejette.","speaker":"Amo Empool","recipient":"à Rudo","aliases":["Amo"]},{"text":"Observer avant d'agir, c'est aussi se battre.","speaker":"Semiu Grier","recipient":"aux Cleaners","aliases":["Semiu"]},{"text":"Je traiterai chaque objet avec respect parce que Regto me l'a appris.","speaker":"Rudo Surebrec","recipient":"à Enjin","aliases":["Rudo"]},{"text":"Un Giver fort comprend d'abord pourquoi son objet compte pour lui.","speaker":"Enjin","recipient":"à Rudo","aliases":[]},{"text":"La rage ne remplace pas la technique.","speaker":"Zanka Nijiku","recipient":"à Rudo","aliases":["Zanka"]},{"text":"Je préfère une mission dangereuse à une journée ennuyeuse.","speaker":"Riyo Reaper","recipient":"aux Cleaners","aliases":["Riyo"]},{"text":"Plus quelqu'un me déteste, plus j'ai envie de voir jusqu'où il peut aller.","speaker":"Jabber Wonger","recipient":"à Rudo","aliases":["Jabber"]},{"text":"Regto m'a appris qu'un objet jeté peut encore avoir une valeur immense.","speaker":"Rudo Surebrec","recipient":"à Enjin","aliases":["Rudo"]},{"text":"Le lien avec un objet compte davantage que son prix ou son apparence.","speaker":"Enjin","recipient":"à Rudo","aliases":[]},{"text":"Ta colère peut te faire avancer, mais elle ne remplacera jamais la technique.","speaker":"Zanka Nijiku","recipient":"à Rudo","aliases":["Zanka"]},{"text":"Une mission dangereuse vaut toujours mieux qu'une journée ennuyeuse.","speaker":"Riyo Reaper","recipient":"aux Cleaners","aliases":["Riyo"]},{"text":"Plus quelqu'un me déteste, plus j'ai envie de voir jusqu'où sa haine peut le pousser.","speaker":"Jabber Wonger","recipient":"à Rudo","aliases":["Jabber"]},{"text":"Un Cleaner doit savoir quand frapper et quand laisser les autres apprendre.","speaker":"Delmon","recipient":"aux Cleaners","aliases":[]},{"text":"Je n'ai pas besoin d'un grand discours pour faire mon travail correctement.","speaker":"Bro","recipient":"aux Cleaners","aliases":[]},{"text":"Même au milieu des déchets, on peut encore trouver quelque chose qui mérite d'être protégé.","speaker":"Dear","recipient":"aux Cleaners","aliases":[]},{"text":"Un Jinki révèle souvent ce que son propriétaire refuse de dire à voix haute.","speaker":"Guita","recipient":"aux Cleaners","aliases":[]},{"text":"Diriger les Cleaners signifie savoir qui envoyer avant même de connaître toute l'histoire.","speaker":"Corvus","recipient":"aux Cleaners","aliases":[]}]},"haikyuu":{"name":"Haikyuu","quotes":[{"text":"Je peux voler même si je suis petit.","speaker":"Shoyo Hinata","recipient":"à ses adversaires","aliases":["Hinata","Shōyō Hinata"]},{"text":"Un passeur doit donner à son attaquant la meilleure balle possible.","speaker":"Tobio Kageyama","recipient":"à Hinata","aliases":["Kageyama"]},{"text":"Le volleyball est un sport où l'on regarde toujours vers le haut.","speaker":"Kei Tsukishima","recipient":"à lui-même","aliases":["Tsukishima"]},{"text":"Je suis le gardien de Karasuno !","speaker":"Yu Nishinoya","recipient":"à son équipe","aliases":["Nishinoya","Noya"]},{"text":"Le talent fleurit, l'instinct se polit.","speaker":"Toru Oikawa","recipient":"à ses rivaux","aliases":["Oikawa","Tōru Oikawa"]},{"text":"Je ne pense pas être meilleur que les autres. Je fais juste mon travail.","speaker":"Wakatoshi Ushijima","recipient":"à Hinata","aliases":["Ushijima"]},{"text":"Hé, hé, hé !","speaker":"Kotaro Bokuto","recipient":"à son équipe","aliases":["Bokuto","Kōtarō Bokuto"]},{"text":"Je n'aime pas me fatiguer, mais j'aime gagner.","speaker":"Kenma Kozume","recipient":"à Hinata","aliases":["Kenma"]},{"text":"Le bloc n'est pas là pour arrêter la balle, mais pour la toucher.","speaker":"Tetsuro Kuroo","recipient":"à Tsukishima","aliases":["Kuroo","Tetsurō Kuroo"]},{"text":"Celui qui contrôle le service contrôle le début de l'échange.","speaker":"Atsumu Miya","recipient":"à ses adversaires","aliases":["Atsumu"]},{"text":"Je ne peux pas changer ma taille, alors je changerai ma façon de jouer.","speaker":"Shoyo Hinata","recipient":"à lui-même","aliases":["Hinata","Shōyō Hinata"]},{"text":"Une passe parfaite n'existe que si l'attaquant peut la frapper.","speaker":"Tobio Kageyama","recipient":"à Hinata","aliases":["Kageyama"]},{"text":"Je pensais que le volleyball n'était qu'un jeu jusqu'à ce que je veuille gagner.","speaker":"Kei Tsukishima","recipient":"à Yamaguchi","aliases":["Tsukishima"]},{"text":"Une défense peut changer tout le rythme d'un match.","speaker":"Yu Nishinoya","recipient":"à Karasuno","aliases":["Nishinoya","Noya"]},{"text":"Le talent n'est rien sans des milliers d'heures de travail.","speaker":"Toru Oikawa","recipient":"à Kageyama","aliases":["Oikawa","Tōru Oikawa"]},{"text":"Je frappe chaque balle comme si elle pouvait être la dernière.","speaker":"Wakatoshi Ushijima","recipient":"à Hinata","aliases":["Ushijima"]},{"text":"Même un ace peut avoir besoin qu'on lui remonte le moral.","speaker":"Kotaro Bokuto","recipient":"à Akaashi","aliases":["Bokuto","Kōtarō Bokuto"]},{"text":"Le volleyball devient amusant quand on comprend les autres joueurs.","speaker":"Kenma Kozume","recipient":"à Hinata","aliases":["Kenma"]},{"text":"Un bon bloc transforme le terrain en piège.","speaker":"Tetsuro Kuroo","recipient":"à Tsukishima","aliases":["Kuroo","Tetsurō Kuroo"]},{"text":"Une passe parfaite donne envie à l'attaquant de marquer.","speaker":"Atsumu Miya","recipient":"à Osamu","aliases":["Atsumu"]},{"text":"Un capitaine doit rester stable quand toute l'équipe commence à paniquer.","speaker":"Daichi Sawamura","recipient":"à Karasuno","aliases":["Daichi"]},{"text":"Je n'ai pas besoin d'être le titulaire pour continuer à préparer la meilleure passe possible.","speaker":"Koshi Sugawara","recipient":"à Karasuno","aliases":["Sugawara","Suga"]},{"text":"Je veux être l'ace qu'on appelle quand le point devient vraiment difficile.","speaker":"Asahi Azumane","recipient":"à Karasuno","aliases":["Asahi"]},{"text":"Je n'ai jamais eu besoin d'être calme pour frapper plus fort que l'adversaire.","speaker":"Ryunosuke Tanaka","recipient":"à ses adversaires","aliases":["Tanaka","Ryūnosuke Tanaka"]},{"text":"Je continuerai de servir jusqu'à ce que ma balle devienne une arme indispensable.","speaker":"Tadashi Yamaguchi","recipient":"à Karasuno","aliases":["Yamaguchi"]}]},"jjk":{"name":"Jujutsu Kaisen","quotes":[{"text":"Je veux que les gens aient une mort correcte.","speaker":"Yuji Itadori","recipient":"à lui-même","aliases":["Yuji","Itadori","Yūji"]},{"text":"Je sauverai les gens de façon injuste.","speaker":"Megumi Fushiguro","recipient":"à Yuji","aliases":["Megumi"]},{"text":"Je m'aime quand je suis jolie et quand je suis forte.","speaker":"Nobara Kugisaki","recipient":"à ses adversaires","aliases":["Nobara"]},{"text":"Dans le ciel et sur la terre, moi seul suis l'honoré.","speaker":"Satoru Gojo","recipient":"à Toji","aliases":["Gojo","Gojō"]},{"text":"L'amour est la plus tordue des malédictions.","speaker":"Satoru Gojo","recipient":"à Yuta","aliases":["Gojo","Gojō"]},{"text":"Je veux un monde où les exorcistes n'auront plus à souffrir.","speaker":"Suguru Geto","recipient":"à Gojo","aliases":["Geto","Getō"]},{"text":"Connais ta place, idiot.","speaker":"Ryomen Sukuna","recipient":"à ses adversaires","aliases":["Sukuna"]},{"text":"Le travail, c'est nul.","speaker":"Kento Nanami","recipient":"à Yuji","aliases":["Nanami"]},{"text":"Je ne travaille pas gratuitement.","speaker":"Mei Mei","recipient":"à ses alliés","aliases":[]},{"text":"Je n'ai jamais travaillé pour personne gratuitement, surtout pas pour les Zenin.","speaker":"Toji Fushiguro","recipient":"à ses employeurs","aliases":["Toji","Tōji"]},{"text":"Je ne veux pas mourir en regrettant de ne pas avoir aidé quelqu'un.","speaker":"Yuji Itadori","recipient":"à Megumi","aliases":["Yuji","Itadori","Yūji"]},{"text":"Je sauve les gens selon ma propre conscience, pas selon une règle.","speaker":"Megumi Fushiguro","recipient":"à Yuji","aliases":["Megumi"]},{"text":"Je ne changerai pas qui je suis pour plaire aux autres.","speaker":"Nobara Kugisaki","recipient":"à ses adversaires","aliases":["Nobara"]},{"text":"Être le plus fort est souvent terriblement solitaire.","speaker":"Satoru Gojo","recipient":"à Geto","aliases":["Gojo","Gojō"]},{"text":"Je veux un monde où aucun exorciste ne doive tuer son meilleur ami.","speaker":"Suguru Geto","recipient":"à Gojo","aliases":["Geto","Getō"]},{"text":"Les faibles n'ont aucune raison d'attendre de moi de la compassion.","speaker":"Ryomen Sukuna","recipient":"à Yuji","aliases":["Sukuna"]},{"text":"Je respecte les heures supplémentaires encore moins que les malédictions.","speaker":"Kento Nanami","recipient":"à Yuji","aliases":["Nanami"]},{"text":"Tout a un prix. Moi, je le fais simplement payer comptant.","speaker":"Mei Mei","recipient":"à ses clients","aliases":[]},{"text":"Le clan Zenin ne m'a jamais donné de raison de lui être loyal.","speaker":"Toji Fushiguro","recipient":"à ses employeurs","aliases":["Toji","Tōji"]},{"text":"Je veux protéger ceux qui m'ont enfin donné une place.","speaker":"Yuta Okkotsu","recipient":"à ses amis","aliases":["Yuta","Yūta"]},{"text":"Je préfère parler le moins possible si mes mots peuvent blesser ceux qui m'écoutent.","speaker":"Toge Inumaki","recipient":"à ses amis","aliases":["Inumaki","Toge"]},{"text":"Je suis un panda, et ça devrait déjà suffire à rendre cette conversation intéressante.","speaker":"Panda","recipient":"à ses camarades","aliases":[]},{"text":"Je veux devenir assez forte pour que le clan Zenin ne puisse plus ignorer ma valeur.","speaker":"Maki Zenin","recipient":"à ses camarades","aliases":["Maki"]},{"text":"Soigner les exorcistes signifie souvent réparer les conséquences de leurs mauvaises décisions.","speaker":"Shoko Ieiri","recipient":"à Gojo","aliases":["Shoko"]},{"text":"Mes frères sont la seule famille que je reconnaîtrai toujours.","speaker":"Choso","recipient":"à Yuji","aliases":["Chōsō"]}]},"jojo":{"name":"JoJo's Bizarre Adventure","quotes":[{"text":"Ce n'est pas fini tant que je n'ai pas décidé que ça l'était.","speaker":"Jonathan Joestar","recipient":"à Dio","aliases":["Jonathan"]},{"text":"Ta prochaine phrase sera…","speaker":"Joseph Joestar","recipient":"à ses adversaires","aliases":["Joseph"]},{"text":"Yare yare daze.","speaker":"Jotaro Kujo","recipient":"à son entourage","aliases":["Jotaro","Jōtarō"]},{"text":"Quel beau jour pour avoir des cheveux aussi parfaits.","speaker":"Josuke Higashikata","recipient":"à ceux qui parlent de ses cheveux","aliases":["Josuke"]},{"text":"J'ai un rêve.","speaker":"Giorno Giovanna","recipient":"à Bucciarati","aliases":["Giorno"]},{"text":"Je veux sortir de cette prison et reprendre ma vie.","speaker":"Jolyne Cujoh","recipient":"à ses alliés","aliases":["Jolyne"]},{"text":"Kono Dio da !","speaker":"Dio Brando","recipient":"à Jonathan","aliases":["DIO","Dio"]},{"text":"Je veux simplement vivre une vie tranquille.","speaker":"Yoshikage Kira","recipient":"à ses adversaires","aliases":["Kira"]},{"text":"Le résultat seul compte. C'est la vérité de ce monde.","speaker":"Diavolo","recipient":"à Giorno","aliases":[]},{"text":"Atteindre le paradis demande des sacrifices.","speaker":"Enrico Pucci","recipient":"à ses alliés","aliases":["Pucci"]},{"text":"Être un gentleman, c'est rester digne même face à un monstre.","speaker":"Jonathan Joestar","recipient":"à Dio","aliases":["Jonathan"]},{"text":"Je gagne souvent parce que j'ai déjà pensé à ta prochaine erreur.","speaker":"Joseph Joestar","recipient":"à ses adversaires","aliases":["Joseph"]},{"text":"Je n'ai rien à ajouter. Tu m'énerves.","speaker":"Jotaro Kujo","recipient":"à ses ennemis","aliases":["Jotaro","Jōtarō"]},{"text":"Parle encore de mes cheveux et tu vas le regretter.","speaker":"Josuke Higashikata","recipient":"à ses provocateurs","aliases":["Josuke"]},{"text":"Mon rêve est plus fort que tout ce que la mafia peut m'opposer.","speaker":"Giorno Giovanna","recipient":"à Bucciarati","aliases":["Giorno"]},{"text":"Je ne laisserai personne décider de ma vie à ma place.","speaker":"Jolyne Cujoh","recipient":"à Pucci","aliases":["Jolyne"]},{"text":"L'humanité m'ennuie. Le pouvoir, lui, ne m'ennuie jamais.","speaker":"Dio Brando","recipient":"à ses ennemis","aliases":["DIO","Dio"]},{"text":"Je ne demande rien au monde, sauf qu'il me laisse tranquille.","speaker":"Yoshikage Kira","recipient":"à ses victimes","aliases":["Kira"]},{"text":"Je veux effacer chaque futur où je perds.","speaker":"Diavolo","recipient":"à Giorno","aliases":[]},{"text":"Le destin est une force qu'on peut guider si on comprend son chemin.","speaker":"Enrico Pucci","recipient":"à ses alliés","aliases":["Pucci"]},{"text":"Le feu de Magician's Red n'a pas besoin d'une seconde chance pour brûler sa cible.","speaker":"Muhammad Avdol","recipient":"à ses adversaires","aliases":["Avdol"]},{"text":"Même à distance, Hierophant Green reste exactement là où j'ai besoin de lui.","speaker":"Noriaki Kakyoin","recipient":"à ses adversaires","aliases":["Kakyoin"]},{"text":"Je n'ai pas besoin de parler pour montrer que je déteste quelqu'un.","speaker":"Iggy","recipient":"à ses compagnons","aliases":[]},{"text":"The Hand efface tout ce qu'il touche, même si moi je ne comprends pas toujours ce qui arrive ensuite.","speaker":"Okuyasu Nijimura","recipient":"à Josuke","aliases":["Okuyasu"]},{"text":"Je refuse qu'on lise mon travail sans respecter l'expérience qui l'a créé.","speaker":"Rohan Kishibe","recipient":"à Josuke","aliases":["Rohan"]}]},"tensura":{"name":"Tensura","quotes":[{"text":"Je voulais une vie tranquille, et me voilà chef d'une nation.","speaker":"Rimuru Tempest","recipient":"à ses amis","aliases":["Rimuru"]},{"text":"Je suis Veldora, le Dragon des Tempêtes !","speaker":"Veldora Tempest","recipient":"à Rimuru","aliases":["Veldora"]},{"text":"Si c'est amusant, alors je suis partante !","speaker":"Milim Nava","recipient":"à Rimuru","aliases":["Milim"]},{"text":"Tout ce que mon seigneur désire sera accompli.","speaker":"Diablo","recipient":"à Rimuru","aliases":[]},{"text":"Je protégerai Tempest au nom de Rimuru-sama.","speaker":"Benimaru","recipient":"aux habitants de Tempest","aliases":[]},{"text":"Rimuru-sama mérite le meilleur de mes plats.","speaker":"Shion","recipient":"à Rimuru","aliases":[]},{"text":"Les démons respectent la force, pas les titres.","speaker":"Guy Crimson","recipient":"aux Demon Lords","aliases":["Guy"]},{"text":"La foi n'empêche pas d'utiliser son jugement.","speaker":"Luminous Valentine","recipient":"à Hinata","aliases":["Luminous"]},{"text":"Je juge les monstres sur leurs actes, pas sur leur race.","speaker":"Hinata Sakaguchi","recipient":"à Rimuru","aliases":["Hinata"]},{"text":"Même moi, je peux devenir utile à Tempest !","speaker":"Gobta","recipient":"à Rimuru","aliases":[]},{"text":"Je veux un pays où humains et monstres puissent manger à la même table.","speaker":"Rimuru Tempest","recipient":"à ses alliés","aliases":["Rimuru"]},{"text":"Rimuru est mon meilleur ami, donc son ennemi est aussi le mien.","speaker":"Veldora Tempest","recipient":"aux ennemis de Tempest","aliases":["Veldora"]},{"text":"Une fête sans combat ni nourriture n'est pas une vraie fête !","speaker":"Milim Nava","recipient":"à Rimuru","aliases":["Milim"]},{"text":"Mon seigneur n'a qu'à souhaiter et je transformerai ce souhait en réalité.","speaker":"Diablo","recipient":"à Rimuru","aliases":[]},{"text":"La responsabilité d'un général commence avant le combat et finit après les pertes.","speaker":"Benimaru","recipient":"à Tempest","aliases":[]},{"text":"Je veux construire un pays où un humain et un monstre peuvent partager le même repas.","speaker":"Rimuru Tempest","recipient":"à ses alliés","aliases":["Rimuru"]},{"text":"Rimuru est mon ami. Cela suffit pour que ses ennemis deviennent aussi les miens.","speaker":"Veldora Tempest","recipient":"aux ennemis de Tempest","aliases":["Veldora"]},{"text":"Une fête sans bonne nourriture ni adversaire intéressant n'est pas une vraie fête !","speaker":"Milim Nava","recipient":"à Rimuru","aliases":["Milim"]},{"text":"Un seul souhait de mon seigneur suffit pour devenir mon ordre.","speaker":"Diablo","recipient":"à Rimuru","aliases":[]},{"text":"Un général doit penser aux conséquences d'un combat avant même de tirer son épée.","speaker":"Benimaru","recipient":"aux forces de Tempest","aliases":[]},{"text":"Je veux que Tempest soit un endroit où chacun puisse se sentir accueilli.","speaker":"Shuna","recipient":"aux habitants de Tempest","aliases":[]},{"text":"Une mission réussie est celle dont l'ennemi n'a jamais compris qu'elle avait commencé.","speaker":"Souei","recipient":"à Benimaru","aliases":[]},{"text":"Une vie entière à manier le sabre permet de reconnaître un vrai talent en un seul échange.","speaker":"Hakuro","recipient":"à ses élèves","aliases":[]},{"text":"Je suivrai mon maître partout où son odeur me guidera.","speaker":"Ranga","recipient":"à Rimuru","aliases":[]},{"text":"Je protégerai Tempest pour réparer les fautes commises par mon peuple.","speaker":"Geld","recipient":"à Rimuru","aliases":[]}]},"opm":{"name":"One Punch Man","quotes":[{"text":"Je suis un héros pour le plaisir.","speaker":"Saitama","recipient":"à ses adversaires","aliases":[]},{"text":"Maître, apprenez-moi le secret de votre puissance.","speaker":"Genos","recipient":"à Saitama","aliases":[]},{"text":"Je n'ai pas de temps à perdre avec des faibles.","speaker":"Tatsumaki","recipient":"aux autres héros","aliases":["Tornado"]},{"text":"La force véritable vient de toute une vie d'entraînement.","speaker":"Bang","recipient":"à Garou","aliases":["Silver Fang"]},{"text":"Parfois, avoir l'air fort suffit à gagner.","speaker":"King","recipient":"à Saitama","aliases":[]},{"text":"Je veux devenir assez forte pour ne plus vivre dans l'ombre de ma sœur.","speaker":"Fubuki","recipient":"à Saitama","aliases":["Blizzard"]},{"text":"Je deviendrai le mal absolu.","speaker":"Garou","recipient":"aux héros","aliases":["Garoh"]},{"text":"Tu es trop fort, Saitama.","speaker":"Boros","recipient":"à Saitama","aliases":[]},{"text":"Même sans pouvoir, je peux toujours pédaler vers le danger.","speaker":"Mumen Rider","recipient":"aux civils","aliases":["Rider sans permis"]},{"text":"La vitesse est tout ce dont un ninja a besoin.","speaker":"Flashy Flash","recipient":"à ses adversaires","aliases":["Flash"]},{"text":"J'ai peut-être trop de force, mais pas assez de choses qui m'intéressent.","speaker":"Saitama","recipient":"à Genos","aliases":[]},{"text":"Je veux devenir assez fort pour ne plus jamais perdre mon corps.","speaker":"Genos","recipient":"à Saitama","aliases":[]},{"text":"Je n'ai pas besoin d'une équipe pour écraser un monstre.","speaker":"Tatsumaki","recipient":"aux héros","aliases":["Tornado"]},{"text":"Un artiste martial apprend surtout quand son adversaire le dépasse.","speaker":"Bang","recipient":"à Garou","aliases":["Silver Fang"]},{"text":"Le secret de ma puissance, c'est que personne ne connaît la vérité.","speaker":"King","recipient":"à Saitama","aliases":[]},{"text":"Je veux bâtir mon propre groupe, pas vivre dans l'ombre de Tatsumaki.","speaker":"Fubuki","recipient":"à Saitama","aliases":["Blizzard"]},{"text":"Je veux forcer le monde à reconnaître le monstre qu'il a créé.","speaker":"Garou","recipient":"aux héros","aliases":["Garoh"]},{"text":"Tu as enfin rendu ce combat intéressant.","speaker":"Boros","recipient":"à Saitama","aliases":[]},{"text":"Même si je ne peux pas gagner, je peux encore tenir jusqu'à l'arrivée des secours.","speaker":"Mumen Rider","recipient":"aux civils","aliases":["Rider sans permis"]},{"text":"Ma vitesse n'a de valeur que si personne ne peut la suivre.","speaker":"Flashy Flash","recipient":"à ses adversaires","aliases":["Flash"]},{"text":"Un sabreur doit pouvoir trancher la peur avant de trancher son ennemi.","speaker":"Atomic Samurai","recipient":"à ses disciples","aliases":[]},{"text":"Un plan et quelques gadgets peuvent compenser beaucoup de différence de puissance.","speaker":"Child Emperor","recipient":"aux héros","aliases":[]},{"text":"Quand on peut se régénérer, on apprend à utiliser son propre corps d'une manière différente.","speaker":"Zombieman","recipient":"aux héros","aliases":[]},{"text":"Plus je prends de coups, plus j'ai envie d'en donner un encore plus fort.","speaker":"Metal Bat","recipient":"à ses adversaires","aliases":[]},{"text":"Q-City est mon territoire. Tant que je suis là, personne n'y touche.","speaker":"Watchdog Man","recipient":"aux monstres","aliases":[]}]},"sao":{"name":"Sword Art Online","quotes":[{"text":"Dans ce monde, mourir dans le jeu signifie mourir pour de vrai.","speaker":"Kirito","recipient":"aux joueurs de SAO","aliases":["Kazuto Kirigaya"]},{"text":"Je préfère vivre ici avec toi que survivre seule.","speaker":"Asuna Yuuki","recipient":"à Kirito","aliases":["Asuna"]},{"text":"Une balle virtuelle peut quand même réveiller une vraie peur.","speaker":"Sinon","recipient":"à Kirito","aliases":["Shino Asada"]},{"text":"Même dans un jeu, nos sentiments sont réels.","speaker":"Leafa","recipient":"à Kirito","aliases":["Suguha Kirigaya"]},{"text":"Les amis rencontrés ici ne sont pas moins vrais.","speaker":"Klein","recipient":"à Kirito","aliases":[]},{"text":"Je suis peut-être une IA, mais je vous aime comme mes parents.","speaker":"Yui","recipient":"à Kirito et Asuna","aliases":[]},{"text":"Je veux me battre de toutes mes forces pendant que je le peux.","speaker":"Yuuki Konno","recipient":"à Asuna","aliases":["Yuuki","Yūki"]},{"text":"Je protégerai l'Underworld, même si je dois briser les règles.","speaker":"Alice Zuberg","recipient":"à Kirito","aliases":["Alice"]},{"text":"Je veux retrouver Alice et notre liberté.","speaker":"Eugeo","recipient":"à Kirito","aliases":[]},{"text":"Ce monde était une expérience, mais vos choix étaient réels.","speaker":"Heathcliff","recipient":"à Kirito","aliases":["Akihiko Kayaba","Kayaba"]},{"text":"Je préfère risquer ma vie que rester prisonnier de la peur.","speaker":"Kirito","recipient":"aux joueurs de SAO","aliases":["Kazuto Kirigaya"]},{"text":"Je veux que notre vie ici compte, même si ce monde est virtuel.","speaker":"Asuna Yuuki","recipient":"à Kirito","aliases":["Asuna"]},{"text":"Je n'ai plus envie que mon passé décide de ma prochaine balle.","speaker":"Sinon","recipient":"à Kirito","aliases":["Shino Asada"]},{"text":"Je veux être la sœur de Kirito, pas seulement son partenaire de jeu.","speaker":"Leafa","recipient":"à elle-même","aliases":["Suguha Kirigaya"]},{"text":"Un bon ami reste un ami même quand le serveur s'éteint.","speaker":"Klein","recipient":"à Kirito","aliases":[]},{"text":"Je ne suis pas humaine, mais mes souvenirs avec vous sont réels.","speaker":"Yui","recipient":"à Kirito et Asuna","aliases":[]},{"text":"Je veux laisser quelque chose de moi derrière même après ma mort.","speaker":"Yuuki Konno","recipient":"à Asuna","aliases":["Yuuki","Yūki"]},{"text":"Je veux protéger ceux qui m'ont appris à choisir par moi-même.","speaker":"Alice Zuberg","recipient":"à Kirito","aliases":["Alice"]},{"text":"Je veux avancer avec toi jusqu'au bout de ce monde.","speaker":"Eugeo","recipient":"à Kirito","aliases":[]},{"text":"Je voulais savoir ce que feraient les humains s'ils étaient réellement libres ici.","speaker":"Heathcliff","recipient":"à Kirito","aliases":["Akihiko Kayaba","Kayaba"]},{"text":"Je veux devenir assez forte pour que Pina et moi puissions voyager partout sans peur.","speaker":"Silica","recipient":"à Kirito","aliases":[]},{"text":"Une bonne arme doit être faite pour la personne qui va lui confier sa vie.","speaker":"Lisbeth","recipient":"à Kirito","aliases":["Liz"]},{"text":"Même une courte vie dans ce monde peut contenir des souvenirs qui comptent vraiment.","speaker":"Sachi","recipient":"à Kirito","aliases":[]},{"text":"L'information est parfois l'arme la plus précieuse d'Aincrad.","speaker":"Argo","recipient":"aux joueurs","aliases":["Argo the Rat"]},{"text":"Un chevalier vit assez longtemps pour voir ses certitudes devenir des souvenirs.","speaker":"Bercouli Synthesis One","recipient":"à Alice","aliases":["Bercouli"]}]},"tokyoghoul":{"name":"Tokyo Ghoul","quotes":[{"text":"Je ne suis ni humain ni goule. Je suis moi.","speaker":"Ken Kaneki","recipient":"à lui-même","aliases":["Kaneki"]},{"text":"Pourquoi les goules devraient-elles être les seules à souffrir ?","speaker":"Touka Kirishima","recipient":"à Kaneki","aliases":["Touka","Tōka"]},{"text":"Le monde n'est pas mauvais. Il est simplement là.","speaker":"Kishou Arima","recipient":"à Kaneki","aliases":["Arima"]},{"text":"Je vais faire de ce combat mon chef-d'œuvre.","speaker":"Juuzou Suzuya","recipient":"à ses adversaires","aliases":["Juuzou","Jūzō"]},{"text":"Je veux créer un monde où les goules puissent vivre ouvertement.","speaker":"Eto Yoshimura","recipient":"à Kaneki","aliases":["Eto"]},{"text":"Kaneki est délicieux parce qu'il est unique.","speaker":"Shu Tsukiyama","recipient":"à lui-même","aliases":["Tsukiyama"]},{"text":"Je veux protéger les gens qui m'ont donné un foyer.","speaker":"Hinami Fueguchi","recipient":"à Touka","aliases":["Hinami"]},{"text":"Je ne veux plus être le petit frère qu'on doit protéger.","speaker":"Ayato Kirishima","recipient":"à Touka","aliases":["Ayato"]},{"text":"Je pensais que toutes les goules étaient des monstres. J'avais tort.","speaker":"Kotaro Amon","recipient":"à lui-même","aliases":["Amon"]},{"text":"On survit parfois simplement parce qu'on refuse de mourir.","speaker":"Nishiki Nishio","recipient":"à Kaneki","aliases":["Nishiki"]},{"text":"Je veux vivre sans devoir choisir entre mes deux moitiés.","speaker":"Ken Kaneki","recipient":"à lui-même","aliases":["Kaneki"]},{"text":"Je refuse de laisser les humains décider seuls qui mérite de vivre.","speaker":"Touka Kirishima","recipient":"à Kaneki","aliases":["Touka","Tōka"]},{"text":"Pour changer ce monde, il faut parfois accepter de devenir son ennemi.","speaker":"Kishou Arima","recipient":"à Kaneki","aliases":["Arima"]},{"text":"Je peux sourire même quand tout autour de moi ressemble à un cauchemar.","speaker":"Juuzou Suzuya","recipient":"à ses collègues","aliases":["Juuzou","Jūzō"]},{"text":"Une histoire peut être une arme plus puissante qu'un kagune.","speaker":"Eto Yoshimura","recipient":"à Kaneki","aliases":["Eto"]},{"text":"Kaneki est la seule chose que je refuse de partager.","speaker":"Shu Tsukiyama","recipient":"à ses rivaux","aliases":["Tsukiyama"]},{"text":"Je veux aider les autres comme Touka m'a aidée.","speaker":"Hinami Fueguchi","recipient":"à ses amis","aliases":["Hinami"]},{"text":"Je ne suis plus un enfant qui cherche seulement à provoquer sa sœur.","speaker":"Ayato Kirishima","recipient":"à Touka","aliases":["Ayato"]},{"text":"Je veux comprendre les goules au lieu de seulement les combattre.","speaker":"Kotaro Amon","recipient":"à Akira","aliases":["Amon"]},{"text":"Survivre est parfois la seule façon de se venger.","speaker":"Nishiki Nishio","recipient":"à Kaneki","aliases":["Nishiki"]},{"text":"Je refuse d'être réduite au rôle du monstre dans l'histoire de quelqu'un d'autre.","speaker":"Rize Kamishiro","recipient":"à ses victimes","aliases":["Rize"]},{"text":"Kaneki est mon meilleur ami, même si je ne peux pas comprendre tout ce qu'il est devenu.","speaker":"Hideyoshi Nagachika","recipient":"à Kaneki","aliases":["Hide","Hideyoshi"]},{"text":"Anteiku existe pour offrir aux goules un endroit où vivre sans devenir des bêtes.","speaker":"Yoshimura","recipient":"aux employés d'Anteiku","aliases":["Kuzen"]},{"text":"Je n'ai pas besoin de beaucoup parler pour surveiller ceux qui comptent pour moi.","speaker":"Renji Yomo","recipient":"à Touka","aliases":["Yomo"]},{"text":"Un masque peut montrer beaucoup plus de vérité qu'un visage découvert.","speaker":"Uta","recipient":"à Kaneki","aliases":[]}]},"tokyorevengers":{"name":"Tokyo Revengers","quotes":[{"text":"Cette fois, je ne fuirai plus.","speaker":"Takemichi Hanagaki","recipient":"à lui-même","aliases":["Takemichi"]},{"text":"Toman appartient à chacun de nous.","speaker":"Manjiro Sano","recipient":"aux membres de Toman","aliases":["Mikey"]},{"text":"Mikey n'a pas besoin d'un serviteur. Il a besoin d'un ami.","speaker":"Ken Ryuguji","recipient":"à Mikey","aliases":["Draken"]},{"text":"Je confie Toman à ceux qui protégeront son esprit.","speaker":"Keisuke Baji","recipient":"à Chifuyu","aliases":["Baji"]},{"text":"Je suivrai Baji-san jusqu'au bout.","speaker":"Chifuyu Matsuno","recipient":"à Takemichi","aliases":["Chifuyu"]},{"text":"La violence ne sert à rien si elle détruit ceux qu'on veut protéger.","speaker":"Takashi Mitsuya","recipient":"à ses camarades","aliases":["Mitsuya"]},{"text":"C'est la faute de Mikey si tout est arrivé.","speaker":"Kazutora Hanemiya","recipient":"à Baji","aliases":["Kazutora"]},{"text":"Les gens sont faciles à manipuler quand on connaît leurs faiblesses.","speaker":"Tetta Kisaki","recipient":"à ses alliés","aliases":["Kisaki"]},{"text":"Je veux être le seul roi que Mikey ne puisse pas oublier.","speaker":"Izana Kurokawa","recipient":"à Mikey","aliases":["Izana"]},{"text":"Je protégerai Yuzuha, même si je dois affronter mon frère.","speaker":"Hakkai Shiba","recipient":"à Takemichi","aliases":["Hakkai"]},{"text":"Je changerai le futur même si je dois échouer cent fois.","speaker":"Takemichi Hanagaki","recipient":"à Naoto","aliases":["Takemichi"]},{"text":"Toman ne devrait jamais devenir un endroit où les faibles ont peur.","speaker":"Manjiro Sano","recipient":"aux membres de Toman","aliases":["Mikey"]},{"text":"Le rôle d'un ami, c'est parfois d'arrêter Mikey avant qu'il aille trop loin.","speaker":"Ken Ryuguji","recipient":"à Takemichi","aliases":["Draken"]},{"text":"Je préfère mourir pour Toman plutôt que vivre en la trahissant.","speaker":"Keisuke Baji","recipient":"à Chifuyu","aliases":["Baji"]},{"text":"Je n'abandonnerai jamais quelqu'un qui porte encore la volonté de Baji-san.","speaker":"Chifuyu Matsuno","recipient":"à Takemichi","aliases":["Chifuyu"]},{"text":"Être fort ne sert à rien si tu n'utilises ta force que pour blesser.","speaker":"Takashi Mitsuya","recipient":"à Hakkai","aliases":["Mitsuya"]},{"text":"Je dois arrêter de fuir la responsabilité de mes propres choix.","speaker":"Kazutora Hanemiya","recipient":"à lui-même","aliases":["Kazutora"]},{"text":"Les gens sont des pièces. Je veux seulement choisir où les placer.","speaker":"Tetta Kisaki","recipient":"à Hanma","aliases":["Kisaki"]},{"text":"Je veux être une famille pour ceux que la mienne a rejetés.","speaker":"Izana Kurokawa","recipient":"à Kakucho","aliases":["Izana"]},{"text":"Je protégerai ma sœur avant mon propre orgueil.","speaker":"Hakkai Shiba","recipient":"à Takemichi","aliases":["Hakkai"]},{"text":"Je me bats pour Toman parce que c'est le premier endroit où j'ai eu une vraie place.","speaker":"Haruki Hayashida","recipient":"aux membres de Toman","aliases":["Pah-chin","Pah"]},{"text":"Je reste fidèle à mes amis même quand tout le monde pense qu'ils ont tort.","speaker":"Ryohei Hayashi","recipient":"à Pah-chin","aliases":["Peh-yan","Peh"]},{"text":"Je souris même quand je me bats, alors ne pense pas que je te prends à la légère.","speaker":"Nahoya Kawata","recipient":"à ses adversaires","aliases":["Smiley"]},{"text":"Je préfère rester calme, parce que ma vraie colère est quelque chose que personne ne veut voir.","speaker":"Souya Kawata","recipient":"à ses adversaires","aliases":["Angry"]},{"text":"Je préfère être au milieu du chaos, surtout quand je peux regarder les autres perdre le contrôle.","speaker":"Shuji Hanma","recipient":"à Kisaki","aliases":["Hanma"]}]}};
const quoteTimers = {};

function normalizeQuoteAnswer(value) {
    return String(value || '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[’`]/g, "'")
        .replace(/[^a-z0-9']+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function quoteSpeakers(universeKey) {
    const u = QUOTE_UNIVERSES[universeKey];
    return u ? [...new Set(u.quotes.map(q => q.speaker))].sort((a,b)=>a.localeCompare(b,'fr')) : [];
}

function quoteAnswerMatches(answerRaw, quote, universeKey) {
    const answer = normalizeQuoteAnswer(answerRaw);
    if (!answer) return false;

    const accepted = new Set([
        normalizeQuoteAnswer(quote.speaker),
        ...(quote.aliases || []).map(normalizeQuoteAnswer)
    ]);
    if (accepted.has(answer)) return true;

    if (!answer.includes(' ') && answer.length >= 3) {
        const matches = quoteSpeakers(universeKey).filter(name =>
            normalizeQuoteAnswer(name).split(' ').includes(answer)
        );
        return matches.length === 1 &&
            normalizeQuoteAnswer(matches[0]) === normalizeQuoteAnswer(quote.speaker);
    }
    return false;
}

function quoteEnsureTurn(room) {
    if (!room?.quoteGame || !room.players.length) return;
    if (room.quoteGame.currentTurnIndex >= room.players.length || room.quoteGame.currentTurnIndex < 0) {
        room.quoteGame.currentTurnIndex = 0;
    }
}

function quotePublicState(room) {
    const qg = room.quoteGame;
    if (!qg) return null;
    quoteEnsureTurn(room);

    return {
        universeKey:qg.universeKey,
        universeName:qg.universeName,
        quoteText:qg.currentQuote?.text || '',
        recipient:qg.hintUsed ? (qg.currentQuote?.recipient || '') : null,
        attempts:qg.attempts,
        hintAvailable:qg.attempts >= 5,
        hintUsed:qg.hintUsed,
        currentTurnId:room.players[qg.currentTurnIndex]?.id || null,
        currentTurnName:room.players[qg.currentTurnIndex]?.name || '',
        players:room.players.map((p,idx)=>({
            id:p.id,
            name:p.name,
            score:qg.scores[p.id] || 0,
            isTurn:idx === qg.currentTurnIndex
        })),
        candidates:qg.candidates,
        targetScore:qg.targetScore,
        round:qg.round,
        resolved:qg.resolved,
        lastResult:qg.lastResult || null,
        finished:qg.finished,
        winnerName:qg.winnerName || null,
        revealedSpeaker:qg.resolved ? (qg.currentQuote?.speaker || null) : null
    };
}

function emitQuoteState(room, roomCode) {
    io.to(roomCode).emit('quote_state', quotePublicState(room));
}

function quoteNextPlayer(room) {
    if (!room.players.length) return;
    room.quoteGame.currentTurnIndex = (room.quoteGame.currentTurnIndex + 1) % room.players.length;
}

function quotePickNext(room) {
    const qg = room.quoteGame;
    const source = QUOTE_UNIVERSES[qg.universeKey]?.quotes || [];
    if (!source.length) return;

    let available = source.map((quote,index)=>({quote,index}))
        .filter(x=>!qg.usedIndexes.includes(x.index));

    if (!available.length) {
        qg.usedIndexes = [];
        available = source.map((quote,index)=>({quote,index}));
    }

    const pick = available[Math.floor(Math.random()*available.length)];
    qg.usedIndexes.push(pick.index);
    qg.currentQuote = pick.quote;
    qg.attempts = 0;
    qg.hintUsed = false;
    qg.resolved = false;
    qg.lastResult = null;
    qg.round += 1;
}

function startQuoteGame(room, roomCode) {
    const universeKey = QUOTE_UNIVERSES[room.subMode] ? room.subMode : 'naruto';
    const universe = QUOTE_UNIVERSES[universeKey];

    if (quoteTimers[roomCode]) {
        clearTimeout(quoteTimers[roomCode]);
        delete quoteTimers[roomCode];
    }

    room.status = 'quote_playing';
    room.quoteGame = {
        universeKey,
        universeName:universe.name,
        currentQuote:null,
        usedIndexes:[],
        scores:Object.fromEntries(room.players.map(p=>[p.id,0])),
        currentTurnIndex:0,
        attempts:0,
        hintUsed:false,
        resolved:false,
        lastResult:null,
        targetScore:10,
        round:0,
        candidates:quoteSpeakers(universeKey),
        finished:false,
        winnerName:null
    };

    quotePickNext(room);
    emitQuoteState(room, roomCode);
}

function quoteScheduleNext(roomCode) {
    if (quoteTimers[roomCode]) clearTimeout(quoteTimers[roomCode]);

    quoteTimers[roomCode] = setTimeout(()=>{
        delete quoteTimers[roomCode];
        const room = rooms[roomCode];
        if (!room?.quoteGame || room.status !== 'quote_playing' || room.quoteGame.finished) return;

        quoteNextPlayer(room);
        quotePickNext(room);
        emitQuoteState(room, roomCode);
    }, 1800);
}


/* ================= Blind Test Anime (QCM : trouver l'anime) ================= */
// Chaque musique du dossier /music est associée à son anime.
// Les pistes qui ne viennent pas d'un anime (ou dont l'anime est incertain) sont exclues.
const BLINDTEST_TRACKS = [
    { n:1,  anime:"L'Attaque des Titans", title:"Ai Higuchi - Akuma no Ko" },
    { n:2,  anime:"Demon Slayer", title:"Aimer - Zankyou Sanka" },
    { n:3,  anime:"Dandadan", title:"AiNA THE END - Kakumei Douchuu" },
    { n:4,  anime:"Jujutsu Kaisen", title:"ALI, AKLO - LOST IN PARADISE" },
    { n:5,  anime:"My Hero Academia", title:"amazarashi - Sora ni Utaeba" },
    { n:6,  anime:"86 Eighty-Six", title:"amazarashi - Kyoukaisen (Remix)" },
    { n:7,  anime:"Naruto", title:"ASIAN KUNG-FU GENERATION - Blood Circulator" },
    { n:8,  anime:"Naruto", title:"ASIAN KUNG-FU GENERATION - Haruka Kanata" },
    { n:9,  anime:"My Hero Academia", title:"BLUE ENCOUNT - Polaris" },
    { n:10, anime:"Haikyuu", title:"BURNOUT SYNDROMES - FLY HIGH!!" },
    { n:11, anime:"Serial Experiments Lain", title:"bôa - Duvet" },
    { n:12, anime:"JoJo's Bizarre Adventure", title:"Coda - BLOODY STREAM" },
    { n:13, anime:"Mashle", title:"Creepy Nuts - Bling-Bang-Bang-Born" },
    { n:14, anime:"Dandadan", title:"Creepy Nuts - Otonoke" },
    { n:15, anime:"Tokyo Ghoul", title:"Cö shu Nie - asphyxia" },
    { n:17, anime:"Jujutsu Kaisen", title:"Eve - Kaikai Kitan" },
    { n:18, anime:"Parasite (Kiseijuu)", title:"Fear, and Loathing in Las Vegas - Let Me Hear" },
    { n:19, anime:"Code Geass", title:"FLOW - COLORS" },
    { n:20, anime:"Naruto", title:"FLOW - GO!!!" },
    { n:21, anime:"Naruto", title:"FLOW - Sign" },
    { n:23, anime:"Hunter x Hunter", title:"GALNERYUS - HUNTING FOR YOUR DREAM" },
    { n:24, anime:"Spy x Family", title:"Gen Hoshino - Comedy" },
    { n:25, anime:"Given", title:"Given - Fuyu no Hanashi" },
    { n:26, anime:"Noragami", title:"Hello Sleepwalkers - Goya no Machiawase" },
    { n:27, anime:"Naruto", title:"Ikimonogakari - Blue Bird" },
    { n:28, anime:"Naruto", title:"Ikimonogakari - Hotaru no Hikari" },
    { n:30, anime:"Naruto", title:"KANA-BOON - Silhouette" },
    { n:31, anime:"Chainsaw Man", title:"Kenshi Yonezu - IRIS OUT" },
    { n:32, anime:"Chainsaw Man", title:"Kenshi Yonezu - KICK BACK" },
    { n:33, anime:"My Hero Academia", title:"Kenshi Yonezu - Peace Sign" },
    { n:34, anime:"Jujutsu Kaisen", title:"King Gnu - SPECIALZ" },
    { n:35, anime:"Les Carnets de l'Apothicaire", title:"Lilas - Hyakka Ryouran" },
    { n:36, anime:"L'Attaque des Titans", title:"Linked Horizon - Guren no Yumiya" },
    { n:37, anime:"L'Attaque des Titans", title:"Linked Horizon - Shinzou wo Sasageyo!" },
    { n:38, anime:"Sword Art Online", title:"LiSA - Catch the Moment" },
    { n:39, anime:"Sword Art Online", title:"LiSA - crossing field" },
    { n:40, anime:"My Hero Academia", title:"LiSA - Datte Atashi no Hero." },
    { n:41, anime:"Demon Slayer", title:"LiSA - Gurenge" },
    { n:42, anime:"Solo Leveling", title:"LiSA, Felix - ReawakeR" },
    { n:43, anime:"Seven Deadly Sins", title:"MAN WITH A MISSION - Seven Deadly Sins" },
    { n:44, anime:"Demon Slayer", title:"MAN WITH A MISSION, milet - Kizuna no Kiseki" },
    { n:45, anime:"Hunter x Hunter", title:"Masatoshi Ono - Departure!" },
    { n:46, anime:"Darling in the Franxx", title:"Mika Nakashima - KISS OF DEATH" },
    { n:47, anime:"Fire Force", title:"Mrs. GREEN APPLE - Inferno" },
    { n:49, anime:"L'Attaque des Titans", title:"Ner Leva - My War (Remix)" },
    { n:50, anime:"L'Attaque des Titans", title:"Ner Leva - The Rumbling (Remix)" },
    { n:51, anime:"Death Note", title:"NIGHTMARE - the WORLD" },
    { n:52, anime:"Tokyo Revengers", title:"OFFICIAL HIGE DANDISM - Cry Baby" },
    { n:53, anime:"Spy x Family", title:"OFFICIAL HIGE DANDISM - Mixed Nuts" },
    { n:54, anime:"Bleach", title:"Asterisk (Lo-fi)" },
    { n:55, anime:"Naruto", title:"Blue Bird (Lo-fi)" },
    { n:56, anime:"Assassination Classroom", title:"Bye Bye Yesterday (Lo-fi)" },
    { n:57, anime:"Hunter x Hunter", title:"Departure! (Lo-fi)" },
    { n:58, anime:"L'Attaque des Titans", title:"Guren no Yumiya (Lo-fi)" },
    { n:59, anime:"L'Attaque des Titans", title:"Jiyuu no Tsubasa (Lo-fi)" },
    { n:60, anime:"Noragami", title:"Kyouran Hey Kids!! (Lo-fi)" },
    { n:61, anime:"Soul Eater", title:"Resonance (Lo-fi)" },
    { n:62, anime:"Death Note", title:"The World (Lo-fi)" },
    { n:63, anime:"JoJo's Bizarre Adventure", title:"Bloody Stream (Lo-fi)" },
    { n:64, anime:"Steins;Gate", title:"Hacking to the Gate (Lo-fi)" },
    { n:65, anime:"Naruto", title:"Silhouette (Lo-fi)" },
    { n:66, anime:"Cowboy Bebop", title:"Tank! (Lo-fi)" },
    { n:67, anime:"My Hero Academia", title:"PornoGraffitti - THE DAY" },
    { n:69, anime:"Your Name", title:"RADWIMPS - Nandemonaiya" },
    { n:70, anime:"Your Name", title:"RADWIMPS - Zenzenzense" },
    { n:71, anime:"Your Name", title:"RADWIMPS - Yumetourou" },
    { n:72, anime:"L'Ère des Cristaux (Houseki no Kuni)", title:"Ryuven, Ner Leva - Kyoumen no Nami" },
    { n:73, anime:"L'Attaque des Titans", title:"Hiroyuki Sawano - Attack on Titan" },
    { n:74, anime:"L'Attaque des Titans", title:"Hiroyuki Sawano - The Reluctant Heroes" },
    { n:75, anime:"L'Attaque des Titans", title:"Hiroyuki Sawano - YouSeeBIGGIRL/T:T" },
    { n:76, anime:"L'Attaque des Titans", title:"SiM - Under the Tree" },
    { n:77, anime:"Jujutsu Kaisen", title:"Tatsuya Kitani - Ao no Sumika" },
    { n:78, anime:"Noragami", title:"THE ORAL CIGARETTES - Kyouran Hey Kids!!" },
    { n:79, anime:"Kakegurui", title:"Tia - Deal with the devil" },
    { n:80, anime:"Tokyo Ghoul", title:"TK from Ling tosite sigure - unravel" },
    { n:81, anime:"My Hero Academia", title:"UVERworld - ODD FUTURE" },
    { n:82, anime:"The Promised Neverland", title:"UVERworld - Touch off" },
    { n:83, anime:"Oshi no Ko", title:"YOASOBI - Idol" },
    { n:85, anime:"Beastars", title:"YOASOBI - Kaibutsu" },
    { n:86, anime:"Frieren", title:"Yorushika - Haru" },
    { n:87, anime:"Fullmetal Alchemist: Brotherhood", title:"YUI - again" }
].map(t => {
    // Requête YouTube pour retrouver la vidéo de l'opening/ending (version sans générique si possible)
    const song = t.title.replace(/\s*\((Lo-fi|Remix)\)\s*$/i, '');
    const ost = [38,49,50,69,70,71,72,73,74,75].includes(t.n); // films / OST : pas de version "creditless"
    const yt = ost ? `${t.anime} ${song}` : `${t.anime} ${song} creditless`;
    return { ...t, yt, src:`/music/track_${String(t.n).padStart(3,'0')}.mp3` };
});

// Leurres supplémentaires pour varier les propositions
const BLINDTEST_EXTRA_CHOICES = [
    'One Piece','Dragon Ball Z','Black Clover','Fairy Tail','Blue Lock','One Punch Man',
    'Mob Psycho 100','Vinland Saga','Re:Zero','Mushoku Tensei','Tensura','Hell\'s Paradise',
    'Bungo Stray Dogs','Classroom of the Elite','Kaiju No. 8','Sakamoto Days','Gachiakuta'
];

const BLINDTEST_ANIMES = [...new Set(BLINDTEST_TRACKS.map(t => t.anime))];
const BLINDTEST_ROUNDS = 10;
const BLINDTEST_ROUND_MS = 20000;
const BLINDTEST_REVEAL_MS = 25000; // le temps de regarder l'opening (l'hôte peut passer)
const btVideoCache = new Map(); // requête -> videoId (ou null)

// Recherche le premier résultat YouTube (sans clé API) — résultat mis en cache
async function btFindVideo(query) {
    if (btVideoCache.has(query)) return btVideoCache.get(query);
    let id = null;
    try {
        if (typeof fetch !== 'function') throw new Error('fetch indisponible');
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), 6000);
        const r = await fetch('https://www.youtube.com/results?search_query=' + encodeURIComponent(query), {
            signal:ctrl.signal,
            headers:{
                'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
                'Accept-Language':'fr-FR,fr;q=0.9,en;q=0.8',
                'Cookie':'CONSENT=YES+1; SOCS=CAI'
            }
        });
        clearTimeout(to);
        const html = await r.text();
        const m = html.match(/"videoRenderer":\{"videoId":"([A-Za-z0-9_-]{11})"/) || html.match(/"videoId":"([A-Za-z0-9_-]{11})"/);
        id = m ? m[1] : null;
    } catch (e) {
        console.warn('[BlindTest] Recherche YouTube impossible :', e.message);
    }
    if (id) btVideoCache.set(query, id); // on ne met pas en cache les échecs
    return id;
}
const blindTimers = {};

function btShuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function btClearTimer(roomCode) {
    if (blindTimers[roomCode]) {
        clearTimeout(blindTimers[roomCode]);
        delete blindTimers[roomCode];
    }
}

function btPublicState(room) {
    const bt = room.blindtest;
    if (!bt) return null;
    const revealed = bt.phase !== 'playing';
    return {
        round:bt.round,
        totalRounds:bt.totalRounds,
        phase:bt.phase, // playing | reveal | finished
        src:bt.current?.src || null,
        offset:bt.offset,
        choices:bt.choices,
        endsAt:bt.endsAt,
        serverNow:Date.now(),
        roundMs:BLINDTEST_ROUND_MS,
        answer:revealed ? bt.current?.anime : null,
        songTitle:revealed ? bt.current?.title : null,
        players:room.players.map(p => {
            const a = bt.answers[p.id];
            return {
                id:p.id,
                name:p.name,
                score:bt.scores[p.id] || 0,
                answered:!!a,
                choice:revealed && a ? a.choice : null,
                correct:revealed && a ? a.correct : null,
                gained:revealed && a ? a.gained : 0
            };
        }),
        winnerNames:bt.winnerNames || null,
        hostId:room.host,
        videoId:revealed ? (bt.videoId || null) : null,
        videoSearch:revealed ? (bt.current?.yt || null) : null,
        revealEndsAt:bt.revealEndsAt || null,
        revealMs:BLINDTEST_REVEAL_MS
    };
}

function emitBlindState(room, roomCode) {
    io.to(roomCode).emit('bt_state', btPublicState(room));
}

function btNextRound(room, roomCode) {
    const bt = room.blindtest;
    if (!bt) return;
    btClearTimer(roomCode);

    if (bt.round >= bt.totalRounds) {
        bt.phase = 'finished';
        const best = Math.max(0, ...room.players.map(p => bt.scores[p.id] || 0));
        bt.winnerNames = room.players.filter(p => (bt.scores[p.id] || 0) === best).map(p => p.name);
        room.status = 'bt_over';
        emitBlindState(room, roomCode);
        return;
    }

    // On tire d'abord un anime (pour ne pas avoir 10 fois SNK), puis une de ses musiques
    let pool = BLINDTEST_ANIMES.filter(a => !bt.usedAnimes.includes(a));
    if (!pool.length) { bt.usedAnimes = []; pool = BLINDTEST_ANIMES.slice(); }
    const anime = pool[Math.floor(Math.random() * pool.length)];
    bt.usedAnimes.push(anime);
    const tracks = BLINDTEST_TRACKS.filter(t => t.anime === anime);
    const track = tracks[Math.floor(Math.random() * tracks.length)];

    const wrongPool = btShuffle([...BLINDTEST_ANIMES, ...BLINDTEST_EXTRA_CHOICES].filter(a => a !== anime));
    const wrong = [...new Set(wrongPool)].slice(0, 3);

    bt.round += 1;
    bt.phase = 'playing';
    bt.current = track;
    bt.offset = 15 + Math.floor(Math.random() * 40); // on démarre entre 15s et 55s dans la musique
    bt.choices = btShuffle([anime, ...wrong]);
    bt.answers = {};
    bt.startedAt = Date.now();
    bt.endsAt = bt.startedAt + BLINDTEST_ROUND_MS;
    bt.videoId = null;
    bt.revealEndsAt = null;
    // On cherche la vidéo dès le début de la manche pour qu'elle soit prête à la révélation
    const roundNo = bt.round;
    btFindVideo(track.yt).then(id => {
        if (!room.blindtest || room.blindtest !== bt || bt.round !== roundNo) return;
        bt.videoId = id;
        if (bt.phase === 'reveal' && id) emitBlindState(room, roomCode);
    });

    emitBlindState(room, roomCode);
    blindTimers[roomCode] = setTimeout(() => btReveal(room, roomCode), BLINDTEST_ROUND_MS + 300);
}

function btReveal(room, roomCode) {
    const bt = room.blindtest;
    if (!bt || bt.phase !== 'playing' || rooms[roomCode] !== room) return;
    btClearTimer(roomCode);
    bt.phase = 'reveal';
    bt.revealEndsAt = Date.now() + BLINDTEST_REVEAL_MS;
    emitBlindState(room, roomCode);
    blindTimers[roomCode] = setTimeout(() => {
        if (rooms[roomCode] !== room || !room.blindtest) return;
        btNextRound(room, roomCode);
    }, BLINDTEST_REVEAL_MS);
}

function startBlindTest(room, roomCode) {
    btClearTimer(roomCode);
    room.status = 'bt_playing';
    room.blindtest = {
        round:0,
        totalRounds:BLINDTEST_ROUNDS,
        phase:'playing',
        current:null,
        offset:0,
        choices:[],
        answers:{},
        scores:Object.fromEntries(room.players.map(p => [p.id, 0])),
        usedAnimes:[],
        winnerNames:null
    };
    btNextRound(room, roomCode);
}

io.on('connection', (socket) => {
    console.log(`Un utilisateur s'est connecté : ${socket.id}`);

    // Chaque handler est isolé : si l'un plante, l'erreur est journalisée et
    // seule l'action concernée échoue — la partie et les autres joueurs continuent.
    const brut = socket.on.bind(socket);
    socket.on = (evenement, fn) => brut(evenement, function (...args) {
        try {
            const r = fn.apply(this, args);
            if (r && typeof r.catch === 'function') {
                r.catch(e => console.error(`[handler ${evenement}]`, e));
            }
            return r;
        } catch (e) {
            console.error(`[handler ${evenement}]`, e);
        }
    });

    socket.on('join_room', ({ roomCode, mode, subMode }) => {
        socket.join(roomCode);

        if (!rooms[roomCode]) {
            rooms[roomCode] = {
                code: roomCode,
                mode: mode,
                subMode: subMode,
                host: socket.id,
                status: 'waiting',
                players: [],
                currentTheme: '',
                currentTurnIndex: 0,
                noImpostor: false,
                votes: {}
            };
        }

        const room = rooms[roomCode];
        
        const existingPlayer = room.players.find(p => p.id === socket.id);
        if (!existingPlayer) {
            // Partie déjà lancée : on n'autorise pas l'entrée (sinon tout le salon est renvoyé au menu)
            if (room.status !== 'waiting') {
                socket.leave(roomCode);
                socket.emit('game_error', { message: "Une partie est déjà en cours dans ce salon. Attends la fin de la manche." });
                return;
            }

            // Limite d'effectif : 10 joueurs max pour Undercover et Devine la note
            if ((room.mode === 'undercover' || room.mode === 'note') && room.players.length >= 10) {
                socket.leave(roomCode);
                socket.emit('game_error', { message: "Ce salon est complet (10 joueurs maximum)." });
                return;
            }

            room.players.push({
                id: socket.id,
                name: socket.user.pseudo, // pseudo lié au compte, jamais celui envoyé par le client
                userId: socket.user.id,
                isAlive: true,
                isImpostor: false,
                secretData: '',
                clue: ''
            });
        }

        if (!room.players.some(p => p.id === room.host)) {
            room.host = room.players[0].id;
        }

        io.to(roomCode).emit('update_room', room);
    });

    socket.on('start_game', async (roomCode) => {
        const room = rooms[roomCode];
        if (!room || room.host !== socket.id) return;

        if ((room.mode === 'undercover' || room.mode === 'note') && room.players.length < 3) {
            socket.emit('game_error', { message: "Il faut au moins 3 joueurs dans le salon pour lancer cette partie." });
            return;
        }

        if ((room.mode === 'undercover' || room.mode === 'note') && room.players.length > 10) {
            socket.emit('game_error', { message: "10 joueurs maximum pour cette partie." });
            return;
        }

        if (room.mode === 'undercover') {
            room.currentTheme = room.subMode === 'hardcore' ? "Undercover Hardcore (Multi-animes)" : "Undercover Normal";
            distributeSecretsAndStart(room, roomCode);
        } else if (room.mode === 'note') {
            room.status = 'choosing_theme';
            room.pendingFreshStart = true; // premier lancement : on tire de nouvelles notes
            const themeMasterId = room.players[Math.floor(Math.random() * room.players.length)].id;
            io.to(roomCode).emit('prompt_theme_choice', { room, themeMasterId });
        } else if (room.mode === 'rollandgaros') {
            startRollandGaros(room, roomCode);
        } else if (room.mode === 'enchere') {
            if (room.players.length !== 2) {
                socket.emit('enchere_error', { message: "Il faut exactement 2 joueurs dans le salon pour lancer une Enchère." });
                return;
            }
            startEnchere(room, roomCode);
        } else if (room.mode === 'enchereaveugle') {
            if (room.players.length !== 2) {
                socket.emit('enchere_error', { message: "Il faut exactement 2 joueurs dans le salon pour lancer une Enchère à l'aveugle." });
                return;
            }
            startEnchereAveugle(room, roomCode);
        } else if (room.mode === 'dle') {
            if (room.players.length < 1) {
                socket.emit('game_error', { message: "Il faut au moins 1 joueur pour lancer AnimeDLE." });
                return;
            }
            await startDle(room, roomCode);
        } else if (room.mode === 'connexion') {
            if (room.players.length < 2) {
                socket.emit('game_error', { message: "Il faut au moins 2 joueurs dans le salon pour lancer le Jeu de connexion." });
                return;
            }
            startConnexion(room, roomCode);
        } else if (room.mode === 'quote') {
            if (room.players.length < 1) {
                socket.emit('game_error', { message: "Il faut au moins 1 joueur pour lancer le mode Citations." });
                return;
            }
            startQuoteGame(room, roomCode);
        } else if (room.mode === 'blindtest') {
            startBlindTest(room, roomCode);
        }
    });

    socket.on('submit_custom_theme', ({ roomCode, theme }) => {
        const room = rooms[roomCode];
        if (!room) return;

        room.currentTheme = theme;
        io.to(roomCode).emit('theme_chosen', room);

        if (room.mode === 'note' && !room.pendingFreshStart) {
            // Simple changement de thème en cours de manche : on garde les mêmes notes / le même imposteur
            room.status = 'gameplay';
            room.currentTurnIndex = 0;
            room.players.forEach(p => { p.clue = ''; });
            io.to(roomCode).emit('resume_gameplay', room);
        } else {
            room.pendingFreshStart = false;
            distributeSecretsAndStart(room, roomCode);
        }
    });

    function distributeSecretsAndStart(room, roomCode) {
        room.status = 'reveal';
        room.noImpostor = false;
        room.votes = {};

        // Système de relance propre : tout le monde repart en vie à chaque nouvelle manche
        room.players.forEach(p => { p.isAlive = true; });

        if (room.mode === 'undercover') {
            if (room.subMode === 'hardcore') {
                const randChance = Math.random();
                if (randChance < 0.02) {
                    room.noImpostor = true;
                    // Pioche un perso aléatoire dans le pool hardcore pour tout le monde
                    const defaultWord = undercoverHardcorePool[Math.floor(Math.random() * undercoverHardcorePool.length)];
                    room.players.forEach(p => {
                        p.isImpostor = false;
                        p.secretData = defaultWord;
                    });
                } else {
                    assignUndercoverHardcoreWords(room);
                }
            } else {
                assignUndercoverNormalWords(room);
            }
        } else if (room.mode === 'note') {
            assignNoteWords(room);
        }

        room.players.forEach(p => {
            p.clue = '';
        });
        room.currentTurnIndex = 0;

        io.to(roomCode).emit('launch_reveal', room);
    }

    // Nombre d'imposteurs selon l'effectif : 3-4 → 1, 5-6 → 2, 7-8 → 3, 9-10 → 4
    function getImpostorCount(playerCount) {
        if (playerCount <= 4) return 1;
        if (playerCount <= 6) return 2;
        if (playerCount <= 8) return 3;
        return 4;
    }

    // Tire au sort les imposteurs et distribue les secrets (civils d'un côté, imposteurs de l'autre)
    function assignRolesAndSecrets(room, civilSecret, impostorSecret) {
        const alivePlayers = room.players.filter(p => p.isAlive);
        const impostorCount = Math.min(getImpostorCount(alivePlayers.length), Math.max(alivePlayers.length - 1, 1));

        const shuffled = alivePlayers.slice();
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        const impostorIds = new Set(shuffled.slice(0, impostorCount).map(p => p.id));

        room.players.forEach(p => {
            if (impostorIds.has(p.id)) {
                p.isImpostor = true;
                p.secretData = impostorSecret;
            } else {
                p.isImpostor = false;
                p.secretData = civilSecret;
            }
        });
    }

    function assignUndercoverNormalWords(room) {
        const pair = undercoverPairsNormal[Math.floor(Math.random() * undercoverPairsNormal.length)];
        assignRolesAndSecrets(room, pair[0], pair[1]);
    }

    function assignUndercoverHardcoreWords(room) {
        // En hardcore, on prend 2 persos différents au hasard dans la liste globale
        let idx1 = Math.floor(Math.random() * undercoverHardcorePool.length);
        let idx2 = Math.floor(Math.random() * undercoverHardcorePool.length);
        while (idx2 === idx1) {
            idx2 = Math.floor(Math.random() * undercoverHardcorePool.length);
        }

        assignRolesAndSecrets(room, undercoverHardcorePool[idx1], undercoverHardcorePool[idx2]);
    }

    function assignNoteWords(room) {
        // Tous les civils reçoivent la même note, les imposteurs une autre note commune
        let civilNote = Math.floor(Math.random() * 10) + 1;
        let impostorNote = Math.floor(Math.random() * 10) + 1;
        while (impostorNote === civilNote) {
            impostorNote = Math.floor(Math.random() * 10) + 1;
        }

        assignRolesAndSecrets(room, civilNote + "/10", impostorNote + "/10");
    }

    socket.on('dle_guess', async ({ roomCode, guess }) => {
        const room = rooms[roomCode];
        if (!room || !room.dle || room.status !== 'dle_playing' || room.dle.finished) return;

        const player = room.players.find(p => p.id === socket.id);
        if (!player) return;

        const character = resolveDleGuess(room, guess);
        if (!character) {
            socket.emit('dle_feedback', { ok:false, message:"Choisis un personnage proposé dans la liste." });
            return;
        }

        room.dle.attemptsByPlayer[player.id] = (room.dle.attemptsByPlayer[player.id] || 0) + 1;
        const comparison = makeDleComparison(character, room.dle.target, player, room.dle.categories);
        room.dle.guesses.push(comparison);

        if (comparison.correct) {
            room.dle.finished = true;
            room.dle.winnerId = player.id;
            room.dle.winnerName = player.name;
            room.dle.winnerAttempts = room.dle.attemptsByPlayer[player.id];
            room.status = 'dle_finished';
        }

        emitDleState(room, roomCode);
    });

    // Chat de salon : purement social, n'impacte aucune mécanique de jeu

    socket.on('quote_submit_answer', ({ roomCode, answer }) => {
        const room = rooms[roomCode];
        const qg = room?.quoteGame;
        if (!room || !qg || room.status !== 'quote_playing' || qg.finished || qg.resolved) return;

        quoteEnsureTurn(room);
        const player = room.players[qg.currentTurnIndex];
        if (!player || player.id !== socket.id) {
            socket.emit('quote_feedback', { message:"Ce n'est pas ton tour." });
            return;
        }

        const answerText = String(answer || '').trim();
        if (!answerText) return;

        if (quoteAnswerMatches(answerText, qg.currentQuote, qg.universeKey)) {
            qg.scores[socket.id] = (qg.scores[socket.id] || 0) + 1;
            qg.resolved = true;
            qg.lastResult = { correct:true, playerName:player.name, answer:answerText };

            if (qg.scores[socket.id] >= qg.targetScore) {
                qg.finished = true;
                qg.winnerName = player.name;
            }

            emitQuoteState(room, roomCode);
            if (!qg.finished) quoteScheduleNext(roomCode);
            return;
        }

        qg.attempts += 1;
        qg.lastResult = { correct:false, playerName:player.name, answer:answerText };
        quoteNextPlayer(room);
        emitQuoteState(room, roomCode);
    });

    socket.on('quote_use_hint', ({ roomCode }) => {
        const room = rooms[roomCode];
        const qg = room?.quoteGame;
        if (!room || !qg || room.status !== 'quote_playing' || qg.finished || qg.resolved) return;

        quoteEnsureTurn(room);
        const player = room.players[qg.currentTurnIndex];
        if (!player || player.id !== socket.id) {
            socket.emit('quote_feedback', { message:"L'indice peut être activé uniquement par le joueur dont c'est le tour." });
            return;
        }

        if (qg.attempts < 5) {
            socket.emit('quote_feedback', { message:`Indice disponible après 5 mauvaises réponses (${qg.attempts}/5).` });
            return;
        }

        qg.hintUsed = true;
        emitQuoteState(room, roomCode);
    });

    socket.on('bt_answer', ({ roomCode, choice }) => {
        const room = rooms[roomCode];
        const bt = room?.blindtest;
        if (!room || !bt || room.status !== 'bt_playing' || bt.phase !== 'playing') return;
        if (!room.players.some(p => p.id === socket.id)) return;
        if (bt.answers[socket.id]) return; // une seule réponse par manche
        if (!bt.choices.includes(choice)) return;

        const correct = choice === bt.current.anime;
        let gained = 0;
        if (correct) {
            // 100 points + bonus de rapidité (jusqu'à +50)
            const left = Math.max(0, bt.endsAt - Date.now());
            gained = 100 + Math.round(50 * left / BLINDTEST_ROUND_MS);
            bt.scores[socket.id] = (bt.scores[socket.id] || 0) + gained;
        }
        bt.answers[socket.id] = { choice, correct, gained };

        const connected = room.players.filter(p => !p.disconnected);
        if (connected.every(p => bt.answers[p.id])) {
            btReveal(room, roomCode);
        } else {
            emitBlindState(room, roomCode);
        }
    });

    socket.on('bt_skip', ({ roomCode }) => {
        const room = rooms[roomCode];
        const bt = room?.blindtest;
        if (!room || !bt || room.host !== socket.id || bt.phase !== 'reveal') return;
        btNextRound(room, roomCode);
    });

    socket.on('chat_message', ({ roomCode, message }) => {
        const room = rooms[roomCode];
        if (!room) return;

        const player = room.players.find(p => p.id === socket.id);
        if (!player) return; // seuls les joueurs du salon peuvent écrire

        const clean = String(message || '').trim().slice(0, 300);
        if (!clean) return;

        io.to(roomCode).emit('chat_message', {
            authorId: socket.id,
            author: player.name,
            message: clean,
            at: Date.now()
        });
    });

    socket.on('submit_clue', ({ roomCode, clue }) => {
        const room = rooms[roomCode];
        if (!room) return;

        const currentPlayer = room.players[room.currentTurnIndex];
        if (currentPlayer && currentPlayer.id === socket.id) {
            currentPlayer.clue = clue;

            let nextIndex = room.currentTurnIndex + 1;
            while (nextIndex < room.players.length && !room.players[nextIndex].isAlive) {
                nextIndex++;
            }

            if (nextIndex < room.players.length) {
                room.currentTurnIndex = nextIndex;
                io.to(roomCode).emit('update_gameplay', room);
            } else {
                room.status = 'end_clues';
                if (room.mode === 'undercover') {
                    io.to(roomCode).emit('prompt_end_clue_options_undercover', room);
                } else {
                    io.to(roomCode).emit('prompt_end_clue_options', room);
                }
            }
        }
    });

    socket.on('restart_clues_undercover', ({ roomCode }) => {
        const room = rooms[roomCode];
        if (!room) return;
        
        room.players.forEach(p => p.clue = '');
        room.currentTurnIndex = 0;
        room.status = 'gameplay';
        io.to(roomCode).emit('resume_gameplay', room);
    });

    socket.on('change_theme_mid_game', ({ roomCode }) => {
        const room = rooms[roomCode];
        if (!room) return;

        room.status = 'choosing_theme';
        room.pendingFreshStart = false; // on change juste le thème, pas les notes/rôles
        const themeMasterId = room.players[Math.floor(Math.random() * room.players.length)].id;
        io.to(roomCode).emit('prompt_theme_choice', { room, themeMasterId });
    });

    socket.on('force_start_voting', ({ roomCode }) => {
        const room = rooms[roomCode];
        if (!room) return;

        room.status = 'voting';
        room.votes = {};
        io.to(roomCode).emit('start_voting', room);
    });

    socket.on('cast_vote', ({ roomCode, targetId }) => {
        const room = rooms[roomCode];
        if (!room) return;

        room.votes[socket.id] = targetId;

        const alivePlayers = room.players.filter(p => p.isAlive);
        if (Object.keys(room.votes).length >= alivePlayers.length) {
            resolveVotes(room, roomCode);
        }
    });

    function resolveVotes(room, roomCode) {
        const voteCounts = {};
        Object.values(room.votes).forEach(target => {
            voteCounts[target] = (voteCounts[target] || 0) + 1;
        });

        let highestVotes = 0;
        let eliminatedTargetId = null;

        for (const [target, count] of Object.entries(voteCounts)) {
            if (count > highestVotes) {
                highestVotes = count;
                eliminatedTargetId = target;
            }
        }

        let eliminatedPlayer = null;
        if (eliminatedTargetId && eliminatedTargetId !== 'no_impostor' && eliminatedTargetId !== 'pass') {
            eliminatedPlayer = room.players.find(p => p.id === eliminatedTargetId);
            if (eliminatedPlayer) {
                eliminatedPlayer.isAlive = false;
            }
        }

        let gameOver = false;
        let winnerMessage = "";
        let impostorsWin = false;
        let noImpostorRoundWin = false;

        if (room.noImpostor && eliminatedTargetId === 'no_impostor') {
            gameOver = true;
            noImpostorRoundWin = true;
            winnerMessage = "🎉 Les innocents ont gagné ! Ils ont deviné qu'il n'y avait aucun imposteur.";
        } else if (room.mode === 'undercover' || room.mode === 'note') {
            const impostorsAlive = room.players.filter(p => p.isAlive && p.isImpostor);
            const civilsAlive = room.players.filter(p => p.isAlive && !p.isImpostor);

            if (impostorsAlive.length === 0) {
                gameOver = true;
                winnerMessage = "🎉 Victoire des Civils ! L'imposteur a été démasqué.";
            } else if (impostorsAlive.length >= civilsAlive.length) {
                gameOver = true;
                impostorsWin = true;
                winnerMessage = "🚨 Victoire de l'Imposteur ! Il est en nombre égal ou supérieur aux civils.";
            }
        }

        if (gameOver && (room.mode === 'undercover' || room.mode === 'note')) {
            applyImpostorModeRanking(room, { impostorsWin, noImpostorRoundWin });
        }

        room.status = 'results';
        io.to(roomCode).emit('show_results', {
            room,
            eliminatedPlayer,
            gameOver,
            winnerMessage
        });
    }

    socket.on('rg_submit_answer', ({ roomCode, answer }) => {
        const room = rooms[roomCode];
        if (!room || !room.rg || room.status !== 'rg_playing') return;
        const poolData = rgPools[roomCode];
        if (!poolData) return;

        const currentPlayer = room.players[room.rg.turnIndex];
        if (!currentPlayer || currentPlayer.id !== socket.id) return;

        const norm = normalizeRG(answer);
        if (!norm) return;

        // Alias + formes/transformation => toujours ramenés au personnage unique.
        const cible = rgCanonicalInput(poolData.universeKey || room.rg.universeKey, answer, poolData.pool);

        const dispo = poolData.pool.filter(name => !poolData.usedNorm.has(normalizeRG(name)));

        // 1) Nom complet exact (ou alias vers un nom complet)
        let match = dispo.find(name => normalizeRG(name) === cible);

        // 2) Prénom ou nom de famille seul, à condition qu'il ne désigne qu'un personnage
        if (!match && !poolData.ambigus.has(cible)) {
            match = dispo.find(name => {
                const parts = normalizeRG(name).split(' ');
                return parts[0] === cible || parts[parts.length - 1] === cible;
            });
        }

        // 3) Tolérance orthographique : accepté seulement si UN SEUL personnage correspond
        if (!match) {
            const proches = [];
            dispo.forEach(name => {
                const n = normalizeRG(name);
                if (distanceRG(n, cible) <= toleranceRG(Math.max(n.length, cible.length))) {
                    proches.push(name);
                    return;
                }
                const parts = n.split(' ');
                [parts[0], parts[parts.length - 1]].forEach(p => {
                    if (!p || poolData.ambigus.has(p)) return;
                    if (distanceRG(p, cible) <= toleranceRG(Math.max(p.length, cible.length))) {
                        if (!proches.includes(name)) proches.push(name);
                    }
                });
            });
            if (proches.length === 1) match = proches[0];
        }

        if (match) {
            const n = normalizeRG(match);
            poolData.usedNorm.add(n);
            room.rg.found.unshift(match);
            room.rg.score++;
            io.to(roomCode).emit('rg_feedback', { ok: true, message: '✓ ' + match });
            rgAdvanceTurn(room);
            io.to(roomCode).emit('rg_state', room);
            startRgTimer(room, roomCode);
            return;
        }

        const alreadyUsed = poolData.pool.some(name => {
            const n = normalizeRG(name);
            if (!poolData.usedNorm.has(n)) return false;
            if (n === cible || n.split(' ').includes(cible)) return true;
            return distanceRG(n, cible) <= toleranceRG(Math.max(n.length, cible.length));
        });

        if (alreadyUsed) {
            socket.emit('rg_feedback', { ok: false, message: "↺ Déjà cité, trouve-en un autre." });
            return;
        }

        rgLoseLife(room, roomCode, `✗ Pas dans l'univers ${room.rg.universeName}.`);
    });

    socket.on('enchere_bid', ({ roomCode, amount }) => {
        const room = rooms[roomCode];
        if (!room || !room.enchere || room.status !== 'enchere_playing') return;
        const e = room.enchere;
        if (e.turnPlayerId !== socket.id) return;
        if (![1, 3, 5, 10].includes(amount)) return;

        const newBid = e.currentBid + amount;
        const budget = e.budgets[socket.id] ?? 0;
        if (newBid > budget) return; // pas les moyens : ignoré

        e.currentBid = newBid;
        e.currentBidderId = socket.id;

        const opponent = room.players.find(p => p.id !== socket.id);
        e.turnPlayerId = opponent ? opponent.id : null;

        io.to(roomCode).emit('enchere_state', room);
        if (opponent) maybeAutoResolveEnchereTurn(room, roomCode);
    });

    socket.on('enchere_pass', ({ roomCode }) => {
        const room = rooms[roomCode];
        if (!room || !room.enchere || room.status !== 'enchere_playing') return;
        const e = room.enchere;
        if (e.turnPlayerId !== socket.id) return;

        resolveEncherePass(room, roomCode, socket.id);
    });

    socket.on('enchereaveugle_bid', ({ roomCode, amount }) => {
        const room = rooms[roomCode];
        if (!room || !room.enchereAveugle || room.status !== 'enchereaveugle_playing') return;
        const ea = room.enchereAveugle;
        if (ea.turnPlayerId !== socket.id) return;
        if (![1, 3, 5, 10].includes(amount)) return;

        const newBid = ea.currentBid + amount;
        const budget = ea.budgets[socket.id] ?? 0;
        if (newBid > budget) return; // pas les moyens : ignoré

        ea.currentBid = newBid;
        ea.currentBidderId = socket.id;

        const opponent = room.players.find(p => p.id !== socket.id);
        ea.turnPlayerId = opponent ? opponent.id : null;

        emitEnchereAveugleState(room, roomCode);
        if (opponent) maybeAutoResolveEnchereAveugleTurn(room, roomCode);
    });

    socket.on('connexion_submit_word', ({ roomCode, word }) => {
        const room = rooms[roomCode];
        if (!room || !room.connexion || room.status !== 'connexion_playing') return;
        const c = room.connexion;

        const clean = String(word || '').trim().slice(0, 40);
        if (!clean) return;
        if (Object.prototype.hasOwnProperty.call(c.words, socket.id)) return; // déjà écrit ce tour

        c.words[socket.id] = clean;

        // Tout le monde a écrit -> révélation
        if (Object.keys(c.words).length >= room.players.length) {
            resolveConnexionRound(room, roomCode);
        } else {
            emitConnexionState(room, roomCode);
        }
    });

    socket.on('enchereaveugle_pass', ({ roomCode }) => {
        const room = rooms[roomCode];
        if (!room || !room.enchereAveugle || room.status !== 'enchereaveugle_playing') return;
        const ea = room.enchereAveugle;
        if (ea.turnPlayerId !== socket.id) return;
        if (ea.currentBid <= 0) return; // minimum 1 mise avant de pouvoir laisser

        resolveEnchereAveuglePass(room, roomCode, socket.id, false);
    });

    socket.on('next_step_game', async (roomCode) => {
        const room = rooms[roomCode];
        if (!room) return;

        if (room.mode === 'dle') {
            if (room.host !== socket.id) return;
            await startDle(room, roomCode);
            return;
        }

        if (room.mode === 'undercover') {
            distributeSecretsAndStart(room, roomCode);
        } else if (room.mode === 'rollandgaros') {
            startRollandGaros(room, roomCode);
        } else if (room.mode === 'enchere') {
            startEnchere(room, roomCode);
        } else if (room.mode === 'enchereaveugle') {
            startEnchereAveugle(room, roomCode);
        } else if (room.mode === 'connexion') {
            startConnexion(room, roomCode);
        } else if (room.mode === 'blindtest') {
            if (room.host !== socket.id) return;
            startBlindTest(room, roomCode);
        } else {
            room.status = 'choosing_theme';
            room.pendingFreshStart = true; // nouvelle manche : nouvelles notes / nouveau rôle
            room.currentTurnIndex = 0;
            room.players.forEach(p => p.clue = '');
            const themeMasterId = room.players[Math.floor(Math.random() * room.players.length)].id;
            io.to(roomCode).emit('prompt_theme_choice', { room, themeMasterId });
        }
    });

    socket.on('back_to_menu', (roomCode) => {
        const room = rooms[roomCode];
        if (room) {
            if (rgTimers[roomCode]) {
                clearInterval(rgTimers[roomCode]);
                delete rgTimers[roomCode];
            }
            delete rgPools[roomCode];
            delete room.rg;
            delete room.enchere;
            delete room.enchereAveugle;
            delete room.connexion;
            delete room.dle;
            delete room.quoteGame;
            delete room.blindtest;
            btClearTimer(roomCode);
            if (quoteTimers[roomCode]) {
                clearTimeout(quoteTimers[roomCode]);
                delete quoteTimers[roomCode];
            }
            room.status = 'waiting';
            room.votes = {};
            room.players.forEach(p => {
                p.isAlive = true;
                p.isImpostor = false;
                p.clue = '';
            });
            io.to(roomCode).emit('update_room', room);
        }
    });

    // Reconnexion après une coupure : on récupère la place gardée et on remappe l'identité
    socket.on('rejoin_room', ({ roomCode }) => {
        const room = rooms[roomCode];
        if (!room) {
            socket.emit('rejoin_failed');
            return;
        }

        // On retrouve le joueur par son compte (ou son pseudo pour les invités)
        const ancien = room.players.find(p => p.disconnected && (
            (socket.user.id && p.userId === socket.user.id) ||
            (!socket.user.id && p.name === socket.user.pseudo)
        ));

        if (!ancien) {
            socket.emit('rejoin_failed');
            return;
        }

        const ancienId = ancien.id;
        if (graceTimers[ancienId]) {
            clearTimeout(graceTimers[ancienId]);
            delete graceTimers[ancienId];
        }

        socket.join(roomCode);
        ancien.id = socket.id;
        delete ancien.disconnected;
        delete ancien.disconnectedAt;
        if (room.host === ancienId) room.host = socket.id;

        // Report de l'ancien identifiant vers le nouveau dans toutes les structures de jeu
        const remap = (obj) => {
            if (obj && Object.prototype.hasOwnProperty.call(obj, ancienId)) {
                obj[socket.id] = obj[ancienId];
                delete obj[ancienId];
            }
        };

        remap(room.votes);
        if (room.enchere) {
            remap(room.enchere.budgets);
            remap(room.enchere.teams);
            if (room.enchere.turnPlayerId === ancienId) room.enchere.turnPlayerId = socket.id;
            if (room.enchere.currentBidderId === ancienId) room.enchere.currentBidderId = socket.id;
            if (Array.isArray(room.enchere.declinedPlayers)) {
                room.enchere.declinedPlayers = room.enchere.declinedPlayers.map(id => id === ancienId ? socket.id : id);
            }
        }
        if (room.enchereAveugle) {
            remap(room.enchereAveugle.budgets);
            remap(room.enchereAveugle.teams);
            if (room.enchereAveugle.turnPlayerId === ancienId) room.enchereAveugle.turnPlayerId = socket.id;
            if (room.enchereAveugle.currentBidderId === ancienId) room.enchereAveugle.currentBidderId = socket.id;
            if (room.enchereAveugle.seerId === ancienId) room.enchereAveugle.seerId = socket.id;
        }
        if (room.connexion) remap(room.connexion.words);
        if (room.blindtest) {
            remap(room.blindtest.scores);
            remap(room.blindtest.answers);
        }

        io.to(roomCode).emit('player_connection_changed', { playerId: socket.id, online: true });

        // On renvoie l'écran correspondant à la phase en cours
        if (room.status === 'waiting') {
            io.to(roomCode).emit('update_room', room);
        } else if (room.status === 'rg_playing') {
            socket.emit('rg_state', room);
        } else if (room.status === 'rg_over') {
            socket.emit('rg_game_over', { room });
        } else if (room.status === 'enchere_playing') {
            socket.emit('enchere_state', room);
        } else if (room.status === 'enchereaveugle_playing') {
            emitEnchereAveugleState(room, roomCode);
        } else if (room.status === 'connexion_playing') {
            emitConnexionState(room, roomCode);
        } else if (room.status === 'bt_playing' || room.status === 'bt_over') {
            emitBlindState(room, roomCode);
        } else if (room.status === 'voting') {
            socket.emit('start_voting', room);
        } else if (room.status === 'choosing_theme') {
            socket.emit('prompt_theme_choice', { room, themeMasterId: room.players[0].id });
        } else {
            socket.emit('resume_gameplay', room);
        }
    });

    socket.on('disconnect', () => {
        console.log(`Utilisateur déconnecté : ${socket.id}`);
        for (const roomCode in rooms) {
            const room = rooms[roomCode];
            const joueur = room.players.find(p => p.id === socket.id);
            if (!joueur) continue; // pas dans ce salon

            // Coupure réseau / mise en veille : on garde sa place pendant un court délai
            // au lieu de le sortir tout de suite, pour qu'il puisse revenir dans SA partie.
            if (room.status !== 'waiting') {
                joueur.disconnected = true;
                joueur.disconnectedAt = Date.now();
                if (graceTimers[socket.id]) clearTimeout(graceTimers[socket.id]);
                graceTimers[socket.id] = setTimeout(() => {
                    try {
                        delete graceTimers[socket.id];
                        const r = rooms[roomCode];
                        if (!r) return;
                        const encoreLa = r.players.find(p => p.id === socket.id);
                        if (!encoreLa || !encoreLa.disconnected) return; // il est revenu
                        retirerJoueurDuSalon(r, roomCode, socket.id);
                    } catch (e) {
                        console.error('[délai de reconnexion]', e);
                    }
                }, RECONNECT_GRACE_MS);
                io.to(roomCode).emit('player_connection_changed', { playerId: socket.id, online: false });
                continue;
            }

            retirerJoueurDuSalon(room, roomCode, socket.id);
        }
    });
});

// Retire définitivement un joueur et fait continuer la partie sans lui.
function retirerJoueurDuSalon(room, roomCode, socketId) {
        {
            if (!room.players.some(p => p.id === socketId)) return;

            const hadTurn = room.rg && room.players[room.rg.turnIndex] && room.players[room.rg.turnIndex].id === socketId;
            const etaitSonTourEnchere = room.enchere && room.enchere.turnPlayerId === socketId;
            const etaitSonTourAveugle = room.enchereAveugle && room.enchereAveugle.turnPlayerId === socketId;

            room.players = room.players.filter(p => p.id !== socketId);

            if (room.players.length === 0) {
                btClearTimer(roomCode);
                if (rgTimers[roomCode]) {
                    clearInterval(rgTimers[roomCode]);
                    delete rgTimers[roomCode];
                }
                delete rgPools[roomCode];
                delete rooms[roomCode];
                return;
            }

            if (room.host === socketId) {
                room.host = room.players[0].id;
            }

            // Salon d'attente : mise à jour normale de la liste des joueurs
            if (room.status === 'waiting' || room.status === 'results' || room.status === 'rg_over'
                || room.status === 'enchere_over' || room.status === 'enchereaveugle_over' || room.status === 'connexion_over'
                || room.status === 'bt_over') {
                io.to(roomCode).emit('update_room', room);
                return;
            }

            // --- Partie en cours : on ne renvoie JAMAIS tout le monde au salon ---

            if (room.rg && room.status === 'rg_playing') {
                if (room.rg.turnIndex >= room.players.length) room.rg.turnIndex = 0;
                const alive = rgAlivePlayers(room);
                if (alive.length <= 1) {
                    rgEndGame(room, roomCode, alive[0] || null);
                } else {
                    if (!room.players[room.rg.turnIndex] || !room.players[room.rg.turnIndex].rgAlive || hadTurn) {
                        rgAdvanceTurn(room);
                    }
                    io.to(roomCode).emit('rg_state', room);
                    if (hadTurn) startRgTimer(room, roomCode);
                }
                return;
            }

            // Enchère / Enchère à l'aveugle : à 2 joueurs, le départ d'un joueur clôt la partie
            if (room.status === 'enchere_playing') {
                if (room.players.length < 2) {
                    endEnchere(room, roomCode);
                } else {
                    if (etaitSonTourEnchere) room.enchere.turnPlayerId = room.players[0].id;
                    io.to(roomCode).emit('enchere_state', room);
                }
                return;
            }

            if (room.status === 'enchereaveugle_playing') {
                if (room.players.length < 2) {
                    endEnchereAveugle(room, roomCode);
                } else {
                    if (etaitSonTourAveugle) room.enchereAveugle.turnPlayerId = room.players[0].id;
                    emitEnchereAveugleState(room, roomCode);
                }
                return;
            }

            if (room.status === 'bt_playing' && room.blindtest) {
                delete room.blindtest.answers[socketId];
                const bt = room.blindtest;
                if (bt.phase === 'playing' && room.players.filter(p => !p.disconnected).every(p => bt.answers[p.id])) {
                    btReveal(room, roomCode);
                } else {
                    emitBlindState(room, roomCode);
                }
                return;
            }

            // Jeu de connexion : le tour peut se débloquer si le partant était le dernier attendu
            if (room.status === 'connexion_playing' && room.connexion) {
                delete room.connexion.words[socketId];
                if (room.players.length >= 2 && Object.keys(room.connexion.words).length >= room.players.length) {
                    resolveConnexionRound(room, roomCode);
                } else {
                    emitConnexionState(room, roomCode);
                }
                return;
            }

            // Undercover / Devine la note : la partie continue sans le joueur parti
            if (room.status === 'voting') {
                delete room.votes[socketId];
                const alivePlayers = room.players.filter(p => p.isAlive);
                if (alivePlayers.length > 0 && Object.keys(room.votes).length >= alivePlayers.length) {
                    resolveVotes(room, roomCode);
                } else {
                    io.to(roomCode).emit('start_voting', room);
                }
                return;
            }

            if (room.status === 'gameplay' || room.status === 'reveal' || room.status === 'end_clues') {
                if (room.currentTurnIndex >= room.players.length) room.currentTurnIndex = 0;
                io.to(roomCode).emit('update_gameplay', room);
                return;
            }

            if (room.status === 'choosing_theme') {
                const themeMasterId = room.players[Math.floor(Math.random() * room.players.length)].id;
                io.to(roomCode).emit('prompt_theme_choice', { room, themeMasterId });
                return;
            }

            io.to(roomCode).emit('update_gameplay', room);
        }
}

const PORT = process.env.PORT || 3000;

// --- Filet de sécurité global ---
// Sans ça, la moindre erreur inattendue dans un handler tue le processus Node :
// Render redémarre, toutes les parties en mémoire sont perdues et TOUS les joueurs
// sont éjectés en même temps. On journalise et on continue de tourner.
process.on('uncaughtException', (err) => {
    console.error('[ERREUR NON RATTRAPÉE] le serveur continue malgré tout :', err);
});

process.on('unhandledRejection', (raison) => {
    console.error('[PROMESSE REJETÉE] le serveur continue malgré tout :', raison);
});
server.listen(PORT, () => {
    startDleProfileEnrichment().catch(err => console.warn('[AnimeDLE] Enrichissement auto impossible :', err.message));
    startDleLiveExpansion().catch(err => console.warn('[AnimeDLE] Expansion massive échouée :', err.message));
    console.log(`Serveur démarré sur le port ${PORT}`);
});