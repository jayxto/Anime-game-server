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
    ["Kenjaku", "Geto"],
    ["Tengen", "Kakashi"],
    ["Kisame", "Requin"],
    ["Rasen Shuriken", "Rasengan"],
    ["Yuji", "Sukuna"],
    ["Peter Parker", "Miles Morales"],
    ["Inoxtag", "Luffy"],
    ["Kakashi", "Gojo"],
    ["Superman", "All Might"],
    ["Meruem", "Cell"],
    ["Pain", "Nagato"],
    ["Maki", "Toji"],
    ["Aokiji", "Brook"],
    ["Pokeball", "Dragon Ball"],
    ["Madara", "Itachi"],
    ["Ener", "Luxus"],
    ["Kamehameha", "Genkidama"],
    ["Jubidara", "Jubito"],
    ["Muzan", "Imu"],
    ["Amaterasu", "Katon"],
    ["Rinnegan", "Sharingan"],
    ["Hinata (Haikyu)", "Messi"],
    ["Loki", "Kaido"],
    ["Sukuna", "Meguna"],
    ["Obito", "Tobi"],
    ["Denji", "Yuji"],
    ["Gogeta", "Vegeto"],
    ["Sharingan", "Mangekyou"],
    ["Gon enfant", "Gon adulte"],
    ["Escanor", "Cannicule"],
    ["Brigade fantôme", "Akatsuki"],
    ["Netero", "Barbe Blanche"],
    ["Yoriichi", "Tanjiro"],
    ["Yamato", "Hashirama"],
    ["Ace", "Sabo"],
    ["Ban", "Hisoka"],
    ["Pikachu", "Zenitsu"],
    ["Vegeta", "Sasuke"],
    ["Broly", "Hulk"],
    ["Obito", "Kakashi"],
    ["Trunks", "Trunks futur"],
    ["Goten", "Gohan"],
    ["Hisoka", "Orochimaru"],
    ["Naruto", "Minato"],
    ["Goku", "Black Goku"],
    ["Gildarts", "Shanks"],
    ["Clan Kuruta", "Clan Uchiwa"],
    ["Nen", "Chakra"],
    ["Crocodile", "Gaara"],
    ["Hidan", "Ban"]
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

