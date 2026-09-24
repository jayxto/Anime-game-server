const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(__dirname));

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
}

initDb()
    .then(() => console.log("Base de données prête (table 'users' OK)."))
    .catch(err => {
        console.error("Erreur d'initialisation de la base de données :", err);
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
    const pool = [...new Set(parseRGList(universe.raw))];

    rgPools[roomCode] = { pool, usedNorm: new Set(), ambigus: buildAmbiguousTokens(pool) };

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

    socket.on('start_game', (roomCode) => {
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
        } else if (room.mode === 'connexion') {
            if (room.players.length < 2) {
                socket.emit('game_error', { message: "Il faut au moins 2 joueurs dans le salon pour lancer le Jeu de connexion." });
                return;
            }
            startConnexion(room, roomCode);
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

    // Chat de salon : purement social, n'impacte aucune mécanique de jeu
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

        // On applique d'abord les alias VF/VO connus
        const cible = ALIAS_RG[norm] || norm;

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

    socket.on('next_step_game', (roomCode) => {
        const room = rooms[roomCode];
        if (!room) return;

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
            room.status = 'waiting';
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
                || room.status === 'enchere_over' || room.status === 'enchereaveugle_over' || room.status === 'connexion_over') {
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
    console.log(`Serveur démarré sur le port ${PORT}`);
});