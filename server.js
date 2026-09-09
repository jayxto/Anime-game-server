const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

const server = http.createServer(app);
const io = new Server(server);

const rooms = {};

const undercoverPairs = [
    ["Kenjaku", "Geto"], ["Tengen", "Kakashi"], ["Kisame", "Requin"], 
    ["Rasen shuriken", "Rasengan"], ["Yuji", "Sukuna"], ["Peter Parker", "Miles Morales"], 
    ["Inoxtag", "Luffy"], ["Kakashi", "Gojo"], ["Superman", "All Might"], 
    ["Meruem", "Cell"], ["Pain", "Nagato"], ["Maki", "Toji"], 
    ["Aokiji", "Brook"], ["Pokeball", "Dragon Ball"], ["Madara", "Itachi"], 
    ["Ener", "Luxus"], ["Kamehameha", "Genkidama"], ["Jubidara", "Jubito"], 
    ["Muzan", "Imu"], ["Amaterasu", "Katon"], ["Rinnegan", "Sharingan"], 
    ["Hinata (Haikyu)", "Messi"], ["Loki", "Kaido"], ["Sukuna", "Meguna"], 
    ["Obito", "Tobi"], ["Denji", "Yuji"], ["Gogeta", "Vegeto"], 
    ["Sharingan", "Mangekyou"], ["Gon enfant", "Gon adulte"], ["Escanor", "Cannicule"], 
    ["Brigade fantôme", "Akatsuki"], ["Netero", "Barbe Blanche"], ["Yoriichi", "Tanjiro"], 
    ["Yamato", "Hashirama"], ["Ace", "Sabo"], ["Ban", "Hisoka"], 
    ["Pikachu", "Zenitsu"], ["Vegeta", "Sasuke"], ["Broly", "Hulk"], 
    ["Obito", "Kakashi"], ["Trunks", "Trunks futur"], ["Goten", "Gohan"], 
    ["Hisoka", "Orochimaru"], ["Naruto", "Minato"], ["Goku", "Black Goku"], 
    ["Gildarts", "Shanks"], ["Clan Kuruta", "Clan Uchiwa"], ["Nen", "Chakra"], 
    ["Crocodile", "Gaara"], ["Hidan", "Ban"]
];

