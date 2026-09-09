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
    "Monkey D. Luffy", "Roronoa Zoro", "Nami", "Sanji", "Trafalgar Law", 
    "Ichigo Kurosaki", "Rukia Kuchiki", "Sosuke Aizen", "Satoru Gojo", "Yuji Itadori", 
    "Ryomen Sukuna", "Tanjiro Kamado", "Nezuko Kamado", "Muzan Kibutsuji", "Light Yagami", 
    "Eren Jäger", "Levi Ackerman", "Izuku Midoriya", "Katsuki Bakugo", "Saitama", 
    "Denji", "Makima", "Ken Kaneki", "Gon Freecss", "Killua Zoldyck"
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
            io.to(roomCode).emit('resume_gameplay', room);
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