const NARUTO_RAW = `1. Naruto Uzumaki
2. Sakura Haruno
3. Sasuke Uchiwa
4. Saï
5. Kakashi Hatake
6. Yamato
7. Tenzô
8. Shikamaru Nara
9. Ino Yamanaka
10. Chôji Akimichi
11. Asuma Sarutobi
12. Hinata Hyûga
13. Kiba Inuzuka
14. Shino Aburame
15. Kurenaï Yûhi
16. Rock Lee
17. Neji Hyûga
18. Tenten
19. Gaï Maito
20. Konohamaru Sarutobi
21. Moegi
22. Udon
23. Ebisu
24. Hiruzen Sarutobi
25. Homura Mitokado
26. Koharu Utatane
27. Minato Namikaze
28. Obito Uchiwa
29. Rin Nohara
30. Kushina Uzumaki
31. Mito Uzumaki
32. Ashina Uzumaki
33. Hashirama Senju
34. Tobirama Senju
35. Tsunade
36. Jiraya
37. Orochimaru
38. Shizune
39. Dan Katô
40. Nawaki
41. Ayame
42. Teuchi
43. Matsu
44. Nishi
45. Madame Shijimi
46. Genzô
47. Hanabi Hyûga
48. Hiashi Hyûga
49. Hizashi Hyûga
50. Kô Hyûga
51. Hoheto Hyûga
52. Tokuma Hyûga
53. Manabu Akado
54. Tsubaki
55. Daikoku Funeno
56. Hana Inuzuka
57. Iwashi Tatami
58. Izumo Kamizuki
59. Kotetsu Hagane
60. Mozuku
61. Namida Suzume
62. Shimon Hijiri
63. Tonbo Tobitake
64. Tenga
65. Iruka Umino
66. Mizuki Tôji
67. Anko Mitarashi
68. Aoba Yamashiro
69. Genma Shiranui
70. Hayate Gekkô
71. Ibiki Morino
72. Raidô Namiashi
73. Muta Aburame
74. Shibi Aburame
75. Shikuro Aburame
76. Ranka
77. Yûgao Uzuki
78. Komachi
79. Towa
80. Danzô Shimura
81. Torune
82. Fû
83. Shin
84. Hyô
85. Dajimu
86. Teraï
87. Chôza Akimichi
88. Shikaku Nara
89. Yoshino Nara
90. Inoichi Yamanaka
91. Fugaku Uchiwa
92. Mikoto Uchiwa
93. Itachi Uchiwa
94. Shisui Uchiwa
95. Madara Uchiwa
96. Izuna Uchiwa
97. Inabi Uchiwa
98. Yashiro Uchiwa
99. Teyaki Uchiwa
100. Uruchi Uchiwa
101. Kagami Uchiwa
102. Sakumo Hatake
103. Chiriku
104. Sora
105. Kazuma
106. Suzume
107. Tamaki
108. Nekobaa
109. Ami
110. Akamaru
111. Byakuren
112. Gengetsu Hôzuki
113. Yagura
114. Meï Terumi
115. Chôjûrô
116. Tsuguri
117. Harusame
118. Ao
119. Chûkichi
120. Gôzu
121. Meizu
122. Haku
123. Zabuza Momochi
124. Kisame Hoshigaki
125. Suigetsu Hôzuki
126. Mangetsu Hôzuki
127. Utakata
128. Raïga Kurosuki
129. Ranmaru
130. Ameyuri Ringo
131. Jinin Akebino
132. Jinpachi Munashi
133. Kushimaru Kuriarare
134. Fuguki Suikazan
135. A
136. Darui
137. Samui
138. Omoï
139. Karui
140. J
141. C
142. Atsui
143. Dodaï
144. Motoi
145. Killer Bee
146. Yugito Nii
147. Mabui
148. Kinkaku
149. Ginkaku
150. Agari
151. Ageha
152. Gatô
153. Giichi
154. Inari
155. Kaiza
156. Kaji
157. Tazuna
158. Tsunami
159. Waraji
160. Zôri
161. Dosu Kinuta
162. Kin Tsuchi
163. Zaku Abumi
164. Misumi Tsurugi
165. Yoroï Akadô
166. Jirôbô
167. Kidômaru
168. Sakon
169. Ukon
170. Tayuya
171. Kimimaro Kaguya
172. Kabuto Yakushi
173. Karin
174. Jûgo
175. Sasame Fûma
176. Arashi Fûma
177. Kagerô Fûma
178. Kotohime
179. Hanzaki
180. Jigumo
181. Kamikiri
182. Guren
183. Yûkimaru
184. Rinji
185. Kihô
186. Kigiri
187. Nurari
188. Shiin
189. Menma
190. Gaara
191. Temari
192. Kankurô
193. Chiyo
194. Ebizô
195. Bunpuku
196. Mukade
197. Sasori
198. Yûra
199. Ittetsu
200. Sari
201. Saya
202. Mamushi
203. Sana
204. Matsuri
205. Yukata
206. Yashamaru
207. Reto
208. Shamon
209. Rasa
210. Karura
211. Shira
212. Yome
213. Sen
214. Mikoshi
215. Baki
216. Pakura
217. Maki
218. Monzaemon Chikamatsu
219. Ishikawa
220. Mû
221. Onoki
222. Kurotsuchi
223. Akatsuchi
224. Gari
225. Ittan
226. Kakkou
227. Kitsuchi
228. Mahiru
229. Shibito Azuma
230. Sumashi
231. Taiseki
232. Deidara
233. Rôshi
234. Han
235. Jibachi Kamizuru
236. Kurobachi Kamizuru
237. Suzumebachi Kamizuru
238. Hanzô
239. Pain
240. Tendô
241. Shurado
242. Ningendo
243. Chikushôdô
244. Gakidô
245. Jigokudô
246. Konan
247. Nagato Uzumaki
248. Yahiko
249. Baïu
250. Kagari
251. Midare
252. Mubi
253. Oboro
254. Shigure
255. Ajisaï
256. Aoi Rokushô
257. Fukusuke Hiashira
258. Idate Morino
259. Jirocho
260. Kandachi
261. Kanpachi
262. Karashi
263. Kirisame
264. Murasame
265. Shiore
266. Kakuzu
267. Hidan
268. Suika
269. Fuu
270. Kogen
271. Yoro
272. Shibuki
273. Suien
274. Sandayuu Azama
275. Fubuki Kakuyoku
276. Mizore Fuyukuma
277. Nadare Rôga
278. Dotô Kazahana
279. Sôtetsu Kazahana
280. Koyuki Kazahana
281. Seimei
282. Hôki
283. Kujaku
284. Ryûgan
285. Suiko
286. Akahoshi
287. Hokuto
288. Mizura
289. Sumaru
290. Hotarubi
291. Natsuhi
292. Shisou
293. Yotaka
294. Mifune
295. Okisuke
296. Urakaku
297. Tatewaki
298. Gennô
299. Hanare
300. Gantetsu
301. Shura
302. Monju
303. Todoroki
304. Akio
305. Amachi
306. Isaribi
307. Umibôzu
308. Haruna
309. Gengo
310. Komori
311. Minoichi
312. Shinnô
313. Amaru
314. Princesse Fuku
315. Tsukino
316. Tenji
317. Hotaru
318. En no Gyôja
319. Shiranami
320. Akaboshi
321. Benten
322. Chûshin
323. Nangô
324. Yurinojô
325. Kikunojô
326. Zetsu
327. Zetsu Noir
328. Zetsu Blanc
329. Tobi
330. Guruguru
331. Shin Uchiwa
332. Toneri Ôtsutsuki
333. Momoshiki Ôtsutsuki
334. Kinshiki Ôtsutsuki
335. Urashiki Ôtsutsuki
336. Kaguya Ôtsutsuki
337. Isshiki Ôtsutsuki
338. Indra Ôtsutsuki
339. Hamura Ôtsutsuki
340. Hagoromo Ôtsutsuki
341. Ashura Ôtsutsuki
342. Shibai Ôtsutsuki
343. Shukaku
344. Matatabi
345. Isobu
346. Son Gokû
347. Kokuô
348. Saiken
349. Chômei
350. Gyûki
351. Kurama
352. Jûbi
353. Akino
354. Biscuit
355. Bull
356. Denka
357. Doki
358. Enma
359. Fukasaku
360. Gama
361. Gamabunta
362. Gamahiro
363. Gamaken
364. Gamakichi
365. Gamariki
366. Gamatabi
367. Gamatatsu
368. Gerotora
369. Gulko
370. Hina
371. Kamatari
372. Katsuyu
373. Kôsuke Maruboshi
374. Kyodaigumo
375. Kyodaija
376. Manda
377. Ningame
378. Oogama Sennin
379. Pakkun
380. Shiba
381. Shima
382. U-hei
383. Ulshi
384. Aoda
385. Garaga
386. Ibuse
387. Tonton
388. Fûjin
389. Raijin
390. Fûka
391. Fudo
392. Fuen
393. Fugai
394. Haido
395. Ranke
396. Watari Nagare
397. Yakumo Kurama
398. Boruto Uzumaki
399. Sarada Uchiwa
400. Himawari Uzumaki
401. Mitsuki
402. Kawaki
403. Shikadai Nara
404. Inojin Yamanaka
405. Chôchô Akimichi
406. Metal Lee
407. Iwabee Yuino
408. Denki Kaminarimon
409. Sumire Kakei
410. Wasabi Izuno
411. Namida Suzumeno
412. Mirai Sarutobi
413. Katasuke Tôno
414. Delta
415. Boro
416. Jigen
417. Amado
418. Code
419. Eida
420. Daemon
421. Koji Kashin
422. Victor
423. Deepa
424. Mugino
425. Nue
426. Urashiki
427. Tsubaki Kurogane
428. Houki Taketori
429. Enko Onikuma
430. Doshu Goetsu
431. Hako Kuroi`;

