/* =====================================================================
           THÈMES DU SITE : évènements selon la date + décor qui change chaque
           semaine le reste de l'année. Seul l'admin peut forcer un thème.
           ===================================================================== */
        const SITE_THEMES = {
            halloween: '🎃 Halloween', noel: '🎄 Noël', valentin: '💘 Saint-Valentin', hanami: '🌸 Hanami (printemps)',
            tokyo: '🌃 Tokyo néon', ninja: '🌙 Village ninja'
        };
        const THEME_ROTATION = ['tokyo', 'ninja'];
        siteTheme = function () {
            const t = SITE_STATE.theme;
            if (SITE_THEMES[t]) return t;
            if (t === 'none') return 'none'; // un ancien thème retiré repasse en automatique
            const d = new Date(), m = d.getMonth() + 1, day = d.getDate();
            if (m === 2 && day >= 7 && day <= 15) return 'valentin';
            if ((m === 3 && day >= 20) || m === 4) return 'hanami';
            if (m === 10 || (m === 11 && day <= 2)) return 'halloween';
            if (m === 12) return 'noel';
            // le reste de l'année : un nouveau décor chaque semaine
            const wk = Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000 + 3) / 7);
            return THEME_ROTATION[wk % THEME_ROTATION.length];
        };
        const svgLand = inner => `<svg class="dk-land" viewBox="0 0 1200 200" preserveAspectRatio="xMidYMax slice">${inner}</svg>`;
        const rnd = (i, a) => ((Math.sin(i * 12.9898 + a * 78.233) * 43758.5453) % 1 + 1) % 1;
        function decoBursts(n, colors) { // feux d'artifice qui éclosent sur place (rien ne tombe)
            let h = '';
            for (let i = 0; i < n; i++) {
                const c = colors[i % colors.length], x = 8 + rnd(i, 1) * 84, y = 6 + rnd(i, 2) * 30, s = 70 + rnd(i, 3) * 70;
                let rays = '';
                for (let r = 0; r < 14; r++) { const a = r * Math.PI / 7; rays += `<line x1="${50 + Math.cos(a) * 8}" y1="${50 + Math.sin(a) * 8}" x2="${50 + Math.cos(a) * 46}" y2="${50 + Math.sin(a) * 46}"/><circle cx="${50 + Math.cos(a) * 48}" cy="${50 + Math.sin(a) * 48}" r="2.2"/>`; }
                h += `<svg class="dk-burst" viewBox="0 0 100 100" style="left:${x}%;top:${y}%;width:${s}px;height:${s}px;animation-delay:-${(rnd(i, 4) * 4).toFixed(2)}s;stroke:${c};fill:${c}">${rays}</svg>`;
            }
            return `<div class="dk-bursts">${h}</div>`;
        }
        function decoSkyline(fill, win, n) {
            let s = `<path d="M0 200V150H1200V200Z" fill="${fill}"/>`, wins = '';
            let x = 0, i = 0;
            while (x < 1200) {
                const w = 40 + rnd(i, 5) * 60, h = 50 + rnd(i, 6) * (n || 110);
                s += `<rect x="${x}" y="${200 - h}" width="${w - 4}" height="${h}" fill="${fill}"/>`;
                for (let yy = 200 - h + 10; yy < 190; yy += 14) for (let xx = x + 6; xx < x + w - 12; xx += 12) if (rnd(xx, yy) > 0.62) wins += `<rect x="${xx}" y="${yy}" width="5" height="7" fill="${win}" class="${rnd(yy, xx) > 0.85 ? 'dk-glow b' : ''}"/>`;
                x += w; i++;
            }
            return s + wins;
        }
        function decoBranch(side, blossom, leaf) { // branche fleurie dans un coin
            const flowers = Array.from({ length: 26 }, (_, i) => { const t = i / 26, x = 10 + t * 250 + rnd(i, 7) * 30, y = 20 + Math.sin(t * 3) * 40 + rnd(i, 8) * 50; return leaf ? `<path d="M${x} ${y}l6-9 4 7 8-3-4 8 7 4-9 2 1 9-7-5-6 6-1-9-8-2 7-5z" fill="${blossom[i % blossom.length]}" opacity=".9"/>` : `<g transform="translate(${x} ${y})" fill="${blossom[i % blossom.length]}"><circle r="5" cx="0" cy="-5"/><circle r="5" cx="5" cy="-1"/><circle r="5" cx="3" cy="5"/><circle r="5" cx="-3" cy="5"/><circle r="5" cx="-5" cy="-1"/><circle r="2.4" fill="#fff6b0"/></g>`; }).join('');
            return `<svg class="dk-branch ${side}" viewBox="0 0 300 160"><path d="M-10 30C60 40 120 20 180 60S260 90 300 80M60 38C80 70 90 90 120 110M150 48C160 20 190 10 210 5" stroke="#3b2418" stroke-width="7" fill="none" stroke-linecap="round"/>${flowers}</svg>`;
        }
        const THEME_DECO = {
            halloween: () => decoHalloween(),
            noel: () => decoNoel(),
            nouvelan: () => decoStars(60) + decoBursts(7, ['#ffd700', '#ff4d6d', '#48dbfb', '#b77bff', '#7dffb0']) + svgLand(decoSkyline('#0b1026', '#ffd76b', 90) + '<path d="M0 200V190H1200V200Z" fill="#070a18"/>'),
            valentin: () => {
                const hearts = Array.from({ length: 9 }, (_, i) => `<span class="dk-heart" style="left:${6 + rnd(i, 9) * 88}%;top:${8 + rnd(i, 10) * 45}%;font-size:${16 + rnd(i, 11) * 26}px;animation-delay:-${(rnd(i, 12) * 5).toFixed(1)}s">${['💗', '💖', '💕', '❤️'][i % 4]}</span>`).join('');
                const tree = `<g transform="translate(600 120)"><path d="M-6 80V10M0 20L-30 -10M0 30L30 0" stroke="#4a2030" stroke-width="10" stroke-linecap="round"/>${Array.from({ length: 22 }, (_, i) => `<path transform="translate(${-70 + rnd(i, 13) * 140} ${-60 + rnd(i, 14) * 70}) scale(${0.8 + rnd(i, 15) * 0.8})" d="M0 6C-8-2-10-8-5-11S2-9 0-6C2-9 6-12 9-9S8-2 0 6Z" fill="${['#ff4d8d', '#ff8fb8', '#e11d62'][i % 3]}"/>`).join('')}</g>`;
                return `<div class="dk-moon" style="background:radial-gradient(circle at 40% 40%,#fff,#ffd1e3 70%,#ff9ec4);box-shadow:0 0 70px 20px rgba(255,120,180,.3);opacity:.8"></div>` + hearts
                    + svgLand(`<path d="M0 200V150Q300 110 600 140T1200 130V200Z" fill="#3a1030"/>${tree}<path d="M0 200V178Q400 160 800 175T1200 170V200Z" fill="#24081e"/>`);
            },
            hanami: () => {
                const fuji = '<path d="M380 200L600 60L820 200Z" fill="#6d7fb3"/><path d="M560 86L600 60L640 86L624 96L610 88L596 98L582 88L570 96Z" fill="#f4f7ff"/>';
                const torii = '<g transform="translate(860 110)" fill="#d7263d"><rect x="0" y="10" width="8" height="80"/><rect x="62" y="10" width="8" height="80"/><path d="M-14 0H84L78 10H-8Z"/><rect x="-4" y="22" width="78" height="6"/></g>';
                const tree = (x, s) => `<g transform="translate(${x} 150) scale(${s})"><path d="M0 50V0M0 10L-25-20M0 0L20-30" stroke="#4a2c1e" stroke-width="8" stroke-linecap="round"/>${Array.from({ length: 16 }, (_, i) => `<circle cx="${-45 + rnd(i + x, 16) * 90}" cy="${-60 + rnd(i + x, 17) * 50}" r="${10 + rnd(i + x, 18) * 12}" fill="${['#ffc1d9', '#ff9ec4', '#ffd6e7'][i % 3]}" opacity=".95"/>`).join('')}</g>`;
                return `<div class="dk-moon" style="background:radial-gradient(circle at 40% 40%,#fff4f8,#ffc9dc 70%,#ff9ec4);box-shadow:0 0 70px 20px rgba(255,160,200,.3);opacity:.85"></div>` + decoBranch('l', ['#ffc1d9', '#ff9ec4', '#fff']) + decoBranch('r', ['#ffc1d9', '#ff9ec4', '#fff'])
                    + svgLand(`${fuji}<path d="M0 200V160Q300 140 600 165T1200 150V200Z" fill="#3d2a4a"/>${torii}${tree(160, 1.2)}${tree(1040, 1.1)}${tree(330, .8)}<path d="M0 200V185Q600 172 1200 185V200Z" fill="#2a1d36"/>`);
            },
            matsuri: () => {
                const stall = (x) => `<g transform="translate(${x} 130)"><path d="M-10 0H110L100 -18H0Z" fill="#b91c1c"/><path d="M0 -18H100" stroke="#fff" stroke-width="3" stroke-dasharray="10 10"/><rect x="0" y="0" width="100" height="60" fill="#1b1026"/><rect x="10" y="12" width="80" height="22" fill="#ffb347" class="dk-glow"/><circle cx="-4" cy="8" r="9" fill="#ff5a2a" class="dk-glow b"/><circle cx="104" cy="8" r="9" fill="#ff5a2a" class="dk-glow"/></g>`;
                return decoStars(40) + '<div class="dk-moon" style="opacity:.8"></div>' + decoBursts(5, ['#ff5a2a', '#ffd700', '#48dbfb', '#ff4d8d'])
                    + svgLand(`<path d="M0 200V170Q600 150 1200 170V200Z" fill="#150b20"/>${stall(170)}${stall(420)}${stall(680)}${stall(930)}<path d="M0 200V192H1200V200Z" fill="#0d0716"/>`);
            },
            automne: () => {
                const pagoda = '<g transform="translate(780 60)" fill="#2a1410"><rect x="30" y="20" width="20" height="120"/>' + [0, 1, 2, 3].map(i => `<path d="M${-10 + i * 6} ${30 + i * 28}H${90 - i * 6}L${76 - i * 6} ${18 + i * 28}H${4 + i * 6}Z"/>`).join('') + '<path d="M40 -6V20" stroke="#2a1410" stroke-width="4"/></g>';
                const tree = (x, s) => `<g transform="translate(${x} 150) scale(${s})"><path d="M0 50V0" stroke="#3b2418" stroke-width="8"/>${Array.from({ length: 14 }, (_, i) => `<circle cx="${-40 + rnd(i + x, 19) * 80}" cy="${-55 + rnd(i + x, 20) * 50}" r="${10 + rnd(i + x, 21) * 12}" fill="${['#e2562b', '#f59e0b', '#b91c1c', '#d97706'][i % 4]}"/>`).join('')}</g>`;
                return `<div class="dk-moon" style="background:radial-gradient(circle at 40% 40%,#fff1d6,#ffb347 70%,#e2562b);box-shadow:0 0 80px 24px rgba(255,140,40,.3);opacity:.85"></div>` + decoBranch('l', ['#e2562b', '#f59e0b', '#b91c1c'], true) + decoBranch('r', ['#f59e0b', '#e2562b', '#d97706'], true)
                    + svgLand(`<path d="M0 200V140Q300 110 600 135T1200 120V200Z" fill="#4a1f10"/>${pagoda}${tree(150, 1.2)}${tree(320, .9)}${tree(1050, 1.1)}<path d="M0 200V175Q600 160 1200 178V200Z" fill="#2a120a"/>`);
            },
            tokyo: () => {
                const tower = '<g transform="translate(560 20)" stroke="#ff3b6b" stroke-width="3" fill="none" class="dk-neon"><path d="M40 0L10 180M40 0L70 180M18 130H62M26 80H54M32 40H48M10 180L70 130M70 180L10 130M18 130L54 80M62 130L26 80"/></g>';
                const signs = [[160, 70, '#ff3bd4'], [330, 95, '#3bf0ff'], [800, 80, '#fff23b'], [990, 60, '#3bff9e']].map(([x, y, c], i) => `<rect x="${x}" y="${y}" width="46" height="14" rx="3" fill="none" stroke="${c}" stroke-width="3" class="dk-neon" style="animation-delay:-${i * .7}s"/>`).join('');
                return decoStars(25) + svgLand(`${decoSkyline('#0d0b1e', '#7de3ff', 140)}${tower}${signs}`) + '<div class="dk-grid"></div>';
            },
            ocean: () => {
                const ship = '<g transform="translate(760 92)"><g class="dk-ship"><path d="M0 40H130L112 62H18Z" fill="#2b1a10"/><path d="M60 40V-30M60 -30L110 20H60M60 -24L18 22H60" stroke="#2b1a10" stroke-width="4" fill="#f3ead2"/><path d="M60 -30H78L74 -22H60Z" fill="#111"/><circle cx="68" cy="-3" r="7" fill="#111"/></g></g>';
                const island = '<g transform="translate(180 120)"><ellipse cx="60" cy="40" rx="90" ry="18" fill="#c8a86b"/><path d="M50 40C48 10 56 -10 70 -30" stroke="#5b3a1e" stroke-width="6" fill="none"/><path d="M70 -30C40 -40 20 -30 10 -20M70 -30C90 -50 110 -45 125 -35M70 -30C60 -55 70 -70 85 -75M70 -30C100 -25 115 -10 120 5" stroke="#1f7a3a" stroke-width="9" fill="none" stroke-linecap="round"/></g>';
                const birds = [0, 1, 2].map(i => `<path class="dk-bird" style="animation-delay:-${i * 1.3}s" d="M${420 + i * 60} ${40 + i * 12}q8-8 16 0q8-8 16 0" stroke="#1d2233" stroke-width="3" fill="none"/>`).join('');
                return `<div class="dk-moon" style="background:radial-gradient(circle at 50% 50%,#fff7d6,#ffcf6b 60%,#ff8a3c);box-shadow:0 0 90px 30px rgba(255,160,60,.35);top:auto;bottom:90px;right:18%;opacity:.9"></div>`
                    + svgLand(`${birds}${island}${ship}<path class="dk-wave" d="M0 160Q50 150 100 160T200 160T300 160T400 160T500 160T600 160T700 160T800 160T900 160T1000 160T1100 160T1200 160T1300 160V200H0Z" fill="#1f5f8b"/><path class="dk-wave b" d="M-100 175Q-50 165 0 175T100 175T200 175T300 175T400 175T500 175T600 175T700 175T800 175T900 175T1000 175T1100 175T1200 175V200H-100Z" fill="#153f63"/>`);
            },
            ninja: () => {
                const roof = (x, y, w) => `<g transform="translate(${x} ${y})"><path d="M${-w * .15} 20Q${w / 2} 0 ${w * 1.15} 20L${w} 26H0Z" fill="#141a2e"/><rect x="${w * .1}" y="26" width="${w * .8}" height="${200 - y}" fill="#101526"/><rect x="${w * .3}" y="36" width="10" height="12" fill="#ffcf6b" class="dk-glow"/><rect x="${w * .6}" y="36" width="10" height="12" fill="#ffcf6b" class="dk-glow b"/></g>`;
                const ninja = '<g transform="translate(905 64)" fill="#05070f"><circle cx="10" cy="0" r="7"/><path d="M4 6H18L22 30H16L14 44H6L4 30H0Z"/><path d="M18 8L40 -2" stroke="#05070f" stroke-width="3"/><path d="M8 3L-8 -4" stroke="#05070f" stroke-width="2"/></g>';
                return decoStars(50) + '<div class="dk-moon" style="width:170px;height:170px;background:radial-gradient(circle at 40% 40%,#fffbe8,#ffe7a3 70%,#f2c46b);opacity:.9"></div>'
                    + svgLand(`<path d="M0 200V110L140 60L260 120L400 50L560 130L700 70L860 125L1000 55L1200 115V200Z" fill="#1c2340"/><path d="M0 200V140L180 100L320 150L500 95L660 150L820 105L980 150L1200 110V200Z" fill="#161c33"/>${roof(120, 130, 90)}${roof(260, 145, 70)}${roof(640, 135, 100)}${roof(860, 110, 110)}${ninja}${roof(1040, 140, 80)}`);
            }
        };
        themeParticles = function () {
            const layer = document.getElementById('theme-layer');
            if (!layer) return;
            const t = siteTheme();
            Object.keys(SITE_THEMES).forEach(k => document.documentElement.classList.toggle('theme-' + k, k === t));
            if (layer.dataset.t === t) return;
            layer.dataset.t = t;
            layer.innerHTML = THEME_DECO[t] ? THEME_DECO[t]() : '';
        };
        themeParticles();
        // liste de l'admin : tous les thèmes
        (function () {
            const sel = document.getElementById('adm-theme');
            if (!sel) return;
            sel.innerHTML = `<option value="auto">📅 Auto : évènements selon la date, sinon un nouveau décor chaque semaine</option><option value="none">Aucun décor</option>` + Object.entries(SITE_THEMES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
            sel.value = SITE_STATE.theme || 'auto';
        })();
