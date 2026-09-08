const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

const server = http.createServer(app);
const io = new Server(server);

// Stockage des salons de jeux actifs
const rooms = {};

io.on('connection', (socket) => {
    console.log(`Un joueur s'est connecté : ${socket.id}`);

    // Créer ou rejoindre un salon
    socket.on('join_room', ({ roomCode, username, mode }) => {
        socket.join(roomCode);

        if (!rooms[roomCode]) {
            rooms[roomCode] = {
                code: roomCode,
                mode: mode,
                host: socket.id,
                players: [],
                status: 'waiting', 
                currentThemeMasterIndex: 0,
                currentTheme: '',
                currentTurnIndex: 0
            };
        }

        const room = rooms[roomCode];
        
        let existingPlayer = room.players.find(p => p.id === socket.id);
        if (!existingPlayer) {
            room.players.push({
                id: socket.id,
                name: username,
                clue: '',
                isImpostor: false,
                secretData: null
            });
        }

        io.to(roomCode).emit('update_room', room);
    });

    // Lancer la partie depuis le salon d'attente
    socket.on('start_game', (roomCode) => {
        const room = rooms[roomCode];
        if (room && room.host === socket.id) {
            room.status = 'theme_selection';
            room.currentThemeMasterIndex = 0;
            io.to(roomCode).emit('game_started', room);
        }
    });

    // Le maître du jeu soumet le thème (Mode Note) ou passage direct
    socket.on('submit_theme', ({ roomCode, theme }) => {
        const room = rooms[roomCode];
        if (room) {
            room.currentTheme = theme;
            
            let impostorCount = room.players.length >= 5 ? 2 : 1;
            room.players.forEach(p => p.isImpostor = false);

            let assignedIndexes = [];
            while(assignedIndexes.length < impostorCount) {
                let randomIndex = Math.floor(Math.random() * room.players.length);
                if(!assignedIndexes.includes(randomIndex)) {
                    assignedIndexes.push(randomIndex);
                    room.players[randomIndex].isImpostor = true;
                }
            }

            if (room.mode === 'note') {
                const realScore = Math.floor(Math.random() * 3) + 8; // 8, 9 ou 10
                let fakeScore = Math.floor(Math.random() * 5) + 2;   // 2 à 6
                if (fakeScore === realScore) fakeScore = realScore > 5 ? realScore - 3 : realScore + 3;

                room.players.forEach(p => {
                    p.secretData = p.isImpostor ? fakeScore : realScore;
                });
            } else if (room.mode === 'undercover') {
                const pairs = [["Kenjaku", "Geto"], ["Tengen", "Kakashi"], ["Kisame", "Requin"], ["Yuji", "Sukuna"]];
                const pair = pairs[Math.floor(Math.random() * pairs.length)];
                room.players.forEach(p => {
                    p.secretData = p.isImpostor ? pair[1] : pair[0];
                });
            }

            room.status = 'reveal';
            io.to(roomCode).emit('launch_reveal', room);
        }
    });

    // Soumettre un indice pendant le tour de parole
    socket.on('submit_clue', ({ roomCode, clue }) => {
        const room = rooms[roomCode];
        if (room) {
            room.players[room.currentTurnIndex].clue = clue;
            room.currentTurnIndex++;

            if (room.currentTurnIndex < room.players.length) {
                io.to(roomCode).emit('update_gameplay', room);
            } else {
                room.status = room.mode === 'note' ? 'choice' : 'voting';
                io.to(roomCode).emit('end_clues', room);
            }
        }
    });

    // Passer à la phase de vote
    socket.on('go_to_vote', (roomCode) => {
        const room = rooms[roomCode];
        if (room) {
            room.status = 'voting';
            io.to(roomCode).emit('start_voting', room);
        }
    });

    // Voter contre un joueur
    socket.on('cast_vote', ({ roomCode, targetId }) => {
        const room = rooms[roomCode];
        if (room) {
            const eliminatedPlayer = room.players.find(p => p.id === targetId);
            room.status = 'result';
            io.to(roomCode).emit('show_results', { room, eliminatedPlayer });
        }
    });

    // Déconnexion d'un joueur
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