const ONEPIECE_RAW = `1. Monkey D. Luffy
2. Roronoa Zoro
3. Nami
4. Usopp
5. Sanji
6. Tony Tony Chopper
7. Nico Robin
8. Franky
9. Brook
10. Jinbe
11. Gol D. Roger
12. Silvers Rayleigh
13. Scopper Gaban
14. Crocus
15. Shanks
16. Benn Beckman
17. Lucky Roux
18. Yasopp
19. Rockstar
20. Uta
21. Gordon
22. Edward Newgate
23. Marco
24. Portgas D. Ace
25. Jozu
26. Thatch
27. Vista
28. Blamenco
29. Rakuyo
30. Namur
31. Blenheim
32. Curiel
33. Kingdew
34. Haruta
35. Atmos
36. Speed Jill
37. Fossa
38. Izo
39. Doma
40. Squardo
41. Whitey Bay
42. McGuy
43. Little Oars Jr.
44. Edward Weevil
45. Bakkin
46. Marshall D. Teach
47. Jesus Burgess
48. Shiryu
49. Van Augur
50. Avalo Pizarro
51. Catarina Devon
52. Sanjuan Wolf
53. Vasco Shot
54. Doc Q
55. Stronger
56. Lafitte
57. Kuzan
58. Charlotte Linlin
59. Charlotte Katakuri
60. Charlotte Smoothie
61. Charlotte Cracker
62. Charlotte Perospero
63. Charlotte Oven
64. Charlotte Daifuku
65. Charlotte Compote
66. Charlotte Mont-d'Or
67. Charlotte Brûlée
68. Charlotte Galette
69. Charlotte Flampe
70. Charlotte Pudding
71. Charlotte Chiffon
72. Charlotte Lola
73. Charlotte Praline
74. Charlotte Amande
75. Charlotte Opera
76. Charlotte Mascarpone
77. Charlotte Joscarpone
78. Charlotte Anana
79. Charlotte Dolce
80. Charlotte Dragée
81. Charlotte Nusstorte
82. Charlotte Moscato
83. Charlotte Snack
84. Pekoms
85. Tamago
86. Streusen
87. Bobbin
88. Prométhée
89. Napoléon
90. Zeus
91. Héra
92. Kaido
93. King
94. Queen
95. Jack
96. Who's-Who
97. Sasaki
98. Black Maria
99. Ulti
100. Page One
101. X Drake
102. Yamato
103. Basil Hawkins
104. Scratchmen Apoo
105. Holdem
106. Speed
107. Babanuki
108. Daifugo
109. Dobon
110. Solitaire
111. Bao Huang
112. Ginrummy
113. Batman
114. Gazelleman
115. Mouseman
116. Snakeman
117. Rabbitman
118. Alpacaman
119. Sarahebi
120. Sheepshead
121. Kurozumi Orochi
122. Kurozumi Higurashi
123. Fukurokuju
124. Hanzo
125. Sarutobi
126. Daikoku
127. Raizo
128. Kin'emon
129. Denjiro
130. Kikunojo
131. Kawamatsu
132. Ashura Doji
133. Inuarashi
134. Nekomamushi
135. Shinobu
136. Kozuki Oden
137. Kozuki Toki
138. Kozuki Momonosuke
139. Kozuki Hiyori
140. Kozuki Sukiyaki
141. Shimotsuki Yasuie
142. Hyogoro
143. Tenguyama Hitetsu
144. O-Tama
145. Toko
146. Komurasaki
147. Onimaru
148. Komachiyo
149. Carrot
150. Wanda
151. Pedro
152. Miyagi
153. Tristan
154. Sicilian
155. Blackback
156. Roddy
157. Bariete
158. Sakazuki
159. Borsalino
160. Issho
161. Aramaki
162. Sengoku
163. Tsuru
164. Kong
165. Monkey D. Garp
166. Momonga
167. Onigumo
168. Doberman
169. Dalmatian
170. Strawberry
171. Bastille
172. Maynard
173. Smoker
174. Tashigi
175. Hina
176. Koby
177. Helmeppo
178. Sentomaru
179. Brannew
180. Vergo
181. Fullbody
182. Django
183. T-Bone
184. Nezumi
185. Morgan
186. Jonathan
187. Drake
188. Monkey D. Dragon
189. Sabo
190. Emporio Ivankov
191. Inazuma
192. Bartholomew Kuma
193. Belo Betty
194. Morley
195. Karasu
196. Lindbergh
197. Koala
198. Hack
199. Ginny
200. Nefertari Vivi
201. Nefertari Cobra
202. Igaram
203. Pell
204. Chaka
205. Karoo
206. Toto
207. Koza
208. Terracotta
209. Crocodile
210. Nico Olvia
211. Daz Bones
212. Bentham
213. Galdino
214. Miss Doublefinger
215. Miss Goldenweek
216. Miss Merry Christmas
217. Miss Valentine
218. Miss Monday
219. Mr. 4
220. Mr. 5
221. Mr. 7
222. Mr. 9
223. Mr. 13
224. Miss Friday
225. Rob Lucci
226. Kaku
227. Blueno
228. Jabra
229. Kumadori
230. Fukurou
231. Kalifa
232. Spandam
233. Spandine
234. Nero
235. Stussy
236. Who's Who
237. Iceburg
238. Paulie
239. Tilestone
240. Lulu
241. Tom
242. Kokoro
243. Chimney
244. Gonbe
245. Yokozuna
246. Arlong
247. Hatchan
248. Kuroobi
249. Chew
250. Fisher Tiger
251. Aladine
252. Macro
253. Gyaro
254. Tansui
255. Neptune
256. Fukaboshi
257. Ryuboshi
258. Manboshi
259. Shirahoshi
260. Otohime
261. Hody Jones
262. Vander Decken IX
263. Wadatsumi
264. Hammond
265. Dosun
266. Ikaros Much
267. Daruma
268. Zeo
269. Hyouzou
270. Den
271. Camie
272. Pappag
273. Duval
274. Enel
275. Gan Fall
276. Conis
277. Pagaya
278. Wyper
279. Aisa
280. Raki
281. Laki
282. Ohm
283. Shura
284. Satori
285. Gedatsu
286. Hotori
287. Kotori
288. Yama
289. McKinley
290. Mont Blanc Cricket
291. Mont Blanc Noland
292. Calgara
293. Masira
294. Shoujou
295. Bellamy
296. Sarquiss
297. Donquixote Doflamingo
298. Donquixote Rosinante
299. Trebol
300. Diamante
301. Pica
302. Lao G
303. Senor Pink
304. Gladius
305. Sugar
306. Machvise
307. Dellinger
308. Buffalo
309. Baby 5
310. Monet
311. Caesar Clown
312. Jora
313. Giolla
314. Rebecca
315. Kyros
316. Riku Doldo III
317. Viola
318. Scarlett
319. Tank Lepanto
320. Dagama
321. Elizabello II
322. Cavendish
323. Bartolomeo
324. Gambia
325. Sai
326. Don Chinjao
327. Boo
328. Leo
329. Ideo
330. Hajrudin
331. Orlumbus
332. Blue Gilly
333. Abdullah
334. Jeet
335. Suleiman
336. Trafalgar D. Water Law
337. Bepo
338. Penguin
339. Shachi
340. Jean Bart
341. Eustass Kid
342. Killer
343. Heat
344. Wire
345. Urouge
346. Jewelry Bonney
347. Capone Bege
348. Vito
349. Gotti
350. Gecko Moria
351. Perona
352. Absalom
353. Hogback
354. Ryuma
355. Oars
356. Cindry
357. Hildon
358. Tararan
359. Kumashi
360. Dracule Mihawk
361. Boa Hancock
362. Boa Sandersonia
363. Boa Marigold
364. Gloriosa
365. Marguerite
366. Aphelandra
367. Sweet Pea
368. Magellan
369. Hannyabal
370. Domino
371. Saldeath
372. Sadi
373. Shiliew
374. Buggy
375. Alvida
376. Mohji
377. Cabaji
378. Richie
379. Don Krieg
380. Gin
381. Pearl
382. Zeff
383. Patty
384. Carne
385. Kuro
386. Sham
387. Buchi
388. Kaya
389. Merry
390. Johnny
391. Yosaku
392. Genzo
393. Nojiko
394. Bell-mère
395. Dr. Kureha
396. Dr. Hiriluk
397. Wapol
398. Chess
399. Kuromarimo
400. Dalton
401. Foxy
402. Porche
403. Hamburg
404. Itomimizu
405. Laboon
406. Dorry
407. Broggy
408. Oimo
409. Kashii
410. Imu
411. Jaygarcia Saturn
412. Marcus Mars
413. Topman Warcury
414. Ethanbaron V. Nusjuro
415. Shepherd Ju Peter
416. Charlos
417. Rosward
418. Shalria
419. Mjosgard
420. Donquixote Homing
421. Vegapunk
422. Shaka
423. Lilith
424. Edison
425. Pythagoras
426. Atlas
427. York
428. S-Bear
429. S-Hawk
430. S-Snake
431. S-Shark
432. S-Flamingo
433. S-Bat
434. Rocks D. Xebec
435. Shiki
436. John
437. Ochoku
438. Silver Axe
439. Indigo
440. Douglas Bullet
441. Tesoro
442. Carina
443. Baccarat
444. Zephyr
445. Ain
446. Binz
447. Gasparde
448. Saga
449. Vinsmoke Judge
450. Vinsmoke Reiju
451. Vinsmoke Ichiji
452. Vinsmoke Niji
453. Vinsmoke Yonji
454. Caribou
455. Coribou
456. Demaro Black
457. Jaguar D. Saul
458. Kuina
459. Koushirou
460. Dracule Perona
461. Rayleigh Shakky
462. Shakuyaku
463. Disco
464. Roshio
465. Bonney
466. Gaban`;