const HARDCORE_CHARACTERS = [
    "Naruto Uzumaki", "Sasuke Uchiwa", "Sakura Haruno", "Kakashi Hatake", "Itachi Uchiwa", 
    "Gaara", "Jiraya", "Hinata Hyûga", "Madara Uchiwa", "Orochimaru", 
    "Pain (Nagato)", "Shikamaru Nara", "Rock Lee", "Neji Hyûga", "Minato Namikaze", 
    "Obito Uchiwa", "Tsunade", "Might Guy", "Killer B", "Shisui Uchiwa", 
    "Deidara", "Kisame Hoshigaki", "Sasori", "Konan", "Kabuto Yakushi", 
    "Hashirama Senju", "Tobirama Senju", "Hiruzen Sarutobi", "Temari", "Kankurô", 
    "Sai", "Yamato", "Konohamaru Sarutobi", "Ino Yamanaka", "Choji Akimichi", 
    "Tenten", "Kiba Inuzuka", "Shino Aburame", "Zabuza Momochi", "Haku", 
    "Danzo Shimura", "Asuma Sarutobi", "Iruka Umino", "Kurenai Yûhi", "Onoki", 
    "Mei Terumi", "Momoshiki Otsutsuki", "Kaguya Otsutsuki", "Kurama", "Shikaku Nara",
    "Monkey D. Luffy", "Roronoa Zoro", "Nami", "Sanji", "Tony Tony Chopper", 
    "Nico Robin", "Usopp", "Trafalgar Law", "Portgas D. Ace", "Shanks", 
    "Sabo", "Boa Hancock", "Dracule Mihawk", "Marshall D. Teach (Barbe Noire)", "Edward Newgate (Barbe Blanche)", 
    "Gol D. Roger", "Kaido", "Charlotte Linlin (Big Mom)", "Eustass Kid", "Donquixote Doflamingo", 
    "Crocodile", "Buggy", "Jinbe", "Franky", "Brook", 
    "Marco", "Silvers Rayleigh", "Monkey D. Dragon", "Monkey D. Garp", "Sengoku", 
    "Akainu", "Aokiji", "Kizaru", "Rob Lucci", "Enel", 
    "Katakuri", "Yamato", "Kozuki Oden", "Momonosuke",
    "Ichigo Kurosaki", "Rukia Kuchiki", "Orihime Inoue", "Uryū Ishida", "Renji Abarai", 
    "Byakuya Kuchiki", "Toshiro Hitsugaya", "Kenpachi Zaraki", "Sosuke Aizen", "Kisuke Urahara", 
    "Yoruichi Shihōin", "Shunsui Kyōraku", "Mayuri Kurotsuchi", "Retsu Unohana", "Genryūsai Yamamoto", 
    "Ichimaru Gin", "Ulquiorra Cifer", "Grimmjow Jaegerjaquez", "Coyote Starrk", "Nelliel Tu Odelschwanck", 
    "Yhwach", "Jugram Haschwalth", "Bambietta Basterbine", "As Nodt", "Bazz-B", 
    "Lille Barro", "Gerard Valkyrie", "Gremmy Thoumeaux", "Shinji Hirako", "Kensei Muguruma", 
    "Hiyori Sarugaki", "Love Aikawa", "Isshin Kurosaki", "Jūshirō Ukitake", "Sajin Komamura", 
    "Soi Fon", "Rangiku Matsumoto", "Izuru Kira", "Ikkaku Madarame", "Yumichika Ayasegawa", 
    "Chad / Yasutora Sado", "Tessai Tsukabishi", "Kon", "Don Kanonji", "Shukuro Tsukishima",
    "Asta", "Yuno", "Noelle Silva", "Yami Sukehiro", "Julius Novachrono", 
    "Mereoleona Vermillion", "Nacht Faust", "Luck Voltia", "Magna Swing", "Vanessa Enoteca", 
    "Finral Roulacase", "Charmy Pappitson", "Gauche Adlai", "Gordon Agrippa", "Grey", 
    "Nozel Silva", "Fuegoleon Vermillion", "Leopold Vermillion", "Mimosa Vermillion", "Charlotte Roselei", 
    "William Vangeance", "Rill Boismortier", "Dorothy Unsworth", "Jack the Ripper", "Kaiser Granvorka", 
    "Sekke Bronzazza", "Langris Vaude", "Zora Ideale", "Patolli", "Licht", 
    "Zagred", "Liebe", "Dante Zogratis", "Vanica Zogratis", "Zenon Zogratis", 
    "Lucifero", "Morris Libardirt", "Megicula", "Lucius Zogratis", "Adrammelech", 
    "Mars", "Fana", "Ladros", "Vetto", "Sally", 
    "Rhya", "Kirsch Vermillion", "Sol Marron", "Sister Lily",
    "Meliodas", "Elizabeth Liones", "Ban", "King", "Diane", 
    "Gowther", "Merlin", "Escanor", "Hawk", "Zeldris", 
    "Estarossa", "Mael", "Arthur Pendragon", "Ludociel", "Sariel", 
    "Tarmiel", "Monspeet", "Derieri", "Drole", "Gloxinia", 
    "Chandler", "Cusack", "Zaratras", "Hendrickson", "Dreyfus", 
    "Gilthunder", "Howzer", "Griamore", "Veronica Liones", "Margaret Liones", 
    "Jericho", "Guila", "Helbram", "Elaine", "King Arthur", 
    "Diane’s Matrona", "Gowther (Démon)", "Fraudrin", "Grayroad", "Galand", 
    "Melascula", "Gray Demon", "Demon King", "Supreme Deity", "Cath", 
    "Tristan Liones", "Percival", "Lancelot", "Donny",
    "Natsu Dragneel", "Lucy Heartfilia", "Erza Scarlet", "Gray Fullbuster", "Wendy Marvell", 
    "Happy", "Gajeel Redfox", "Juvia Lockser", "Mirajane Strauss", "Laxus Dreyar", 
    "Makarov Dreyar", "Zeref Dragneel", "Acnologia", "Gildarts Clive", "Cana Alberona", 
    "Levy McGarden", "Elfman Strauss", "Lisanna Strauss", "Sting Eucliffe", "Rogue Cheney", 
    "Carla", "Panther Lily", "Mavis Vermillion", "Ultear Milkovich", "Jellal Fernandes", 
    "Hades", "Jose Porla", "Cobra / Erik", "Minerva Orland", "Kagura Mikazuchi", 
    "Brandish μ", "Irene Belserion", "August", "Dimaria Yesta", "Larcade Dragneel", 
    "God Serena", "Mard Geer", "Jackal", "Kyôka", "Flare Corona", 
    "Lucy Ashley", "Romeo Conbolt", "Macao Conbolt", "Wakaba Mine", "Ichiya Vandalay Kotobuki", 
    "Freed Justine", "Evergreen", "Bickslow", "Mystogan", "Zatanna",
    "Light Yagami", "L", "Misa Amane", "Ryuk", "Near",
    "Kirito", "Asuna Yuuki", "Sinon", "Alice Zuberg", "Eugeo", 
    "Leafa", "Yui", "Klein", "Agil", "Lisbeth",
    "Izuku Midoriya", "Katsuki Bakugo", "Shoto Todoroki", "Ochaco Uraraka", "All Might", 
    "Tomura Shigaraki", "Dabi", "Himiko Toga", "Endeavor", "Eijiro Kirishima", 
    "Tenya Iida", "Tsuyu Asui", "Momo Yaoyorozu", "Fumikage Tokoyami", "Denki Kaminari", 
    "Mina Ashido", "Yuga Aoyama", "Minoru Mineta", "Kyoka Jiro", "Hanta Sero", 
    "Mezo Shoji", "Mashirao Ojiro", "Toru Hagakure", "Rikido Sato", "Koji Koda", 
    "Mirio Togata", "Tamaki Amajiki", "Nejire Hado", "Shota Aizawa", "Present Mic", 
    "Hawks", "Mirko", "Best Jeanist", "Mt. Lady", "Gran Torino", 
    "Sir Nighteye", "Stain", "Overhaul", "Twice", "Mr. Compress", 
    "Spinner", "Kurogiri", "Lady Nagant", "Gentle Criminal", "La Brava", 
    "Star and Stripe", "All For One", "Gigantomachia", "Eri", "Inko Midoriya",
    "Eren Jäger", "Mikasa Ackerman", "Armin Arlert", "Levi Ackerman", "Erwin Smith", 
    "Reiner Braun", "Annie Leonhart", "Historia Reiss", "Jean Kirstein", "Sasha Blouse", 
    "Hange Zoë", "Connie Springer", "Bertholdt Hoover", "Zeke Jäger", "Falco Grice", 
    "Gabi Braun", "Pieck Finger", "Porco Galliard", "Ymir", "Ymir Fritz", 
    "Kenny Ackerman", "Grisha Jäger", "Carla Jäger", "Hannes", "Floch Forster", 
    "Marco Bott", "Petra Ral", "Mike Zacharias", "Moblit Berner",
    "Sung Jin-Woo", "Cha Hae-In", "Beru", "Igris", "Thomas Andre", 
    "Go Gun-Hee", "Sung Il-Hwan", "Yoo Jin-Ho", "Baek Yoon-Ho", "Choi Jong-In",
    "Tanjiro Kamado", "Nezuko Kamado", "Zenitsu Agatsuma", "Inosuke Hashibira", "Giyu Tomioka", 
    "Kyojuro Rengoku", "Shinobu Kocho", "Tengen Uzui", "Muichiro Tokito", "Mitsuri Kanroji", 
    "Sanemi Shinazugawa", "Gyomei Himejima", "Obanai Iguro", "Akaza", "Muzan Kibutsuji", 
    "Doma", "Kokushibo", "Genya Shinazugawa", "Kanao Tsuyuri", "Aoi Kanzaki",
    "Satoru Gojo", "Yuji Itadori", "Megumi Fushiguro", "Nobara Kugisaki", "Ryomen Sukuna", 
    "Yuta Okkotsu", "Suguru Geto", "Toji Fushiguro", "Maki Zenin", "Kento Nanami", 
    "Aoi Todo", "Mahito", "Kenjaku", "Choso", "Toge Inumaki", 
    "Panda", "Mei Mei", "Ui Ui", "Shoko Ieiri", "Masamichi Yaga",
    "Koro-sensei", "Nagisa Shiota", "Karma Akabane", "Kaede Kayano", "Tadaomi Karasuma", 
    "Irina Jelavić", "Gakushu Asano", "Manami Okuda", "Rio Nakamura",
    "Kiyotaka Ayanokoji", "Suzune Horikita", "Kei Karuizawa", "Arisu Sakayanagi", "Kakeru Ryuen", 
    "Honami Ichinose",
    "Gon Freecss", "Killua Zoldyck", "Kurapika", "Leorio Paradinight", "Hisoka Morow", 
    "Chrollo Lucilfer", "Meruem", "Isaac Netero", "Illumi Zoldyck", "Biscuit Krueger", 
    "Ging Freecss", "Kite", "Feitan Portor", "Shalnark", "Machi Komacine", 
    "Nobunaga Hazama", "Franklin Bordeau", "Phinks Magcub", "Shizuku Murasaki", "Pakunoda", 
    "Uvogin", "Kalluto Zoldyck", "Silva Zoldyck", "Zeno Zoldyck", "Kikyo Zoldyck", 
    "Alluka Zoldyck", "Nanika", "Menthuthuyoupi", "Shaiapouf", "Neferpitou", 
    "Komugi", "Colt", "Morel Mackernasey", "Knov", "Knuckle Bine", 
    "Shoot McMahon", "Palm Siberia", "Gon’s Adult Form", "Razor", "Genthru", 
    "Greed Island’s Tzesguerra", "Kite’s Crazy Slots", "Hanzo", "Tonpa", "Canary", 
    "Gotoh", "Amane", "Gyro", "Pariston Hill", "Beyond Netero",
    "Saitama", "Genos", "Tatsumaki", "Garou", "King", "Fubuki",
    "Denji", "Makima", "Power", "Aki Hayakawa", "Reze", 
    "Pochita", "Kobeni Higashiyama", "Kishibe", "Himeno", "Asa Mitaka", "Yoru",
    "Ken Kaneki", "Touka Kirishima", "Rize Kamishiro", "Hideyoshi Nagachika"
];

