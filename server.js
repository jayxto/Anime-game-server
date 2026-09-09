const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const rooms = {};

io.on('connection', (socket) => {
    console.log(`Un utilisateur s'est connecté : ${socket.id}`);

    // Rejoindre ou créer une salle avec mode et subMode
    socket.on('join_room', ({ roomCode, username, mode, subMode }) => {
        socket.join(roomCode);

        if (!rooms[roomCode]) {
            rooms[roomCode] = {
                code: roomCode,
                host: socket.id,
                mode: mode || 'undercover',
                subMode: subMode || 'normal', // Stocke 'normal' ou 'hardcore'
                players: [],
                gameState: 'waiting',
                currentTurnIndex: 0,
                currentTheme: ''
            };
        }

        // Évite les doublons de socket dans la salle
        rooms[roomCode].players = rooms[roomCode].players.filter(p => p.id !== socket.id);
        rooms[roomCode].players.push({
            id: socket.id,
            name: username,
            isAlive: true,
            isImpostor: false,
            secretData: null,
            clue: null,
            votes: 0
        });

        io.to(roomCode).emit('update_room', rooms[roomCode]);
    });

    // Lancer la partie
    socket.on('start_game', (roomCode) => {
        const room = rooms[roomCode];
        if (!room) return;

        room.gameState = 'playing';
        room.currentTurnIndex = 0;
        room.currentTheme = '';

        // Réinitialisation des joueurs
        room.players.forEach(p => {
            p.isAlive = true;
            p.isImpostor = false;
            p.secretData = null;
            p.clue = null;
            p.votes = 0;
        });

        if (room.mode === 'note') {
            // Mode "Devine la note"
            const themeMaster = room.players[Math.floor(Math.random() * room.players.length)];
            room.players.forEach(p => {
                if (p.id === themeMaster.id) {
                    p.secretData = 'Maître du jeu (Choisit le thème)';
                } else {
                    p.secretData = Math.floor(Math.random() * 10) + 1; // Note secrète entre 1 et 10
                }
            });
            io.to(roomCode).emit('prompt_theme_choice', {
                room: room,
                themeMasterId: themeMaster.id
            });
        } else if (room.mode === 'undercover') {
            // Mode Undercover (Normal ou Hardcore)
            room.currentTheme = "Thème par défaut (Animaux/Animes)"; // Thème temporaire en attendant
            
            if (room.subMode === 'hardcore') {
                // Mode Hardcore : Pas d'imposteur, tout le monde a le même mot ou rôles similaires
                room.players.forEach(p => {
                    p.isImpostor = false;
                    p.secretData = "Personnage Hardcore Commun"; 
                });
            } else {
                // Mode Normal : Désignation d'un imposteur
                const impostorIndex = Math.floor(Math.random() * room.players.length);
                room.players.forEach((p, idx) => {
                    if (idx === impostorIndex) {
                        p.isImpostor = true;
                        p.secretData = "Mot de l'Imposteur";
                    } else {
                        p.isImpostor = false;
                        p.secretData = "Mot du Civil";
                    }
                });
            }

            io.to(roomCode).emit('launch_reveal', room);
        }
    });

    // Soumission du thème personnalisé (Mode note)
    socket.on('submit_custom_theme', ({ roomCode, theme }) => {
        const room = rooms[roomCode];
        if (!room) return;
        room.currentTheme = theme;
        io.to(roomCode).emit('theme_chosen', room);
        io.to(roomCode).emit('update_gameplay', room);
    });

    // Envoi d'un indice
    socket.on('submit_clue', ({ roomCode, clue }) => {
        const room = rooms[roomCode];
        if (!room) return;

        const currentPlayer = room.players[room.currentTurnIndex];
        if (currentPlayer && currentPlayer.id === socket.id) {
            currentPlayer.clue = clue;

            // Passer au joueur vivant suivant
            do {
                room.currentTurnIndex = (room.currentTurnIndex + 1) % room.players.length;
            } while (!room.players[room.currentTurnIndex].isAlive && room.currentTurnIndex !== 0);

            // Vérifier si tous les joueurs vivants ont joué
            const allAlivePlayed = room.players.every(p => !p.isAlive || p.clue !== null);

            if (allAlivePlayed) {
                if (room.subMode === 'hardcore') {
                    io.to(roomCode).emit('prompt_end_clue_options_undercover', room);
                } else {
                    io.to(roomCode).emit('prompt_end_clue_options', room);
                }
            } else {
                io.to(roomCode).emit('update_gameplay', room);
            }
        }
    });

    // Forcer le passage au vote
    socket.on('force_start_voting', ({ roomCode }) => {
        const room = rooms[roomCode];
        if (!room) return;
        io.to(roomCode).emit('start_voting', room);
    });

    // Enregistrement d'un vote
    socket.on('cast_vote', ({ roomCode, targetId }) => {
        const room = rooms[roomCode];
        if (!room) return;

        const voter = room.players.find(p => p.id === socket.id);
        if (voter) voter.hasVoted = true;

        if (targetId !== 'pass' && targetId !== 'no_impostor') {
            const target = room.players.find(p => p.id === targetId);
            if (target) target.votes = (target.votes || 0) + 1;
        }

        const allAliveVoted = room.players.every(p => !p.isAlive || p.hasVoted);
        if (allAliveVoted) {
            // Dépouillement des votes
            let eliminatedPlayer = null;
            let maxVotes = -1;
            let tie = false;

            room.players.forEach(p => {
                p.hasVoted = false; // Reset pour le prochain tour
                if (p.votes > maxVotes) {
                    maxVotes = p.votes;
                    eliminatedPlayer = p;
                    tie = false;
                } else if (p.votes === maxVotes && maxVotes > 0) {
                    tie = true;
                }
                p.votes = 0; // Reset des votes
            });

            if (tie || targetId === 'no_impostor') {
                eliminatedPlayer = null;
            } else if (eliminatedPlayer) {
                eliminatedPlayer.isAlive = false;
            }

            // Vérification de la condition de fin de partie
            let gameOver = false;
            let winnerMessage = "";

            const aliveCivilians = room.players.filter(p => p.isAlive && !p.isImpostor);
            const aliveImpostors = room.players.filter(p => p.isAlive && p.isImpostor);

            if (room.subMode === 'hardcore') {
                // En mode hardcore, si un certain nombre de tours est passé ou selon la règle choisie
                if (room.players.filter(p => p.isAlive).length <= 2) {
                    gameOver = true;
                    winnerMessage = "Fin de la partie Hardcore !";
                }
            } else {
                if (aliveImpostors.length === 0) {
                    gameOver = true;
                    winnerMessage = "Les Civils ont gagné ! (Imposteur éliminé)";
                } else if (aliveImpostors.length >= aliveCivilians.length) {
                    gameOver = true;
                    winnerMessage = "L'Imposteur a gagné !";
                }
            }

            io.to(roomCode).emit('show_results', {
                room: room,
                eliminatedPlayer: eliminatedPlayer,
                gameOver: gameOver,
                winnerMessage: winnerMessage
            });
        }
    });

    // Passer à la manche suivante
    socket.on('next_step_game', (roomCode) => {
        const room = rooms[roomCode];
        if (!room) return;
        
        room.players.forEach(p => {
            p.clue = null;
            p.hasVoted = false;
        });
        room.currentTurnIndex = 0;

        io.to(roomCode).emit('resume_gameplay', room);
    });

    // Retour au menu
    socket.on('back_to_menu', (roomCode) => {
        const room = rooms[roomCode];
        if (room) {
            room.gameState = 'waiting';
            io.to(roomCode).emit('update_room', room);
        }
    });

    socket.on('disconnect', () => {
        console.log(`Utilisateur déconnecté : ${socket.id}`);
        for (const code in rooms) {
            rooms[code].players = rooms[code].players.filter(p => p.id !== socket.id);
            if (rooms[code].players.length === 0) {
                delete rooms[code];
            } else {
                io.to(code).emit('update_room', rooms[code]);
            }
        }
    });
});

server.listen(3000, () => {
    console.log('Serveur démarré sur le port 3000');
});
