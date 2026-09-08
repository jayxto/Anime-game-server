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

io.on('connection', (socket) => {
    console.log(`Un joueur s'est connecté : ${socket.id}`);

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
                currentTurnIndex: 0,
                votes: {} // Stocke les votes de chacun { voterId: targetId }
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

    socket.on('start_game', (roomCode) => {
        const room = rooms[roomCode];
        if (room && room.host === socket.id) {
            room.status = 'theme_selection';
            room.currentThemeMasterIndex = 0;
            io.to(roomCode).emit('game_started', room);
        }
    });

    socket.on('submit_theme', ({ roomCode, theme }) => {
        const room = rooms[roomCode];
        if (room) {
            room.currentTheme = theme;
            room.votes = {};
            
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
                const realScore = Math.floor(Math.random() * 3) + 8;
                let fakeScore = Math.floor(Math.random() * 5) + 2;
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

    socket.on('submit_clue', ({ roomCode, clue }) => {
        const room = rooms[roomCode];
        if (room) {
            room.players[room.currentTurnIndex].clue = clue;
            room.currentTurnIndex++;

            if (room.currentTurnIndex < room.players.length) {
                io.to(roomCode).emit('update_gameplay', room);
            } else {
                room.status = 'voting';
                io.to(roomCode).emit('start_voting', room);
            }
        }
    });

    socket.on('go_to_vote', (roomCode) => {
        const room = rooms[roomCode];
        if (room) {
            room.status = 'voting';
            io.to(roomCode).emit('start_voting', room);
        }
    });

    // Enregistrement des votes de chaque joueur
    socket.on('cast_vote', ({ roomCode, targetId }) => {
        const room = rooms[roomCode];
        if (!room) return;

        room.votes[socket.id] = targetId; // targetId peut être un id de joueur ou 'pass'

        // Si tout le monde a voté, on calcule les résultats
        if (Object.keys(room.votes).length >= room.players.length) {
            let voteCounts = {};
            room.players.forEach(p => voteCounts[p.id] = 0);

            for (let voter in room.votes) {
                let target = room.votes[voter];
                if (target !== 'pass' && voteCounts[target] !== undefined) {
                    voteCounts[target]++;
                }
            }

            // Trouver celui qui a le plus de votes
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
            
            // Vérifier si l'imposteur a été éliminé
            let impostors = room.players.filter(p => p.isImpostor);
            let impostorCaught = eliminatedPlayer ? eliminatedPlayer.isImpostor : false;

            room.status = 'result';
            io.to(roomCode).emit('show_results', { 
                room, 
                eliminatedPlayer, 
                impostors, 
                impostorCaught 
            });
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
