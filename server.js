const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

const rooms = {};

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

io.on('connection', (socket) => {
    console.log(`Un utilisateur s'est connecté : ${socket.id}`);

    socket.on('join_room', ({ roomCode, username, mode, subMode }) => {
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
                name: username,
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
            const themeMasterId = room.players[0].id;
            io.to(roomCode).emit('prompt_theme_choice', { room, themeMasterId });
        }
    });

    socket.on('submit_custom_theme', ({ roomCode, theme }) => {
        const room = rooms[roomCode];
        if (!room) return;

        room.currentTheme = theme;
        io.to(roomCode).emit('theme_chosen', room);

        distributeSecretsAndStart(room, roomCode);
    });

    function distributeSecretsAndStart(room, roomCode) {
        room.status = 'reveal';
        room.noImpostor = false;

        if (room.mode === 'undercover') {
            if (room.subMode === 'hardcore') {
                const randChance = Math.random();
                if (randChance < 0.25) {
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
            room.players.forEach(p => {
                p.secretData = Math.floor(Math.random() * 10) + 1 + "/10";
                p.isImpostor = false;
            });
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
        const themeMasterId = room.players[0].id;
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
        } else if (room.mode === 'undercover') {
            const impostorsAlive = room.players.filter(p => p.isAlive && p.isImpostor);
            const civilsAlive = room.players.filter(p => p.isAlive && !p.isImpostor);

            if (impostorsAlive.length === 0) {
                gameOver = true;
                winnerMessage = "🎉 Victoire des Innocents ! L'imposteur a été éliminé.";
            } else if (impostorsAlive.length >= civilsAlive.length) {
                gameOver = true;
                winnerMessage = "🚨 Victoire des Imposteurs ! Ils sont en nombre égal ou supérieur aux innocents.";
            }
        } else if (room.mode === 'note') {
            gameOver = true;
            winnerMessage = "✨ Fin de la partie 'Devine la note' ! Merci d'avoir joué.";
        }

        room.status = 'results';
        io.to(roomCode).emit('show_results', {
            room,
            eliminatedPlayer,
            gameOver,
            winnerMessage
        });
    }

    socket.on('next_step_game', (roomCode) => {
        const room = rooms[roomCode];
        if (!room) return;

        if (room.mode === 'undercover') {
            distributeSecretsAndStart(room, roomCode);
        } else {
            room.status = 'choosing_theme';
            room.currentTurnIndex = 0;
            room.players.forEach(p => p.clue = '');
            const themeMasterId = room.players[0].id;
            io.to(roomCode).emit('prompt_theme_choice', { room, themeMasterId });
        }
    });

    socket.on('back_to_menu', (roomCode) => {
        const room = rooms[roomCode];
        if (room) {
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
            room.players = room.players.filter(p => p.id !== socket.id);
            
            if (room.players.length === 0) {
                delete rooms[roomCode];
            } else {
                if (room.host === socket.id) {
                    room.host = room.players[0].id;
                }
                io.to(roomCode).emit('update_room', room);
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Serveur démarré sur le port ${PORT}`);
});