const BLEACH_RAW = `1. Ichigo Kurosaki
2. Rukia Kuchiki
3. Orihime Inoue
4. Uryu Ishida
5. Yasutora Sado
6. Kon
7. Isshin Kurosaki
8. Masaki Kurosaki
9. Karin Kurosaki
10. Yuzu Kurosaki
11. Tatsuki Arisawa
12. Keigo Asano
13. Mizuiro Kojima
14. Chizuru Honsho
15. Michiru Ogawa
16. Ryo Kunieda
17. Mahana Natsui
18. Don Kanonji
19. Ikumi Unagiya
20. Kisuke Urahara
21. Yoruichi Shihoin
22. Tessai Tsukabishi
23. Jinta Hanakari
24. Ururu Tsumugiya
25. Ryuken Ishida
26. Soken Ishida
27. Kanae Katagiri
28. Genryusai Shigekuni Yamamoto
29. Chojiro Sasakibe
30. Soi Fon
31. Marechiyo Omaeda
32. Rose Otoribashi
33. Izuru Kira
34. Retsu Unohana
35. Isane Kotetsu
36. Kiyone Kotetsu
37. Shinji Hirako
38. Momo Hinamori
39. Byakuya Kuchiki
40. Renji Abarai
41. Sajin Komamura
42. Tetsuzaemon Iba
43. Shunsui Kyoraku
44. Nanao Ise
45. Genshiro Okikiba
46. Kensei Muguruma
47. Mashiro Kuna
48. Shuhei Hisagi
49. Toshiro Hitsugaya
50. Rangiku Matsumoto
51. Kenpachi Zaraki
52. Yachiru Kusajishi
53. Ikkaku Madarame
54. Yumichika Ayasegawa
55. Mayuri Kurotsuchi
56. Nemu Kurotsuchi
57. Akon
58. Hiyosu
59. Rin Tsubokura
60. Jushiro Ukitake
61. Sentaro Kotsubaki
62. Hanataro Yamada
63. Seinosuke Yamada
64. Love Aikawa
65. Lisa Yadomaru
66. Hachigen Ushoda
67. Hiyori Sarugaki
68. Jidanbo Ikkanzaka
69. Kaien Shiba
70. Miyako Shiba
71. Kukaku Shiba
72. Ganju Shiba
73. Ginrei Kuchiki
74. Sojun Kuchiki
75. Hisana Kuchiki
76. Rukongai Rukia
77. Yachiru Unohana
78. Kirio Hikifune
79. Ichibe Hyosube
80. Oetsu Nimaiya
81. Tenjiro Kirinji
82. Senjumaru Shutara
83. Sosuke Aizen
84. Gin Ichimaru
85. Kaname Tosen
86. Wonderweiss Margela
87. Coyote Starrk
88. Lilynette Gingerbuck
89. Baraggan Louisenbairn
90. Tier Harribel
91. Ulquiorra Cifer
92. Nnoitra Gilga
93. Grimmjow Jaegerjaquez
94. Zommari Rureaux
95. Szayelaporro Granz
96. Aaroniero Arruruerie
97. Yammy Llargo
98. Luppi Antenor
99. Nelliel Tu Odelschwanck
100. Dordoni Alessandro Del Socaccio
101. Cirucci Sanderwicci
102. Gantenbainne Mosqueda
103. Pesche Guatiche
104. Dondochakka Bilstin
105. Bawabawa
106. Rudbornn Chelute
107. Emilou Apacci
108. Franceska Mila Rose
109. Cyan Sung-Sun
110. Tesla Lindocruz
111. Shawlong Koufang
112. Edrad Liones
113. Yylfordt Granz
114. Nakeem Grindina
115. Di Roy Rinker
116. Charlotte Chuhlhourne
117. Findorr Calius
118. Ggio Vega
119. Choe Neng Poww
120. Nirgge Parduoc
121. Abirama Redder
122. Poww
123. Menis
124. Ashido Kano
125. Sora Inoue
126. Grand Fisher
127. Shrieker
128. Fishbone D
129. Acidwire
130. Hexapodus
131. Numb Chandelier
132. White
133. Zangetsu
134. Tensa Zangetsu
135. Yhwach
136. Jugram Haschwalth
137. Bazz-B
138. As Nodt
139. Bambietta Basterbine
140. Candice Catnipp
141. Meninas McAllon
142. Liltotto Lamperd
143. Giselle Gewelle
144. Gremmy Thoumeaux
145. Lille Barro
146. Gerard Valkyrie
147. Pernida Parnkgjas
148. Askin Nakk Le Vaar
149. Mask De Masculine
150. James
151. Quilge Opie
152. Driscoll Berci
153. Cang Du
154. BG9
155. Robert Accutrone
156. Nianzol Weizol
157. Pepe Waccabrada
158. NaNaNa Najahkoop
159. Guenael Lee
160. Loyd Lloyd
161. Royd Lloyd
162. Jerome Guizbatt
163. Berenice Gabrielli
164. Shaz Domino
165. Asguiaro Ebern
166. Uryu Quincy
167. Soul King
168. Mimihagi
169. Kugo Ginjo
170. Shukuro Tsukishima
171. Riruka Dokugamine
172. Yukio Hans Vorarlberna
173. Jackie Tristan
174. Giriko Kutsuzawa
175. Moe Shishigawara
176. Aura Michibane
177. Tokinada Tsunayashiro
178. Hikone Ubuginu
179. Makoto Kibune
180. Koga Kuchiki
181. Muramasa
182. Senna
183. Homura
184. Shizuku
185. Sojiro Kusaka
186. Kokuto
187. Shuren
188. Garogai
189. Gunjo
190. Taikon
191. Nozomi Kujo
192. Kageroza Inaba
193. Ouko Yushima
194. Shusuke Amagai
195. Kumoi
196. Ryusei Kenzaki
197. Rurichiyo Kasumioji
198. Enryu
199. Kenryu
200. Hanza Nukui
201. Baishin
202. Riyan
203. Jinnai Doko
204. Ganryu
205. Bonnie
206. Nanao
207. Tsukishima
208. Hisagi
209. Hachi
210. Kaien
211. Kensei`;

