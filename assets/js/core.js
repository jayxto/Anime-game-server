const AUTH_TOKEN_KEY = 'rg_auth_token';
        let authToken = localStorage.getItem(AUTH_TOKEN_KEY) || null;
        let currentUser = null;
        let authMode = 'login';

        const socket = io({
            autoConnect: false,
            reconnection: true,
            reconnectionAttempts: Infinity,   // on ne lâche jamais : le jeu se reconnecte tout seul
            reconnectionDelay: 500,
            reconnectionDelayMax: 3000,
            timeout: 20000
        });
        let currentRoomCode = "";
        let currentThemeMasterId = "";

        function switchTab(tabId) {
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
            document.getElementById(tabId).classList.add('active');
            document.getElementById('btn-' + tabId).classList.add('active');
        }

        function getUsername() {
            return currentUser ? currentUser.pseudo : "Anonyme";
        }

        /* ---------------- Authentification ---------------- */

        function connectSocket() {
            socket.auth = { token: authToken };
            socket.connect();
        }

        function connectSocketAsGuest(pseudo) {
            socket.auth = { guest: true, pseudo };
            socket.connect();
        }

        function showAuthScreen() {
            document.getElementById('auth-screen').style.display = 'block';
            document.getElementById('app-root').style.display = 'none';
            const seo = document.getElementById('seo-about'); if (seo) seo.style.display = '';
        }

        function showApp() {
            document.getElementById('auth-screen').style.display = 'none';
            document.getElementById('app-root').style.display = 'block';
            const seo = document.getElementById('seo-about'); if (seo) seo.style.display = 'none';
            updateProfileDisplay();
        }

        function updateProfileDisplay() {
            if (!currentUser) return;
            document.getElementById('profile-pseudo').innerText = currentUser.pseudo + (currentUser.isGuest ? ' (invité)' : '');
            if (currentUser.isGuest) {
                document.getElementById('profile-rank').innerText = '—';
                document.getElementById('profile-rating').innerText = '—';
                document.getElementById('profile-wins').innerText = '—';
                document.getElementById('profile-losses').innerText = '—';
            } else {
                document.getElementById('profile-rank').innerText = currentUser.rank;
                document.getElementById('profile-rating').innerText = currentUser.rating;
                document.getElementById('profile-wins').innerText = currentUser.wins;
                document.getElementById('profile-losses').innerText = currentUser.losses;
            }
        }

        socket.on('profile_updated', (data) => {
            currentUser = data.user;
            updateProfileDisplay();
        });

        function toggleAuthMode() {
            authMode = authMode === 'login' ? 'register' : 'login';
            document.getElementById('auth-register-fields').style.display = authMode === 'register' ? 'block' : 'none';
            document.getElementById('auth-title').innerText = authMode === 'register' ? 'Créer un compte' : 'Connexion';
            document.getElementById('auth-submit-btn').innerText = authMode === 'register' ? "S'inscrire" : 'Se connecter';
            document.getElementById('auth-switch-text').innerText = authMode === 'register' ? 'Déjà un compte ?' : 'Pas de compte ?';
            document.getElementById('auth-switch-link').innerText = authMode === 'register' ? 'Se connecter' : 'Créer un compte';
            document.getElementById('auth-error').innerText = '';
        }

        function toggleGuestMode() {
            const fields = document.getElementById('guest-fields');
            fields.style.display = fields.style.display === 'none' ? 'block' : 'none';
        }

        function playAsGuest() {
            const pseudo = document.getElementById('guest-pseudo').value.trim();
            const errBox = document.getElementById('auth-error');
            errBox.innerText = '';

            if (!pseudo) {
                errBox.innerText = 'Choisis un pseudo pour jouer en invité.';
                return;
            }

            authToken = null;
            currentUser = { pseudo, isGuest: true, rating: null, wins: 0, losses: 0, rank: null };
            showApp();
            connectSocketAsGuest(pseudo);
        }

        async function submitAuth() {
            const email = document.getElementById('auth-email').value.trim();
            const password = document.getElementById('auth-password').value;
            const errBox = document.getElementById('auth-error');
            errBox.innerText = '';

            if (!email || !password) {
                errBox.innerText = 'Email et mot de passe requis.';
                return;
            }

            let body = { email, password };
            let url = '/api/login';

            if (authMode === 'register') {
                const pseudo = document.getElementById('reg-pseudo').value.trim();
                if (!pseudo) {
                    errBox.innerText = 'Choisis un pseudo.';
                    return;
                }
                body.pseudo = pseudo;
                url = '/api/register';
            }

            try {
                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                });
                const data = await res.json();
                if (!res.ok) {
                    errBox.innerText = data.error || 'Une erreur est survenue.';
                    return;
                }
                authToken = data.token;
                localStorage.setItem(AUTH_TOKEN_KEY, authToken);
                currentUser = data.user;
                showApp();
                connectSocket();
            } catch (e) {
                errBox.innerText = 'Impossible de contacter le serveur.';
            }
        }

        function logout() {
            localStorage.removeItem(AUTH_TOKEN_KEY);
            authToken = null;
            currentUser = null;
            currentRoomCode = "";
            if (socket.connected) socket.disconnect();
            document.getElementById('auth-email').value = '';
            document.getElementById('auth-password').value = '';
            showAuthScreen();
        }

        async function tryAutoLogin() {
            if (!authToken) {
                showAuthScreen();
                return;
            }
            try {
                const res = await fetch('/api/me', { headers: { Authorization: 'Bearer ' + authToken } });
                if (!res.ok) throw new Error('invalid token');
                const data = await res.json();
                currentUser = data.user;
                showApp();
                connectSocket();
            } catch (e) {
                localStorage.removeItem(AUTH_TOKEN_KEY);
                authToken = null;
                showAuthScreen();
            }
        }

        function hideAllPanels() {
            document.getElementById('menu-selection').style.display = 'none';
            document.getElementById('waiting-room').style.display = 'none';
            document.getElementById('gameplay-room').style.display = 'none';
            document.getElementById('rg-room').style.display = 'none';
            document.getElementById('enchere-room').style.display = 'none';
            document.getElementById('enchereaveugle-room').style.display = 'none';
            document.getElementById('connexion-room').style.display = 'none';
            document.getElementById('dle-room').style.display = 'none';
            document.getElementById('quote-room').style.display = 'none';
            document.getElementById('blindtest-room').style.display = 'none';
            ['arcade-room','tierlist-room','battle-room'].forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
            if (typeof mediaClose === 'function') mediaClose();
            document.getElementById('quote-universe-selection').style.display = 'none';
            document.getElementById('theme-selection-container').style.display = 'none';
            document.getElementById('end-clues-options').style.display = 'none';
            document.getElementById('end-clues-options-undercover').style.display = 'none';
            document.getElementById('pass-vote-container').style.display = 'none';
            document.getElementById('end-game-buttons').style.display = 'none';
            document.getElementById('rg-end-buttons').style.display = 'none';
            document.getElementById('enchere-end-buttons').style.display = 'none';
            document.getElementById('ea-end-buttons').style.display = 'none';
            document.getElementById('cx-end-buttons').style.display = 'none';
        }

        // Quitter vraiment le salon : le serveur nous retire, on ne sera plus ramené dedans
        function leaveRoom() {
            if (typeof btStopAudio === 'function') btStopAudio();
            if (currentRoomCode) socket.emit('leave_room', { roomCode: currentRoomCode });
            currentRoomCode = '';
            goToMenuSelection();
        }

        // L'hôte exclut un joueur (2 appuis : un pour armer, un pour confirmer — pas de popup bloquante)
        function kickPlayer(id, btn) {
            if (!btn.classList.contains('armed')) {
                document.querySelectorAll('.kick-btn.armed').forEach(b => { b.classList.remove('armed'); b.textContent = '✖ Exclure'; });
                btn.classList.add('armed'); btn.textContent = 'Confirmer ?';
                setTimeout(() => { if (btn.isConnected && btn.classList.contains('armed')) { btn.classList.remove('armed'); btn.textContent = '✖ Exclure'; } }, 3000);
                return;
            }
            btn.disabled = true;
            socket.emit('kick_player', { roomCode: currentRoomCode, targetId: id });
        }
        socket.on('kicked', (d = {}) => {
            if (d.roomCode && currentRoomCode && d.roomCode !== currentRoomCode) return;
            if (typeof btStopAudio === 'function') btStopAudio();
            currentRoomCode = '';
            goToMenuSelection();
            const msg = d.message || "Tu as été exclu du salon.";
            if (typeof toast === 'function') toast('🚫 ' + msg, 'var(--accent-pink)'); else alert(msg);
        });
        socket.on('room_toast', (d = {}) => { if (d.message && typeof toast === 'function') toast(d.message, 'var(--accent-pink)'); });

        socket.on('force_rejoin', ({ roomCode } = {}) => {
            if (!roomCode) return;
            currentRoomCode = roomCode;
            socket.emit('rejoin_room', { roomCode });
        });

        function arcStopMedia() {
            try { arcDestroyVideo(); arcStageKey = ''; } catch (_) {}
            const st = document.getElementById('arc-stage'); if (st) st.innerHTML = '';
            document.querySelectorAll('.bb-card iframe').forEach(f => f.remove());
        }

        function goToMenuSelection() {
            arcStopMedia();
            if (typeof btStopAudio === 'function') btStopAudio();
            returningToWaitingRoom = false;
            hideAllPanels();
            document.getElementById('menu-selection').style.display = 'block';
            const chatBox = document.getElementById('chat-messages');
            if (chatBox) chatBox.innerHTML = '';
            const dleProgress = document.getElementById('dle-enrichment-progress');
            if (dleProgress) dleProgress.style.display = 'none';
        }

        // Reconnexion automatique après une coupure réseau / mise en veille du téléphone
        socket.on('connect', () => {
            if (currentRoomCode) {
                socket.emit('rejoin_room', { roomCode: currentRoomCode });
            }
        });

        socket.on('rejoin_failed', () => {
            // La partie n'existe plus côté serveur (redémarrage du serveur ou absence trop longue)
            currentRoomCode = "";
            goToMenuSelection();
            const el = document.getElementById('connection-banner');
            if (el) {
                el.textContent = "La partie n'a pas pu être retrouvée (serveur redémarré ou absence trop longue). Recrée ou rejoins un salon.";
                el.style.display = 'block';
                setTimeout(() => { el.style.display = 'none'; }, 7000);
            }
        });

        // Retour sur l'onglet / déverrouillage du téléphone : on se reconnecte immédiatement
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden && !socket.connected && (authToken || socket.auth)) socket.connect();
        });
        window.addEventListener('online', () => {
            if (!socket.connected && (authToken || socket.auth)) socket.connect();
        });

        socket.on('disconnect', (raison) => {
            if (currentRoomCode && raison !== 'io client disconnect') {
                const el = document.getElementById('connection-banner');
                if (el) {
                    el.textContent = '📡 Connexion perdue… reconnexion automatique, ta place est gardée.';
                    el.style.display = 'block';
                }
            }
        });

        socket.io.on('reconnect', () => {
            const el = document.getElementById('connection-banner');
            if (el) el.style.display = 'none';
        });
        socket.on('connect', () => {
            const el = document.getElementById('connection-banner');
            if (el && socket.recovered) el.style.display = 'none';
        });

        socket.on('player_connection_changed', () => {
            // Simple information de présence, aucun changement d'écran
        });


        const dleBootstrapRunning = new Map();

        function extractPortableInfoboxFields(html) {
            const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
            const fields = {};

            doc.querySelectorAll('.pi-data').forEach(row => {
                const label = row.querySelector('.pi-data-label')?.textContent?.trim()
                    || row.getAttribute('data-source')
                    || '';
                const value = row.querySelector('.pi-data-value')?.textContent?.trim() || '';
                if (label && value && !fields[label]) fields[label] = value;
            });

            doc.querySelectorAll('table.infobox tr, aside tr').forEach(row => {
                const label = row.querySelector('th')?.textContent?.trim() || '';
                const value = row.querySelector('td')?.textContent?.trim() || '';
                if (label && value && !fields[label]) fields[label] = value;
            });

            return fields;
        }

        async function fandomFindProfilePage(universeKey, name) {
            const host = FANDOM_CLIENT_WIKIS[universeKey];
            if (!host) return null;

            const exact = new URLSearchParams({
                action:'query', titles:name, prop:'info', inprop:'url',
                redirects:'1', format:'json', origin:'*'
            });
            try {
                const data = await fandomBrowserFetchJson(`https://${host}/api.php?${exact.toString()}`);
                const page = Object.values(data?.query?.pages || {}).find(p => p?.pageid && p?.title);
                if (page) return {title:page.title, sourceUrl:page.fullurl || null};
            } catch (_) {}

            const search = new URLSearchParams({
                action:'query', list:'search', srsearch:name, srnamespace:'0',
                srlimit:'6', format:'json', origin:'*'
            });
            try {
                const data = await fandomBrowserFetchJson(`https://${host}/api.php?${search.toString()}`);
                const hit = data?.query?.search?.[0];
                if (hit?.title) return {
                    title:hit.title,
                    sourceUrl:`https://${host}/wiki/${encodeURIComponent(hit.title.replace(/ /g,'_'))}`
                };
            } catch (_) {}
            return null;
        }

        async function fetchFandomProfileFields(universeKey, name) {
            const host = FANDOM_CLIENT_WIKIS[universeKey];
            if (!host) return null;
            const page = await fandomFindProfilePage(universeKey, name);
            if (!page?.title) return null;

            const p = new URLSearchParams({
                action:'parse', page:page.title, prop:'text',
                format:'json', origin:'*'
            });
            try {
                const data = await fandomBrowserFetchJson(`https://${host}/api.php?${p.toString()}`);
                const html = data?.parse?.text?.['*'] || '';
                return {fields:extractPortableInfoboxFields(html), sourceUrl:page.sourceUrl};
            } catch (_) {
                return null;
            }
        }

        async function cacheBrowserCharacterImage(universeKey, name) {
            try {
                const data = await getFandomCharacterImage(universeKey, name);
                if (!data?.imageUrl) return false;
                fetch('/api/character-image-cache', {
                    method:'POST',
                    headers:{'Content-Type':'application/json'},
                    body:JSON.stringify({
                        universeKey,
                        name,
                        imageUrl:data.imageUrl,
                        sourceUrl:data.sourceUrl || null
                    })
                }).catch(()=>{});
                return true;
            } catch (_) {
                return false;
            }
        }

        async function enrichOneDleCharacter(universeKey, name) {
            const [profile] = await Promise.all([
                fetchFandomProfileFields(universeKey, name),
                cacheBrowserCharacterImage(universeKey, name)
            ]);

            if (!profile?.fields || !Object.keys(profile.fields).length) return false;
            try {
                const r = await fetch('/api/dle-import-fandom-profile', {
                    method:'POST',
                    headers:{'Content-Type':'application/json'},
                    body:JSON.stringify({
                        universeKey,
                        name,
                        fields:profile.fields,
                        sourceUrl:profile.sourceUrl || null
                    })
                });
                const data = await r.json();
                return !!data?.complete;
            } catch (_) {
                return false;
            }
        }

        async function bootstrapDleUniverse(universeKey) {
            if (!universeKey) return;
            if (dleBootstrapRunning.has(universeKey)) return dleBootstrapRunning.get(universeKey);

            const task = (async () => {
                const progress = document.getElementById('dle-enrichment-progress');
                try {
                    const info = await fetch(`/api/dle-targets?universeKey=${encodeURIComponent(universeKey)}`)
                        .then(r => r.json());
                    if (!info?.ok) return;

                    const completeSet = new Set((info.completeNames || []).map(normalizeFandomClient));
                    const pending = (info.names || []).filter(n => !completeSet.has(normalizeFandomClient(n)));
                    let completed = info.completeCount || 0;

                    if (progress) {
                        progress.style.display='block';
                        progress.textContent=`📚 ${info.universeName} : ${completed}/${info.targetCount} fiches réellement jouables — récupération des fiches manquantes + photos…`;
                    }

                    let cursor = 0;
                    const workers = Math.min(5, Math.max(1, pending.length));
                    async function worker() {
                        while (cursor < pending.length) {
                            const i = cursor++;
                            const name = pending[i];
                            const ok = await enrichOneDleCharacter(universeKey, name);
                            if (ok) completed++;
                            if (progress) {
                                progress.textContent=`📚 ${info.universeName} : ${completed}/${info.targetCount} fiches réellement jouables — photos incluses`;
                            }
                        }
                    }
                    await Promise.all(Array.from({length:workers}, () => worker()));

                    if (progress) {
                        progress.textContent=`✅ ${info.universeName} : ${completed}/${info.targetCount} fiches réellement jouables prêtes.`;
                    }
                } catch (_) {
                    if (progress) {
                        progress.style.display='block';
                        progress.textContent='AnimeDLE : Fandom est temporairement indisponible.';
                    }
                }
            })();

            dleBootstrapRunning.set(universeKey, task);
            try { await task; } finally { dleBootstrapRunning.delete(universeKey); }
        }


        // Écran de choix d'univers commun à tous les modes (même présentation que les Citations)
        const UNIVERSE_CHOICES = [
            ['naruto','Naruto'],['onepiece','One Piece'],['bleach','Bleach'],['hxh','Hunter x Hunter'],
            ['snk',"SNK / L'Attaque des Titans"],['sds','Seven Deadly Sins'],['deathnote','Death Note'],
            ['cote','Classroom of the Elite'],['solo','Solo Leveling'],['clover','Black Clover'],['fireforce','Fire Force'],
            ['mushoku','Mushoku Tensei'],['rezero','Re:Zero'],['fairy','Fairy Tail'],['bluelock','Blue Lock'],
            ['fma','Fullmetal Alchemist'],['chainsaw','Chainsaw Man'],['wakfu','Wakfu'],['demonslayer','Demon Slayer'],
            ['pokemon','Pokémon'],['dragonball','Dragon Ball'],['hellsparadise',"Hell's Paradise"],['gachiakuta','Gachiakuta'],
            ['haikyuu','Haikyuu'],['jjk','Jujutsu Kaisen'],['jojo',"JoJo's Bizarre Adventure"],['tensura','Tensura'],
            ['opm','One Punch Man'],['sao','Sword Art Online'],['tokyoghoul','Tokyo Ghoul'],['tokyorevengers','Tokyo Revengers']
        ];
        const UNIVERSE_SELECT_MODES = {
            quote:          { title:'À QUI APPARTIENT CETTE CITATION ?', sub:'Choisis ton univers — 25 à 42 citations dans chacun des 31 animes.', tag:'25 citations' },
            rollandgaros:   { title:'ROLLAND GAROS', sub:'Choisis ton univers — trouvez un max de persos à tour de rôle.', tag:'' },
            enchere:        { title:'ENCHÈRE', sub:'Choisis ton univers — 1v1, 50M chacun, 4 persos par équipe.', tag:'' },
            enchereaveugle: { title:"ENCHÈRE À L'AVEUGLE", sub:"Choisis ton univers — un seul voit le perso, l'autre mise à l'aveugle.", tag:'' },
            dle:            { title:'ANIMEDLE', sub:'Choisis ton univers — devinez le personnage mystère.', tag:'' },
            arc_pixel:      { title:'🖼️ PIXEL ANIME', sub:'Choisis un univers, ou mélange tous les animes.', tag:'', all:true },
            arc_zoom:       { title:'🔍 ZOOM EXTRÊME', sub:'Choisis un univers, ou mélange tous les animes.', tag:'', all:true },
            chaine:         { title:'⛓️ CHAÎNE DE PERSOS', sub:'Choisis un univers (ou plusieurs), ou mélange tous les animes.', tag:'', all:true },
            arc_silhouette: { title:'👤 SILHOUETTE', sub:'Choisis un univers, ou mélange tous les animes.', tag:'', all:true },
            arc_popularite: { title:'👥 POPULARITY GUESS', sub:'Choisis un univers, ou mélange tous les animes.', tag:'', all:true },
            arc_draft:      { title:'🃏 DRAFT 5V5', sub:'Choisis un univers, ou mélange tous les animes.', tag:'', all:true },
            arc_couleur:    { title:'🎨 COLORIE LE PERSO', sub:'Choisis un univers, ou mélange tous les animes.', tag:'', all:true },
            draw:           { title:'✏️ DESSINE LE PERSO', sub:'Choisis un univers, ou mélange tous les animes.', tag:'', all:true },
            qap:            { title:'🏆 QUI A LE PLUS…', sub:'Un anime, plusieurs (☑️), ou tous les animes : tous les persos du jeu sont dans le tirage.', tag:'', all:true },
            tupref:         { title:'🤔 TU PRÉFÈRES…', sub:'Un anime, plusieurs (☑️), ou tous les animes : tous les persos du jeu sont dans le tirage.', tag:'', all:true },
            arc_fusion:     { title:'🧪 FUSION ANIME', sub:'4 persos du même univers, ou 4 animes différents mélangés.', tag:'', all:true },
            arc_connections:{ title:'🧩 ANIME CONNECTIONS', sub:'Choisis un univers, plusieurs (☑️), ou tous les animes. Les 16 personnages et les 4 liens seront générés uniquement avec ta sélection.', tag:'', all:true },
            arc_bingo:      { title:'🎟️ BINGO ANIME', sub:'Choisis un univers, plusieurs (☑️), ou tous les animes. Seuls les personnages de ta sélection apparaîtront.', tag:'', all:true }
        };
        let QUOTE_COUNTS = {};
        fetch('/api/quote-counts').then(r => r.json()).then(d => { if (d && d.counts) QUOTE_COUNTS = d.counts; }).catch(() => {});
        function openUniverseSelection(mode) {
            const cfg = UNIVERSE_SELECT_MODES[mode] || UNIVERSE_SELECT_MODES.quote;
            hideAllPanels();
            document.getElementById('universe-select-title').textContent = cfg.title;
            document.getElementById('universe-select-sub').textContent = cfg.sub;
            const grid = document.getElementById('universe-select-grid');
            grid.innerHTML = '';
            const pick = key => mode === 'quote' ? createQuoteRoom(key)
                : mode === 'tupref' ? startBattleSetup('tp:' + key)
                : mode === 'qap' ? startBattleSetup('tp:' + key, 'qap')
                : mode === 'arc_bingo' ? createRoom('arcade', 'bingo:' + bingoPendingDuration + ':' + key)
                : mode.startsWith('arc_') ? createRoom('arcade', mode.slice(4) + ':' + key)
                : createRoom(mode, key);
            // plusieurs animes au choix (sauf Rolland Garros, Enchères et AnimeDLE)
            const multiOk = !['rollandgaros', 'enchere', 'enchereaveugle', 'dle'].includes(mode);
            uniMulti.on = false; uniMulti.sel = new Set(); uniMulti.pick = pick;
            const bar = document.getElementById('uni-multi-bar'); if (bar) bar.style.display = multiOk ? 'flex' : 'none';
            uniMultiUi();
            if (cfg.all) {
                const all = document.createElement('button');
                all.className = 'quote-universe-btn';
                all.style.cssText = 'border-color:var(--accent-yellow);color:var(--accent-yellow);';
                all.textContent = '🌍 Tous les animes mélangés';
                all.onclick = () => pick('all');
                grid.appendChild(all);
            }
            UNIVERSE_CHOICES.forEach(([key, label]) => {
                const b = document.createElement('button');
                b.className = 'quote-universe-btn';
                b.textContent = label;
                if (cfg.tag) {
                    b.appendChild(document.createElement('br'));
                    const t = document.createElement('span');
                    t.style.cssText = 'font-size:.65rem;color:var(--text-muted);';
                    t.textContent = mode === 'quote' && QUOTE_COUNTS[key] ? QUOTE_COUNTS[key] + ' citations' : cfg.tag;
                    b.appendChild(t);
                }
                b.dataset.k = key;
                b.onclick = () => { if (uniMulti.on) { uniMulti.sel.has(key) ? uniMulti.sel.delete(key) : uniMulti.sel.add(key); uniMultiUi(); } else pick(key); };
                grid.appendChild(b);
            });
            const p = document.getElementById('quote-universe-selection');
            if (p) p.style.display = 'block';
            window.scrollTo(0, 0);
        }

        const uniMulti = { on: false, sel: new Set(), pick: null };
        function uniMultiToggle() { uniMulti.on = !uniMulti.on; if (!uniMulti.on) uniMulti.sel.clear(); uniMultiUi(); }
        function uniMultiUi() {
            const t = document.getElementById('uni-multi-toggle'), info = document.getElementById('uni-multi-info');
            if (t) { t.textContent = uniMulti.on ? '✖ Annuler' : '☑️ Choisir plusieurs animes'; t.classList.toggle('on', uniMulti.on); }
            document.querySelectorAll('#universe-select-grid .quote-universe-btn').forEach(b => {
                const k = b.dataset.k;
                b.classList.toggle('uni-sel', !!k && uniMulti.sel.has(k));
                b.classList.toggle('uni-dim', uniMulti.on && !k);
            });
            let go = document.getElementById('uni-multi-go');
            if (uniMulti.on) {
                if (!go) { go = document.createElement('button'); go.id = 'uni-multi-go'; go.className = 'uni-multi-go'; go.onclick = () => { if (uniMulti.sel.size >= 2 && uniMulti.pick) uniMulti.pick([...uniMulti.sel].join('+')); else if (uniMulti.sel.size === 1 && uniMulti.pick) uniMulti.pick([...uniMulti.sel][0]); }; document.body.appendChild(go); }
                const n = uniMulti.sel.size;
                go.disabled = n < 1;
                go.textContent = n ? `▶ Jouer avec ${n} anime${n > 1 ? 's' : ''}` : 'Coche les animes que tu veux';
                go.style.display = 'block';
                if (info) info.textContent = n ? [...uniMulti.sel].map(k => (UNIVERSE_CHOICES.find(x => x[0] === k) || [k, k])[1]).join(' • ') : 'Coche les animes que tu veux jouer, puis lance.';
            } else { if (go) go.style.display = 'none'; if (info) info.textContent = ''; }
        }
        (function () { const orig = window.hideAllPanels; window.hideAllPanels = function () { const r = orig.apply(this, arguments); const go = document.getElementById('uni-multi-go'); if (go) go.style.display = 'none'; return r; }; })();
        function openQuoteUniverseSelection() {
            openUniverseSelection('quote');
        }

        function createQuoteRoom(universeKey) {
            createRoom('quote', universeKey);
        }

        function submitQuoteAnswer() {
            const input = document.getElementById('quote-answer-input');
            const answer = input?.value?.trim();
            if (!answer) return;
            socket.emit('quote_submit_answer', { roomCode:currentRoomCode, answer });
            input.value = '';
        }

        function useQuoteHint() {
            socket.emit('quote_use_hint', { roomCode:currentRoomCode });
        }

        function renderQuoteState(q) {
            if (!q) return;

            document.getElementById('quote-universe-name').textContent = `${q.universeName} • 25 citations`;
            document.getElementById('quote-text').textContent = `“${q.quoteText || ''}”`;
            document.getElementById('quote-round').textContent = `Manche ${q.round || 1}`;
            document.getElementById('quote-turn').textContent = q.finished ? 'Partie terminée' : `Tour : ${q.currentTurnName || '---'}`;
            document.getElementById('quote-attempts').textContent = `Erreurs : ${q.attempts || 0}/5`;

            const list = document.getElementById('quote-speaker-list');
            list.innerHTML = '';
            (q.candidates || []).forEach(name => {
                const option = document.createElement('option');
                option.value = name;
                list.appendChild(option);
            });

            const board = document.getElementById('quote-scoreboard');
            board.innerHTML = '';
            (q.players || []).forEach(p => {
                const row = document.createElement('div');
                row.className = `quote-score${p.isTurn && !q.finished ? ' turn' : ''}`;
                const name = document.createElement('span');
                name.textContent = `${p.isTurn && !q.finished ? '👉 ' : ''}${p.name}`;
                const score = document.createElement('strong');
                score.style.color = 'var(--accent-yellow)';
                score.textContent = `${p.score} pt${p.score > 1 ? 's' : ''}`;
                row.append(name, score);
                board.appendChild(row);
            });

            const myTurn = q.currentTurnId === socket.id && !q.finished && !q.resolved;
            const input = document.getElementById('quote-answer-input');
            const answerBtn = document.getElementById('quote-answer-btn');
            input.disabled = !myTurn;
            answerBtn.disabled = !myTurn;
            input.placeholder = q.finished ? 'Partie terminée' : (myTurn ? 'Qui a dit cette citation ?' : `Tour de ${q.currentTurnName}…`);

            const hintBtn = document.getElementById('quote-hint-btn');
            hintBtn.style.display = q.hintAvailable && !q.hintUsed && !q.resolved ? 'block' : 'none';
            hintBtn.disabled = !myTurn;

            const hint = document.getElementById('quote-hint-box');
            if (q.hintUsed && q.recipient) {
                hint.style.display = 'block';
                hint.textContent = `💡 Destinataire : ${q.recipient}`;
            } else {
                hint.style.display = 'none';
                hint.textContent = '';
            }

            const result = document.getElementById('quote-result');
            const img = document.getElementById('quote-speaker-image');
            img.style.display = 'none';
            img.removeAttribute('src');

            if (q.finished) {
                result.style.color = 'var(--accent-yellow)';
                result.textContent = `🏆 ${q.winnerName} gagne avec 10 points ! Réponse : ${q.revealedSpeaker}.`;
            } else if (q.resolved && q.lastResult?.correct) {
                result.style.color = '#00ff88';
                result.textContent = `✅ ${q.lastResult.playerName} trouve ${q.revealedSpeaker} : +1 point`;
            } else if (q.lastResult?.correct === false) {
                result.style.color = 'var(--accent-pink)';
                result.textContent = `❌ Mauvaise réponse de ${q.lastResult.playerName}.`;
            } else {
                result.textContent = '';
            }

            if (q.resolved && q.revealedSpeaker && typeof getFandomCharacterImage === 'function') {
                getFandomCharacterImage(q.universeName, q.revealedSpeaker).then(data => {
                    if (data?.imageUrl) {
                        img.src = data.imageUrl;
                        img.style.display = 'block';
                    }
                }).catch(()=>{});
            }

            if (myTurn) setTimeout(()=>input.focus(), 80);
        }

        function createRoom(mode, subMode) {
            if (mode === 'dle' && subMode) bootstrapDleUniverse(subMode);
            const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
            let code = "";
            for (let i = 0; i < 4; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
            
            currentRoomCode = code;
            socket.emit('join_room', { roomCode: code, username: getUsername(), mode: mode, subMode: subMode });
        }

        function joinRoomByCode() {
            const code = document.getElementById('join-code-input').value.trim().toUpperCase();
            if (code.length < 4) {
                alert("Entre un code valide à 4 caractères !");
                return;
            }
            currentRoomCode = code;
            socket.emit('join_room', { roomCode: code, username: getUsername(), mode: 'undercover', subMode: 'normal' });
        }

        socket.on('update_room', (room) => {
            // Sécurité : un état de jeu ne doit pas être rendu comme un salon d'attente.
            if (room.status && room.status !== 'waiting') return;
            // Salon quitté (ou un autre salon) : on ne s'y fait plus ramener
            if (!currentRoomCode || (room.code && room.code !== currentRoomCode)) return;

            // Un paquet "waiting" retardé ne recouvre pas une partie...
            // SAUF si l'utilisateur vient volontairement d'appuyer sur "Menu".
            const activeGamePanels = ['gameplay-room','rg-room','enchere-room','enchereaveugle-room','connexion-room','dle-room','quote-room','blindtest-room','arcade-room','draw-room','guess-room','chaine-room','lg-room','uq-room'];
            const gameAlreadyVisible = activeGamePanels.some(id => {
                const el = document.getElementById(id);
                return el && getComputedStyle(el).display !== 'none';
            });

            if (gameAlreadyVisible && !returningToWaitingRoom) return;

            returningToWaitingRoom = false;
            if (typeof btStopAudio === 'function') btStopAudio();
            arcStopMedia();
            hideAllPanels();
            document.getElementById('waiting-room').style.display = 'block';
            document.getElementById('display-room-code').innerText = "#" + room.code;

            const list = document.getElementById('waiting-players-list');
            list.innerHTML = "";
            renderLobbyPlayers(room);

            if (room.host === socket.id) {
                document.getElementById('btn-start-game').style.display = 'block';
            } else {
                document.getElementById('btn-start-game').style.display = 'none';
            }

            // Salon public / privé : seul l'hôte peut changer
            const isHost = room.host === socket.id;
            const pubLabel = document.getElementById('room-public-label');
            const pubBox = document.getElementById('room-public-checkbox');
            const badge = document.getElementById('room-visibility-badge');
            if (pubLabel) pubLabel.style.display = isHost ? 'flex' : 'none';
            if (pubBox) pubBox.checked = !!room.isPublic;
            if (badge) badge.textContent = room.isPublic ? '🌍 Salon public : n\'importe qui peut rejoindre' : '🔒 Salon privé : seulement avec le code';
            // Nombre de manches (mini-jeux et blind test)
            const rbox = document.getElementById('room-rounds-box');
            if (rbox) {
                const fixedArc = room.mode === 'arcade' && /^(?:cardbattle|bingo|partymix)/.test(String(room.subMode || ''));
                const withRounds = (room.mode === 'arcade' && !fixedArc) || room.mode === 'blindtest';
                rbox.style.display = withRounds ? 'flex' : 'none';
                const sel = document.getElementById('room-rounds-select'), txt = document.getElementById('room-rounds-text');
                const v = room.arcRounds === 0 ? '0' : (room.arcRounds ? String(room.arcRounds) : '');
                sel.value = v; sel.style.display = isHost ? '' : 'none';
                txt.textContent = isHost ? '' : (v === '0' ? '♾️ Infini' : (v || 'Par défaut'));
            }
        });

        function setArcRounds(v) {
            if (!currentRoomCode) return;
            socket.emit('set_arc_rounds', { roomCode: currentRoomCode, rounds: v === '' ? null : Number(v) });
        }

        function startGame() {
            socket.emit('start_game', currentRoomCode);
        }

        /* ---------- Salons publics ---------- */
        let publicRoomsTimer = null;
        function setRoomPublic(isPublic) {
            if (!currentRoomCode) return;
            socket.emit('set_room_public', { roomCode: currentRoomCode, isPublic: !!isPublic });
        }
        function refreshPublicRooms() {
            socket.emit('list_public_rooms');
        }
        function togglePublicRooms(forceOpen) {
            const panel = document.getElementById('public-rooms-panel');
            const btn = document.getElementById('btn-public-rooms');
            const open = forceOpen === true || (forceOpen !== false && panel.style.display === 'none');
            panel.style.display = open ? 'block' : 'none';
            btn.textContent = open ? '✖ Fermer la recherche' : '🔎 Chercher un salon public';
            if (publicRoomsTimer) { clearInterval(publicRoomsTimer); publicRoomsTimer = null; }
            if (open) {
                document.getElementById('public-rooms-list').innerHTML = '<div class="public-empty">Recherche…</div>';
                refreshPublicRooms();
                publicRoomsTimer = setInterval(() => {
                    const menu = document.getElementById('menu-selection');
                    if (!menu || getComputedStyle(menu).display === 'none') { togglePublicRooms(false); return; }
                    refreshPublicRooms();
                }, 4000);
            }
        }
        function joinPublicRoom(code, mode, subMode) {
            togglePublicRooms(false);
            currentRoomCode = code;
            socket.emit('join_room', { roomCode: code, username: getUsername(), mode, subMode });
        }
        socket.on('public_rooms', list => {
            const box = document.getElementById('public-rooms-list');
            if (!box) return;
            box.innerHTML = '';
            if (!list || !list.length) {
                box.innerHTML = '<div class="public-empty">Aucun salon public pour le moment. Crée un salon et coche « Salon public » pour que d\'autres te rejoignent !</div>';
                return;
            }
            list.forEach(r => {
                const row = document.createElement('div');
                row.className = 'public-room';
                const info = document.createElement('div');
                info.className = 'public-room-info';
                const mode = document.createElement('span');
                mode.className = 'public-room-mode';
                mode.textContent = r.modeLabel + (r.subLabel ? ' · ' + r.subLabel : '');
                const meta = document.createElement('span');
                meta.className = 'public-room-meta';
                meta.textContent = `👥 ${r.players}/${r.max} · Hôte : ${r.hostName} · #${r.code}`;
                info.append(mode, meta);
                const btn = document.createElement('button');
                btn.className = 'btn-action';
                btn.textContent = 'Rejoindre';
                btn.onclick = () => joinPublicRoom(r.code, r.mode, r.subMode);
                row.append(info, btn);
                box.appendChild(row);
            });
        });


        const fandomImageClientCache = new Map();

        const FANDOM_CLIENT_WIKIS = {
            naruto:'naruto.fandom.com',
            onepiece:'onepiece.fandom.com',
            bleach:'bleach.fandom.com',
            hxh:'hunterxhunter.fandom.com',
            snk:'attackontitan.fandom.com',
            sds:'nanatsu-no-taizai.fandom.com',
            deathnote:'deathnote.fandom.com',
            cote:'you-zitsu.fandom.com',
            solo:'solo-leveling.fandom.com',
            clover:'blackclover.fandom.com',
            fireforce:'fire-force.fandom.com',
            mushoku:'mushokutensei.fandom.com',
            rezero:'rezero.fandom.com',
            fairy:'fairytail.fandom.com',
            bluelock:'bluelock.fandom.com',
            fma:'fma.fandom.com',
            chainsaw:'chainsaw-man.fandom.com',
            wakfu:'wakfu.fandom.com',
            demonslayer:'kimetsu-no-yaiba.fandom.com',
            pokemon:'pokemon.fandom.com',
            dragonball:'dragonball.fandom.com',
            hellsparadise:'jigokuraku.fandom.com',
            gachiakuta:'gachiakuta.fandom.com',
            haikyuu:'haikyuu.fandom.com',
            jjk:'jujutsu-kaisen.fandom.com',
            jojo:'jojo.fandom.com',
            tensura:'tensura.fandom.com',
            opm:'onepunchman.fandom.com',
            sao:'swordartonline.fandom.com',
            tokyoghoul:'tokyoghoul.fandom.com',
            tokyorevengers:'tokyorevengers.fandom.com'
        };

        function normalizeFandomClient(value) {
            return String(value || '')
                .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
                .toLowerCase()
                .replace(/[’`]/g, "'")
                .replace(/[^a-z0-9']+/g,' ')
                .replace(/\s+/g,' ')
                .trim();
        }

        const FANDOM_CLIENT_UNIVERSES = {
            'naruto':'naruto','one piece':'onepiece','bleach':'bleach',
            'hunter x hunter':'hxh','snk':'snk',"snk l'attaque des titans":'snk',
            "l'attaque des titans":'snk','attack on titan':'snk',
            'seven deadly sins':'sds','death note':'deathnote',
            'classroom of the elite':'cote','solo leveling':'solo','black clover':'clover',
            'fire force':'fireforce','mushoku tensei':'mushoku','re zero':'rezero',
            'fairy tail':'fairy','blue lock':'bluelock','fullmetal alchemist':'fma',
            'chainsaw man':'chainsaw','wakfu':'wakfu','demon slayer':'demonslayer',
            'pokemon':'pokemon','dragon ball':'dragonball',"hell's paradise":'hellsparadise',
            'gachiakuta':'gachiakuta','haikyuu':'haikyuu','jujutsu kaisen':'jjk','jjk':'jjk',
            "jojo's bizarre adventure":'jojo','jojo':'jojo','tensura':'tensura',
            'one punch man':'opm','sword art online':'sao','sao':'sao',
            'tokyo ghoul':'tokyoghoul','tokyo revengers':'tokyorevengers'
        };

        function fandomImageUniverseKey(universe) {
            const raw = String(universe || '').trim();
            if (FANDOM_CLIENT_WIKIS[raw]) return raw;
            return FANDOM_CLIENT_UNIVERSES[normalizeFandomClient(raw)] || null;
        }

        function parseCharacterLabelClient(label) {
            const s = String(label || '').trim();
            if (!s) return {name:'', universe:''};
            if (s.endsWith(')')) {
                const i = s.lastIndexOf(' (');
                if (i > 0) return {name:s.slice(0,i).trim(), universe:s.slice(i+2,-1).trim()};
            }
            return {name:s, universe:''};
        }

        function fandomBestPage(pages, wantedName) {
            const wanted = normalizeFandomClient(wantedName);
            const list = Object.values(pages || {}).filter(p => p && p.pageid && (p.original?.source || p.thumbnail?.source));
            if (!list.length) return null;

            const score = p => {
                const title = normalizeFandomClient(p.title || '');
                let s = 0;
                if (title === wanted) s += 100;
                if (title.includes(wanted) || wanted.includes(title)) s += 35;
                const wt = new Set(wanted.split(' '));
                title.split(' ').forEach(t => { if (wt.has(t)) s += 7; });
                if (/gallery|images|category|episode|chapter|volume/i.test(p.title || '')) s -= 50;
                return s;
            };

            list.sort((a,b)=>score(b)-score(a));
            return list[0];
        }

        async function fandomBrowserFetchJson(url) {
            const ctrl = new AbortController();
            const timer = setTimeout(()=>ctrl.abort(), 9000);
            try {
                const r = await fetch(url, { mode:'cors', signal:ctrl.signal, credentials:'omit' });
                if (!r.ok) throw new Error(`HTTP ${r.status}`);
                return await r.json();
            } finally {
                clearTimeout(timer);
            }
        }

        async function fetchFandomImageDirect(universe, name) {
            const universeKey = fandomImageUniverseKey(universe);
            const host = FANDOM_CLIENT_WIKIS[universeKey];
            if (!host) return null;

            // 1. exact page / redirect
            const exact = new URLSearchParams({
                action:'query',
                titles:name,
                prop:'pageimages|info',
                piprop:'original|thumbnail',
                pithumbsize:'700',
                inprop:'url',
                redirects:'1',
                format:'json',
                origin:'*'
            });

            try {
                const data = await fandomBrowserFetchJson(`https://${host}/api.php?${exact.toString()}`);
                const page = fandomBestPage(data?.query?.pages, name);
                if (page) return {
                    imageUrl: page.original?.source || page.thumbnail?.source || null,
                    sourceUrl: page.fullurl || `https://${host}/wiki/${encodeURIComponent((page.title || name).replace(/ /g,'_'))}`,
                    status:'ok-browser',
                    universeKey
                };
            } catch (_) {}

            // 2. search if exact title isn't the wiki title
            const search = new URLSearchParams({
                action:'query',
                generator:'search',
                gsrsearch:name,
                gsrnamespace:'0',
                gsrlimit:'8',
                prop:'pageimages|info',
                piprop:'original|thumbnail',
                pithumbsize:'700',
                inprop:'url',
                format:'json',
                origin:'*'
            });

            try {
                const data = await fandomBrowserFetchJson(`https://${host}/api.php?${search.toString()}`);
                const page = fandomBestPage(data?.query?.pages, name);
                if (page) return {
                    imageUrl: page.original?.source || page.thumbnail?.source || null,
                    sourceUrl: page.fullurl || `https://${host}/wiki/${encodeURIComponent((page.title || name).replace(/ /g,'_'))}`,
                    status:'ok-browser-search',
                    universeKey
                };
            } catch (_) {}

            return null;
        }

        async function getFandomCharacterImage(universe, name) {
            if (!universe || !name) return null;
            const key = `${String(universe).toLowerCase()}|${String(name).toLowerCase()}`;
            if (fandomImageClientCache.has(key)) return fandomImageClientCache.get(key);

            const promise = (async () => {
                // 1) Notre serveur : image officielle de l'anime (AniList), sinon Fandom
                try {
                    const r = await fetch(`/api/character-image?universe=${encodeURIComponent(universe)}&name=${encodeURIComponent(name)}`);
                    if (r.ok) {
                        const data = await r.json();
                        if (data?.imageUrl) return data;
                    }
                } catch (_) {}

                // 2) Navigateur -> Fandom directement (Fandom bloque parfois les serveurs cloud)
                const direct = await fetchFandomImageDirect(universe, name);
                if (direct?.imageUrl) return direct;

                // Dernier secours pour que le jeu affiche quand même une photo :
                // recherche Jikan/MAL, en privilégiant une correspondance exacte du nom.
                try {
                    const r = await fetch(`https://api.jikan.moe/v4/characters?q=${encodeURIComponent(name)}&limit=10`);
                    if (r.ok) {
                        const data = await r.json();
                        const wanted = normalizeFandomClient(name);
                        const candidates = Array.isArray(data?.data) ? data.data : [];
                        const exact = candidates.find(c =>
                            normalizeFandomClient(c?.name || '') === wanted ||
                            (c?.nicknames || []).some(n => normalizeFandomClient(n) === wanted)
                        );
                        const picked = exact || candidates[0];
                        const imageUrl = picked?.images?.jpg?.image_url || picked?.images?.webp?.image_url || null;
                        if (imageUrl) {
                            return {
                                imageUrl,
                                sourceUrl: picked?.url || null,
                                status:'ok-jikan-fallback'
                            };
                        }
                    }
                } catch (_) {}

                return null;
            })();

            fandomImageClientCache.set(key, promise);
            return promise;
        }

        function clearFandomImage(imgId, sourceId) {
            const img = document.getElementById(imgId);
            const source = document.getElementById(sourceId);
            if (img) {
                img.removeAttribute('src');
                img.style.display = 'none';
            }
            if (source) {
                source.removeAttribute('href');
                source.style.display = 'none';
            }
        }

        async function setFandomImage(imgId, sourceId, universe, name, visible=true) {
            const img = document.getElementById(imgId);
            const source = document.getElementById(sourceId);
            if (!img) return;

            if (!visible || !universe || !name) {
                clearFandomImage(imgId, sourceId);
                return;
            }

            const requestKey = `${universe}|${name}`;
            img.dataset.requestKey = requestKey;
            const data = await getFandomCharacterImage(universe, name);
            if (img.dataset.requestKey !== requestKey) return;

            if (!data?.imageUrl) {
                console.warn('[Anime Game] Image Fandom introuvable :', universe, name);
                clearFandomImage(imgId, sourceId);
                return;
            }

            img.src = data.imageUrl;
            img.style.display = 'block';
            img.onerror = () => clearFandomImage(imgId, sourceId);

            if (source && data.sourceUrl) {
                source.href = data.sourceUrl;
                source.style.display = 'inline-block';
            }
        }

        let secretHidden = false;

        function toggleSecretVisibility() {
            secretHidden = !secretHidden;
            applySecretVisibility();
        }

        function applySecretVisibility() {
            document.getElementById('my-secret-display').style.display = secretHidden ? 'none' : 'block';
            document.getElementById('my-secret-hidden').style.display = secretHidden ? 'block' : 'none';
            document.getElementById('toggle-secret-btn').innerText = secretHidden ? '👁️ Afficher' : '🙈 Cacher';

            const img = document.getElementById('my-secret-image');
            const source = document.getElementById('my-secret-image-source');
            if (img && img.src) img.style.display = secretHidden ? 'none' : 'block';
            if (source && source.href) source.style.display = secretHidden ? 'none' : 'inline-block';
        }

        // À chaque nouveau mot/note attribué, on repart en mode visible
        function setSecretText(text) {
            const _el = document.getElementById('my-secret-display');
            _el.innerHTML = String(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/7/g, '<span class="seven">7</span>');
            secretHidden = false;
            clearFandomImage('my-secret-image', 'my-secret-image-source');

            const parsed = parseCharacterLabelClient(text);
            if (parsed.universe) {
                setFandomImage('my-secret-image', 'my-secret-image-source', parsed.universe, parsed.name, true)
                    .then(() => applySecretVisibility());
            }

            applySecretVisibility();
        }

        socket.on('prompt_theme_choice', (data) => {
            hideAllPanels();
            document.getElementById('gameplay-room').style.display = 'block';
            document.getElementById('game-phase-title').innerText = "Choix du Thème";
            
            currentThemeMasterId = data.themeMasterId;
            const me = data.room.players.find(p => p.id === socket.id);
            if (me && me.secretData) {
                setSecretText(`Note attribuée : ${me.secretData}`);
            }

            if (socket.id === currentThemeMasterId) {
                document.getElementById('game-info-text').innerText = "C'est à ton tour de choisir le sujet à noter !";
                document.getElementById('theme-selection-container').style.display = 'block';
            } else {
                const master = data.room.players.find(p => p.id === currentThemeMasterId);
                document.getElementById('game-info-text').innerText = `En attente du choix de thème par : ${master ? master.name : 'un joueur'}`;
            }
        });

        function submitCustomTheme() {
            const themeText = document.getElementById('custom-theme-input').value.trim();
            if (!themeText) {
                alert("Entre un thème valide !");
                return;
            }
            socket.emit('submit_custom_theme', { roomCode: currentRoomCode, theme: themeText });
            document.getElementById('custom-theme-input').value = "";
        }

        socket.on('theme_chosen', () => {
            document.getElementById('theme-selection-container').style.display = 'none';
        });

        socket.on('launch_reveal', (room) => {
            hideAllPanels();
            document.getElementById('gameplay-room').style.display = 'block';
            
            const me = room.players.find(p => p.id === socket.id);
            if (me && me.secretData) {
                if (room.mode === 'undercover') {
                    setSecretText(`${me.secretData}`);
                } else {
                    setSecretText(`${room.currentTheme} ➔ ${me.secretData}`);
                }
            }
            updateGameplayUI(room);
        });

        socket.on('update_gameplay', (room) => {
            updateGameplayUI(room);
        });

        socket.on('resume_gameplay', (room) => {
            hideAllPanels();
            document.getElementById('gameplay-room').style.display = 'block';
            
            const me = room.players.find(p => p.id === socket.id);
            if (me && me.secretData) {
                if (room.mode === 'undercover') {
                    setSecretText(`${me.secretData}`);
                } else {
                    setSecretText(`${room.currentTheme} ➔ ${me.secretData}`);
                }
            }
            updateGameplayUI(room);
        });

        function updateGameplayUI(room) {
            document.getElementById('game-phase-title').innerText = "Tour de parole";
            
            if (room.currentTurnIndex >= room.players.length || !room.players[room.currentTurnIndex].isAlive) {
                let firstAlive = room.players.findIndex(p => p.isAlive);
                if (firstAlive !== -1) room.currentTurnIndex = firstAlive;
            }

            const currentTurnPlayer = room.players[room.currentTurnIndex];
            let displayHeader = room.mode === 'undercover' ? `C'est au tour de : ${currentTurnPlayer ? currentTurnPlayer.name : 'Inconnu'}` : `Thème : ${room.currentTheme} | C'est au tour de : ${currentTurnPlayer ? currentTurnPlayer.name : 'Inconnu'}`;
            document.getElementById('game-info-text').innerText = displayHeader;

            const list = document.getElementById('gameplay-players-list');
            list.innerHTML = "";
            room.players.forEach((p, idx) => {
                if (!p.isAlive) return;
                let status = p.clue ? `💬 "${p.clue}"` : (idx === room.currentTurnIndex ? "En train d'écrire..." : "En attente");
                list.innerHTML += `<li><span>${p.name}</span> <span style="color:var(--text-muted)">${status}</span></li>`;
            });

            const me = room.players.find(p => p.id === socket.id);
            if (currentTurnPlayer && currentTurnPlayer.id === socket.id && me && me.isAlive) {
                document.getElementById('clue-input-container').style.display = 'flex';
            } else {
                document.getElementById('clue-input-container').style.display = 'none';
            }
        }

        function submitClue() {
            const clue = document.getElementById('clue-input').value.trim();
            if (!clue) return;
            socket.emit('submit_clue', { roomCode: currentRoomCode, clue: clue });
            document.getElementById('clue-input').value = "";
        }

        socket.on('prompt_end_clue_options', (room) => {
            document.getElementById('game-phase-title').innerText = "Fin des indices";
            document.getElementById('game-info-text').innerText = `Tous les indices ont été donnés. Que voulez-vous faire ?`;
            document.getElementById('clue-input-container').style.display = 'none';

            const list = document.getElementById('gameplay-players-list');
            list.innerHTML = "";
            room.players.forEach(p => {
                if (!p.isAlive) return;
                list.innerHTML += `<li><span>${p.name}</span> <span style="color:var(--accent-yellow)">💬 "${p.clue || 'Aucun'}"</span></li>`;
            });

            document.getElementById('end-clues-options').style.display = 'flex';
        });

        socket.on('prompt_end_clue_options_undercover', (room) => {
            document.getElementById('game-phase-title').innerText = "Fin des indices";
            document.getElementById('game-info-text').innerText = `Tous les indices ont été donnés. Que voulez-vous faire ?`;
            document.getElementById('clue-input-container').style.display = 'none';

            const list = document.getElementById('gameplay-players-list');
            list.innerHTML = "";
            room.players.forEach(p => {
                if (!p.isAlive) return;
                list.innerHTML += `<li><span>${p.name}</span> <span style="color:var(--accent-yellow)">💬 "${p.clue || 'Aucun'}"</span></li>`;
            });

            document.getElementById('end-clues-options-undercover').style.display = 'flex';
        });

        function requestChangeTheme() {
            document.getElementById('end-clues-options').style.display = 'none';
            socket.emit('change_theme_mid_game', { roomCode: currentRoomCode });
        }

        function proceedToVote() {
            document.getElementById('end-clues-options').style.display = 'none';
            socket.emit('force_start_voting', { roomCode: currentRoomCode });
        }

        function requestRestartClues() {
            document.getElementById('end-clues-options-undercover').style.display = 'none';
            socket.emit('restart_clues_undercover', { roomCode: currentRoomCode });
        }

        function proceedToVoteFromUndercover() {
            document.getElementById('end-clues-options-undercover').style.display = 'none';
            socket.emit('force_start_voting', { roomCode: currentRoomCode });
        }

        socket.on('start_voting', (room) => {
            window.__voted = !!(room.votes && room.votes[socket.id]);
            document.getElementById('game-phase-title').innerText = "Phase de Vote";
            document.getElementById('game-info-text').innerText = "Vérifie les indices et choisis qui éliminer :";
            document.getElementById('clue-input-container').style.display = 'none';
            document.getElementById('end-clues-options').style.display = 'none';
            document.getElementById('end-clues-options-undercover').style.display = 'none';

            const me = room.players.find(p => p.id === socket.id);
            if (me && me.isAlive) {
                document.getElementById('pass-vote-container').style.display = 'block';
            } else {
                document.getElementById('pass-vote-container').style.display = 'none';
            }

            const list = document.getElementById('gameplay-players-list');
            list.innerHTML = "";
            room.players.forEach(p => {
                if (!p.isAlive) return;
                let clueText = p.clue ? `💬 "${p.clue}"` : "Aucun indice";
                
                if (p.id !== socket.id && me && me.isAlive) {
                    list.innerHTML += `<li data-pid="${p.id}">
                        <div>
                            <strong>${p.name}</strong><br>
                            <span style="color:var(--accent-yellow); font-size:0.85rem;">${clueText}</span>
                        </div>
                        <button class="btn-action" style="width: auto; margin:0; padding:6px 12px; background:var(--accent-pink);" onclick="castVote('${p.id}')">Voter</button>
                    </li>`;
                } else {
                    list.innerHTML += `<li data-pid="${p.id}">
                        <div>
                            <strong>${p.name} ${p.id === socket.id ? '(Toi)' : ''}</strong><br>
                            <span style="color:var(--accent-yellow); font-size:0.85rem;">${clueText}</span>
                        </div>
                        <span style="color:var(--text-muted); font-size:0.85rem;">${!me.isAlive ? 'Éliminé' : 'Toi'}</span>
                    </li>`;
                }
            });
            if (room.votes) Object.keys(room.votes).forEach(vid => { const st = list.querySelector(`li[data-pid="${vid}"] strong`); if (st) st.insertAdjacentHTML('beforeend', '<span class="vote-done-tag">✔ a voté</span>'); });
            if (window.__voted) list.querySelectorAll('button').forEach(b => { b.disabled = true; b.style.opacity = '.35'; });

            if (room.mode === 'undercover' && room.subMode === 'hardcore' && me && me.isAlive) {
                list.innerHTML += `<li style="border-left-color: var(--accent-yellow);">
                    <div><strong>🕵️ Option Hardcore</strong><br><span style="color:var(--accent-yellow); font-size:0.85rem;">Tout le monde a le même perso / Pas d'imposteur</span></div>
                    <button class="btn-action" style="width: auto; margin:0; padding:6px 12px; background:var(--accent-yellow); color:black;" onclick="castVote('no_impostor')">Pas d'imposteur</button>
                </li>`;
            }
        });

        function castVote(targetId) {
            if (window.__voted) return;
            window.__voted = true;
            socket.emit('cast_vote', { roomCode: currentRoomCode, targetId: targetId });
            document.getElementById('game-info-text').innerText = "Vote enregistré ! En attente des autres joueurs...";
            document.getElementById('pass-vote-container').style.display = 'none';
            document.querySelectorAll('#gameplay-players-list button, .player-list button').forEach(b => { b.disabled = true; b.style.opacity = '.35'; });
            showVoteStamp();
        }
        function showVoteStamp() {
            document.querySelectorAll('.vote-stamp-ov').forEach(x => x.remove());
            const ov = document.createElement('div'); ov.className = 'vote-stamp-ov';
            ov.innerHTML = '<div class="vote-stamp"><div class="vs-box">🗳️</div><div class="vs-txt">A VOTÉ !</div></div>';
            document.body.appendChild(ov);
            try { if (typeof sfxValide === 'function') sfxValide(); } catch (_) {}
            try { if (navigator.vibrate) navigator.vibrate(40); } catch (_) {}
            setTimeout(() => ov.remove(), 1700);
        }
        socket.on('vote_progress', d => {
            if (!d) return;
            const t = document.getElementById('game-phase-title');
            if (t && t.innerText.startsWith('Phase de Vote')) t.innerText = `Phase de Vote (${d.voted}/${d.total})`;
            const btn = document.querySelector(`#gameplay-players-list li[data-pid="${d.voterId}"] strong`);
            if (btn && !btn.querySelector('.vote-done-tag')) btn.insertAdjacentHTML('beforeend', '<span class="vote-done-tag">✔ a voté</span>');
        });

        socket.on('show_results', (data) => {
            document.getElementById('game-phase-title').innerText = data.gameOver ? "Fin de la Partie" : "Résultats du Tour";
            document.getElementById('pass-vote-container').style.display = 'none';
            document.getElementById('clue-input-container').style.display = 'none';
            document.getElementById('end-clues-options').style.display = 'none';
            document.getElementById('end-clues-options-undercover').style.display = 'none';
            
            let resultMessage = "";
            if (data.eliminatedPlayer) {
                let roleInfo = data.eliminatedPlayer.isImpostor ? "<span style='color:var(--accent-pink)'>C'était un IMPOSTEUR !</span>" : "<span style='color:#00ff88'>C'était un Innocent !</span>";
                resultMessage += `Joueur éliminé : <strong>${data.eliminatedPlayer.name}</strong> (${roleInfo})<br><br>`;
            } else {
                resultMessage += `Égalité ou vote « Pas d'imposteur » validé.<br><br>`;
            }

            if (data.gameOver) {
                resultMessage += `<strong style="font-size: 1.2rem; color: var(--accent-yellow);">${data.winnerMessage}</strong><br><br>`;
                document.getElementById('end-game-buttons').style.display = 'flex';
            } else {
                if (data.winnerMessage) resultMessage += `<strong style="color: var(--accent-yellow);">${data.winnerMessage}</strong><br>`;
                resultMessage += `<span style="color: var(--accent-cyan);">Nouveau tour d'indices dans 4 secondes...</span>`;
                setTimeout(() => { socket.emit('next_step_game', currentRoomCode); }, 4000);
            }

            document.getElementById('game-info-text').innerHTML = resultMessage;
            
            const list = document.getElementById('gameplay-players-list');
            list.innerHTML = "";
            data.room.players.forEach(p => {
                let statusColor = p.isAlive ? "#00ff88" : "var(--accent-pink)";
                let statusText = p.isAlive ? "En vie" : "Éliminé";
                let roleText = data.gameOver ? (p.isImpostor ? " [IMPOSTEUR]" : " [CIVIL]") : "";
                let secretTxt = (p.secretData && data.gameOver) ? ` (${p.secretData})` : ''; // le mot n'est dévoilé qu'en fin de partie
                list.innerHTML += `<li><span>${p.name}${roleText}${secretTxt}</span> <span style="color:${statusColor}">${statusText}</span></li>`;
            });
        });

        function nextStepGame() { socket.emit('next_step_game', currentRoomCode); }

        /* ================= V20 — Playlist Anime ================= */
        const BACKGROUND_MUSIC_TRACKS = [{"title":"Ai Higuchi - 悪魔の子","src":"/music/track_001.mp3"},{"title":"Aimer - 残響散歌","src":"/music/track_002.mp3"},{"title":"AiNA THE END - 革命道中 - On The Way","src":"/music/track_003.mp3"},{"title":"ALI, AKLO - LOST IN PARADISE","src":"/music/track_004.mp3"},{"title":"amazarashi - 空に歌えば","src":"/music/track_005.mp3"},{"title":"amazarashi, Naeleck - 境界線 (Naeleck Remix) - SACRA BEATS Singles","src":"/music/track_006.mp3"},{"title":"ASIAN KUNG-FU GENERATION - ブラッドサーキュレーター","src":"/music/track_007.mp3"},{"title":"ASIAN KUNG-FU GENERATION - 遥か彼方","src":"/music/track_008.mp3"},{"title":"BLUE ENCOUNT - ポラリス","src":"/music/track_009.mp3"},{"title":"BURNOUT SYNDROMES - FLY HIGH!!","src":"/music/track_010.mp3"},{"title":"bôa - Duvet","src":"/music/track_011.mp3"},{"title":"Coda - BLOODY STREAM","src":"/music/track_012.mp3"},{"title":"Creepy Nuts - Bling-Bang-Bang-Born","src":"/music/track_013.mp3"},{"title":"Creepy Nuts - オトノケ - Otonoke","src":"/music/track_014.mp3"},{"title":"Cö shu Nie - asphyxia","src":"/music/track_015.mp3"},{"title":"Cö shu Nie, Naeleck - SAKURA BURST (Naeleck Remix) - SACRA BEATS Singles","src":"/music/track_016.mp3"},{"title":"Eve - Kaikai Kitan","src":"/music/track_017.mp3"},{"title":"Fear, and Loathing in Las Vegas - Let Me Hear","src":"/music/track_018.mp3"},{"title":"FLOW - COLORS","src":"/music/track_019.mp3"},{"title":"FLOW - GO!!!","src":"/music/track_020.mp3"},{"title":"FLOW - Sign","src":"/music/track_021.mp3"},{"title":"Fukkk Offf, Naeleck, KATFYR - Bang Your Head - Naeleck & KATFYR Remix","src":"/music/track_022.mp3"},{"title":"GALNERYUS - HUNTING FOR YOUR DREAM","src":"/music/track_023.mp3"},{"title":"Gen Hoshino - Comedy","src":"/music/track_024.mp3"},{"title":"Given - 冬のはなし","src":"/music/track_025.mp3"},{"title":"Hello Sleepwalkers - Goya No Machiawase","src":"/music/track_026.mp3"},{"title":"Ikimonogakari - ブルーバード","src":"/music/track_027.mp3"},{"title":"Ikimonogakari - ホタルノヒカリ","src":"/music/track_028.mp3"},{"title":"KANA-BOON - ないものねだり","src":"/music/track_029.mp3"},{"title":"KANA-BOON - シルエット","src":"/music/track_030.mp3"},{"title":"Kenshi Yonezu - IRIS OUT","src":"/music/track_031.mp3"},{"title":"Kenshi Yonezu - KICK BACK","src":"/music/track_032.mp3"},{"title":"Kenshi Yonezu - ピースサイン - Peace Sign","src":"/music/track_033.mp3"},{"title":"King Gnu - SPECIALZ","src":"/music/track_034.mp3"},{"title":"Lilas - 百花繚乱","src":"/music/track_035.mp3"},{"title":"Linked Horizon - Guren no Yumiya Tv Size Ver.","src":"/music/track_036.mp3"},{"title":"Linked Horizon - Shinzo wo Sasageyo! - TV Size","src":"/music/track_037.mp3"},{"title":"LiSA - Catch the Moment","src":"/music/track_038.mp3"},{"title":"LiSA - だってアタシのヒーロー。","src":"/music/track_040.mp3"},{"title":"LiSA - 紅蓮華","src":"/music/track_041.mp3"},{"title":"LiSA, Felix - ReawakeR (feat. Felix of Stray Kids)","src":"/music/track_042.mp3"},{"title":"MAN WITH A MISSION - Seven Deadly Sins","src":"/music/track_043.mp3"},{"title":"MAN WITH A MISSION, milet - 絆ノ奇跡","src":"/music/track_044.mp3"},{"title":"Masatoshi Ono - Departure!","src":"/music/track_045.mp3"},{"title":"Mika Nakashima - KISS OF DEATH（Produced by HYDE）","src":"/music/track_046.mp3"},{"title":"Mrs. GREEN APPLE - インフェルノ","src":"/music/track_047.mp3"},{"title":"Mrs. GREEN APPLE - ライラック","src":"/music/track_048.mp3"},{"title":"Ner Leva - My War (Attack on Titan) - 僕の戦争","src":"/music/track_049.mp3"},{"title":"Ner Leva - The Rumbling (Attack on Titan)","src":"/music/track_050.mp3"},{"title":"NIGHTMARE - the WORLD","src":"/music/track_051.mp3"},{"title":"OFFICIAL HIGE DANDISM - Cry Baby","src":"/music/track_052.mp3"},{"title":"OFFICIAL HIGE DANDISM - Mixed Nuts","src":"/music/track_053.mp3"},{"title":"Otaku - Asterisk (Bleach)","src":"/music/track_054.mp3"},{"title":"Otaku - Blue Bird (Naruto)","src":"/music/track_055.mp3"},{"title":"Otaku - Bye Bye Yesterday (Assassination Classroom)","src":"/music/track_056.mp3"},{"title":"Otaku - Departure! (Hunter X Hunter)","src":"/music/track_057.mp3"},{"title":"Otaku - Guren No Yumiya (Attack On Titan)","src":"/music/track_058.mp3"},{"title":"Otaku - Jiyuu No Tsubasa (SNK)","src":"/music/track_059.mp3"},{"title":"Otaku - Kyoran Hey Kids!! (Noragami Aragoto)","src":"/music/track_060.mp3"},{"title":"Otaku - Resonance (Soul Eater)","src":"/music/track_061.mp3"},{"title":"Otaku - The World (Death Note)","src":"/music/track_062.mp3"},{"title":"Otaku, LoFi Waiter - Bloody Stream (Jojo)","src":"/music/track_063.mp3"},{"title":"Otaku, LoFi Waiter - Hacking to the Gate (Stein;Gate)","src":"/music/track_064.mp3"},{"title":"Otaku, LoFi Waiter - Silhouette (Naruto Shippuden)","src":"/music/track_065.mp3"},{"title":"Otaku, LoFi Waiter - Tank! (Cowboy Bebop)","src":"/music/track_066.mp3"},{"title":"PornoGraffitti - THE DAY","src":"/music/track_067.mp3"},{"title":"Radiohead - Paranoid Android","src":"/music/track_068.mp3"},{"title":"RADWIMPS - Nandemonaiya - movie ver.","src":"/music/track_069.mp3"},{"title":"RADWIMPS - 前前前世 - movie ver.","src":"/music/track_070.mp3"},{"title":"RADWIMPS - 夢灯籠","src":"/music/track_071.mp3"},{"title":"Ryuven, Ner Leva - Kyoumen no Nami (Houseki no Kuni) - 鏡面の波","src":"/music/track_072.mp3"},{"title":"Sawano Hiroyuki - Attack on Titan","src":"/music/track_073.mp3"},{"title":"Sawano Hiroyuki - The Reluctant Heroes","src":"/music/track_074.mp3"},{"title":"Sawano Hiroyuki - You See Big Girl T T","src":"/music/track_075.mp3"},{"title":"SiM - Under the Tree","src":"/music/track_076.mp3"},{"title":"Tatsuya Kitani - 青のすみか","src":"/music/track_077.mp3"},{"title":"THE ORAL CIGARETTES - Kyouran Hey Kids!!","src":"/music/track_078.mp3"},{"title":"Tia - Deal with the devil","src":"/music/track_079.mp3"},{"title":"TK from Ling tosite sigure - unravel","src":"/music/track_080.mp3"},{"title":"UVERworld - ODD FUTURE","src":"/music/track_081.mp3"},{"title":"UVERworld - Touch off","src":"/music/track_082.mp3"},{"title":"YOASOBI - アイドル","src":"/music/track_083.mp3"},{"title":"YOASOBI - 夜に駆ける","src":"/music/track_084.mp3"},{"title":"YOASOBI - 怪物","src":"/music/track_085.mp3"},{"title":"Yorushika - 晴る","src":"/music/track_086.mp3"},{"title":"YUI - again","src":"/music/track_087.mp3"}];

        let AVAILABLE_MUSIC_TRACKS = [...BACKGROUND_MUSIC_TRACKS];

        async function loadAvailableMusicTracks() {
            // La playlist reste toujours composée des 87 titres.
            AVAILABLE_MUSIC_TRACKS = [...BACKGROUND_MUSIC_TRACKS];

            try {
                const r = await fetch('/api/music-tracks', { cache:'no-store' });
                if (!r.ok) throw new Error(`HTTP ${r.status}`);
                const data = await r.json();
                const deployed = new Set((data?.tracks || []).map(String));

                const countEl = document.getElementById('music-file-count');
                if (countEl) {
                    countEl.textContent =
                        `${deployed.size}/87 fichiers audio présents sur le serveur`;
                }
            } catch (e) {
                console.warn('[Musique] Diagnostic fichiers indisponible', e);
            }

            // + tous les openings YouTube du blind test
            try {
                const d = await (await fetch('/api/music/openings', { cache: 'no-store' })).json();
                if (d && d.ok) AVAILABLE_MUSIC_TRACKS = AVAILABLE_MUSIC_TRACKS.concat(d.tracks || []);
            } catch (_) {}
            return AVAILABLE_MUSIC_TRACKS;
        }
        const MUSIC_ENABLED_KEY = 'anime_game_music_enabled_v1';
        const MUSIC_VOLUME_KEY = 'anime_game_music_volume_v1';

        const backgroundMusic = new Audio();
        backgroundMusic.preload = 'metadata';
        backgroundMusic.crossOrigin = 'anonymous';

        let musicEnabled = localStorage.getItem(MUSIC_ENABLED_KEY) !== '0';
        const _storedVol = localStorage.getItem(MUSIC_VOLUME_KEY);
        let musicVolume = _storedVol === null || _storedVol === '' ? 0.18 : Number(_storedVol); // null donnait 0 : musique muette au premier passage
        if (!Number.isFinite(musicVolume)) musicVolume = 0.18;
        musicVolume = Math.max(0, Math.min(1, musicVolume));

        let musicOrder = [];
        let musicOrderPos = -1;
        let musicStarted = false;

        function shuffleMusicOrder() {
            musicOrder = AVAILABLE_MUSIC_TRACKS.map((_, i) => i);
            for (let i = musicOrder.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [musicOrder[i], musicOrder[j]] = [musicOrder[j], musicOrder[i]];
            }
            musicOrderPos = -1;
        }

        function currentMusicTrack() {
            if (musicOrderPos < 0 || musicOrderPos >= musicOrder.length) return null;
            return AVAILABLE_MUSIC_TRACKS[musicOrder[musicOrderPos]];
        }

        /* ---- Openings YouTube dans le lecteur du menu ---- */
        let musicYt = null, musicYtReady = null, musicYtPlaying = false, musicYtBlocked = false, musicYtTimer = null, musicYtWant = null;
        function musicPaused() { const t = currentMusicTrack(); return t && t.yt ? !musicYtPlaying : backgroundMusic.paused; }
        function musicYtBox(show, hint) {
            const b = document.getElementById('music-yt-box'); if (!b) return;
            b.style.display = show ? '' : 'none';
            const h = document.getElementById('music-yt-hint'); if (h) { h.textContent = hint || ''; h.style.display = hint ? '' : 'none'; }
        }
        async function musicYtEnsure() {
            if (musicYtReady) return musicYtReady;
            musicYtReady = (async () => {
                const YT = await ytApi();
                await new Promise(res => {
                    musicYt = new YT.Player('music-yt', {
                        width: '100%', height: '100%',
                        playerVars: { autoplay: 1, controls: 0, playsinline: 1, rel: 0, disablekb: 1, fs: 0, iv_load_policy: 3 },
                        events: {
                            onReady: () => res(),
                            onStateChange: e => {
                                if (e.data === 1) { // lecture
                                    clearTimeout(musicYtTimer);
                                    if (window.__btActive) { try { musicYt.pauseVideo(); } catch (_) {} return; }
                                    musicYtPlaying = true;
                                    if (musicYtBlocked) { // débloqué par un toucher sur la vidéo : l'opening devient le titre en cours
                                        musicYtBlocked = false;
                                        backgroundMusic.pause();
                                        const i = AVAILABLE_MUSIC_TRACKS.findIndex(t => t.yt === musicYtWant);
                                        const pos = musicOrder.indexOf(i); if (pos >= 0) musicOrderPos = pos;
                                        musicYtBox(true, '');
                                    }
                                    try { musicYt.setVolume(Math.round(musicVolume * 100)); } catch (_) {}
                                } else if (e.data === 0) { musicYtPlaying = false; const t = currentMusicTrack(); if (t && t.yt) nextMusicTrack(); }
                                else if (e.data === 2) musicYtPlaying = false;
                                updateMusicUI();
                            },
                            onError: () => { musicYtPlaying = false; const t = currentMusicTrack(); if (t && t.yt) setTimeout(nextMusicTrack, 300); }
                        }
                    });
                });
            })().catch(() => { musicYtReady = null; });
            return musicYtReady;
        }
        async function musicYtPlay(id) {
            backgroundMusic.pause();
            musicYtBox(true, '');
            musicYtWant = id;
            await musicYtEnsure();
            if (!musicYt) return nextMusicTrack();
            try { musicYt.setVolume(Math.round(musicVolume * 100)); musicYt.loadVideoById(id); musicYt.playVideo(); } catch (_) {}
            clearTimeout(musicYtTimer);
            // Téléphone : la lecture YouTube automatique peut être bloquée → on passe à un mp3, la vidéo reste là pour un toucher
            musicYtTimer = setTimeout(() => {
                if (musicYtPlaying || musicYtWant !== id) return;
                musicYtBlocked = true;
                try { musicYt.cueVideoById(id); } catch (_) {}
                musicYtBox(true, '👆 Touche la vidéo pour écouter les openings');
                nextMusicTrack();
            }, 6000);
        }
        function musicYtPause() { clearTimeout(musicYtTimer); try { if (musicYt && musicYt.pauseVideo) musicYt.pauseVideo(); } catch (_) {} musicYtPlaying = false; }
        function musicResume() {
            const t = currentMusicTrack();
            if (t && t.yt) { if (musicYt) { try { musicYt.playVideo(); } catch (_) {} } else musicYtPlay(t.yt); }
            else backgroundMusic.play().catch(() => {});
        }

        function updateMusicUI() {
            const track = currentMusicTrack();
            const title = track ? track.title : 'Playlist Anime — prête';
            const now = document.getElementById('music-now-playing');
            const opt = document.getElementById('music-options-track');
            const play = document.getElementById('music-play-btn');
            const counter = document.getElementById('music-counter');
            const toggle = document.getElementById('music-toggle-btn');
            const vol1 = document.getElementById('music-volume');
            const vol2 = document.getElementById('music-options-volume');
            const countEl = document.getElementById('music-file-count');

            const nYt = AVAILABLE_MUSIC_TRACKS.filter(t => t.yt).length;
            if (countEl) countEl.textContent = `Playlist : ${AVAILABLE_MUSIC_TRACKS.length} titres (${AVAILABLE_MUSIC_TRACKS.length - nYt} mp3 + ${nYt} openings du blind test)`;
            if (now) now.textContent = '🎵 ' + title;
            if (opt) opt.textContent = title;
            if (play) play.textContent = musicPaused() ? '▶' : '⏸';
            if (counter) counter.textContent = track ? `${musicOrderPos + 1}/${musicOrder.length}` : `0/${AVAILABLE_MUSIC_TRACKS.length}`;
            if (toggle) {
                toggle.textContent = musicEnabled ? '🎵 Activée' : '🔇 Coupée';
                toggle.style.background = musicEnabled ? '#00ff88' : '#55556a';
                toggle.style.color = musicEnabled ? '#000' : '#fff';
            }
            const value = Math.round(musicVolume * 100);
            if (vol1 && Number(vol1.value) !== value) vol1.value = value;
            if (vol2 && Number(vol2.value) !== value) vol2.value = value;
        }

        async function playMusicAtOrderPosition(pos) {
            if (window.__btActive) return; // jamais de musique de fond pendant un Blind Test
            if (!AVAILABLE_MUSIC_TRACKS.length || !musicEnabled) {
                updateMusicUI();
                return;
            }
            if (!musicOrder.length) shuffleMusicOrder();

            if (pos < 0) pos = musicOrder.length - 1;
            if (pos >= musicOrder.length) {
                shuffleMusicOrder();
                pos = 0;
            }
            musicOrderPos = pos;
            const track = currentMusicTrack();
            if (!track) return;
            if (track.yt) {
                if (musicYtBlocked) { // YouTube bloqué sur cet appareil : on cherche le prochain mp3
                    const nxt = musicOrder.findIndex((ti, p) => p > pos && !AVAILABLE_MUSIC_TRACKS[ti].yt);
                    if (nxt >= 0 && nxt !== pos) return playMusicAtOrderPosition(nxt);
                }
                musicStarted = true;
                updateMusicUI();
                return musicYtPlay(track.yt);
            }
            musicYtPause();
            if (!musicYtBlocked) musicYtBox(false);

            backgroundMusic.src = track.src;
            backgroundMusic.volume = musicVolume;
            musicStarted = true;
            updateMusicUI();

            try {
                await backgroundMusic.play();
            } catch (_) {
                // Le navigateur attendra le prochain clic/touche de l'utilisateur.
            }
            updateMusicUI();
        }

        function startBackgroundMusicIfAllowed() {
            if (window.__btActive) return;
            if (!musicEnabled || musicStarted || !AVAILABLE_MUSIC_TRACKS.length) return;
            if (!musicOrder.length) shuffleMusicOrder();
            playMusicAtOrderPosition(0);
        }

        function nextMusicTrack() {
            if (!musicOrder.length) shuffleMusicOrder();
            playMusicAtOrderPosition(musicOrderPos + 1);
        }

        function previousMusicTrack() {
            if (!musicOrder.length) shuffleMusicOrder();
            playMusicAtOrderPosition(musicOrderPos - 1);
        }

        async function toggleMusicPlayback() {
            if (!musicEnabled) {
                musicEnabled = true;
                localStorage.setItem(MUSIC_ENABLED_KEY, '1');
            }
            if (!musicStarted) {
                startBackgroundMusicIfAllowed();
                return;
            }
            if (musicPaused()) musicResume();
            else { backgroundMusic.pause(); musicYtPause(); }
            updateMusicUI();
        }

        function toggleBackgroundMusic() {
            musicEnabled = !musicEnabled;
            localStorage.setItem(MUSIC_ENABLED_KEY, musicEnabled ? '1' : '0');
            if (!musicEnabled) {
                backgroundMusic.pause();
                musicYtPause();
            } else {
                if (!musicStarted) startBackgroundMusicIfAllowed();
                else musicResume();
            }
            updateMusicUI();
        }

        function setMusicVolume(value) {
            musicVolume = Math.max(0, Math.min(1, Number(value) || 0));
            backgroundMusic.volume = musicVolume;
            try { if (musicYt && musicYt.setVolume) musicYt.setVolume(Math.round(musicVolume * 100)); } catch (_) {}
            localStorage.setItem(MUSIC_VOLUME_KEY, String(musicVolume));
            updateMusicUI();
        }

        function toggleMusicPlayerCollapse() {
            const el = document.getElementById('music-player');
            const btn = document.getElementById('music-collapse-btn');
            if (!el) return;
            el.classList.toggle('music-collapsed');
            if (btn) btn.textContent = el.classList.contains('music-collapsed') ? '▴' : '▾';
        }

        backgroundMusic.addEventListener('ended', nextMusicTrack);
        backgroundMusic.addEventListener('pause', updateMusicUI);
        let consecutiveMusicErrors = 0;

        backgroundMusic.addEventListener('play', () => {
            // Pendant un Blind Test, la musique de fond est coupée d'office (sinon 2 sons en même temps)
            if (window.__btActive) {
                backgroundMusic.pause();
                window.__btBgBlocked = true;
                return;
            }
            consecutiveMusicErrors = 0;
            updateMusicUI();
        });

        backgroundMusic.addEventListener('error', () => {
            consecutiveMusicErrors++;
            if (consecutiveMusicErrors >= BACKGROUND_MUSIC_TRACKS.length) {
                backgroundMusic.pause();
                const now = document.getElementById('music-now-playing');
                if (now) now.textContent = '🎵 Aucun fichier MP3 accessible pour le moment';
                updateMusicUI();
                return;
            }
            setTimeout(nextMusicTrack, 250);
        });

        // Les navigateurs refusent l'autoplay sonore avant une interaction utilisateur.
        // Un seul clic/touche suffit ensuite pour lancer la playlist.
        async function unlockBackgroundMusic() {
            if (!AVAILABLE_MUSIC_TRACKS.length) {
                await loadAvailableMusicTracks();
                shuffleMusicOrder();
            }
            startBackgroundMusicIfAllowed();
            document.removeEventListener('pointerdown', unlockBackgroundMusic);
            document.removeEventListener('keydown', unlockBackgroundMusic);
        }
        document.addEventListener('pointerdown', unlockBackgroundMusic, { once:true });
        document.addEventListener('keydown', unlockBackgroundMusic, { once:true });

        document.addEventListener('DOMContentLoaded', async () => {
            backgroundMusic.volume = musicVolume;
            await loadAvailableMusicTracks();
            shuffleMusicOrder();
            updateMusicUI();
        });

        let returningToWaitingRoom = false;

        function backToMenu() {
            arcStopMedia();
            if (typeof btStopAudio === 'function') btStopAudio();
            if (!currentRoomCode) {
                goToMenuSelection();
                return;
            }

            // Important : V18 bloquait ensuite l'update_room du serveur parce qu'un
            // panneau de jeu était encore visible. On marque explicitement ce retour.
            returningToWaitingRoom = true;

            // Feedback immédiat : évite l'impression que le bouton ne fonctionne pas.
            hideAllPanels();
            const waiting = document.getElementById('waiting-room');
            if (waiting) waiting.style.display = 'block';

            socket.emit('back_to_menu', currentRoomCode);
        }

        /* ---------------- Effets sonores (synthétisés, aucun fichier) ---------------- */

        const SFX_KEY = 'rg_sfx_on';
        let sfxOn = localStorage.getItem(SFX_KEY) !== '0'; // activés par défaut
        let audioCtx = null;
        let rgMonTour = false;

        function ctx() {
            if (!audioCtx) {
                const AC = window.AudioContext || window.webkitAudioContext;
                if (!AC) return null;
                audioCtx = new AC();
            }
            if (audioCtx.state === 'suspended') audioCtx.resume();
            return audioCtx;
        }

        // Note douce : sinus, attaque et extinction progressives (pas d'effet arcade)
        function bip(freq, duree, vol = 0.09, delai = 0, type = 'sine') {
            if (!sfxOn) return;
            const c = ctx();
            if (!c) return;
            const t0 = c.currentTime + delai;
            const osc = c.createOscillator();
            const gain = c.createGain();
            osc.type = type;
            osc.frequency.setValueAtTime(freq, t0);
            gain.gain.setValueAtTime(0, t0);
            gain.gain.linearRampToValueAtTime(vol, t0 + 0.03);
            gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duree);
            osc.connect(gain); gain.connect(c.destination);
            osc.start(t0); osc.stop(t0 + duree + 0.05);
        }

        // Frappe clavier : un simple tap feutré, très court et discret
        function sfxTouche() {
            if (!sfxOn) return;
            const c = ctx();
            if (!c) return;
            const t0 = c.currentTime;
            const osc = c.createOscillator();
            const gain = c.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(320, t0);
            osc.frequency.exponentialRampToValueAtTime(180, t0 + 0.04);
            gain.gain.setValueAtTime(0.035, t0);
            gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.05);
            osc.connect(gain); gain.connect(c.destination);
            osc.start(t0); osc.stop(t0 + 0.07);
        }

        function sfxValide() {   // perso trouvé : deux notes douces, montantes
            bip(587, 0.18, 0.09, 0);
            bip(880, 0.3, 0.075, 0.1);
        }

        function sfxErreur() {   // mauvaise réponse : note grave et sourde
            bip(220, 0.28, 0.085, 0);
            bip(165, 0.36, 0.07, 0.1);
        }

        function sfxDejaCite() { // déjà cité : simple note neutre
            bip(392, 0.2, 0.06, 0);
        }

        function sfxTicTac() {   // décompte : tic discret et grave
            bip(520, 0.07, 0.045, 0);
        }

        function sfxTempsEcoule() { // temps écoulé : descente douce
            bip(330, 0.22, 0.08, 0);
            bip(220, 0.45, 0.075, 0.16);
        }

        function sfxFinPartie() { // fin de partie : petit accord posé
            bip(523, 0.35, 0.075, 0);
            bip(659, 0.35, 0.065, 0.04);
            bip(784, 0.5, 0.06, 0.08);
        }

        /* ---- Soundboard Rolland Garos (panneau admin > 🔊 Soundboard) ----
           vie = vie perdue, elimine = 2 vies perdues. Un son uploadé par l'admin remplace celui du site.
           Sans son uploadé, on garde les sons synthétisés. */
        // Sons de Rolland Garos (fichiers du site) : FAH = vie perdue, fusil à pompe Fortnite = éliminé
        const SFX_DEFAUT = { vie: '/music/sfx/fah.mp3', elimine: '/music/sfx/spas12.mp3' };
        const sfxBoard = { at: {}, audio: {} };
        function sfxBoardSet(k, url) { const a = new Audio(url); a.preload = 'auto'; sfxBoard.audio[k] = a; }
        Object.entries(SFX_DEFAUT).forEach(([k, url]) => sfxBoardSet(k, url));
        async function sfxBoardLoad() {
            let d = null; try { d = await (await fetch('/api/sfx')).json(); } catch (_) {}
            if (!d || !d.ok) return;
            sfxBoard.at = d.sfx || {};
            Object.keys(SFX_DEFAUT).forEach(k => sfxBoardSet(k, sfxBoard.at[k] ? '/api/sfx/' + k + '?v=' + sfxBoard.at[k] : SFX_DEFAUT[k]));
        }
        function sfxBoardPlay(k, vol = 0.9) {
            const a = sfxBoard.audio[k];
            if (!sfxOn || !a) return false;
            try { a.pause(); a.currentTime = 0; a.volume = vol; a.play().catch(() => {}); return true; } catch (_) { return false; }
        }
        sfxBoardLoad();
        socket.on('connect', () => setTimeout(sfxBoardLoad, 800));
        socket.on('sfx_update', sfxBoardLoad);
        function sfxBoom(duree, vol, freqDebut, delai = 0) { // bruit filtré + coup grave = explosion
            const c = ctx();
            if (!c) return;
            const t0 = c.currentTime + delai;
            const len = Math.floor(c.sampleRate * duree);
            const buf = c.createBuffer(1, len, c.sampleRate);
            const d = buf.getChannelData(0);
            for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
            const src = c.createBufferSource(); src.buffer = buf;
            const lp = c.createBiquadFilter(); lp.type = 'lowpass';
            lp.frequency.setValueAtTime(freqDebut, t0);
            lp.frequency.exponentialRampToValueAtTime(80, t0 + duree);
            const g = c.createGain();
            g.gain.setValueAtTime(vol, t0);
            g.gain.exponentialRampToValueAtTime(0.0001, t0 + duree);
            src.connect(lp); lp.connect(g); g.connect(c.destination);
            src.start(t0); src.stop(t0 + duree + 0.05);
            const o = c.createOscillator(), og = c.createGain(); // le "boum" dans les basses
            o.type = 'sine';
            o.frequency.setValueAtTime(140, t0);
            o.frequency.exponentialRampToValueAtTime(35, t0 + duree * 0.7);
            og.gain.setValueAtTime(vol * 1.4, t0);
            og.gain.exponentialRampToValueAtTime(0.0001, t0 + duree * 0.7);
            o.connect(og); og.connect(c.destination);
            o.start(t0); o.stop(t0 + duree);
        }
        function sfxExplosion() { // une vie perdue : FAH (sinon petite explosion synthétisée)
            if (!sfxOn) return;
            if (sfxBoardPlay('vie', 0.7)) return;
            sfxBoom(0.7, 0.35, 2400);
        }
        function sfxElimine() { // plus de vie : fusil à pompe Fortnite (sinon grosse explosion + mélodie de défaite)
            if (!sfxOn) return;
            if (sfxBoardPlay('elimine')) return;
            sfxBoom(1.4, 0.5, 4000);
            [[587, 0.25], [554, 0.5], [523, 0.75], [494, 1.0]].forEach(([f, t], i) => bip(f, i === 3 ? 0.9 : 0.3, 0.07, t, 'square'));
        }

        function toggleSfx() {
            sfxOn = !sfxOn;
            localStorage.setItem(SFX_KEY, sfxOn ? '1' : '0');
            majBoutonSfx();
            if (sfxOn) sfxValide();
        }

        function majBoutonSfx() {
            const btn = document.getElementById('sfx-toggle-btn');
            if (!btn) return;
            btn.innerText = sfxOn ? '🔊 Activés' : '🔇 Désactivés';
            btn.style.background = sfxOn ? '#00ff88' : 'var(--text-muted)';
            btn.style.color = sfxOn ? '#000' : '#fff';
        }

        /* ---------------- Rolland Garos ---------------- */

        function submitRgAnswer() {
            const input = document.getElementById('rg-answer-input');
            const val = input.value.trim();
            if (!val) return;
            socket.emit('rg_submit_answer', { roomCode: currentRoomCode, answer: val });
            input.value = "";
        }

        // Son de frappe quand on écrit sa réponse
        document.addEventListener('keydown', (e) => {
            if (!document.activeElement || document.activeElement.id !== 'rg-answer-input') return;
            if (e.key === 'Enter') {
                submitRgAnswer();
            } else if (e.key.length === 1 || e.key === 'Backspace') {
                sfxTouche();
            }
        });

        socket.on('rg_state', (room) => {
            hideAllPanels();
            document.getElementById('rg-room').style.display = 'block';
            renderRgState(room);
        });

        socket.on('rg_tick', (data) => {
            const t = Math.max(data.timeLeft, 0);
            document.getElementById('rg-timer').innerText = t;
            const fill = document.getElementById('rg-timer-fill');
            fill.style.width = (t * 10) + '%';
            fill.style.background = t <= 3 ? 'var(--accent-pink)' : 'var(--accent-cyan)';

            // Tic-tac sur les 3 dernières secondes, seulement si c'est ton tour
            if (t > 0 && t <= 3 && rgMonTour) sfxTicTac();
        });

        socket.on('rg_feedback', (data) => {
            const fb = document.getElementById('rg-feedback');
            fb.innerText = data.message;
            fb.style.color = data.ok ? '#00ff88' : 'var(--accent-pink)';

            if (data.ok) {
                sfxValide();
            } else if (data.message.indexOf('est éliminé') !== -1) {
                sfxElimine();   // plus aucune vie : fusil à pompe Fortnite
            } else if (data.message.indexOf('perd une vie') !== -1) {
                sfxExplosion(); // une vie en moins : FAH
            } else if (data.message.indexOf('Déjà cité') !== -1) {
                sfxDejaCite();
            } else if (data.message.indexOf('Trop lent') !== -1) {
                sfxTempsEcoule();
            } else {
                sfxErreur();
            }
        });

        socket.on('rg_game_over', (data) => {
            renderRgState(data.room);
            sfxFinPartie();
            document.getElementById('rg-turn-info').innerText = "Partie terminée !";
            document.getElementById('rg-input-container').style.display = 'none';
            document.getElementById('rg-end-buttons').style.display = 'flex';
            const fb = document.getElementById('rg-feedback');
            const winner = data.room.rg.winnerName;
            fb.innerText = winner
                ? `🏆 ${winner} gagne ! (${data.room.rg.score} perso(s) trouvé(s) au total)`
                : `Score final : ${data.room.rg.score} personnage(s) trouvé(s) !`;
            fb.style.color = 'var(--accent-yellow)';
        });

        function renderRgState(room) {
            const rg = room.rg;
            if (!rg) return;

            document.getElementById('rg-universe-label').innerText = "Univers : " + rg.universeName;
            document.getElementById('rg-score').innerText = rg.score;

            const aliveCount = room.players.filter(p => p.rgAlive).length;
            document.getElementById('rg-lives').innerText = `${aliveCount}/${room.players.length}`;
            document.getElementById('rg-timer').innerText = rg.timeLeft;
            document.getElementById('rg-found-count').innerText = rg.found.length;

            const chips = document.getElementById('rg-found-chips');
            chips.innerHTML = "";
            rg.found.forEach(name => {
                chips.innerHTML += `<span class="rg-chip">${name}</span>`;
            });

            const currentPlayer = room.players[rg.turnIndex];

            const list = document.getElementById('rg-players-list');
            list.innerHTML = "";
            room.players.forEach((p, idx) => {
                const lives = typeof p.rgLives === 'number' ? p.rgLives : 2;
                const hearts = p.rgAlive === false
                    ? '💀 Éliminé'
                    : '❤️'.repeat(Math.max(lives, 0)) + '🖤'.repeat(Math.max(2 - lives, 0));
                let status = p.rgAlive === false ? "" : (idx === rg.turnIndex ? "✏️ En train de chercher…" : "En attente");
                list.innerHTML += `<li><span>${p.name}${p.id === socket.id ? ' (Toi)' : ''}</span> <span style="color:var(--text-muted)">${hearts}${status ? ' · ' + status : ''}</span></li>`;
            });

            document.getElementById('rg-end-buttons').style.display = 'none';
            rgMonTour = !!(currentPlayer && currentPlayer.rgAlive !== false && currentPlayer.id === socket.id);
            if (currentPlayer && currentPlayer.rgAlive !== false) {
                document.getElementById('rg-turn-info').innerText = `Au tour de : ${currentPlayer.name}`;
                if (currentPlayer.id === socket.id) {
                    document.getElementById('rg-input-container').style.display = 'flex';
                    setTimeout(() => document.getElementById('rg-answer-input').focus(), 30);
                } else {
                    document.getElementById('rg-input-container').style.display = 'none';
                }
            }
        }

        /* ---------------- Enchère (mode indépendant) ---------------- */

        function enchereBid(amount) {
            socket.emit('enchere_bid', { roomCode: currentRoomCode, amount });
        }

        function enchereLaisser() {
            socket.emit('enchere_pass', { roomCode: currentRoomCode });
        }

        socket.on('enchere_error', (data) => {
            alert(data.message);
        });

        socket.on('game_error', (data) => {
            alert(data.message);
        });

        socket.on('enchere_state', (room) => {
            hideAllPanels();
            document.getElementById('enchere-room').style.display = 'block';
            renderEnchereState(room);
        });

        socket.on('enchere_game_over', (data) => {
            renderEnchereState(data.room);
            document.getElementById('enchere-bid-buttons').style.display = 'none';
            document.getElementById('enchere-pass-btn').style.display = 'none';
            document.getElementById('enchere-turn-info').innerText = data.message;
            document.getElementById('enchere-end-buttons').style.display = 'flex';
        });

        function renderEnchereState(room) {
            const e = room.enchere;
            if (!e) return;

            const me = room.players.find(p => p.id === socket.id);
            const opp = room.players.find(p => p.id !== socket.id);

            document.getElementById('enchere-opp-name').innerText = opp ? opp.name.toUpperCase() : 'ADVERSAIRE';
            document.getElementById('enchere-universe-label').innerText = 'Univers : ' + (e.universeName || '---');
            document.getElementById('enchere-my-budget').innerText = (e.budgets[socket.id] ?? 50) + 'M';
            document.getElementById('enchere-opp-budget').innerText = (opp ? (e.budgets[opp.id] ?? 50) : 50) + 'M';

            if (e.currentCharacter) {
                document.getElementById('enchere-char-name').innerText = e.currentCharacter.name;
                document.getElementById('enchere-char-value').innerText = `Valeur : ${e.currentCharacter.value} pts`;
                setFandomImage('enchere-char-image', 'enchere-char-image-source', e.universeName, e.currentCharacter.name, true);
            } else {
                document.getElementById('enchere-char-name').innerText = '---';
                document.getElementById('enchere-char-value').innerText = '';
                clearFandomImage('enchere-char-image', 'enchere-char-image-source');
            }

            document.getElementById('enchere-current-bid').innerText = e.currentBid + 'M';
            const holder = room.players.find(p => p.id === e.currentBidderId);
            document.getElementById('enchere-bid-holder').innerText = holder
                ? `Enchère de : ${holder.name}${holder.id === socket.id ? ' (toi)' : ''}`
                : 'Aucune enchère pour le moment';

            const myTeamDiv = document.getElementById('enchere-my-team');
            myTeamDiv.innerHTML = '';
            (e.teams[socket.id] || []).forEach(c => {
                myTeamDiv.innerHTML += `<span class="rg-chip">${c.name} (${c.value})</span>`;
            });

            const oppTeamDiv = document.getElementById('enchere-opp-team');
            oppTeamDiv.innerHTML = '';
            if (opp) {
                (e.teams[opp.id] || []).forEach(c => {
                    oppTeamDiv.innerHTML += `<span class="rg-chip">${c.name} (${c.value})</span>`;
                });
            }

            document.getElementById('enchere-end-buttons').style.display = 'none';

            const isMyTurn = e.turnPlayerId === socket.id;
            if (isMyTurn) {
                document.getElementById('enchere-turn-info').innerText = "À toi de jouer !";
                document.getElementById('enchere-bid-buttons').style.display = 'flex';
                document.getElementById('enchere-pass-btn').style.display = 'block';
                const myBudget = e.budgets[socket.id] ?? 0;
                [1, 3, 5, 10].forEach(amount => {
                    const btn = document.getElementById('enchere-bid-' + amount);
                    if (btn) btn.disabled = (e.currentBid + amount) > myBudget;
                });
            } else {
                document.getElementById('enchere-turn-info').innerText = opp ? `En attente de ${opp.name}…` : 'En attente…';
                document.getElementById('enchere-bid-buttons').style.display = 'none';
                document.getElementById('enchere-pass-btn').style.display = 'none';
            }
        }

        /* ---------------- Enchère à l'aveugle (mode indépendant) ---------------- */

        function enchereAveugleBid(amount) {
            socket.emit('enchereaveugle_bid', { roomCode: currentRoomCode, amount });
        }

        function enchereAveugleLaisser() {
            socket.emit('enchereaveugle_pass', { roomCode: currentRoomCode });
        }

        socket.on('enchereaveugle_state', (room) => {
            hideAllPanels();
            document.getElementById('enchereaveugle-room').style.display = 'block';
            renderEnchereAveugleState(room);
        });

        socket.on('enchereaveugle_game_over', (data) => {
            renderEnchereAveugleState(data.room);
            document.getElementById('ea-bid-buttons').style.display = 'none';
            document.getElementById('ea-pass-btn').style.display = 'none';
            document.getElementById('ea-turn-info').innerText = data.message;
            document.getElementById('ea-end-buttons').style.display = 'flex';
        });

        function renderEnchereAveugleState(room) {
            const ea = room.enchereAveugle;
            if (!ea) return;

            const opp = room.players.find(p => p.id !== socket.id);

            document.getElementById('ea-universe-label').innerText = 'Univers : ' + (ea.universeName || '---');
            document.getElementById('ea-opp-name').innerText = opp ? opp.name.toUpperCase() : 'ADVERSAIRE';
            document.getElementById('ea-my-budget').innerText = (ea.budgets[socket.id] ?? 50) + 'M';
            document.getElementById('ea-opp-budget').innerText = (opp ? (ea.budgets[opp.id] ?? 50) : 50) + 'M';

            const isSeer = ea.seerId === socket.id;

            if (ea.currentCharacter) {
                if (isSeer) {
                    document.getElementById('ea-char-name').innerText = ea.currentCharacter.name;
                    document.getElementById('ea-char-value').innerText = `Valeur : ${ea.currentCharacter.value} pts`;
                    document.getElementById('ea-vision-label').innerText = "👁️ Tu vois ce perso, l'adversaire mise à l'aveugle !";
                    setFandomImage('ea-char-image', 'ea-char-image-source', ea.universeName, ea.currentCharacter.name, true);
                } else {
                    document.getElementById('ea-char-name').innerText = '??? Mystère';
                    document.getElementById('ea-char-value').innerText = 'Tu ne sais pas qui c\'est';
                    document.getElementById('ea-vision-label').innerText = "🙈 Tu enchéris à l'aveugle sur ce perso.";
                    clearFandomImage('ea-char-image', 'ea-char-image-source');
                }
            } else {
                document.getElementById('ea-char-name').innerText = '---';
                document.getElementById('ea-char-value').innerText = '';
                document.getElementById('ea-vision-label').innerText = '';
                clearFandomImage('ea-char-image', 'ea-char-image-source');
            }

            document.getElementById('ea-current-bid').innerText = ea.currentBid + 'M';
            const holder = room.players.find(p => p.id === ea.currentBidderId);
            document.getElementById('ea-bid-holder').innerText = holder
                ? `Enchère de : ${holder.name}${holder.id === socket.id ? ' (toi)' : ''}`
                : 'Aucune enchère pour le moment';

            const myTeamDiv = document.getElementById('ea-my-team');
            myTeamDiv.innerHTML = '';
            (ea.teams[socket.id] || []).forEach(c => {
                myTeamDiv.innerHTML += `<span class="rg-chip">${c.name} (${c.value})</span>`;
            });

            const oppTeamDiv = document.getElementById('ea-opp-team');
            oppTeamDiv.innerHTML = '';
            if (opp) {
                (ea.teams[opp.id] || []).forEach(c => {
                    oppTeamDiv.innerHTML += `<span class="rg-chip">${c.name} (${c.value})</span>`;
                });
            }

            document.getElementById('ea-end-buttons').style.display = 'none';

            const isMyTurn = ea.turnPlayerId === socket.id;
            if (isMyTurn) {
                document.getElementById('ea-turn-info').innerText = "À toi de jouer !";
                document.getElementById('ea-bid-buttons').style.display = 'flex';
                const myBudget = ea.budgets[socket.id] ?? 0;
                [1, 3, 5, 10].forEach(amount => {
                    const btn = document.getElementById('ea-bid-' + amount);
                    if (btn) btn.disabled = (ea.currentBid + amount) > myBudget;
                });
                // Minimum 1 mise avant de pouvoir laisser
                document.getElementById('ea-pass-btn').style.display = ea.currentBid > 0 ? 'block' : 'none';
            } else {
                document.getElementById('ea-turn-info').innerText = opp ? `En attente de ${opp.name}…` : 'En attente…';
                document.getElementById('ea-bid-buttons').style.display = 'none';
                document.getElementById('ea-pass-btn').style.display = 'none';
            }
        }

        /* ---------------- Jeu de connexion (mode indépendant) ---------------- */

        function submitConnexionWord() {
            const input = document.getElementById('cx-word-input');
            const word = input.value.trim();
            if (!word) return;
            socket.emit('connexion_submit_word', { roomCode: currentRoomCode, word });
            input.value = '';
        }

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && document.activeElement && document.activeElement.id === 'cx-word-input') {
                submitConnexionWord();
            }
        });

        socket.on('connexion_state', (room) => {
            hideAllPanels();
            document.getElementById('connexion-room').style.display = 'block';
            renderConnexionState(room);
        });

        socket.on('connexion_game_over', (data) => {
            renderConnexionState(data.room);
            document.getElementById('cx-input-container').style.display = 'none';
            document.getElementById('cx-info').innerText = data.message;
            document.getElementById('cx-info').style.color = '#00ff88';
            document.getElementById('cx-end-buttons').style.display = 'flex';
        });

        function renderConnexionState(room) {
            const c = room.connexion;
            if (!c) return;

            document.getElementById('cx-round').innerText = c.round;
            document.getElementById('cx-progress').innerText = `${c.submittedCount} / ${c.totalPlayers} ont écrit`;

            const hasSubmitted = !!c.myWord;
            const infoEl = document.getElementById('cx-info');

            if (hasSubmitted) {
                document.getElementById('cx-input-container').style.display = 'none';
                document.getElementById('cx-my-word').style.display = 'block';
                document.getElementById('cx-my-word-value').innerText = c.myWord;
                infoEl.innerText = "En attente des autres joueurs…";
                infoEl.style.color = 'var(--text-muted)';
            } else {
                document.getElementById('cx-input-container').style.display = 'flex';
                document.getElementById('cx-my-word').style.display = 'none';
                infoEl.innerText = c.round === 1 ? "Écris un mot, n'importe lequel !" : "Écris un nouveau mot pour vous rapprocher !";
                infoEl.style.color = 'var(--accent-cyan)';
            }

            const list = document.getElementById('cx-players-list');
            list.innerHTML = '';
            room.players.forEach(p => {
                const status = p.hasSubmitted ? '<span style="color:#00ff88">✓ A écrit</span>' : '<span style="color:var(--text-muted)">✏️ Réfléchit…</span>';
                list.innerHTML += `<li><span>${p.name}${p.id === socket.id ? ' (Toi)' : ''}</span> ${status}</li>`;
            });

            const histDiv = document.getElementById('cx-history');
            histDiv.innerHTML = '';
            (c.history || []).forEach(h => {
                const words = h.entries.map(e => `<span class="rg-chip">${e.name} : ${e.word}</span>`).join(' ');
                const border = h.matched ? '#00ff88' : '#2a2a40';
                histDiv.innerHTML += `
                    <div style="background:#11111a; border-left:4px solid ${border}; border-radius:6px; padding:10px; margin-bottom:8px; text-align:left;">
                        <div style="font-size:0.7rem; color:var(--text-muted); margin-bottom:6px;">TOUR ${h.round}${h.matched ? ' — ✅ CONNEXION !' : ''}</div>
                        <div class="rg-chips" style="margin-bottom:0;">${words}</div>
                    </div>`;
            });

            document.getElementById('cx-end-buttons').style.display = 'none';
        }

        /* ---------------- Chat de salon (social uniquement) ---------------- */

        function sendChatMessage() {
            const input = document.getElementById('chat-input');
            const message = input.value.trim();
            if (!message) return;
            socket.emit('chat_message', { roomCode: currentRoomCode, message });
            input.value = '';
        }

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && document.activeElement && document.activeElement.id === 'chat-input') {
                sendChatMessage();
            }
        });


        /* ================= AnimeDLE V2 client ================= */
        let dleCandidates=[];
        function dleEsc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
        let dleGuessedNames=new Set();
        let dleSuggestIndex=0;
        function dleNorm(x){return String(x||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();}
        function dleSuggestionList(){
            const input=document.getElementById('dle-input');
            const q=dleNorm(input?.value);
            if(!q)return [];
            // On retire les persos déjà proposés, et on met en premier ceux qui commencent par la saisie
            const pool=dleCandidates.filter(c=>!dleGuessedNames.has(dleNorm(c.label)));
            const starts=[],words=[],inside=[];
            pool.forEach(c=>{
                const n=dleNorm(c.label);
                if(n.startsWith(q))starts.push(c);
                else if(n.split(' ').some(w=>w.startsWith(q)))words.push(c);
                else if(n.includes(q))inside.push(c);
            });
            return [...starts,...words,...inside].slice(0,8);
        }
        function renderDleSuggestions(){
            const input=document.getElementById('dle-input'),box=document.getElementById('dle-suggestions');
            if(!input||!box)return;
            const found=dleSuggestionList();
            if(!found.length){box.style.display='none';box.innerHTML='';return;}
            if(dleSuggestIndex>=found.length)dleSuggestIndex=0;
            box.innerHTML=found.map((c,i)=>`<div class="dle-suggestion${i===dleSuggestIndex?' active':''}" data-value="${dleEsc(c.label)}">${dleEsc(c.label)}</div>`).join('');
            box.querySelectorAll('.dle-suggestion').forEach(el=>el.onclick=()=>{input.value=el.dataset.value;box.style.display='none';submitDleGuess();});
            box.style.display='block';
        }
        function dleKeydown(e){
            const box=document.getElementById('dle-suggestions');
            const visible=box&&box.style.display!=='none'&&box.children.length;
            if(e.key==='ArrowDown'&&visible){e.preventDefault();dleSuggestIndex=(dleSuggestIndex+1)%box.children.length;renderDleSuggestions();return;}
            if(e.key==='ArrowUp'&&visible){e.preventDefault();dleSuggestIndex=(dleSuggestIndex-1+box.children.length)%box.children.length;renderDleSuggestions();return;}
            if(e.key==='Enter'||e.keyCode===13){
                e.preventDefault();
                submitDleGuess();
            }
        }
        // Saisie incomplète -> on prend la suggestion surlignée (la 1re par défaut)
        function dleResolveInput(){
            const input=document.getElementById('dle-input');
            const typed=(input?.value||'').trim();
            if(!typed)return '';
            const list=dleSuggestionList();
            if(!list.length)return typed;
            const exact=list.find(c=>dleNorm(c.label)===dleNorm(typed));
            return (exact||list[dleSuggestIndex]||list[0]).label;
        }
        function submitDleGuess(){
            const input=document.getElementById('dle-input');
            const box=document.getElementById('dle-suggestions');
            const guess=dleResolveInput();
            if(!guess||!currentRoomCode)return;
            input.value=''; dleSuggestIndex=0; box.style.display='none'; box.innerHTML='';
            if(dleGuessedNames.has(dleNorm(guess)))return;
            dleGuessedNames.add(dleNorm(guess)); // retiré tout de suite des suggestions
            socket.emit('dle_guess',{roomCode:currentRoomCode,guess});
        }
        let dleTurnState=null,dleTurnClock=0,dleTurnInterval=null;
        function dleRenderTurn(room){
            const d=room.dle, box=document.getElementById('dle-turn'), input=document.getElementById('dle-input');
            const multi=(room.players||[]).length>1;
            dleTurnState=(!d.finished&&multi&&d.turnId)?d:null;
            if(d.serverNow) dleTurnClock=d.serverNow-Date.now();
            const myTurn=!dleTurnState||d.turnId===socket.id;
            if(input){ input.disabled=!myTurn; input.placeholder=myTurn?'Tape un personnage…':`Au tour de ${d.turnName||'un autre joueur'}…`; }
            if(!dleTurnState){ box.style.display='none'; if(dleTurnInterval){clearInterval(dleTurnInterval);dleTurnInterval=null;} return; }
            box.style.display='block';
            box.className='dle-turn'+(myTurn?' mine':'');
            const tick=()=>{
                if(!dleTurnState){return;}
                const left=Math.max(0,Math.ceil((dleTurnState.turnEndsAt-(Date.now()+dleTurnClock))/1000));
                box.textContent=(dleTurnState.turnId===socket.id?'🎯 À toi de jouer !':`⏳ Au tour de ${dleTurnState.turnName}`)+` — ${left}s`;
            };
            tick();
            if(!dleTurnInterval) dleTurnInterval=setInterval(tick,250);
            if(myTurn&&input&&window.innerWidth>700) setTimeout(()=>input.focus(),30);
        }
        function renderDleState(room){
            if(!room?.dle)return;
            const d=room.dle;
            dleCandidates=d.candidates||[];
            dleGuessedNames=new Set((d.guesses||[]).map(g=>dleNorm(g.name)));

            document.getElementById('dle-universe-label').innerHTML =
                `🎴 ${dleEsc(d.universeName)} <span class="dle-pool-badge">${d.poolSize || dleCandidates.length} persos</span>`;

            const status=document.getElementById('dle-status'),
                  winner=document.getElementById('dle-winner-box'),
                  inputWrap=document.getElementById('dle-input-wrap'),
                  end=document.getElementById('dle-end-buttons');

            if(d.finished){
                status.innerText=`Personnage : ${d.targetName}`;
                winner.style.display='block';
                winner.innerHTML=`🏆 ${dleEsc(d.winnerName)} a trouvé ${dleEsc(d.targetName)} en ${d.winnerAttempts} essai${d.winnerAttempts>1?'s':''} !<br><img id="dle-target-image" class="character-fandom-image small" alt="Image du personnage">`;
                const targetImg=(dleCandidates.find(c=>c.label===d.targetName)||{}).image;
                (targetImg?Promise.resolve({imageUrl:targetImg}):getFandomCharacterImage(d.universeName, d.targetName)).then(data=>{
                    const img=document.getElementById('dle-target-image');
                    if(img&&data?.imageUrl){img.src=data.imageUrl;img.style.display='block';}
                });
                inputWrap.style.display='none';
                end.style.display=room.host===socket.id?'flex':'none';
            }else{
                status.innerText=`Trouve le personnage mystère • ${d.guesses.length} essai${d.guesses.length>1?'s':''}`;
                winner.style.display='none';
                inputWrap.style.display='block';
                end.style.display='none';
            }
            dleRenderTurn(room);

            const grid=document.getElementById('dle-grid'),cats=d.categories||[];
            grid.style.gridTemplateColumns=`1.45fr repeat(${cats.length}, minmax(112px,1fr))`;
            grid.innerHTML=`<div class="dle-head">Personnage</div>`+
                cats.map(c=>`<div class="dle-head">${dleEsc(c.label)}</div>`).join('');

            [...d.guesses].reverse().forEach(g=>{
                const first=document.createElement('div');
                first.className=`dle-cell ${g.correct?'good':'bad'}`;
                first.classList.add('dle-character-cell');
                const img=document.createElement('img');
                img.className='dle-character-thumb';
                img.alt=`Image de ${g.name}`;
                first.appendChild(img);

                const charName=document.createElement('div');
                charName.className='dle-character-name';
                charName.textContent=g.name;
                first.appendChild(charName);

                const playerName=document.createElement('div');
                playerName.className='dle-player-name';
                playerName.textContent=g.playerName;
                first.appendChild(playerName);
                grid.appendChild(first);

                const directImg=(dleCandidates.find(c=>c.label===g.name)||{}).image;
                (directImg?Promise.resolve({imageUrl:directImg}):getFandomCharacterImage(d.universeName, g.name)).then(data=>{
                    if(data?.imageUrl){
                        img.src=data.imageUrl;
                        img.style.display='block';
                        img.onerror=()=>{img.style.display='none';};
                    }
                });

                cats.forEach(cat=>{
                    const a=g.attrs?.[cat.key]||{value:'DONNÉE INVALIDE',known:false,match:false,close:false,direction:null};
                    const el=document.createElement('div');
                    el.className=`dle-cell ${!a.known?'bad':a.match?'good':a.close?'close':'bad'}`;
                    const arrow=a.direction==='up'?' ↑':a.direction==='down'?' ↓':'';
                    el.textContent=`${a.value}${arrow}`;
                    grid.appendChild(el);
                });
            });

            setTimeout(()=>document.getElementById('dle-input')?.focus(),30);
        }


        socket.on('quote_state', q => {
            hideAllPanels();
            const wait = document.getElementById('waiting-room');
            if (wait) wait.style.display = 'none';
            const panel = document.getElementById('quote-room');
            if (panel) panel.style.display = 'block';
            renderQuoteState(q);
        });


        /* ================= Blind Test Anime ================= */
        const btAudio = new Audio();
        btAudio.preload = 'auto';
        let btVolume = 0.6;
        try { const v = Number(localStorage.getItem('bt_volume')); if (Number.isFinite(v) && localStorage.getItem('bt_volume') !== null) btVolume = Math.max(0, Math.min(1, v)); } catch (_) {}
        let btState = null;
        let btLoadedKey = null;   // manche actuellement chargée
        let btMyChoice = null;
        let btTimerInterval = null;
        let btClockOffset = 0;    // serveur - client
        let btBgWasPlaying = false;

        function btSetVolume(v) {
            btVolume = Math.max(0, Math.min(1, Number(v) || 0));
            btAudio.volume = btVolume;
            try { if (btYt && btYtKey) btYt.setVolume(Math.round(btVolume * 100)); } catch (_) {}
            try { localStorage.setItem('bt_volume', String(btVolume)); } catch (_) {}
        }

        function btPauseBackground() {
            window.__btActive = true;
            if (!musicPaused()) {
                btBgWasPlaying = true;
                backgroundMusic.pause();
                musicYtPause();
            }
        }

        function btStopAudio() {
            if (typeof btClearVideo === 'function') btClearVideo();
            if (typeof btYtStop === 'function') btYtStop();
            btAudio.pause();
            btAudio.removeAttribute('src');
            btAudio.load();
            btLoadedKey = null;
            if (btTimerInterval) { clearInterval(btTimerInterval); btTimerInterval = null; }
            if (btFadeTimer) { clearInterval(btFadeTimer); btFadeTimer = null; }
            const wasActive = window.__btActive;
            window.__btActive = false;
            if ((btBgWasPlaying || window.__btBgBlocked) && wasActive && musicEnabled) {
                btBgWasPlaying = false;
                window.__btBgBlocked = false;
                if (musicStarted) musicResume();
                else startBackgroundMusicIfAllowed();
            }
        }

        async function btForcePlay() {
            if (btYtKey && btYt) { try { btYt.unMute(); btYt.setVolume(Math.round(btVolume * 100)); btYt.playVideo(); } catch (_) {} return; }
            try { await btAudio.play(); document.getElementById('bt-play-btn').style.display = 'none'; } catch (_) {}
        }

        let btFadeTimer = null;
        function btFadeIn() {
            if (btFadeTimer) clearInterval(btFadeTimer);
            btAudio.volume = 0;
            let step = 0;
            btFadeTimer = setInterval(() => {
                step++;
                btAudio.volume = Math.min(btVolume, btVolume * step / 10);
                if (step >= 10) { clearInterval(btFadeTimer); btFadeTimer = null; }
            }, 60);
        }

        function btLoadRound(q) {
            const key = `${q.round}|${q.key || q.src}`;
            if (btLoadedKey === key) return;
            btLoadedKey = key;
            btMyChoice = null;
            btPauseBackground();
            btAudio.pause();
            if (q.ytId && !q.src) { btYtLoad(q, key); return; }
            btYtStop();
            btAudio.src = q.src;
            btAudio.volume = btVolume;
            const elapsed = Math.max(0, (Date.now() + btClockOffset) - (q.endsAt - q.roundMs)) / 1000;
            const seek = () => {
                if (btLoadedKey !== key) return; // une autre manche a démarré entre-temps
                let start = q.offset + elapsed;
                const d = btAudio.duration;
                if (Number.isFinite(d) && d > 0 && start > d - 3) start = Math.max(0, d * 0.25);
                try { btAudio.currentTime = start; } catch (_) {}
                btFadeIn();
                btAudio.play().then(()=>{
                    document.getElementById('bt-play-btn').style.display = 'none';
                }).catch(()=>{
                    document.getElementById('bt-play-btn').style.display = 'inline-block';
                });
            };
            if (btAudio.readyState >= 1) seek();
            else btAudio.addEventListener('loadedmetadata', seek, { once:true });
        }

        /* ---- Lecteur YouTube caché (openings sans fichier mp3) ---- */
        let __ytApiPromise = null;
        function ytApi() {
            if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
            if (__ytApiPromise) return __ytApiPromise;
            __ytApiPromise = new Promise(resolve => {
                const prev = window.onYouTubeIframeAPIReady;
                window.onYouTubeIframeAPIReady = () => { try { prev && prev(); } catch (_) {} resolve(window.YT); };
                const sc = document.createElement('script');
                sc.src = 'https://www.youtube.com/iframe_api';
                document.head.appendChild(sc);
            });
            return __ytApiPromise;
        }
        let btYt = null, btYtKey = null, btYtFade = null, btYtReady = null;
        function btYtShow(on) {
            const box = document.getElementById('bt-yt-box'), disc = document.getElementById('bt-disc');
            if (box) box.style.display = on ? 'block' : 'none';
            if (disc) disc.style.display = on ? 'none' : '';
        }
        function btYtHint(text, tap) {
            const h = document.getElementById('bt-yt-hint'), box = document.getElementById('bt-yt-box');
            if (h) h.textContent = text;
            if (box) box.classList.toggle('tap', !!tap);
        }
        function btYtStop() {
            btYtKey = null;
            if (btYtFade) { clearInterval(btYtFade); btYtFade = null; }
            try { if (btYt && btYt.stopVideo) btYt.stopVideo(); } catch (_) {}
            btYtShow(false);
        }
        function btYtFadeIn() {
            if (!btYt) return;
            if (btYtFade) clearInterval(btYtFade);
            let step = 0;
            try { btYt.unMute(); btYt.setVolume(0); } catch (_) {}
            btYtFade = setInterval(() => {
                step++;
                try { btYt.setVolume(Math.round(btVolume * 100 * Math.min(1, step / 10))); } catch (_) {}
                if (step >= 10) { clearInterval(btYtFade); btYtFade = null; }
            }, 60);
        }
        // Lecteur YouTube visible mais flouté : sur téléphone, le son ne peut démarrer qu'après un toucher
        // DANS le lecteur. Le voile laisse passer le toucher, sans montrer l'image (qui donnerait la réponse).
        async function btYtLoad(q, key) {
            btYtShow(true);
            btYtHint('⏳ Chargement de la musique…', false);
            const YT = await ytApi();
            if (btLoadedKey !== key) return;
            btYtKey = key;
            let seeked = false;
            const handlers = {
                state: e => {
                    if (btYtKey !== key || e.data !== YT.PlayerState.PLAYING) return;
                    btYtHint('🎵 Écoute bien…', false);
                    document.getElementById('bt-play-btn').style.display = 'none';
                    if (seeked) return;
                    seeked = true;
                    const dur = btYt.getDuration() || 90;
                    const elapsed = Math.max(0, (Date.now() + btClockOffset) - (q.endsAt - q.roundMs)) / 1000;
                    let start = dur * (q.offsetFrac || 0.3) + elapsed;
                    if (start > dur - 4) start = dur * 0.3;
                    btYt.seekTo(start, true);
                    btYtFadeIn();
                },
                error: () => { if (btYtKey === key) socket.emit('bt_media_error', { roomCode: currentRoomCode, round: q.round }); }
            };
            if (!btYt) {
                btYtReady = new Promise(res => {
                    btYt = new YT.Player('bt-yt-player', {
                        width: '100%', height: '100%', videoId: q.ytId,
                        playerVars: { autoplay: 1, controls: 0, playsinline: 1, rel: 0, disablekb: 1, fs: 0, iv_load_policy: 3 },
                        events: {
                            onReady: e => { try { e.target.setVolume(Math.round(btVolume * 100)); e.target.playVideo(); } catch (_) {} res(); },
                            onStateChange: e => btYt.__h && btYt.__h.state(e),
                            onError: e => btYt.__h && btYt.__h.error(e)
                        }
                    });
                });
                btYt.__h = handlers;
            } else {
                btYt.__h = handlers;
                await btYtReady;
                if (btLoadedKey !== key) return;
                try { btYt.loadVideoById(q.ytId); btYt.playVideo(); } catch (_) {}
            }
            // Lecture automatique bloquée (téléphone) : on demande un toucher sur le lecteur
            setTimeout(() => {
                if (btYtKey === key && !seeked) {
                    btYtHint('👆 Touche ici pour lancer la musique', true);
                    document.getElementById('bt-play-btn').style.display = 'inline-block';
                }
            }, 1800);
        }

        // iPhone / Android : on "débloque" le lecteur audio dès le premier toucher sur la page
        (function unlockBtAudioOnce() {
            const SILENT = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
            const unlock = () => {
                document.removeEventListener('touchend', unlock, true);
                document.removeEventListener('click', unlock, true);
                try { ytApi(); } catch (_) {} // précharge le lecteur YouTube
                if (btAudio.src && !btAudio.paused) return;
                try {
                    btAudio.muted = true;
                    btAudio.src = SILENT;
                    const p = btAudio.play();
                    const done = () => { btAudio.pause(); btAudio.muted = false; if (btAudio.src === SILENT) btAudio.removeAttribute('src'); };
                    if (p && p.then) p.then(done).catch(() => { btAudio.muted = false; }); else done();
                } catch (_) { btAudio.muted = false; }
            };
            document.addEventListener('touchend', unlock, true);
            document.addEventListener('click', unlock, true);
        })();

        function btTick() {
            const q = btState;
            const fill = document.getElementById('bt-timer-fill');
            const label = document.getElementById('bt-time');
            if (q && q.phase === 'reveal' && q.revealEndsAt) {
                const left = Math.max(0, q.revealEndsAt - (Date.now() + btClockOffset));
                if (fill) fill.style.width = `${(left / q.revealMs) * 100}%`;
                if (label) label.textContent = `Suite dans ${Math.ceil(left / 1000)}s`;
                return;
            }
            if (!q || q.phase !== 'playing') {
                if (fill) fill.style.width = '0%';
                if (label) label.textContent = q?.phase === 'finished' ? 'Terminé' : 'Réponse !';
                return;
            }
            const left = Math.max(0, q.endsAt - (Date.now() + btClockOffset));
            if (fill) fill.style.width = `${(left / q.roundMs) * 100}%`;
            if (label) label.textContent = `${Math.ceil(left / 1000)}s`;
        }

        let btVideoKey = null;

        function btClearVideo() {
            btVideoKey = null;
            const box = document.getElementById('bt-video');
            const frame = document.getElementById('bt-video-frame');
            if (frame) frame.innerHTML = '';
            if (box) box.style.display = 'none';
        }

        function btShowVideo(q) {
            const box = document.getElementById('bt-video');
            const frame = document.getElementById('bt-video-frame');
            const link = document.getElementById('bt-video-link');
            box.style.display = 'block';
            link.href = q.videoId
                ? `https://www.youtube.com/watch?v=${q.videoId}`
                : `https://www.youtube.com/results?search_query=${encodeURIComponent(q.videoSearch || q.answer || '')}`;
            document.getElementById('bt-skip-btn').style.display = q.hostId === socket.id ? 'inline-block' : 'none';

            const key = `${q.round}|${q.videoId || ''}`;
            if (btVideoKey === key) return;
            btVideoKey = key;

            if (q.videoId) {
                // La vidéo prend le relais de l'extrait audio
                btAudio.pause();
                btYtStop();
                document.getElementById('bt-play-btn').style.display = 'none';
                const f = document.createElement('iframe');
                f.src = `https://www.youtube-nocookie.com/embed/${q.videoId}?autoplay=1&rel=0&playsinline=1`;
                f.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
                f.allowFullscreen = true;
                f.title = 'Opening';
                frame.innerHTML = '';
                frame.appendChild(f);
                frame.style.display = 'block';
            } else {
                frame.innerHTML = '';
                frame.style.display = 'none';
            }
        }

        function btSkip() {
            socket.emit('bt_skip', { roomCode:currentRoomCode });
        }

        function btAnswer(choice) {
            if (!btState || btState.phase !== 'playing' || btMyChoice) return;
            btMyChoice = choice;
            socket.emit('bt_answer', { roomCode:currentRoomCode, choice });
            renderBlindTest(btState);
        }

        function renderBlindTest(q) {
            if (!q) return;
            btState = q;
            btClockOffset = q.serverNow - Date.now();

            // Nouvelle manche : on réinitialise le choix AVANT de dessiner les boutons
            // (sinon le choix de la manche précédente les laissait désactivés une manche sur deux)
            if (q.phase === 'playing' && btLoadedKey !== `${q.round}|${q.key || q.src}`) btMyChoice = null;

            document.getElementById('bt-round').textContent = `Manche ${q.round}/${q.totalRounds ?? '∞'}`;
            const btEnd = document.getElementById('bt-end-infinite');
            if (btEnd) btEnd.style.display = q.totalRounds == null && q.phase !== 'finished' && q.hostId === socket.id ? 'block' : 'none';
            const answeredCount = q.players.filter(p => p.answered).length;
            document.getElementById('bt-answered').textContent = `Réponses : ${answeredCount}/${q.players.length}`;

            const me = q.players.find(p => p.id === socket.id);
            if (me?.answered && q.phase === 'playing' && !btMyChoice) btMyChoice = '__answered__';
            if (q.phase !== 'playing' && me?.choice) btMyChoice = me.choice;

            // Tableau des scores
            const board = document.getElementById('bt-scoreboard');
            board.innerHTML = '';
            [...q.players].sort((a,b)=>b.score-a.score).forEach(p => {
                const row = document.createElement('div');
                row.className = 'quote-score';
                const name = document.createElement('span');
                let mark = '';
                if (q.phase === 'playing') mark = p.answered ? ' ✔️' : ' …';
                else if (q.phase === 'reveal') mark = p.correct ? ` ✅ +${p.gained}` : (p.answered ? ' ❌' : ' ⌛');
                name.textContent = p.name + mark;
                const score = document.createElement('strong');
                score.style.color = 'var(--accent-yellow)';
                score.textContent = `${p.score} pts`;
                row.append(name, score);
                board.appendChild(row);
            });

            // Propositions
            const box = document.getElementById('bt-choices');
            box.innerHTML = '';
            (q.choices || []).forEach(c => {
                const b = document.createElement('button');
                b.className = 'bt-choice';
                b.textContent = c;
                if (q.phase === 'playing') {
                    b.disabled = !!btMyChoice;
                    if (btMyChoice === c) b.classList.add('picked');
                    b.onclick = () => btAnswer(c);
                } else {
                    b.disabled = true;
                    if (c === q.answer) b.classList.add('good');
                    else if (btMyChoice === c) b.classList.add('bad');
                }
                box.appendChild(b);
            });

            const disc = document.getElementById('bt-disc');
            const result = document.getElementById('bt-result');
            const song = document.getElementById('bt-song');
            const endBtns = document.getElementById('bt-end-buttons');

            if (q.phase === 'playing') {
                disc.classList.add('spin');
                disc.textContent = '💿';
                song.textContent = '';
                endBtns.style.display = 'none';
                btClearVideo();
                if (btMyChoice) { result.style.color = 'var(--accent-cyan)'; result.textContent = 'Réponse envoyée, attends les autres…'; }
                else { result.style.color = 'var(--text-color)'; result.textContent = 'Écoute bien… de quel anime vient cette musique ?'; }
                btLoadRound(q);
            } else {
                disc.classList.remove('spin');
                if (q.phase === 'reveal') {
                    disc.textContent = me?.correct ? '🎉' : '🎵';
                    result.style.color = me?.correct ? '#00ff88' : 'var(--accent-pink)';
                    result.textContent = me?.correct ? `✅ Bien joué ! C'était ${q.answer} (+${me.gained})` : `❌ C'était ${q.answer}`;
                    song.textContent = `🎶 ${q.songTitle || ''}`;
                    endBtns.style.display = 'none';
                    btShowVideo(q);
                } else {
                    btStopAudio();
                    btClearVideo();
                    disc.textContent = '🏆';
                    const w = q.winnerNames || [];
                    result.style.color = 'var(--accent-yellow)';
                    result.textContent = w.length > 1 ? `Égalité : ${w.join(', ')} !` : `🏆 ${w[0] || '---'} remporte le Blind Test !`;
                    song.textContent = `Dernière musique : ${q.answer} — ${q.songTitle || ''}`;
                    endBtns.style.display = 'flex';
                }
            }

            if (q.phase !== 'finished' && !btTimerInterval) btTimerInterval = setInterval(btTick, 200);
            btTick();
            const replay = document.getElementById('bt-replay-btn');
            if (replay) replay.style.display = q.hostId === socket.id ? 'block' : 'none';
        }

        socket.on('bt_state', q => {
            if (!q) return;
            if (q.phase !== 'finished') btPauseBackground();
            hideAllPanels();
            const panel = document.getElementById('blindtest-room');
            if (panel) panel.style.display = 'block';
            renderBlindTest(q);
        });

        socket.on('quote_feedback', data => {
            const result = document.getElementById('quote-result');
            if (result) {
                result.style.color = 'var(--accent-pink)';
                result.textContent = data?.message || 'Action impossible.';
            }
        });

        socket.on('dle_state', room => {
            hideAllPanels();
            const waiting = document.getElementById('waiting-room');
            if (waiting) waiting.style.display = 'none';
            const dleRoom = document.getElementById('dle-room');
            if (dleRoom) dleRoom.style.display = 'block';
            renderDleState(room);
        });
        socket.on('dle_feedback',data=>{if(!data?.ok){const s=document.getElementById('dle-status');if(s){s.innerText=data?.message||'Personnage introuvable.';s.style.color='var(--accent-pink)';setTimeout(()=>s.style.color='var(--accent-cyan)',1200);}}});

        socket.on('chat_message', (data) => {
            const box = document.getElementById('chat-messages');
            const isMe = data.authorId === socket.id;

            const line = document.createElement('div');
            line.style.cssText = 'margin-bottom:6px; font-size:0.85rem; word-break:break-word;';

            const author = document.createElement('span');
            author.innerText = data.author + ' : ';
            author.style.cssText = `font-weight:700; color:${isMe ? 'var(--accent-cyan)' : 'var(--accent-pink)'};`;

            const text = document.createElement('span');
            text.innerText = data.message;
            text.style.color = 'var(--text-color)';

            line.appendChild(author);
            line.appendChild(text);
            box.appendChild(line);
            box.scrollTop = box.scrollHeight;
        });



        /* ===================== MINI-JEUX ARCADE ===================== */
        const ARC_UI = {
            pixel:{ title:'🖼️ PIXEL ANIME', sub:"L'image se précise avec le temps : trouve le perso le plus vite possible", universe:true },
            zoom:{ title:'🔍 ZOOM EXTRÊME', sub:"On part d'un détail (un œil, une arme…) et l'image dézoome : trouve le perso le plus vite possible", universe:true },
            silhouette:{ title:'👤 SILHOUETTE', sub:'Qui se cache derrière cette ombre ?', universe:true },
            emoji:{ title:'😀 EMOJI ANIME', sub:'Décode les emojis : anime ou personnage', universe:false },
            quatre:{ title:'🧩 4 IMAGES = 1 ANIME', sub:'Les images arrivent une par une : moins tu en vois, plus tu gagnes', universe:false },
            mapguess:{ title:'🗺️ MAP GUESS', sub:'De quel univers vient ce lieu ?', universe:false },
            fusion:{ title:'🧪 FUSION ANIME', sub:'4 persos sont mélangés dans cette image : retrouve-les tous', universe:true },
            link:{ title:'🔗 COMMON LINK', sub:'Quel est le point commun entre ces 4 personnages ? (6 choix, attention aux pièges)', universe:false },
            popularite:{ title:'👥 POPULARITY GUESS', sub:'Qui a le plus de fans ? (nombre de favoris sur MyAnimeList)', universe:true },
            bac:{ title:'🔤 PETIT BAC ANIME', sub:'Un mot par catégorie qui commence par la lettre. Réponse unique = 10 pts, partagée = 5 pts', universe:false },
            imposteur:{ title:'🕵️ IMPOSTEUR', sub:"3 persos viennent du même anime… lequel est l'intrus ?", universe:false },
            audio:{ title:'🎧 ÉCOUTE LA SCÈNE', sub:"Pas d'image, juste le son d'une scène culte : de quel anime vient-elle ?", universe:false },
            chrono:{ title:'⏱️ CHRONO-QUIZ', sub:'60 secondes pour enchaîner un max de bonnes réponses (bonus de série)', universe:false },
            couleur:{ title:'🎨 COLORIE LE PERSO', sub:'Retrouve la vraie couleur du perso : le moins proche perd un cœur, le dernier en vie gagne', universe:true },
            draft:{ title:'🃏 DRAFT 5V5', sub:'Chacun son tour, choisis tes persos… puis votez pour la meilleure équipe', universe:true },
            scene:{ title:"🎬 SCENE GUESSR", sub:"Une scène culte en vidéo (sans le son) : de quel anime vient-elle ?", universe:false }
        };
        ARC_UI.mix_dle = { title:'🎴 ANIMEDLE EXPRESS', sub:'Trois indices, quatre personnages : trouve le bon', universe:false };
        ARC_UI.mix_quote = { title:'💬 CITATIONS', sub:'Qui a prononcé cette citation ?', universe:false };
        ARC_UI.mix_blind = { title:'🎧 BLIND TEST', sub:'Écoute quelques secondes et retrouve l’anime', universe:false };
        ARC_UI.cardbattle = { title:'⚔️ COMBAT DE CARTES', sub:'Ton deck de 5 cartes • choix secret • rareté purement cosmétique', universe:false };
        ARC_UI.bingo = { title:'🎟️ BINGO ANIME', sub:'Grille 3×3 • univers au choix • +1 bonne catégorie • -1 erreur', universe:false };

        let arcState = null, arcClock = 0, arcNames = [], arcMyFound = [], arcTick = null, arcRaf = null;
        let arcCardDeck = [], arcCardUsed = new Set(), arcBingoBoard = null, arcBingoChar = null;
        let arcStageKey = '', arcImgs = {}, arcSuggIdx = 0, arcLastFeedback = null, arcYt = null;
        // Bouton « Activer le son » pour Écoute la scène (mobile : le son doit partir d'un vrai toucher)
        function arcAudioButton(box, player, key) {
            if (!box || box.querySelector('.arc-sound-btn')) return;
            const h = document.getElementById('arc-audio-hint'); if (h) h.textContent = '';
            const b = document.createElement('button'); b.type = 'button'; b.className = 'arc-sound-btn'; b.innerHTML = '🔊 Activer le son';
            const go = ev => {
                if (ev) { ev.preventDefault(); ev.stopPropagation(); }
                try { player.unMute(); player.setVolume(85); player.playVideo(); } catch (_) {}
                setTimeout(() => {
                    if (arcStageKey !== key) return;
                    let ok = false; try { ok = !player.isMuted() && player.getPlayerState() === 1; } catch (_) {}
                    b.remove();
                    const hint = document.getElementById('arc-audio-hint');
                    if (ok) { if (hint) hint.textContent = 'Écoute bien…'; box.classList.remove('audio-tap'); }
                    else { box.classList.add('audio-tap'); if (hint) hint.textContent = '👆 Touche encore l\'écran pour le son'; }
                }, 700);
            };
            b.addEventListener('click', go);
            box.appendChild(b);
        }
        function arcDestroyVideo() { if (arcYt) { try { arcYt.destroy(); } catch (_) {} arcYt = null; } }

        let bingoPendingDuration = '60';
        function openBingoSetup() {
            hubModal('bingo-setup-modal', `<h3 style="color:var(--accent-yellow);">🎟️ Bingo Anime</h3>
                <p class="tl-hint" style="text-align:left;">Choisis d'abord la durée, puis ton ou tes univers. Bonne catégorie = <b style="color:#00ff88">+1</b>, mauvaise catégorie = <b style="color:var(--accent-pink)">-1</b>. La grille est en <b>3×3</b> et chaque clic remplace la catégorie de la case.</p>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                    <button class="btn-action" style="background:#ffd93d;color:#111;margin:0;" onclick="startBingoMode('60')">⏱️ 60 secondes</button>
                    <button class="btn-action" style="background:var(--accent-cyan);color:#111;margin:0;" onclick="startBingoMode('inf')">♾️ Temps infini</button>
                </div>`, true);
        }
        function startBingoMode(mode) {
            document.getElementById('bingo-setup-modal')?.remove();
            bingoPendingDuration = mode === 'inf' ? 'inf' : '60';
            arcBingoBoard=null; arcBingoChar=null;
            openUniverseSelection('arc_bingo');
        }

        function openArcadeGame(game) {
            if (ARC_UI[game].universe) {
                openUniverseSelection('arc_' + game);
            } else {
                createRoom('arcade', game);
            }
        }

        const PARTY_MIX_OPTIONS = [
            ['mix_dle','🎴','AnimeDLE'],['mix_quote','💬','Citations'],['plusmoins','⚖️','Plus ou moins'],['mix_blind','🎧','Blind Test'],
            ['pixel','🖼️','Pixel Anime'],['silhouette','👤','Silhouette'],['emoji','😀','Emoji Anime'],['quatre','🧩','4 images = 1 anime'],
            ['attaque','💥','Devine l’attaque'],['scene','🎬','Scene Guessr'],['mapguess','🗺️','Map Guess'],['link','🔗','Common Link'],
            ['imposteur','🕵️','Imposteur'],['popularite','👥','Popularité']
        ];
        function openPartyMixSelection() {
            const defaults = new Set(['mix_dle','mix_quote','plusmoins','mix_blind','pixel']);
            hubModal('party-mix-modal', `<h3 style="color:var(--accent-yellow);">🎮 Créer un Party Mix</h3>
                <p class="tl-hint" style="text-align:left;">Choisis entre <b>3 et 8 épreuves</b>. Tout le monde joue jusqu’au bout et le score se cumule d’un jeu à l’autre.</p>
                <div class="pm-picker">${PARTY_MIX_OPTIONS.map(([id,em,n]) => `<label class="pm-pick"><input type="checkbox" data-pm="${id}" ${defaults.has(id)?'checked':''}> <span>${em} ${n}</span></label>`).join('')}</div>
                <label style="display:flex;align-items:center;gap:8px;margin:8px 0 14px;">Manches par épreuve : <select id="pm-rounds" style="background:#101019;color:#fff;border:1px solid #45455b;padding:7px;border-radius:7px;"><option value="1">1</option><option value="2" selected>2</option><option value="3">3</option></select></label>
                <button class="btn-action" onclick="startPartyMixSelection()">🎮 Créer le salon</button>`, true);
        }
        function startPartyMixSelection() {
            const m = document.getElementById('party-mix-modal');
            const games = [...m.querySelectorAll('input[data-pm]:checked')].map(x => x.dataset.pm).slice(0,8);
            if (games.length < 3) return toast('Choisis au moins 3 épreuves.', 'var(--accent-pink)');
            const per = Math.max(1, Math.min(3, +(document.getElementById('pm-rounds')?.value || 2)));
            m.remove(); createRoom('arcade', 'partymix:' + games.join(',') + '~' + per);
        }

        function arcNorm(s) {
            return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
        }

        function arcLoadImage(src) {
            if (arcImgs[src]) return arcImgs[src];
            const p = new Promise(resolve => {
                const img = new Image();
                img.onload = () => resolve(img);
                img.onerror = () => resolve(null);
                img.src = src;
            });
            arcImgs[src] = p;
            const keys = Object.keys(arcImgs);
            if (keys.length > 60) delete arcImgs[keys[0]];
            return p;
        }

        // Dessine l'image "contenue" dans le canvas à une résolution de n cases (pixelisation)
        function arcDrawPixel(canvas, img, cells) {
            const ctx = canvas.getContext('2d');
            const W = canvas.width, H = canvas.height;
            ctx.fillStyle = '#0b0b12'; ctx.fillRect(0, 0, W, H);
            const r = Math.min(W / img.width, H / img.height);
            const w = img.width * r, h = img.height * r, x = (W - w) / 2, y = (H - h) / 2;
            if (!cells) { ctx.imageSmoothingEnabled = true; ctx.drawImage(img, x, y, w, h); return; }
            const sw = Math.max(2, Math.round(cells * w / Math.max(w, h))), sh = Math.max(2, Math.round(cells * h / Math.max(w, h)));
            const tmp = arcDrawPixel.tmp || (arcDrawPixel.tmp = document.createElement('canvas'));
            tmp.width = sw; tmp.height = sh;
            const t = tmp.getContext('2d');
            t.imageSmoothingEnabled = true;
            t.clearRect(0, 0, sw, sh);
            t.drawImage(img, 0, 0, sw, sh);
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(tmp, 0, 0, sw, sh, x, y, w, h);
        }

        // Silhouette : fond transparent => ombre parfaite ; sinon on retire le fond par remplissage depuis les bords.
        function arcSilhouetteMask(img) {
            const max = 360;
            const r = Math.min(1, max / Math.max(img.width, img.height));
            const w = Math.max(1, Math.round(img.width * r)), h = Math.max(1, Math.round(img.height * r));
            const c = document.createElement('canvas'); c.width = w; c.height = h;
            const ctx = c.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);
            let data;
            try { data = ctx.getImageData(0, 0, w, h).data; } catch (e) { return null; }
            const N = w * h, mask = new Uint8Array(N);
            let transparent = 0;
            for (let i = 0; i < N; i++) if (data[i * 4 + 3] < 25) transparent++;
            if (transparent / N > 0.06) {
                for (let i = 0; i < N; i++) mask[i] = data[i * 4 + 3] >= 70 ? 1 : 0;
                return { w, h, mask, mode: 'alpha' };
            }
            // remplissage du fond depuis les bords (tolérance entre voisins + écart max à la couleur de départ)
            const bg = new Uint8Array(N), seed = new Int32Array(N);
            const stack = [];
            const push = (i, s) => { if (!bg[i]) { bg[i] = 1; seed[i] = s; stack.push(i); } };
            for (let x = 0; x < w; x++) { push(x, x); push((h - 1) * w + x, (h - 1) * w + x); }
            for (let y = 0; y < h; y++) { push(y * w, y * w); push(y * w + w - 1, y * w + w - 1); }
            const d = (a, b) => Math.abs(data[a * 4] - data[b * 4]) + Math.abs(data[a * 4 + 1] - data[b * 4 + 1]) + Math.abs(data[a * 4 + 2] - data[b * 4 + 2]);
            while (stack.length) {
                const i = stack.pop(), x = i % w, y = (i - x) / w, s = seed[i];
                const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
                for (const j of nb) {
                    if (j < 0 || bg[j]) continue;
                    if (d(i, j) < 34 && d(s, j) < 120) push(j, s);
                }
            }
            let fg = 0;
            for (let i = 0; i < N; i++) { mask[i] = bg[i] ? 0 : 1; fg += mask[i]; }
            const ratio = fg / N;
            if (ratio > 0.1 && ratio < 0.8) return { w, h, mask, mode: 'fill' };
            // Fond trop chargé : on garde les contours (plus dur, mais jamais l'image en clair)
            const gray = new Float32Array(N);
            for (let i = 0; i < N; i++) gray[i] = data[i * 4] * .3 + data[i * 4 + 1] * .59 + data[i * 4 + 2] * .11;
            for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
                const i = y * w + x;
                const gx = gray[i - w + 1] + 2 * gray[i + 1] + gray[i + w + 1] - gray[i - w - 1] - 2 * gray[i - 1] - gray[i + w - 1];
                const gy = gray[i + w - 1] + 2 * gray[i + w] + gray[i + w + 1] - gray[i - w - 1] - 2 * gray[i - w] - gray[i - w + 1];
                mask[i] = Math.hypot(gx, gy) > 130 ? 1 : 0;
            }
            return { w, h, mask, mode: 'edges' };
        }

        function arcDrawSilhouette(canvas, sil) {
            const ctx = canvas.getContext('2d');
            const W = canvas.width, H = canvas.height;
            const grad = ctx.createRadialGradient(W / 2, H / 2, 20, W / 2, H / 2, W * .7);
            grad.addColorStop(0, '#2a2a55'); grad.addColorStop(1, '#0b0b16');
            ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);
            const m = document.createElement('canvas'); m.width = sil.w; m.height = sil.h;
            const mc = m.getContext('2d');
            const id = mc.createImageData(sil.w, sil.h);
            const col = sil.mode === 'edges' ? [235, 235, 255] : [6, 6, 12];
            for (let i = 0; i < sil.mask.length; i++) {
                if (!sil.mask[i]) continue;
                id.data[i * 4] = col[0]; id.data[i * 4 + 1] = col[1]; id.data[i * 4 + 2] = col[2]; id.data[i * 4 + 3] = 255;
            }
            mc.putImageData(id, 0, 0);
            const r = Math.min(W / sil.w, H / sil.h) * .94;
            const w = sil.w * r, h = sil.h * r;
            ctx.save();
            ctx.shadowColor = sil.mode === 'edges' ? 'rgba(0,240,255,.5)' : 'rgba(0,240,255,.85)';
            ctx.shadowBlur = 18;
            ctx.imageSmoothingEnabled = true;
            ctx.drawImage(m, (W - w) / 2, (H - h) / 2, w, h);
            ctx.restore();
        }

        // Fusion : bandes verticales entrelacées des 4 persos
        // Fusion : les 4 persos superposés en transparence (chacun compte pour 25 %)
        function arcDrawFusion(canvas, imgs, seed) {
            const ctx = canvas.getContext('2d');
            const W = canvas.width, H = canvas.height;
            ctx.globalAlpha = 1;
            ctx.fillStyle = '#0b0b12'; ctx.fillRect(0, 0, W, H);
            let s = seed || 1;
            const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
            const list = imgs.filter(Boolean).sort(() => rnd() - .5);
            list.forEach((img, k) => {
                const r = Math.max(W / img.width, H / img.height);
                const w = img.width * r, h = img.height * r;
                ctx.globalAlpha = 1 / (k + 1); // moyenne progressive : poids égal pour chaque image
                ctx.drawImage(img, (W - w) / 2, 0, w, h); // cadré en haut : les visages se superposent
            });
            ctx.globalAlpha = 1;
            canvas.style.filter = 'contrast(1.25) saturate(1.25)';
        }

        function arcNow() { return Date.now() + arcClock; }

        function arcRenderCardBattle(q, stage) {
            const d = q.stage?.cardBattle || {}, cat = d.category || { id:'aura', label:'Aura', emoji:'🔥' };
            const me = (q.players || []).find(p => p.id === socket.id) || {};
            stage.innerHTML = '';
            const wrap = document.createElement('div'); wrap.className = 'cb-wrap';
            const title = document.createElement('div'); title.className = 'cb-cat'; title.textContent = `${cat.emoji || '⚔️'} ${cat.label || 'Stat'}`;
            wrap.appendChild(title);
            if (q.phase === 'reveal' && Array.isArray(d.plays)) {
                const vs = document.createElement('div'); vs.className = 'cb-vs';
                d.plays.forEach((pl, i) => {
                    const box = document.createElement('div'); box.className = 'cb-play' + ((pl.value || 0) === Math.max(...d.plays.map(x => x.value || 0)) ? ' win' : '');
                    const c = pl.card || {};
                    box.innerHTML = `${c.img ? `<img src="${v7esc(c.img)}" alt="">` : '<div style="font-size:4rem;">🃏</div>'}<b>${v7esc(c.name || 'Aucune carte')}</b><small style="display:block;color:var(--text-muted);">${v7esc(pl.name || '')}</small><div class="cb-value">${pl.value || 0}</div>`;
                    vs.appendChild(box);
                    if (i === 0) { const x=document.createElement('div'); x.style.cssText='font-family:Bangers;font-size:2rem;color:var(--accent-pink);'; x.textContent='VS'; vs.appendChild(x); }
                });
                wrap.appendChild(vs);
            } else {
                const help = document.createElement('div'); help.className='cb-help'; help.textContent = me.done ? '🔒 Carte verrouillée — attends ton adversaire.' : 'Choisis une carte encore disponible. Les cartes de ton adversaire restent secrètes.'; wrap.appendChild(help);
                const grid = document.createElement('div'); grid.className='cb-grid';
                if (!arcCardDeck.length) grid.innerHTML='<div class="arc-loading"><div class="arc-spin"></div><div>Chargement de ton deck…</div></div>';
                arcCardDeck.forEach(c => {
                    const used = arcCardUsed.has(c.key), el=document.createElement('button'); el.type='button'; el.className='cb-card'+(used?' used':'')+(me.done && !used?' locked':'');
                    const stats=c.stats||{};
                    el.innerHTML=`<img src="${v7esc(c.img||'')}" alt=""><div class="cb-name">${v7esc(c.name)}</div><div class="cb-anime">${v7esc(c.anime||'')}</div><div class="cb-stats"><span class="${cat.id==='power'?'cb-stat-hot':''}">💥 ${stats.power||0}</span><span class="${cat.id==='intelligence'?'cb-stat-hot':''}">🧠 ${stats.intelligence||0}</span><span class="${cat.id==='speed'?'cb-stat-hot':''}">⚡ ${stats.speed||0}</span><span class="${cat.id==='aura'?'cb-stat-hot':''}">🔥 ${stats.aura||0}</span></div>`;
                    el.disabled = q.phase!=='playing' || me.done || used;
                    if (!el.disabled) el.onclick=()=>{ socket.emit('arc_card_pick',{roomCode:currentRoomCode,key:c.key}); [...grid.children].forEach(x=>x.disabled=true); };
                    grid.appendChild(el);
                });
                wrap.appendChild(grid);
            }
            stage.appendChild(wrap);
        }
        function arcRenderBingo(q, stage) {
            const c=arcBingoChar||{}, me=(q.players||[]).find(p=>p.id===socket.id)||{};
            stage.innerHTML='';
            const wrap=document.createElement('div'); wrap.className='bingo-wrap';
            const ch=document.createElement('div'); ch.className='bingo-char';
            ch.innerHTML=c.name ? `${c.img?`<img src="${v7esc(c.img)}" alt="">`:'<div style="font-size:4rem;">👤</div>'}<div><b>${v7esc(c.name)}</b><small>${v7esc(c.anime||'')}</small><div style="margin-top:7px;font-size:.72rem;color:var(--text-muted);">✅ ${me.correctCount||0} • ❌ ${me.wrongCount||0}</div></div>` : '<div class="arc-loading"><div class="arc-spin"></div><div>Personnage suivant…</div></div>';
            wrap.appendChild(ch);
            const right=document.createElement('div'), grid=document.createElement('div'); grid.className='bingo-grid';
            (arcBingoBoard?.cells||[]).forEach((cell,i)=>{
                const b=document.createElement('button'); b.type='button'; b.className='bingo-cell';
                b.innerHTML=`<span class="em">${cell.emoji||'•'}</span><span>${v7esc(cell.label)}</span>`;
                b.disabled=q.phase!=='playing'||!c.name;
                if(!b.disabled)b.onclick=()=>{ arcBingoChar=null; [...grid.children].forEach(x=>x.disabled=true); socket.emit('arc_bingo_mark',{roomCode:currentRoomCode,idx:i}); };
                grid.appendChild(b);
            });
            if (!(arcBingoBoard?.cells||[]).length) grid.innerHTML='<div class="arc-loading" style="grid-column:1/-1"><div class="arc-spin"></div><div>Création de ta grille…</div></div>';
            right.appendChild(grid);
            const hint=document.createElement('div'); hint.className='bingo-reveal'; hint.textContent='Bonne catégorie : +1 • Mauvaise catégorie : -1 • La case change après chaque clic'; right.appendChild(hint);
            wrap.appendChild(right); stage.appendChild(wrap);
        }


        function arcRenderStage(q) {
            const stage = document.getElementById('arc-stage');
            const key = (q.game === 'scene' || q.game === 'audio' || q.game === 'mix_blind') && q.stage && q.stage.video
                ? `${q.round}|${q.game}|${q.stage.video}`
                : `${q.round}|${q.phase === 'playing' ? 'p' : q.phase}|${q.game}|${(q.stage.imgs || []).length}|${(q.stage.names || []).filter(Boolean).length}`;
            if (q.game === 'scene' && q.phase === 'reveal' && arcYt) { try { arcYt.unMute(); arcYt.setVolume(60); } catch (_) {} }
            if ((q.game === 'audio' || q.game === 'mix_blind') && q.phase !== 'playing') { const v = document.querySelector('.arc-video .arc-audio-veil'); if (v) v.remove(); }
            if (q.phase === 'loading') {
                if (arcStageKey !== 'loading') stage.innerHTML = '<div class="arc-loading"><div class="arc-spin"></div><div>Préparation de la manche…</div></div>';
                arcStageKey = 'loading';
                return;
            }
            if (q.game === 'chrono' || q.game === 'draft') {
                if (arcRaf) { cancelAnimationFrame(arcRaf); arcRaf = null; }
                arcStageKey = key + '|' + q.game;
                if (q.game === 'chrono') arcRenderChrono(q, stage); else arcRenderDraft(q, stage);
                return;
            }
            if (q.phase === 'intermission') {
                const seq = q.mix || q.tour || {};
                if (arcStageKey === 'inter' + (seq.idx || 0)) return;
                arcStageKey = 'inter' + (seq.idx || 0);
                arcDestroyVideo();
                stage.innerHTML = `<div style="text-align:center;"><div style="font-size:4rem;">🏁</div><div class="arc-ask">Fin de l'épreuve ${(seq.idx || 0) + 1}/${seq.total || ''}</div>${q.mix&&seq.nextLabel?`<div style="color:var(--accent-cyan);margin-top:8px;">Prochaine : ${v7esc(seq.nextLabel)}</div>`:''}</div>`;
                return;
            }
            if (key === arcStageKey) return;
            arcStageKey = key;
            if (arcRaf) { cancelAnimationFrame(arcRaf); arcRaf = null; }
            arcDestroyVideo();
            const reveal = q.phase !== 'playing';
            const st = q.stage || {};

            if (q.game === 'cardbattle') { arcRenderCardBattle(q, stage); return; }
            if (q.game === 'bingo') { arcRenderBingo(q, stage); return; }
            if (q.game === 'mix_quote') {
                const x=st.quote||{}; stage.innerHTML=`<div class="arc-mix-card"><div style="color:var(--accent-cyan);font-weight:800;">💬 ${v7esc(x.anime||'Citation')}</div><div class="big-quote">« ${v7esc(x.text||'…')} »</div><div class="tl-hint">Qui a dit ça ?</div></div>`; return;
            }
            if (q.game === 'mix_dle') {
                const x=st.dle||{}; stage.innerHTML=`<div class="arc-mix-card"><div style="color:var(--accent-yellow);font-weight:800;text-align:center;">🎴 ${v7esc(x.anime||'AnimeDLE')}</div><div class="arc-dle-clues">${(x.clues||[]).map(c=>`<div class="arc-dle-clue"><small>${v7esc(c.label)}</small><b>${v7esc(c.value)}</b></div>`).join('')}</div></div>`; return;
            }

            if (q.game === 'link' || q.game === 'imposteur') {
                stage.innerHTML = '';
                const grid = document.createElement('div'); grid.className = 'arc-grid4';
                (st.names || []).forEach((n, i) => {
                    const tile = document.createElement('div'); tile.className = 'arc-tile';
                    if (n === null) { const qm = document.createElement('div'); qm.className = 'arc-q'; qm.textContent = '?'; tile.appendChild(qm); grid.appendChild(tile); return; }
                    const src = (st.imgs || [])[i];
                    if (src) { const im = document.createElement('img'); im.src = src; im.alt = ''; tile.appendChild(im); }
                    else { const qm = document.createElement('div'); qm.className = 'arc-q'; qm.textContent = '👤'; tile.appendChild(qm); }
                    const cap = document.createElement('div'); cap.className = 'arc-cap'; cap.textContent = n; tile.appendChild(cap);
                    grid.appendChild(tile);
                });
                stage.appendChild(grid);
                return;
            }
            if (q.game === 'popularite') {
                stage.innerHTML = '';
                const wrap = document.createElement('div'); wrap.style.cssText = 'width:100%;';
                const ask = document.createElement('div'); ask.className = 'arc-ask'; ask.style.marginBottom = '10px'; ask.textContent = st.question || '';
                const duel = document.createElement('div'); duel.className = 'bb-duel'; duel.style.margin = '0';
                (st.names || []).forEach((n, i) => {
                    const card = document.createElement('div'); card.className = 'bb-card';
                    const im = document.createElement('img'); im.src = st.imgs[i]; im.alt = ''; card.appendChild(im);
                    const cap = document.createElement('div'); cap.className = 'bb-name'; cap.textContent = n; card.appendChild(cap);
                    if (reveal && q.reveal && q.reveal.favs) {
                        const f = document.createElement('div'); f.className = 'arc-fav'; f.textContent = '❤ ' + q.reveal.favs[i].toLocaleString('fr-FR') + ' fans'; card.appendChild(f);
                        card.classList.add(n === q.answer ? 'win' : 'lose');
                    } else if (!reveal) {
                        card.onclick = () => {
                            const me = (arcState.players || []).find(p => p.id === socket.id);
                            if (me && me.done) return;
                            arcMyChoice = n; socket.emit('arc_choice', { roomCode: currentRoomCode, choice: n });
                            card.style.borderColor = 'var(--accent-yellow)';
                        };
                    }
                    duel.appendChild(card);
                    if (i === 0) { const vs = document.createElement('div'); vs.className = 'bb-vs'; vs.textContent = 'VS'; duel.appendChild(vs); }
                });
                wrap.append(ask, duel);
                stage.appendChild(wrap);
                return;
            }
            if (q.game === 'bac') {
                arcRenderBac(q, stage, reveal);
                return;
            }
            if (q.game === 'emoji') {
                stage.innerHTML = '';
                const e = document.createElement('div'); e.className = 'arc-emoji'; e.textContent = st.emoji || '';
                const a = document.createElement('div'); a.className = 'arc-ask'; a.textContent = st.ask || '';
                const box = document.createElement('div'); box.append(e, a); stage.appendChild(box);
                return;
            }
            if (q.game === 'quatre') {
                stage.innerHTML = '';
                const grid = document.createElement('div'); grid.className = 'arc-grid4';
                const items = reveal && q.reveal ? q.reveal.items : (st.imgs || []).map(img => ({ img }));
                for (let i = 0; i < 4; i++) {
                    const tile = document.createElement('div'); tile.className = 'arc-tile';
                    const it = items[i];
                    if (it && it.img) {
                        const im = document.createElement('img'); im.src = it.img; im.alt = ''; tile.appendChild(im);
                        if (it.name) { const cap = document.createElement('div'); cap.className = 'arc-cap'; cap.textContent = it.name; tile.appendChild(cap); }
                    } else {
                        const qm = document.createElement('div'); qm.className = 'arc-q'; qm.textContent = '?'; tile.appendChild(qm);
                    }
                    grid.appendChild(tile);
                }
                stage.appendChild(grid);
                return;
            }
            if ((q.game === 'scene' || q.game === 'audio' || q.game === 'mix_blind') && st.video) {
                const audioOnly = q.game === 'audio' || q.game === 'mix_blind';
                stage.innerHTML = '';
                const box = document.createElement('div'); box.className = 'arc-video';
                const holder = document.createElement('div'); holder.id = 'arc-yt-' + q.round + '-' + st.video;
                const shield = document.createElement('div'); shield.className = 'arc-video-shield';
                const cover = document.createElement('div'); cover.className = 'arc-video-cover'; cover.innerHTML = '<div class="arc-spin"></div>';
                const badge = document.createElement('div'); badge.className = 'arc-video-badge'; badge.textContent = audioOnly ? '🎧 écoute bien…' : '🔇 scène sans le son';
                box.append(holder, shield, cover, badge);
                let veil = null;
                if (audioOnly) {
                    // voile opaque : on n'entend que le son (le toucher passe au lecteur pour lancer l'audio sur mobile)
                    shield.remove();
                    cover.style.pointerEvents = 'none';
                    veil = document.createElement('div'); veil.className = 'arc-audio-veil'; veil.innerHTML = '<div style="font-size:3rem;">🎧</div><div id="arc-audio-hint">Chargement du son…</div>';
                    box.appendChild(veil);
                }
                stage.appendChild(box);
                const myKey = arcStageKey, round = q.round;
                ytApi().then(YT => {
                    if (arcStageKey !== myKey) return;
                    let seeked = false;
                    arcYt = new YT.Player(holder.id, {
                        videoId: st.video,
                        playerVars: { autoplay: 1, mute: audioOnly ? 0 : 1, controls: 0, disablekb: 1, fs: 0, rel: 0, playsinline: 1, iv_load_policy: 3, modestbranding: 1 },
                        events: {
                            onReady: e => { if (audioOnly) { e.target.unMute(); e.target.setVolume(85); } else e.target.mute(); e.target.playVideo();
                                if (audioOnly) setTimeout(() => {
                                    if (arcStageKey !== myKey) return;
                                    let muted = true; try { muted = e.target.isMuted(); } catch (_) {}
                                    // téléphone : lecture avec son bloquée → on lance en muet et on propose un bouton son
                                    if (!seeked) { try { e.target.mute(); e.target.playVideo(); } catch (_) {} }
                                    if (!seeked || muted) arcAudioButton(box, e.target, myKey);
                                }, 1500); },
                            onStateChange: e => {
                                if (arcStageKey !== myKey || seeked || e.data !== YT.PlayerState.PLAYING) return;
                                seeked = true;
                                const dur = e.target.getDuration() || 90;
                                const elapsed = Math.max(0, arcNow() - arcState.startedAt) / 1000;
                                e.target.seekTo(Math.min(dur - 3, dur * (st.frac || 0.4) + elapsed), true);
                                setTimeout(() => cover.remove(), 700);
                                const h = document.getElementById('arc-audio-hint'); if (h) h.textContent = 'Écoute bien…';
                            },
                            onError: () => { if (arcStageKey === myKey && arcState && arcState.phase === 'playing') socket.emit('arc_media_error', { roomCode: currentRoomCode, round }); }
                        }
                    });
                });
                return;
            }
            if (q.game === 'zoom') {
                stage.innerHTML = '';
                const zc = document.createElement('canvas');
                zc.className = 'arc-canvas'; zc.width = 480; zc.height = 480; zc.style.imageRendering = 'auto';
                stage.appendChild(zc);
                const zKey = arcStageKey;
                arcLoadImage(st.img).then(img => {
                    if (arcStageKey !== zKey) return;
                    if (!img) { const ctx = zc.getContext('2d'); ctx.fillStyle = '#fff'; ctx.font = '20px sans-serif'; ctx.fillText('Image indisponible', 150, 240); return; }
                    if (reveal) { arcDrawZoom(zc, img, 1, st.focus); return; }
                    const loop = () => {
                        if (arcStageKey !== zKey || !arcState || arcState.phase !== 'playing') return;
                        arcDrawZoom(zc, img, (arcNow() - arcState.startedAt) / (arcState.roundMs * 0.92), st.focus);
                        arcRaf = requestAnimationFrame(loop);
                    };
                    loop();
                });
                return;
            }
            if (q.game === 'mapguess' || q.game === 'scene') {
                stage.innerHTML = '';
                const im = document.createElement('img'); im.className = 'arc-photo'; im.src = st.img; im.alt = '';
                stage.appendChild(im);
                return;
            }
            // pixel / silhouette / fusion : canvas
            stage.innerHTML = '';
            const canvas = document.createElement('canvas');
            canvas.className = 'arc-canvas'; canvas.width = 480; canvas.height = 480;
            stage.appendChild(canvas);
            const roundKey = arcStageKey;
            if (q.game === 'fusion') {
                if (reveal) {
                    stage.innerHTML = '';
                    const grid = document.createElement('div'); grid.className = 'arc-grid4';
                    (q.reveal?.items || []).forEach(it => {
                        const tile = document.createElement('div'); tile.className = 'arc-tile';
                        const im = document.createElement('img'); im.src = it.img; tile.appendChild(im);
                        const cap = document.createElement('div'); cap.className = 'arc-cap'; cap.textContent = it.name; tile.appendChild(cap);
                        grid.appendChild(tile);
                    });
                    stage.appendChild(grid);
                    return;
                }
                Promise.all((st.imgs || []).map(arcLoadImage)).then(imgs => {
                    if (arcStageKey !== roundKey) return;
                    arcDrawFusion(canvas, imgs, st.seed);
                });
                return;
            }
            arcLoadImage(st.img).then(img => {
                if (arcStageKey !== roundKey) return;
                if (!img) { const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.font = '20px sans-serif'; ctx.fillText('Image indisponible', 150, 240); return; }
                if (reveal) { arcDrawPixel(canvas, img, 0); canvas.style.imageRendering = 'auto'; return; }
                if (q.game === 'silhouette') {
                    canvas.style.imageRendering = 'auto';
                    const sil = img.__sil || (img.__sil = arcSilhouetteMask(img));
                    if (sil) arcDrawSilhouette(canvas, sil);
                    return;
                }
                // Pixel : de 6 cases à 56 cases, de façon progressive
                const loop = () => {
                    if (arcStageKey !== roundKey || !arcState || arcState.phase !== 'playing') return;
                    const t = Math.min(1, Math.max(0, (arcNow() - arcState.startedAt) / arcState.roundMs));
                    const cells = Math.round(6 * Math.pow(56 / 6, t));
                    if (cells !== canvas.__cells) { canvas.__cells = cells; arcDrawPixel(canvas, img, cells); }
                    arcRaf = requestAnimationFrame(loop);
                };
                loop();
            });
        }

        let arcBacTimer = null;
        function arcBacValues() { return [...document.querySelectorAll('.arc-bac-input')].map(i => i.value); }
        function arcRenderBac(q, stage, reveal) {
            const st = q.stage || {};
            stage.innerHTML = '';
            const box = document.createElement('div'); box.className = 'arc-bac';
            const letter = document.createElement('div'); letter.className = 'arc-bac-letter'; letter.textContent = st.letter || '?';
            box.appendChild(letter);
            if (!reveal) {
                const me = (q.players || []).find(p => p.id === socket.id) || {};
                (st.cats || []).forEach((c, i) => {
                    const row = document.createElement('label'); row.className = 'arc-bac-row';
                    const lab = document.createElement('span'); lab.textContent = c;
                    const inp = document.createElement('input'); inp.className = 'arc-bac-input'; inp.autocomplete = 'off';
                    inp.placeholder = (st.letter || '') + '…';
                    inp.disabled = !!me.done;
                    inp.addEventListener('input', () => {
                        clearTimeout(arcBacTimer);
                        arcBacTimer = setTimeout(() => socket.emit('arc_bac', { roomCode: currentRoomCode, answers: arcBacValues() }), 400);
                        document.getElementById('arc-bac-stop').disabled = arcBacValues().some(v => !v.trim());
                    });
                    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); const all = [...document.querySelectorAll('.arc-bac-input')]; const nx = all[i + 1]; if (nx) nx.focus(); else arcBacStop(); } });
                    row.append(lab, inp); box.appendChild(row);
                });
                const stop = document.createElement('button'); stop.id = 'arc-bac-stop'; stop.className = 'btn-action'; stop.textContent = '🛑 STOP !';
                stop.disabled = true; stop.onclick = arcBacStop; stop.style.cssText = 'background:var(--accent-pink);margin-top:10px;';
                box.appendChild(stop);
                stage.appendChild(box);
                setTimeout(() => { const f = document.querySelector('.arc-bac-input'); if (f && window.innerWidth > 700) f.focus(); }, 60);
                return;
            }
            const res = q.bac;
            if (res) {
                const wrap = document.createElement('div'); wrap.className = 'arc-bac-table-wrap';
                const t = document.createElement('table'); t.className = 'arc-bac-table';
                const head = document.createElement('tr');
                ['Joueur', ...res.cats, 'Total'].forEach(h => { const th = document.createElement('th'); th.textContent = h; head.appendChild(th); });
                t.appendChild(head);
                res.rows.forEach(r => {
                    const tr = document.createElement('tr');
                    const td0 = document.createElement('td'); td0.textContent = r.name; td0.style.fontWeight = '800'; tr.appendChild(td0);
                    r.cells.forEach(c => {
                        const td = document.createElement('td');
                        td.className = c.ok ? 'ok' : (c.text ? 'ko' : 'empty');
                        td.textContent = c.text || '—';
                        if (c.display) { const sm = document.createElement('small'); sm.textContent = '= ' + c.display; td.appendChild(sm); }
                        const pts = document.createElement('b'); pts.textContent = c.ok ? `+${c.pts}` : '0'; td.appendChild(pts);
                        tr.appendChild(td);
                    });
                    const tot = document.createElement('td'); tot.textContent = r.total; tot.style.cssText = 'font-weight:800;color:var(--accent-yellow);'; tr.appendChild(tot);
                    t.appendChild(tr);
                });
                wrap.appendChild(t); box.appendChild(wrap);
            }
            stage.appendChild(box);
        }
        function arcBacStop() {
            const vals = arcBacValues();
            if (vals.some(v => !v.trim())) return;
            socket.emit('arc_bac_stop', { roomCode: currentRoomCode, answers: vals });
            document.querySelectorAll('.arc-bac-input').forEach(i => i.disabled = true);
            const b = document.getElementById('arc-bac-stop'); if (b) b.disabled = true;
        }

        function arcTickFn() {
            const q = arcState;
            if (!q) return;
            const time = document.getElementById('arc-time');
            const fill = document.getElementById('arc-timer-fill');
            if (q.phase === 'playing') {
                if (q.game === 'bingo' && q.bingo?.infinite) { time.textContent='∞'; fill.style.width='100%'; }
                else { const left = Math.max(0, (q.endsAt || arcNow()) - arcNow()); time.textContent = `${Math.ceil(left / 1000)}s`; fill.style.width = `${100 * left / Math.max(1,q.roundMs||60000)}%`; }
            } else if (q.phase === 'reveal' && q.revealEndsAt) {
                const left = Math.max(0, q.revealEndsAt - arcNow());
                time.textContent = `Suite dans ${Math.ceil(left / 1000)}s`;
                fill.style.width = '0%';
            } else {
                time.textContent = q.phase === 'loading' ? '…' : 'Terminé';
                fill.style.width = '0%';
            }
        }

        function arcRenderFound() {
            const box = document.getElementById('arc-found');
            box.innerHTML = '';
            if (!arcState || arcState.answerType !== 'multi' || arcState.phase !== 'playing') return;
            arcMyFound.forEach(n => { const s = document.createElement('span'); s.textContent = '✔ ' + n; box.appendChild(s); });
        }

        function renderArcade(q) {
            if (!q) return;
            const prevRound = arcState ? arcState.round + '|' + arcState.phase : '';
            arcState = q;
            arcClock = q.serverNow - Date.now();
            const ui = ARC_UI[q.game] || {};
            document.getElementById('arc-title').textContent = ui.title || q.gameLabel;
            document.getElementById('arc-subtitle').textContent = q.mix
                ? `🎮 Party Mix • épreuve ${q.mix.idx + 1}/${q.mix.total} • ${ui.sub || ''}`
                : q.tour
                    ? `🏆 Tournoi • épreuve ${q.tour.idx + 1}/${q.tour.total} • ${ui.sub || ''}`
                    : (q.universeLabel ? q.universeLabel + ' • ' : '') + (ui.sub || '');
            if (q.mix) document.getElementById('arc-title').textContent = '🎮 ' + (ui.title || q.gameLabel).replace(/^\S+\s/, '');
            else if (q.tour) document.getElementById('arc-title').textContent = '🏆 ' + (ui.title || q.gameLabel).replace(/^\S+\s/, '');
            document.getElementById('arc-round').textContent = q.game==='bingo' ? '🎯 Fais le meilleur score' : `Manche ${Math.max(1, q.round)}/${q.totalRounds ?? '∞'}`;
            const arcEnd = document.getElementById('arc-end-infinite');
            if (arcEnd) arcEnd.style.display = q.game==='bingo' && q.bingo?.infinite && q.phase !== 'finished' && q.hostId === socket.id ? 'block' : (q.game!=='bingo' && q.totalRounds == null && q.phase !== 'finished' && q.hostId === socket.id ? 'block' : 'none');
            const doneCount = q.players.filter(p => p.done).length;
            document.getElementById('arc-answered').textContent = q.game==='bingo' ? '✅ +1  •  ❌ -1' : `Réponses : ${doneCount}/${q.players.length}`;
            const me = q.players.find(p => p.id === socket.id) || {};
            const newRound = prevRound !== q.round + '|' + q.phase && q.phase === 'playing';
            if (newRound) { arcMyFound = []; arcLastFeedback = null; }

            // Scores
            const board = document.getElementById('arc-scoreboard');
            board.innerHTML = '';
            [...q.players].sort((a, b) => b.score - a.score).forEach(p => {
                const row = document.createElement('div'); row.className = 'quote-score';
                const name = document.createElement('span');
                let mark = '';
                if (q.phase === 'playing') mark = q.game==='bingo' ? ` (✅${p.correctCount||0} / ❌${p.wrongCount||0})` : q.answerType === 'multi' ? ` ${p.progress || 0}/4` : q.answerType === 'bac' ? ` ${p.filled || 0}/5${p.done ? ' 🛑' : ''}` : q.answerType === 'chrono' ? ` ✅ ${p.progress || 0}` : q.answerType === 'draft' ? '' : (p.done ? ' ✔️' : ' …');
                else if (q.phase === 'reveal') mark = p.gained ? ` ✅ +${p.gained}` : ' ❌';
                name.textContent = (p.offline ? '📡 ' : '') + (p.eliminated ? '☠️ ' : '') + p.name + mark;
                if (p.eliminated) row.style.opacity = '.5';
                const sc = document.createElement('strong'); sc.style.color = 'var(--accent-yellow)'; sc.textContent = `${p.score} pts`;
                row.append(name, sc); board.appendChild(row);
            });

            arcRenderStage(q);

            // Réponses : boutons ou saisie
            const choices = document.getElementById('arc-choices');
            const inputWrap = document.getElementById('arc-input-wrap');
            const input = document.getElementById('arc-input');
            choices.innerHTML = '';
            if (q.answerType === 'choice' && q.choices && q.phase !== 'loading' && q.phase !== 'finished' && q.game !== 'popularite') {
                choices.style.display = 'grid';
                inputWrap.style.display = 'none';
                q.choices.forEach(c => {
                    const b = document.createElement('button'); b.className = 'bt-choice'; b.textContent = c;
                    if (q.phase === 'playing') {
                        b.disabled = !!me.done || !!me.eliminated;
                        if (arcState.__myChoice === c && me.done) b.classList.add('picked');
                        b.onclick = () => { arcState.__myChoice = c; arcMyChoice = c; socket.emit('arc_choice', { roomCode: currentRoomCode, choice: c }); b.classList.add('picked'); [...choices.children].forEach(x => x.disabled = true); };
                    } else {
                        b.disabled = true;
                        if (c === q.answer) b.classList.add('good');
                        else if (me.choice === c) b.classList.add('bad');
                    }
                    choices.appendChild(b);
                });
                if (q.phase === 'playing' && arcMyChoice && q.choices.includes(arcMyChoice) && me.done) {
                    [...choices.children].forEach(x => { if (x.textContent === arcMyChoice) x.classList.add('picked'); });
                }
            } else {
                choices.style.display = 'none';
                const typing = (q.answerType === 'text' || q.answerType === 'multi') && q.phase === 'playing' && !me.done && !me.eliminated;
                if (q.answerType === 'bac' || q.game === 'popularite') { inputWrap.style.display = 'none'; }
                inputWrap.style.display = typing ? 'block' : 'none';
                input.placeholder = q.answerType === 'multi' ? 'Un des 4 persos…' : 'Nom du personnage…';
                if (newRound) { input.value = ''; arcHideSugg(); if (typing && window.innerWidth > 700) setTimeout(() => input.focus(), 60); }
                if (!typing) arcHideSugg();
            }
            if (newRound) arcMyChoice = null;
            arcRenderFound();

            // Texte de résultat
            const result = document.getElementById('arc-result');
            const extra = document.getElementById('arc-extra');
            const reveal = document.getElementById('arc-reveal');
            const endBtns = document.getElementById('arc-end-buttons');
            const skip = document.getElementById('arc-skip');
            reveal.innerHTML = '';
            extra.textContent = '';
            skip.style.display = q.phase === 'reveal' && q.hostId === socket.id ? 'block' : 'none';
            endBtns.style.display = q.phase === 'finished' ? 'flex' : 'none';
            const replay = document.getElementById('arc-replay-btn');
            if (replay) replay.style.display = q.hostId === socket.id ? 'block' : 'none';

            if (q.phase === 'loading') {
                result.style.color = 'var(--text-muted)'; result.textContent = '';
            } else if (q.phase === 'intermission') {
                result.style.color = 'var(--accent-yellow)';
                result.textContent = q.mix ? `✅ Épreuve terminée. Tous les joueurs continuent !${q.mix.nextLabel ? ' Prochaine épreuve : ' + q.mix.nextLabel : ''}` : (((q.tour?.lastOutList || []).length > 1 ? `☠️ ${q.tour.lastOutList.slice(0, -1).join(', ')} et ${q.tour.lastOutList.slice(-1)[0]} sont éliminés ! ` : q.tour?.lastOut ? `☠️ ${q.tour.lastOut} est éliminé ! ` : 'Personne n\'est éliminé cette fois. ') + (q.tour?.alive ? `${q.tour.alive} encore en course. ` : '') + (q.tour?.nextLabel ? `Prochaine épreuve : ${q.tour.nextLabel}` : ''));
            } else if (q.phase === 'playing' && me.eliminated) {
                result.style.color = 'var(--text-muted)'; result.textContent = '☠️ Tu es éliminé du tournoi… tu regardes la suite 👀';
            } else if (q.phase === 'playing' && q.answerType === 'chrono') {
                result.style.color = arcLastFeedback ? (arcLastFeedback.ok ? '#00ff88' : 'var(--accent-pink)') : 'var(--text-color)';
                result.textContent = arcLastFeedback ? arcLastFeedback.message : 'Réponds le plus vite possible : une mauvaise réponse casse ta série !';
            } else if (q.phase === 'playing' && q.answerType === 'draft') {
                const d = q.stage.draft || {};
                result.style.color = 'var(--accent-cyan)';
                result.textContent = d.phase === 'vote' ? `🗳️ Votez pour la meilleure équipe (${d.votedCount || 0}/${q.players.length} votes)` : (d.turnId === socket.id ? '🎯 À toi de choisir un perso !' : `⏳ ${((q.players.find(p => p.id === d.turnId) || {}).name) || '…'} choisit…`);
            } else if (q.phase === 'playing') {
                if (me.done) { result.style.color = 'var(--accent-cyan)'; result.textContent = arcLastFeedback?.ok ? arcLastFeedback.message + ' — attends les autres…' : 'Réponse envoyée, attends les autres…'; }
                else if (arcLastFeedback) { result.style.color = arcLastFeedback.ok ? '#00ff88' : 'var(--accent-pink)'; result.textContent = arcLastFeedback.message; }
                else if (q.answerType === 'bac') { result.style.color = q.notice ? 'var(--accent-pink)' : 'var(--text-color)'; result.textContent = q.notice || `Lettre ${q.stage.letter} : remplis les 5 cases puis appuie sur STOP !`; }
                else { result.style.color = 'var(--text-color)'; result.textContent = q.game === 'cardbattle' ? 'Choisis secrètement une carte de ton deck.' : q.game === 'bingo' ? 'Clique sur une catégorie qui correspond au personnage. Bonne réponse +1, erreur -1.' : q.game === 'popularite' ? 'Clique sur le perso le plus populaire !' : q.answerType === 'choice' ? 'Choisis la bonne réponse !' : 'Écris le nom (VF ou anglais) et valide avec Entrée'; }
            } else if (q.phase === 'reveal') {
                const ok = !!me.gained;
                result.style.color = ok ? '#00ff88' : 'var(--accent-pink)';
                if (q.game === 'cardbattle') result.textContent = ok ? `⚔️ +${me.gained} pts sur cette manche !` : `⚔️ Manche perdue — ${q.answer || ''}`;
                else if (q.game === 'bingo') result.textContent = `🎟️ Score final : ${me.score || 0}`;
                else result.textContent = q.answerType === 'bac' ? `Lettre ${q.stage.letter} : tu marques ${me.gained || 0} pts` : (ok ? `✅ +${me.gained} — ` : '❌ ') + `C'était : ${q.answer}`;
                const bits = [];
                if (q.roundUniverse && q.game !== 'quatre') bits.push(q.roundUniverse);
                if (q.reveal?.place) bits.push(q.game === 'imposteur' ? q.reveal.place : '📍 ' + q.reveal.place);
                if (q.reveal?.song) bits.push(q.game === 'scene' || q.game === 'audio' || q.game === 'mix_blind' ? q.reveal.song : '🎶 ' + q.reveal.song);
                if (q.answerType === 'chrono') result.textContent = `⏱️ Temps écoulé ! Tu marques ${me.gained || 0} pts (${me.progress || 0} bonnes réponses)`;
                extra.textContent = bits.join(' • ');
            } else {
                if (q.message) { result.style.color = 'var(--accent-pink)'; result.textContent = q.message; }
                else {
                    const w = q.winnerNames || [];
                    result.style.color = 'var(--accent-yellow)';
                    result.textContent = w.length > 1 ? `Égalité : ${w.join(', ')} !` : `🏆 ${w[0] || '---'} gagne la partie !`;
                }
                arcDestroyVideo();
                document.getElementById('arc-stage').innerHTML = '<div style="font-size:4rem;">🏆</div>';
                arcStageKey = 'finished';
            }

            if (!arcTick) arcTick = setInterval(arcTickFn, 200);
            arcTickFn();
            if (typeof arcAfterRender === 'function') arcAfterRender(q, me);
        }
        let arcMyChoice = null;

        function arcHideSugg() { const s = document.getElementById('arc-sugg'); if (s) { s.style.display = 'none'; s.innerHTML = ''; } }

        function arcSuggest() {
            const input = document.getElementById('arc-input');
            const box = document.getElementById('arc-sugg');
            const v = arcNorm(input.value);
            box.innerHTML = '';
            if (v.length < 2) { box.style.display = 'none'; return; }
            const found = new Set(arcMyFound.map(arcNorm));
            const starts = [], contains = [];
            for (const n of arcNames) {
                const k = arcNorm(n);
                if (found.has(k)) continue;
                if (k.startsWith(v) || k.split(' ').some(w => w.startsWith(v))) starts.push(n);
                else if (k.includes(v)) contains.push(n);
                if (starts.length >= 8) break;
            }
            const list = [...starts, ...contains].slice(0, 8);
            arcSuggIdx = 0;
            if (!list.length) { box.style.display = 'none'; return; }
            list.forEach((n, i) => {
                const d = document.createElement('div'); d.textContent = n;
                if (i === 0) d.className = 'on';
                d.onmousedown = e => { e.preventDefault(); input.value = n; arcSubmitGuess(); };
                box.appendChild(d);
            });
            box.style.display = 'block';
        }

        function arcInputKey(e) {
            const box = document.getElementById('arc-sugg');
            const items = [...box.children];
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                if (!items.length) return;
                e.preventDefault();
                arcSuggIdx = (arcSuggIdx + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
                items.forEach((d, i) => d.className = i === arcSuggIdx ? 'on' : '');
            } else if (e.key === 'Enter') {
                e.preventDefault();
                const input = document.getElementById('arc-input');
                if (box.style.display === 'block' && items[arcSuggIdx]) input.value = items[arcSuggIdx].textContent;
                arcSubmitGuess();
            } else if (e.key === 'Escape') arcHideSugg();
        }

        function arcSubmitGuess() {
            const input = document.getElementById('arc-input');
            const text = input.value.trim();
            if (!text || !arcState || arcState.phase !== 'playing') return;
            socket.emit('arc_guess', { roomCode: currentRoomCode, text });
            input.value = '';
            arcHideSugg();
        }

        function arcSkip() { socket.emit('arc_skip', { roomCode: currentRoomCode }); }

        socket.on('arc_state', q => {
            if (!q) return;
            hideAllPanels();
            document.getElementById('arcade-room').style.display = 'block';
            renderArcade(q);
        });
        socket.on('arc_names', d => { arcNames = Array.isArray(d?.names) ? d.names : []; });
        socket.on('arc_private', d => { arcMyFound = Array.isArray(d?.found) ? d.found : []; arcRenderFound(); });
        socket.on('arc_card_deck', d => { arcCardDeck = Array.isArray(d?.cards) ? d.cards : []; arcCardUsed = new Set(Array.isArray(d?.used) ? d.used : []); if (arcState?.game === 'cardbattle') { arcStageKey=''; arcRenderStage(arcState); } });
        socket.on('arc_bingo_board', d => { arcBingoBoard = d || null; if (arcState?.game === 'bingo') { arcStageKey=''; arcRenderStage(arcState); } });
        socket.on('arc_bingo_character', d => { arcBingoChar = d?.character || null; if (arcState?.game === 'bingo') { arcStageKey=''; arcRenderStage(arcState); } });
        socket.on('arc_feedback', d => {
            arcLastFeedback = d;
            const result = document.getElementById('arc-result');
            if (result) { result.style.color = d.ok ? '#00ff88' : 'var(--accent-pink)'; result.textContent = d.message; }
            const input = document.getElementById('arc-input');
            if (input && !d.ok) { input.style.borderColor = 'var(--accent-pink)'; setTimeout(() => input.style.borderColor = '', 500); }
        });

        /* ===================== Images tier list / battle ===================== */
        const ITEM_IMG_CACHE = {};
        const itemImgQueue = [];
        let itemImgRunning = 0;
        function itemImageKey(source, name) { return source + '|' + name; }
        function itemImage(source, item) {
            const k = itemImageKey(source, item.name);
            if (ITEM_IMG_CACHE[k]) return ITEM_IMG_CACHE[k];
            ITEM_IMG_CACHE[k] = new Promise(resolve => {
                if (item.img) return resolve('/api/img?u=' + encodeURIComponent(item.img));
                let stored = null;
                try { stored = localStorage.getItem('itemimg3:' + k); } catch (e) {}
                if (stored) return resolve('/api/img?u=' + encodeURIComponent(stored));
                itemImgQueue.push({ source, name: item.name, k, resolve });
                itemImagePump();
            });
            return ITEM_IMG_CACHE[k];
        }
        function itemImagePump() {
            while (itemImgRunning < 4 && itemImgQueue.length) {
                const job = itemImgQueue.shift();
                itemImgRunning++;
                fetch(`/api/arcade/item-image?source=${encodeURIComponent(job.source)}&name=${encodeURIComponent(job.name)}`)
                    .then(r => r.json()).catch(() => null)
                    .then(d => {
                        const url = d && d.imageUrl;
                        try {
                            if (url) localStorage.setItem('itemimg3:' + job.k, url);
                            else localStorage.removeItem('itemimg3:' + job.k);
                        } catch (e) {}
                        if (!url) delete ITEM_IMG_CACHE[job.k];
                        job.resolve(url ? '/api/img?u=' + encodeURIComponent(url) : null);
                    })
                    .finally(() => { itemImgRunning--; itemImagePump(); });
            }
        }
        async function loadItems(source) {
            const r = await fetch(source === 'openings' ? '/api/arcade/openings' : '/api/arcade/items?source=' + encodeURIComponent(source));
            const d = await r.json();
            if (!d.ok) throw new Error('liste introuvable');
            return d;
        }
        function openSourceSelection(title, sub, onPick) {
            hideAllPanels();
            document.getElementById('universe-select-title').textContent = title;
            document.getElementById('universe-select-sub').textContent = sub;
            const grid = document.getElementById('universe-select-grid');
            grid.innerHTML = '';
            const all = document.createElement('button');
            all.className = 'quote-universe-btn';
            all.style.cssText = 'border-color:var(--accent-yellow);color:var(--accent-yellow);';
            all.textContent = '📺 Tous les animes';
            all.onclick = () => onPick('animes');
            grid.appendChild(all);
            UNIVERSE_CHOICES.forEach(([key, label]) => {
                const b = document.createElement('button');
                b.className = 'quote-universe-btn';
                b.textContent = 'Persos · ' + label;
                b.onclick = () => onPick(key);
                grid.appendChild(b);
            });
            document.getElementById('quote-universe-selection').style.display = 'block';
            window.scrollTo(0, 0);
        }

        /* ===================== TIER LIST ===================== */
        const TL_DEFAULT = [['S', '#ff4f6d'], ['A', '#ff9f43'], ['B', '#ffd93d'], ['C', '#6bd66b'], ['D', '#4cc9f0'], ['F', '#b388ff']];
        let tl = null, tlSelected = null, tlDragName = null;

        // l'écran d'accueil des tier lists (thèmes + tier lists des joueurs) ou le plateau de classement
        function tlMode(hub) {
            const room = document.getElementById('tierlist-room');
            room.querySelectorAll(':scope > .tl-toolbar, :scope > #tl-board, :scope > #tl-pool, :scope > .tl-hint').forEach(e => e.style.display = hub ? 'none' : '');
            document.getElementById('tl-hub').style.display = hub ? 'block' : 'none';
            if (hub) document.getElementById('tl-rate').style.display = 'none';
            tlStopPlayer();
        }
        let tlCom = { sort: 'top', q: '' };
        async function openTierSelection() {
            hideAllPanels();
            document.getElementById('tierlist-room').style.display = 'block';
            tlMode(true);
            document.getElementById('tl-subtitle').textContent = 'Choisis une tier list, ou crée la tienne !';
            const hub = document.getElementById('tl-hub');
            hub.innerHTML = '<div class="arc-loading" style="padding:30px;"><div class="arc-spin"></div></div>';
            const d = await v7get('/api/tl/themes');
            hub.innerHTML = `<div class="tl-sec">🏆 Tier lists à thème</div><div class="qt-grid" id="tl-themes"></div>
                <button class="btn-action" style="max-width:420px;display:block;margin:16px auto 0;background:var(--accent-pink);" onclick="tlEditor()">✏️ Créer ma tier list (n'importe quels persos)</button>
                <div class="tl-sec">👥 Tier lists des joueurs</div>
                <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;"><input id="tl-com-q" class="v7-input" style="flex:1;min-width:160px;margin:0;" placeholder="🔎 Chercher une tier list…" value="${v7esc(tlCom.q)}">
                <div class="tl-tabs" style="margin:0;"><button data-s="top" class="${tlCom.sort === 'top' ? 'on' : ''}">⭐ Top</button><button data-s="new" class="${tlCom.sort === 'new' ? 'on' : ''}">🆕 Récentes</button></div></div>
                <div id="tl-com"></div>`;
            const grid = document.getElementById('tl-themes');
            ((d && d.themes) || []).forEach(t => {
                const b = document.createElement('button'); b.className = 'qt-btn';
                b.innerHTML = `<span class="qt-emo">${v7esc(t.emoji || '🏆')}</span><b>${v7esc(t.title)}</b><small>${t.n} ${t.kind === 'ost' || t.kind === 'openings' ? 'musiques' : t.kind === 'fights' ? 'combats' : 'persos'}</small>`;
                b.onclick = () => startTierList('tl:' + t.id);
                grid.appendChild(b);
            });
            let tmo = null;
            document.getElementById('tl-com-q').oninput = e => { clearTimeout(tmo); tmo = setTimeout(() => { tlCom.q = e.target.value.trim(); tlLoadCommunity(); }, 300); };
            hub.querySelectorAll('.tl-tabs button[data-s]').forEach(b => b.onclick = () => { tlCom.sort = b.dataset.s; hub.querySelectorAll('.tl-tabs button[data-s]').forEach(x => x.classList.toggle('on', x === b)); tlLoadCommunity(); });
            tlLoadCommunity();
            window.scrollTo(0, 0);
        }
        function tlCard(t, mine) {
            const c = document.createElement('div'); c.className = 'tl-ccard';
            c.innerHTML = `<div class="tl-cov">${t.cover.map(u => `<img loading="lazy" src="/api/img?u=${encodeURIComponent(u)}" alt="">`).join('')}</div>
                <div class="tl-cinfo"><b>${v7esc(t.title)}</b><small>par ${v7esc(t.author)} • ${t.n} éléments • ${t.rating ? '⭐ ' + t.rating + ' (' + t.votes + ')' : 'pas encore notée'} • ${t.plays} parties</small></div>`;
            c.onclick = () => startTierList('utl:' + t.id);
            if (mine) {
                const del = document.createElement('button'); del.className = 'tl-del'; del.textContent = '🗑️';
                del.onclick = async e => { e.stopPropagation(); if (!confirm('Supprimer « ' + t.title + ' » ?')) return; const r = await v7post('/api/tl/delete', { id: t.id }); if (r && r.ok) tlLoadCommunity(); };
                const ed = document.createElement('button'); ed.className = 'tl-del'; ed.style.right = '40px'; ed.textContent = '✏️';
                ed.onclick = async e => { e.stopPropagation(); const r = await v7get('/api/tl/one?id=' + encodeURIComponent(t.id)); if (r && r.ok) tlEditor({ id: t.id, title: t.title, items: r.items }); };
                c.append(ed, del);
            }
            return c;
        }
        async function tlLoadCommunity() {
            const box = document.getElementById('tl-com'); if (!box) return;
            box.innerHTML = '<div class="arc-loading" style="padding:20px;"><div class="arc-spin"></div></div>';
            const d = await v7get('/api/tl/community?sort=' + tlCom.sort + '&q=' + encodeURIComponent(tlCom.q));
            box.innerHTML = '';
            if (!d || !d.ok) { box.innerHTML = '<p class="tl-hint">Impossible de charger les tier lists.</p>'; return; }
            if (d.mine && d.mine.length && !tlCom.q) {
                box.insertAdjacentHTML('beforeend', '<div style="font-weight:800;margin:4px 0 6px;">📁 Mes tier lists</div>');
                const g = document.createElement('div'); g.className = 'tl-cgrid'; d.mine.forEach(t => g.appendChild(tlCard(t, true))); box.appendChild(g);
                box.insertAdjacentHTML('beforeend', '<div style="font-weight:800;margin:14px 0 6px;">🌍 Toutes</div>');
            }
            if (!d.list.length) { box.insertAdjacentHTML('beforeend', '<p class="tl-hint">Aucune tier list pour l’instant… crée la première !</p>'); return; }
            const g = document.createElement('div'); g.className = 'tl-cgrid'; d.list.forEach(t => g.appendChild(tlCard(t, false))); box.appendChild(g);
        }

        /* --- éditeur : n'importe quels persos / animes, images trouvées sur AniList --- */
        let tlEd = null;
        function tlEditor(edit) {
            hideAllPanels();
            document.getElementById('tierlist-room').style.display = 'block';
            tlMode(true);
            tlEd = { id: edit ? edit.id : null, type: 'char', items: edit ? edit.items.slice() : [], res: [] };
            document.getElementById('tl-subtitle').textContent = edit ? 'Modifier ma tier list' : 'Créer ma tier list';
            const hub = document.getElementById('tl-hub');
            hub.innerHTML = `<input id="tl-ed-title" class="v7-input" maxlength="60" placeholder="Titre (ex : Tier list des meilleurs rivaux)" value="${edit ? v7esc(edit.title) : ''}">
                <div class="tl-tabs"><button data-t="char" class="on">👤 Persos</button><button data-t="anime">📺 Animes</button></div>
                <div style="display:flex;gap:6px;"><input id="tl-ed-q" class="v7-input" style="flex:1;margin:0;" placeholder="🔎 Cherche un perso de n'importe quel anime (ex : Gojo, Naruto, Frieren…)"><button class="btn-action" style="width:auto;margin:0;padding:0 14px;" onclick="tlEdSearch()">Chercher</button></div>
                <div class="tl-hint" style="text-align:left;">Clique sur un résultat pour l’ajouter. Tout est cherché sur AniList, donc même les persos qui ne sont pas dans le jeu.</div>
                <div id="tl-ed-res" class="tl-ed-res"></div>
                <div style="display:flex;gap:6px;margin-top:6px;"><input id="tl-ed-free" class="v7-input" style="flex:1;margin:0;" maxlength="50" placeholder="…ou ajoute un élément sans image (texte)"><button class="btn-action" style="width:auto;margin:0;padding:0 14px;background:#2a2a40;" onclick="tlEdFree()">➕</button></div>
                <div class="tl-sec" id="tl-ed-count"></div>
                <div id="tl-ed-list" class="tl-pool" style="margin-top:0;"></div>
                <div class="tl-hint">Clique sur un élément de ta liste pour le retirer.</div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;"><button class="btn-action" style="flex:1;min-width:180px;" onclick="tlEdSave()">💾 ${edit ? 'Enregistrer' : 'Publier ma tier list'}</button><button class="btn-action" style="flex:1;min-width:140px;background:#2a2a40;" onclick="openTierSelection()">Annuler</button></div>`;
            hub.querySelectorAll('.tl-tabs button').forEach(b => b.onclick = () => { tlEd.type = b.dataset.t; hub.querySelectorAll('.tl-tabs button').forEach(x => x.classList.toggle('on', x === b)); document.getElementById('tl-ed-q').placeholder = tlEd.type === 'anime' ? '🔎 Cherche un anime (ex : Frieren, Bleach…)' : '🔎 Cherche un perso de n\'importe quel anime (ex : Gojo, Naruto, Frieren…)'; tlEdSearch(); });
            const q = document.getElementById('tl-ed-q'); let tmo = null;
            q.oninput = () => { clearTimeout(tmo); tmo = setTimeout(tlEdSearch, 450); };
            q.onkeydown = e => { if (e.key === 'Enter') { clearTimeout(tmo); tlEdSearch(); } };
            document.getElementById('tl-ed-free').onkeydown = e => { if (e.key === 'Enter') tlEdFree(); };
            tlEdRender();
            window.scrollTo(0, 0);
        }
        function tlEdTile(it, onClick, added) {
            const el = document.createElement('div'); el.className = 'tl-item' + (it.img ? '' : ' noimg') + (added ? ' added' : ''); el.title = it.sub ? it.name + ' — ' + it.sub : it.name;
            if (it.img) { const im = document.createElement('img'); im.loading = 'lazy'; im.src = '/api/img?u=' + encodeURIComponent(it.img); im.onerror = () => { im.remove(); el.classList.add('noimg'); }; el.appendChild(im); }
            const cap = document.createElement('div'); cap.className = 'tl-name'; cap.textContent = it.name; el.appendChild(cap);
            el.onclick = onClick; return el;
        }
        async function tlEdSearch() {
            const q = document.getElementById('tl-ed-q').value.trim(), box = document.getElementById('tl-ed-res');
            if (q.length < 2) { box.innerHTML = ''; return; }
            box.innerHTML = '<div class="arc-spin" style="margin:8px auto;"></div>';
            const d = await v7get(`/api/tl/search?type=${tlEd.type}&q=${encodeURIComponent(q)}`);
            if (!d || !d.ok) { box.innerHTML = `<p class="tl-hint">${v7esc((d && d.error) || 'Recherche impossible.')}</p>`; return; }
            tlEd.res = d.items; tlEdRenderRes();
        }
        function tlEdRenderRes() {
            const box = document.getElementById('tl-ed-res'); box.innerHTML = '';
            if (!tlEd.res.length) { box.innerHTML = '<p class="tl-hint">Aucun résultat.</p>'; return; }
            const has = n => tlEd.items.some(x => x.name.toLowerCase() === n.toLowerCase());
            tlEd.res.forEach(it => box.appendChild(tlEdTile(it, () => { if (has(it.name)) return; if (tlEd.items.length >= 300) return toast('300 éléments maximum.', 'var(--accent-pink)'); tlEd.items.push(it); tlEdRender(); }, has(it.name))));
        }
        function tlEdFree() {
            const f = document.getElementById('tl-ed-free'), n = f.value.trim();
            if (!n || tlEd.items.some(x => x.name.toLowerCase() === n.toLowerCase())) return;
            tlEd.items.push({ name: n }); f.value = ''; tlEdRender();
        }
        function tlEdRender() {
            document.getElementById('tl-ed-count').textContent = `📋 Ma liste (${tlEd.items.length})`;
            const box = document.getElementById('tl-ed-list'); box.innerHTML = '';
            if (!tlEd.items.length) box.innerHTML = '<div class="tl-hint" style="width:100%;">Ajoute au moins 4 éléments.</div>';
            tlEd.items.forEach((it, i) => box.appendChild(tlEdTile(it, () => { tlEd.items.splice(i, 1); tlEdRender(); })));
            if (tlEd.res.length) tlEdRenderRes();
        }
        async function tlEdSave() {
            const title = document.getElementById('tl-ed-title').value.trim();
            const d = await v7post('/api/tl/create', { id: tlEd.id, title, items: tlEd.items });
            if (!d || !d.ok) return toast('❌ ' + ((d && d.error) || 'Connecte-toi pour publier une tier list.'), 'var(--accent-pink)');
            toast('✅ Tier list publiée !', '#00ff88');
            startTierList('utl:' + d.id);
        }

        /* --- petit lecteur YouTube pour écouter un opening / une OST depuis la tier list --- */
        function tlPlay(it) { mediaOpen(it, it.name); }
        function tlStopPlayer() { mediaClose(); }

        /* --- lecteur YouTube partagé (battles, « Qui a le plus… », tier lists) ---
           Sur téléphone, le son ne peut démarrer qu'après un toucher DANS le lecteur : on l'affiche en grand
           en bas de l'écran avec ses commandes, et si la vidéo refuse d'être intégrée, un lien vers YouTube. */
        let mediaYt = null, mediaKey = 0;
        function mediaClose() {
            mediaKey++;
            try { if (mediaYt && mediaYt.destroy) mediaYt.destroy(); } catch (_) {}
            mediaYt = null;
            document.getElementById('tl-player')?.remove();
        }
        async function mediaOpen(it, title) {
            mediaClose();
            const key = ++mediaKey;
            if (typeof btPauseBackground === 'function') btPauseBackground();
            const start = Math.max(0, Math.floor(it.start || 0));
            const p = document.createElement('div'); p.id = 'tl-player';
            p.innerHTML = `<div class="tlp-bar"><span>${it.scene ? '🎬' : '🎵'} ${v7esc(title || it.name || '')}</span><button onclick="mediaClose()">✖</button></div>
                <div class="tlp-box"><div id="tlp-yt"></div></div>
                <div class="tlp-hint">⏳ Chargement…</div>`;
            document.body.appendChild(p);
            const hint = p.querySelector('.tlp-hint');
            const ytUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(it.video)}${start ? '&t=' + start + 's' : ''}`;
            const fail = () => { if (key !== mediaKey) return; hint.innerHTML = `⚠️ Cette vidéo ne peut pas être lue ici. <a href="${ytUrl}" target="_blank" rel="noopener">▶ Ouvrir sur YouTube</a>`; };
            let YT;
            try { YT = await Promise.race([ytApi(), new Promise((_, rej) => setTimeout(() => rej(), 8000))]); } catch (_) { return fail(); }
            if (key !== mediaKey) return;
            let playing = false;
            mediaYt = new YT.Player('tlp-yt', {
                width: '100%', height: '100%', videoId: it.video,
                playerVars: { autoplay: 1, playsinline: 1, controls: 1, rel: 0, start, fs: 1, iv_load_policy: 3 },
                events: {
                    onReady: e => { try { e.target.unMute(); e.target.setVolume(100); e.target.playVideo(); } catch (_) {} },
                    onStateChange: e => { if (key === mediaKey && e.data === YT.PlayerState.PLAYING) { playing = true; hint.innerHTML = `🔊 Lecture en cours • <a href="${ytUrl}" target="_blank" rel="noopener">voir sur YouTube</a>`; } },
                    onError: fail
                }
            });
            // lecture automatique bloquée (téléphone) : on demande de toucher la vidéo
            setTimeout(() => { if (key === mediaKey && !playing && !/⚠️/.test(hint.textContent)) hint.innerHTML = `👆 Touche la vidéo pour lancer le son • <a href="${ytUrl}" target="_blank" rel="noopener">ou ouvre-la sur YouTube</a>`; }, 1800);
        }
        async function tlRateUi(t) {
            const box = document.getElementById('tl-rate');
            if (!t || t.mine) { box.style.display = t ? 'block' : 'none'; if (t) box.innerHTML = `Tier list de <b>${v7esc(t.author)}</b> (la tienne) • ${t.rating ? '⭐ ' + t.rating + ' (' + t.votes + ' votes)' : 'pas encore notée'}`; return; }
            box.style.display = 'block';
            box.innerHTML = `Tier list de <b>${v7esc(t.author)}</b> • Note-la : ${[1, 2, 3, 4, 5].map(s => `<button data-s="${s}" class="${(t.myRating || 0) >= s ? 'on' : ''}">★</button>`).join('')} ${t.rating ? '<small>(' + t.rating + ' • ' + t.votes + ' votes)</small>' : ''}`;
            box.querySelectorAll('button').forEach(b => b.onclick = async () => { const d = await v7post('/api/tl/rate', { id: t.id, stars: +b.dataset.s }); if (!d || !d.ok) return toast('❌ ' + ((d && d.error) || 'Connecte-toi pour noter.'), 'var(--accent-pink)'); toast('⭐ Merci pour ta note !', '#ffd93d'); tlRateUi(d.tl); });
        }
        async function startTierList(source) {
            hideAllPanels();
            document.getElementById('tierlist-room').style.display = 'block';
            tlMode(false);
            document.getElementById('tl-board').innerHTML = '<div class="arc-loading" style="padding:30px;"><div class="arc-spin"></div><div>Chargement…</div></div>';
            document.getElementById('tl-pool').innerHTML = '';
            let data;
            try {
                if (source.startsWith('utl:')) {
                    const d = await v7get('/api/tl/one?play=1&id=' + encodeURIComponent(source.slice(4)));
                    if (!d || !d.ok) throw new Error('introuvable');
                    data = { label: d.tl.title, items: d.items };
                    tlRateUi(d.tl);
                } else { data = await loadItems(source); document.getElementById('tl-rate').style.display = 'none'; }
            } catch (e) { document.getElementById('tl-board').innerHTML = '<p style="text-align:center;padding:20px;">Impossible de charger la liste.</p>'; return; }
            // Une tier list travaille avec le nom comme identifiant : on supprime donc les doublons
            // avant de reconstruire le pool (y compris les anciennes listes communautaires).
            const uniqueItems = [];
            const seenItemNames = new Set();
            for (const item of (Array.isArray(data.items) ? data.items : [])) {
                const key = String(item?.name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
                if (!key || seenItemNames.has(key)) continue;
                seenItemNames.add(key);
                uniqueItems.push(item);
            }
            data.items = uniqueItems;
            const names = data.items.map(i => i.name);
            let saved = null;
            try { saved = JSON.parse(localStorage.getItem('tierlist:' + source) || 'null'); } catch (e) {}
            const tiers = TL_DEFAULT.map(([label, color], i) => ({ label: saved?.tiers?.[i]?.label || label, color, items: [] }));
            const placed = new Set();
            if (saved && Array.isArray(saved.tiers)) {
                saved.tiers.forEach((t, i) => (t.items || []).forEach(n => { if (tiers[i] && names.includes(n) && !placed.has(n)) { tiers[i].items.push(n); placed.add(n); } }));
            }
            tl = { source, label: data.label, items: Object.fromEntries(data.items.map(i => [i.name, i])), tiers, pool: names.filter(n => !placed.has(n)) };
            const unit = source === 'animes' ? 'animes' : data.items.some(i => i.video) ? 'musiques' : data.items.some(i => i.imgs) ? 'éléments' : source.startsWith('utl:') ? 'éléments' : 'persos';
            document.getElementById('tl-subtitle').textContent = `${data.label} • ${names.length} ${unit}`;
            tlRender();
        }
        function tlSave() {
            if (!tl) return;
            try { localStorage.setItem('tierlist:' + tl.source, JSON.stringify({ tiers: tl.tiers.map(t => ({ label: t.label, items: t.items })) })); } catch (e) {}
        }
        function tlRemove(name) {
            tl.tiers.forEach(t => t.items = t.items.filter(n => n !== name));
            tl.pool = tl.pool.filter(n => n !== name);
        }
        function tlMove(name, target, beforeName) {
            if (!tl || !name) return;
            tlRemove(name);
            const list = target === 'pool' ? tl.pool : tl.tiers[target].items;
            const idx = beforeName ? list.indexOf(beforeName) : -1;
            if (idx >= 0) list.splice(idx, 0, name); else list.push(name);
            tlSelected = null;
            tlSave();
            tlRender();
        }
        function tlItemEl(name) {
            const it = tl.items[name] || { name };
            const el = document.createElement('div');
            el.className = 'tl-item noimg' + (tlSelected === name ? ' sel' : '');
            el.draggable = true;
            el.dataset.name = name;
            const cap = document.createElement('div'); cap.className = 'tl-name'; cap.textContent = name;
            el.appendChild(cap);
            if (it.video) {
                const pb = document.createElement('button'); pb.className = 'tl-play'; pb.textContent = '▶'; pb.title = 'Écouter';
                pb.addEventListener('click', e => { e.stopPropagation(); tlPlay(it); });
                el.appendChild(pb);
            }
            if (it.imgs) { // duo / combat : deux images côte à côte
                const duo = document.createElement('div'); duo.className = 'tl-duo';
                it.imgs.forEach(u => { const im = document.createElement('img'); im.src = '/api/img?u=' + encodeURIComponent(u); im.alt = ''; im.loading = 'lazy'; duo.appendChild(im); });
                el.insertBefore(duo, cap); el.classList.remove('noimg');
            } else itemImage(tl.source, it).then(src => {
                if (!src) return;
                const im = document.createElement('img'); im.src = src; im.alt = name; im.loading = 'lazy';
                im.onload = () => el.classList.remove('noimg');
                im.onerror = () => im.remove();
                el.insertBefore(im, cap);
            });
            el.addEventListener('dragstart', e => { tlDragName = name; el.classList.add('dragging'); try { e.dataTransfer.setData('text/plain', name); e.dataTransfer.effectAllowed = 'move'; } catch (_) {} });
            el.addEventListener('dragend', () => { el.classList.remove('dragging'); tlDragName = null; });
            el.addEventListener('click', e => {
                e.stopPropagation();
                if (tlSelected && tlSelected !== name) {
                    // déplacer l'image sélectionnée juste avant celle-ci
                    const target = tl.pool.includes(name) ? 'pool' : tl.tiers.findIndex(t => t.items.includes(name));
                    tlMove(tlSelected, target, name);
                    return;
                }
                tlSelected = tlSelected === name ? null : name;
                tlRender();
            });
            return el;
        }
        function tlBindZone(zone, target) {
            zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('over'); });
            zone.addEventListener('dragleave', () => zone.classList.remove('over'));
            zone.addEventListener('drop', e => {
                e.preventDefault(); zone.classList.remove('over');
                const name = tlDragName || (e.dataTransfer && e.dataTransfer.getData('text/plain'));
                const overItem = e.target.closest && e.target.closest('.tl-item');
                tlMove(name, target, overItem && overItem.dataset.name !== name ? overItem.dataset.name : null);
            });
            zone.addEventListener('click', () => { if (tlSelected) tlMove(tlSelected, target, null); });
        }
        function tlRender() {
            const board = document.getElementById('tl-board');
            board.innerHTML = '';
            tl.tiers.forEach((t, i) => {
                const row = document.createElement('div'); row.className = 'tl-row';
                const lab = document.createElement('div'); lab.className = 'tl-label'; lab.style.background = t.color;
                lab.contentEditable = 'true'; lab.spellcheck = false; lab.textContent = t.label;
                lab.addEventListener('blur', () => { t.label = lab.textContent.trim().slice(0, 14) || TL_DEFAULT[i][0]; lab.textContent = t.label; tlSave(); });
                lab.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); lab.blur(); } });
                const zone = document.createElement('div'); zone.className = 'tl-zone';
                t.items.forEach(n => zone.appendChild(tlItemEl(n)));
                tlBindZone(zone, i);
                row.append(lab, zone);
                board.appendChild(row);
            });
            const pool = document.getElementById('tl-pool');
            pool.innerHTML = '';
            tl.pool.forEach(n => pool.appendChild(tlItemEl(n)));
            if (!tl.pool.length) { const d = document.createElement('div'); d.className = 'tl-hint'; d.style.width = '100%'; d.textContent = '🎉 Tout est classé ! Télécharge ta tier list en image pour la partager.'; pool.appendChild(d); }
            if (!pool.__bound) { tlBindZone(pool, 'pool'); pool.__bound = true; }
        }
        function tlReset() {
            if (!tl || !confirm('Remettre toutes les images en bas ?')) return;
            tl.tiers.forEach(t => { tl.pool.push(...t.items); t.items = []; });
            tlSave(); tlRender();
        }
        function tlCopyText() {
            if (!tl) return;
            const txt = `Ma tier list ${tl.label}\n` + tl.tiers.map(t => `${t.label} : ${t.items.join(', ') || '—'}`).join('\n');
            const done = () => alert('Tier list copiée !');
            if (navigator.clipboard) navigator.clipboard.writeText(txt).then(done).catch(() => prompt('Copie ce texte :', txt));
            else prompt('Copie ce texte :', txt);
        }
        async function tlDownload() {
            if (!tl) return;
            const size = 96, gap = 6, labelW = 120, perRow = 9, W = labelW + perRow * (size + gap) + gap;
            const rows = tl.tiers.map(t => Math.max(1, Math.ceil(t.items.length / perRow)));
            const H = 70 + rows.reduce((a, r) => a + r * (size + gap) + gap + 4, 0) + 30;
            const c = document.createElement('canvas'); c.width = W; c.height = H;
            const ctx = c.getContext('2d');
            ctx.fillStyle = '#0b0b10'; ctx.fillRect(0, 0, W, H);
            ctx.fillStyle = '#ffe600'; ctx.font = 'bold 30px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
            ctx.fillText(`TIER LIST — ${tl.label}`, 16, 36);
            let y = 70;
            const imgs = {};
            await Promise.all(tl.tiers.flatMap(t => t.items).map(async n => {
                const it = tl.items[n] || { name: n };
                if (it.imgs) { imgs[n] = await Promise.all(it.imgs.map(u => arcLoadImage('/api/img?u=' + encodeURIComponent(u)).catch(() => null))); return; }
                const src = await itemImage(tl.source, it);
                if (src) imgs[n] = await arcLoadImage(src);
            }));
            tl.tiers.forEach((t, i) => {
                const h = rows[i] * (size + gap) + gap;
                ctx.fillStyle = '#161622'; ctx.fillRect(0, y, W, h);
                ctx.fillStyle = t.color; ctx.fillRect(0, y, labelW, h);
                ctx.fillStyle = '#111'; ctx.font = 'bold 34px sans-serif'; ctx.textAlign = 'center';
                ctx.fillText(t.label, labelW / 2, y + h / 2, labelW - 10);
                t.items.forEach((n, k) => {
                    const x = labelW + gap + (k % perRow) * (size + gap), yy = y + gap + Math.floor(k / perRow) * (size + gap);
                    const img = imgs[n];
                    ctx.fillStyle = '#1d1d2c'; ctx.fillRect(x, yy, size, size);
                    if (Array.isArray(img)) img.forEach((im, j) => {
                        if (!im) return;
                        const half = size / 2, r = Math.max(half / im.width, size / im.height), w = im.width * r, hh = im.height * r;
                        ctx.save(); ctx.beginPath(); ctx.rect(x + j * half, yy, half, size); ctx.clip();
                        ctx.drawImage(im, x + j * half + (half - w) / 2, yy, w, hh);
                        ctx.restore();
                    });
                    else if (img) {
                        const r = Math.max(size / img.width, size / img.height);
                        const w = img.width * r, hh = img.height * r;
                        ctx.save(); ctx.beginPath(); ctx.rect(x, yy, size, size); ctx.clip();
                        ctx.drawImage(img, x + (size - w) / 2, yy, w, hh);
                        ctx.restore();
                    }
                    ctx.fillStyle = 'rgba(0,0,0,.75)'; ctx.fillRect(x, yy + size - 20, size, 20);
                    ctx.fillStyle = '#fff'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center';
                    ctx.fillText(n, x + size / 2, yy + size - 10, size - 4);
                });
                y += h + 4;
            });
            ctx.fillStyle = '#a0a0b0'; ctx.font = '13px sans-serif'; ctx.textAlign = 'right';
            ctx.fillText('Anime Game', W - 12, H - 14);
            try {
                const a = document.createElement('a');
                a.download = `tierlist-${tl.source}.png`;
                a.href = c.toDataURL('image/png');
                document.body.appendChild(a); a.click(); a.remove();
            } catch (e) { alert("Export impossible sur ce navigateur. Fais une capture d'écran à la place."); }
        }

        /* ===================== BATTLE DE PRÉFÉRENCE ===================== */
        let bb = null;
        const BB_ROUND_NAMES = { 2: 'FINALE', 4: 'DEMI-FINALES', 8: 'QUARTS DE FINALE', 16: 'HUITIÈMES DE FINALE', 32: 'SEIZIÈMES DE FINALE', 64: 'TOUR DES 64', 128: 'TOUR DES 128' };

        function openBattleSelection() {
            startBattleSetup('openings');
        }
        // Questions rangées par thème (inspirées des tournois « Who is #1 ? » les plus joués)
        const QAP_CATS = [['power', '💪 Puissance'], ['aura', '🔥 Aura & style'], ['emo', '💔 Émotions'], ['dark', '😈 Méchants & chaos'], ['fun', '😂 Fun'], ['life', '🤝 Vie quotidienne']];
        const QAP_BY_CAT = {
            power: ['Qui est le plus fort ?', 'Qui a le plus de pouvoir ?', 'Qui gagnerait en 1 contre 1 ?', 'Qui a la meilleure transformation ?', 'Qui est le plus dangereux ?',
                'Qui est le meilleur épéiste ?', 'Qui a le plus de plot armor ?', 'Qui ferait le meilleur boss final ?', 'Qui est le plus stylé en combat ?', 'Qui est le plus stratège ?',
                'Qui est le plus intelligent ?', 'Qui est le plus courageux ?'],
            aura: ['Qui a le plus d’aura ?', 'Qui a le plus de charisme ?', 'Qui a l’entrée la plus stylée ?', 'Qui est le plus froid ? 🥶', 'Qui est le plus iconique ?',
                'Qui a le meilleur design ?', 'Qui a le meilleur style ?', 'Qui a le plus de rizz ?', 'Qui est le plus beau ou la plus belle ?', 'Qui a les meilleures répliques ?',
                'Qui est le plus mystérieux ?', 'Qui a la plus grosse perte d’aura ?'],
            emo: ['Qui a le plus souffert ?', 'Qui a l’histoire la plus triste ?', 'Qui a fait le meilleur comeback ?', 'Qui a la meilleure évolution ?', 'Qui est le plus malchanceux ?',
                'Qui pleure le plus ?', 'Qui est le mieux écrit ?', 'Qui est le plus sous-coté ?', 'Qui est le plus surcoté ?'],
            dark: ['Qui est le plus maléfique ?', 'Qui est le plus sans pitié ?', 'Qui est le plus détesté ?', 'Qui est le plus flippant ?', 'Qui est le plus fou ?',
                'Qui a le plus mauvais caractère ?', 'Qui a le plus gros ego ?', 'Qui a le plus de haters ?', 'Qui est le plus agaçant ?'],
            fun: ['Qui est le plus drôle ?', 'Qui mange le plus ?', 'Qui a la plus grosse flemme ?', 'Qui gagnerait Koh-Lanta ?', 'Qui survivrait le plus longtemps dans un film d’horreur ?',
                'Qui ferait le meilleur streamer ?', 'Qui mériterait son propre jeu vidéo ?', 'Qui ferait le pire date ?', 'Qui a le meilleur rire ?', 'Qui est le plus inutile ?',
                'Qui a le look le plus improbable ?', 'Qui a le plus de chance ?'],
            life: ['Qui serait le meilleur pote ?', 'Qui serait le meilleur coloc ?', 'Qui ferait le meilleur prof ?', 'Qui ferait le meilleur chef ?', 'À qui confierais-tu ta vie ?',
                'Qui serait le meilleur garde du corps ?', 'Qui est le plus loyal ?', 'Qui est le plus gentil ?', 'Qui a le plus de fans ?', 'Qui ferait le meilleur parent ?']
        };
        const QAP_QUESTIONS = [], QAP_CAT_OF = [];
        QAP_CATS.forEach(([c]) => QAP_BY_CAT[c].forEach(q => { QAP_QUESTIONS.push(q); QAP_CAT_OF.push(c); }));
        const qapQ = i => QAP_QUESTIONS[i] || QAP_QUESTIONS[0];
        let qapCats = (() => { try { const v = JSON.parse(localStorage.getItem('qap_cats') || 'null'); return Array.isArray(v) && v.length ? v : null; } catch (e) { return null; } })();
        function qapNextQ() {
            if (!bb.qBag || !bb.qBag.length) bb.qBag = bbShuffle(QAP_QUESTIONS.map((_, i) => i).filter(i => !qapCats || qapCats.includes(QAP_CAT_OF[i])));
            return bb.qBag.pop();
        }
        async function startBattleSetup(source, kind) {
            hideAllPanels();
            document.getElementById('battle-room').style.display = 'block';
            const body = document.getElementById('bb-body');
            body.innerHTML = '<div class="arc-loading" style="padding:30px;"><div class="arc-spin"></div><div>Chargement…</div></div>';
            let data;
            try { data = await loadItems(source); } catch (e) { body.innerHTML = '<p style="text-align:center;padding:20px;">Impossible de charger la liste.</p>'; return; }
            bb = { source, label: data.label, all: data.items, tp: source.startsWith('tp:') || source.startsWith('qt:'), qap: kind === 'qap', qt: kind === 'qt', qtTitle: kind === 'qt' ? data.label : null };
            const h2 = document.querySelector('#battle-room h2'); if (h2) h2.textContent = bb.qap ? '🏆 QUI A LE PLUS…' : bb.tp ? '🤔 TU PRÉFÈRES…' : '⚔️ BATTLE DE PRÉFÉRENCE';
            if (bb.qt && h2) h2.textContent = '🏆 QUI A LE PLUS…';
            const unit = source === 'qt:entree' ? 'entrées' : data.items.some(i => i.video) ? 'musiques' : data.items.some(i => i.imgs) ? 'duos' : 'persos';
            if (bb.qt) bb.unit = unit;
            document.getElementById('bb-subtitle').textContent = bb.qt ? `${data.label} • ${data.items.length} ${unit} • clique sur ton choix${unit === 'musiques' ? ' (▶ pour écouter)' : unit === 'entrées' ? ' (▶ pour voir la scène)' : ''}` : bb.qap ? `${data.label} • ${data.items.length} persos • pas de bonne réponse : c'est toi qui choisis` : bb.tp ? `${data.label} • ${data.items.length} persos • clique sur celui que tu préfères` : `${data.label} • ${data.items.length} génériques • clique sur ▶ pour écouter`;
            if (bb.qap) return qapSetup(document.getElementById('bb-body'));
            body.innerHTML = '';
            const h = document.createElement('div'); h.className = 'bb-head';
            h.innerHTML = '<div class="bb-round">COMBIEN DE PARTICIPANTS ?</div><p style="color:var(--text-muted);font-size:.85rem;margin-top:6px;">Ils sont tirés au hasard. À chaque duel, clique sur ton préféré (ou flèches ← →).</p>';
            body.appendChild(h);
            const sizes = document.createElement('div'); sizes.className = 'bb-sizes';
            const N = data.items.length;
            const opts = (bb.tp ? [8, 16, 32, 64, 128, 256, 512, 1024] : [8, 16, 32, 64]).filter(n => n <= N);
            opts.forEach(n => {
                const b = document.createElement('button'); b.className = 'btn-action'; b.textContent = `${n} ${bb.qt ? bb.unit : bb.tp ? 'persos' : 'participants'}`;
                b.onclick = () => bbStart(n);
                sizes.appendChild(b);
            });
            // Tu préfères : on peut mettre TOUS les persos (tour préliminaire si le nombre n'est pas une puissance de 2)
            if (bb.tp && N >= 8 && !opts.includes(N)) {
                const b = document.createElement('button'); b.className = 'btn-action'; b.style.background = 'var(--accent-cyan)'; b.style.color = '#111';
                b.textContent = `🌍 Tous les ${N} ${bb.qt ? bb.unit : 'persos'}`;
                b.onclick = () => bbStart(N);
                sizes.appendChild(b);
            }
            body.appendChild(sizes);
            const rk = document.createElement('button'); rk.className = 'btn-action'; rk.style.cssText = 'background:#2a2a40;max-width:320px;display:block;margin:0 auto;';
            rk.textContent = '🌍 Voir le classement mondial';
            rk.onclick = () => bbShowRanking(body, true);
            body.appendChild(rk);
            // précharge quelques images
            data.items.slice(0, 16).forEach(it => itemImage(source, it));
        }
        // Thèmes « Qui a le plus… » avec leurs propres persos (pères, duos, animaux, OST…)
        async function openQapThemes() {
            hideAllPanels();
            document.getElementById('battle-room').style.display = 'block';
            const h2 = document.querySelector('#battle-room h2'); if (h2) h2.textContent = '🏆 QUI A LE PLUS…';
            document.getElementById('bb-subtitle').textContent = 'Choisis un thème : pas de bonne réponse, c’est toi qui décides !';
            const body = document.getElementById('bb-body');
            body.innerHTML = '<div class="arc-loading" style="padding:30px;"><div class="arc-spin"></div></div>';
            let d = null; try { d = await (await fetch('/api/qap/themes')).json(); } catch (e) {}
            body.innerHTML = '';
            const grid = document.createElement('div'); grid.className = 'qt-grid';
            ((d && d.themes) || []).forEach(t => {
                const b = document.createElement('button'); b.className = 'qt-btn';
                b.innerHTML = `<span class="qt-emo">${v7esc(t.emoji || '🏆')}</span><b>${v7esc(t.title)}</b><small>${t.n} ${t.kind === 'ost' ? 'musiques' : t.kind === 'duos' ? 'duos' : 'persos'}</small>`;
                b.onclick = () => startBattleSetup('qt:' + t.id, 'qt');
                grid.appendChild(b);
            });
            body.appendChild(grid);
            const free = document.createElement('button'); free.className = 'btn-action'; free.style.cssText = 'background:#2a2a40;max-width:420px;display:block;margin:16px auto 0;';
            free.textContent = '🎲 Mode libre : questions au hasard sur les persos d’un anime'; free.onclick = () => openUniverseSelection('qap');
            body.appendChild(free);
            window.scrollTo(0, 0);
        }
        function qapSetup(body) {
            body.innerHTML = '';
            const N = bb.all.length;
            const h = document.createElement('div'); h.className = 'bb-head';
            h.innerHTML = '<div class="bb-round">🎲 EN MANCHES</div><p style="color:var(--text-muted);font-size:.85rem;margin-top:6px;">À chaque manche, une nouvelle question et deux persos au hasard. Choisis tes thèmes :</p>';
            body.appendChild(h);
            // thèmes des questions (plusieurs possibles)
            const chips = document.createElement('div'); chips.className = 'qap-chips';
            const drawChips = () => {
                chips.innerHTML = '';
                const all = document.createElement('button'); all.textContent = '🌈 Tout mélangé'; all.className = !qapCats ? 'on' : '';
                all.onclick = () => { qapCats = null; try { localStorage.removeItem('qap_cats'); } catch (e) {} drawChips(); };
                chips.appendChild(all);
                QAP_CATS.forEach(([c, label]) => {
                    const b = document.createElement('button'); b.textContent = label; b.className = qapCats && qapCats.includes(c) ? 'on' : '';
                    b.onclick = () => {
                        const set = new Set(qapCats || []); set.has(c) ? set.delete(c) : set.add(c);
                        qapCats = set.size ? [...set] : null;
                        try { qapCats ? localStorage.setItem('qap_cats', JSON.stringify(qapCats)) : localStorage.removeItem('qap_cats'); } catch (e) {}
                        drawChips();
                    };
                    chips.appendChild(b);
                });
            };
            drawChips(); body.appendChild(chips);
            const rs = document.createElement('div'); rs.className = 'bb-sizes';
            [5, 10, 15, 20].forEach(n => { const b = document.createElement('button'); b.className = 'btn-action'; b.textContent = `${n} manches`; b.onclick = () => qapStartRounds(n); rs.appendChild(b); });
            body.appendChild(rs);
            const h2 = document.createElement('div'); h2.className = 'bb-head'; h2.style.marginTop = '18px';
            h2.innerHTML = '<div class="bb-round">🏆 EN TOURNOI</div><p style="color:var(--text-muted);font-size:.85rem;margin-top:6px;">Une seule question pour tout le tournoi, jusqu’à la finale.</p>';
            body.appendChild(h2);
            const sel = document.createElement('select'); sel.className = 'v7-input'; sel.id = 'qap-q'; sel.style.cssText = 'max-width:420px;display:block;margin:0 auto 10px;';
            sel.innerHTML = '<option value="-1">🎲 Une question au hasard</option>' + QAP_CATS.map(([c, label]) => `<optgroup label="${v7esc(label)}">${QAP_QUESTIONS.map((q, i) => QAP_CAT_OF[i] === c ? `<option value="${i}">${v7esc(q)}</option>` : '').join('')}</optgroup>`).join('');
            body.appendChild(sel);
            const ts = document.createElement('div'); ts.className = 'bb-sizes';
            const pickQ = () => { const v = +sel.value; return v >= 0 ? v : Math.floor(Math.random() * QAP_QUESTIONS.length); };
            [8, 16, 32, 64, 128, 256, 512, 1024].filter(n => n <= N).forEach(n => { const b = document.createElement('button'); b.className = 'btn-action'; b.textContent = `${n} persos`; b.onclick = () => { bb.qi = pickQ(); bbStart(n); }; ts.appendChild(b); });
            if (N >= 8 && ![8, 16, 32, 64, 128, 256, 512, 1024].includes(N)) { const b = document.createElement('button'); b.className = 'btn-action'; b.style.cssText = 'background:#ff9f43;color:#111;'; b.textContent = `🌍 Tous les ${N} persos`; b.onclick = () => { bb.qi = pickQ(); bbStart(N); }; ts.appendChild(b); }
            body.appendChild(ts);
            bb.all.slice(0, 12).forEach(it => itemImage(bb.source, it));
        }
        // Mode manches : question + 2 persos au hasard à chaque manche
        function qapPair() {
            const used = bb.rounds.seen;
            let pool = bb.all.filter(i => !used.has(i.name));
            if (pool.length < 2) { used.clear(); pool = bb.all; }
            const [a, b] = bbShuffle(pool).slice(0, 2).map(i => i.name);
            used.add(a); used.add(b);
            return [a, b];
        }
        function qapStartRounds(n) {
            bb.qBag = null;
            Object.assign(bb, { rounds: { total: n, no: 1, log: [], seen: new Set() }, qi: null, size: n + 1, bye: null, playin: false, next: [], idx: 0, duels: [], history: [], eliminated: {}, done: false });
            bb.qi = qapNextQ(); bb.current = qapPair();
            bbRenderDuel();
        }
        function qapRoundNext() {
            const r = bb.rounds;
            const [w, l] = bb.duels[bb.duels.length - 1];
            r.log.push({ q: bb.qi, w, l });
            if (r.no >= r.total) return qapFinishRounds();
            r.no++; bb.qi = qapNextQ(); bb.current = qapPair(); bb.next = []; bb.idx = 0;
            bbRenderDuel();
        }
        function qapFinishRounds() {
            bb.done = true;
            const body = document.getElementById('bb-body');
            body.innerHTML = '<div class="bb-head"><div class="bb-round">📋 TES CHOIX</div></div>';
            const list = document.createElement('div'); list.className = 'bb-rank';
            bb.rounds.log.forEach((e, i) => {
                const row = bbRankRow(i + 1, e.w, '', null);
                const mid = row.children[2]; mid.style.flex = '1';
                const q = document.createElement('div'); q.style.cssText = 'font-size:.78rem;color:var(--accent-cyan);font-weight:700;'; q.textContent = qapQ(e.q);
                const vs = document.createElement('div'); vs.style.cssText = 'font-size:.75rem;color:var(--text-muted);'; vs.textContent = 'contre ' + e.l;
                mid.prepend(q); mid.appendChild(vs);
                row.children[3].remove();
                list.appendChild(row);
            });
            body.appendChild(list);
            const again = document.createElement('div'); again.style.cssText = 'display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:14px;';
            const b1 = document.createElement('button'); b1.className = 'btn-action'; b1.style.cssText = 'width:auto;margin:0;'; b1.textContent = '🔁 Rejouer'; b1.onclick = () => qapStartRounds(bb.rounds.total);
            const b2 = document.createElement('button'); b2.className = 'btn-action'; b2.style.cssText = 'width:auto;margin:0;background:#2a2a40;'; b2.textContent = 'Changer de mode'; b2.onclick = () => startBattleSetup(bb.source, 'qap');
            again.append(b1, b2); body.appendChild(again);
            if (typeof confetti === 'function') confetti(1500);
        }
        function bbShuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
        function bbStart(n) {
            const entrants = bbShuffle(bb.all).slice(0, n).map(i => i.name);
            // nombre qui n'est pas une puissance de 2 : tour préliminaire pour les persos en trop, les autres sont qualifiés d'office
            const P = Math.pow(2, Math.floor(Math.log2(entrants.length)));
            const extra = entrants.length - P;
            const current = extra ? entrants.slice(0, 2 * extra) : entrants;
            const bye = extra ? entrants.slice(2 * extra) : null;
            Object.assign(bb, { size: entrants.length, current, bye, playin: !!extra, rounds: null, next: [], idx: 0, duels: [], history: [], eliminated: {}, done: false });
            bb.theme = bb.qap && bb.qi != null ? 'qap' + bb.qi + '|' + bb.source : bb.source;
            bbRenderDuel();
        }
        function bbItem(name) { return bb.all.find(i => i.name === name) || { name }; }
        function bbCard(name, onClick) {
            const card = document.createElement('div'); card.className = 'bb-card noimg';
            const cap = document.createElement('div'); cap.className = 'bb-name'; cap.textContent = name;
            const sub0 = bbItem(name).sub;
            if (sub0) { const sm = document.createElement('small'); sm.className = 'bb-sub'; sm.textContent = sub0; cap.appendChild(sm); }
            card.appendChild(cap);
            const it0 = bbItem(name);
            if (it0.imgs && it0.imgs.length > 1) {
                const duo = document.createElement('div'); duo.className = 'bb-duoimg';
                it0.imgs.slice(0, 2).forEach(u => { const im = document.createElement('img'); im.src = '/api/img?u=' + encodeURIComponent(u); im.alt = ''; im.onload = () => card.classList.remove('noimg'); duo.appendChild(im); });
                card.insertBefore(duo, cap);
            } else itemImage(bb.source, it0).then(src => {
                if (!src) return;
                const im = document.createElement('img'); im.src = src; im.alt = name;
                im.onload = () => card.classList.remove('noimg');
                im.onerror = () => im.remove();
                card.insertBefore(im, cap);
            });
            if (onClick) card.onclick = onClick;
            const it = bbItem(name);
            if (it.video) card.classList.add('bb-op');
            if (it.video && onClick) {
                const label = bb.source === 'qt:entree' ? '▶ Voir l’entrée' : '▶ Écouter';
                const play = document.createElement('button'); play.className = 'bb-play'; play.textContent = label;
                play.onclick = e => {
                    e.stopPropagation();
                    document.querySelectorAll('.bb-play').forEach(b => b.textContent = b.dataset.l || label);
                    mediaOpen({ ...it, start: it.start != null ? it.start : 35, scene: bb.source === 'qt:entree' }, name);
                    play.textContent = bb.source === 'qt:entree' ? '🎬 En cours' : '🔊 En cours';
                };
                play.dataset.l = label;
                card.appendChild(play);
            }
            return card;
        }
        function bbRenderDuel() {
            mediaClose();
            const body = document.getElementById('bb-body');
            const total = bb.current.length / 2;
            const matchNo = bb.idx / 2 + 1;
            const a = bb.current[bb.idx], b = bb.current[bb.idx + 1];
            body.innerHTML = '';
            const head = document.createElement('div'); head.className = 'bb-head';
            const rn = document.createElement('div'); rn.className = 'bb-round'; rn.textContent = bb.rounds ? `MANCHE ${bb.rounds.no} / ${bb.rounds.total}` : bb.playin ? 'TOUR PRÉLIMINAIRE' : (BB_ROUND_NAMES[bb.current.length] || `TOUR DES ${bb.current.length}`);
            const sub = document.createElement('div'); sub.style.cssText = 'color:var(--text-muted);font-size:.85rem;'; sub.textContent = bb.rounds ? 'Pas de bonne réponse : choisis !' : `Duel ${matchNo} / ${total}`;
            const prog = document.createElement('div'); prog.className = 'bb-progress';
            const done = bb.duels.length, all = bb.size - 1;
            prog.innerHTML = `<div style="width:${100 * done / all}%"></div>`;
            head.append(rn, sub, prog);
            if ((bb.qap && bb.qi != null) || bb.qt) { const q = document.createElement('div'); q.className = 'qap-q'; q.textContent = bb.qt ? bb.qtTitle : qapQ(bb.qi); head.appendChild(q); }
            body.appendChild(head);
            const duel = document.createElement('div'); duel.className = 'bb-duel';
            const ca = bbCard(a, () => bbPick(0, ca, cb));
            const vs = document.createElement('div'); vs.className = 'bb-vs'; vs.textContent = 'VS';
            const cb = bbCard(b, () => bbPick(1, ca, cb));
            duel.append(ca, vs, cb);
            body.appendChild(duel);
            const tools = document.createElement('div'); tools.style.cssText = 'display:flex;gap:8px;justify-content:center;flex-wrap:wrap;';
            const undo = document.createElement('button'); undo.className = 'btn-action'; undo.style.cssText = 'width:auto;margin:0;background:#2a2a40;';
            undo.textContent = '↩ Annuler le dernier choix'; undo.disabled = !bb.history.length; undo.onclick = bbUndo;
            tools.appendChild(undo);
            body.appendChild(tools);
            // précharge le duel suivant
            [bb.current[bb.idx + 2], bb.current[bb.idx + 3]].filter(Boolean).forEach(n => itemImage(bb.source, bbItem(n)));
        }
        function bbPick(side, ca, cb) {
            if (!bb || bb.done || bb.busy) return;
            bb.busy = true;
            const a = bb.current[bb.idx], b = bb.current[bb.idx + 1];
            const winner = side === 0 ? a : b, loser = side === 0 ? b : a;
            (side === 0 ? ca : cb).classList.add('win');
            (side === 0 ? cb : ca).classList.add('lose');
            bb.history.push(JSON.stringify({ current: bb.current, next: bb.next, idx: bb.idx, duels: bb.duels, eliminated: bb.eliminated, bye: bb.bye, playin: bb.playin, qi: bb.qi, rounds: bb.rounds ? { ...bb.rounds, seen: [...bb.rounds.seen] } : null }));
            bb.duels.push([winner, loser]);
            bb.eliminated[loser] = bb.playin ? bb.size : bb.current.length;
            bb.next.push(winner);
            bb.idx += 2;
            setTimeout(() => {
                bb.busy = false;
                if (bb.rounds) return qapRoundNext();
                if (bb.idx >= bb.current.length) {
                    if (bb.next.length === 1 && !bb.bye) return bbFinish(bb.next[0]);
                    bb.current = bb.bye ? bbShuffle([...bb.next, ...bb.bye]) : bb.next; bb.next = []; bb.idx = 0; bb.bye = null; bb.playin = false;
                }
                bbRenderDuel();
            }, 380);
        }
        function bbUndo() {
            if (!bb || !bb.history.length) return;
            Object.assign(bb, JSON.parse(bb.history.pop()));
            if (bb.rounds) bb.rounds.seen = new Set(bb.rounds.seen);
            bb.done = false;
            bbRenderDuel();
        }
        document.addEventListener('keydown', e => {
            const panel = document.getElementById('battle-room');
            if (!bb || bb.done || !panel || panel.style.display === 'none' || !bb.current) return;
            if (e.target && (e.target.tagName === 'INPUT' || e.target.isContentEditable)) return;
            const cards = panel.querySelectorAll('.bb-card');
            if (cards.length !== 2) return;
            if (e.key === 'ArrowLeft') bbPick(0, cards[0], cards[1]);
            if (e.key === 'ArrowRight') bbPick(1, cards[0], cards[1]);
        });
        function bbFinish(champion) {
            mediaClose();
            bb.done = true;
            const body = document.getElementById('bb-body');
            body.innerHTML = '';
            const box = document.createElement('div'); box.className = 'bb-champion';
            box.innerHTML = bb.qt ? `<div class="qap-q">${v7esc(bb.qtTitle)}</div><div class="bb-round">👑 TON #1</div>` : bb.qap && bb.qi != null ? `<div class="qap-q">${v7esc(qapQ(bb.qi))}</div><div class="bb-round">👑 TON #1</div>` : '<div class="bb-round">🏆 TON CHAMPION</div>';
            box.appendChild(bbCard(champion));
            body.appendChild(box);
            // Classement de ta battle : champion, finaliste, demi-finalistes...
            const order = [champion, ...Object.keys(bb.eliminated).sort((x, y) => bb.eliminated[x] - bb.eliminated[y])];
            const tabs = document.createElement('div'); tabs.className = 'bb-tabs';
            const t1 = document.createElement('button'); t1.textContent = 'Mon classement'; t1.className = 'on';
            const t2 = document.createElement('button'); t2.textContent = '🌍 Classement mondial';
            tabs.append(t1, t2);
            body.appendChild(tabs);
            const list = document.createElement('div');
            body.appendChild(list);
            const showMine = () => {
                t1.className = 'on'; t2.className = '';
                list.innerHTML = '';
                const rank = document.createElement('div'); rank.className = 'bb-rank';
                const P2 = Math.pow(2, Math.floor(Math.log2(bb.size)));
            const stageName = n => { if (n === champion) return 'Champion'; const e = bb.eliminated[n]; if (e > P2) return 'Préliminaire'; return { 2: 'Finaliste', 4: 'Demi-finale', 8: 'Quarts', 16: 'Huitièmes', 32: 'Seizièmes' }[e] || (e ? 'Tour des ' + e : ''); };
                order.forEach((n, i) => rank.appendChild(bbRankRow(i + 1, n, stageName(n), null)));
                list.appendChild(rank);
            };
            t1.onclick = showMine;
            t2.onclick = () => { t2.className = 'on'; t1.className = ''; bbShowRanking(list, false); };
            showMine();
            const again = document.createElement('div'); again.style.cssText = 'display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:14px;';
            const b1 = document.createElement('button'); b1.className = 'btn-action'; b1.style.cssText = 'width:auto;margin:0;'; b1.textContent = '🔁 Rejouer'; b1.onclick = () => bbStart(bb.size);
            const b2 = document.createElement('button'); b2.className = 'btn-action'; b2.style.cssText = 'width:auto;margin:0;background:#2a2a40;'; b2.textContent = bb.qt ? 'Changer de thème' : 'Changer le nombre'; b2.onclick = () => bb.qt ? openQapThemes() : startBattleSetup(bb.source, bb.qap ? 'qap' : undefined);
            again.append(b1, b2);
            body.appendChild(again);
            fetch('/api/battle/result', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ theme: bb.theme || bb.source, champion, duels: bb.duels }) }).catch(() => {});
        }
        function bbRankRow(pos, name, right, rate) {
            const row = document.createElement('div'); row.className = 'bb-rank-row';
            const p = document.createElement('div'); p.className = 'bb-pos'; p.textContent = pos;
            const ph = document.createElement('div'); ph.className = 'bb-ph';
            itemImage(bb.source, bbItem(name)).then(src => { if (src) { const im = document.createElement('img'); im.src = src; im.alt = ''; ph.replaceWith(im); } });
            const mid = document.createElement('div');
            const nm = document.createElement('div'); nm.style.fontWeight = '800'; nm.textContent = name;
            mid.appendChild(nm);
            if (rate != null) { const bar = document.createElement('div'); bar.className = 'bb-bar'; bar.innerHTML = `<div style="width:${rate}%"></div>`; mid.appendChild(bar); }
            const r = document.createElement('div'); r.style.cssText = 'font-size:.78rem;color:var(--text-muted);text-align:right;'; r.textContent = right;
            row.append(p, ph, mid, r);
            return row;
        }
        async function bbShowRanking(container, withBack) {
            container.innerHTML = '<div class="arc-loading" style="padding:20px;"><div class="arc-spin"></div></div>';
            let d = null;
            try { d = await (await fetch('/api/battle/ranking?theme=' + encodeURIComponent(bb.theme || bb.source))).json(); } catch (e) {}
            container.innerHTML = '';
            const h = document.createElement('div'); h.className = 'bb-head'; h.innerHTML = '<div class="bb-round">🌍 CLASSEMENT MONDIAL</div><p style="color:var(--text-muted);font-size:.8rem;">🏆 = nombre de fois champion • % = victoires en duel</p>';
            container.appendChild(h);
            const rank = document.createElement('div'); rank.className = 'bb-rank';
            if (!d || !d.rows || !d.rows.length) {
                rank.innerHTML = '<p style="text-align:center;color:var(--text-muted);">Pas encore de votes pour ce thème : sois le premier à finir une battle !</p>';
            } else {
                d.rows.slice(0, 50).forEach((r, i) => rank.appendChild(bbRankRow(i + 1, r.name, `🏆 ${r.champions} • ${r.rate}% (${r.matches} duels)`, r.rate)));
            }
            container.appendChild(rank);
            if (withBack) {
                const back = document.createElement('button'); back.className = 'btn-action'; back.style.cssText = 'max-width:320px;display:block;margin:12px auto 0;background:#2a2a40;';
                back.textContent = '← Retour'; back.onclick = () => startBattleSetup(bb.source, bb.qap ? 'qap' : bb.qt ? 'qt' : undefined);
                container.appendChild(back);
            }
        }


        /* ===================== CHRONO-QUIZ ===================== */
        let arcChronoQ = null, arcChronoSent = null;
        socket.on('arc_chrono_q', q => {
            arcChronoQ = q; arcChronoSent = null;
            if (arcState && arcState.game === 'chrono') arcRenderChrono(arcState, document.getElementById('arc-stage'));
        });
        function arcRenderChrono(q, stage) {
            if (q.phase !== 'playing') {
                const me = q.players.find(p => p.id === socket.id) || {};
                stage.innerHTML = `<div style="text-align:center;"><div style="font-size:3.5rem;">⏱️</div><div class="arc-ask">${me.progress || 0} bonne(s) réponse(s)</div></div>`;
                return;
            }
            const cq = arcChronoQ;
            if (!cq) { stage.innerHTML = '<div class="arc-loading"><div class="arc-spin"></div></div>'; return; }
            if (stage.__qid === cq.id) return;
            stage.__qid = cq.id;
            stage.innerHTML = '';
            const box = document.createElement('div'); box.style.cssText = 'width:100%;max-width:620px;';
            const top = document.createElement('div'); top.className = 'chrono-top';
            top.innerHTML = `<span>✅ ${cq.correct}</span><span>${cq.streak >= 2 ? '🔥 série x' + cq.streak : ''}</span>`;
            const t = document.createElement('div'); t.className = 'chrono-q'; t.textContent = cq.text;
            const grid = document.createElement('div'); grid.className = 'bt-choices';
            cq.choices.forEach(c => {
                const b = document.createElement('button'); b.className = 'bt-choice'; b.textContent = c;
                b.onclick = () => {
                    if (arcChronoSent === cq.id) return;
                    arcChronoSent = cq.id;
                    b.classList.add('picked');
                    socket.emit('arc_chrono', { roomCode: currentRoomCode, id: cq.id, choice: c });
                };
                grid.appendChild(b);
            });
            box.append(top, t, grid);
            stage.appendChild(box);
        }

        /* ===================== DRAFT 5V5 ===================== */
        function arcRenderDraft(q, stage) {
            const d = q.stage && q.stage.draft;
            if (!d) { stage.innerHTML = '<div class="arc-loading"><div class="arc-spin"></div><div>Préparation des cartes…</div></div>'; return; }
            const names = Object.fromEntries(q.players.map(p => [p.id, p.name]));
            const key = JSON.stringify([d.phase, d.turnId, Object.values(d.picks).map(x => x.length), d.votedCount, !!d.count, q.phase]);
            if (stage.__dkey === key) return;
            stage.__dkey = key;
            stage.innerHTML = '';
            const wrap = document.createElement('div'); wrap.style.width = '100%';
            if (d.phase === 'pick') {
                const grid = document.createElement('div'); grid.className = 'draft-grid';
                const myTurn = d.turnId === socket.id;
                d.pool.forEach((c, i) => {
                    const card = document.createElement('div');
                    card.className = 'draft-card' + (c.takenBy ? ' taken' : '') + (myTurn && !c.takenBy ? ' pickable' : '');
                    card.innerHTML = (c.img ? `<img src="${c.img}" alt="">` : '<div class="draft-ph">👤</div>') + '<div class="draft-name"></div>';
                    card.querySelector('.draft-name').textContent = c.takenBy ? `${c.name} • ${names[c.takenBy] || ''}` : c.name;
                    if (myTurn && !c.takenBy) card.onclick = () => { socket.emit('arc_draft_pick', { roomCode: currentRoomCode, idx: i }); card.classList.add('taken'); };
                    grid.appendChild(card);
                });
                wrap.appendChild(grid);
            }
            const teams = document.createElement('div'); teams.className = 'draft-teams';
            q.players.forEach(p => {
                const t = document.createElement('div'); t.className = 'draft-team' + (d.turnId === p.id ? ' turn' : '');
                const picks = (d.picks[p.id] || []).map(i => d.pool[i]).filter(Boolean);
                const h = document.createElement('div'); h.className = 'draft-team-head';
                const votes = d.count ? ` • ${d.count[p.id] || 0} vote(s)` : '';
                h.textContent = `${p.name}${p.id === socket.id ? ' (toi)' : ''} — ${picks.length}/${d.per}${votes}`;
                t.appendChild(h);
                const row = document.createElement('div'); row.className = 'draft-team-row';
                picks.forEach(c => { const im = document.createElement('div'); im.className = 'draft-mini'; im.innerHTML = (c.img ? `<img src="${c.img}" alt="">` : '<div class="draft-ph mini">👤</div>') + '<span></span>'; im.querySelector('span').textContent = c.name; row.appendChild(im); });
                t.appendChild(row);
                if (d.phase === 'vote' && (p.id !== socket.id || q.players.length <= 2)) {
                    const b = document.createElement('button'); b.className = 'btn-action'; b.style.cssText = 'margin:8px 0 0;padding:8px;'; b.textContent = '🗳️ Voter pour cette équipe';
                    b.onclick = () => { socket.emit('arc_draft_vote', { roomCode: currentRoomCode, target: p.id }); document.querySelectorAll('.draft-team .btn-action').forEach(x => x.disabled = true); b.textContent = '✅ Vote envoyé'; };
                    t.appendChild(b);
                }
                teams.appendChild(t);
            });
            wrap.appendChild(teams);
            stage.appendChild(wrap);
        }

        /* ===================== APRÈS CHAQUE RENDU ARCADE : sons, confettis, stream, défi ===================== */
        let arcFxKey = '';
        function arcAfterRender(q, me) {
            const k = q.round + '|' + q.phase;
            if (k !== arcFxKey) {
                arcFxKey = k;
                if (q.phase === 'reveal' && q.answerType !== 'bac') {
                    if (me.gained) fxGood(); else if (!me.eliminated) fxBad();
                    if (dailyMode === 'pixel') dailyTrack.push(!!me.gained);
                }
                if (q.phase === 'finished' && !q.message) {
                    if ((q.winnerNames || []).includes(me.name)) confetti();
                    if (dailyMode === 'pixel') dailyShowShare('pixel', { score: me.score, marks: dailyTrack.slice() });
                }
            }
            // Mode streamer : sondage du chat sur les réponses à choix
            if (q.phase === 'playing' && q.answerType === 'choice' && q.choices) streamPoll('arc|' + q.round + '|' + q.game, q.choices);
            else if (q.phase === 'reveal' && q.choices) streamPollReveal(q.answer);
            else streamPoll(null);
        }

        /* ===================== EFFETS : sons + confettis + toasts ===================== */
        function fxGood() { try { if (typeof sfxValide === 'function' && sfxOn) sfxValide(); } catch (_) {} }
        function fxBad() { try { if (typeof sfxErreur === 'function' && sfxOn) sfxErreur(); } catch (_) {} }
        function confetti(ms = 2600) {
            const c = document.getElementById('fx-confetti');
            if (!c) return;
            const ctx = c.getContext('2d');
            c.width = innerWidth; c.height = innerHeight; c.style.display = 'block';
            const colors = ['#ffe600', '#00f0ff', '#ff2a5f', '#00ff88', '#ffffff'];
            const parts = Array.from({ length: 160 }, () => ({ x: Math.random() * c.width, y: -20 - Math.random() * c.height * .5, vx: (Math.random() - .5) * 4, vy: 2 + Math.random() * 4, r: 4 + Math.random() * 6, a: Math.random() * 6, va: (Math.random() - .5) * .3, col: colors[Math.floor(Math.random() * colors.length)] }));
            const t0 = performance.now();
            const step = t => {
                ctx.clearRect(0, 0, c.width, c.height);
                parts.forEach(p => { p.x += p.vx; p.y += p.vy; p.vy += .05; p.a += p.va; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.fillStyle = p.col; ctx.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2); ctx.restore(); });
                if (t - t0 < ms) requestAnimationFrame(step); else { ctx.clearRect(0, 0, c.width, c.height); c.style.display = 'none'; }
            };
            requestAnimationFrame(step);
        }
        function toast(html, color) {
            const box = document.getElementById('fx-toasts');
            if (!box) return;
            const t = document.createElement('div'); t.className = 'fx-toast'; t.innerHTML = html;
            if (color) t.style.borderColor = color;
            box.appendChild(t);
            setTimeout(() => t.classList.add('out'), 3600);
            setTimeout(() => t.remove(), 4200);
        }
        socket.on('xp_gain', d => {
            if (!d) return;
            toast(`⭐ <b>+${d.xp} XP</b>`, 'var(--accent-cyan)');
            (d.badges || []).forEach((b, i) => setTimeout(() => { toast(`🏅 Badge débloqué : <b>${b.name}</b><br><small>${b.desc}</small>`, 'var(--accent-yellow)'); confetti(1500); }, 600 + i * 900));
        });

        /* Confettis + sons dans les autres modes */
        socket.on('bt_state', q => {
            if (!q) return;
            const me = (q.players || []).find(p => p.id === socket.id) || {};
            const k = 'bt|' + q.round + '|' + q.phase;
            if (window.__btFx === k) return;
            window.__btFx = k;
            if (q.phase === 'reveal') { if (me.correct) fxGood(); else fxBad(); if (dailyMode === 'blindtest') dailyTrack.push(!!me.correct); streamPollReveal(q.answer); }
            if (q.phase === 'playing') streamPoll('bt|' + q.round + '|' + (q.key || ''), q.choices || []);
            if (q.phase === 'finished') {
                streamPoll(null);
                if ((q.winnerNames || []).includes(me.name)) confetti();
                if (dailyMode === 'blindtest') dailyShowShare('blindtest', { score: me.score, marks: dailyTrack.slice() });
            }
        });
        socket.on('dle_state', room => {
            const d = room && room.dle;
            if (!d || !d.finished || window.__dleFx === d.targetName + d.guesses.length) return;
            window.__dleFx = d.targetName + d.guesses.length;
            if (d.winnerId === socket.id) { confetti(); fxGood(); }
            if (dailyMode === 'dle') dailyShowShare('dle', { attempts: d.guesses.length, guesses: d.guesses, universe: d.universeName, won: d.winnerId === socket.id });
        });
        socket.on('rg_game_over', data => {
            const w = data?.room?.rg?.winnerName;
            if (w && currentUser && w === currentUser.pseudo) confetti();
        });

        /* ===================== DÉFI DU JOUR ===================== */
        let dailyMode = null, dailyTrack = [], dailyData = null, dailyPendingStart = false;
        async function loadDaily() {
            try {
                const r = await fetch('/api/daily', { headers: authToken ? { Authorization: 'Bearer ' + authToken } : {} });
                dailyData = await r.json();
            } catch (e) { return; }
            const d = dailyData;
            const set = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
            set('daily-dle-sub', d.played?.dle ? `✅ ${d.played.dle.attempts} essais • #${d.played.dle.rank}` : `Univers : ${d.dleUniverseName}`);
            set('daily-bt-sub', d.played?.blindtest ? `✅ ${d.played.blindtest.score} pts • #${d.played.blindtest.rank}` : '5 musiques');
            set('daily-px-sub', d.played?.pixel ? `✅ ${d.played.pixel.score} pts • #${d.played.pixel.rank}` : '5 persos');
            ['dle', 'bt', 'px'].forEach(k => { const b = document.getElementById('daily-btn-' + k); const g = { dle: 'dle', bt: 'blindtest', px: 'pixel' }[k]; if (b) b.classList.toggle('done', !!d.played?.[g]); });
            dailyCountdown();
            const board = document.getElementById('daily-board');
            if (board && board.style.display !== 'none') renderDailyBoard();
        }
        let dailyCdTimer = null;
        function dailyCountdown() {
            if (!dailyData) return;
            const end = Date.now() + dailyData.nextInMs;
            clearInterval(dailyCdTimer);
            const tick = () => {
                const left = Math.max(0, end - Date.now());
                const h = Math.floor(left / 3600000), m = Math.floor(left / 60000) % 60, s2 = Math.floor(left / 1000) % 60;
                const el = document.getElementById('daily-countdown');
                if (el) el.textContent = `Nouveau défi dans ${h}h${String(m).padStart(2, '0')}m${String(s2).padStart(2, '0')}s`;
                if (left <= 0) { clearInterval(dailyCdTimer); loadDaily(); }
            };
            tick(); dailyCdTimer = setInterval(tick, 1000);
        }
        function toggleDailyBoard() {
            const b = document.getElementById('daily-board');
            b.style.display = b.style.display === 'none' ? 'block' : 'none';
            if (b.style.display === 'block') renderDailyBoard();
        }
        function renderDailyBoard() {
            const b = document.getElementById('daily-board');
            if (!dailyData) { b.textContent = 'Chargement…'; return; }
            const col = (title, rows, fmt) => `<div class="daily-col"><b>${title}</b>${rows.length ? rows.map((r, i) => `<div class="daily-row"><span>${i + 1}. ${escHtml(r.pseudo)}</span><span>${fmt(r)}</span></div>`).join('') : '<div class="daily-row"><span>Personne encore…</span></div>'}</div>`;
            b.innerHTML = col('🎴 DLE', dailyData.boards.dle || [], r => `${r.attempts} essais`) + col('🎧 Blind test', dailyData.boards.blindtest || [], r => `${r.score} pts`) + col('🖼️ Pixel', dailyData.boards.pixel || [], r => `${r.score} pts`);
        }
        function escHtml(s) { return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
        function startDaily(game) {
            dailyMode = game; dailyTrack = []; dailyPendingStart = true;
            if (currentUser && currentUser.isGuest) toast('ℹ️ En invité, ton score ne compte pas dans le classement du jour.', 'var(--accent-pink)');
            if (game === 'dle') createRoom('dle', 'daily');
            else if (game === 'blindtest') createRoom('blindtest', 'daily');
            else createRoom('arcade', 'pixel:daily');
        }
        // Lancement automatique du défi (pas besoin de passer par le salon)
        socket.on('update_room', room => {
            if (!dailyPendingStart || !room || room.code !== currentRoomCode || room.host !== socket.id) return;
            dailyPendingStart = false;
            setTimeout(() => socket.emit('start_game', currentRoomCode), 150);
        });
        function dailyShowShare(game, info) {
            const day = (dailyData && dailyData.day) || new Date().toISOString().slice(0, 10);
            const [y, m, d] = day.split('-');
            let txt = `🎌 Anime Game — Défi du ${d}/${m}\n`;
            if (game === 'dle') {
                txt += `🎴 AnimeDLE (${info.universe}) : ${info.won ? `trouvé en ${info.attempts} essai${info.attempts > 1 ? 's' : ''}` : 'raté'}\n`;
                (info.guesses || []).slice(0, 8).forEach(g => { txt += Object.values(g.attrs || {}).map(a => a.match ? '🟩' : a.close ? '🟨' : '🟥').join('') + (g.correct ? ' ✅' : '') + '\n'; });
            } else {
                const label = game === 'blindtest' ? '🎧 Blind test' : '🖼️ Pixel';
                const ok = info.marks.filter(Boolean).length;
                txt += `${label} : ${ok}/${info.marks.length} ${info.marks.map(x => x ? '✅' : '❌').join('')} (${info.score} pts)\n`;
            }
            txt += location.origin;
            dailyMode = null;
            setTimeout(() => {
                const box = document.getElementById('fx-share');
                box.querySelector('pre').textContent = txt;
                box.style.display = 'flex';
                loadDaily();
            }, 1200);
        }
        function copyShare() {
            const txt = document.querySelector('#fx-share pre').textContent;
            const done = () => toast('📋 Résultat copié : colle-le où tu veux !', 'var(--accent-cyan)');
            if (navigator.share && /Mobi/i.test(navigator.userAgent)) navigator.share({ text: txt }).catch(() => {});
            else if (navigator.clipboard) navigator.clipboard.writeText(txt).then(done).catch(() => prompt('Copie :', txt));
            else prompt('Copie :', txt);
        }

        /* ===================== PROFIL, BADGES, CLASSEMENTS ===================== */
        async function loadProfile() {
            const box = document.getElementById('prog-box');
            if (!box) return;
            if (!authToken || (currentUser && currentUser.isGuest)) { box.innerHTML = '<p class="tl-hint">Crée un compte pour gagner de l\'XP, des badges et apparaître dans les classements.</p>'; return; }
            let d = null;
            try { d = await (await fetch('/api/profile', { headers: { Authorization: 'Bearer ' + authToken } })).json(); } catch (e) {}
            if (!d || !d.ok) { box.innerHTML = '<p class="tl-hint">Profil indisponible pour le moment.</p>'; return; }
            const L = d.level, pct = Math.round(100 * (L.xp - L.cur) / Math.max(1, L.next - L.cur));
            box.innerHTML = `
                <div class="prog-level"><span>Niveau <b>${L.level}</b></span><span>${L.xp} XP</span></div>
                <div class="prog-bar"><div style="width:${pct}%"></div></div>
                <div class="tl-hint" style="text-align:left;">Encore ${L.next - L.xp} XP pour le niveau ${L.level + 1}</div>
                <div class="rg-stat-row" style="margin-top:12px;">
                    <div class="rg-stat"><div class="rg-stat-label">PARTIES</div><div class="rg-stat-value">${d.stats.games}</div></div>
                    <div class="rg-stat"><div class="rg-stat-label">VICTOIRES</div><div class="rg-stat-value" style="color:#00ff88;">${d.stats.wins}</div></div>
                    <div class="rg-stat cyan"><div class="rg-stat-label">DÉFIS</div><div class="rg-stat-value">${d.stats.daily}</div></div>
                </div>
                <h3 style="margin:16px 0 8px;color:var(--accent-yellow);">🏅 Badges (${d.badges.filter(b => b.earned).length}/${d.badges.length})</h3>
                <div class="badge-grid">${d.badges.map(b => `<div class="badge ${b.earned ? 'on' : ''}" title="${escHtml(b.desc)}"><b>${b.earned ? '🏅' : '🔒'} ${escHtml(b.name)}</b><small>${escHtml(b.desc)}</small></div>`).join('')}</div>
                <h3 style="margin:16px 0 8px;color:var(--accent-yellow);">📊 Par mode</h3>
                ${d.stats.modes.length ? d.stats.modes.map(m => `<div class="daily-row"><span>${escHtml(m.label)}</span><span>${m.games} parties • ${m.wins} V • record ${m.best}</span></div>`).join('') : '<p class="tl-hint">Joue une partie pour voir tes stats !</p>'}
                ${d.stats.universes.length ? `<h3 style="margin:16px 0 8px;color:var(--accent-yellow);">🌍 Univers préférés</h3>` + d.stats.universes.slice(0, 8).map(u => `<div class="daily-row"><span>${escHtml(u.name)}</span><span>${u.games} parties</span></div>`).join('') : ''}`;
        }
        let lbPeriod = 'week', lbMode = '';
        async function loadLeaderboard() {
            const box = document.getElementById('lb-box');
            if (!box) return;
            box.innerHTML = '<div class="arc-loading" style="padding:14px;"><div class="arc-spin"></div></div>';
            let d = null;
            try { d = await (await fetch(`/api/leaderboard?period=${lbPeriod}&mode=${encodeURIComponent(lbMode)}`)).json(); } catch (e) {}
            const sel = document.getElementById('lb-mode');
            if (d && sel && sel.options.length <= 1) {
                Object.entries(d.modes || {}).sort((a, b) => a[1].localeCompare(b[1], 'fr')).forEach(([k, v]) => {
                    const o = document.createElement('option'); o.value = k; o.textContent = v; sel.appendChild(o);
                });
                sel.value = lbMode;
            }
            const cur = document.getElementById('lb-current');
            if (cur && d) cur.textContent = (lbMode ? '🎮 ' : '🌍 ') + (d.label || 'Classement global');
            if (!d || !d.rows || !d.rows.length) { box.innerHTML = '<p class="tl-hint">Pas encore de parties enregistrées pour ce jeu sur cette période.</p>'; return; }
            box.innerHTML = d.rows.map((r, idx) => {
                const pos = ['🥇', '🥈', '🥉'][idx] || (idx + 1) + '.';
                const mine = currentUser && r.pseudo === currentUser.pseudo ? ' me' : '';
                const right = lbMode
                    ? `<b>${r.wins} V</b> • ${r.games} parties • ${r.winrate}% • ${r.points} pts`
                    : `<b>${r.points} pts</b> • ${r.wins} V • ${r.games} parties`;
                return `<div class="daily-row${mine}"><span>${pos} ${escHtml(r.pseudo)}</span><span>${right}</span></div>`;
            }).join('');
        }
        function setLbMode(mode) {
            lbMode = mode || '';
            const sel = document.getElementById('lb-mode');
            if (sel && sel.value !== lbMode) sel.value = lbMode;
            loadLeaderboard();
        }
        function setLbPeriod(p) {
            lbPeriod = p;
            document.querySelectorAll('#options .lb-tab[data-p="week"], #options .lb-tab[data-p="all"]').forEach(b => b.classList.toggle('on', b.dataset.p === p));
            loadLeaderboard();
        }
        // Chargement quand on ouvre l'onglet Options
        (function () {
            const orig = window.switchTab;
            if (typeof orig === 'function') window.switchTab = function (t) { const r = orig.apply(this, arguments); if (t === 'options') { loadProfile(); loadLeaderboard(); loadHallOfFame(); } return r; };
        })();
        socket.on('profile_updated', () => { const o = document.getElementById('options'); if (o && o.classList.contains('active')) loadProfile(); });

        /* ===================== RÉACTIONS EN PARTIE ===================== */
        function sendReaction(e) { if (currentRoomCode) socket.emit('reaction', { roomCode: currentRoomCode, emoji: e }); }
        socket.on('reaction', d => {
            const layer = document.getElementById('fx-reactions');
            if (!layer || !d) return;
            const el = document.createElement('div'); el.className = 'fx-react';
            el.style.left = (8 + Math.random() * 70) + '%';
            el.innerHTML = `<span class="e">${d.emoji}</span><span class="n"></span>`;
            el.querySelector('.n').textContent = d.name;
            layer.appendChild(el);
            setTimeout(() => el.remove(), 2800);
        });
        setInterval(() => {
            const bar = document.getElementById('fx-react-bar');
            if (!bar) return;
            const inRoom = !!currentRoomCode && ['waiting-room', 'arcade-room', 'blindtest-room', 'dle-room', 'rg-room', 'quote-room', 'gameplay-room', 'connexion-room', 'enchere-room', 'enchereaveugle-room', 'draw-room', 'guess-room', 'chaine-room', 'lg-room', 'uq-room']
                .some(id => { const el = document.getElementById(id); return el && el.offsetParent !== null; });
            bar.style.display = inRoom ? 'flex' : 'none';
        }, 700);

        /* ===================== LIEN D'INVITATION ===================== */
        function copyInviteLink() {
            if (!currentRoomCode) return;
            const url = `${location.origin}${location.pathname}?join=${encodeURIComponent(currentRoomCode)}`;
            const done = () => toast('🔗 Lien copié ! Envoie-le à tes potes.', 'var(--accent-cyan)');
            if (navigator.share && /Mobi/i.test(navigator.userAgent)) navigator.share({ title: 'Anime Game', text: 'Rejoins mon salon Anime Game !', url }).catch(() => {});
            else if (navigator.clipboard) navigator.clipboard.writeText(url).then(done).catch(() => prompt('Copie le lien :', url));
            else prompt('Copie le lien :', url);
        }
        const pendingJoin = (new URLSearchParams(location.search).get('join') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
        let pendingJoinDone = false;
        socket.on('connect', () => {
            if (!pendingJoin || pendingJoinDone || currentRoomCode) return;
            pendingJoinDone = true;
            history.replaceState(null, '', location.pathname);
            currentRoomCode = pendingJoin;
            socket.emit('join_room', { roomCode: pendingJoin, username: getUsername(), mode: 'undercover', subMode: 'normal' });
        });
        socket.on('connect', () => { loadDaily(); });

        /* ===================== THÈME CLAIR / SOMBRE ===================== */
        function applyTheme(t) {
            document.documentElement.classList.toggle('light', t === 'light');
            const b = document.getElementById('theme-btn');
            if (b) b.textContent = t === 'light' ? '🌙 Passer en sombre' : '☀️ Passer en clair';
        }
        function toggleTheme() {
            const t = document.documentElement.classList.contains('light') ? 'dark' : 'light';
            try { localStorage.setItem('theme', t); } catch (e) {}
            applyTheme(t);
        }
        try { applyTheme(localStorage.getItem('theme') || 'dark'); } catch (e) {}

        /* ===================== MODE STREAMER : votes du chat Twitch ===================== */
        const stream = { platform: 'twitch', ws: null, channel: '', key: null, labels: [], votes: new Map(), revealed: null, t0: 0, answered: false, board: {}, lastGain: {}, rounds: 0 };
        function streamBoardLoad() { try { stream.board = JSON.parse(localStorage.getItem('stream_board_' + stream.channel) || '{}') || {}; } catch (e) { stream.board = {}; } }
        function streamBoardSave() { try { localStorage.setItem('stream_board_' + stream.channel, JSON.stringify(stream.board)); } catch (e) {} }
        const streamIsTiktok = () => !!(stream.ws ? stream.ws.tiktok : stream.platform === 'tiktok');
        const streamChatName = () => streamIsTiktok() ? 'TikTok' : 'Twitch';
        function streamSetPlatform(pf) {
            stream.platform = pf === 'tiktok' ? 'tiktok' : 'twitch';
            try { localStorage.setItem('stream_platform', stream.platform); } catch (e) {}
            document.querySelectorAll('#stream-platforms button').forEach(b => b.classList.toggle('on', b.dataset.p === stream.platform));
            const i = document.getElementById('stream-channel');
            if (i) { i.placeholder = stream.platform === 'tiktok' ? 'Ton pseudo TikTok (ex : @jordan_jrc)' : 'Nom de ta chaîne (ex : jordan_jrc)'; try { i.value = localStorage.getItem('stream_channel_' + stream.platform) || ''; } catch (e) {} }
        }
        function streamConnect() {
            const input = document.getElementById('stream-channel');
            const tt = stream.platform === 'tiktok';
            const ch = String(input.value || '').trim().toLowerCase().replace(/^[#@]/, '').replace(tt ? /[^a-z0-9_.]/g : /[^a-z0-9_]/g, '');
            if (!ch) return;
            streamDisconnect();
            try { localStorage.setItem('stream_channel_' + stream.platform, ch); if (!tt) localStorage.setItem('stream_channel', ch); } catch (e) {}
            stream.channel = tt ? 'tiktok_' + ch : ch;
            if (tt) {
                streamBoardLoad();
                stream.manual = false;
                // pas de chat TikTok lisible depuis le navigateur : le serveur se connecte au live et nous relaie les messages
                stream.ws = { tiktok: true, user: ch, close() { socket.emit('tiktok_disconnect'); } };
                socket.emit('tiktok_connect', { username: ch });
                streamStatus(`Connexion au live de @${ch}…`);
                document.getElementById('stream-widget').style.display = 'block';
                document.getElementById('stream-widget').style.borderColor = '#fe2c55';
                streamRender();
                return;
            }
            stream.channel = ch;
            streamBoardLoad();
            stream.manual = false; stream.retry = 0;
            streamOpen(ch);
            document.getElementById('stream-widget').style.display = 'block';
            document.getElementById('stream-widget').style.borderColor = '';
            streamRender();
        }
        function streamOpen(ch) {
            const ws = new WebSocket('wss://irc-ws.chat.twitch.tv:443');
            stream.ws = ws;
            streamStatus('Connexion au chat…');
            ws.onopen = () => {
                ws.send('CAP REQ :twitch.tv/tags');
                ws.send('PASS SCHMOOPIIE');
                ws.send('NICK justinfan' + Math.floor(10000 + Math.random() * 80000));
                ws.send('JOIN #' + ch);
            };
            ws.onmessage = ev => String(ev.data).split('\r\n').forEach(line => {
                if (!line) return;
                if (line.startsWith('PING')) { ws.send('PONG :tmi.twitch.tv'); return; }
                if (line.startsWith(':tmi.twitch.tv RECONNECT') || line === 'RECONNECT') { try { ws.close(); } catch (e) {} return; }
                if (line.includes(' 366 ') || line.includes('JOIN #' + ch)) { stream.retry = 0; streamStatus(`✅ Connecté au chat de ${ch} — les viewers votent avec !1 !2 !3 !4`); }
                const m = line.match(/:([^!\s]+)![^\s]+ PRIVMSG #[^\s]+ :(.*)$/);
                if (!m) return;
                const dn = (line.match(/(?:^@|;)display-name=([^;\s]*)/) || [])[1];
                streamVote(m[1], m[2].trim(), dn ? dn.replace(/\\s/g, ' ') : m[1]);
                try { streamDrawGuess(m[1], m[2].trim(), dn ? dn.replace(/\\s/g, ' ') : m[1]); } catch (e) {}
            });
            ws.onclose = () => {
                if (stream.ws !== ws || stream.manual) return;
                // coupure (Wi-Fi, maintenance Twitch…) : on se reconnecte tout seul, sans perdre le classement
                stream.retry = (stream.retry || 0) + 1;
                const wait = Math.min(15000, 1000 * Math.pow(2, stream.retry - 1));
                streamStatus(`⚠️ Chat coupé, reconnexion dans ${Math.round(wait / 1000)} s…`);
                clearTimeout(stream.retryT);
                stream.retryT = setTimeout(() => { if (stream.ws === ws && !stream.manual) streamOpen(ch); }, wait);
            };
            ws.onerror = () => streamStatus('❌ Impossible de joindre le chat Twitch, nouvel essai…');
        }
        function streamDisconnect() {
            stream.manual = true; clearTimeout(stream.retryT);
            if (stream.ws) { try { stream.ws.close(); } catch (e) {} }
            stream.ws = null;
            streamStatus('Mode streamer désactivé.');
            const w = document.getElementById('stream-widget'); if (w) w.style.display = 'none';
            streamDecorate();
        }
        function streamStatus(t) { const el = document.getElementById('stream-status'); if (el) el.textContent = t; }
        socket.on('tiktok_chat', m => {
            if (!m || !stream.ws || !stream.ws.tiktok) return;
            streamVote(m.user, m.text, m.name);
            try { streamDrawGuess(m.user, m.text, m.name); } catch (e) {}
        });
        socket.on('tiktok_status', s => { if (s && stream.ws && stream.ws.tiktok) streamStatus(s.text); });
        // le serveur a redémarré ou la connexion a sauté : on relance la lecture du live
        socket.on('connect', () => { if (stream.ws && stream.ws.tiktok) socket.emit('tiktok_connect', { username: stream.ws.user }); });
        const streamIsBattle = () => String(stream.key || '').startsWith('bb|');
        function streamVote(user, msg, display) {
            if (!stream.key || stream.revealed) return;
            let m = msg.match(/^!?\s*([1-9])\b/);
            let idx = m ? Number(m[1]) - 1 : -1;
            if (idx < 0) { m = msg.match(/^!([a-dA-D])\b/); if (m) idx = m[1].toLowerCase().charCodeAt(0) - 97; }
            if (idx < 0 || idx >= stream.labels.length) return;
            // comme Kahoot : seule la 1re réponse compte (sauf battle d'openings où on peut changer d'avis)
            if (stream.votes.has(user) && !streamIsBattle()) return;
            stream.votes.set(user, { idx, t: Date.now(), name: display || user });
            streamRender();
        }
        function streamPoll(key, labels) {
            if (!stream.ws) return;
            if (key === null) { if (stream.key && !stream.revealed) { stream.key = null; streamRender(); } return; }
            if (stream.key === key) return;
            stream.key = key; stream.labels = labels.slice(0, 9); stream.votes = new Map(); stream.revealed = null;
            stream.t0 = Date.now(); stream.answered = streamIsBattle(); stream.lastGain = {};
            streamRender();
        }
        // Points façon Kahoot : 1000 max, moitié perdue si on répond à la toute fin, + bonus de série
        function streamPollReveal(answer) {
            if (!stream.ws || !stream.key || stream.revealed) return;
            stream.revealed = answer || '—';
            stream.answered = true;
            if (!streamIsBattle()) {
                stream.rounds++;
                const dur = 20000;
                stream.votes.forEach((v, user) => {
                    const e = stream.board[user] || (stream.board[user] = { name: v.name, pts: 0, good: 0, streak: 0 });
                    e.name = v.name;
                    if (stream.labels[v.idx] === stream.revealed) {
                        e.streak++; e.good++;
                        const speed = Math.max(0, Math.min(1, (v.t - stream.t0) / dur));
                        const gain = Math.round(1000 * (1 - speed / 2)) + Math.min(500, 100 * (e.streak - 1));
                        e.pts += gain; stream.lastGain[user] = gain;
                    } else e.streak = 0;
                });
                streamBoardSave();
            }
            streamRender();
        }
        function streamTop(n) {
            return Object.entries(stream.board).sort((a, b) => b[1].pts - a[1].pts).slice(0, n);
        }
        function streamResetBoard() { stream.board = {}; stream.rounds = 0; streamBoardSave(); streamRender(); toast('🔄 Classement du chat remis à zéro', '#9146FF'); }
        function streamPct() {
            const counts = stream.labels.map(() => 0);
            stream.votes.forEach(v => counts[v.idx]++);
            const total = stream.votes.size;
            return { counts, total, pct: counts.map(c => total ? Math.round(100 * c / total) : 0) };
        }
        function streamRender() {
            const w = document.getElementById('stream-widget');
            if (!w || !stream.ws) { streamDecorate(); return; }
            const body = document.getElementById('stream-body');
            const tools = `<div class="sv-tools"><button onclick="streamShowFinal()">🏆 Classement</button><button onclick="streamResetBoard()">🔄 Remettre à 0</button></div>`;
            let lbHtml = '';
            const top = streamTop(5);
            if (top.length && (stream.revealed || !stream.key)) {
                lbHtml = '<div class="sv-lb">' + top.map(([u, e], i) =>
                    `<div class="sv-lb-row"><span>${['🥇', '🥈', '🥉'][i] || (i + 1) + '.'} ${escHtml(e.name)} ${stream.lastGain[u] ? `<em>+${stream.lastGain[u]}</em>` : ''}</span><b>${e.pts}</b></div>`).join('') + '</div>';
            }
            if (!stream.key) { body.innerHTML = '<div class="tl-hint">En attente d\'une question…</div>' + lbHtml + tools; streamDecorate(); return; }
            const { pct, total } = streamPct();
            if (!stream.answered) {
                // le streamer n'a pas encore répondu : on cache les % pour ne pas l'influencer
                body.innerHTML = `<div class="tl-hint" style="font-size:.85rem;">🔒 ${total} vote(s) du chat<br>Réponds pour voir leurs choix !</div>` + tools;
            } else {
                body.innerHTML = stream.labels.map((l, i) => {
                    const good = stream.revealed && l === stream.revealed;
                    return `<div class="sv-row${good ? ' good' : ''}"><div class="sv-bar" style="width:${pct[i]}%"></div><span>!${i + 1} ${escHtml(l)}</span><b>${pct[i]}%</b></div>`;
                }).join('') + `<div class="tl-hint">${total} vote(s) du chat${stream.revealed && !streamIsBattle() ? ' • réponse : ' + escHtml(stream.revealed) : ''}</div>` + lbHtml + tools;
            }
            streamDecorate();
        }
        // Affiche le % du chat directement sur les boutons de réponse, et sous chaque opening en battle
        function streamDecorate() {
            const on = !!(stream.ws && stream.key);
            const { pct } = on ? streamPct() : { pct: [] };
            document.querySelectorAll('#arc-choices .bt-choice, #bt-choices .bt-choice').forEach(b => {
                const i = on && !streamIsBattle() ? stream.labels.indexOf(b.textContent) : -1;
                if (i >= 0 && stream.answered) { if (b.dataset.sv !== pct[i] + '%') b.dataset.sv = pct[i] + '%'; b.style.setProperty('--sv', pct[i] + '%'); }
                else if (b.dataset.sv !== undefined) { delete b.dataset.sv; b.style.removeProperty('--sv'); }
            });
            document.querySelectorAll('.bb-chatpct').forEach(el => {
                const i = Number(el.dataset.i);
                if (!on || !streamIsBattle()) { el.style.display = 'none'; return; }
                el.style.display = '';
                const v = pct[i] || 0;
                const html = `<i style="width:${v}%"></i><span>💬 Chat : ${v}%</span>`;
                if (el.innerHTML !== html) el.innerHTML = html;
            });
        }
        // Le streamer a cliqué une réponse → on dévoile les % du chat
        document.addEventListener('click', e => {
            const b = e.target.closest && e.target.closest('#arc-choices .bt-choice, #bt-choices .bt-choice');
            if (!b || !stream.ws || !stream.key || stream.answered) return;
            stream.answered = true;
            setTimeout(streamRender, 0);
        }, true);
        // Les boutons sont recréés à chaque état : on remet les % dessus
        (function () {
            let raf = 0;
            const mo = new MutationObserver(() => { if (!stream.ws || raf) return; raf = requestAnimationFrame(() => { raf = 0; streamDecorate(); }); });
            const start = () => ['arc-choices', 'bt-choices'].forEach(id => { const el = document.getElementById(id); if (el) mo.observe(el, { childList: true }); });
            if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
        })();
        // Classement final du chat (façon Kahoot)
        function streamShowFinal() {
            document.getElementById('stream-final')?.remove();
            const top = streamTop(10);
            const ov = document.createElement('div'); ov.id = 'stream-final';
            const pod = [top[1], top[0], top[2]];
            const cols = ['#c0c0d0', '#ffd700', '#cd7f32'], hs = [90, 125, 70];
            const podium = top.length ? `<div class="sf-podium">${pod.map((x, i) => x ? `<div class="sf-step" style="background:${cols[i]};color:#111;height:${hs[i]}px;animation-delay:${[.3, .6, 0][i]}s"><div style="font-size:1.4rem">${['🥈', '🥇', '🥉'][i]}</div><div class="n">${escHtml(x[1].name)}</div><div class="s">${x[1].pts} pts</div></div>` : '<div></div>').join('')}</div>` : '<p class="tl-hint">Aucun vote du chat pour l\'instant.</p>';
            const rest = top.slice(3).map(([u, e], i) => `<div class="sf-row"><span>${i + 4}. ${escHtml(e.name)}</span><b style="color:var(--accent-yellow)">${e.pts} pts</b></div>`).join('');
            ov.innerHTML = `<div class="sf-box"><div class="sf-title">🏆 Classement du chat</div><div class="tl-hint">${Object.keys(stream.board).length} viewer(s) • bonne réponse = jusqu'à 1000 pts selon la rapidité, + bonus de série</div>${podium}${rest}<div class="sv-tools" style="margin-top:12px;"><button onclick="document.getElementById('stream-final').remove()">Fermer</button><button onclick="streamResetBoard();document.getElementById('stream-final').remove()">🔄 Nouveau classement</button></div></div>`;
            ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
            document.body.appendChild(ov);
            if (top.length) confetti(2000);
        }
        let streamFinalKey = '';
        function streamFinal(key) {
            if (!stream.ws || streamFinalKey === key || !Object.keys(stream.board).length) return;
            streamFinalKey = key;
            setTimeout(streamShowFinal, 1200);
        }
        socket.on('arc_state', q => { if (q && q.phase === 'finished' && q.answerType === 'choice') streamFinal('arc|' + (q.totalRounds || '') + '|' + (q.startedAt || '') + '|' + currentRoomCode); });
        socket.on('bt_state', q => { if (q && q.phase === 'finished') streamFinal('bt|' + (q.round || '') + '|' + currentRoomCode + '|' + (q.totalRounds || '')); });
        try {
            const ch = localStorage.getItem('stream_channel'); if (ch && !localStorage.getItem('stream_channel_twitch')) localStorage.setItem('stream_channel_twitch', ch);
            setTimeout(() => streamSetPlatform(localStorage.getItem('stream_platform') || 'twitch'), 50);
        } catch (e) {}
        // Battle d'openings : le chat vote aussi (!1 gauche / !2 droite), % écrit sous chaque opening
        (function () {
            const orig = window.bbRenderDuel;
            if (typeof orig !== 'function') return;
            window.bbRenderDuel = function () {
                const r = orig.apply(this, arguments);
                try {
                    const duel = document.querySelector('#bb-body .bb-duel');
                    if (duel) duel.querySelectorAll(':scope > .bb-card').forEach((card, i) => {
                        const col = document.createElement('div'); col.className = 'bb-col';
                        card.replaceWith(col); col.appendChild(card);
                        const pc = document.createElement('div'); pc.className = 'bb-chatpct'; pc.dataset.i = i; pc.style.display = 'none';
                        col.appendChild(pc);
                    });
                    if (bb && bb.current) streamPoll('bb|' + bb.current.length + '|' + bb.idx + '|' + bb.duels.length, [bb.current[bb.idx], bb.current[bb.idx + 1]]);
                    streamDecorate();
                    bbAutoStart();
                } catch (e) {}
                return r;
            };
        })();
        // « Le chat décide » : en live, la majorité du chat (1 = gauche, 2 = droite) choisit toute seule après le compte à rebours
        const BB_AUTO_SEC = 15;
        const bbAuto = { on: (() => { try { return localStorage.getItem('bb_chat_auto') === '1'; } catch (e) { return false; } })(), t: null, left: 0 };
        function bbAutoClear() { clearInterval(bbAuto.t); bbAuto.t = null; }
        function bbAutoToggle() { bbAuto.on = !bbAuto.on; try { localStorage.setItem('bb_chat_auto', bbAuto.on ? '1' : '0'); } catch (e) {} bbRenderDuel(); }
        function bbAutoStart() {
            bbAutoClear();
            const box = document.getElementById('bb-body');
            const duel = box && box.querySelector('.bb-duel');
            if (!stream.ws || !bb || bb.done || !duel) return;
            const tools = duel.nextElementSibling;
            if (tools) {
                const btn = document.createElement('button'); btn.className = 'btn-action';
                btn.style.cssText = 'width:auto;margin:0;background:' + (bbAuto.on ? '#00c26e;color:#111' : '#2a2a40') + ';';
                btn.textContent = bbAuto.on ? `🎥 Le chat décide : ON (${BB_AUTO_SEC} s)` : '🎥 Le chat décide : OFF';
                btn.onclick = bbAutoToggle;
                tools.appendChild(btn);
            }
            if (!bbAuto.on) return;
            const cd = document.createElement('div'); cd.className = 'bb-autocd';
            const head = box.querySelector('.bb-head'); if (head) head.appendChild(cd);
            bbAuto.left = BB_AUTO_SEC;
            const key = stream.key;
            const tick = () => {
                const panel = document.getElementById('battle-room');
                if (!bb || bb.done || stream.key !== key || !document.body.contains(cd) || !panel || panel.style.display === 'none') return bbAutoClear();
                const { counts, total } = streamPct();
                if (bbAuto.left <= 0) {
                    if (total && counts[0] !== counts[1]) {
                        bbAutoClear();
                        const cards = box.querySelectorAll('.bb-duel .bb-card');
                        bbPick(counts[1] > counts[0] ? 1 : 0, cards[0], cards[1]);
                        return;
                    }
                    bbAuto.left = 5; // égalité ou aucun vote : on prolonge
                    cd.textContent = total ? '⚖️ Égalité ! 5 secondes de plus…' : '⏳ Personne n’a voté… 5 secondes de plus';
                    return;
                }
                cd.textContent = `⏱️ Le chat décide dans ${bbAuto.left} s • ${total} vote${total > 1 ? 's' : ''} • tapez 1 ou 2`;
                bbAuto.left--;
            };
            tick(); bbAuto.t = setInterval(tick, 1000);
        }

        tryAutoLogin();


        /* =====================================================================
           V7 : pseudos stylés, avatars, équipes, hôte, quêtes, historique, amis,
                propositions, Dessine le perso, Colorie le perso
           ===================================================================== */
        const v7esc = t => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
        const cosById = {};
        function cosNameHtml(name, cos) { return `<span class="cn cn-${v7esc((cos && cos.color) || 'default')}">${v7esc(name)}</span>${cos && cos.title ? `<small class="cn-title">${v7esc(cos.title)}</small>` : ''}`; }
        function avatarHtml(name, cos, big) {
            const fr = (cos && cos.frame) || 'none';
            const inner = cos && cos.avatar ? `<img src="${v7esc(cos.avatar)}" alt="" loading="lazy" decoding="async">` : v7esc(String(name || '?').charAt(0).toUpperCase());
            return `<span class="av fr-${v7esc(fr)}${big ? ' big' : ''}">${inner}</span>`;
        }
        function authHeaders(json) { const h = authToken ? { Authorization: 'Bearer ' + authToken } : {}; if (json) h['Content-Type'] = 'application/json'; return h; }
        async function v7get(url) { try { const r = await fetch(url, { headers: authHeaders() }); return await r.json(); } catch (e) { return null; } }
        async function v7post(url, body) { try { const r = await fetch(url, { method: 'POST', headers: authHeaders(true), body: JSON.stringify(body || {}) }); return await r.json(); } catch (e) { return null; } }
        const isAccount = () => !!authToken && !(currentUser && currentUser.isGuest);
        let lastHostId = null, lastRoomState = null;

        /* ---------- Salon d'attente : joueurs, équipes, tours de dessin ---------- */
        const TEAM_UI = [['Rouge', '#ff4d6d', '🔴'], ['Bleue', '#4da3ff', '🔵'], ['Verte', '#2ee88a', '🟢'], ['Jaune', '#ffd84d', '🟡']];
        function renderLobbyPlayers(room) {
            lastRoomState = room; lastHostId = room.host;
            const list = document.getElementById('waiting-players-list');
            if (!list) return;
            const iAmHost = room.host === socket.id;
            room.players.forEach(p => { cosById[p.id] = p.cos || null; });
            list.innerHTML = room.players.map(p => {
                const crown = p.id === room.host ? ' 👑' : '';
                const me = p.id === socket.id ? ' <span style="color:var(--text-muted);font-size:.8rem;">(toi)</span>' : '';
                const team = room.teams >= 2 && p.team != null ? `<span class="team-tag" style="background:${TEAM_UI[p.team][1]}">${TEAM_UI[p.team][2]}</span>` : '';
                const btns = iAmHost && p.id !== socket.id
                    ? `<button class="host-btn" onclick="transferHost('${p.id}', this)" title="Donner l'hôte">👑</button><button class="kick-btn" onclick="kickPlayer('${p.id}', this)" title="Exclure">✖ Exclure</button>`
                    : `<span style="color:#00ff88">Prêt</span>`;
                return `<li><span class="pl-name">${avatarHtml(p.name, p.cos)}${cosNameHtml(p.name, p.cos)}${crown}${me}${team}</span><span class="pl-btns">${btns}</span></li>`;
            }).join('');
            // équipes
            const tbox = document.getElementById('room-teams-box');
            const teamsOk = room.mode === 'arcade' || room.mode === 'blindtest';
            if (tbox) {
                tbox.style.display = teamsOk ? 'flex' : 'none';
                const sel = document.getElementById('room-teams-select'), txt = document.getElementById('room-teams-text');
                sel.value = String(room.teams || 0); sel.style.display = iAmHost ? '' : 'none';
                txt.textContent = iAmHost ? '' : (room.teams >= 2 ? room.teams + ' équipes' : 'Chacun pour soi');
            }
            const tl = document.getElementById('team-lobby');
            if (tl) {
                if (teamsOk && room.teams >= 2) {
                    const mine = (room.players.find(p => p.id === socket.id) || {}).team;
                    tl.style.display = 'grid';
                    tl.innerHTML = TEAM_UI.slice(0, room.teams).map(([n, c, ic], i) => `<div class="team-col" style="border-color:${c}"><h4 style="color:${c}">${ic} Équipe ${n}</h4>${room.players.filter(p => p.team === i).map(p => `<div>${cosNameHtml(p.name, p.cos)}</div>`).join('') || '<div class="tl-hint">Personne</div>'}${mine === i ? '' : `<button onclick="joinTeam(${i})">Rejoindre</button>`}</div>`).join('');
                } else { tl.style.display = 'none'; tl.innerHTML = ''; }
            }
            // tours de dessin
            const dbox = document.getElementById('room-draw-box');
            if (dbox) {
                dbox.style.display = room.mode === 'draw' || room.mode === 'guess' ? 'flex' : 'none';
                const sel = document.getElementById('room-draw-select'), txt = document.getElementById('room-draw-text');
                const defT = room.mode === 'guess' ? 1 : 2;
                dbox.querySelector('span').textContent = room.mode === 'guess' ? '🕵️ Tours (chacun fait deviner) :' : '✏️ Tours de dessin :';
                sel.value = String(room.drawTours || defT); sel.style.display = iAmHost ? '' : 'none';
                txt.textContent = iAmHost ? '' : (room.drawTours || defT) + ' tour(s)';
                const st = document.getElementById('room-draw-stream'), cb = document.getElementById('room-draw-stream-cb'), hint = document.getElementById('room-draw-stream-hint');
                const isDraw = room.mode === 'draw';
                if (st) st.style.display = isDraw && iAmHost ? 'flex' : 'none';
                if (cb) { cb.checked = !!room.drawStream; cb.disabled = !stream.ws && !room.drawStream; }
                if (isDraw && room.drawStream) {
                    dbox.querySelector('span').textContent = '🎥 Dessins (×5) :';
                    if (!iAmHost) txt.textContent = (room.drawTours || defT) * 5 + ' dessins';
                }
                if (hint) {
                    hint.style.display = isDraw ? '' : 'none';
                    hint.textContent = !isDraw ? '' : room.drawStream ? `Mode stream activé : ${(room.drawTours || defT) * 5} dessins, le 1er viewer qui écrit !nom du perso gagne 1 point. Tu peux jouer seul avec ton chat.`
                        : iAmHost && !stream.ws ? "Pour le mode stream, connecte d'abord ton chat dans Options → Mode streamer." : '';
                }
            }
            const inv = document.getElementById('invite-friend-btn');
            if (inv) inv.style.display = isAccount() ? '' : 'none';
        }
        function setTeams(v) { socket.emit('set_teams', { roomCode: currentRoomCode, teams: +v }); }
        function joinTeam(i) { socket.emit('join_team', { roomCode: currentRoomCode, team: i }); }
        function setDrawTours(v) { socket.emit('set_draw_tours', { roomCode: currentRoomCode, tours: +v }); }
        function setDrawStream(on) { socket.emit('set_draw_stream', { roomCode: currentRoomCode, on: !!on }); }
        function transferHost(id, btn) {
            if (!btn.classList.contains('armed')) {
                document.querySelectorAll('.host-btn.armed').forEach(b => { b.classList.remove('armed'); b.textContent = '👑'; });
                btn.classList.add('armed'); btn.textContent = 'Confirmer ?';
                setTimeout(() => { if (btn.isConnected && btn.classList.contains('armed')) { btn.classList.remove('armed'); btn.textContent = '👑'; } }, 3000);
                return;
            }
            btn.disabled = true;
            socket.emit('transfer_host', { roomCode: currentRoomCode, targetId: id });
        }
        socket.on('host_changed', d => { if (d) lastHostId = d.hostId; hostFabUpdate(); });

        /* ---------- Bouton hôte en pleine partie : exclure / donner l'hôte ---------- */
        const GAME_PANELS = ['gameplay-room', 'rg-room', 'enchere-room', 'enchereaveugle-room', 'connexion-room', 'dle-room', 'quote-room', 'blindtest-room', 'arcade-room', 'draw-room', 'guess-room', 'chaine-room', 'lg-room', 'uq-room'];
        function hostFabUpdate() {
            const fab = document.getElementById('host-fab');
            if (!fab) return;
            const inGame = !!currentRoomCode && GAME_PANELS.some(id => { const el = document.getElementById(id); return el && el.style.display !== 'none' && el.offsetParent !== null; });
            fab.style.display = inGame && lastHostId === socket.id ? 'block' : 'none';
        }
        setInterval(hostFabUpdate, 800);
        function openHostPanel() { socket.emit('room_players', { roomCode: currentRoomCode }); }
        socket.on('room_players', d => {
            if (!d || d.roomCode !== currentRoomCode) return;
            lastHostId = d.host;
            document.getElementById('v7-host-modal')?.remove();
            const m = document.createElement('div'); m.className = 'v7-modal'; m.id = 'v7-host-modal';
            m.innerHTML = `<div class="v7-box"><button class="v7-close" onclick="this.closest('.v7-modal').remove()">✕</button><h3>👥 Joueurs du salon</h3>
                ${d.players.map(p => `<div class="friend-row"><span class="pl-name">${avatarHtml(p.name, p.cos)}${cosNameHtml(p.name, p.cos)}${p.id === d.host ? ' 👑' : ''}${p.offline ? ' 📡' : ''}</span>
                ${p.id === socket.id ? '<span class="fs">toi</span>' : `<span class="pl-btns"><button class="host-btn" onclick="transferHost('${p.id}', this)">👑 Hôte</button><button class="kick-btn" onclick="kickPlayer('${p.id}', this)">✖ Exclure</button></span>`}</div>`).join('')}
                <p class="tl-hint">Appuie deux fois pour confirmer.</p></div>`;
            m.addEventListener('click', e => { if (e.target === m) m.remove(); });
            document.body.appendChild(m);
        });
        socket.on('update_room', r => { if (r && r.code === currentRoomCode) { lastHostId = r.host; lastRoomState = r; (r.players || []).forEach(p => { cosById[p.id] = p.cos || null; }); } });
        socket.on('kicked', () => { document.getElementById('v7-host-modal')?.remove(); });

        /* ---------- Scores en jeu : pseudos stylés + équipes ---------- */
        function v7DecorateBoard(boardId, q, sortKey) {
            const board = document.getElementById(boardId);
            if (!board || !q || !q.players) return;
            (q.players || []).forEach(p => { if (p.cos) cosById[p.id] = p.cos; });
            const sorted = [...q.players].sort((a, b) => b.score - a.score);
            [...board.children].forEach((row, i) => {
                const p = sorted[i];
                if (!p || row.dataset.v7 === p.id + '|' + row.textContent) return;
                const span = row.querySelector('span');
                if (span && (p.cos && p.cos.color && p.cos.color !== 'default')) span.classList.add('cn', 'cn-' + p.cos.color);
                if (p.team != null && q.teams) row.style.borderLeft = '4px solid ' + TEAM_UI[p.team][1];
                row.dataset.v7 = p.id + '|' + row.textContent;
            });
            let tb = document.getElementById(boardId + '-teams');
            if (!q.teams) { if (tb) tb.remove(); return; }
            if (!tb) { tb = document.createElement('div'); tb.id = boardId + '-teams'; tb.className = 'team-board'; board.parentNode.insertBefore(tb, board); }
            tb.innerHTML = q.teams.map((t, i) => `<span class="tb" style="border-color:${t.color};color:${t.color}">${i === 0 && t.score > 0 ? '👑 ' : ''}${t.icon} ${v7esc(t.name)} : ${t.score} pts</span>`).join('');
        }
        function v7TeamWinner(resultId, q) {
            if (!q || !q.teams || q.phase !== 'finished') return;
            const el = document.getElementById(resultId);
            if (!el) return;
            const key = 'tw|' + q.teams.map(t => t.score).join(',');
            el.style.color = 'var(--accent-yellow)';
            el.textContent = q.teamWinner ? `🏆 ${q.teamWinner} gagne la partie ! (${q.teams[0].score} pts)` : `🤝 Égalité entre les équipes !`;
            if (window.__v7tw !== key) {
                window.__v7tw = key;
                const me = q.players.find(p => p.id === socket.id);
                if (me && q.teamWinnerMembers && q.teamWinnerMembers.includes(me.name)) confetti();
            }
        }
        socket.on('arc_state', q => {
            if (!q) return;
            lastHostId = q.hostId;
            v7DecorateBoard('arc-scoreboard', q);
            v7TeamWinner('arc-result', q);
            if (q.game === 'couleur') colAfterRender(q);
        });
        socket.on('bt_state', q => {
            if (!q) return;
            lastHostId = q.hostId;
            v7DecorateBoard('bt-scoreboard', q);
            v7TeamWinner('bt-result', q);
        });

        /* ---------- Chat : pseudo stylé ---------- */
        socket.on('chat_message', d => {
            const box = document.getElementById('chat-messages');
            const cos = d && cosById[d.authorId];
            if (!box || !cos || !cos.color || cos.color === 'default') return;
            const line = box.lastElementChild;
            const span = line && line.querySelector('span');
            if (span) { span.classList.add('cn', 'cn-' + cos.color); span.style.color = ''; }
        });

        /* ---------- Réactions débloquées avec le niveau ---------- */
        let v7Emojis = [];
        const V7_EMOJIS = [['🥶', 2], ['🤡', 4], ['👀', 6], ['🍥', 9], ['⚡', 11], ['🫡', 14], ['🗿', 17], ['👑', 22]];
        function v7EmojisFromUser(u) {
            const lvl = (u && (u.level || (u.cos && u.cos.lvl))) || 1;
            v7Emojis = V7_EMOJIS.map(([emoji, need]) => ({ emoji, need, unlocked: lvl >= need }));
            v7RenderEmojiBar();
        }
        socket.on('connect', () => setTimeout(() => v7EmojisFromUser(currentUser), 300));
        socket.on('profile_updated', d => { if (d && d.user && currentUser && !currentUser.isGuest) { Object.assign(currentUser, d.user); v7EmojisFromUser(currentUser); } });
        function v7RenderEmojiBar() {
            const bar = document.getElementById('fx-react-bar');
            if (!bar) return;
            bar.querySelectorAll('.v7e').forEach(b => b.remove());
            v7Emojis.filter(e => e.unlocked).forEach(e => {
                const b = document.createElement('button'); b.className = 'v7e'; b.textContent = e.emoji;
                b.onclick = () => sendReaction(e.emoji);
                bar.appendChild(b);
            });
        }

        /* ---------- Quêtes du jour ---------- */
        function questHtml(list) {
            return (list || []).map(q => `<div class="quest-row${q.done ? ' done' : ''}"><div class="qb"><div class="qt">${v7esc(q.label)}</div><div class="qbar"><div style="width:${Math.round(100 * q.progress / Math.max(1, q.n))}%"></div></div></div><span class="qx">${q.progress}/${q.n} • +${q.xp} XP</span></div>`).join('');
        }
        async function loadQuests() {
            const box = document.getElementById('quest-list');
            if (!box) return;
            const d = await v7get('/api/quests');
            if (!d || !d.ok) { box.innerHTML = '<p class="tl-hint">Quêtes indisponibles.</p>'; return; }
            box.innerHTML = questHtml(d.quests) + (isAccount() ? '<p class="tl-hint">Nouvelles quêtes chaque jour à minuit.</p>' : '<p class="tl-hint">Crée un compte pour valider les quêtes et gagner l\'XP.</p>');
        }
        socket.on('connect', () => setTimeout(loadQuests, 400));
        socket.on('xp_gain', d => {
            if (!d) return;
            (d.quests || []).forEach((q, i) => setTimeout(() => { toast(`📜 Quête terminée : <b>${v7esc(q.label)}</b><br><small>+${q.xp} XP</small>`, '#00ff88'); confetti(1200); }, 1400 + i * 900));
            setTimeout(loadQuests, 1500);
        });

        /* ---------- Profil étendu : quêtes, cosmétiques, avatar, historique, stats par anime ---------- */
        async function loadProfileExtra() {
            const box = document.getElementById('v7-profile');
            if (!box) return;
            if (!isAccount()) { box.innerHTML = '<p class="tl-hint">Crée un compte pour débloquer les cosmétiques, l\'avatar, les amis et l\'historique.</p>'; return; }
            const d = await v7get('/api/profile/extra');
            if (!d || !d.ok) { box.innerHTML = '<p class="tl-hint">Indisponible pour le moment.</p>'; return; }
            const c = d.cosmetics, cur = c.current || {};
            v7Emojis = c.emojis || []; v7RenderEmojiBar();
            const me = currentUser ? currentUser.pseudo : '';
            box.innerHTML = `
                <div class="cos-preview">${avatarHtml(me, cur, true)}<div><div>${cosNameHtml(me, cur)}</div><div class="tl-hint" style="text-align:left;">Niveau ${c.level}${cur.avatarName ? ' • avatar : ' + v7esc(cur.avatarName) : ''}</div>
                <button class="host-btn" style="margin-top:6px;" onclick="openAvatarPicker()">🖼️ Choisir mon avatar</button></div></div>
                <h3 style="margin:10px 0 4px;color:var(--accent-yellow);">🎨 Couleur du pseudo</h3>
                <div class="cos-grid">${c.colors.map(x => `<button class="cos-chip${x.id === cur.color ? ' on' : ''}${x.unlocked ? '' : ' lock'}" ${x.unlocked ? `onclick="setCos('color','${x.id}')"` : ''}>${x.unlocked ? `<span class="cn cn-${x.id}">${v7esc(x.name)}</span>` : '🔒 ' + v7esc(x.name) + ' • nv ' + x.need}</button>`).join('')}</div>
                <h3 style="margin:10px 0 4px;color:var(--accent-yellow);">🖼️ Cadre de profil</h3>
                <div class="cos-grid">${c.frames.map(x => `<button class="cos-chip${x.id === cur.frame ? ' on' : ''}${x.unlocked ? '' : ' lock'}" ${x.unlocked ? `onclick="setCos('frame','${x.id}')"` : ''}>${x.unlocked ? v7esc(x.name) : '🔒 ' + v7esc(x.name) + ' • nv ' + x.need}</button>`).join('')}</div>
                <h3 style="margin:10px 0 4px;color:var(--accent-yellow);">😀 Réactions bonus</h3>
                <div class="cos-grid">${c.emojis.map(x => `<span class="cos-chip${x.unlocked ? ' on' : ' lock'}">${x.unlocked ? x.emoji : '🔒 ' + x.emoji + ' nv ' + x.need}</span>`).join('')}</div>
                <h3 style="margin:14px 0 6px;color:var(--accent-yellow);">📜 Quêtes du jour</h3>${questHtml(d.quests)}
                <h3 style="margin:14px 0 6px;color:var(--accent-yellow);">🎌 Tes animes</h3>
                ${d.best || d.worst ? `<div class="best-worst"><div>💪 Ton meilleur anime<b style="color:#00ff88">${v7esc(d.best ? d.best.anime : '—')}</b>${d.best ? d.best.pct + ' % de bonnes réponses' : ''}</div><div>😵 Ton pire anime<b style="color:var(--accent-pink)">${v7esc(d.worst ? d.worst.anime : '—')}</b>${d.worst ? d.worst.pct + ' % de bonnes réponses' : ''}</div></div>` : ''}
                ${d.animes.length ? d.animes.slice(0, 15).map(a => `<div class="anime-stat"><span>${v7esc(a.anime)} <small style="color:var(--text-muted)">(${a.n})</small></span><div class="ab"><div style="width:${a.pct}%"></div></div><b>${a.pct}%</b></div>`).join('') : '<p class="tl-hint">Joue au blind test ou aux mini-jeux pour voir tes stats par anime (5 réponses min. pour le meilleur/pire).</p>'}
                <h3 style="margin:14px 0 6px;color:var(--accent-yellow);">🕘 Historique des parties</h3>
                ${d.history.length ? d.history.map(h => `<div class="hist-row"><span>${v7esc(h.label)}${h.universe ? ' • ' + v7esc(h.universe) : ''}</span><span class="${h.won ? 'w' : 'l'}">${h.won ? '🏆 Victoire' : h.rank ? '#' + h.rank + (h.players ? '/' + h.players : '') : '—'}</span><small>${new Date(h.at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</small><small>${h.points} pts</small></div>`).join('') : '<p class="tl-hint">Aucune partie pour le moment.</p>'}`;
        }
        async function setCos(kind, id) {
            const d = await v7post('/api/cosmetics', { [kind]: id });
            if (d && d.ok) { toast('✨ Style mis à jour !', 'var(--accent-cyan)'); loadProfileExtra(); } else toast('🔒 ' + ((d && d.error) || 'Impossible'), 'var(--accent-pink)');
        }
        function openAvatarPicker() {
            document.getElementById('v7-av-modal')?.remove();
            const m = document.createElement('div'); m.className = 'v7-modal'; m.id = 'v7-av-modal';
            m.innerHTML = `<div class="v7-box"><button class="v7-close" onclick="this.closest('.v7-modal').remove()">✕</button><h3>🖼️ Choisis ton perso préféré</h3>
                <input class="v7-input" id="av-q" placeholder="Cherche un perso (ex : Gojo, Luffy…)" autocomplete="off">
                <button class="host-btn" onclick="setAvatar(null)">Retirer mon avatar</button>
                <div class="av-grid" id="av-grid"><div class="arc-loading"><div class="arc-spin"></div></div></div></div>`;
            m.addEventListener('click', e => { if (e.target === m) m.remove(); });
            document.body.appendChild(m);
            let t = null;
            const run = async () => {
                const q = document.getElementById('av-q').value.trim();
                const d = await v7get('/api/avatar/search?q=' + encodeURIComponent(q));
                const grid = document.getElementById('av-grid');
                if (!grid) return;
                grid.innerHTML = d && d.results && d.results.length ? d.results.map(r => `<div class="av-item" onclick="setAvatar('${v7esc(r.u)}', this)" data-n="${v7esc(r.name)}"><img src="/api/avatar/img?u=${encodeURIComponent(r.u)}&n=${encodeURIComponent(r.name)}" alt="" loading="lazy" decoding="async" onerror="this.style.opacity=.2">${v7esc(r.name)}<br><small style="color:var(--text-muted)">${v7esc(r.anime)}</small></div>`).join('') : '<p class="tl-hint">Aucun perso trouvé.</p>';
            };
            document.getElementById('av-q').addEventListener('input', () => { clearTimeout(t); t = setTimeout(run, 300); });
            run();
        }
        async function setAvatar(u, el) {
            const d = await v7post('/api/avatar', u ? { u, name: el.dataset.n } : {});
            if (d && d.ok) { document.getElementById('v7-av-modal')?.remove(); toast('🖼️ Avatar mis à jour !', 'var(--accent-cyan)'); loadProfileExtra(); }
            else toast('❌ ' + ((d && d.error) || 'Impossible'), 'var(--accent-pink)');
        }

        /* ---------- Amis ---------- */
        async function loadFriends() {
            const box = document.getElementById('v7-friends');
            if (!box) return;
            if (!isAccount()) { box.innerHTML = '<p class="tl-hint">Crée un compte pour ajouter des amis.</p>'; return; }
            const d = await v7get('/api/friends');
            if (!d || !d.ok) { box.innerHTML = '<p class="tl-hint">Indisponible.</p>'; return; }
            box.innerHTML = `
                <div class="draw-input" style="margin-bottom:10px;"><input id="friend-add" placeholder="Pseudo de ton pote" maxlength="20"><button onclick="addFriend()">➕</button></div>
                ${d.incoming.length ? '<h3 style="margin:6px 0;color:var(--accent-yellow);font-size:.95rem;">📩 Demandes reçues</h3>' + d.incoming.map(f => `<div class="friend-row"><b>${v7esc(f.pseudo)}</b><span class="pl-btns"><button class="go" onclick="respondFriend(${f.id}, true)">Accepter</button><button onclick="respondFriend(${f.id}, false)">Refuser</button></span></div>`).join('') : ''}
                ${d.friends.length ? d.friends.map(f => `<div class="friend-row"><span class="pl-name">${avatarHtml(f.pseudo, f.cos)}<span>${cosNameHtml(f.pseudo, f.cos)}<br><span class="fs ${f.online ? 'on' : ''}">${f.online ? '● En ligne' : '○ Hors ligne'} • nv ${f.level}${f.room ? ' • ' + v7esc(f.room.mode) + (f.room.waiting ? ' (salon)' : ' (en partie)') : ''}</span></span></span>
                    <span class="pl-btns">${f.room && f.room.waiting && f.room.code !== currentRoomCode ? `<button class="go" onclick="joinFriendRoom('${v7esc(f.room.code)}')">Rejoindre</button>` : ''}${currentRoomCode && f.online ? `<button onclick="inviteFriend(${f.id})">📨 Inviter</button>` : ''}<button onclick="removeFriend(${f.id}, this)" title="Retirer">🗑️</button></span></div>`).join('') : '<p class="tl-hint">Pas encore d\'amis : ajoute ton pote avec son pseudo !</p>'}
                ${d.outgoing.length ? '<p class="tl-hint" style="text-align:left;">En attente : ' + d.outgoing.map(f => v7esc(f.pseudo)).join(', ') + '</p>' : ''}`;
        }
        async function addFriend() {
            const i = document.getElementById('friend-add');
            const pseudo = i && i.value.trim();
            if (!pseudo) return;
            const d = await v7post('/api/friends/request', { pseudo });
            toast(d && d.ok ? d.message : '❌ ' + ((d && d.error) || 'Impossible'), d && d.ok ? '#00ff88' : 'var(--accent-pink)');
            loadFriends();
        }
        async function respondFriend(id, accept) { await v7post('/api/friends/respond', { id, accept }); loadFriends(); }
        async function removeFriend(id, btn) {
            if (!btn.classList.contains('armed')) { btn.classList.add('armed'); btn.textContent = 'Sûr ?'; return; }
            await v7post('/api/friends/remove', { id }); loadFriends();
        }
        function inviteFriend(id) { if (currentRoomCode) socket.emit('friend_invite', { friendId: id, roomCode: currentRoomCode }); }
        function joinFriendRoom(code) {
            document.getElementById('v7-fr-modal')?.remove();
            if (currentRoomCode && currentRoomCode !== code) socket.emit('leave_room', { roomCode: currentRoomCode });
            currentRoomCode = code;
            switchTab('mode');
            socket.emit('join_room', { roomCode: code, username: getUsername(), mode: 'undercover', subMode: 'normal' });
        }
        async function openFriendInvite() {
            document.getElementById('v7-fr-modal')?.remove();
            const m = document.createElement('div'); m.className = 'v7-modal'; m.id = 'v7-fr-modal';
            m.innerHTML = `<div class="v7-box"><button class="v7-close" onclick="this.closest('.v7-modal').remove()">✕</button><h3>📨 Inviter un ami</h3><div id="v7-fr-list"><div class="arc-loading"><div class="arc-spin"></div></div></div></div>`;
            m.addEventListener('click', e => { if (e.target === m) m.remove(); });
            document.body.appendChild(m);
            const d = await v7get('/api/friends');
            const box = document.getElementById('v7-fr-list');
            if (!box) return;
            const on = d && d.ok ? d.friends.filter(f => f.online) : [];
            box.innerHTML = on.length ? on.map(f => `<div class="friend-row"><span class="pl-name">${avatarHtml(f.pseudo, f.cos)}${cosNameHtml(f.pseudo, f.cos)}</span><button class="go" onclick="inviteFriend(${f.id});this.textContent='✅ Envoyé';this.disabled=true;">📨 Inviter</button></div>`).join('')
                : '<p class="tl-hint">Aucun ami en ligne pour le moment. Ajoute des amis dans l\'onglet Options.</p>';
        }
        socket.on('friend_invite', d => {
            if (!d) return;
            const id = 'inv' + Date.now();
            toast(`📨 <b>${v7esc(d.from)}</b> t'invite dans son salon (${v7esc(d.mode)})<br><button id="${id}" style="margin-top:6px;background:var(--accent-cyan);color:#000;border:0;border-radius:8px;padding:6px 12px;font-weight:800;cursor:pointer;pointer-events:auto;">Rejoindre</button>`, 'var(--accent-cyan)');
            setTimeout(() => { const b = document.getElementById(id); if (b) b.onclick = () => joinFriendRoom(d.roomCode); }, 50);
        });
        socket.on('friends_changed', d => { if (d && d.message) toast(d.message, 'var(--accent-cyan)'); const o = document.getElementById('options'); if (o && o.classList.contains('active')) loadFriends(); });

        /* ---------- Propositions des joueurs ---------- */
        async function sendSuggestion() {
            const val = id => (document.getElementById(id) || {}).value || '';
            const d = await v7post('/api/suggest', { kind: val('sg-kind'), anime: val('sg-anime'), name: val('sg-name'), link: val('sg-link'), note: val('sg-note'), pseudo: getUsername() });
            if (d && d.ok) { toast('💡 Merci ! Ta proposition a été envoyée.', '#00ff88'); ['sg-anime', 'sg-name', 'sg-link', 'sg-note'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; }); }
            else toast('❌ ' + ((d && d.error) || 'Impossible'), 'var(--accent-pink)');
        }
        async function loadSuggestionsAdmin() {
            const panel = document.getElementById('v7-admin');
            if (!panel || !isAccount()) return;
            const d = await v7get('/api/suggestions');
            if (!d || !d.ok) { panel.style.display = 'none'; return; }
            panel.style.display = 'block';
            const KIND = { opening: '🎵 Opening', perso: '👤 Perso', citation: '💬 Citation', scene: '🎬 Scène', anime: '🎌 Anime', bug: '🐛 Bug', autre: '💡 Autre' };
            document.getElementById('v7-admin-list').innerHTML = d.rows.length ? d.rows.map(r => `<div class="sugg-row"><b>${KIND[r.kind] || r.kind}</b> ${v7esc(r.anime || '')} ${r.name ? '• ' + v7esc(r.name) : ''}<br>${r.link ? `<a href="${v7esc(r.link)}" target="_blank" rel="noopener" style="color:var(--accent-cyan)">${v7esc(r.link)}</a><br>` : ''}${r.note ? v7esc(r.note) + '<br>' : ''}<small style="color:var(--text-muted)">${v7esc(r.pseudo || '')} • ${new Date(r.created_at).toLocaleDateString('fr-FR')}</small> <button class="kick-btn" onclick="delSuggestion(${r.id})">Supprimer</button></div>`).join('') : '<p class="tl-hint">Aucune proposition.</p>';
        }
        async function delSuggestion(id) { await v7post('/api/suggestions/delete', { id }); loadSuggestionsAdmin(); }

        (function () {
            const orig = window.switchTab;
            window.switchTab = function (t) { const r = orig.apply(this, arguments); if (t === 'options') { loadProfileExtra(); loadFriends(); loadSuggestionsAdmin(); } return r; };
        })();

        /* ---------- Panneaux : on cache aussi Dessine le perso ---------- */
        (function () {
            const orig = window.hideAllPanels;
            window.hideAllPanels = function () { const r = orig.apply(this, arguments); const d = document.getElementById('draw-room'); if (d) d.style.display = 'none'; return r; };
        })();

        /* =====================================================================
           DESSINE LE PERSO
           ===================================================================== */
        const DRAW_COLORS = ['#000000', '#ffffff', '#7f7f7f', '#c3c3c3', '#e53935', '#ff8a80', '#fb8c00', '#ffcc80', '#fdd835', '#fff59d', '#43a047', '#a5d6a7', '#1e88e5', '#90caf9', '#8e24aa', '#ce93d8', '#6d4c41', '#f5cba7'];
        const DRAW_SIZES = [3, 7, 14, 28];
        const drw = { state: null, clock: 0, color: '#000000', size: 7, tool: 'pen', strokes: [], last: {}, cur: null, buf: [], sendT: null, word: null, tick: null, chatKey: '' };
        const drawCanvas = () => document.getElementById('draw-canvas');
        function drawCtx() { const c = drawCanvas(); return c ? c.getContext('2d') : null; }
        function drawClearCanvas() { const c = drawCanvas(), x = drawCtx(); if (!x) return; x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); drw.last = {}; }
        function drawApply(s) {
            const c = drawCanvas(), x = drawCtx();
            if (!x || !s) return;
            const k = c.width / 1000;
            if (s.f) { drawFloodFill(Math.round(s.p[0][0] * k), Math.round(s.p[0][1] * k), s.c); drw.last[s.id] = null; return; }
            x.strokeStyle = s.er ? '#ffffff' : s.c; x.fillStyle = x.strokeStyle;
            x.lineWidth = s.w * k; x.lineCap = 'round'; x.lineJoin = 'round';
            const pts = s.p.slice();
            const prev = drw.last[s.id];
            if (prev) pts.unshift(prev);
            if (pts.length === 1) { x.beginPath(); x.arc(pts[0][0] * k, pts[0][1] * k, s.w * k / 2, 0, Math.PI * 2); x.fill(); }
            else { x.beginPath(); x.moveTo(pts[0][0] * k, pts[0][1] * k); for (let i = 1; i < pts.length; i++) x.lineTo(pts[i][0] * k, pts[i][1] * k); x.stroke(); }
            drw.last[s.id] = s.p[s.p.length - 1];
        }
        function drawFloodFill(sx, sy, hex) {
            const c = drawCanvas(), x = drawCtx();
            const W = c.width, H = c.height;
            if (sx < 0 || sy < 0 || sx >= W || sy >= H) return;
            const img = x.getImageData(0, 0, W, H), d = img.data;
            const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
            const i0 = (sy * W + sx) * 4, tr = d[i0], tg = d[i0 + 1], tb = d[i0 + 2];
            if (Math.abs(tr - r) + Math.abs(tg - g) + Math.abs(tb - b) < 10) return;
            const same = i => Math.abs(d[i] - tr) + Math.abs(d[i + 1] - tg) + Math.abs(d[i + 2] - tb) < 90;
            const seen = new Uint8Array(W * H), stack = [sx + sy * W];
            while (stack.length) {
                const p = stack.pop();
                if (seen[p]) continue;
                seen[p] = 1;
                const i = p * 4;
                if (!same(i)) continue;
                d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
                const px = p % W;
                if (px > 0) stack.push(p - 1);
                if (px < W - 1) stack.push(p + 1);
                if (p >= W) stack.push(p - W);
                if (p < W * (H - 1)) stack.push(p + W);
            }
            x.putImageData(img, 0, 0);
        }
        function drawRedrawAll() { drawClearCanvas(); drw.last = {}; drw.strokes.forEach(drawApply); }
        function drawIsMe() { return drw.state && drw.state.drawerId === socket.id; }
        function drawCanDraw() { return drawIsMe() && drw.state.phase === 'drawing'; }
        function drawPoint(e) {
            const c = drawCanvas(), r = c.getBoundingClientRect();
            return [Math.max(0, Math.min(1000, Math.round((e.clientX - r.left) / r.width * 1000))), Math.max(0, Math.min(1000, Math.round((e.clientY - r.top) / r.height * 1000)))];
        }
        function drawFlush() {
            if (!drw.cur || !drw.buf.length) return;
            const s = { id: drw.cur.id, c: drw.cur.c, w: drw.cur.w, er: drw.cur.er, p: drw.buf.splice(0, 60) };
            socket.emit('draw_stroke', { roomCode: currentRoomCode, s });
            drw.strokes.push(s);
        }
        function drawBindCanvas() {
            const c = drawCanvas();
            if (!c || c.__bound) return;
            c.__bound = true;
            c.addEventListener('pointerdown', e => {
                if (!drawCanDraw()) return;
                e.preventDefault();
                const p = drawPoint(e);
                const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
                if (drw.tool === 'fill') {
                    const s = { id, c: drw.color, w: 1, f: true, p: [p] };
                    drawApply(s); drw.strokes.push(s);
                    socket.emit('draw_stroke', { roomCode: currentRoomCode, s });
                    return;
                }
                try { c.setPointerCapture(e.pointerId); } catch (_) {}
                drw.cur = { id, c: drw.color, w: drw.size, er: drw.tool === 'eraser' };
                drw.buf = [p];
                drawApply({ ...drw.cur, p: [p] });
                clearInterval(drw.sendT); drw.sendT = setInterval(drawFlush, 45);
            });
            c.addEventListener('pointermove', e => {
                if (!drw.cur) return;
                e.preventDefault();
                const p = drawPoint(e);
                const lastLocal = drw.last[drw.cur.id];
                if (lastLocal && Math.abs(lastLocal[0] - p[0]) + Math.abs(lastLocal[1] - p[1]) < 3) return;
                drw.buf.push(p);
                drawApply({ ...drw.cur, p: [p] });
                if (drw.buf.length >= 60) drawFlush();
            });
            const end = () => { if (!drw.cur) return; drawFlush(); clearInterval(drw.sendT); drw.cur = null; };
            c.addEventListener('pointerup', end); c.addEventListener('pointercancel', end); c.addEventListener('pointerleave', end);
        }
        function drawRenderTools() {
            const box = document.getElementById('draw-tools');
            if (!box) return;
            const can = drawCanDraw();
            box.style.display = can ? 'flex' : 'none';
            if (!can || box.__built) { if (can) drawToolsState(); return; }
            box.__built = true;
            box.innerHTML = DRAW_COLORS.map(c => `<button class="sw" data-c="${c}" style="background:${c}" onclick="drawSetColor('${c}')"></button>`).join('')
                + `<input type="color" value="#ff5fa2" oninput="drawSetColor(this.value)" title="Couleur perso">`
                + DRAW_SIZES.map(s => `<button class="tb sz" data-s="${s}" onclick="drawSetSize(${s})"><span style="display:inline-block;width:${Math.max(4, s / 1.5)}px;height:${Math.max(4, s / 1.5)}px;border-radius:50%;background:#fff;vertical-align:middle"></span></button>`).join('')
                + `<button class="tb tool" data-t="pen" onclick="drawSetTool('pen')">✏️</button><button class="tb tool" data-t="fill" onclick="drawSetTool('fill')">🪣</button><button class="tb tool" data-t="eraser" onclick="drawSetTool('eraser')">🧽</button>`
                + `<button class="tb" onclick="socket.emit('draw_undo',{roomCode:currentRoomCode})">↩️</button><button class="tb" onclick="socket.emit('draw_clear',{roomCode:currentRoomCode})">🗑️</button>`;
            drawToolsState();
        }
        function drawToolsState() {
            document.querySelectorAll('#draw-tools .sw').forEach(b => b.classList.toggle('on', b.dataset.c === drw.color && drw.tool !== 'eraser'));
            document.querySelectorAll('#draw-tools .sz').forEach(b => b.classList.toggle('on', +b.dataset.s === drw.size));
            document.querySelectorAll('#draw-tools .tool').forEach(b => b.classList.toggle('on', b.dataset.t === drw.tool));
        }
        function drawSetColor(c) { drw.color = c; if (drw.tool === 'eraser') drw.tool = 'pen'; drawToolsState(); }
        function drawSetSize(s) { drw.size = s; if (drw.tool === 'fill') drw.tool = 'pen'; drawToolsState(); }
        function drawSetTool(t) { drw.tool = t; drawToolsState(); }
        function drawSendGuess() {
            const i = document.getElementById('draw-input');
            const t = i && i.value.trim();
            if (!t) return;
            socket.emit('draw_guess', { roomCode: currentRoomCode, text: t });
            i.value = '';
        }
        function drawChat(html, cls) {
            const box = document.getElementById('draw-chat');
            if (!box) return;
            const d = document.createElement('div'); if (cls) d.className = cls; d.innerHTML = html;
            box.appendChild(d);
            while (box.children.length > 120) box.firstChild.remove();
            box.scrollTop = box.scrollHeight;
        }
        function drawShow() {
            const panel = document.getElementById('draw-room');
            if (!panel || panel.style.display === 'block') return;
            hideAllPanels();
            panel.style.display = 'block';
            drawBindCanvas();
            drawRedrawAll();
        }
        function drawRender() {
            const q = drw.state;
            if (!q) return;
            lastHostId = q.hostId;
            q.players.forEach(p => { if (p.cos) cosById[p.id] = p.cos; });
            const me = drawIsMe();
            document.getElementById('draw-status').innerHTML = q.phase === 'finished' ? '🏁 Partie terminée' : q.stream ? `🎥 Dessin ${q.tour}/${q.tours} • ${v7esc(q.drawerName)} dessine pour le chat` : `Tour ${q.tour}/${q.tours} • ${v7esc(q.drawerName)} ${q.phase === 'choosing' ? 'choisit' : 'dessine'}`;
            drawStreamBoard(q);
            const w = document.getElementById('draw-word');
            if (q.phase === 'drawing' && me && drw.word && q.stream) { w.className = 'draw-word me'; if (!w.__peek) { w.__peek = true; w.innerHTML = `<button class="draw-peek" onpointerdown="drawPeek(true)" onpointerup="drawPeek(false)" onpointerleave="drawPeek(false)" onpointercancel="drawPeek(false)">👁️ Maintiens pour voir le perso (caché pour le chat)</button>`; } }
            else if (q.phase === 'drawing' && me && drw.word) { w.className = 'draw-word me'; w.textContent = '✏️ ' + drw.word.word; }
            else if (q.phase === 'drawing' && q.mask) { w.className = 'draw-word'; w.textContent = q.mask; }
            else if (q.reveal) { w.className = 'draw-word me'; w.textContent = q.reveal.word; }
            else { w.className = 'draw-word'; w.textContent = q.phase === 'choosing' ? '…' : ''; }
            if (!(q.phase === 'drawing' && me && q.stream && drw.word)) w.__peek = false;
            document.getElementById('draw-anime').textContent = q.phase === 'drawing' && me && drw.word && q.stream ? `💬 Chat : écrivez !nom du perso • indice : ${q.mask || ''}${q.anime ? ' • 📺 ' + q.anime : ''}` : q.phase === 'drawing' && me && drw.word ? drw.word.anime : (q.anime ? '📺 ' + q.anime : (q.phase === 'drawing' ? `${(q.mask || '').replace(/[^_]/g, '').length} lettres` : ''));
            // scores
            const sb = document.getElementById('draw-scores');
            sb.innerHTML = [...q.players].sort((a, b) => b.score - a.score).map(p => `<div class="quote-score"><span class="pl-name">${avatarHtml(p.name, p.cos)}${cosNameHtml(p.name, p.cos)}${p.drawing ? ' ✏️' : ''}${p.guessed ? ' ✅' : ''}${p.offline ? ' 📡' : ''}${p.gained && (q.phase === 'reveal') ? ` <small style="color:#00ff88">+${p.gained}</small>` : ''}</span><strong style="color:var(--accent-yellow)">${p.score} pts</strong></div>`).join('');
            // superposition
            const ov = document.getElementById('draw-overlay');
            ov.className = 'draw-overlay';
            if (q.phase === 'choosing') {
                ov.classList.add('on');
                if (q.stream) ov.innerHTML = '<div style="font-size:3rem;">🎲</div><div>Tirage du prochain perso…</div>';
                else if (me && drw.options) ov.innerHTML = '<div style="font-weight:800;font-size:1.1rem;">🎯 Choisis le perso à dessiner</div>' + drw.options.map((o, i) => `<button class="opt" onclick="socket.emit('draw_choose',{roomCode:currentRoomCode,idx:${i}})">${v7esc(o.name)}<small>${v7esc(o.anime)}</small></button>`).join('');
                else ov.innerHTML = `<div style="font-size:3rem;">🤔</div><div><b>${v7esc(q.drawerName)}</b> choisit un perso…</div>`;
            } else if (q.phase === 'reveal' && q.reveal) {
                ov.classList.add('on');
                ov.innerHTML = `${q.stream ? `<div class="draw-finder">${q.streamFinder ? `🎉 <b>${v7esc(q.streamFinder)}</b> a trouvé ! +1 point` : "😶 Personne dans le chat n'a trouvé"}</div>` : ''}<div>C'était</div><div style="font-family:'Bangers',cursive;font-size:2rem;color:var(--accent-yellow)">${v7esc(q.reveal.word)}</div><div style="color:var(--accent-cyan)">${v7esc(q.reveal.anime)}</div>${q.reveal.img ? `<img src="${v7esc(q.reveal.img)}" alt="">` : ''}`;
            } else if (q.phase === 'finished') {
                ov.classList.add('on');
                const top = [...q.players].sort((a, b) => b.score - a.score).slice(0, 3);
                ov.innerHTML = `<div style="font-size:3rem;">🏆</div><div style="font-family:'Bangers',cursive;font-size:1.8rem;color:var(--accent-yellow)">${v7esc((q.winnerNames || []).join(' & ') || '—')}</div>${top.map((p, i) => `<div>${['🥇', '🥈', '🥉'][i]} ${cosNameHtml(p.name, p.cos)} • ${p.score} pts</div>`).join('')}`;
                if (window.__drawFin !== q.turn + '|' + q.totalTurns && (q.winnerNames || []).includes((q.players.find(p => p.id === socket.id) || {}).name)) { window.__drawFin = q.turn + '|' + q.totalTurns; confetti(); }
            }
            document.getElementById('draw-end').style.display = q.phase === 'finished' ? 'flex' : 'none';
            const replay = document.getElementById('draw-replay'); if (replay) replay.style.display = q.hostId === socket.id ? '' : 'none';
            const inp = document.getElementById('draw-input');
            const meP = q.players.find(p => p.id === socket.id) || {};
            inp.placeholder = me ? 'Discute avec les autres…' : meP.guessed ? 'Trouvé ! Tu peux discuter…' : 'Ta réponse…';
            drawRenderTools();
            if (!drw.tick) drw.tick = setInterval(drawTickFn, 250);
        }
        function drawTickFn() {
            const q = drw.state, el = document.getElementById('draw-timer');
            const panel = document.getElementById('draw-room');
            if (!q || !el || !panel || panel.style.display === 'none') return;
            const left = Math.max(0, Math.ceil((q.endsAt - (Date.now() + drw.clock)) / 1000));
            el.textContent = q.phase === 'finished' ? '🏁' : left;
            el.classList.toggle('low', q.phase === 'drawing' && left <= 10);
        }
        socket.on('draw_state', q => {
            if (!q || !currentRoomCode) return;
            const prevPhase = drw.state && drw.state.phase, prevTurn = drw.state && drw.state.turn;
            drw.state = q; drw.clock = q.serverNow - Date.now();
            if (q.turn !== prevTurn) { drw.word = null; drw.options = null; }
            drawShow();
            if (q.phase === 'drawing' && prevPhase !== 'drawing' && q.turn === prevTurn) drawChat(`✏️ ${v7esc(q.drawerName)} dessine !`, 'sys');
            if (q.phase === 'choosing' && q.turn !== prevTurn) { drw.strokes = []; drawRedrawAll(); drw.tool = 'pen'; }
            if (q.phase === 'reveal' && prevPhase !== 'reveal' && q.reveal) drawChat(`🎴 C'était <b>${v7esc(q.reveal.word)}</b> (${v7esc(q.reveal.anime)})`, 'sys');
            drawRender();
        });
        socket.on('draw_options', d => { drw.options = d && d.options; drawRender(); });
        socket.on('draw_word', d => { drw.word = d; drawRender(); });
        socket.on('draw_stroke', s => { drw.strokes.push(s); drawApply(s); });
        socket.on('draw_redraw', d => { drw.strokes = (d && d.strokes) || []; drawRedrawAll(); });
        socket.on('draw_chat', m => {
            if (!m) return;
            if (m.system) drawChat(v7esc(m.text), m.ok ? 'ok' : 'sys');
            else drawChat(`<b>${cosNameHtml(m.name, null)}</b> : ${v7esc(m.text)}`, m.found ? 'found' : '');
            if (m.system && m.ok) fxGood();
        });
        socket.on('draw_closed', () => { returningToWaitingRoom = true; drw.state = null; const p = document.getElementById('draw-room'); if (p) p.style.display = 'none'; });
        socket.on('connect', () => { if (currentRoomCode && drw.state) setTimeout(() => socket.emit('draw_sync', { roomCode: currentRoomCode }), 600); });
        function drawReplay() { socket.emit('start_game', currentRoomCode); }
        // --- mode stream : le chat Twitch devine ---
        function drawPeek(on) {
            const w = document.getElementById('draw-word'), b = w && w.querySelector('.draw-peek');
            if (!b || !drw.word) return;
            b.textContent = on ? '✏️ ' + drw.word.word + ' (' + drw.word.anime + ')' : '👁️ Maintiens pour voir le perso (caché pour le chat)';
            b.classList.toggle('on', !!on);
        }
        function drawBoardKey() { return 'stream_draw_' + (stream.channel || ''); }
        function drawBoardLoad() { try { return JSON.parse(localStorage.getItem(drawBoardKey()) || '{}') || {}; } catch (e) { return {}; } }
        function drawBoardSave(b) { try { localStorage.setItem(drawBoardKey(), JSON.stringify(b)); } catch (e) {} }
        const drawStreamLast = {};
        function streamDrawGuess(user, msg, display) {
            const q = drw.state;
            if (!q || !q.stream || q.phase !== 'drawing' || !drawIsMe() || !currentRoomCode) return;
            const m = String(msg || '').match(stream.ws && stream.ws.tiktok ? /^!?\s*(.{2,60})$/ : /^!\s*(.{2,60})$/);
            if (!m) return;
            const now = Date.now();
            if (now - (drawStreamLast[user] || 0) < 1200) return;
            drawStreamLast[user] = now;
            socket.emit('draw_stream_guess', { roomCode: currentRoomCode, user, name: display || user, text: m[1].trim(), platform: streamIsTiktok() ? 'tiktok' : 'twitch' });
        }
        function drawStreamBoard(q) {
            const box = document.getElementById('draw-stream-board');
            if (!box) return;
            if (!q || !q.stream) { box.style.display = 'none'; return; }
            box.style.display = 'block';
            const mine = stream.ws ? drawBoardLoad() : null;
            const top = mine ? Object.entries(mine).sort((a, b) => b[1].pts - a[1].pts).slice(0, 10) : [];
            box.innerHTML = `<div class="dsb-h">💬 Chat ${streamChatName()} : écrivez <b>${streamIsTiktok() ? 'le nom du perso' : '!nom du perso'}</b></div>`
                + (mine ? (top.length ? top.map(([u, e], i) => `<div class="dsb-row${e.last ? ' new' : ''}"><span>${['🥇', '🥈', '🥉'][i] || (i + 1) + '.'} ${escHtml(e.name)}</span><b>${e.pts} pt${e.pts > 1 ? 's' : ''}</b></div>`).join('') : "<div class='tl-hint'>Personne n'a encore trouvé.</div>")
                    + `<div class="sv-tools" style="margin-top:6px;"><button onclick="drawBoardReset()">🔄 Remettre à 0</button></div>` : "<div class='tl-hint'>Le classement du chat est sur l'écran du streamer.</div>");
        }
        function drawBoardReset() { drawBoardSave({}); drawStreamBoard(drw.state); toast('🔄 Classement du chat remis à zéro', '#9146FF'); }
        socket.on('draw_stream_found', d => {
            if (!d || !d.user) return;
            if (stream.ws) {
                const b = drawBoardLoad();
                Object.values(b).forEach(e => { delete e.last; });
                const e = b[d.user] || (b[d.user] = { name: d.name, pts: 0 });
                e.name = d.name; e.pts++; e.last = 1;
                drawBoardSave(b);
            }
            drawStreamBoard(drw.state);
            confetti(1200);
        });

        /* =====================================================================
           COLORIE LE PERSO
           ===================================================================== */
        const col = { key: '', zones: [], labels: null, lab: null, W: 0, H: 0, colors: {}, sel: 0, hue: 200, s: .8, v: .9, sent: false, myUrl: null, flash: 0, raf: 0, autoT: null, img: null };
        function srgb2lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
        function lin2srgb(c) { c = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; return Math.max(0, Math.min(255, Math.round(c * 255))); }
        function rgb2lab(r, g, b) {
            r = srgb2lin(r); g = srgb2lin(g); b = srgb2lin(b);
            let x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047, y = r * 0.2126 + g * 0.7152 + b * 0.0722, z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
            const f = t => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
            x = f(x); y = f(y); z = f(z);
            return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
        }
        function lab2rgb(L, A, B) {
            let y = (L + 16) / 116, x = A / 500 + y, z = y - B / 200;
            const f = t => t * t * t > 0.008856 ? t * t * t : (t - 16 / 116) / 7.787;
            x = f(x) * 0.95047; y = f(y); z = f(z) * 1.08883;
            return [lin2srgb(x * 3.2406 + y * -1.5372 + z * -0.4986), lin2srgb(x * -0.9689 + y * 1.8758 + z * 0.0415), lin2srgb(x * 0.0557 + y * -0.2040 + z * 1.0570)];
        }
        const hex2rgb = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
        const rgb2hex = (r, g, b) => '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
        function hsv2rgb(h, s, v) { const f = n => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); }; return [f(5) * 255, f(3) * 255, f(1) * 255]; }
        function rgb2hsv(r, g, b) { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let h = 0; if (d) { h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; if (h < 0) h += 360; } return [h, mx ? d / mx : 0, mx]; }
        // Découpe l'image en zones de couleur (k-moyennes dans l'espace Lab, graine fixe)
        function colAnalyze(img, maxSide) {
            const sc = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
            const W = Math.max(1, Math.round(img.naturalWidth * sc)), H = Math.max(1, Math.round(img.naturalHeight * sc));
            const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
            const cx = cv.getContext('2d', { willReadFrequently: true });
            cx.drawImage(img, 0, 0, W, H);
            const d = cx.getImageData(0, 0, W, H).data;
            const N = W * H, lab = new Float32Array(N * 3), alpha = new Uint8Array(N);
            for (let i = 0; i < N; i++) { const l = rgb2lab(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]); lab[i * 3] = l[0]; lab[i * 3 + 1] = l[1]; lab[i * 3 + 2] = l[2]; alpha[i] = d[i * 4 + 3]; }
            return { W, H, lab, alpha, rgba: d };
        }
        function colKmeans(A, K) {
            const { lab, alpha } = A, N = A.W * A.H;
            const idx = []; for (let i = 0; i < N; i += 2) if (alpha[i] > 127) idx.push(i);
            if (idx.length < K) return null;
            let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
            const C = [];
            const first = idx[Math.floor(idx.length / 2)]; C.push([lab[first * 3], lab[first * 3 + 1], lab[first * 3 + 2]]);
            const dist = (i, c) => { const a = lab[i * 3] - c[0], b = lab[i * 3 + 1] - c[1], e = lab[i * 3 + 2] - c[2]; return a * a + b * b + e * e; };
            while (C.length < K) { // k-means++ déterministe
                let tot = 0; const ds = idx.map(i => { const m = Math.min(...C.map(c => dist(i, c))); tot += m; return m; });
                let t = rnd() * tot, pick = idx[idx.length - 1];
                for (let j = 0; j < idx.length; j++) { t -= ds[j]; if (t <= 0) { pick = idx[j]; break; } }
                C.push([lab[pick * 3], lab[pick * 3 + 1], lab[pick * 3 + 2]]);
            }
            for (let it = 0; it < 12; it++) {
                const sum = C.map(() => [0, 0, 0, 0]);
                idx.forEach(i => { let bi = 0, bd = Infinity; C.forEach((c, k) => { const dd = dist(i, c); if (dd < bd) { bd = dd; bi = k; } }); const s = sum[bi]; s[0] += lab[i * 3]; s[1] += lab[i * 3 + 1]; s[2] += lab[i * 3 + 2]; s[3]++; });
                sum.forEach((s, k) => { if (s[3]) C[k] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]]; });
            }
            return C;
        }
        function colNearest(C, L, a, b) { let bi = 0, bd = Infinity; for (let k = 0; k < C.length; k++) { const x = L - C[k][0], y = a - C[k][1], z = b - C[k][2], dd = x * x + y * y + z * z; if (dd < bd) { bd = dd; bi = k; } } return bi; }
        function colBuild(img, dispSide) {
            const A = colAnalyze(img, 140);
            let C = colKmeans(A, 7);
            if (!C) return false;
            // répartition + fond (couleur dominante sur les bords)
            const N = A.W * A.H, area = new Array(C.length).fill(0), border = new Array(C.length).fill(0), ysum = new Array(C.length).fill(0);
            let bn = 0;
            for (let i = 0; i < N; i++) {
                if (A.alpha[i] <= 127) continue;
                const k = colNearest(C, A.lab[i * 3], A.lab[i * 3 + 1], A.lab[i * 3 + 2]);
                area[k]++; ysum[k] += Math.floor(i / A.W) / A.H;
                const x = i % A.W, y = Math.floor(i / A.W);
                if (x < 2 || y < 2 || x >= A.W - 2 || y >= A.H - 2) { border[k]++; bn++; }
            }
            const tot = area.reduce((a, b) => a + b, 0);
            const bg = new Set();
            C.forEach((_, k) => { if (bn && border[k] / bn >= 0.28 && area[k] / tot >= 0.06) bg.add(k); });
            if (bg.size >= C.length - 1) bg.clear();
            // zones : clusters restants, petits fusionnés avec le plus proche
            let keep = C.map((_, k) => k).filter(k => !bg.has(k) && area[k] > 0);
            const fg = keep.reduce((a, k) => a + area[k], 0) || 1;
            const small = keep.filter(k => area[k] / fg < 0.03);
            const map = C.map((_, k) => k);
            keep = keep.filter(k => !small.includes(k));
            if (!keep.length) return false;
            small.forEach(k => { let bi = keep[0], bd = Infinity; keep.forEach(j => { const dd = (C[k][0] - C[j][0]) ** 2 + (C[k][1] - C[j][1]) ** 2 + (C[k][2] - C[j][2]) ** 2; if (dd < bd) { bd = dd; bi = j; } }); map[k] = bi; area[bi] += area[k]; ysum[bi] += ysum[k]; });
            keep.sort((a, b) => area[b] - area[a]);
            // étiquettes à la résolution d'affichage
            const sc = Math.min(1, dispSide / Math.max(img.naturalWidth, img.naturalHeight));
            const W = Math.max(1, Math.round(img.naturalWidth * sc)), H = Math.max(1, Math.round(img.naturalHeight * sc));
            const D = colAnalyze(img, Math.max(W, H));
            const labels = new Int8Array(D.W * D.H);
            const zoneOf = {}; keep.forEach((k, z) => { zoneOf[k] = z; });
            for (let i = 0; i < D.W * D.H; i++) {
                if (D.alpha[i] <= 127) { labels[i] = -1; continue; }
                const k = map[colNearest(C, D.lab[i * 3], D.lab[i * 3 + 1], D.lab[i * 3 + 2])];
                labels[i] = zoneOf[k] === undefined ? 100 + map[k] : zoneOf[k]; // 100+ : couleur classée « fond » par les k-moyennes
            }
            const fgArea = keep.reduce((a, k) => a + area[k], 0) || 1;
            col.zones = keep.map((k, z) => {
                const my = ysum[k] / Math.max(1, area[k]);
                return { lab: C[k], share: area[k] / fgArea, where: my < 0.34 ? 'haut' : my > 0.66 ? 'bas' : 'milieu' };
            });
            col.labels = labels; col.D = D; col.W = D.W; col.H = D.H;
            col.sel = col.target = 0;
            colPickPart();
            return true;
        }
        // Choisit la partie à colorier : TOUS les cheveux (manches impaires) ou TOUT l'habit (manches paires).
        // Même image + même manche => même choix chez tous les joueurs.
        const colIsSkin = l => l[0] > 45 && l[0] < 93 && l[1] > 3 && l[1] < 32 && l[2] > 7 && l[2] < 42 && l[2] > l[1] * 0.55;
        const colHue = (a, b) => { const h = Math.atan2(b, a) * 180 / Math.PI; return h < 0 ? h + 360 : h; };
        const colHueDiff = (h1, h2) => { const d = Math.abs(h1 - h2) % 360; return d > 180 ? 360 - d : d; };
        // Fond : couleurs présentes sur au moins 3 bords de l'image, remplies depuis les bords
        function colBackground() {
            const { W, H } = col, lab = col.D.lab, rgba = col.D.rgba, N = W * H;
            const bg = new Uint8Array(N);
            const de = (i, c) => Math.hypot(lab[i * 3] - c[0], lab[i * 3 + 1] - c[1], lab[i * 3 + 2] - c[2]);
            const buckets = [];
            const side = (x, y) => y === 0 ? 0 : y === H - 1 ? 1 : x === 0 ? 2 : 3;
            const border = [];
            for (let x = 0; x < W; x++) { border.push(x); border.push((H - 1) * W + x); }
            for (let y = 1; y < H - 1; y++) { border.push(y * W); border.push(y * W + W - 1); }
            border.forEach(i => {
                if (rgba[i * 4 + 3] < 128) return;
                let bk = buckets.find(bu => de(i, bu.c) < 10);
                if (!bk) { bk = { c: [lab[i * 3], lab[i * 3 + 1], lab[i * 3 + 2]], n: 0, s: [0, 0, 0, 0] }; buckets.push(bk); }
                bk.n++; bk.s[side(i % W, (i / W) | 0)]++;
            });
            const per = [W, W, H - 2, H - 2];
            const bgc = buckets.filter(bu => bu.s.filter((n, k) => n / per[k] >= 0.08).length >= 3).map(bu => bu.c);
            const stack = [];
            for (let i = 0; i < N; i++) if (rgba[i * 4 + 3] < 128) bg[i] = 1;
            border.forEach(i => { if (!bg[i] && bgc.some(c => de(i, c) < 14)) { bg[i] = 1; stack.push(i); } });
            border.forEach(i => { if (bg[i]) stack.push(i); });
            while (stack.length) {
                const k = stack.pop(), x = k % W, y = (k / W) | 0;
                const nb = [x > 0 ? k - 1 : -1, x < W - 1 ? k + 1 : -1, y > 0 ? k - W : -1, y < H - 1 ? k + W : -1];
                for (const j of nb) {
                    if (j < 0 || bg[j]) continue;
                    if (rgba[j * 4 + 3] < 128 || (bgc.some(c => de(j, c) < 14) && Math.hypot(lab[j * 3] - lab[k * 3], lab[j * 3 + 1] - lab[k * 3 + 1], lab[j * 3 + 2] - lab[k * 3 + 2]) < 9)) { bg[j] = 1; stack.push(j); }
                }
            }
            return bg;
        }
        function colPickPart() {
            const { W, H } = col, lab = col.D.lab, N = W * H;
            const bg = colBackground();
            let fg = 0; for (let i = 0; i < N; i++) if (!bg[i]) fg++;
            if (fg < N * 0.05) { col.part = 'main'; return; }
            // 1) graines : morceaux d'une même couleur (zones k-moyennes) hors fond
            const labels = col.labels, comp = new Int32Array(N).fill(-1), comps = [], stack = [];
            for (let i = 0; i < N; i++) {
                if (bg[i] || labels[i] < 0 || comp[i] >= 0) continue;
                const z = labels[i], id = comps.length;
                const c = { z, n: 0, ys: 0, ymin: H, L: 0, A: 0, B: 0, px: [] };
                comp[i] = id; stack.push(i);
                while (stack.length) {
                    const k = stack.pop(), x = k % W, y = (k / W) | 0;
                    c.n++; c.ys += y; if (y < c.ymin) c.ymin = y; c.L += lab[k * 3]; c.A += lab[k * 3 + 1]; c.B += lab[k * 3 + 2]; c.px.push(k);
                    for (const j of [x > 0 ? k - 1 : -1, x < W - 1 ? k + 1 : -1, y > 0 ? k - W : -1, y < H - 1 ? k + W : -1])
                        if (j >= 0 && comp[j] < 0 && !bg[j] && labels[j] === z) { comp[j] = id; stack.push(j); }
                }
                c.cy = c.ys / c.n / H; c.top = c.ymin / H; c.lab = [c.L / c.n, c.A / c.n, c.B / c.n]; c.share = c.n / fg;
                comps.push(c);
            }
            const usable = comps.filter(c => !colIsSkin(c.lab) && c.lab[0] > 6);
            const hair = usable.filter(c => c.cy < 0.45 && c.top < 0.32 && c.share >= 0.02).sort((a, b) => b.n - a.n);
            const clothes = usable.filter(c => c.cy > 0.55 && c.share >= 0.03).sort((a, b) => b.n - a.n);
            const wantHair = (col.round || 1) % 2 === 1;
            let part = wantHair ? 'hair' : 'clothes', seed = (wantHair ? hair : clothes)[0];
            if (!seed) { part = wantHair ? 'clothes' : 'hair'; seed = (wantHair ? clothes : hair)[0]; }
            if (!seed) { col.part = 'main'; return; }
            // 2) on fait grandir la zone : même teinte, ombres et reflets compris
            const [sL, sa, sb] = seed.lab, sC = Math.hypot(sa, sb), sH = colHue(sa, sb);
            const colored = sC >= 12;
            const yMin = part === 'hair' ? 0 : Math.floor(H * 0.3), yMax = part === 'hair' ? Math.floor(H * 0.8) : H;
            const ok = j => {
                const y = (j / W) | 0;
                if (bg[j] || y < yMin || y >= yMax) return false;
                const L = lab[j * 3], a = lab[j * 3 + 1], b = lab[j * 3 + 2], C = Math.hypot(a, b);
                if (colored) {
                    if (L < 10 || C < Math.max(5, sC * 0.28) || C > sC * 1.9 + 10) return false;
                    if (colHueDiff(colHue(a, b), sH) > 20) return false;
                    return !(colIsSkin([L, a, b]) && colHueDiff(colHue(a, b), sH) > 10);
                }
                return C < 16 && L - sL < 30 && sL - L < 24 && !colIsSkin([L, a, b]);
            };
            // pixels « épais » seulement : la zone ne peut pas s'échapper le long des traits fins (contours, yeux…)
            const E = new Uint8Array(N); for (let i = 0; i < N; i++) E[i] = ok(i) ? 1 : 0;
            const S = new Int32Array((W + 1) * (H + 1));
            for (let y = 0; y < H; y++) { let row = 0; for (let x = 0; x < W; x++) { row += E[y * W + x]; S[(y + 1) * (W + 1) + x + 1] = S[y * (W + 1) + x + 1] + row; } }
            const R = 2, box = (x, y) => { const x0 = Math.max(0, x - R), y0 = Math.max(0, y - R), x1 = Math.min(W, x + R + 1), y1 = Math.min(H, y + R + 1); return { s: S[y1 * (W + 1) + x1] - S[y0 * (W + 1) + x1] - S[y1 * (W + 1) + x0] + S[y0 * (W + 1) + x0], a: (x1 - x0) * (y1 - y0) }; };
            const thick = new Uint8Array(N);
            for (let i = 0; i < N; i++) if (E[i]) { const b2 = box(i % W, (i / W) | 0); thick[i] = b2.s >= b2.a * 0.7 ? 1 : 0; }
            const reg = new Uint8Array(N);
            const grow = px => {
                px.forEach(k => { if (thick[k] && !reg[k]) { reg[k] = 1; stack.push(k); } });
                while (stack.length) {
                    const k = stack.pop(), x = k % W, y = (k / W) | 0;
                    for (const j of [x > 0 ? k - 1 : -1, x < W - 1 ? k + 1 : -1, y > 0 ? k - W : -1, y < H - 1 ? k + W : -1])
                        if (j >= 0 && !reg[j] && thick[j]) { reg[j] = 1; stack.push(j); }
                }
            };
            grow(seed.px);
            // les autres morceaux de même teinte dans la même région (mèches séparées, manches…)
            usable.forEach(c => {
                if (c === seed || c.share < 0.002 || reg[c.px[0]]) return;
                if (part === 'hair' ? (c.cy > 0.5 || c.top > 0.3) : c.cy < 0.6) return;
                if (c.px.filter(k => E[k]).length / c.n < 0.85) return;
                grow(c.px);
                if (!c.px.some(k => reg[k])) c.px.forEach(k => { if (E[k]) reg[k] = 1; }); // petite mèche fine
            });
            // bords : 2 pixels de plus sur les pixels de même teinte (reflets fins, anti-crénelage)
            for (let pass = 0; pass < 2; pass++) {
                const add = [];
                for (let k = 0; k < N; k++) {
                    if (reg[k] || !E[k]) continue;
                    if (!colored && sL < 35 && lab[k * 3] < sL - 3) continue; // cheveux noirs : on garde les contours noirs
                    const x = k % W, y = (k / W) | 0;
                    if ((x > 0 && reg[k - 1]) || (x < W - 1 && reg[k + 1]) || (y > 0 && reg[k - W]) || (y < H - 1 && reg[k + W])) add.push(k);
                }
                add.forEach(k => { reg[k] = 1; });
            }
            // 3) nettoyage : trous bouchés (reflets, boutons, anti-crénelage) pour une zone bien pleine
            const out = new Uint8Array(N); // extérieur de la zone, rempli depuis les bords
            for (let i = 0; i < N; i++) { const x = i % W, y = (i / W) | 0; if (!reg[i] && (x === 0 || y === 0 || x === W - 1 || y === H - 1)) { out[i] = 1; stack.push(i); } }
            while (stack.length) {
                const k = stack.pop(), x = k % W, y = (k / W) | 0;
                for (const j of [x > 0 ? k - 1 : -1, x < W - 1 ? k + 1 : -1, y > 0 ? k - W : -1, y < H - 1 ? k + W : -1])
                    if (j >= 0 && !reg[j] && !out[j]) { out[j] = 1; stack.push(j); }
            }
            let rn = 0; for (let i = 0; i < N; i++) if (reg[i]) rn++;
            // trous intérieurs : petits trous bouchés (si ce n'est pas de la peau : yeux, visage restent intacts)
            const seen = new Uint8Array(N);
            for (let i = 0; i < N; i++) {
                if (reg[i] || out[i] || seen[i]) continue;
                const hole = []; seen[i] = 1; stack.push(i);
                while (stack.length) { const k = stack.pop(), x = k % W, y = (k / W) | 0; hole.push(k); for (const j of [x > 0 ? k - 1 : -1, x < W - 1 ? k + 1 : -1, y > 0 ? k - W : -1, y < H - 1 ? k + W : -1]) if (j >= 0 && !reg[j] && !out[j] && !seen[j]) { seen[j] = 1; stack.push(j); } }
                const skin = hole.filter(k => colIsSkin([lab[k * 3], lab[k * 3 + 1], lab[k * 3 + 2]])).length;
                if (hole.length < rn * 0.04 && skin < hole.length * 0.3) hole.forEach(k => { reg[k] = 1; });
            }
            // petites encoches d'1 à 2 pixels entre la zone et les traits
            for (let pass = 0; pass < 2; pass++) {
                const add = [];
                for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
                    const k = y * W + x;
                    if (reg[k] || bg[k]) continue;
                    if (!colored && sL < 35 && lab[k * 3] < sL - 3) continue;
                    const n = reg[k - 1] + reg[k + 1] + reg[k - W] + reg[k + W];
                    if (n >= 3 || (n === 2 && lab[k * 3] < sL && !colIsSkin([lab[k * 3], lab[k * 3 + 1], lab[k * 3 + 2]]))) add.push(k);
                }
                add.forEach(k => { reg[k] = 1; });
            }
            // 4) couleur de référence : les tons moyens de la zone (sans les ombres ni les reflets)
            const Ls = []; for (let i = 0; i < N; i++) if (reg[i]) Ls.push(lab[i * 3]);
            if (Ls.length < fg * 0.015) { col.part = 'main'; return; }
            Ls.sort((a, b) => a - b);
            const lo = Ls[Math.floor(Ls.length * 0.3)], hi = Ls[Math.floor(Ls.length * 0.7)];
            let L = 0, A = 0, B = 0, n = 0;
            const t = col.zones.length;
            for (let i = 0; i < N; i++) {
                if (!reg[i]) continue;
                labels[i] = t;
                const l = lab[i * 3]; if (l >= lo && l <= hi) { L += l; A += lab[i * 3 + 1]; B += lab[i * 3 + 2]; n++; }
            }
            n = Math.max(1, n);
            col.zones.push({ lab: [L / n, A / n, B / n], share: Ls.length / fg, where: part });
            col.sel = col.target = t;
            col.part = part;
            const q = document.querySelector('.cr-part');
            if (q) q.textContent = part === 'hair' ? 'des cheveux de' : 'des vêtements de';
        }
        // Rendu : le perso garde ses couleurs, sa zone principale prend la couleur choisie
        function colPaint(canvas, opts) {
            if (!col.D || !canvas) return;
            const o2 = opts || {};
            const { W, H, lab } = col.D;
            canvas.width = W; canvas.height = H;
            const cx = canvas.getContext('2d');
            const out = cx.createImageData(W, H), o = out.data, q = col.D.rgba;
            const hex = o2.hex !== undefined ? o2.hex : col.colors[col.target];
            const c = hex ? rgb2lab(...hex2rgb(hex)) : null;
            const zl = col.zones[col.target] ? col.zones[col.target].lab[0] : 50;
            const pulse = o2.pulse || 0;
            for (let i = 0; i < W * H; i++) {
                const z = col.labels[i], L = lab[i * 3];
                let r, g, b;
                if (z !== col.target) { r = q[i * 4]; g = q[i * 4 + 1]; b = q[i * 4 + 2]; }
                else if (c) {
                    // ombres : assombries en proportion (les traits noirs restent noirs) ; reflets : éclaircis
                    const nl = Math.max(0, Math.min(100, L < zl ? c[0] * Math.max(0, L) / Math.max(1, zl) : c[0] + (L - zl) * 0.85));
                    [r, g, b] = lab2rgb(nl, c[1], c[2]);
                } else {
                    const v = Math.round(Math.max(0, Math.min(255, 200 + (L - zl) * 1.2))); r = g = b = v;
                    if (((i % W) + Math.floor(i / W)) % 12 < 6) { r -= 22; g -= 22; b -= 22; }
                }
                if (pulse && z === col.target) { r = r * (1 - pulse); g = g * (1 - pulse) + 240 * pulse; b = b * (1 - pulse) + 255 * pulse; }
                o[i * 4] = r; o[i * 4 + 1] = g; o[i * 4 + 2] = b; o[i * 4 + 3] = q[i * 4 + 3];
            }
            cx.putImageData(out, 0, 0);
        }
        function colRepaint() {
            if (col.raf) return;
            col.raf = requestAnimationFrame(() => {
                col.raf = 0;
                const t = col.flash - Date.now();
                colPaint(document.querySelector('.col-canvas'), { pulse: t > 0 ? 0.55 * Math.abs(Math.sin(t / 160)) : 0 });
                colPickUi();
            });
        }
        function colFlash() {
            col.flash = Date.now() + 1300;
            const step = () => { colRepaint(); if (Date.now() < col.flash + 60) setTimeout(step, 60); };
            step();
        }
        // --- sélecteur : 3 barres verticales (teinte, sombre, clair) + couleurs rapides ---
        function colCur() { return rgb2hex(...hsv2rgb(col.hue, col.s, col.v)); }
        function colPickUi() {
            const h = col.hue, s = col.s, v = col.v;
            const bar = (k, bg, y) => {
                const el = document.querySelector(`.cr-bar[data-k="${k}"]`); if (!el) return;
                if (bg) el.style.background = bg;
                const hd = el.querySelector('i'); if (hd) hd.style.top = (y * 100) + '%';
            };
            bar('h', null, h / 360);
            bar('v', `linear-gradient(180deg,${rgb2hex(...hsv2rgb(h, s, 1))},#000)`, 1 - v);
            bar('s', `linear-gradient(180deg,${rgb2hex(...hsv2rgb(h, 1, v))},${rgb2hex(...hsv2rgb(h, 0, v))})`, 1 - s);
            const sw = document.querySelector('.cr-swatch');
            if (sw) { const cur = col.colors[col.target]; sw.style.background = cur || ''; sw.classList.toggle('empty', !cur); }
            document.querySelectorAll('.cr-presets button').forEach(b => b.classList.toggle('on', b.dataset.c === col.colors[col.target]));
        }
        function colSetHsv(h, s, v) {
            if (col.sent || col.out) return;
            col.hue = h; col.s = s; col.v = v;
            col.colors[col.target] = colCur();
            colRepaint();
        }
        function colPreset(hex) {
            if (col.sent || col.out) return;
            const [h, s, v] = rgb2hsv(...hex2rgb(hex));
            col.hue = s ? h : col.hue; col.s = s; col.v = v;
            col.colors[col.target] = hex;
            colRepaint();
        }
        function colBindBars() {
            document.querySelectorAll('.cr-bar').forEach(el => {
                let on = false;
                const go = e => {
                    const r = el.getBoundingClientRect();
                    const y = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
                    const k = el.dataset.k;
                    if (k === 'h') colSetHsv(Math.min(359.9, y * 360), col.s, col.v);
                    else if (k === 'v') colSetHsv(col.hue, col.s, 1 - y);
                    else colSetHsv(col.hue, 1 - y, col.v);
                };
                el.addEventListener('pointerdown', e => { on = true; try { el.setPointerCapture(e.pointerId); } catch (_) {} go(e); e.preventDefault(); });
                el.addEventListener('pointermove', e => { if (on) { go(e); e.preventDefault(); } });
                el.addEventListener('pointerup', () => { on = false; }); el.addEventListener('pointercancel', () => { on = false; });
            });
        }
        // Écart de couleur CIEDE2000
        function deltaE2000(l1, l2) {
            const [L1, a1, b1] = l1, [L2, a2, b2] = l2, rad = Math.PI / 180;
            const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2), Cm = (C1 + C2) / 2;
            const G = 0.5 * (1 - Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)));
            const a1p = a1 * (1 + G), a2p = a2 * (1 + G);
            const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
            const h = (b, a) => { if (!b && !a) return 0; const x = Math.atan2(b, a) / rad; return x < 0 ? x + 360 : x; };
            const h1p = h(b1, a1p), h2p = h(b2, a2p);
            const dLp = L2 - L1, dCp = C2p - C1p;
            let dhp = 0; if (C1p * C2p) { dhp = h2p - h1p; if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360; }
            const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(dhp / 2 * rad);
            const Lpm = (L1 + L2) / 2, Cpm = (C1p + C2p) / 2;
            let hpm = h1p + h2p; if (C1p * C2p) { hpm = Math.abs(h1p - h2p) > 180 ? (h1p + h2p + (h1p + h2p < 360 ? 360 : -360)) / 2 : (h1p + h2p) / 2; }
            const T = 1 - 0.17 * Math.cos((hpm - 30) * rad) + 0.24 * Math.cos(2 * hpm * rad) + 0.32 * Math.cos((3 * hpm + 6) * rad) - 0.2 * Math.cos((4 * hpm - 63) * rad);
            const dTh = 30 * Math.exp(-(((hpm - 275) / 25) ** 2));
            const Rc = 2 * Math.sqrt(Cpm ** 7 / (Cpm ** 7 + 25 ** 7));
            const Sl = 1 + 0.015 * (Lpm - 50) ** 2 / Math.sqrt(20 + (Lpm - 50) ** 2), Sc = 1 + 0.045 * Cpm, Sh = 1 + 0.015 * Cpm * T;
            const Rt = -Math.sin(2 * dTh * rad) * Rc;
            return Math.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh));
        }
        function colTargetHex() { const z = col.zones[col.target]; return z ? rgb2hex(...lab2rgb(...z.lab)) : null; }
        function colScore() { // ressemblance en %, 2 décimales
            const z = col.zones[col.target], hex = col.colors[col.target];
            if (!z || !hex) return 0;
            const dE = deltaE2000(rgb2lab(...hex2rgb(hex)), z.lab);
            return Math.round(10000 * Math.pow(Math.max(0, 1 - dE / 40), 1.5)) / 100;
        }
        const colPct = p => (p == null ? '—' : (+p).toFixed(2).replace('.', ',') + '%');
        const colNote = colPct;
        function colVerdict(pct) {
            return pct >= 95 ? '🤯 Parfait !' : pct >= 80 ? '🔥 Incroyable' : pct >= 60 ? '👏 Très proche' : pct >= 40 ? '🙂 Pas mal' : pct >= 20 ? '😬 Bof' : '💀 Raté';
        }
        function colSubmit(auto) {
            if (col.sent || col.out || !col.zones.length) return;
            col.sent = true;
            clearTimeout(col.autoT);
            const touched = !!col.colors[col.target];
            const raw = document.createElement('canvas'); colPaint(raw);
            const big = document.createElement('canvas'); big.width = raw.width; big.height = raw.height;
            const bx = big.getContext('2d'); bx.fillStyle = '#ffffff'; bx.fillRect(0, 0, big.width, big.height); bx.drawImage(raw, 0, 0);
            col.myUrl = touched ? big.toDataURL('image/jpeg', 0.85) : null;
            const th = document.createElement('canvas'); const s = 220 / Math.max(big.width, big.height);
            th.width = Math.round(big.width * s); th.height = Math.round(big.height * s);
            th.getContext('2d').drawImage(big, 0, 0, th.width, th.height);
            col.myPct = touched ? colScore() : 0;
            socket.emit('arc_color', { roomCode: currentRoomCode, pct: col.myPct, thumb: touched ? th.toDataURL('image/jpeg', 0.72) : null, hex: col.colors[col.target] || null, target: colTargetHex() });
            const btn = document.querySelector('.col-submit'); if (btn) { btn.disabled = true; btn.textContent = auto ? '⏱️ Temps écoulé !' : '✅ Envoyé !'; }
        }
        function colHearts(p, max) {
            let h = '';
            for (let i = 0; i < max; i++) h += i < p.lives ? '❤️' : '🖤';
            return h;
        }
        function colHeartsBar(q) {
            if (!q.duel) return '';
            return `<div class="cr-hearts">${q.players.map(p => `<span class="${p.lives > 0 ? '' : 'out'}${p.id === socket.id ? ' me' : ''}${p.lost ? ' lost' : ''}"><b>${v7esc(p.name)}</b>${p.lives > 0 ? colHearts(p, q.maxLives || 3) : '💀 éliminé'}${p.lost ? '<em>-❤️</em>' : ''}</span>`).join('')}</div>`;
        }
        const COL_PRESETS = ['#ffffff', '#6b6b6b', '#000000', '#7a4a24', '#ffd9a8', '#ff5fb0', '#ff8a00', '#0b2a6e', '#2e8b3a'];
        function arcRenderColor(q, stage) {
            const key = q.round + '|' + (q.phase === 'playing' ? 'p' : 'r');
            if (col.key === key) return;
            const newRound = !col.key.startsWith(q.round + '|');
            col.key = key;
            clearInterval(col.tick);
            const me = q.players.find(p => p.id === socket.id) || {};
            if (q.phase === 'playing') {
                if (newRound) { col.part = null; col.zones = []; col.colors = {}; col.sel = 0; col.target = 0; col.sent = false; col.myUrl = null; col.myPct = null; col.D = null; col.hue = 215; col.s = 0.7; col.v = 0.8; }
                col.round = q.round;
                col.out = !!(q.duel && !(me.lives > 0));
                const info = q.stage.color || {};
                stage.innerHTML = `<div class="cr-box">${colHeartsBar(q)}
                    <div class="cr-wrap">
                        <div class="cr-pick">
                            <div class="cr-bars"><div class="cr-bar hue" data-k="h"><i></i></div><div class="cr-bar" data-k="v"><i></i></div><div class="cr-bar" data-k="s"><i></i></div></div>
                            <div class="cr-mid"><div class="cr-timer">--</div><div class="cr-swatch empty"></div>
                                <div class="cr-presets">${COL_PRESETS.map(c => `<button data-c="${c}" style="background:${c}" onclick="colPreset('${c}')"></button>`).join('')}</div></div>
                        </div>
                        <div class="cr-right">
                            <div class="cr-q">Quelle est la couleur <span class="cr-part">de</span> :<b>${v7esc(info.name || '?')}</b><small>${v7esc(info.anime || '')}</small></div>
                            <div class="col-canvas-wrap"><canvas class="col-canvas" title="Touche pour voir la zone"></canvas><div class="arc-loading col-load" style="position:absolute;inset:0;"><div class="arc-spin"></div><div>Préparation…</div></div></div>
                            ${col.out ? '<div class="cr-out">💀 Tu es éliminé : regarde les autres jouer !</div>' : '<button class="btn-action col-submit" onclick="colSubmit(false)">Soumettre</button>'}
                        </div>
                    </div></div>`;
                colBindBars(); colPickUi();
                stage.querySelector('.col-canvas').addEventListener('click', () => colFlash());
                const localEnd = Date.now() + (q.endsAt - q.serverNow);
                const tick = () => { const t = document.querySelector('.cr-timer'); if (!t) return clearInterval(col.tick); const sec = Math.max(0, Math.ceil((localEnd - Date.now()) / 1000)); t.textContent = sec; t.classList.toggle('hurry', sec <= 5); };
                tick(); col.tick = setInterval(tick, 250);
                const myKey = key;
                arcLoadImage(q.stage.img).then(img => {
                    if (col.key !== myKey) return;
                    const load = stage.querySelector('.col-load');
                    if (!img || !colBuild(img, Math.min(360, Math.max(240, (stage.clientWidth || 360) - 40)))) { if (load) load.innerHTML = 'Image indisponible 😕'; return; }
                    if (load) load.remove();
                    col.img = img;
                    colRepaint(); colFlash();
                });
                clearTimeout(col.autoT);
                if (!col.out) col.autoT = setTimeout(() => colSubmit(true), Math.max(0, localEnd - Date.now() - 900));
                return;
            }
            // révélation : la vraie image, puis la version de chaque joueur avec son %
            const gal = q.stage.gallery || [];
            const byId = Object.fromEntries(gal.map(g => [g.id, g]));
            const inRound = q.players.filter(p => !q.duel || p.lives > 0 || p.lost || byId[p.id]);
            const cards = inRound.map(p => ({ p, g: byId[p.id] })).sort((a, b) => ((b.g || {}).pct || 0) - ((a.g || {}).pct || 0));
            stage.innerHTML = `<div class="cr-box">${colHeartsBar(q)}
                <div class="cr-real"><img src="${v7esc(q.stage.img || '')}" alt=""><div><small>La vraie couleur ${col.part === 'hair' ? 'des cheveux de' : col.part === 'clothes' ? 'des vêtements de' : 'de'}</small><b>${v7esc((q.stage.color || {}).name || q.answer || '')}</b>
                ${me.pct != null ? `<div class="cr-mine">${colPct(me.pct)}</div><div>${colVerdict(me.pct)}</div>` : ''}</div></div>
                <div class="cr-cards">${cards.map(({ p, g }) => `<div class="${p.id === socket.id ? 'me' : ''}${p.lost ? ' lost' : ''}">
                    ${g && g.hex ? `<canvas class="cr-paint" data-hex="${v7esc(g.hex)}"></canvas>` : g && g.thumb ? `<img src="${g.thumb}" alt="">` : '<div class="cr-none">😶<br>Pas de réponse</div>'}
                    <span class="cr-pct">${g ? colPct(g.pct) : '0,00%'}</span>
                    <b>${v7esc(p.name)}</b>${p.lost ? '<em>-❤️</em>' : ''}</div>`).join('')}</div></div>`;
            // chaque carte : le perso redessiné avec la couleur choisie par le joueur
            stage.querySelectorAll('.cr-paint').forEach(cv => {
                if (!col.D) { cv.outerHTML = `<div class="cr-none" style="background:${cv.dataset.hex}"></div>`; return; }
                colPaint(cv, { hex: cv.dataset.hex });
            });
        }
        function colAfterRender(q) {
            const result = document.getElementById('arc-result');
            if (!result) return;
            if (q.phase === 'playing') {
                const me = q.players.find(p => p.id === socket.id) || {};
                result.style.color = me.done ? 'var(--accent-cyan)' : 'var(--text-color)';
                result.textContent = q.duel && !(me.lives > 0) ? '💀 Éliminé' : me.done ? 'Couleur envoyée ! Attends les autres…' : (q.duel ? 'Le moins proche de la vraie couleur perd un cœur !' : 'Trouve la vraie couleur : le plus proche gagne !');
            } else if (q.phase === 'reveal') {
                const me = q.players.find(p => p.id === socket.id) || {};
                const gal = (q.stage && q.stage.gallery) || [];
                result.style.color = 'var(--accent-yellow)';
                result.textContent = gal.length ? `🏆 ${gal[0].name} est le plus proche (${colPct(gal[0].pct)})` + ((q.players.filter(p => p.lost).length) ? ` • 💔 ${q.players.filter(p => p.lost).map(p => p.name).join(', ')} perd un cœur` : '') + (me.gained ? ` • tu gagnes +${me.gained}` : '') : 'Personne n\'a colorié…';
            }
        }
        (function () {
            const orig = window.arcRenderStage;
            if (typeof orig !== 'function') return;
            window.arcRenderStage = function (q) {
                if (q && q.game === 'couleur' && (q.phase === 'playing' || q.phase === 'reveal')) {
                    const stage = document.getElementById('arc-stage');
                    try { arcDestroyVideo(); } catch (_) {}
                    arcStageKey = 'couleur|' + q.round + '|' + q.phase;
                    return arcRenderColor(q, stage);
                }
                if (q && (q.game !== 'couleur' || q.phase === 'finished' || q.phase === 'loading')) { if (q.phase !== 'loading' || q.round === 0) col.key = ''; }
                return orig.apply(this, arguments);
            };
        })();


        /* =====================================================================
           DEVINE LE PERSO : questions oui / non illimitées
           ===================================================================== */
        const gss = { state: null, secret: null, searchT: null, tryT: null, feedLen: 0 };
        const GUESS_ANS = { yes: ['✅ Oui', '#00ff88'], no: ['❌ Non', 'var(--accent-pink)'], idk: ['🤷 Je sais pas', 'var(--text-muted)'], close: ['🔥 Presque', '#ff9a3c'] };
        function guessShow() {
            const panel = document.getElementById('guess-room');
            if (!panel || panel.style.display === 'block') return;
            hideAllPanels();
            panel.style.display = 'block';
        }
        function guessIsChooser() { return gss.state && gss.state.chooserId === socket.id; }
        function guessRender() {
            const q = gss.state;
            if (!q) return;
            lastHostId = q.hostId;
            q.players.forEach(p => { if (p.cos) cosById[p.id] = p.cos; });
            const me = guessIsChooser();
            document.getElementById('guess-status').textContent = q.phase === 'finished' ? '🏁 Partie terminée' : `Tour ${q.tour}/${q.tours} • ${q.chooserName} ${q.phase === 'choosing' ? 'choisit son perso' : 'fait deviner'}`;
            document.getElementById('guess-count').textContent = q.phase === 'asking' || q.phase === 'reveal' ? `❓ ${q.questions} question${q.questions > 1 ? 's' : ''}` : '';
            // carte du haut
            const top = document.getElementById('guess-top');
            if (q.phase === 'choosing') {
                if (me) {
                    if (!top.__choose) {
                        top.__choose = true;
                        top.innerHTML = `<div class="gs-card"><b>🕵️ Choisis ton perso</b><div class="tl-hint">Les autres vont te poser des questions oui / non pour le trouver.</div>
                            <input class="v7-input" id="guess-search" placeholder="Cherche un perso (ex : Gojo, Luffy…)" autocomplete="off" oninput="guessSearch()">
                            <div class="av-grid" id="guess-results"></div>
                            <details style="margin-top:8px;"><summary style="cursor:pointer;color:var(--accent-cyan);font-weight:700;">✍️ Perso pas dans la liste ? Écris-le</summary>
                            <input class="v7-input" id="guess-custom" maxlength="60" placeholder="Nom du perso" style="margin-top:8px;"><input class="v7-input" id="guess-custom-anime" maxlength="60" placeholder="Anime (facultatif)">
                            <button class="btn-action" style="margin-top:0;" onclick="guessPickCustom()">Valider ce perso</button>
                            <div class="tl-hint">Pour un perso libre, c'est toi qui valides la bonne réponse.</div></details></div>`;
                        guessSearch();
                    }
                } else { top.__choose = false; top.innerHTML = `<div class="gs-card" style="text-align:center;"><div style="font-size:2.6rem;">🤔</div><b>${v7esc(q.chooserName)}</b> choisit un perso…</div>`; }
            } else {
                top.__choose = false;
                if (q.phase === 'asking' && me && gss.secret) top.innerHTML = `<div class="gs-card gs-secret">${gss.secret.img ? `<img src="${v7esc(gss.secret.img)}" alt="">` : '<div style="font-size:2.4rem;">🎴</div>'}<div><div class="tl-hint" style="text-align:left;">Ton perso secret</div><b>${v7esc(gss.secret.name)}</b><div style="color:var(--accent-cyan);font-size:.85rem;">${v7esc(gss.secret.anime || '')}</div><div class="tl-hint" style="text-align:left;">Réponds aux questions ci-dessous. Si quelqu'un trouve avec une autre orthographe, appuie sur « ✅ C'est ça ».</div></div></div>`;
                else if (q.phase === 'asking') top.innerHTML = `<div class="gs-card" style="text-align:center;"><div style="font-size:2rem;">🕵️</div>Trouve le perso de <b>${v7esc(q.chooserName)}</b> ! Questions illimitées.</div>`;
                else if (q.reveal) top.innerHTML = `<div class="gs-card gs-secret">${q.reveal.img ? `<img src="${v7esc(q.reveal.img)}" alt="">` : '<div style="font-size:2.4rem;">🎴</div>'}<div><div class="tl-hint" style="text-align:left;">C'était</div><b style="font-size:1.3rem;color:var(--accent-yellow)">${v7esc(q.reveal.name)}</b><div style="color:var(--accent-cyan)">${v7esc(q.reveal.anime || '')}</div><div style="margin-top:6px;font-weight:800;">${q.reveal.finder ? `🎯 Trouvé par ${v7esc(q.reveal.finder)} en ${q.questions} question${q.questions > 1 ? 's' : ''} !` : '🏳️ Personne n\'a trouvé !'}</div></div></div>`;
                else if (q.phase === 'finished') {
                    const t3 = [...q.players].sort((a, b) => b.score - a.score).slice(0, 3);
                    top.innerHTML = `<div class="gs-card" style="text-align:center;"><div style="font-size:3rem;">🏆</div><div style="font-family:'Bangers',cursive;font-size:1.8rem;color:var(--accent-yellow)">${v7esc((q.winnerNames || []).join(' & ') || '—')}</div>${t3.map((p, i) => `<div>${['🥇', '🥈', '🥉'][i]} ${cosNameHtml(p.name, p.cos)} • ${p.score} pts</div>`).join('')}</div>`;
                    const mine = q.players.find(p => p.id === socket.id);
                    if (window.__guessFin !== q.totalTurns + '|' + q.turn && mine && (q.winnerNames || []).includes(mine.name)) { window.__guessFin = q.totalTurns + '|' + q.turn; confetti(); }
                }
            }
            // fil des questions
            const feed = document.getElementById('guess-feed');
            const canAnswer = me && q.phase === 'asking';
            feed.innerHTML = (q.feed || []).map(f => {
                if (f.type === 'sys') return `<div class="gs-f sys">${v7esc(f.text)}</div>`;
                if (f.type === 'g') {
                    const res = f.ok === true ? '<span class="gs-a" style="color:#00ff88">✅ OUI !</span>' : f.ok === false ? '<span class="gs-a" style="color:var(--accent-pink)">❌ Non</span>'
                        : canAnswer ? `<span class="gs-btns"><button onclick="guessValidate(${f.id})" style="border-color:#00ff88">✅ Oui, c'est ça</button><button onclick="guessDeny(${f.id})" style="border-color:var(--accent-pink)">❌ Non</button></span>`
                        : '<span class="gs-a" style="color:var(--text-muted)">⏳</span>';
                    return `<div class="gs-f g${f.ok ? ' ok' : ''}${f.ok == null ? ' wait' : ''}">🎯 <b>${v7esc(f.name)}</b> : c'est <b>${v7esc(f.text)}</b> ? ${res}${canAnswer && f.ok === false ? ` <button class="gs-ok" onclick="guessValidate(${f.id})">↩️ En fait oui</button>` : ''}</div>`;
                }
                const a = f.answer ? GUESS_ANS[f.answer] : null;
                return `<div class="gs-f q${f.answer ? '' : ' wait'}"><b>${v7esc(f.name)}</b> : ${v7esc(f.text)} ${a ? `<span class="gs-a" style="color:${a[1]}">${a[0]}</span>` : canAnswer ? `<span class="gs-btns">${Object.entries(GUESS_ANS).map(([k, v]) => `<button onclick="guessAnswer(${f.id},'${k}')" style="border-color:${v[1]}">${v[0]}</button>`).join('')}</span>` : '<span class="gs-a" style="color:var(--text-muted)">⏳</span>'}</div>`;
            }).join('') || '<div class="tl-hint">Pas encore de question.</div>';
            if ((q.feed || []).length !== gss.feedLen) { gss.feedLen = (q.feed || []).length; feed.scrollTop = feed.scrollHeight; if (me && q.phase === 'asking' && (q.feed || []).some(f => (f.type === 'q' && !f.answer) || (f.type === 'g' && f.ok == null))) try { sfxTouche && sfxOn && sfxTouche(); } catch (_) {} }
            // saisie
            const asking = q.phase === 'asking' && !me;
            document.getElementById('guess-inputs').style.display = asking ? 'flex' : 'none';
            const myP = q.players.find(p => p.id === socket.id) || {};
            const gu = document.getElementById('guess-giveup');
            if (gu) { gu.style.display = asking ? '' : 'none'; gu.textContent = `🏳️ ${myP.gaveUp ? 'Annuler l\'abandon' : 'Abandonner'} (${q.giveup}/${q.giveupNeed})`; }
            const sk = document.getElementById('guess-skip');
            if (sk) sk.style.display = q.hostId === socket.id && (q.phase === 'asking' || q.phase === 'choosing') ? '' : 'none';
            // scores
            document.getElementById('guess-scores').innerHTML = [...q.players].sort((a, b) => b.score - a.score).map(p => `<div class="quote-score"><span class="pl-name">${avatarHtml(p.name, p.cos)}${cosNameHtml(p.name, p.cos)}${p.choosing ? ' 🕵️' : ''}${p.gaveUp ? ' 🏳️' : ''}${p.offline ? ' 📡' : ''}${p.gained ? ` <small style="color:#00ff88">+${p.gained}</small>` : ''}</span><strong style="color:var(--accent-yellow)">${p.score} pts</strong></div>`).join('');
            document.getElementById('guess-end').style.display = q.phase === 'finished' ? 'flex' : 'none';
            const rp = document.getElementById('guess-replay'); if (rp) rp.style.display = q.hostId === socket.id ? '' : 'none';
        }
        async function guessSearch() {
            clearTimeout(gss.searchT);
            gss.searchT = setTimeout(async () => {
                const i = document.getElementById('guess-search');
                const d = await v7get('/api/avatar/search?q=' + encodeURIComponent(i ? i.value.trim() : ''));
                const grid = document.getElementById('guess-results');
                if (!grid) return;
                grid.innerHTML = d && d.results && d.results.length ? d.results.map(r => `<div class="av-item" data-u="${v7esc(r.u)}" data-n="${v7esc(r.name)}" onclick="guessPick(this)"><img src="/api/avatar/img?u=${encodeURIComponent(r.u)}&n=${encodeURIComponent(r.name)}" alt="" loading="lazy" decoding="async" onerror="this.style.opacity=.2">${v7esc(r.name)}<br><small style="color:var(--text-muted)">${v7esc(r.anime)}</small></div>`).join('') : '<p class="tl-hint">Aucun perso trouvé : écris-le en dessous.</p>';
            }, 250);
        }
        function guessPick(el) { socket.emit('guess_pick', { roomCode: currentRoomCode, u: el.dataset.u, name: el.dataset.n }); }
        function guessPickCustom() {
            const n = (document.getElementById('guess-custom') || {}).value || '';
            if (n.trim().length < 2) return toast('Écris le nom du perso', 'var(--accent-pink)');
            socket.emit('guess_pick', { roomCode: currentRoomCode, custom: n.trim(), name: ((document.getElementById('guess-custom-anime') || {}).value || '').trim() });
        }
        function guessAsk() {
            const i = document.getElementById('guess-q');
            const t = i && i.value.trim();
            if (!t) return;
            socket.emit('guess_ask', { roomCode: currentRoomCode, text: t });
            i.value = '';
        }
        function guessTry() {
            const i = document.getElementById('guess-try');
            const t = i && i.value.trim();
            if (!t) return;
            socket.emit('guess_try', { roomCode: currentRoomCode, text: t });
            i.value = '';
            document.getElementById('guess-sugg').innerHTML = '';
        }
        function guessTrySugg() {
            clearTimeout(gss.tryT);
            gss.tryT = setTimeout(async () => {
                const i = document.getElementById('guess-try'), box = document.getElementById('guess-sugg');
                const v = i ? i.value.trim() : '';
                if (!box) return;
                if (v.length < 2) { box.innerHTML = ''; return; }
                const d = await v7get('/api/avatar/search?q=' + encodeURIComponent(v));
                box.innerHTML = d && d.results ? d.results.slice(0, 6).map(r => `<button onclick="document.getElementById('guess-try').value=this.dataset.n;guessTry()" data-n="${v7esc(r.name)}">${v7esc(r.name)} <small>${v7esc(r.anime)}</small></button>`).join('') : '';
            }, 250);
        }
        function guessAnswer(id, a) { socket.emit('guess_answer', { roomCode: currentRoomCode, id, answer: a }); }
        function guessValidate(id) { socket.emit('guess_validate', { roomCode: currentRoomCode, id }); }
        function guessDeny(id) { socket.emit('guess_deny', { roomCode: currentRoomCode, id }); }
        socket.on('guess_state', q => {
            if (!q || !currentRoomCode) return;
            const prev = gss.state;
            if (!prev || prev.turn !== q.turn) gss.secret = null;
            if (q.phase === 'reveal' && (!prev || prev.phase !== 'reveal')) { if (q.reveal && q.reveal.finder) fxGood(); }
            gss.state = q;
            guessShow();
            guessRender();
        });
        socket.on('guess_secret', d => { gss.secret = d; guessRender(); });
        socket.on('guess_notice', d => { if (d && d.text) toast(v7esc(d.text), 'var(--accent-yellow)'); });
        socket.on('guess_closed', () => { returningToWaitingRoom = true; gss.state = null; const p = document.getElementById('guess-room'); if (p) p.style.display = 'none'; });
        socket.on('connect', () => { if (currentRoomCode && gss.state) setTimeout(() => socket.emit('guess_sync', { roomCode: currentRoomCode }), 600); });
        (function () {
            const orig = window.hideAllPanels;
            window.hideAllPanels = function () { const r = orig.apply(this, arguments); const d = document.getElementById('guess-room'); if (d) d.style.display = 'none'; return r; };
        })();


        /* =====================================================================
           ADMIN, SIGNALEMENTS, MAINTENANCE, THÈMES
           ===================================================================== */
        let SITE_STATE = { maintenance: { on: false, msg: '' }, theme: 'auto', luck: { admins: false, players: false } };
        const lastStates = {};
        ['arc_state', 'bt_state', 'quote_state', 'dle_state', 'draw_state', 'guess_state', 'rg_state'].forEach(ev => socket.on(ev, d => { lastStates[ev] = { at: Date.now(), d }; }));

        // --- bannière maintenance + thème ---
        function applySite(s) {
            SITE_STATE = s || SITE_STATE;
            const ban = document.getElementById('site-banner');
            if (ban) { const m = SITE_STATE.maintenance || {}; ban.style.display = m.on ? 'block' : 'none'; ban.textContent = '🛠️ ' + (m.msg || 'Mise à jour du site en cours, les parties peuvent être coupées.'); document.body.style.paddingTop = m.on ? (ban.offsetHeight || 36) + 'px' : ''; }
            const th = siteTheme();
            document.documentElement.classList.toggle('theme-halloween', th === 'halloween');
            document.documentElement.classList.toggle('theme-noel', th === 'noel');
            const card = document.getElementById('theme-card');
            if (card) {
                if (th === 'halloween' || th === 'noel') {
                    const h = th === 'halloween';
                    card.style.display = 'block';
                    card.innerHTML = `<h3 style="color:var(--accent-yellow);margin-bottom:5px;">${h ? '🎃 Spécial Halloween' : '🎄 Spécial Noël'} <span class="quote-new">ÉVÈNEMENT</span></h3>
                        <p style="margin:0 0 12px;font-size:.85rem;">${h ? 'Démons, shinigamis, goules et monstres : devine les persos les plus effrayants !' : 'Persos de glace, rennes et esprit de Noël : devine les persos de saison !'}</p>
                        <div style="display:flex;gap:8px;flex-wrap:wrap;"><button class="btn-action" style="margin-top:0;flex:1;" onclick="createRoom('arcade','pixel:${th}')">🖼️ Pixel</button><button class="btn-action" style="margin-top:0;flex:1;" onclick="createRoom('arcade','silhouette:${th}')">👤 Silhouette</button></div>`;
                } else card.style.display = 'none';
            }
            themeParticles();
            const f = document.getElementById('adm-maint'); if (f) { f.checked = !!(SITE_STATE.maintenance || {}).on; }
        }
        socket.on('site_settings', applySite);
        // Thème actif : « auto » = Halloween en octobre (jusqu'au 2 novembre), Noël du 1er décembre au 6 janvier
        function siteTheme() {
            const t = SITE_STATE.theme;
            if (t === 'halloween' || t === 'noel') return t;
            if (t !== 'auto') return 'none';
            const d = new Date(), m = d.getMonth(), day = d.getDate();
            if (m === 9 || (m === 10 && day <= 2)) return 'halloween';
            if (m === 11 || (m === 0 && day <= 6)) return 'noel';
            return 'none';
        }
        // Décor fixe derrière le site (lune, chauves-souris, toiles, cimetière / guirlande, sapins, chalet) : rien ne tombe
        function decoWeb() {
            let d = '';
            const ang = [0, 18, 36, 54, 72, 90].map(a => a * Math.PI / 180), R = 190;
            ang.forEach(a => { d += `M0 0L${(Math.cos(a) * R).toFixed(1)} ${(Math.sin(a) * R).toFixed(1)}`; });
            [34, 62, 92, 124, 158].forEach(r => {
                ang.forEach((a, i) => {
                    const x = Math.cos(a) * r, y = Math.sin(a) * r;
                    if (!i) { d += `M${x.toFixed(1)} ${y.toFixed(1)}`; return; }
                    const m = (a + ang[i - 1]) / 2, rr = r * 0.86;
                    d += `Q${(Math.cos(m) * rr).toFixed(1)} ${(Math.sin(m) * rr).toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)}`;
                });
            });
            return `<svg viewBox="0 0 190 190"><path d="${d}" fill="none" stroke="rgba(230,225,255,.55)" stroke-width="1"/></svg>`;
        }
        function decoStars(n) {
            let h = '';
            for (let i = 0; i < n; i++) h += `<i style="left:${(i * 37.3) % 100}%;top:${(i * 53.7) % 100}%;animation-delay:-${(i * 0.7) % 3}s;${i % 4 ? '' : 'width:3px;height:3px;'}"></i>`;
            return `<div class="dk-stars">${h}</div>`;
        }
        const DECO_BAT = '<path class="dk-bat" d="M0 6C3 1 7 0 9 3C10 1 11 0 12 2L13 0L14 2C15 0 16 1 17 3C19 0 23 1 26 6C23 4 21 5 20 7C18 5 16 6 15 8L13 11L11 8C10 6 8 5 6 7C5 5 3 4 0 6Z" fill="#12081c"/>';
        function decoPumpkin(x, y, s, cls) {
            return `<g transform="translate(${x} ${y}) scale(${s})">
                <path d="M-1-15q2-6 6-8" stroke="#2f5a1f" stroke-width="3" fill="none"/>
                <ellipse cx="-9" cy="0" rx="11" ry="14" fill="#d95f00"/><ellipse cx="9" cy="0" rx="11" ry="14" fill="#d95f00"/><ellipse cx="0" cy="0" rx="11" ry="15" fill="#ff7a00"/>
                <g class="dk-glow ${cls || ''}" fill="#ffd23f"><path d="M-9-5l4-5 3 5z"/><path d="M9-5l-4-5-3 5z"/><path d="M-10 4h20l-3 5-2-2-2 3-2-3-2 3-2-3-2 2z"/></g></g>`;
        }
        function decoTomb(x, y, w, h) {
            return `<g transform="translate(${x} ${y})"><path d="M0 ${h}V${w / 2}A${w / 2} ${w / 2} 0 0 1 ${w} ${w / 2}V${h}Z" fill="#2a2140"/><text x="${w / 2}" y="${w / 2 + 6}" font-size="${w / 3.2}" text-anchor="middle" fill="#4a3d66" font-family="serif" font-weight="700">RIP</text></g>`;
        }
        function decoTree(x, y, s, fill) {
            return `<g transform="translate(${x} ${y}) scale(${s})" fill="none" stroke="${fill}" stroke-linecap="round">
                <path d="M0 0V-60" stroke-width="7"/><path d="M0-30L-20-52L-30-54M-20-52L-22-66" stroke-width="4"/><path d="M0-42L18-64L30-66M18-64L20-78" stroke-width="4"/><path d="M0-58L-8-78M0-58L6-84" stroke-width="3"/></g>`;
        }
        function decoPine(x, y, s) {
            return `<g transform="translate(${x} ${y}) scale(${s})"><rect x="-3" y="-8" width="6" height="10" fill="#3b2a1e"/>
                <path d="M0-70L-14-46H-6L-20-26H-8L-26-6H26L8-26H20L6-46H14Z" fill="#0f3b2b"/>
                <path d="M0-70L-9-55L-3-57L0-52L4-57L9-55Z M-11-31L-4-33L0-29L5-33L12-31L7-38H-7Z M-16-10L-6-13L0-9L7-13L17-10L11-17H-11Z" fill="#e9f2ff" opacity=".9"/></g>`;
        }
        function decoHalloween() {
            const tombs = decoTomb(292, 148, 22, 30) + decoTomb(326, 156, 18, 24) + decoTomb(470, 150, 20, 28) + decoTomb(872, 150, 22, 30) + decoTomb(905, 158, 16, 22)
                + '<path d="M388 178V150M380 158H396" stroke="#2a2140" stroke-width="5"/><path d="M1010 176V152M1003 159H1017" stroke="#2a2140" stroke-width="5"/>';
            const house = `<g transform="translate(640 60)">
                <path d="M10 70V40L55 8L100 40V70Z" fill="#150c22"/><path d="M60 70V22H86V70Z" fill="#150c22"/><path d="M56 24L73-18L90 24Z" fill="#150c22"/>
                <path d="M-4 46L55 0L114 46H104L55 10L6 46Z" fill="#1f1233"/>
                <rect x="22" y="44" width="12" height="14" fill="#ffb347" class="dk-glow"/><rect x="42" y="44" width="12" height="14" fill="#ffb347" class="dk-glow b"/>
                <rect x="67" y="30" width="12" height="12" fill="#ffcc66" class="dk-glow b"/><path d="M68 5H78V14H68Z" fill="#ff9a3c" class="dk-glow"/>
                <path d="M26 44V58M22 51H34M46 44V58M42 51H54" stroke="#150c22" stroke-width="1.5"/></g>`;
            const fence = Array.from({ length: 16 }, (_, i) => `<path d="M${520 + i * 7} 176V160L${521.5 + i * 7} 156L${523 + i * 7} 160V176" fill="#1a1028"/>`).join('') + '<path d="M518 164H632M518 172H632" stroke="#1a1028" stroke-width="2"/>';
            const land = `<svg class="dk-land" viewBox="0 0 1200 200" preserveAspectRatio="xMidYMax slice">
                <path d="M0 200V132Q140 104 300 124T600 118T900 128T1200 110V200Z" fill="#1c1030"/>
                ${decoTree(150, 128, 1.2, '#1c1030')}${decoTree(1060, 116, 1.4, '#1c1030')}${house}
                <path d="M0 200V170Q200 150 400 164T800 158T1200 166V200Z" fill="#0d0716"/>
                ${decoTree(250, 170, .9, '#0d0716')}${decoTree(960, 166, 1, '#0d0716')}
                ${tombs}${fence}
                ${decoPumpkin(430, 176, 1, '')}${decoPumpkin(458, 182, .7, 'b')}${decoPumpkin(560, 184, .8, 'b')}${decoPumpkin(790, 178, 1.1, '')}${decoPumpkin(1120, 180, .9, 'b')}${decoPumpkin(70, 182, .9, '')}
            </svg>`;
            const bats = `<svg class="dk-bats" viewBox="0 0 260 170">
                <g class="dk-batg"><g transform="translate(40 40) scale(1.6)">${DECO_BAT}</g></g>
                <g class="dk-batg"><g transform="translate(190 20) scale(1.1)">${DECO_BAT}</g></g>
                <g class="dk-batg"><g transform="translate(150 120) scale(.9)">${DECO_BAT}</g></g></svg>`;
            const spider = `<div class="dk-spider"><svg viewBox="0 0 22 22"><g stroke="#3a2656" stroke-width="1.6" fill="none"><path d="M8 9L2 4M8 11L1 10M8 13L2 17M9 14L4 21M14 9L20 4M14 11L21 10M14 13L20 17M13 14L18 21"/></g><ellipse cx="11" cy="9" rx="3.5" ry="3.5" fill="#2c1d44"/><ellipse cx="11" cy="14" rx="5" ry="5.5" fill="#2c1d44"/><circle cx="10" cy="8.5" r=".8" fill="#ff3b3b"/><circle cx="12" cy="8.5" r=".8" fill="#ff3b3b"/></svg></div>`;
            return decoStars(40) + '<div class="dk-moon"></div>' + bats + `<div class="dk-web l">${decoWeb()}</div><div class="dk-web r">${decoWeb()}</div>` + spider + land + '<div class="dk-fog"></div><div class="dk-fog b"></div>';
        }
        function decoNoel() {
            const pines = [[90, 150, 1.1], [140, 158, .8], [330, 150, 1], [370, 160, .7], [820, 152, 1.2], [870, 160, .8], [1030, 146, 1.1], [1080, 156, .8], [560, 170, .6]].map(p => decoPine(...p)).join('');
            const cabin = `<g transform="translate(640 110)">
                <path d="M0 50V22H80V50Z" fill="#3b2418"/><path d="M-8 24L40-6L88 24Z" fill="#2a1a12"/><path d="M-10 25L40-8L90 25L86 27L40-3L-6 27Z" fill="#eef5ff"/>
                <rect x="58" y="-4" width="10" height="16" fill="#2a1a12"/><rect x="56" y="-7" width="14" height="4" fill="#eef5ff"/>
                <rect x="12" y="28" width="16" height="13" fill="#ffcf6b" class="dk-glow"/><rect x="50" y="28" width="16" height="13" fill="#ffcf6b" class="dk-glow b"/>
                <path d="M20 28V41M12 34.5H28M58 28V41M50 34.5H66" stroke="#3b2418" stroke-width="1.5"/><rect x="32" y="30" width="12" height="20" fill="#2a1a12"/></g>`;
            const land = `<svg class="dk-land" viewBox="0 0 1200 200" preserveAspectRatio="xMidYMax slice">
                <path d="M0 200V140Q160 112 330 132T640 124T920 136T1200 118V200Z" fill="#2d4260"/>
                ${pines}${cabin}
                <path d="M0 200V168Q220 150 420 162T820 158T1200 164V200Z" fill="#cddbee"/>
                <path d="M0 200V182Q300 170 600 180T1200 178V200Z" fill="#e8f0fb"/>
            </svg>`;
            return decoStars(55) + '<div class="dk-moon" style="background:radial-gradient(circle at 40% 40%,#ffffff,#dfe9f7 70%,#b9c9e0);box-shadow:0 0 60px 16px rgba(180,210,255,.22),0 0 150px 50px rgba(140,180,255,.1);opacity:.75;"></div>' + land;
        }
        function themeParticles() { // nom gardé pour les appels existants : pose le décor de saison
            const layer = document.getElementById('theme-layer');
            if (!layer) return;
            const t = siteTheme();
            if (layer.dataset.t === t) return;
            layer.dataset.t = t;
            layer.innerHTML = t === 'halloween' ? decoHalloween() : t === 'noel' ? decoNoel() : '';
        }

        // --- signaler un bug depuis une partie ---
        function bugSnapshot() {
            const ent = Object.entries(lastStates).sort((a, b) => b[1].at - a[1].at)[0];
            if (!ent) return { mode: 'menu', info: {} };
            const [ev, { d }] = ent;
            const q = d || {};
            const info = { ev, room: currentRoomCode || null, game: q.game || q.mode || null, round: q.round ?? q.turn ?? null, phase: q.phase || null,
                answer: q.answer || (q.reveal && (q.reveal.word || q.reveal.name)) || q.songTitle || null, choices: q.choices || null,
                img: (q.stage && (q.stage.img || (q.stage.imgs || []).join(' | '))) || null, video: (q.stage && q.stage.video) || q.ytId || q.videoId || null,
                label: q.gameLabel || null, universe: q.universeLabel || null };
            Object.keys(info).forEach(k => { if (info[k] == null) delete info[k]; });
            return { mode: ev.replace('_state', '') + (q.game ? ':' + q.game : ''), info };
        }
        function openBugReport() {
            document.getElementById('v7-bug-modal')?.remove();
            const snap = bugSnapshot();
            const m = document.createElement('div'); m.className = 'v7-modal'; m.id = 'v7-bug-modal';
            m.innerHTML = `<div class="v7-box"><button class="v7-close" onclick="this.closest('.v7-modal').remove()">✕</button><h3>🐞 Signaler un problème</h3>
                <p class="tl-hint" style="text-align:left;">La manche en cours est jointe automatiquement (image, réponse attendue…).</p>
                <pre style="background:#0b0b10;border-radius:8px;padding:8px;font-size:.72rem;max-height:120px;overflow:auto;white-space:pre-wrap;">${v7esc(JSON.stringify(snap.info, null, 1))}</pre>
                <textarea id="bug-note" class="v7-input" rows="3" maxlength="500" placeholder="Qu'est-ce qui ne va pas ? (mauvaise réponse, image cassée, son qui ne marche pas…)"></textarea>
                <button class="btn-action" style="margin-top:0;" id="bug-send">Envoyer</button></div>`;
            m.addEventListener('click', e => { if (e.target === m) m.remove(); });
            document.body.appendChild(m);
            document.getElementById('bug-send').onclick = async () => {
                const d = await v7post('/api/bug', { ...snap, note: document.getElementById('bug-note').value, pseudo: getUsername() });
                m.remove();
                toast(d && d.ok ? '🐞 Merci, le signalement est envoyé !' : '❌ ' + ((d && d.error) || 'Impossible'), d && d.ok ? '#00ff88' : 'var(--accent-pink)');
            };
        }
        setInterval(() => {
            const b = document.getElementById('bug-fab');
            if (!b) return;
            const inGame = !!currentRoomCode && GAME_PANELS.some(id => { const el = document.getElementById(id); return el && el.style.display !== 'none' && el.offsetParent !== null; });
            b.style.display = inGame ? 'block' : 'none';
        }, 900);

        // --- tableau de bord admin ---
        async function checkAdmin() {
            const btn = document.getElementById('btn-admin');
            if (!btn) return;
            const d = isAccount() ? await v7get('/api/admin/me') : null;
            btn.parentElement.style.display = d && d.ok ? '' : 'none';
            window.IS_ADMIN = !!(d && d.ok);
            const bt = isAccount() ? await v7get('/api/beta/me') : null;
            window.IS_BETA = !!(bt && bt.beta);
            const bb2 = document.getElementById('btn-beta'); if (bb2) bb2.parentElement.style.display = window.IS_BETA && !window.IS_ADMIN ? '' : 'none';
            if (window.IS_ADMIN) betaAdminLoad();
            const bb = document.getElementById('admin-bots-box'); if (bb) bb.style.display = (window.IS_ADMIN || window.IS_BETA) ? 'flex' : 'none';
        }
        socket.on('connect', () => setTimeout(checkAdmin, 700));
        async function loadAdmin() {
            const box = document.getElementById('adm-stats');
            if (!box) return;
            const d = await v7get('/api/admin/stats');
            if (!d || !d.ok) { box.innerHTML = '<p class="tl-hint">Accès refusé.</p>'; return; }
            const maxM = Math.max(1, ...d.modes.map(m => m.n));
            box.innerHTML = `
                <div class="adm-cards">
                    <div><b>${d.online}</b>connectés</div><div><b>${d.accountsOnline}</b>comptes en ligne</div><div><b>${d.inGame}</b>en partie</div>
                    <div><b>${d.rooms}</b>salons</div><div><b>${d.gamesToday}</b>parties aujourd'hui</div><div><b>${d.gamesWeek}</b>parties (7 j)</div>
                    <div><b>${d.accounts ?? '—'}</b>comptes</div><div><b>${d.tracks}</b>musiques</div><div><b>${d.bugs}</b>bugs signalés</div>
                </div>
                <h3 class="adm-h">🎮 En ce moment</h3>
                ${d.byMode.length ? d.byMode.map(m => `<div class="daily-row"><span>${v7esc(m.mode)}</span><span>${m.players} joueur(s) • ${m.rooms} salon(s) • ${m.playing} en partie</span></div>`).join('') : '<p class="tl-hint">Aucun salon ouvert.</p>'}
                <h3 class="adm-h">📊 Modes les plus joués (7 jours)</h3>
                ${d.modes.length ? d.modes.map(m => `<div class="anime-stat"><span>${v7esc(m.label)}</span><div class="ab"><div style="width:${Math.round(100 * m.n / maxM)}%"></div></div><b>${m.n}</b></div>`).join('') : '<p class="tl-hint">Pas encore de partie enregistrée.</p>'}`;
            const s = d.site;
            document.getElementById('adm-maint').checked = !!s.maintenance.on;
            document.getElementById('adm-maint-msg').value = s.maintenance.msg || '';
            document.getElementById('adm-lock').checked = !!s.maintenance.lock;
            document.getElementById('adm-maint-back').value = s.maintenance.back || '';
            document.getElementById('adm-theme').value = s.theme || 'auto';
            document.getElementById('adm-luck-admins').checked = !!(s.luck && s.luck.admins);
            document.getElementById('adm-luck-players').checked = !!(s.luck && s.luck.players);
            checkBuild();
            loadAdminTracks(); loadAdminSfx(); loadAdminBugs(); loadSuggestionsAdmin(); loadAdminChars(); loadAdminQuotes(); loadMissed(); loadCatalog(); hwAdminLoad();
        }
        const CLIENT_BUILD = '2026-10-09-clans';
        async function checkBuild() {
            let d = null; try { d = await (await fetch('/api/version')).json(); } catch (_) {}
            const box = document.getElementById('admin');
            if (!box) return;
            let w = document.getElementById('build-warn');
            if (d && d.build === CLIENT_BUILD) { if (w) w.remove(); return; }
            if (!w) { w = document.createElement('div'); w.id = 'build-warn'; w.className = 'build-warn'; box.prepend(w); }
            w.innerHTML = `⚠️ <b>server.js et index.html ne sont pas de la même mise à jour</b> (site : ${CLIENT_BUILD}, serveur : ${d && d.build ? v7esc(d.build) : 'ancien'}). Uploade les deux fichiers sur GitHub, sinon le Loup-garou, les nouveaux modes et certains thèmes ne marchent pas.`;
        }
        async function saveMaintenance() {
            const lock = document.getElementById('adm-lock').checked;
            const d = await v7post('/api/admin/settings', { maintenance: { on: document.getElementById('adm-maint').checked, lock, msg: document.getElementById('adm-maint-msg').value, back: document.getElementById('adm-maint-back').value } });
            toast(d && d.ok ? (lock ? '🔒 Site fermé : les joueurs voient l’écran de mise à jour' : '✅ Maintenance mise à jour pour tout le monde') : '❌ Impossible (server.js à jour ?)', d && d.ok ? '#00ff88' : 'var(--accent-pink)');
        }
        // --- Cartes Halloween ---
        let hwAdminCards = [];
        function hwAdminRender(d) {
            if (!d || !d.ok) return;
            document.getElementById('adm-hw-on').checked = !!d.on;
            hwAdminCards = d.cards || [];
            const box = document.getElementById('adm-hw-list');
            box.innerHTML = hwAdminCards.length ? hwAdminCards.map((c, i) => `<div style="text-align:center;${c.off ? 'opacity:.45;' : ''}">${cardHtml({ name: c.display, img: c.img, rarity: 'halloween' })}
                <small style="display:block;color:var(--text-muted);font-size:.65rem;">${v7esc(c.anime)}${c.off ? ' • retirée du tirage' : ''}</small>
                <div style="display:flex;gap:4px;justify-content:center;margin-top:3px;">${c.off ? `<button class="btn-action" style="width:auto;margin:0;padding:3px 8px;font-size:.75rem;" title="Remettre dans le tirage" onclick="hwAdmin('readd',${i})">↩️</button>` : `<button class="btn-action" style="width:auto;margin:0;padding:3px 8px;font-size:.75rem;background:#2a2a40;" title="Retirer du tirage" onclick="hwAdmin('remove',${i})">✖</button>`}<button class="btn-action" style="width:auto;margin:0;padding:3px 8px;font-size:.75rem;background:#2a2a40;" title="Me la donner" onclick="hwAdmin('give',${i})">🎁</button></div></div>`).join('') : '<p class="tl-hint">Aucune carte Halloween pour l’instant.</p>';
        }
        function hwAdminLoad() {
            const sel = document.getElementById('adm-hw-u');
            if (sel && !sel.options.length) sel.innerHTML = UNIVERSE_CHOICES.map(([k, l]) => `<option value="${k}">${v7esc(l)}</option>`).join('');
            hwAdminNames();
        }
        async function hwAdminNames() {
            const u = document.getElementById('adm-hw-u').value;
            const d = await v7get('/api/admin/halloween?u=' + encodeURIComponent(u));
            if (!d || !d.ok) return;
            document.getElementById('adm-hw-names').innerHTML = (d.names || []).map(n => `<option value="${v7esc(n)}">`).join('');
            hwAdminRender(d);
        }
        async function hwAdmin(action, i) {
            const c = i != null ? hwAdminCards[i] : null;
            let body = { action };
            if (action === 'toggle') body.on = document.getElementById('adm-hw-on').checked;
            else if (action === 'readd') body = { action: 'add', u: c.u, name: c.display };
            else if (c) { body.u = c.u; body.display = c.display; }
            else if (action === 'add') {
                body.u = document.getElementById('adm-hw-u').value; body.name = document.getElementById('adm-hw-name').value.trim();
                if (!body.name) return toast('Choisis un perso.', 'var(--accent-pink)');
            }
            const d = await v7post('/api/admin/halloween', body);
            if (!d || !d.ok) return toast('❌ ' + ((d && d.error) || 'Impossible (server.js à jour ?)'), 'var(--accent-pink)');
            hwAdminRender(d);
            if (action === 'add') { document.getElementById('adm-hw-name').value = ''; toast('🎃 Carte Halloween ajoutée !', '#ff7a00'); }
            if (action === 'toggle') toast(body.on ? '🎃 Événement Halloween activé pour tout le monde !' : 'Événement Halloween terminé.', '#ff7a00');
            if (action === 'give' && d.card && typeof showBooster === 'function') showBooster([d.card]);
        }
        async function saveLuck() {
            const luck = { admins: document.getElementById('adm-luck-admins').checked, players: document.getElementById('adm-luck-players').checked };
            const d = await v7post('/api/admin/settings', { luck });
            toast(d && d.ok ? `🍀 Chance : admins ${luck.admins ? 'x10' : 'normale'} • joueurs ${luck.players ? 'x2' : 'normale'}` : '❌ Impossible (server.js à jour ?)', d && d.ok ? '#00ff88' : 'var(--accent-pink)');
        }
        async function saveTheme() {
            const want = document.getElementById('adm-theme').value;
            const d = await v7post('/api/admin/settings', { theme: want });
            if (!d || !d.ok) return toast('❌ Impossible', 'var(--accent-pink)');
            if (d.site && d.site.theme !== want) return toast('⚠️ Le serveur a refusé ce thème : ton server.js n’est pas à jour, uploade aussi le nouveau server.js sur GitHub.', 'var(--accent-pink)');
            applySite(d.site || SITE_STATE);
            toast('✅ Thème appliqué à tout le site', '#00ff88');
        }
        async function loadAdminTracks() {
            const d = await v7get('/api/admin/tracks');
            const box = document.getElementById('adm-tracks');
            if (!box || !d || !d.ok) return;
            const dl = document.getElementById('adm-anime-list');
            if (dl) dl.innerHTML = d.animes.map(a => `<option value="${v7esc(a)}">`).join('');
            box.innerHTML = d.rows.length ? d.rows.map(t => `<div class="friend-row"><span style="font-size:.82rem;"><b>${v7esc(t.anime)}</b> • ${v7esc(t.title)} <small style="color:var(--text-muted)">(${t.kind || 'opening'})</small><br><a href="https://youtu.be/${v7esc(t.yt_id)}" target="_blank" rel="noopener" style="color:var(--accent-cyan);font-size:.75rem;">youtu.be/${v7esc(t.yt_id)}</a></span><button onclick="delTrack(${t.id}, this)">🗑️</button></div>`).join('') : '<p class="tl-hint">Aucun opening ajouté depuis ici pour le moment.</p>';
        }
        const SFX_LABELS = { vie: '💥 Vie perdue (Rolland Garos)', elimine: '💀 Éliminé, 2 vies perdues (Rolland Garos)' };
        const SFX_DEFAUT_NOM = { vie: 'FAH', elimine: 'fusil à pompe Fortnite' };
        async function loadAdminSfx() {
            const box = document.getElementById('adm-sfx');
            if (!box) return;
            await sfxBoardLoad();
            box.innerHTML = Object.entries(SFX_LABELS).map(([k, label]) => {
                const has = !!sfxBoard.at[k];
                return `<div class="friend-row" style="flex-wrap:wrap;gap:6px;"><span style="font-size:.82rem;flex:1 1 100%;text-align:left;"><b>${label}</b><br><small style="color:var(--text-muted)">${has ? '✅ Son personnalisé' : 'Son de base : ' + SFX_DEFAUT_NOM[k]}</small></span>
                    <label class="btn-action" style="margin:0;width:auto;padding:6px 12px;cursor:pointer;">📁 ${has ? 'Changer' : 'Choisir'}<input type="file" accept="audio/*" style="display:none" onchange="uploadSfx('${k}', this)"></label>
                    <button class="btn-action" style="margin:0;width:auto;padding:6px 12px;" onclick="sfxBoardPlay('${k}')">▶️ Tester</button>${has ? `<button class="btn-action" style="margin:0;width:auto;padding:6px 12px;background:var(--accent-pink);" onclick="delSfx('${k}', this)">🗑️</button>` : ''}</div>`;
            }).join('');
        }
        async function uploadSfx(k, input) {
            const f = input.files && input.files[0];
            if (!f) return;
            if (f.size > 800 * 1024) return toast('❌ Fichier trop lourd (800 Ko max). Prends un son court.', 'var(--accent-pink)');
            let d = null;
            try { d = await (await fetch('/api/admin/sfx/' + k, { method: 'POST', headers: { ...authHeaders(), 'Content-Type': f.type || 'audio/mpeg' }, body: f })).json(); } catch (_) {}
            if (d && d.ok) { toast('🔊 Son ajouté pour tout le monde !', '#00ff88'); await loadAdminSfx(); sfxBoardPlay(k); }
            else toast('❌ ' + ((d && d.error) || 'Impossible (server.js à jour ?)'), 'var(--accent-pink)');
        }
        async function delSfx(k, btn) {
            if (!btn.classList.contains('armed')) { btn.classList.add('armed'); btn.textContent = 'Sûr ?'; return; }
            await v7post('/api/admin/sfx/' + k + '/delete', {}); loadAdminSfx();
        }
        async function addTrack() {
            const v = id => document.getElementById(id).value;
            const d = await v7post('/api/admin/tracks', { anime: v('adm-t-anime'), title: v('adm-t-title'), link: v('adm-t-link'), kind: v('adm-t-kind') });
            if (d && d.ok) { toast('🎵 Ajouté au blind test et au battle !', '#00ff88'); ['adm-t-title', 'adm-t-link'].forEach(id => { document.getElementById(id).value = ''; }); loadAdminTracks(); }
            else toast('❌ ' + ((d && d.error) || 'Impossible'), 'var(--accent-pink)');
        }
        async function delTrack(id, btn) {
            if (!btn.classList.contains('armed')) { btn.classList.add('armed'); btn.textContent = 'Sûr ?'; return; }
            await v7post('/api/admin/tracks/delete', { id }); loadAdminTracks();
        }
        async function loadAdminBugs() {
            const d = await v7get('/api/admin/bugs');
            const box = document.getElementById('adm-bugs');
            if (!box || !d || !d.ok) return;
            box.innerHTML = d.rows.length ? d.rows.map(r => {
                const i = r.info || {};
                const img = String(i.img || '').split(' | ')[0];
                return `<div class="sugg-row"><b>${v7esc(r.mode || '?')}</b> • ${v7esc(r.pseudo || '')} <small style="color:var(--text-muted)">${new Date(r.created_at).toLocaleString('fr-FR')}</small><br>
                    ${r.note ? `💬 ${v7esc(r.note)}<br>` : ''}${i.label ? v7esc(i.label) + ' • ' : ''}${i.round != null ? 'manche ' + v7esc(i.round) + ' • ' : ''}${i.answer ? 'réponse : <b>' + v7esc(i.answer) + '</b>' : ''}
                    ${i.choices ? '<br><small>choix : ' + i.choices.map(v7esc).join(' / ') + '</small>' : ''}
                    ${img && img.startsWith('/api/') ? `<br><small style="color:var(--text-muted)">(image temporaire, peut avoir expiré)</small><br><img src="${v7esc(img)}" style="max-width:120px;border-radius:8px;margin-top:4px;" onerror="this.remove()">` : ''}
                    ${i.video ? `<br><a href="https://youtu.be/${v7esc(i.video)}" target="_blank" rel="noopener" style="color:var(--accent-cyan)">▶️ vidéo</a>` : ''}
                    <br><button class="kick-btn" style="margin-top:4px;" onclick="delBug(${r.id})">Supprimer</button></div>`;
            }).join('') : '<p class="tl-hint">Aucun bug signalé 🎉</p>';
        }
        async function delBug(id) { await v7post('/api/admin/bugs/delete', { id }); loadAdminBugs(); }

        /* =====================================================================
           PIÈCES, BOUTIQUE, CARTES, TITRES, EMOTES, EFFETS, DÉFIS, RÉCAP
           ===================================================================== */
        const eco = { coins: 0, items: [], owned: [], sel: {}, cos: {}, tab: 'shop', albumU: null };
        const RAR_LABEL = { commune: 'Commune', rare: 'Rare', epique: 'Épique', legendaire: 'Légendaire', mythique: 'Mythique 🔥', secrete: 'Secrète 🌈', divine: 'Divine 👑', cosmique: 'Cosmique 🌌', eternelle: 'Éternelle ♾️', omega: 'Ω OMÉGA', halloween: 'Halloween' };
        function ecoCoinsUi() {
            const b = document.getElementById('coin-badge');
            if (b) { b.style.display = isAccount() ? '' : 'none'; b.querySelector('b').textContent = eco.coins; }
            const s = document.getElementById('shop-coins'); if (s) s.textContent = eco.coins;
        }
        async function ecoLoad() {
            const d = await v7get('/api/shop');
            if (!d || !d.ok) return;
            Object.assign(eco, { coins: d.coins, items: d.items, owned: d.owned, sel: d.sel || {}, cos: d.cos || {} });
            ecoCoinsUi();
        }
        socket.on('connect', () => setTimeout(ecoLoad, 900));
        socket.on('coins_gain', d => { if (!d) return; eco.coins = d.total; ecoCoinsUi(); toast(`🪙 +${d.gain} pièces`, '#ffd700'); });
        function ecoTab(t) {
            eco.tab = t;
            document.querySelectorAll('.eco-tabs button').forEach(b => b.classList.toggle('on', b.dataset.t === t));
            ['shop', 'album', 'titles', 'challenges'].forEach(k => { const el = document.getElementById('eco-' + k); if (el) el.style.display = k === t ? '' : 'none'; });
            if (t === 'shop') renderShop(); else if (t === 'album') loadAlbum(); else if (t === 'titles') loadTitles(); else loadChallenges();
        }
        (function () { const orig = window.switchTab; window.switchTab = function (t) { const r = orig.apply(this, arguments); if (t === 'collection') { ecoLoad().then(() => ecoTab(eco.tab)); } return r; }; })();
        // --- boutique ---
        const SHOP_KINDS = [['color', '🎨 Couleurs de pseudo'], ['frame', '🖼️ Cadres d\'avatar'], ['emote', '💥 Emotes de victoire (manche gagnée)'], ['effect', '🎆 Effets de victoire (partie gagnée)'], ['booster', '🃏 Boosters de cartes']];
        function shopPreview(it) {
            if (it.kind === 'color') return `<span class="cn cn-${it.key}" style="font-weight:800;font-size:1.05rem;">${v7esc(getUsername())}</span>`;
            if (it.kind === 'frame') return avatarHtml(getUsername(), { frame: it.key, avatar: (currentUser && currentUser.cos && currentUser.cos.avatar) || null }, true);
            if (it.kind === 'emote') return `<button class="shop-try" onclick="event.stopPropagation();playEmote('${it.key}','${v7esc(getUsername())}')">▶ Voir</button>`;
            if (it.kind === 'effect') return `<button class="shop-try" onclick="event.stopPropagation();playEffect('${it.key}')">▶ Voir</button>`;
            return '<span style="font-size:2rem;">🎴</span>';
        }
        function renderShop() {
            const box = document.getElementById('eco-shop');
            if (!box) return;
            if (!isAccount()) { box.innerHTML = '<p class="tl-hint">Crée un compte pour gagner des pièces et acheter des objets.</p>'; return; }
            const equipped = it => it.kind === 'color' ? eco.cos.color === it.key : it.kind === 'frame' ? eco.cos.frame === it.key : eco.sel[it.kind] === it.key;
            box.innerHTML = `<div class="shop-head">🪙 <b id="shop-coins">${eco.coins}</b> pièces <span class="tl-hint">• gagne des pièces à chaque partie (plus si tu gagnes), et avec les doublons de cartes</span></div>`
                + SHOP_KINDS.map(([kind, label]) => `<h3 class="adm-h">${label}</h3><div class="shop-grid">${eco.items.filter(i => i.kind === kind).map(it => {
                    const own = eco.owned.includes(it.id) && !it.consumable, on = own && equipped(it);
                    return `<div class="shop-item${own ? ' own' : ''}${on ? ' on' : ''}"><div class="shop-prev">${shopPreview(it)}</div><b>${v7esc(it.name)}</b>
                        ${own ? `<button onclick="shopEquip('${it.kind}','${on ? '' : it.key}')">${on ? '✔ Équipé (retirer)' : 'Équiper'}</button>` : `<button class="buy" ${eco.coins < it.price ? 'disabled' : ''} onclick="shopBuy('${it.id}')">🪙 ${it.price}</button>`}</div>`;
                }).join('')}</div>`).join('');
        }
        async function shopBuy(id) {
            if (shopBuy.busy) return; // évite d'acheter deux fois en cliquant vite
            shopBuy.busy = true;
            document.querySelectorAll('#eco-shop .buy').forEach(b => b.disabled = true);
            const itB = (eco.items || []).find(i => i.id === id);
            if (itB && itB.kind === 'booster' && typeof summonPending === 'function') summonPending();
            let d; try { d = await v7post('/api/shop/buy', { id }); } finally { shopBuy.busy = false; }
            if ((!d || !d.ok || !d.cards) && typeof summonCancel === 'function') summonCancel();
            if (!d || !d.ok) return toast('❌ ' + ((d && d.error) || 'Impossible'), 'var(--accent-pink)');
            eco.coins = d.coins; eco.owned = d.owned; ecoCoinsUi();
            if (d.cards) showBooster(d.cards);
            else { const it = eco.items.find(i => i.id === id); toast(`🛒 ${v7esc(it ? it.name : 'Objet')} acheté !`, '#00ff88'); if (it) await shopEquip(it.kind, it.key, true); }
            renderShop();
        }
        async function shopEquip(kind, key, quiet) {
            const d = await v7post('/api/shop/equip', { kind, key: key || null });
            if (!d || !d.ok) return toast('❌ ' + ((d && d.error) || 'Impossible'), 'var(--accent-pink)');
            eco.sel = d.sel || eco.sel; eco.cos = d.cos || eco.cos;
            if (currentUser) {
                currentUser.cos = currentUser.cos || {};
                if (kind === 'color' || kind === 'frame') currentUser.cos[kind] = key || (kind === 'color' ? 'default' : 'none');
                else if (kind !== 'title') currentUser.cos[kind] = key || null;
            }
            if (!quiet) toast(key ? '✔ Équipé' : 'Retiré', '#00ff88');
            if (eco.tab === 'shop') renderShop(); else if (eco.tab === 'titles') loadTitles();
        }
        // --- cartes ---
        function cardHtml(c, big) {
            if (!c.name) return `<div class="tcard empty r-${c.rarity} missing-card"><div class="tc-img">${c.img ? `<img src="${v7esc(c.img)}" alt="" loading="lazy" decoding="async" style="filter:brightness(0);opacity:.72;" onerror="this.remove();this.parentNode.textContent='?'">` : '?'}</div><div class="tc-name">???</div><div class="tc-rar">${RAR_LABEL[c.rarity]}</div></div>`;
            return `<div class="tcard r-${c.rarity}${c.shiny ? ' shiny' : ''}${big ? ' big' : ''}"><div class="tc-img"><img src="${v7esc(c.img)}" alt="" loading="lazy" decoding="async" onerror="this.style.opacity=.15"></div>
                <div class="tc-name">${v7esc(c.name)}</div><div class="tc-rar">${c.shiny ? '✨ ' : ''}${RAR_LABEL[c.rarity]}${c.n > 1 ? ` • x${c.n}` : ''}</div>${c.isNew ? '<em class="tc-new">NOUVELLE</em>' : ''}</div>`;
        }
        async function loadAlbum(u) {
            const box = document.getElementById('eco-album');
            if (!box) return;
            if (!isAccount()) { box.innerHTML = '<p class="tl-hint">Crée un compte pour collectionner les cartes.</p>'; return; }
            if (u !== undefined) eco.albumU = u;
            const d = await v7get('/api/cards' + (eco.albumU ? '?u=' + encodeURIComponent(eco.albumU) : ''));
            if (!d || !d.ok) return;
            const head = `<div class="shop-head">🃏 <b>${d.owned}</b> / ${d.total} cartes • ✨ ${d.shinies} brillantes <span class="tl-hint">• trouve des persos en jouant pour gagner leur carte</span></div>`;
            if (!eco.albumU || !d.cards) {
                box.innerHTML = head + `<div class="album-list">${d.universes.map(x => `<button onclick="loadAlbum('${x.u}')"><b>${v7esc(x.name)}</b><span class="ab"><i style="width:${Math.round(100 * x.owned / x.total)}%"></i></span><small>${x.owned}/${x.total} • ${Math.round(100*x.owned/Math.max(1,x.total))}%${x.owned >= x.total ? ' 🏆' : ''}</small></button>`).join('')}</div>`;
                return;
            }
            const uni = d.universes.find(x => x.u === eco.albumU) || {};
            box.innerHTML = head + `<div style="display:flex;align-items:center;gap:8px;margin:8px 0;"><button class="host-btn" onclick="loadAlbum(null)">🔙 Albums</button><b>${v7esc(uni.name || '')}</b><span class="tl-hint">${uni.owned}/${uni.total}</span></div>
                <div class="card-grid">${d.cards.map(c => cardHtml(c)).join('')}</div>`;
        }
        function showBooster(cards) {
            document.getElementById('booster-modal')?.remove();
            const m = document.createElement('div'); m.className = 'v7-modal'; m.id = 'booster-modal';
            m.innerHTML = `<div class="v7-box" style="max-width:720px;"><button class="v7-close" onclick="this.closest('.v7-modal').remove()">✕</button><h3>🎴 Ton booster</h3>
                <div class="card-grid booster">${cards.map((c, i) => `<div class="flip" style="animation-delay:${i * 0.15}s">${cardHtml(c, true)}</div>`).join('')}</div>
                <p class="tl-hint">${cards.filter(c => c.isNew).length} nouvelle(s) carte(s)${cards.some(c => c.coins) ? ` • doublons : +${cards.reduce((a, c) => a + (c.coins || 0), 0)} 🪙` : ''}</p></div>`;
            m.addEventListener('click', e => { if (e.target === m) m.remove(); });
            document.body.appendChild(m);
            const TOP = ['secrete', 'divine', 'cosmique', 'eternelle', 'omega', 'halloween'];
            if (cards.some(c => c.shiny || ['legendaire', 'mythique', ...TOP].includes(c.rarity))) confetti(cards.some(c => TOP.includes(c.rarity)) ? 3500 : 1500);
        }
        let cardQueue = [], cardTimer = null;
        socket.on('card_gain', c => {
            if (!c) return;
            cardQueue.push(c);
            if (cardTimer) return;
            const next = () => {
                const x = cardQueue.shift();
                if (!x) { cardTimer = null; return; }
                const el = document.createElement('div'); el.className = 'card-pop'; el.innerHTML = cardHtml(x) + `<div class="cp-txt">${x.isNew ? '🃏 Nouvelle carte !' : `Doublon : +${x.coins} 🪙`}</div>`;
                document.body.appendChild(el);
                setTimeout(() => el.classList.add('out'), 2600); setTimeout(() => el.remove(), 3100);
                cardTimer = setTimeout(next, 1200);
            };
            next();
        });
        // --- titres ---
        async function loadTitles() {
            const box = document.getElementById('eco-titles');
            if (!box) return;
            if (!isAccount()) { box.innerHTML = '<p class="tl-hint">Crée un compte pour débloquer des titres.</p>'; return; }
            const d = await v7get('/api/titles');
            if (!d || !d.ok) return;
            box.innerHTML = `<p class="tl-hint" style="text-align:left;">Ton titre s'affiche sous ton pseudo pour tout le monde. Débloque-les avec tes stats.</p>` + d.titles.map(t => `<div class="title-row${t.ok ? '' : ' lock'}${d.sel === t.id ? ' on' : ''}">
                <div><b>${t.ok ? '🏷️' : '🔒'} ${v7esc(t.name)}</b><br><small>${v7esc(t.desc)}</small>${t.prog && !t.ok ? `<span class="ab" style="margin-top:4px;"><i style="width:${Math.min(100, Math.round(100 * t.prog[0] / t.prog[1]))}%"></i></span><small>${t.prog[0]}/${t.prog[1]}</small>` : ''}</div>
                ${t.ok ? `<button onclick="shopEquip('title','${d.sel === t.id ? '' : t.id}')">${d.sel === t.id ? '✔ Porté' : 'Porter'}</button>` : ''}</div>`).join('');
        }
        // --- défis entre amis ---
        async function loadChallenges() {
            const box = document.getElementById('eco-challenges');
            if (!box) return;
            if (!isAccount()) { box.innerHTML = '<p class="tl-hint">Crée un compte pour défier tes amis.</p>'; return; }
            const d = await v7get('/api/challenges');
            if (!d || !d.ok) return;
            const fmt = (g, s, a) => g === 'dle' ? `${a ?? '—'} essais` : `${s ?? '—'} pts`;
            box.innerHTML = `<p class="tl-hint" style="text-align:left;">Fais un défi du jour, puis envoie ton score à un ami avec « ⚔️ Défier un ami ». S'il te bat, il gagne 30 🪙.</p>`
                + (d.list.length ? d.list.map(c => {
                    const res = c.result ? (c.mine ? { win: `❌ ${v7esc(c.to)} t'a battu`, lose: `✅ ${v7esc(c.to)} ne t'a pas battu`, draw: '🤝 Égalité' }[c.result] : { win: '✅ Tu as gagné (+30 🪙)', lose: '❌ Perdu', draw: '🤝 Égalité' }[c.result]) : (c.mine ? '⏳ En attente' : '⚔️ À toi de jouer !');
                    return `<div class="chal-row"><div><b>${c.mine ? `Toi → ${v7esc(c.to)}` : `${v7esc(c.from)} → toi`}</b> • ${v7esc(c.label)} du ${c.day.slice(8, 10)}/${c.day.slice(5, 7)}<br>
                        <small>Score à battre : ${fmt(c.game, c.score, c.attempts)}${c.result ? ` • réponse : ${fmt(c.game, c.to_score, c.to_attempts)}` : ''}</small></div>
                        <div>${!c.mine && !c.result && c.today ? `<button onclick="startDaily('${c.game}')">Relever</button>` : `<small>${res}</small>`}</div></div>`;
                }).join('') : '<p class="tl-hint">Aucun défi pour le moment.</p>');
        }
        async function openChallengeFriend(game) {
            if (!isAccount()) return toast('Crée un compte pour défier tes amis.', 'var(--accent-pink)');
            const d = await v7get('/api/friends');
            document.getElementById('chal-modal')?.remove();
            const m = document.createElement('div'); m.className = 'v7-modal'; m.id = 'chal-modal';
            const fr = (d && d.friends) || [];
            m.innerHTML = `<div class="v7-box"><button class="v7-close" onclick="this.closest('.v7-modal').remove()">✕</button><h3>⚔️ Défier un ami</h3>
                ${fr.length ? fr.map(f => `<div class="friend-row"><span>${v7esc(f.pseudo)} ${f.online ? '🟢' : ''}</span><button onclick="sendChallenge(${f.id},'${game}',this)">Défier</button></div>`).join('') : '<p class="tl-hint">Ajoute des amis dans Options → Amis.</p>'}</div>`;
            m.addEventListener('click', e => { if (e.target === m) m.remove(); });
            document.body.appendChild(m);
        }
        async function sendChallenge(fid, game, btn) {
            btn.disabled = true;
            const d = await v7post('/api/challenge', { friendId: fid, game });
            if (!d || !d.ok) { btn.disabled = false; return toast('❌ ' + ((d && d.error) || 'Impossible'), 'var(--accent-pink)'); }
            btn.textContent = d.challenge.result ? 'Déjà joué !' : '✔ Envoyé';
            toast(d.challenge.result ? 'Ton ami avait déjà joué : résultat dans Collection → Défis' : '⚔️ Défi envoyé !', '#00ff88');
        }
        socket.on('challenge_new', d => { if (!d) return; toast(`⚔️ ${v7esc(d.from)} te défie au ${v7esc(d.label)} du jour (${d.game === 'dle' ? d.attempts + ' essais' : d.score + ' pts'}) ! <button onclick="startDaily('${d.game}')" style="margin-left:6px;">Relever</button>`, '#ff9a3c'); });
        socket.on('challenge_update', d => { if (d && d.text) toast('⚔️ ' + v7esc(d.text), '#ff9a3c'); });
        // bouton « Défier un ami » dans le partage du défi du jour
        (function () {
            const orig = window.dailyShowShare;
            if (typeof orig !== 'function') return;
            window.dailyShowShare = function (game) {
                const r = orig.apply(this, arguments);
                setTimeout(() => {
                    const card = document.querySelector('#fx-share .fx-share-card');
                    if (!card) return;
                    let b = card.querySelector('.chal-btn');
                    if (!b) { b = document.createElement('button'); b.className = 'btn-action chal-btn'; b.style.background = '#ff9a3c'; b.textContent = '⚔️ Défier un ami'; card.insertBefore(b, card.lastElementChild); }
                    b.style.display = isAccount() ? '' : 'none';
                    b.onclick = () => openChallengeFriend(game);
                }, 1300);
                return r;
            };
        })();
        // --- emotes de victoire ---
        const EMOTES = {
            kamehameha: { txt: 'KA-ME-HA-ME-HAAA !', ico: '🔵', cls: 'beam', col: '#4fc3ff' },
            rasengan: { txt: 'RASENGAN !', ico: '🌀', cls: 'orb', col: '#6fd3ff' },
            getsuga: { txt: 'GETSUGA TENSHŌ !', ico: '🌙', cls: 'slash', col: '#ff3b3b' },
            gomu: { txt: 'GOMU GOMU NO… PISTOL !', ico: '👊', cls: 'punch', col: '#ffcc33' },
            hinokami: { txt: 'HINOKAMI KAGURA !', ico: '🔥', cls: 'fire', col: '#ff7a1a' },
            chidori: { txt: 'CHIDORI !', ico: '⚡', cls: 'zap', col: '#9fd8ff' },
            ora: { txt: 'ORA ORA ORA ORA !', ico: '👊', cls: 'ora', col: '#c77dff' },
            domaine: { txt: 'EXTENSION DU TERRITOIRE !', ico: '🤞', cls: 'domain', col: '#b100ff' }
        };
        function playEmote(key, name) {
            const e = EMOTES[key]; if (!e) return;
            const el = document.createElement('div'); el.className = 'emote-fx em-' + e.cls; el.style.setProperty('--ec', e.col);
            el.innerHTML = `<div class="em-ico">${e.ico}</div><div class="em-txt">${v7esc(e.txt)}</div><div class="em-name">${v7esc(name || '')}</div>`;
            document.body.appendChild(el);
            setTimeout(() => el.remove(), 2200);
        }
        socket.on('victory_emote', d => { if (d && d.emote) playEmote(d.emote, d.name); });
        let lastWinKey = '';
        function myRoundWin(key) {
            if (!currentRoomCode || key === lastWinKey) return;
            lastWinKey = key;
            if (currentUser && currentUser.cos && currentUser.cos.emote) socket.emit('victory_emote', { roomCode: currentRoomCode });
        }
        socket.on('arc_state', q => {
            if (!q || q.phase !== 'reveal') return;
            const me = (q.players || []).find(p => p.id === socket.id);
            const col = q.game === 'couleur' && q.stage && q.stage.gallery && q.stage.gallery[0];
            if ((me && me.correct && q.game !== 'couleur') || (col && col.id === socket.id && (q.stage.gallery.length > 1))) myRoundWin('arc|' + q.round + '|' + (q.startedAt || ''));
        });
        socket.on('bt_state', q => { if (q && q.phase === 'reveal') { const me = (q.players || []).find(p => p.id === socket.id); if (me && me.correct) myRoundWin('bt|' + q.round + '|' + q.key); } });
        socket.on('draw_chat', m => { if (m && m.system && m.ok && /^✅ Bravo/.test(m.text || '')) myRoundWin('draw|' + (drw.state && drw.state.turn)); });
        socket.on('quote_state', q => { if (q && q.resolved && q.lastResult && q.lastResult.correct && q.lastResult.playerName === getUsername()) myRoundWin('quote|' + q.round); });
        socket.on('guess_state', q => { if (q && q.phase === 'reveal' && q.reveal && q.reveal.finder === getUsername()) myRoundWin('guess|' + q.turn); });
        // --- effets de victoire (remplacent les confettis quand tu gagnes) ---
        function playEffect(key, ms = 3200) {
            const c = document.getElementById('fx-confetti');
            if (!c) return;
            const ctx = c.getContext('2d');
            c.width = innerWidth; c.height = innerHeight; c.style.display = 'block';
            const W = c.width, H = c.height, R = Math.random;
            let parts = [];
            const spawn = () => {
                if (key === 'snow') for (let i = 0; i < 3; i++) parts.push({ x: R() * W, y: -10, vx: (R() - .5) * .8, vy: 1 + R() * 1.5, r: 2 + R() * 4, t: 'snow' });
                if (key === 'sakura') for (let i = 0; i < 2; i++) parts.push({ x: R() * W, y: -10, vx: 1 + R(), vy: 1 + R() * 1.5, r: 5 + R() * 5, a: R() * 6, t: 'petal' });
                if (key === 'coins') for (let i = 0; i < 2; i++) parts.push({ x: R() * W, y: -20, vx: (R() - .5), vy: 3 + R() * 3, r: 8 + R() * 6, a: R() * 6, t: 'coin' });
            };
            const bursts = [];
            const t0 = performance.now();
            let lastBurst = 0, flash = 0;
            const step = t => {
                const el = t - t0;
                ctx.clearRect(0, 0, W, H);
                if (el < ms - 800) spawn();
                if (key === 'fireworks' && el - lastBurst > 350 && el < ms - 600) {
                    lastBurst = el; const x = W * (.15 + R() * .7), y = H * (.15 + R() * .4), hue = Math.floor(R() * 360);
                    for (let i = 0; i < 60; i++) { const a = i / 60 * Math.PI * 2, s = 2 + R() * 3; bursts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 60, hue }); }
                }
                if (key === 'lightning' && el - lastBurst > 420 && el < ms - 600) { lastBurst = el; flash = 1; bursts.push({ bolt: true, x: W * (.1 + R() * .8), life: 14 }); }
                if (flash > 0) { ctx.fillStyle = `rgba(200,230,255,${flash * .35})`; ctx.fillRect(0, 0, W, H); flash -= .08; }
                bursts.forEach(b => {
                    b.life--;
                    if (b.bolt) {
                        ctx.strokeStyle = `rgba(190,230,255,${b.life / 14})`; ctx.lineWidth = 4; ctx.shadowColor = '#9fd8ff'; ctx.shadowBlur = 20;
                        ctx.beginPath(); let x = b.x, y = 0; ctx.moveTo(x, y); while (y < H) { x += (R() - .5) * 60; y += 30 + R() * 40; ctx.lineTo(x, y); } ctx.stroke(); ctx.shadowBlur = 0;
                    } else { b.x += b.vx; b.y += b.vy; b.vy += .04; ctx.fillStyle = `hsla(${b.hue},100%,60%,${b.life / 60})`; ctx.fillRect(b.x, b.y, 3, 3); }
                });
                for (let i = bursts.length - 1; i >= 0; i--) if (bursts[i].life <= 0) bursts.splice(i, 1);
                parts.forEach(p => {
                    p.x += p.vx; p.y += p.vy; if (p.a != null) p.a += .05;
                    if (p.t === 'snow') { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill(); }
                    else if (p.t === 'petal') { ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.fillStyle = '#ffb7d5'; ctx.beginPath(); ctx.ellipse(0, 0, p.r, p.r / 2, 0, 0, 7); ctx.fill(); ctx.restore(); }
                    else if (p.t === 'coin') { ctx.save(); ctx.translate(p.x, p.y); ctx.scale(Math.abs(Math.cos(p.a)), 1); ctx.fillStyle = '#ffd700'; ctx.strokeStyle = '#b8860b'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, p.r, 0, 7); ctx.fill(); ctx.stroke(); ctx.restore(); }
                });
                parts = parts.filter(p => p.y < H + 30);
                if (el < ms) requestAnimationFrame(step); else { ctx.clearRect(0, 0, W, H); c.style.display = 'none'; }
            };
            requestAnimationFrame(step);
        }
        (function () {
            const orig = window.confetti;
            window.confetti = function (ms) {
                const eff = currentUser && currentUser.cos && currentUser.cos.effect;
                if (eff) return playEffect(eff, Math.max(2600, ms || 0));
                return orig.apply(this, arguments);
            };
        })();
        // --- récap de fin de partie (mini-jeux et blind test) ---
        const recap = { key: '', rounds: [], start: 0, shown: '' };
        function recapTrack(kind, q) {
            if (typeof dailyMode !== 'undefined' && dailyMode) return;
            const gameKey = kind + '|' + currentRoomCode + '|' + (q.totalRounds || '') + '|' + (kind === 'arc' ? q.game : '');
            if (recap.key !== gameKey || (q.round === 1 && q.phase === 'playing' && recap.rounds.length > 1)) { recap.key = gameKey; recap.rounds = []; recap.shown = ''; }
            const me = (q.players || []).find(p => p.id === socket.id);
            if (!me) return;
            const r = recap.rounds[q.round] = recap.rounds[q.round] || { round: q.round };
            if (q.phase === 'playing') {
                if (!r.t0) r.t0 = Date.now() - Math.max(0, (q.serverNow || Date.now()) - (q.startedAt || (q.endsAt ? q.endsAt - (q.roundMs || 0) : Date.now())));
                if ((me.done || me.answered) && !r.t) r.t = Date.now() - r.t0;
            } else if (q.phase === 'reveal' && r.correct == null) {
                r.correct = !!me.correct; r.choice = me.choice; r.answer = q.answer || (q.reveal && q.reveal.items && q.reveal.items[0] && q.reveal.items[0].name) || null; r.gained = me.gained || 0;
                if (q.game === 'couleur') { r.correct = me.pct != null && me.pct >= 50; r.choice = me.pct != null ? me.pct.toFixed(1) + '%' : null; }
            } else if (q.phase === 'finished' && recap.shown !== gameKey) {
                recap.shown = gameKey;
                const players = [...(q.players || [])].sort((a, b) => b.score - a.score);
                const rank = players.findIndex(p => p.id === socket.id) + 1;
                setTimeout(() => showRecap({ title: kind === 'arc' ? (q.gameLabel || 'Mini-jeu') : 'Blind test', score: me.score, rank, total: players.length }), 2600);
            }
        }
        socket.on('arc_state', q => { if (q && !q.daily && q.answerType !== 'draft' && q.answerType !== 'chrono' && q.answerType !== 'bac') recapTrack('arc', q); });
        socket.on('bt_state', q => { if (q) recapTrack('bt', q); });
        function showRecap(info) {
            const rs = recap.rounds.filter(r => r && r.correct != null);
            if (rs.length < 2) return;
            const good = rs.filter(r => r.correct);
            const fastest = good.filter(r => r.t).sort((a, b) => a.t - b.t)[0];
            const bad = rs.filter(r => !r.correct && r.choice && r.answer);
            const worst = bad[bad.length - 1];
            let streak = 0, best = 0; rs.forEach(r => { streak = r.correct ? streak + 1 : 0; best = Math.max(best, streak); });
            const best1 = good.slice().sort((a, b) => (b.gained || 0) - (a.gained || 0))[0];
            const stats = [
                ['🏆', 'Classement', info.total > 1 ? `${info.rank}${info.rank === 1 ? 'er' : 'e'} / ${info.total}` : 'Solo'],
                ['⭐', 'Score', `${info.score} pts`],
                ['✅', 'Bonnes réponses', `${good.length} / ${rs.length} (${Math.round(100 * good.length / rs.length)} %)`],
                ['🔥', 'Meilleure série', `${best} d'affilée`],
                ['⚡', 'Plus rapide', fastest ? `${(fastest.t / 1000).toFixed(1)} s${fastest.answer ? ' • ' + fastest.answer : ''}` : '—'],
                ['💎', 'Meilleure réponse', best1 ? `${best1.answer || '—'}${best1.gained ? ' (+' + best1.gained + ')' : ''}` : '—'],
                ['💀', 'Pire erreur', worst ? `« ${worst.choice} » au lieu de ${worst.answer}` : 'Aucune 😎']
            ];
            document.getElementById('recap-modal')?.remove();
            const m = document.createElement('div'); m.className = 'v7-modal'; m.id = 'recap-modal';
            m.innerHTML = `<div class="v7-box recap-box"><button class="v7-close" onclick="this.closest('.v7-modal').remove()">✕</button>
                <div class="recap-card" id="recap-card"><div class="rc-top">ANIME GAME</div><div class="rc-game">${v7esc(info.title)}</div><div class="rc-who">${cosNameHtml(getUsername(), currentUser && currentUser.cos)}</div>
                ${stats.map(([i, l, v]) => `<div class="rc-row"><span>${i} ${l}</span><b>${v7esc(v)}</b></div>`).join('')}</div>
                <div style="display:flex;gap:8px;margin-top:10px;"><button class="btn-action" style="margin-top:0;background:#9146FF;" onclick="shareRecap()">📤 Partager</button><button class="btn-action" style="margin-top:0;background:var(--text-muted);" onclick="this.closest('.v7-modal').remove()">Fermer</button></div></div>`;
            m.addEventListener('click', e => { if (e.target === m) m.remove(); });
            document.body.appendChild(m);
            recap.last = { info, stats };
        }
        function recapCanvas() {
            const { info, stats } = recap.last || {};
            if (!info) return null;
            const c = document.createElement('canvas'); c.width = 720; c.height = 960;
            const x = c.getContext('2d');
            const g = x.createLinearGradient(0, 0, 720, 960); g.addColorStop(0, '#1a1030'); g.addColorStop(1, '#0b1a2e');
            x.fillStyle = g; x.fillRect(0, 0, 720, 960);
            x.strokeStyle = '#00f0ff'; x.lineWidth = 6; x.strokeRect(20, 20, 680, 920);
            x.textAlign = 'center';
            x.fillStyle = '#ffe600'; x.font = 'bold 64px Bangers, Impact, sans-serif'; x.fillText('ANIME GAME', 360, 110);
            x.fillStyle = '#00f0ff'; x.font = 'bold 34px sans-serif'; x.fillText(info.title, 360, 165);
            x.fillStyle = '#fff'; x.font = 'bold 40px sans-serif'; x.fillText(getUsername(), 360, 230);
            x.textAlign = 'left';
            stats.forEach(([i, l, v], k) => {
                const y = 310 + k * 88;
                x.fillStyle = 'rgba(255,255,255,.07)'; x.fillRect(50, y - 50, 620, 72);
                x.fillStyle = '#aab'; x.font = '26px sans-serif'; x.fillText(`${i} ${l}`, 70, y - 8);
                x.fillStyle = '#fff'; x.font = 'bold 28px sans-serif'; x.textAlign = 'right'; x.fillText(String(v).slice(0, 38), 650, y - 8); x.textAlign = 'left';
            });
            x.textAlign = 'center'; x.fillStyle = '#ff5fa2'; x.font = '24px sans-serif'; x.fillText(location.host, 360, 920);
            return c;
        }
        async function shareRecap() {
            const c = recapCanvas(); if (!c) return;
            const blob = await new Promise(r => c.toBlob(r, 'image/png'));
            const file = new File([blob], 'anime-game-recap.png', { type: 'image/png' });
            try { if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'Mon récap Anime Game' }); return; } } catch (_) {}
            const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'anime-game-recap.png'; a.click();
            toast('📥 Image du récap téléchargée', '#00ff88');
        }
        // --- bots de test ---
        // --- bêta testeurs ---
        async function betaLoad() {
            const d = await v7get('/api/beta/me');
            const l = document.getElementById('beta-luck'); if (l) l.textContent = d && d.luck ? '✅ activée' : '⏸️ pas activée en ce moment';
        }
        async function betaCoins(n) {
            const d = await v7post('/api/beta/coins', { n });
            if (!d || !d.ok) return toast('❌ ' + ((d && d.error) || 'Impossible'), 'var(--accent-pink)');
            toast(`🪙 +${n.toLocaleString('fr-FR')} pièces !`, '#ffd700');
        }
        function betaAdminRender(list) {
            const box = document.getElementById('adm-beta-list'); if (!box) return;
            box.innerHTML = list.length ? list.map(p => `<div class="daily-row"><span>🧪 ${v7esc(p)}</span><button class="host-btn" data-p="${v7esc(p)}">✖ Retirer</button></div>`).join('') : '<p class="tl-hint">Aucun bêta testeur pour l’instant.</p>';
            box.querySelectorAll('button[data-p]').forEach(b => b.onclick = () => betaAdmin('remove', b.dataset.p));
        }
        async function betaAdminLoad() { const d = await v7get('/api/admin/beta'); if (d && d.ok) betaAdminRender(d.list); }
        async function betaAdmin(action, pseudo) {
            const inp = document.getElementById('adm-beta-pseudo');
            pseudo = pseudo || inp.value.trim();
            if (!pseudo) return toast('Écris un pseudo.', 'var(--accent-pink)');
            const d = await v7post('/api/admin/beta', { action, pseudo });
            if (!d || !d.ok) return toast('❌ ' + ((d && d.error) || 'Impossible (server.js à jour ?)'), 'var(--accent-pink)');
            if (action === 'add') { inp.value = ''; toast(`🧪 ${pseudo} est maintenant bêta testeur !`, '#00ff88'); } else toast(`${pseudo} n’est plus bêta testeur.`, '#aaa');
            betaAdminRender(d.list);
        }
        socket.on('beta_status', () => { checkAdmin(); if (typeof ecoLoad === 'function') ecoLoad(); });
        async function adminCoins(n) { const d = await v7post('/api/admin/coins', { n }); if (!d || !d.ok) toast('❌ ' + ((d && d.error) || 'Impossible'), 'var(--accent-pink)'); }
        async function adminBots(n) {
            if (!currentRoomCode) return;
            const skill = (document.getElementById('bot-skill') || {}).value || 0.5;
            const d = await v7post('/api/admin/bots', n ? { roomCode: currentRoomCode, n, skill } : { roomCode: currentRoomCode, remove: true });
            if (!d || !d.ok) return toast('❌ ' + ((d && d.error) || 'Impossible'), 'var(--accent-pink)');
            toast(n ? `🤖 ${d.names.length} bot${d.names.length > 1 ? 's' : ''} ajouté${d.names.length > 1 ? 's' : ''}` : `🤖 ${d.removed} bot(s) retiré(s)`, '#00ff88');
        }
        // --- persos ---
        async function loadAdminChars() {
            const d = await v7get('/api/admin/chars');
            if (!d || !d.ok) return;
            const sel = document.getElementById('adm-c-u');
            if (sel && !sel.options.length) sel.innerHTML = '<option value="">Choisis l\'anime</option>' + d.universes.map(u => `<option value="${v7esc(u.k)}">${v7esc(u.name)}</option>`).join('');
            const box = document.getElementById('adm-chars');
            if (box) box.innerHTML = d.rows.length ? d.rows.map(c => `<div class="friend-row"><span style="display:flex;align-items:center;gap:8px;font-size:.82rem;"><img src="/api/img?u=${encodeURIComponent(c.img)}" alt="" style="width:36px;height:36px;object-fit:cover;border-radius:6px;" onerror="this.style.opacity=.2"><span><b>${v7esc(c.name)}</b><br><small style="color:var(--text-muted)">${v7esc(c.anime)}${c.aliases && c.aliases.length ? ' • ' + c.aliases.map(v7esc).join(', ') : ''}</small></span></span><button onclick="delChar(${c.id}, this)">🗑️</button></div>`).join('') : '<p class="tl-hint">Aucun perso ajouté depuis ici pour le moment.</p>';
        }
        function admImgPrev() {
            const v = document.getElementById('adm-c-img').value.trim(), im = document.getElementById('adm-c-prev');
            if (/^https:\/\/\S+$/i.test(v)) { im.src = v; im.style.display = 'block'; } else im.style.display = 'none';
        }
        async function addChar() {
            const v = id => document.getElementById(id).value;
            const btn = event && event.target; if (btn) btn.disabled = true;
            const d = await v7post('/api/admin/chars', { universe: v('adm-c-u'), name: v('adm-c-name'), img: v('adm-c-img'), aliases: v('adm-c-alias') });
            if (btn) btn.disabled = false;
            if (d && d.ok) { toast('🧑‍🎤 Perso ajouté aux mini-jeux !', '#00ff88'); ['adm-c-name', 'adm-c-img', 'adm-c-alias'].forEach(id => { document.getElementById(id).value = ''; }); admImgPrev(); loadAdminChars(); }
            else toast('❌ ' + ((d && d.error) || 'Impossible'), 'var(--accent-pink)');
        }
        async function delChar(id, btn) {
            if (!btn.classList.contains('armed')) { btn.classList.add('armed'); btn.textContent = 'Sûr ?'; return; }
            await v7post('/api/admin/chars/delete', { id }); loadAdminChars();
        }
        // --- citations ---
        let admQuoteUnis = [];
        async function loadAdminQuotes() {
            const d = await v7get('/api/admin/quotes');
            if (!d || !d.ok) return;
            admQuoteUnis = d.universes;
            const sel = document.getElementById('adm-q-u');
            if (sel) { const cur = sel.value; sel.innerHTML = '<option value="">Choisis l\'anime</option>' + d.universes.map(u => `<option value="${v7esc(u.k)}">${v7esc(u.name)} (${u.n})</option>`).join(''); sel.value = cur; }
            admQuoteSpeakers();
            const box = document.getElementById('adm-quotes');
            if (box) box.innerHTML = d.rows.length ? d.rows.map(q => `<div class="friend-row"><span style="font-size:.82rem;">« ${v7esc(q.text)} »<br><small style="color:var(--text-muted)"><b style="color:var(--accent-cyan)">${v7esc(q.speaker)}</b> • ${v7esc(q.anime)}${q.recipient ? ' • ' + v7esc(q.recipient) : ''}</small></span><button onclick="delQuote(${q.id}, this)">🗑️</button></div>`).join('') : '<p class="tl-hint">Aucune citation ajoutée depuis ici pour le moment.</p>';
        }
        function admQuoteSpeakers() {
            const k = (document.getElementById('adm-q-u') || {}).value;
            const u = admQuoteUnis.find(x => x.k === k);
            const dl = document.getElementById('adm-q-speakers');
            if (dl) dl.innerHTML = u ? u.speakers.map(s => `<option value="${v7esc(s)}">`).join('') : '';
        }
        async function addQuote() {
            const v = id => document.getElementById(id).value;
            const d = await v7post('/api/admin/quotes', { universe: v('adm-q-u'), text: v('adm-q-text'), speaker: v('adm-q-speaker'), recipient: v('adm-q-rec'), aliases: v('adm-q-alias') });
            if (d && d.ok) { toast(`💬 Citation ajoutée (${d.n} pour cet anime)`, '#00ff88'); ['adm-q-text', 'adm-q-speaker', 'adm-q-rec', 'adm-q-alias'].forEach(id => { document.getElementById(id).value = ''; }); loadAdminQuotes(); }
            else toast('❌ ' + ((d && d.error) || 'Impossible'), 'var(--accent-pink)');
        }
        async function delQuote(id, btn) {
            if (!btn.classList.contains('armed')) { btn.classList.add('armed'); btn.textContent = 'Sûr ?'; return; }
            await v7post('/api/admin/quotes/delete', { id }); loadAdminQuotes();
        }
        // --- questions les plus ratées ---
        async function loadMissed() {
            const mode = (document.getElementById('adm-m-mode') || {}).value || '', min = (document.getElementById('adm-m-min') || {}).value || 3;
            const d = await v7get('/api/admin/missed?mode=' + encodeURIComponent(mode) + '&min=' + min);
            const box = document.getElementById('adm-missed');
            if (!box || !d || !d.ok) return;
            const sel = document.getElementById('adm-m-mode');
            if (sel) { const cur = sel.value; sel.innerHTML = '<option value="">Tous les modes</option>' + d.modes.map(m => `<option value="${v7esc(m.m)}">${v7esc(m.label)}</option>`).join(''); sel.value = cur; }
            box.innerHTML = d.rows.length ? d.rows.map((r, i) => {
                const f = r.info || {};
                const img = f.u && f.name ? `/api/avatar/img?u=${encodeURIComponent(f.u)}&n=${encodeURIComponent(f.name)}` : '';
                const col = r.rate >= 90 ? 'var(--accent-pink)' : r.rate >= 60 ? '#ff9a3c' : 'var(--accent-yellow)';
                const extra = r.mode.startsWith('quote') ? '' : f.text ? `« ${v7esc(f.text.slice(0, 120))} »` : f.emoji ? v7esc(f.emoji) : f.choices ? 'choix : ' + f.choices.map(v7esc).join(' / ') : '';
                return `<div class="miss-row">${img ? `<img src="${img}" alt="" loading="lazy" onerror="this.style.opacity=.15">` : `<div style="font-size:1.6rem;text-align:center;">${r.mode === 'blindtest' ? '🎵' : r.mode.startsWith('quote') ? '💬' : '❓'}</div>`}
                    <div><b>${v7esc(r.answer)}</b><br><small style="color:var(--accent-cyan)">${v7esc(r.label)}</small>${extra ? `<br><small style="color:var(--text-muted)">${extra}</small>` : ''}${f.video ? ` <a href="https://youtu.be/${v7esc(f.video)}" target="_blank" rel="noopener" style="color:var(--accent-cyan);font-size:.75rem;">▶️ vidéo</a>` : ''}</div>
                    <div><div class="miss-rate" style="color:${col}">${r.rate} %</div><small style="color:var(--text-muted)">${r.fails}/${r.plays} ratés</small><br><button class="kick-btn" style="margin-top:2px;" data-m="${v7esc(r.mode)}" data-a="${v7esc(r.answer)}" onclick="delMissed(this)">Remettre à 0</button></div></div>`;
            }).join('') : '<p class="tl-hint">Pas encore assez de parties jouées. Les stats se remplissent toutes seules pendant les parties.</p>';
        }
        async function delMissed(btn) { await v7post('/api/admin/missed/delete', { mode: btn.dataset.m, answer: btn.dataset.a }); loadMissed(); }
        // --- répertoire ---
        let catT = 'chars';
        function catType(t) {
            catT = t;
            document.querySelectorAll('.cat-tabs button').forEach(b => b.classList.toggle('on', b.dataset.t === t));
            const sel = document.getElementById('cat-u'); if (sel) { sel.innerHTML = ''; }
            loadCatalog();
        }
        async function loadCatalog() {
            const sel = document.getElementById('cat-u'), q = (document.getElementById('cat-q') || {}).value || '';
            const box = document.getElementById('cat-list'), info = document.getElementById('cat-info');
            if (!box) return;
            const d = await v7get(`/api/admin/catalog?type=${catT}&u=${encodeURIComponent(sel && sel.value || '')}&q=${encodeURIComponent(q.trim())}`);
            if (!d || !d.ok) return;
            if (sel && !sel.options.length) {
                const tot = d.universes.reduce((a, u) => a + u.n, 0);
                sel.innerHTML = `<option value="">— ${d.universes.length} animes • ${tot} au total —</option>` + d.universes.map(u => `<option value="${v7esc(u.k)}">${v7esc(u.name)} (${u.n})</option>`).join('');
            }
            const nm = { chars: 'persos', quotes: 'citations', tracks: 'musiques', dle: 'persos AnimeDLE' }[catT];
            if (!sel.value && !q.trim()) { info.textContent = `Choisis un anime ou fais une recherche pour afficher les ${nm}.`; box.innerHTML = ''; return; }
            info.textContent = `${d.total} ${nm}${d.total > d.items.length ? ` (${d.items.length} affichés, affine la recherche)` : ''} • en vert : ajoutés depuis l'admin`;
            if (catT === 'chars') box.innerHTML = `<div class="cat-grid">${d.items.map(c => `<div class="${c.custom ? 'cu' : ''}"><img src="${v7esc(c.img)}" alt="" loading="lazy" decoding="async" onerror="this.style.opacity=.12"><b>${v7esc(c.name)}</b>${sel.value ? '' : `<br><small style="color:var(--text-muted)">${v7esc(c.anime)}</small>`}</div>`).join('')}</div>`;
            else if (catT === 'quotes') box.innerHTML = d.items.map(x => `<div class="cat-row ${x.custom ? 'cu' : ''}">« ${v7esc(x.text)} »<br><small><b style="color:var(--accent-cyan)">${v7esc(x.speaker)}</b>${x.recipient ? ' • ' + v7esc(x.recipient) : ''}${sel.value ? '' : ' • ' + v7esc(x.anime)}</small></div>`).join('');
            else if (catT === 'tracks') box.innerHTML = d.items.map(x => `<div class="cat-row ${x.custom ? 'cu' : ''}" style="display:flex;justify-content:space-between;gap:8px;align-items:center;"><span><b>${v7esc(x.anime)}</b> • ${v7esc(x.title)}</span>${x.video ? `<a href="https://youtu.be/${v7esc(x.video)}" target="_blank" rel="noopener" style="color:var(--accent-cyan);white-space:nowrap;">▶️ Écouter</a>` : '<small style="color:var(--text-muted)">pas de vidéo</small>'}</div>`).join('');
            else box.innerHTML = `<div class="cat-wrap"><table class="cat-dle"><tr><th>Perso</th>${(d.cats || []).map(c => `<th>${v7esc(c)}</th>`).join('')}${d.cats && d.cats.length ? '' : '<th>Anime</th>'}</tr>${d.items.map(x => `<tr><td><b>${v7esc(x.name)}</b></td>${d.cats && d.cats.length ? x.vals.map(v => `<td>${v7esc(v)}</td>`).join('') : `<td>${v7esc(x.anime)}</td>`}</tr>`).join('')}</table></div>`;
        }
        (function () {
            const orig = window.switchTab;
            window.switchTab = function (t) { const r = orig.apply(this, arguments); if (t === 'admin') loadAdmin(); return r; };
        })();
        fetch('/api/site').then(r => r.json()).then(applySite).catch(() => {});

        /* ===== 7 barré dans la police Bangers (sinon on le confond avec le 1) ===== */
        (function () {
            const pending = new Set(); let raf = 0;
            const isBangers = el => { try { return /bangers/i.test(getComputedStyle(el).fontFamily); } catch (_) { return false; } };
            function fixNode(t) {
                const el = t.parentElement;
                if (!el || !t.isConnected || !t.nodeValue || t.nodeValue.indexOf('7') < 0) return;
                if (el.classList.contains('seven') || el.isContentEditable || /^(SCRIPT|STYLE|TEXTAREA|INPUT|OPTION|TITLE)$/.test(el.tagName)) return;
                if (!isBangers(el)) return;
                const frag = document.createDocumentFragment();
                t.nodeValue.split(/(7)/).forEach(part => {
                    if (!part) return;
                    if (part === '7') { const sp = document.createElement('span'); sp.className = 'seven'; sp.textContent = '7'; frag.appendChild(sp); }
                    else frag.appendChild(document.createTextNode(part));
                });
                t.replaceWith(frag);
            }
            function scan(root) {
                if (root.nodeType === 3) { pending.add(root); return; }
                if (root.nodeType !== 1) return;
                const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
                let n; while ((n = w.nextNode())) if (n.nodeValue.indexOf('7') >= 0) pending.add(n);
            }
            function flush() { raf = 0; const list = [...pending]; pending.clear(); list.forEach(fixNode); }
            const mo = new MutationObserver(muts => {
                muts.forEach(m => { if (m.type === 'characterData') pending.add(m.target); else m.addedNodes.forEach(scan); });
                if (pending.size && !raf) raf = requestAnimationFrame(flush);
            });
            const start = () => { scan(document.body); flush(); mo.observe(document.body, { childList: true, subtree: true, characterData: true }); };
            if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
        })();