io.on('connection', (socket) => {
    socket.on('join_room', ({ roomCode, username, mode, subMode }) => {
        socket.join(roomCode);

        if (!rooms[roomCode]) {
            rooms[roomCode] = {
                code: roomCode,
                mode: mode,
                subMode: subMode || 'normal',
                host: socket.id,
                players: [],
                status: 'waiting', 
                currentThemeMasterIndex: 0,
                currentTheme: '',
                currentTurnIndex: 0,
                votes: {},
                noImpostor: false
            };
        }

        const room = rooms[roomCode];
        room.subMode = subMode || room.subMode;
        
        let existingPlayer = room.players.find(p => p.id === socket.id);
        if (!existingPlayer) {
            room.players.push({
                id: socket.id,
                name: username,
                clue: '',
                isImpostor: false,
                isAlive: true,
                secretData: null
            });
        }

        io.to(roomCode).emit('update_room', room);
    });

    socket.on('start_game', (roomCode) => {
        const room = rooms[roomCode];
        if (room && room.host === socket.id) {
            launchNewRound(room);
        }
    });

    function launchNewRound(room) {
        room.votes = {};
        room.currentTurnIndex = 0;
        room.noImpostor = false;

        room.players.forEach(p => {
            p.clue = '';
            p.isAlive = true;
            p.isImpostor = false;
            p.secretData = null;
        });

        let firstAlive = room.players.findIndex(p => p.isAlive);
        room.currentTurnIndex = firstAlive !== -1 ? firstAlive : 0;

        if (room.mode === 'note') {
            const realScore = Math.floor(Math.random() * 8) + 2;
            let offset = (Math.floor(Math.random() * 3) + 1) * (Math.random() < 0.5 ? 1 : -1);
            let fakeScore = realScore + offset;
            if (fakeScore < 1) fakeScore = 1;
            if (fakeScore > 10) fakeScore = 10;
            if (fakeScore === realScore) fakeScore = realScore === 10 ? realScore - 1 : realScore + 1;

            let impostorCount = room.players.length >= 5 ? 2 : 1;
            let assignedIndexes = [];
            while(assignedIndexes.length < impostorCount) {
                let idx = Math.floor(Math.random() * room.players.length);
                if(!assignedIndexes.includes(idx)) {
                    assignedIndexes.push(idx);
                    room.players[idx].isImpostor = true;
                }
            }

            room.players.forEach(p => {
                p.secretData = p.isImpostor ? fakeScore : realScore;
            });

            room.currentThemeMasterIndex = (room.currentThemeMasterIndex + 1) % room.players.length;
            room.status = 'choose_theme';
            io.to(room.code).emit('prompt_theme_choice', { room: room, themeMasterId: room.players[room.currentThemeMasterIndex].id });

        } else if (room.mode === 'undercover') {
            if (room.subMode === 'hardcore') {
                const scenario = Math.random();
                if (scenario < 0.25) {
                    room.noImpostor = true;
                    const sharedPerso = HARDCORE_CHARACTERS[Math.floor(Math.random() * HARDCORE_CHARACTERS.length)];
                    room.players.forEach(p => { p.secretData = sharedPerso; p.isImpostor = false; });
                } else if (scenario < 0.55) {
                    const sharedPerso = HARDCORE_CHARACTERS[Math.floor(Math.random() * HARDCORE_CHARACTERS.length)];
                    const impIdx = Math.floor(Math.random() * room.players.length);
                    const diffPerso = HARDCORE_CHARACTERS.filter(c => c !== sharedPerso)[Math.floor(Math.random() * (HARDCORE_CHARACTERS.length - 1))];
                    
                    room.players.forEach((p, idx) => {
                        if (idx === impIdx) {
                            p.isImpostor = true;
                            p.secretData = diffPerso;
                        } else {
                            p.isImpostor = false;
                            p.secretData = sharedPerso;
                        }
                    });
                } else {
                    let civilPerso = HARDCORE_CHARACTERS[Math.floor(Math.random() * HARDCORE_CHARACTERS.length)];
                    let otherPersos = HARDCORE_CHARACTERS.filter(c => c !== civilPerso);
                    let undercoverPerso = otherPersos[Math.floor(Math.random() * otherPersos.length)];

                    let impCount = room.players.length >= 5 ? 2 : 1;
                    let assignedIndexes = [];
                    while(assignedIndexes.length < impCount) {
                        let idx = Math.floor(Math.random() * room.players.length);
                        if(!assignedIndexes.includes(idx)) {
                            assignedIndexes.push(idx);
                            room.players[idx].isImpostor = true;
                        }
                    }

                    room.players.forEach((p, idx) => {
                        p.secretData = p.isImpostor ? undercoverPerso : civilPerso;
                    });
                }
            } else {
                const pair = undercoverPairs[Math.floor(Math.random() * undercoverPairs.length)];
                let impCount = room.players.length >= 5 ? 2 : 1;
                let assignedIndexes = [];
                while(assignedIndexes.length < impCount) {
                    let idx = Math.floor(Math.random() * room.players.length);
                    if(!assignedIndexes.includes(idx)) {
                        assignedIndexes.push(idx);
                        room.players[idx].isImpostor = true;
                    }
                }
                room.players.forEach(p => {
                    p.secretData = p.isImpostor ? pair[1] : pair[0];
                });
            }

            room.currentTheme = "Undercover";
            room.status = 'reveal';
            io.to(room.code).emit('launch_reveal', room);
        }
    }

    socket.on('submit_custom_theme', ({ roomCode, theme }) => {
        const room = rooms[roomCode];
        if (room && room.players[room.currentThemeMasterIndex].id === socket.id) {
            room.currentTheme = theme;
            room.status = 'gameplay';
            io.to(roomCode).emit('theme_chosen', room);
            io.to(roomCode).emit('launch_reveal', room);
        }
    });

    socket.on('change_theme_mid_game', ({ roomCode }) => {
        const room = rooms[roomCode];
        if (room && room.mode === 'note') {
            room.currentThemeMasterIndex = (room.currentThemeMasterIndex + 1) % room.players.length;
            room.status = 'choose_theme';
            room.players.forEach(p => p.clue = '');
            let firstAlive = room.players.findIndex(p => p.isAlive);
            room.currentTurnIndex = firstAlive !== -1 ? firstAlive : 0;
            io.to(room.code).emit('prompt_theme_choice', { room: room, themeMasterId: room.players[room.currentThemeMasterIndex].id });
        }
    });

    socket.on('submit_clue', ({ roomCode, clue }) => {
        const room = rooms[roomCode];
        if (room) {
            const sender = room.players.find(p => p.id === socket.id);
            if (sender && !sender.isAlive) return;

            if (room.players[room.currentTurnIndex]) {
                room.players[room.currentTurnIndex].clue = clue;
            }
            
            do {
                room.currentTurnIndex++;
            } while (room.currentTurnIndex < room.players.length && !room.players[room.currentTurnIndex].isAlive);

            if (room.currentTurnIndex < room.players.length) {
                io.to(roomCode).emit('update_gameplay', room);
            } else {
                room.status = room.mode === 'note' ? 'end_clues_note' : 'end_clues_undercover';
                if (room.mode === 'note') {
                    io.to(roomCode).emit('prompt_end_clue_options', room);
                } else {
                    io.to(roomCode).emit('prompt_end_clue_options_undercover', room);
                }
            }
        }
    });

    socket.on('restart_clues_undercover', ({ roomCode }) => {
        const room = rooms[roomCode];
        if (room && room.mode === 'undercover') {
            room.players.forEach(p => p.clue = '');
            let firstAlive = room.players.findIndex(p => p.isAlive);
            room.currentTurnIndex = firstAlive !== -1 ? firstAlive : 0;
            room.status = 'gameplay';
            io.to(room.code).emit('resume_gameplay', room);
        }
    });

    socket.on('force_start_voting', ({ roomCode }) => {
        const room = rooms[roomCode];
        if (room) {
            room.status = 'voting';
            io.to(roomCode).emit('start_voting', room);
        }
    });

    socket.on('cast_vote', ({ roomCode, targetId }) => {
        const room = rooms[roomCode];
        if (!room) return;

        const voterPlayer = room.players.find(p => p.id === socket.id);
        if (voterPlayer && !voterPlayer.isAlive) return;

        room.votes[socket.id] = targetId;
        let alivePlayers = room.players.filter(p => p.isAlive);

        if (Object.keys(room.votes).length >= alivePlayers.length) {
            let noImpostorVotes = 0;
            let voteCounts = {};
            room.players.forEach(p => voteCounts[p.id] = 0);

            for (let voter in room.votes) {
                let target = room.votes[voter];
                if (target === 'no_impostor') {
                    noImpostorVotes++;
                } else if (target !== 'pass' && voteCounts[target] !== undefined) {
                    voteCounts[target]++;
                }
            }

            let gameOver = false;
            let winnerMessage = "";
            let eliminatedPlayer = null;

            if (room.noImpostor && noImpostorVotes > (alivePlayers.length / 2)) {
                gameOver = true;
                winnerMessage = "🎉 Victoire générale ! Les joueurs ont deviné qu'il n'y avait aucun imposteur.";
            } else {
                let maxVotes = -1;
                let eliminatedId = null;
                let isTie = false;

                for (let playerId in voteCounts) {
                    if (voteCounts[playerId] > maxVotes) {
                        maxVotes = voteCounts[playerId];
                        eliminatedId = playerId;
                        isTie = false;
                    } else if (voteCounts[playerId] === maxVotes && maxVotes > 0) {
                        isTie = true;
                    }
                }

                if (!isTie && maxVotes > 0) {
                    eliminatedPlayer = room.players.find(p => p.id === eliminatedId);
                    if (eliminatedPlayer) eliminatedPlayer.isAlive = false;
                }

                let remainingAlive = room.players.filter(p => p.isAlive);
                let aliveImpostors = remainingAlive.filter(p => p.isImpostor);
                let aliveCivilians = remainingAlive.filter(p => !p.isImpostor);

                if (room.noImpostor && eliminatedPlayer) {
                    gameOver = true;
                    winnerMessage = "💥 Défaite ! Vous avez éliminé quelqu'un alors qu'il n'y avait aucun imposteur.";
                } else if (aliveImpostors.length === 0) {
                    gameOver = true;
                    winnerMessage = "🎉 Victoire des Civils ! Tous les imposteurs ont été éliminés.";
                } else if (aliveImpostors.length >= aliveCivilians.length) {
                    gameOver = true;
                    winnerMessage = "💥 Victoire des Imposteurs !";
                }
            }

            room.status = gameOver ? 'game_over' : 'round_result';
            io.to(roomCode).emit('show_results', { room, eliminatedPlayer, gameOver, winnerMessage });
        }
    });

    socket.on('next_step_game', (roomCode) => {
        const room = rooms[roomCode];
        if (room) {
            let remainingAlive = room.players.filter(p => p.isAlive);
            let aliveImpostors = remainingAlive.filter(p => p.isImpostor);
            let aliveCivilians = remainingAlive.filter(p => !p.isImpostor);

            if (room.noImpostor || aliveImpostors.length === 0 || aliveImpostors.length >= aliveCivilians.length) {
                launchNewRound(room);
            } else {
                room.status = 'gameplay';
                room.votes = {};
                room.players.forEach(p => p.clue = '');
                let firstAlive = room.players.findIndex(p => p.isAlive);
                room.currentTurnIndex = firstAlive !== -1 ? firstAlive : 0;
                io.to(roomCode).emit('resume_gameplay', room);
            }
        }
    });

    socket.on('back_to_menu', (roomCode) => {
        const room = rooms[roomCode];
        if (room) {
            room.status = 'waiting';
            io.to(roomCode).emit('update_room', room);
        }
    });

    socket.on('disconnect', () => {
        for (let roomCode in rooms) {
            let room = rooms[roomCode];
            room.players = room.players.filter(p => p.id !== socket.id);
            if (room.players.length === 0) {
                delete rooms[roomCode];
            } else {
                io.to(roomCode).emit('update_room', room);
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Serveur Anime Game démarré sur le port ${PORT}`);
});