const SDS_RAW = `1. Meliodas
2. Elizabeth Liones
3. Hawk
4. Diane
5. Ban
6. King
7. Gowther
8. Merlin
9. Escanor
10. Elaine
11. Zeldris
12. Estarossa
13. Mael
14. Gelda
15. Ludociel
16. Sariel
17. Tarmiel
18. Derieri
19. Monspeet
20. Drole
21. Gloxinia
22. Fraudrin
23. Grayroad
24. Galand
25. Melascula
26. Chandler
27. Cusack
28. Demon King
29. Supreme Deity
30. Arthur Pendragon
31. Gilthunder
32. Howzer
33. Griamore
34. Hendrickson
35. Dreyfus
36. Helbram
37. Jericho
38. Guila
39. Zeal
40. Veronica Liones
41. Margaret Liones
42. Bartra Liones
43. Denzel Liones
44. Deathpierce
45. Dogedo
46. Waillo
47. Slader
48. Simon
49. Gustaf
50. Vivian
51. Cain Barzad
52. Twigo
53. Golgius
54. Ruin
55. Friesia
56. Jude
57. Dale
58. Matrona
59. Zaratras
60. Nadja Liones
61. Cath Palug
62. Oslo
63. Orlondi
64. Zhivago
65. Mod
66. Donny
67. Pelliot
68. Arden
69. Deldry
70. Bellion
71. Liz
72. Dana
73. Dolor
74. Gerheade
75. Rou
76. Dahlia
77. Dubs
78. Nanashi
79. Wild
80. The Sinner
81. Tristan Liones
82. Lancelot
83. Percival
84. Nasiens
85. Anne
86. Isolde
87. Chion
88. Jade
89. Varghese
90. Ironside
91. Pellegarde
92. Talisker
93. Macduff
94. Guinevere
95. Kay
96. Teaninich
97. Ordo
98. Mortlach
99. Jenny
100. Gawain
101. Sin
102. Doronach
103. Burgie
104. Weinheidt
105. Hauser
106. Marmas
107. Aldrich
108. Fiddich
109. Edlin
110. Sennett
111. Threader
112. Lyonesse
113. Rosa
114. Elizabeth's mother
115. Caulifla
116. Zoria
117. Nerobasta
118. Denzel
119. Dahaka
120. Ren
121. Gannon
122. Baltra
123. Gerharde
124. Elaine's brother
125. Hendrickson's father
126. Hugo
127. Jenna
128. Zaneri
129. Old Fart
130. Aranak
131. Gara
132. Galla
133. Atra
134. Pelio
135. Mild
136. Selion
137. Solaad
138. Ellatte
139. Dalmally
140. Ban's father
141. Zhivago's son
142. Pelliot's father
143. Tarmiel's brother
144. Cusack's apprentice
145. Sariel's follower
146. Fraudrin's host
147. Grayroad's larvae
148. Galand's petrification
149. Melascula's soul
150. Escanor's brother
151. Daz
152. Bartra's daughter
153. Veronica's guard
154. Guila's brother
155. Griamore's father
156. Howzer's niece
157. Elizabeth reincarnation
158. Meliodas young
159. Diane young
160. King young
161. Ban young
162. Elaine young
163. Jericho young
164. Gowther doll
165. Merlin's father
166. Arthur's sword
167. Chaos
168. Chaos Arthur
169. Lady of the Lake
170. Percival's grandfather
171. Percival's mother
172. Lancelot's mother
173. Camelot Knight
174. Vivian's master
175. Zaratras' brother`;

