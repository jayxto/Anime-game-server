const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(__dirname));

/* ================= Comptes utilisateurs (SQLite + JWT) ================= */

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret-in-production';
const JWT_EXPIRES_IN = '30d';

const db = new Database(path.join(__dirname, 'anime-game.db'));
db.pragma('journal_mode = WAL');

db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pseudo TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        rating INTEGER NOT NULL DEFAULT 1000,
        wins INTEGER NOT NULL DEFAULT 0,
        losses INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
`);

function publicUser(row) {
    return {
        id: row.id,
        pseudo: row.pseudo,
        email: row.email,
        rating: row.rating,
        wins: row.wins,
        losses: row.losses
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

app.post('/api/register', (req, res) => {
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

    const existing = db.prepare('SELECT id FROM users WHERE email = ? OR pseudo = ?').get(cleanEmail, cleanPseudo);
    if (existing) {
        return res.status(409).json({ error: 'Ce pseudo ou cet email est déjà utilisé.' });
    }

    const passwordHash = bcrypt.hashSync(String(password), 10);
    const info = db.prepare('INSERT INTO users (pseudo, email, password_hash) VALUES (?, ?, ?)').run(cleanPseudo, cleanEmail, passwordHash);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);

    const token = signToken(user.id);
    res.json({ token, user: publicUser(user) });
});

app.post('/api/login', (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) {
        return res.status(400).json({ error: 'Email et mot de passe requis.' });
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail);
    if (!user || !bcrypt.compareSync(String(password), user.password_hash)) {
        return res.status(401).json({ error: 'Email ou mot de passe incorrect.' });
    }

    const token = signToken(user.id);
    res.json({ token, user: publicUser(user) });
});

app.get('/api/me', (req, res) => {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Non authentifié.' });

    const payload = verifyToken(token);
    if (!payload) return res.status(401).json({ error: 'Session invalide ou expirée.' });

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.sub);
    if (!user) return res.status(401).json({ error: 'Utilisateur introuvable.' });

    res.json({ user: publicUser(user) });
});

// Chaque connexion Socket.io doit présenter un token JWT valide (envoyé par le client via socket.auth)
io.use((socket, next) => {
    const token = socket.handshake.auth && socket.handshake.auth.token;
    if (!token) return next(new Error('unauthorized'));

    const payload = verifyToken(token);
    if (!payload) return next(new Error('unauthorized'));

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.sub);
    if (!user) return next(new Error('unauthorized'));

    socket.user = publicUser(user);
    next();
});

const rooms = {};

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
2. Sasuke Uchiha
3. Sakura Haruno
4. Kakashi Hatake
5. Sai
6. Yamato
7. Shikamaru Nara
8. Ino Yamanaka
9. Choji Akimichi
10. Hinata Hyuga
11. Kiba Inuzuka
12. Shino Aburame
13. Neji Hyuga
14. Rock Lee
15. Tenten
16. Might Guy
17. Konohamaru Sarutobi
18. Moegi Kazamatsuri
19. Udon Ise
20. Iruka Umino
21. Hiruzen Sarutobi
22. Asuma Sarutobi
23. Kurenai Yuhi
24. Minato Namikaze
25. Kushina Uzumaki
26. Jiraiya
27. Tsunade
28. Orochimaru
29. Kabuto Yakushi
30. Shizune
31. Anko Mitarashi
32. Ebisu
33. Mizuki
34. Ibiki Morino
35. Genma Shiranui
36. Hayate Gekko
37. Kotetsu Hagane
38. Izumo Kamizuki
39. Aoba Yamashiro
40. Raidō Namiashi
41. Iwashi Tatami
42. Hiashi Hyuga
43. Hizashi Hyuga
44. Hanabi Hyuga
45. Ko Hyuga
46. Shikaku Nara
47. Yoshino Nara
48. Inoichi Yamanaka
49. Choza Akimichi
50. Fugaku Uchiha
51. Mikoto Uchiha
52. Itachi Uchiha
53. Shisui Uchiha
54. Obito Uchiha
55. Madara Uchiha
56. Izuna Uchiha
57. Kagami Uchiha
58. Sasuke Sarutobi
59. Danzo Shimura
60. Torune Aburame
61. Fu Yamanaka
62. Sakumo Hatake
63. Rin Nohara
64. Dan Kato
65. Nawaki
66. Mito Uzumaki
67. Hashirama Senju
68. Tobirama Senju
69. Koharu Utatane
70. Homura Mitokado
71. Gengetsu Hozuki
72. Mu
73. Onoki
74. Kurotsuchi
75. Akatsuchi
76. Kitsuchi
77. Deidara
78. Sasori
79. Gaara
80. Temari
81. Kankuro
82. Rasa
83. Karura
84. Yashamaru
85. Baki
86. Chiyo
87. Ebizo
88. Pakura
89. Zabuza Momochi
90. Haku
91. Gato
92. Mei Terumi
93. Chojuro
94. Ao
95. Yagura
96. Mangetsu Hozuki
97. Suigetsu Hozuki
98. Kisame Hoshigaki
99. Raiga Kurosuki
100. Ameyuri Ringo
101. A
102. Darui
103. Killer B
104. Yugito Nii
105. Mabui
106. Samui
107. Atsui
108. Omoi
109. Karui
110. Kinkaku
111. Ginkaku
112. Han
113. Roshi
114. Utakata
115. Fuu
116. Son Goku
117. Shukaku
118. Matatabi
119. Isobu
120. Kokuo
121. Saiken
122. Chomei
123. Gyuki
124. Kurama
125. Juubi
126. Nagato
127. Yahiko
128. Konan
129. Hanzo
130. Mifune
131. Karin
132. Jugo
133. Kimimaro
134. Jirobo
135. Kidomaru
136. Sakon
137. Ukon
138. Tayuya
139. Dosu Kinuta
140. Zaku Abumi
141. Kin Tsuchi
142. Guren
143. Akamaru
144. Pakkun
145. Gamabunta
146. Gamakichi
147. Fukasaku
148. Shima
149. Katsuyu
150. Manda
151. Enma
152. Tonton
153. Kaguya Otsutsuki
154. Hagoromo Otsutsuki
155. Hamura Otsutsuki
156. Indra Otsutsuki
157. Asura Otsutsuki
158. Toneri Otsutsuki
159. Momoshiki Otsutsuki
160. Kinshiki Otsutsuki
161. Urashiki Otsutsuki
162. Isshiki Otsutsuki
163. Black Zetsu
164. White Zetsu
165. Tobi
166. Shin Uchiha
167. Kashin Koji
168. Code
169. Eida
170. Daemon
171. Kawaki
172. Mitsuki
173. Boruto Uzumaki
174. Sarada Uchiha
175. Himawari Uzumaki
176. Shikadai Nara
177. Inojin Yamanaka
178. Chocho Akimichi
179. Metal Lee
180. Iwabee Yuino
181. Denki Kaminarimon
182. Sumire Kakei
183. Wasabi Izuno
184. Namida Suzumeno
185. Mirai Sarutobi
186. Katasuke Tono
187. Victor
188. Deepa
189. Delta
190. Boro
191. Jigen
192. Amado
193. Nue`;

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
12. Portgas D. Ace
13. Sabo
14. Monkey D. Dragon
15. Monkey D. Garp
16. Shanks
17. Benn Beckman
18. Lucky Roux
19. Yasopp
20. Rockstar
21. Edward Newgate
22. Marco
23. Jozu
24. Vista
25. Izo
26. Thatch
27. Namur
28. Kaido
29. King
30. Queen
31. Jack
32. Who's-Who
33. Sasaki
34. Black Maria
35. Ulti
36. Page One
37. X Drake
38. Yamato
39. Charlotte Linlin
40. Katakuri
41. Smoothie
42. Cracker
43. Perospero
44. Oven
45. Daifuku
46. Compote
47. Brûlée
48. Pudding
49. Pekoms
50. Tamago
51. Streusen
52. Capone Bege
53. Marshall D. Teach
54. Shiryu
55. Jesus Burgess
56. Van Augur
57. Doc Q
58. Catarina Devon
59. Avalo Pizarro
60. Vasco Shot
61. Sanjuan Wolf
62. Lafitte
63. Kuzan
64. Sakazuki
65. Borsalino
66. Issho
67. Sengoku
68. Tsuru
69. Kong
70. Hina
71. Smoker
72. Tashigi
73. Koby
74. Helmeppo
75. Sentomaru
76. Vergo
77. Fullbody
78. Morgan
79. Arlong
80. Hatchan
81. Kuroobi
82. Chew
83. Fisher Tiger
84. Koala
85. Aladine
86. Wadatsumi
87. Hody Jones
88. Vander Decken IX
89. Fukaboshi
90. Neptune
91. Shirahoshi
92. Otohime
93. Don Krieg
94. Gin
95. Kuro
96. Django
97. Kaya
98. Merry
99. Zeff
100. Patty
101. Carne
102. Johnny
103. Yosaku
104. Genzo
105. Nojiko
106. Bell-mère
107. Kurozumi Orochi
108. Kaidou
109. Kanjuro
110. Kin'emon
111. Momonosuke
112. Hiyori
113. Oden Kozuki
114. Toki
115. Denjiro
116. Raizo
117. Kikunojo
118. Kawamatsu
119. Ashura Doji
120. Inuarashi
121. Nekomamushi
122. Shinobu
123. Tama
124. Hyogoro
125. Bepo
126. Trafalgar D. Water Law
127. Penguin
128. Shachi
129. Jean Bart
130. Eustass Kid
131. Killer
132. Scratchmen Apoo
133. Basil Hawkins
134. Urouge
135. Jewelry Bonney
136. Cavendish
137. Bartolomeo
138. Sai
139. Don Chinjao
140. Baby 5
141. Donquixote Doflamingo
142. Rosinante
143. Trebol
144. Diamante
145. Pica
146. Senor Pink
147. Gladius
148. Sugar
149. Machvise
150. Dellinger
151. Buffalo
152. Monet
153. Caesar Clown
154. Crocodile
155. Daz Bonez
156. Bentham
157. Nefertari Vivi
158. Nefertari Cobra
159. Pell
160. Chaka
161. Wapol
162. Dr. Kureha
163. Dr. Hogback
164. Laboon
165. Crocus
166. Vivi
167. Bon Clay
168. Emporio Ivankov
169. Inazuma
170. Bartholomew Kuma
171. Gecko Moria
172. Perona
173. Absalom
174. Ryuma
175. Oars
176. Dracule Mihawk
177. Buggy
178. Alvida
179. Foxy
180. Blueno
181. Kalifa
182. Kaku
183. Rob Lucci
184. Jabra
185. Kumadori
186. Spandam
187. Paulie
188. Iceburg
189. Tom
190. Franky
191. Brook
192. Silvers Rayleigh
193. Scopper Gaban
194. Saint Charlos
195. Imu
196. Vegapunk
197. Shaka
198. Lilith
199. York
200. Stussy
201. Boa Hancock
202. Boa Sandersonia
203. Boa Marigold
204. Magellan
205. Domino
206. Edward Weevil
207. Rocks D. Xebec
208. Kozuki Oden
209. Komurasaki
210. Uta
211. Douglas Bullet
212. Enel
213. Wyper
214. Gan Fall
215. Conis
216. Rebecca
217. Kyros
218. Riku Doldo III
219. Viola
220. Hack
221. Fisher Tiger`;

const BLEACH_RAW = `1. Ichigo Kurosaki
2. Rukia Kuchiki
3. Orihime Inoue
4. Uryu Ishida
5. Yasutora Sado
6. Kisuke Urahara
7. Yoruichi Shihōin
8. Isshin Kurosaki
9. Karin Kurosaki
10. Yuzu Kurosaki
11. Kon
12. Don Kanonji
13. Tatsuki Arisawa
14. Keigo Asano
15. Mizuiro Kojima
16. Ururu Tsumugiya
17. Jinta Hanakari
18. Tessai Tsukabishi
19. Ryuken Ishida
20. Grand Fisher
21. Shukuro Tsukishima
22. Kugo Ginjō
23. Riruka Dokugamine
24. Yukio Hans Vorarlberna
25. Jackie Tristan
26. Giriko Kutsuzawa
27. Moe Shishigawara
28. Byakuya Kuchiki
29. Renji Abarai
30. Toshiro Hitsugaya
31. Kenpachi Zaraki
32. Shunsui Kyoraku
33. Jushiro Ukitake
34. Sajin Komamura
35. Soi Fon
36. Mayuri Kurotsuchi
37. Retsu Unohana
38. Isane Kotetsu
39. Ikkaku Madarame
40. Yumichika Ayasegawa
41. Rangiku Matsumoto
42. Momo Hinamori
43. Izuru Kira
44. Shuhei Hisagi
45. Kensei Muguruma
46. Rojuro Otoribashi
47. Shinji Hirako
48. Love Aikawa
49. Hiyori Sarugaki
50. Lisa Yadomaru
51. Hachigen Ushoda
52. Mashiro Kuna
53. Nanao Ise
54. Genryusai Shigekuni Yamamoto
55. Chojiro Sasakibe
56. Marechiyo Omaeda
57. Nemu Kurotsuchi
58. Hanataro Yamada
59. Kiyone Kotetsu
60. Sentaro Kotsubaki
61. Kaien Shiba
62. Kukaku Shiba
63. Ganju Shiba
64. Sojun Kuchiki
65. Ginrei Kuchiki
66. Hisana Kuchiki
67. Sosuke Aizen
68. Gin Ichimaru
69. Kaname Tosen
70. Wonderweiss Margela
71. Coyote Starrk
72. Lilynette Gingerback
73. Baraggan Louisenbairn
74. Tier Harribel
75. Ulquiorra Cifer
76. Nnoitra Gilga
77. Grimmjow Jaegerjaquez
78. Zommari Rureaux
79. Szayelaporro Granz
80. Aaroniero Arruruerie
81. Yammy Llargo
82. Luppi Antenor
83. Nelliel Tu Odelschwanck
84. Cirucci Sanderwicci
85. Pesche Guatiche
86. Dondochakka Bilstin
87. Emilou Apacci
88. Franceska Mila Rose
89. Cyan Sung-Sun
90. Shawlong Koufang
91. Zangetsu
92. Yhwach
93. Jugram Haschwalth
94. Bazz-B
95. As Nodt
96. Bambietta Basterbine
97. Candice Catnipp
98. Meninas McAllon
99. Liltotto Lamperd
100. Giselle Gewelle
101. Gremmy Thoumeaux
102. Lille Barro
103. Gerard Valkyrie
104. Pernida Parnkgjas
105. Askin Nakk Le Vaar
106. Mask De Masculine
107. Quilge Opie
108. Driscoll Berci
109. Cang Du
110. BG9
111. Loyd Lloyd
112. Ichibe Hyosube
113. Oetsu Nimaiya
114. Tenjiro Kirinji
115. Senjumaru Shutara
116. Kirio Hikifune
117. Soul King
118. Mimihagi
119. Tokinada Tsunayashiro
120. Yachiru Kusajishi
121. Tetsuzaemon Iba
122. Koga Kuchiki`;

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
44. Vivian
45. Cain Barzad
46. Twigo
47. Golgius
48. Friesia
49. Zaratras
50. Nadja Liones
51. Cath
52. Oslo
53. Modred
54. Donny
55. Gerheade
56. Dahlia
57. Tristan Liones
58. Lancelot
59. Percival
60. Nasiens
61. Anne
62. Isolde
63. Ironside
64. Pellegarde
65. Talisker
66. Macduff
67. Guinevere
68. Kay
69. Chaos
70. Cath Palug`;

