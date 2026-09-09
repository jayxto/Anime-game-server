const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

const rooms = {};

const undercoverPairs = [
    ["Naruto Uzumaki", "Sasuke Uchiha"],
    ["Goku", "Vegeta"],
    ["Luffy", "Zoro"],
    ["Tanjiro Kamado", "Nezuko Kamado"],
    ["Eren Yeager", "Mikasa Ackerman"],
    ["Light Yagami", "L"],
    ["Satoru Gojo", "Sukuna"],
    ["Denji", "Power"],
    ["Asta", "Yuno"],
    ["Ichigo Kurosaki", "Rukia Kuchiki"]
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

        room.status = 'choosing_theme';
        const themeMasterId = room.players[0].id;

        io.to(roomCode).emit('prompt_theme_choice', { room, themeMasterId });
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
                    const defaultWord = room.currentTheme || "Personnage mystère";
                    room.players.forEach(p => {
                        p.isImpostor = false;
                        p.secretData = defaultWord;
                    });
                } else {
                    assignUndercoverWords(room);
                }
            } else {
                assignUndercoverWords(room);
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

    function assignUndercoverWords(room) {
        const pair = undercoverPairs[Math.floor(Math.random() * undercoverPairs.length)];
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

        room.status = 'choosing_theme';
        room.currentTurnIndex = 0;
        room.players.forEach(p => p.clue = '');
        
        const themeMasterId = room.players[0].id;
        io.to(roomCode).emit('prompt_theme_choice', { room, themeMasterId });
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
