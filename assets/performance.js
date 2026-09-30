/* ---------- ANTI-LAG ---------- */
        (function () {
            const root = document.documentElement;
            let perfMode = false;
            try { perfMode = localStorage.getItem('perfMode') === '1'; } catch (_) {}
            root.classList.toggle('lowfx', perfMode);
            // pendant une partie : les décors se figent (tout le processeur va au jeu)
            setInterval(() => { root.classList.toggle('in-game', !!currentRoomCode); }, 1000);
            // si l'appareil est lent (moins de 40 images/s), on passe tout seul en mode performance
            function probe() {
                if (perfMode || document.hidden) return;
                let n = 0; const t0 = performance.now();
                const f = t => { n++; if (t - t0 < 2500) requestAnimationFrame(f); else { const fps = n / ((t - t0) / 1000); if (fps < 40 && !document.hidden) { root.classList.add('lowfx'); } } };
                requestAnimationFrame(f);
            }
            setTimeout(probe, 4000);
            window.setPerfMode = function (on) {
                perfMode = !!on; try { localStorage.setItem('perfMode', on ? '1' : '0'); } catch (_) {}
                root.classList.toggle('lowfx', perfMode);
                toast(on ? '⚡ Mode performance activé : décors figés' : '✨ Décors animés réactivés', '#00f0ff');
            };
            const opt = document.querySelector('#options > div');
            if (opt && !document.getElementById('perf-opt')) {
                const d = document.createElement('div'); d.id = 'perf-opt'; d.style.cssText = 'margin-top:14px;';
                d.innerHTML = `<label style="display:flex;gap:8px;align-items:center;cursor:pointer;"><input type="checkbox" ${perfMode ? 'checked' : ''} onchange="setPerfMode(this.checked)"> ⚡ <b>Mode performance</b></label><small class="tl-hint" style="display:block;text-align:left;">Fige les décors animés si le jeu rame sur ton appareil.</small>`;
                opt.appendChild(d);
            }
        })();