const MHA_RAW = `1. Izuku Midoriya
2. Katsuki Bakugo
3. Shoto Todoroki
4. Ochaco Uraraka
5. Tenya Iida
6. Momo Yaoyorozu
7. Eijiro Kirishima
8. Denki Kaminari
9. Tsuyu Asui
10. Fumikage Tokoyami
11. Mina Ashido
12. Minoru Mineta
13. Kyoka Jiro
14. Yuga Aoyama
15. Mezo Shoji
16. Mashirao Ojiro
17. Rikido Sato
18. Koji Koda
19. Toru Hagakure
20. Hanta Sero
21. Neito Monoma
22. Itsuka Kendo
23. Tetsutetsu Tetsutetsu
24. Juzo Honenuki
25. Setsuna Tokage
26. Ibara Shiozaki
27. Yosetsu Awase
28. Sen Kaibara
29. Pony Tsunotori
30. Manga Fukidashi
31. Kosei Tsuburaba
32. Jurota Shishida
33. Nirengeki Shoda
34. Reiko Yanagi
35. Hiryu Rin
36. Kojiro Bondo
37. Togaru Kamakiri
38. Kinoko Komori
39. Shihai Kuroiro
40. Yui Kodai
41. Kinoko
42. Shota Aizawa
43. All Might
44. Present Mic
45. Midnight
46. Cementoss
47. Ectoplasm
48. Snipe
49. Thirteen
50. Power Loader
51. Hound Dog
52. Recovery Girl
53. Nezu
54. Vlad King
55. Gran Torino
56. Sir Nighteye
57. Mirio Togata
58. Tamaki Amajiki
59. Nejire Hado
60. Fat Gum
61. Ryukyu
62. Mt. Lady
63. Kamui Woods
64. Edgeshot
65. Best Jeanist
66. Hawks
67. Endeavor
68. Mirko
69. Crust
70. Wash
71. Yoroi Musha
72. Gang Orca
73. Pixie-Bob
74. Tiger
75. Mandalay
76. Ragdoll
77. Ms. Joke
78. Inasa Yoarashi
79. Camie Utsushimi
80. Seiji Shishikura
81. Yo Shindo
82. Tatami Nakagame
83. Nagamasa Mora
84. Shikkui Makabe
85. Itejiro Toteki
86. Mei Hatsume
87. Melissa Shield
88. David Shield
89. Eri
90. Kota Izumi
91. Inko Midoriya
92. Hisashi Midoriya
93. Mitsuki Bakugo
94. Masaru Bakugo
95. Rei Todoroki
96. Fuyumi Todoroki
97. Natsuo Todoroki
98. Toya Todoroki
99. Keigo Takami
100. Nana Shimura
101. Kotaro Shimura
102. Nao Shimura
103. Hana Shimura
104. Tenko Shimura
105. Yoichi Shigaraki
106. All For One
107. Tomura Shigaraki
108. Kurogiri
109. Dabi
110. Himiko Toga
111. Twice
112. Mr. Compress
113. Spinner
114. Magne
115. Mustard
116. Moonfish
117. Muscular
118. Nomu
119. Gigantomachia
120. Kyudai Garaki
121. Giran
122. Re-Destro
123. Geten
124. Trumpet
125. Curious
126. Skeptic
127. Chitose Kizuki
128. Stain
129. Lady Nagant
130. Overhaul
131. Chronostasis
132. Mimic
133. Kendo Rappa
134. Hekiji Tengai
135. Shin Nemoto
136. Deidoro Sakaki
137. Toya Setsuno
138. Yu Hojo
139. Soramitsu Tabe
140. Katsukame
141. Nine
142. Slice
143. Chimera
144. Mummy
145. Flect Turn
146. Beros
147. Serpenters
148. Wolfram
149. Rody Soul
150. Pino
151. Anna Scervino
152. Gentle Criminal
153. La Brava
154. Star and Stripe
155. Burnin
156. Kido
157. Onima
158. Tsukuyomi
159. Moe Kamiji
160. Selkie
161. Sirius
162. Uwabami
163. Death Arms
164. Gunhead
165. Fourth Kind
166. Manual
167. Rock Lock
168. Centipeder
169. Bubble Girl
170. Native
171. Slidin' Go
172. Majestic
173. X-Less
174. Backdraft
175. Snatch
176. Air Jet
177. Kesagiriman
178. Shishido
179. Bee Hero
180. Shindo
181. Nighteye's agency
182. Enji Todoroki
183. Kai Chisaki
184. Ending
185. Tomoyasu Chikazoku
186. Yotsubashi Rikiya
187. Koku Hanabata
188. Hanabata
189. Sanctum
190. Dictator
191. Innsmouth
192. Bombast
193. Setsuno
194. Hojo
195. Tabe
196. Kuin Hachisuka
197. Johnny
198. Larceny
199. Ujiko
200. Tartarus Warden
201. Present Mic's agency
202. Tsukauchi Naomasa
203. Sansa Tamakawa
204. Nedzu
205. Aoyama's parents
206. Yaoyorozu's butler
207. Shinso Hitoshi
208. Nirengeki
209. Kamakiri
210. Bondo
211. Shiozaki
212. Rin
213. Kodai
214. Awase
215. Kaibara
216. Tsunotori
217. Fukidashi
218. Tsuburaba
219. Shishida
220. Yanagi
221. Komori
222. Kuroiro
223. Honenuki
224. Tokage
225. Tetsutetsu
226. Kendo
227. Monoma`;