const MHA_RAW = `1. Izuku Midoriya (Deku)
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
21. Shota Aizawa
22. All Might
23. Present Mic
24. Midnight
25. Cementoss
26. Ectoplasm
27. Snipe
28. Thirteen
29. Power Loader
30. Hound Dog
31. Recovery Girl
32. Nezu
33. Vlad King
34. Sekijiro Kan
35. Gran Torino
36. Sir Nighteye
37. Mirio Togata
38. Tamaki Amajiki
39. Nejire Hado
40. Fat Gum
41. Ryukyu
42. Mt. Lady
43. Kamui Woods
44. Edgeshot
45. Best Jeanist
46. Hawks
47. Endeavor
48. Mirko
49. Crust
50. Gang Orca
51. Pixie-Bob
52. Tiger
53. Mandalay
54. Ragdoll
55. Ms. Joke
56. Inasa Yoarashi
57. Camie Utsushimi
58. Mei Hatsume
59. Melissa Shield
60. David Shield
61. Eri
62. Kota Izumi
63. Inko Midoriya
64. Rei Todoroki
65. Enji Todoroki
66. Fuyumi Todoroki
67. Natsuo Todoroki
68. Toya Todoroki (Dabi)
69. Keigo Takami (Hawks)
70. Nana Shimura
71. Tenko Shimura
72. Yoichi Shigaraki
73. All For One
74. Tomura Shigaraki
75. Kurogiri
76. Dabi
77. Himiko Toga
78. Twice
79. Mr. Compress
80. Spinner
81. Magne
82. Mustard
83. Moonfish
84. Muscular
85. Nomu
86. Gigantomachia
87. Doctor Kyudai Garaki
88. Giran
89. Re-Destro
90. Geten
91. Trumpet
92. Curious
93. Skeptic
94. Nine
95. Slice
96. Chimera
97. Mummy
98. Wolfram
99. Rody Soul
100. Gentle Criminal
101. La Brava
102. Overhaul (Kai Chisaki)
103. Chronostasis
104. Mimic
105. Rappa
106. Tengai
107. Setsuno Toya
108. Hojo
109. Tabe
110. Monoma Neito
111. Itsuka Kendo
112. Tetsutetsu Tetsutetsu
113. Juzo Honenuki
114. Setsuna Tokage
115. Ibara Shiozaki
116. Yosetsu Awase
117. Sen Kaibara
118. Pony Tsunotori
119. Manga Fukidashi
120. Kosei Tsuburaba
121. Shishida Jurota
122. Reiko Yanagi
123. Hiryu Rin
124. Kojiro Bondo
125. Togaru Kamakiri
126. Kinoko Komori
127. Shihai Kuroiro
128. Yui Kodai
129. Burnin
130. Selkie
131. Sirius
132. Uwabami
133. Death Arms
134. Gunhead
135. Fourth Kind
136. Manual
137. Rock Lock
138. Centipeder
139. Bubble Girl
140. Native
141. Slidin' Go
142. Majestic
143. X-Less
144. Star and Stripe
145. Cathleen Bate
146. Christopher Skyline
147. Captain Celebrity
148. Nagamasa Mora`;

