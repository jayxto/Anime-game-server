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

// Listes de mots pour le mode Undercover
const undercoverPairs = [
    ["Kenjaku", "Geto"], ["Tengen", "Kakashi"], ["Kisame", "Requin"], 
    ["Yuji", "Sukuna"], ["Naruto", "Sasuke"], ["Goku", "Vegeta"], 
    ["Luffy", "Zoro"], ["Tanjiro", "Nezuko"], ["Eren", "Reiner"]
];

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
                votes: {}
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
        room.status = 'theme_selection';
        room.votes = {};
        room.currentTurnIndex = 0;

        // Réinitialiser les indices et l'état vivant des joueurs pour une nouvelle partie
        room.players.forEach(p => {
            p.clue = '';
            p.isAlive = true;
            p.isImpostor = false;
            p.secretData = null;
        });

        // Rotation du maître du jeu (si mode note)
        room.currentThemeMasterIndex = (room.currentThemeMasterIndex + 1) % room.players.length;

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
            const realScore = Math.floor(Math.random() * 3) + 8;
            let fakeScore = Math.floor(Math.random() * 5) + 2;
            if (fakeScore === realScore) fakeScore = realScore > 5 ? realScore - 3 : realScore + 3;

            room.players.forEach(p => {
                p.secretData = p.isImpostor ? fakeScore : realScore;
            });
            room.currentTheme = "Anime Général";
            room.status = 'reveal';
            io.to(room.code).emit('launch_reveal', room);
        } else if (room.mode === 'undercover') {
            const pair = undercoverPairs[Math.floor(Math.random() * undercoverPairs.length)];
            room.players.forEach(p => {
                p.secretData = p.isImpostor ? pair[1] : pair[0];
            });
            room.currentTheme = "Univers Anime";
            room.status = 'reveal';
            io.to(room.code).emit('launch_reveal', room);
        }
    }

    socket.on('submit_theme', ({ roomCode, theme }) => {
        const room = rooms[roomCode];
        if (room) {
            room.currentTheme = theme;
            room.status = 'reveal';
            io.to(roomCode).emit('launch_reveal', room);
        }
    });

    socket.on('submit_clue', ({ roomCode, clue }) => {
        const room = rooms[roomCode];
        if (room) {
            // Trouver le prochain joueur vivant pour le tour
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

    socket.on('go_to_vote', (roomCode) => {
        const room = rooms[roomCode];
        if (room) {
            room.status = 'voting';
            io.to(roomCode).emit('start_voting', room);
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

            // Vérifier les conditions de fin de partie
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

    // Passer au tour de vote suivant ou relancer une nouvelle partie complète
    socket.on('next_step_game', (roomCode) => {
        const room = rooms[roomCode];
        if (room) {
            let remainingAlive = room.players.filter(p => p.isAlive);
            let aliveImpostors = remainingAlive.filter(p => p.isImpostor);
            let aliveCivilians = remainingAlive.filter(p => !p.isImpostor);

            if (aliveImpostors.length === 0 || aliveImpostors.length >= aliveCivilians.length) {
                // Partie finie, on relance une nouvelle partie complète
                launchNewRound(room);
            } else {
                // Continuer la partie (tour de parole suivant avec les joueurs restants)
                room.status = 'gameplay';
                room.votes = {};
                room.players.forEach(p => p.clue = '');
                
                // Trouver le premier joueur vivant
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