const FAIRY_RAW = `1. Natsu Dragneel
2. Lucy Heartfilia
3. Gray Fullbuster
4. Erza Scarlet
5. Wendy Marvell
6. Happy
7. Carla
8. Panther Lily
9. Gajeel Redfox
10. Juvia Lockser
11. Mirajane Strauss
12. Elfman Strauss
13. Lisanna Strauss
14. Laxus Dreyar
15. Makarov Dreyar
16. Cana Alberona
17. Levy McGarden
18. Jet
19. Droy
20. Freed Justine
21. Bickslow
22. Evergreen
23. Alzack Connell
24. Bisca Connell
25. Asuka Connell
26. Romeo Conbolt
27. Macao Conbolt
28. Wakaba Mine
29. Max Alors
30. Warren Rocko
31. Nab Lasaro
32. Reedus Jonah
33. Laki Olietta
34. Kinana
35. Vijeeter Ecor
36. Mirajane
37. Loke
38. Mystogan
39. Mest Gryder
40. Gildarts Clive
41. Porlyusica
42. First Master Mavis Vermillion
43. Precht Gaebolg
44. Yuri Dreyar
45. Warrod Sequen
46. Zeref Dragneel
47. Acnologia
48. Igneel
49. Grandeeney
50. Metalicana
51. Weisslogia
52. Skiadrum
53. Atlas Flame
54. Motherglare
55. Zirconis
56. Belserion
57. Irene Belserion
58. August
59. Larcade Dragneel
60. God Serena
61. Bloodman
62. Dimaria Yesta
63. Brandish Mu
64. Invel Yura
65. Ajeel Raml
66. Neinhart
67. Wahl Icht
68. Jacob Lessio
69. Elefseria
70. Mercphobia
71. Ignia
72. Selene
73. Aldoron
74. Viernes
75. Dogramag
76. Georg Reizen
77. Duke Barbaroa
78. Athena
79. Faris
80. Brain
81. Cobra
82. Midnight
83. Angel
84. Racer
85. Hoteye
86. Zero
87. Imitatia
88. Jellal Fernandes
89. Ultear Milkovich
90. Meredy
91. Simon
92. Wally Buchanan
93. Millianna
94. Sho
95. Erigor
96. Kageyama
97. Aria
98. Vidaldus Taka
99. Ikaruga
100. Kain Hikaru
101. Azuma
102. Rustyrose
103. Caprico
104. Zancrow
105. Bluenote Stinger
106. Hades
107. Mard Geer
108. Jackal
109. Franmalth
110. Torafuzar
111. Kyoka
112. Seilah
113. Ezel
114. Tempester
115. Silver Fullbuster
116. Keyes
117. Sayla
118. Future Rogue
119. Rogue Cheney
120. Sting Eucliffe
121. Frosch
122. Lector
123. Minerva Orland
124. Yukino Agria
125. Sorano Agria
126. Rufus Lore
127. Orga Nanagear
128. Jiemma
129. Dobengal
130. Doranbalt
131. Flare Corona
132. Obra
133. Jenny Realight
134. Hibiki Lates
135. Eve Tearm
136. Ren Akatsuki
137. Ichiya Vandalay Kotobuki
138. Jura Neekis
139. Lyon Vastia
140. Sherry Blendy
141. Sherria Blendy
142. Toby Horhorta
143. Yuka Suzuki
144. Ooba Babasaama
145. Kagura Mikazuchi
146. Risley Law
147. Beth Vanderwood
148. Arana Webb
149. Bob
150. Goldmine
151. Wolfheim
152. Hisui E. Fiore
153. Arcadios
154. Darton
155. Michello
156. Chapati Lola
157. Jason
158. Toma E. Fiore
159. Yajima
160. Org
161. Leiji
162. Belno
163. Aquarius
164. Virgo
165. Scorpio
166. Taurus
167. Cancer
168. Aries
169. Gemini
170. Libra
171. Sagittarius
172. Capricorn
173. Ophiuchus
174. Plue
175. Horologium
176. Lyra
177. Crux
178. Pyxis
179. Deneb
180. Polaris
181. Edolas Natsu
182. Edolas Lucy
183. Edolas Gray
184. Edolas Erza
185. Edolas Wendy
186. Faust
187. Coco
188. Hughes
189. Sugarboy
190. Byro
191. Erza Knightwalker
192. Pantherlily Edolas
193. Zentopia
194. Michelle Lobster
195. Guttman
196. Jackpot
197. Samuel
198. Blue Note
199. Anna Heartfilia
200. Layla Heartfilia
201. Jude Heartfilia
202. Silver
203. Ur
204. Deliora
205. Ultear young
206. Zera
207. Precht
208. Yury
209. Mavis young
210. Nichiya
211. Karen Lilica
212. Bora
213. Everlue
214. Kurohebi
215. Nullpudding
216. Chelia
217. Rocker
218. Semmes
219. Kawazu
220. Yomazu
221. Hot Eye
222. Angel Sorano
223. Zoldeo
224. Meldy
225. Byro Cracy
226. Extalia Queen
227. Shagotte
228. Nadi`;