const FAIRY_RAW = `1. Natsu Dragneel
2. Lucy Heartfilia
3. Gray Fullbuster
4. Erza Scarlet
5. Wendy Marvell
6. Happy
7. Carla
8. Gajeel Redfox
9. Juvia Lockser
10. Mirajane Strauss
11. Laxus Dreyar
12. Makarov Dreyar
13. Elfman Strauss
14. Lisanna Strauss
15. Cana Alberona
16. Levy McGarden
17. Jet
18. Droy
19. Freed Justine
20. Bickslow
21. Evergreen
22. Alzack Connell
23. Bisca Mulan
24. Romeo Conbolt
25. Macao Conbolt
26. Wakaba Mine
27. Max Alors
28. Warren Rocko
29. Nab Lasaro
30. Reedus Jonah
31. Asuka Connell
32. Loke
33. Mystogan
34. Panther Lily
35. Mest Gryder
36. Gildarts Clive
37. Porlyusica
38. Hades
39. Zeref Dragneel
40. Mavis Vermillion
41. Acnologia
42. Igneel
43. Grandeeney
44. Metalicana
45. Weisslogia
46. Skiadrum
47. Atlas Flame
48. Motherglare
49. Zirconis
50. Belserion
51. Irene Belserion
52. August
53. Larcade Dragneel
54. God Serena
55. Bloodman
56. Dimaria Yesta
57. Brandish μ
58. Invel Yura
59. Ajeel Raml
60. Neinhart
61. Wahl Icht
62. Jacob Lessio
63. Spriggan 12
64. Duke Barbaroa
65. Duke Oración Seis
66. Cobra
67. Midnight
68. Angel
69. Racer
70. Brain
71. Zero
72. Hoteye
73. Imitatia
74. Jellal Fernandes
75. Ultear Milkovich
76. Meredy
77. Simon
78. Wally Buchanan
79. Millianna
80. Sho
81. Richard Buchanan
82. Erigor
83. Kageyama
84. Aria
85. Vidaldus Taka
86. Ikaruga
87. Kain Hikaru
88. Azuma
89. Rustyrose
90. Caprico
91. Zancrow
92. Bluenote Stinger
93. Mard Geer
94. Jackal
95. Franmalth
96. Torafuzar
97. Kyôka
98. Seilah
99. Ezel
100. Tempester
101. Silver Fullbuster
102. Keyes
103. Keith
104. Future Rogue
105. Rogue Cheney
106. Sting Eucliffe
107. Frosch
108. Lector
109. Minerva Orland
110. Yukino Agria
111. Sorano Agria
112. Rufus Lore
113. Orga Nanagear
114. Doranbalt
115. Flare Corona
116. Obra
117. Jenny Realight
118. Hibiki Lates
119. Eve Tearm
120. Ren Akatsuki
121. Ichiya Vandalay Kotobuki
122. Jura Neekis
123. Lyon Vastia
124. Sherry Blendy
125. Toby Horhorta
126. Yuka Suzuki
127. Kagura Mikazuchi
128. Risley Law
129. Warrod Sequen
130. Yuri Dreyar
131. Precht Gaebolg
132. Wolfheim
133. Bob
134. Hisui E. Fiore
135. Arcadios
136. Darton
137. Chapati Lola
138. Jason
139. Toma E. Fiore`;

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
17. Julius Novachrono
18. Fuegoleon Vermillion
19. Mereoleona Vermillion
20. Leopold Vermillion
21. Nozel Silva
22. Nebra Silva
23. Solid Silva
24. Kirsch Vermillion
25. Klaus Lunettes
26. William Vangeance
27. Langris Vaude
28. Charlotte Roselei
29. Sol Marron
30. Puli Angel
31. En Ringard
32. Jack the Ripper
33. Sekke Bronzazza
34. Kaiser Granvorka
35. Gueldre Poizot
36. Rill Boismortier
37. Fragil Tormenta
38. Alecdora Sandler
39. David Swallow
40. Xerx Lugner
41. Hamon Caseus
42. Randall Luftair
43. Marx Francois
44. Revchi Salik
45. Heath Grice
46. Sally
47. Valtos
48. Rades Spirito
49. Baro
50. Patolli
51. Rhya
52. Fana
53. Vetto
54. Zagred
55. Licht
56. Tetia
57. Lumiere Silvamillion Clover
58. Lemiel Silvamillion Clover
59. Charla
60. Ronne
61. William Vangeance
62. Dante Zogratis
63. Vanica Zogratis
64. Zenon Zogratis
65. Lucifero
66. Megicula
67. Morris Libardirt
68. Gaderois Godroc
69. Foyal Migusteau
70. Sivoir Snyle
71. Adrammelech
72. Lilith
73. Naamah
74. Beelzebub
75. Lucifugus
76. Liebe
77. Nacht's father
78. Nacht's mother
79. Ciel Grinberryall
80. Loyce Grinberryall
81. Ralph Nader
82. Allen Fiarain
83. Acier Silva
84. Kahono
85. Kiato
86. Mars
87. Ladros
88. Lotus Whomalt
89. Fanzell Kruger
90. Dominante Code
91. Mariella
92. Gadjah
93. Lolopechka
94. Undine
95. Dryad
96. Dorthy Unsworth
97. Damnatio Kira
98. Sister Lily
99. Father Orsi Orfai
100. Rebecca Scarlet
101. Marie Adlai
102. Nathan Agrippa
103. Ichika Yami
104. Ryudo Ryuya
105. Fujio
106. Daizaemon O'oka
107. Heath Grice
108. Conrad Leto
109. Jester Garandros
110. Edward Avalaché
111. Princia Funnybunny
112. Milly Maxwell`;

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
    io.to(roomCode).emit('rg_game_over', { room });
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

    function assignUndercoverNormalWords(room) {
        const pair = undercoverPairsNormal[Math.floor(Math.random() * undercoverPairsNormal.length)];
        const civilWord = pair[0];
        const undercoverWord = pair[1];

        const alivePlayers = room.players.filter(p => p.isAlive);
        const impostorIndex = Math.floor(Math.random() * alivePlayers.length);

        room.players.forEach(p => {
            if (p.id === alivePlayers[impostorIndex].id) {
                p.isImpostor = true;
                p.secretData = undercoverWord;
            } else {
                p.isImpostor = false;
                p.secretData = civilWord;
            }
        });
    }

    function assignUndercoverHardcoreWords(room) {
        // En hardcore, on prend 2 persos différents au hasard dans la liste globale
        let idx1 = Math.floor(Math.random() * undercoverHardcorePool.length);
        let idx2 = Math.floor(Math.random() * undercoverHardcorePool.length);
        while (idx2 === idx1) {
            idx2 = Math.floor(Math.random() * undercoverHardcorePool.length);
        }

        const civilWord = undercoverHardcorePool[idx1];
        const undercoverWord = undercoverHardcorePool[idx2];

        const alivePlayers = room.players.filter(p => p.isAlive);
        const impostorIndex = Math.floor(Math.random() * alivePlayers.length);

        room.players.forEach(p => {
            if (p.id === alivePlayers[impostorIndex].id) {
                p.isImpostor = true;
                p.secretData = undercoverWord;
            } else {
                p.isImpostor = false;
                p.secretData = civilWord;
            }
        });
    }

    function assignNoteWords(room) {
        // Tous les civils reçoivent la même note, l'undercover reçoit une note différente
        let civilNote = Math.floor(Math.random() * 10) + 1;
        let impostorNote = Math.floor(Math.random() * 10) + 1;
        while (impostorNote === civilNote) {
            impostorNote = Math.floor(Math.random() * 10) + 1;
        }

        const alivePlayers = room.players.filter(p => p.isAlive);
        const impostorIndex = Math.floor(Math.random() * alivePlayers.length);

        room.players.forEach(p => {
            if (p.id === alivePlayers[impostorIndex].id) {
                p.isImpostor = true;
                p.secretData = impostorNote + "/10";
            } else {
                p.isImpostor = false;
                p.secretData = civilNote + "/10";
            }
        });
    }

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

        if (room.noImpostor && eliminatedTargetId === 'no_impostor') {
            gameOver = true;
            winnerMessage = "🎉 Les innocents ont gagné ! Ils ont deviné qu'il n'y avait aucun imposteur.";
        } else if (room.mode === 'undercover' || room.mode === 'note') {
            const impostorsAlive = room.players.filter(p => p.isAlive && p.isImpostor);
            const civilsAlive = room.players.filter(p => p.isAlive && !p.isImpostor);

            if (impostorsAlive.length === 0) {
                gameOver = true;
                winnerMessage = "🎉 Victoire des Civils ! L'imposteur a été démasqué.";
            } else if (impostorsAlive.length >= civilsAlive.length) {
                gameOver = true;
                winnerMessage = "🚨 Victoire de l'Imposteur ! Il est en nombre égal ou supérieur aux civils.";
            }
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

    socket.on('next_step_game', (roomCode) => {
        const room = rooms[roomCode];
        if (!room) return;

        if (room.mode === 'undercover') {
            distributeSecretsAndStart(room, roomCode);
        } else if (room.mode === 'rollandgaros') {
            startRollandGaros(room, roomCode);
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
            room.status = 'waiting';
            room.players.forEach(p => {
                p.isAlive = true;
                p.isImpostor = false;
                p.clue = '';
            });
            io.to(roomCode).emit('update_room', room);
        }
    });

    socket.on('disconnect', () => {
        console.log(`Utilisateur déconnecté : ${socket.id}`);
        for (const roomCode in rooms) {
            const room = rooms[roomCode];
            const hadTurn = room.rg && room.players[room.rg.turnIndex] && room.players[room.rg.turnIndex].id === socket.id;
            room.players = room.players.filter(p => p.id !== socket.id);

            if (room.players.length === 0) {
                if (rgTimers[roomCode]) {
                    clearInterval(rgTimers[roomCode]);
                    delete rgTimers[roomCode];
                }
                delete rgPools[roomCode];
                delete rooms[roomCode];
                continue;
            }

            if (room.host === socket.id) {
                room.host = room.players[0].id;
            }

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
            } else {
                io.to(roomCode).emit('update_room', room);
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Serveur démarré sur le port ${PORT}`);
});
