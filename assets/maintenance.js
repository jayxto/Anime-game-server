/* ---------- Écran « mise à jour en cours » (site fermé par l'admin) ---------- */
        (function () {
            function render() {
                const m = (typeof SITE_STATE !== 'undefined' && SITE_STATE.maintenance) || {};
                const onAuth = (() => { const a = document.getElementById('auth-screen'); return a && a.style.display !== 'none' && a.offsetParent !== null; })();
                const lockedForMe = !!m.lock && !window.IS_ADMIN;
                let o = document.getElementById('maint-lock');
                if (lockedForMe && !(onAuth && window.__adminLogin)) {
                    if (!o) { o = document.createElement('div'); o.id = 'maint-lock'; document.body.appendChild(o); }
                    const html = `<div class="ml-box"><div class="ml-ico">🛠️</div><h1>Mise à jour en cours</h1><p>${v7esc(m.msg || 'On améliore le site pour toi : nouveaux modes, corrections et surprises.')}</p><p>Reviens un peu plus tard, la page se rouvrira toute seule dès que c’est fini ✨</p>${m.back ? `<div class="ml-back">⏰ Retour prévu : ${v7esc(m.back)}</div>` : ''}<div class="ml-bar"><i></i></div><small><a href="#" onclick="window.__adminLogin=1;document.getElementById('maint-lock').remove();return false;" style="color:inherit;">Accès admin</a></small></div>`;
                    if (o.dataset.h !== html) { o.innerHTML = html; o.dataset.h = html; }
                } else if (o) o.remove();
                // pastille pour l'admin : rappel que le site est fermé
                let p = document.getElementById('admin-lock-pill');
                if (m.lock && window.IS_ADMIN) { if (!p) { p = document.createElement('div'); p.id = 'admin-lock-pill'; p.className = 'admin-lock-pill'; p.textContent = '🔒 Site fermé aux joueurs (clique pour gérer)'; p.onclick = () => switchTab('admin'); document.body.appendChild(p); } }
                else if (p) p.remove();
            }
            socket.on('site_settings', () => setTimeout(render, 0));
            setInterval(render, 1500);
            render();
        })();
