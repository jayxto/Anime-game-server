/* ---------- Décors : lumières d'ambiance (rien ne tombe) ---------- */
        (function () {
            const orig = themeParticles;
            themeParticles = function () {
                const r = orig.apply(this, arguments);
                const layer = document.getElementById('theme-layer');
                if (layer && layer.innerHTML && !layer.querySelector('.dk-aura')) {
                    let m = '';
                    for (let i = 0; i < 26; i++) {
                        const R = k => ((Math.sin((i + 1) * 12.9898 + k * 78.233) * 43758.5453) % 1 + 1) % 1;
                        m += `<i style="left:${(R(1) * 100).toFixed(1)}%;top:${(8 + R(2) * 78).toFixed(1)}%;--s:${(2 + R(3) * 4).toFixed(1)}px;--d:${(5 + R(4) * 7).toFixed(1)}s;--dl:-${(R(5) * 10).toFixed(1)}s;--mx:${Math.round(R(6) * 40 - 20)}px;--my:${Math.round(R(7) * 40 - 20)}px"></i>`;
                    }
                    layer.insertAdjacentHTML('afterbegin', '<div class="dk-aura"></div>');
                    layer.insertAdjacentHTML('beforeend', `<div class="dk-motes">${m}</div><div class="dk-vig"></div>`);
                }
                return r;
            };
            const l = document.getElementById('theme-layer'); if (l) { l.dataset.t = ''; themeParticles(); }
        })();
