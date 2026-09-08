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

io.on('connection', (socket) => {
    console.log(`Un joueur s'est connecté : ${socket.id}`);

    // Créer une salle
    socket.on('create_room', ({ roomCode, username, mode }) => {
        socket.join(roomCode);
        rooms[roomCode] = {
            code: roomCode,
            mode: mode || 'undercover',
            host: socket.id,
            players: [{
                id: socket.id,
                name: username,
                clue: '',
                isImpostor: false,
                isAlive: true,
                secretData: null
            }],
            status: 'waiting', 
            currentThemeMasterId: null,
            currentTheme: '',
            currentTurnIndex: 0,
            votes: {},
            themeChangeVotes: []
        };
        io.to(roomCode).emit('update_room', rooms[roomCode]);
    });

    // Rejoindre une salle existante via le code
    socket.on('join_room_code', ({ roomCode, username }) => {
        const room = rooms[roomCode];
        if (!room) {
            socket.emit('room_error', "Cette salle n'existe pas ! Vérifie le code.");
            return;
        }

        socket.join(roomCode);
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
        } else {
            existingPlayer.name = username;
        }

        io.to(roomCode).emit('update_room', room);
    });

    socket.on('change_mode', ({ roomCode, mode }) => {
        const room = rooms[roomCode];
        if (room && room.host === socket.id) {
            room.mode = mode;
            io.to(roomCode).emit('update_room', room);
        }
    });

    socket.on('start_game', (roomCode) => {
        const room = rooms[roomCode];
        if (room && room.host === socket.id) {
            launchNewRound(room);
        }
    });

    function launchNewRound(room) {
        room.votes = {};
        room.themeChangeVotes = [];
        room.currentTurnIndex = 0;

        room.players.forEach(p => {
            p.clue = '';
            p.isAlive = true;
            p.isImpostor = false;
            p.secretData = null;
        });

        let impostorCount = room.players.length >= 5 ? 2 : 1;
        let assignedIndexes = [];
        while(assignedIndexes.length < impostorCount) {
            let randomIndex = Math.floor(Math.random() * room.players.length);
            if(!assignedIndexes.includes(randomIndex)) {
                assignedIndexes.push(randomIndex);
                room.players[randomIndex].isImpostor = true;
            }
        }

        if (room.mode === 'note') {
            let randomMaster = room.players[Math.floor(Math.random() * room.players.length)];
            room.currentThemeMasterId = randomMaster.id;
            room.status = 'choose_theme';
            io.to(room.code).emit('start_theme_choice', room);
        } else {
            const pair = undercoverPairs[Math.floor(Math.random() * undercoverPairs.length)];
            room.players.forEach(p => {
                p.secretData = p.isImpostor ? pair[1] : pair[0];
            });
            room.currentTheme = "Undercover";
            room.status = 'reveal';
            io.to(room.code).emit('launch_reveal', room);
        }
    }

    socket.on('vote_change_theme', (roomCode) => {
        const room = rooms[roomCode];
        if (room && room.status === 'choose_theme') {
            if (!room.themeChangeVotes.includes(socket.id)) {
                room.themeChangeVotes.push(socket.id);
            }

            let totalPlayers = room.players.length;
            let neededVotes = Math.ceil(totalPlayers / 2);

            if (room.themeChangeVotes.length >= neededVotes) {
                room.themeChangeVotes = [];
                let randomMaster = room.players[Math.floor(Math.random() * room.players.length)];
                room.currentThemeMasterId = randomMaster.id;
                io.to(roomCode).emit('start_theme_choice', room);
            } else {
                io.to(roomCode).emit('update_theme_votes', {
                    currentVotes: room.themeChangeVotes.length,
                    neededVotes: neededVotes
                });
            }
        }
    });

    socket.on('submit_theme', ({ roomCode, theme }) => {
        const room = rooms[roomCode];
        if (room) {
            room.currentTheme = theme;
            room.themeChangeVotes = [];

            const realScore = (Math.floor(Math.random() * 3) + 8);
            let fakeScore = Math.floor(Math.random() * 5) + 2;
            if (fakeScore === realScore) fakeScore = realScore > 5 ? realScore - 3 : realScore + 3;

            room.players.forEach(p => {
                p.secretData = p.isImpostor ? `${fakeScore}/10` : `${realScore}/10`;
            });

            room.status = 'reveal';
            io.to(room.code).emit('launch_reveal', room);
        }
    });

    socket.on('submit_clue', ({ roomCode, clue }) => {
        const room = rooms[roomCode];
        if (room) {
            room.players[room.currentTurnIndex].clue = clue;
            
            do {
                room.currentTurnIndex++;
            } while (room.currentTurnIndex < room.players.length && !room.players[room.currentTurnIndex].isAlive);

            if (room.currentTurnIndex < room.players.length) {
                io.to(roomCode).emit('update_gameplay', room);
            } else {
                room.status = 'voting';
                io.to(roomCode).emit('start_voting', room);
            }
        }
    });

    socket.on('cast_vote', ({ roomCode, targetId }) => {
        const room = rooms[roomCode];
        if (!room) return;

        room.votes[socket.id] = targetId;
        let alivePlayers = room.players.filter(p => p.isAlive);

        if (Object.keys(room.votes).length >= alivePlayers.length) {
            let voteCounts = {};
            room.players.forEach(p => voteCounts[p.id] = 0);

            for (let voter in room.votes) {
                let target = room.votes[voter];
                if (target !== 'pass' && voteCounts[target] !== undefined) {
                    voteCounts[target]++;
                }
            }

            let maxVotes = -1;
            let eliminatedPlayerId = null;
            let isTie = false;

            for (let playerId in voteCounts) {
                if (voteCounts[playerId] > maxVotes) {
                    maxVotes = voteCounts[playerId];
                    eliminatedPlayerId = playerId;
                    isTie = false;
                } else if (voteCounts[playerId] === maxVotes && maxVotes > 0) {
                    isTie = true;
                }
            }

            let eliminatedPlayer = isTie ? null : room.players.find(p => p.id === eliminatedPlayerId);
            if (eliminatedPlayer) {
                eliminatedPlayer.isAlive = false;
            }

            let remainingAlive = room.players.filter(p => p.isAlive);
            let aliveImpostors = remainingAlive.filter(p => p.isImpostor);
            let aliveCivilians = remainingAlive.filter(p => !p.isImpostor);

            let gameOver = false;
            let winnerMessage = "";

            if (aliveImpostors.length === 0) {
                gameOver = true;
                winnerMessage = "🎉 Victoire des Civils ! Tous les imposteurs ont été éliminés.";
            } else if (aliveImpostors.length >= aliveCivilians.length) {
                gameOver = true;
                winnerMessage = "💥 Victoire des Imposteurs ! Ils sont désormais aussi nombreux ou plus nombreux que les civils.";
            }

            room.status = gameOver ? 'game_over' : 'round_result';
            
            io.to(roomCode).emit('show_results', { 
                room, 
                eliminatedPlayer, 
                gameOver,
                winnerMessage
            });
        }
    });

    socket.on('next_step_game', (roomCode) => {
        const room = rooms[roomCode];
        if (room) {
            let remainingAlive = room.players.filter(p => p.isAlive);
            let aliveImpostors = remainingAlive.filter(p => p.isImpostor);
            let aliveCivilians = remainingAlive.filter(p => !p.isImpostor);

            if (aliveImpostors.length === 0 || aliveImpostors.length >= aliveCivilians.length) {
                launchNewRound(room);
            } else {
                room.status = 'gameplay';
                room.votes = {};
                room.players.forEach(p => p.clue = '');
                room.currentTurnIndex = room.players.findIndex(p => p.isAlive);
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
        console.log(`Un joueur est parti : ${socket.id}`);
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