const CLOVER_RAW = `1. Asta
2. Yuno Grinberryall
3. Noelle Silva
4. Yami Sukehiro
5. Nacht Faust
6. Mimosa Vermillion
7. Luck Voltia
8. Magna Swing
9. Vanessa Enoteca
10. Finral Roulacase
11. Gauche Adlai
12. Charmy Pappitson
13. Gordon Agrippa
14. Grey
15. Henry Legolant
16. Secre Swallowtail
17. Zora Ideale
18. Julius Novachrono
19. Fuegoleon Vermillion
20. Mereoleona Vermillion
21. Leopold Vermillion
22. Kirsch Vermillion
23. Nozel Silva
24. Nebra Silva
25. Solid Silva
26. Acier Silva
27. Klaus Lunettes
28. William Vangeance
29. Langris Vaude
30. Charlotte Roselei
31. Sol Marron
32. Puli Angel
33. En Ringard
34. Jack the Ripper
35. Sekke Bronzazza
36. Kaiser Granvorka
37. Gueldre Poizot
38. Rill Boismortier
39. Fragil Tormenta
40. Alecdora Sandler
41. David Swallow
42. Xerx Lugner
43. Hamon Caseus
44. Randall Luftair
45. Marx Francois
46. Owen
47. Revchi Salik
48. Heath Grice
49. Sally
50. Valtos
51. Rades Spirito
52. Catherine
53. Baro
54. Patolli
55. Rhya
56. Fana
57. Vetto
58. Zagred
59. Licht
60. Tetia
61. Lumiere Silvamillion Clover
62. Lemiel Silvamillion Clover
63. Drowa
64. Eclat
65. Charla
66. Ronne
67. Kivn
68. Patri
69. Dante Zogratis
70. Vanica Zogratis
71. Zenon Zogratis
72. Lucius Zogratis
73. Lucifero
74. Beelzebub
75. Megicula
76. Adrammelech
77. Lilith
78. Naamah
79. Lucifugus
80. Liebe
81. Gimodelo
82. Slotos
83. Plumede
84. Walgner
85. Morris Libardirt
86. Gaderois Godroc
87. Foyal Migusteau
88. Sivoir Snyle
89. Halbet Chevour
90. Robero Ringert
91. Svenkin Gatard
92. Nacht's father
93. Morgen Faust
94. Ciel Grinberryall
95. Loyce Grinberryall
96. Ralph Niaflem
97. Allen Fiarain
98. Kahono
99. Kiato
100. Gifso
101. Mars
102. Ladros
103. Lotus Whomalt
104. Fanzell Kruger
105. Dominante Code
106. Mariella
107. Broccos
108. Ragus
109. Yagos
110. Gadjah
111. Lolopechka
112. Undine
113. Floga
114. Potrof
115. Noze
116. Siren Tium
117. Neige
118. Dryad
119. Ecthel
120. Dorothy Unsworth
121. Damnatio Kira
122. Sister Lily
123. Father Orsi Orfai
124. Nash
125. Recca
126. Aruru
127. Hollo
128. Sister Theresa Rapual
129. Father Fuego
130. Rebecca Scarlet
131. Marie Adlai
132. Nathan Agrippa
133. Ichika Yami
134. Ryudo Ryuya
135. Fujio
136. Daizaemon O'oka
137. Ginnojomorifuyu Kezoukaku
138. Komari Imari
139. Mushogatake Yosuga
140. Conrad Leto
141. Jester Garandros
142. Edward Avalache
143. Princia Funnybunny
144. Milly Maxwell
145. Roland
146. Sister Theresa
147. Neige's mother
148. Zenon's father
149. Asta's parents
150. Liebe's mother
151. Richita
152. Yuno's retainer
153. Salim of Hapshass
154. Kabwe Carillon
155. Baro's gang
156. Rill's squad
157. Charlotte's squad
158. Yami's squad
159. Nozel's squad
160. Fuegoleon's squad
161. Magic Emperor
162. Wizard King
163. Sekke's rival
164. Rufel
165. Zagred's vessel
166. Elf Patolli
167. Elf Licht
168. Elf Rhya
169. Elf Vetto
170. Elf Fana
171. Elf Drowa
172. Elf Eclat
173. Elf Ronne
174. Elf Charla
175. Elf Kivn
176. Devil Lucifero
177. Devil Beelzebub
178. Devil Megicula
179. Devil Adrammelech
180. Devil Lilith
181. Devil Naamah
182. Zogratis siblings
183. Spade Kingdom Dark Triad
184. Heart Kingdom Spirit Guardians
185. Diamond Kingdom Shining Generals
186. Clover Kingdom Magic Knights`;

const RG_UNIVERSES = {
    naruto:   { name: 'Naruto',              raw: NARUTO_RAW },
    onepiece: { name: 'One Piece',           raw: ONEPIECE_RAW },
    bleach:   { name: 'Bleach',              raw: BLEACH_RAW },
    sds:      { name: 'Seven Deadly Sins',   raw: SDS_RAW },
    mha:      { name: 'My Hero Academia',    raw: MHA_RAW },
    fairy:    { name: 'Fairy Tail',          raw: FAIRY_RAW },
    clover:   { name: 'Black Clover',        raw: CLOVER_RAW },
};

/* ================= Rolland Garos : logique de partie ================= */

function startRollandGaros(room, roomCode) {
    const key = RG_UNIVERSES[room.subMode] ? room.subMode : 'naruto';
    const universe = RG_UNIVERSES[key];
    const pool = [...new Set(parseRGList(universe.raw))];

    rgPools[roomCode] = { pool, usedNorm: new Set() };

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
    room.rg.timeLeft = 10;
    rgTimers[roomCode] = setInterval(() => {
        if (!rooms[roomCode] || !room.rg) {
            clearInterval(rgTimers[roomCode]);
            return;
        }
        room.rg.timeLeft--;
        io.to(roomCode).emit('rg_tick', { timeLeft: Math.max(room.rg.timeLeft, 0) });
        if (room.rg.timeLeft <= 0) {
            clearInterval(rgTimers[roomCode]);
            rgLoseLife(room, roomCode, "⏱ Trop lent, un personnage manqué !");
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

const ENCHERE_UNIVERSES = {
    naruto:   { name: 'Naruto',              characters: ENCHERE_NARUTO },
    onepiece: { name: 'One Piece',           characters: ENCHERE_ONEPIECE },
    bleach:   { name: 'Bleach',              characters: ENCHERE_BLEACH },
    sds:      { name: 'Seven Deadly Sins',   characters: ENCHERE_SDS },
    mha:      { name: 'My Hero Academia',    characters: ENCHERE_MHA },
    clover:   { name: 'Black Clover',        characters: ENCHERE_CLOVER },
    fairy:    { name: 'Fairy Tail',          characters: ENCHERE_FAIRY }
};

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

        const match = poolData.pool.find(name => {
            const n = normalizeRG(name);
            if (poolData.usedNorm.has(n)) return false;
            if (n === norm) return true;
            const parts = n.split(' ');
            return parts[0] === norm || parts[parts.length - 1] === norm;
        });

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
            return poolData.usedNorm.has(n) && (n === norm || n.split(' ').includes(norm));
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
                    delete graceTimers[socket.id];
                    const r = rooms[roomCode];
                    if (!r) return;
                    const encoreLa = r.players.find(p => p.id === socket.id);
                    if (!encoreLa || !encoreLa.disconnected) return; // il est revenu
                    retirerJoueurDuSalon(r, roomCode, socket.id);
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
server.listen(PORT, () => {
    console.log(`Serveur démarré sur le port ${PORT}`);
});
