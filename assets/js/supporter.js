/* =====================================================================
           SOUTIEN : Supporter 💎 (Ko-fi / abonnement), petites pubs discrètes et fermables
           ===================================================================== */
        let MONEY = { kofiUrl: '', stripe: false, price: 1.99, ads: null, me: null };
        const isSup = () => !!(MONEY.me && MONEY.me.supporter);
        async function moneyLoad() {
            const d = await v7get('/api/money/config');
            if (d && d.ok) MONEY = d;
            const b = document.getElementById('btn-support'); if (b) b.classList.toggle('on', isSup());
            adsRender();
            if (document.getElementById('sup-modal')) openSupport();
        }
        (function () {
            const o = showApp;
            showApp = function () { const r = o.apply(this, arguments); setTimeout(moneyLoad, 300); return r; };
            const n = cosNameHtml;
            cosNameHtml = function (name, cos) { return n(name, cos) + (cos && cos.sup ? '<span class="cn-sup" title="Supporter du jeu">💎</span>' : ''); };
            const sb = showBooster;
            showBooster = function (cards) { const r = sb.apply(this, arguments); if (isSup()) document.getElementById('summon')?.classList.add('sup'); return r; };
            socket.on('supporter_payfail', () => toast('⚠️ Le paiement de ton abonnement Supporter a échoué. Mets à jour ta carte depuis 💎 Soutenir → Gérer mon abonnement.', '#ff2a5f'));
            socket.on('supporter_on', () => { toast('💎 <b>Merci pour ton soutien !</b> Ton badge Supporter est actif.', '#b44dff'); moneyLoad(); });
            const q = new URLSearchParams(location.search).get('supporter');
            if (q) {
                try { history.replaceState(null, '', location.pathname); } catch (_) {}
                if (q === 'ok') setTimeout(() => { toast('💎 <b>Merci énormément !</b> Ton abonnement Supporter est en cours d’activation (quelques secondes).', '#b44dff'); setTimeout(moneyLoad, 4000); }, 1500);
            }
            // emplacements de pub : bas de l'accueil et bas de la collection
            const home = document.getElementById('menu-selection'), col = document.getElementById('collection');
            [home, col].forEach(el => { if (el && !el.querySelector(':scope > .ad-slot')) { const d = document.createElement('div'); d.className = 'ad-slot'; el.appendChild(d); } });
            if (!authToken) setTimeout(moneyLoad, 800);
        })();

        /* ---------- fenêtre Soutenir ---------- */
        function openSupport() {
            const m = MONEY.me, until = m && m.until > Date.now() ? new Date(m.until).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : null;
            const perks = `<ul class="sup-perks">
                <li><span>💎</span><div><b>Badge Supporter</b> à côté de ton pseudo, partout sur le site</div></li>
                <li><span class="cn cn-prisme">Aa</span><div><b>Pseudo « Prisme »</b> : une couleur animée arc-en-ciel réservée aux Supporters</div></li>
                <li><span>🔮</span><div><b>Invocations arc-en-ciel</b> : ton cercle magique change de couleur quand tu ouvres un booster</div></li>
                <li><span>🚫</span><div><b>Plus aucune pub</b> sur le site</div></li>
                <li><span>❤️</span><div>Tu aides à payer le serveur et les nouveaux modes</div></li></ul>
                <p class="tl-hint">Que du cosmétique : aucun avantage en partie, aucune pièce ni carte.</p>`;
            let status = '';
            if (m && m.supporter) status = `<div class="sup-status">💎 <b>Tu es Supporter</b> jusqu’au ${until}${m.sub ? ' (renouvelé chaque mois)' : ''}. Merci !
                <label class="sup-toggle"><input type="checkbox" ${m.prism ? 'checked' : ''} onchange="supPrism(this.checked)"> Pseudo « Prisme »</label>
                ${m.canManage ? `<button class="sup-link" onclick="supPortal()">Gérer ou arrêter mon abonnement</button>` : ''}</div>`;
            else if (m && m.canManage) status = `<div class="sup-status">Ton abonnement est terminé. <button class="sup-link" onclick="supPortal()">Voir mon abonnement</button></div>`;
            const needAcc = !isAccount();
            const sub = `<div class="sup-opt"><h3>🔁 Abonnement</h3><div class="sup-price">${String(MONEY.price.toFixed(2)).replace('.', ',')} €<small>/mois</small></div>
                <p class="tl-hint">Badge actif tant que tu es abonné. Paiement sécurisé par Stripe, arrêt quand tu veux.</p>
                ${needAcc ? '<p class="tl-hint">Crée un compte pour t’abonner.</p>' : m && m.sub && m.supporter ? '<p class="sup-note">✅ Tu es déjà abonné, merci !</p>' : MONEY.stripe ? `<button class="btn-action" onclick="supCheckout(this)">💳 S’abonner</button>` : '<p class="tl-hint">Bientôt disponible.</p>'}</div>`;
            const pseudo = m && m.pseudo ? m.pseudo : (currentUser && currentUser.pseudo) || '';
            const don = `<div class="sup-opt"><h3>☕ Don libre</h3><div class="sup-price">dès 2 €</div>
                <p class="tl-hint">Chaque tranche de 2 € = 1 mois de badge Supporter.</p>
                ${MONEY.kofiUrl ? `${needAcc ? '' : `<p class="sup-note">✍️ Écris ton pseudo <b>${v7esc(pseudo)}</b> dans le message du don${MONEY.kofiAuto ? ' : le badge arrive tout seul' : ''}.</p>`}
                <a class="btn-action sup-kofi" href="${v7esc(MONEY.kofiUrl)}" target="_blank" rel="noopener">☕ Faire un don sur Ko-fi</a>` : '<p class="tl-hint">Bientôt disponible.</p>'}</div>`;
            hubModal('sup-modal', `<h3>💎 Soutenir Anime Game</h3><p class="tl-hint">Le jeu est gratuit et le restera. Si tu l’aimes, tu peux aider à le faire vivre :</p>
                ${status}${perks}<div class="sup-opts">${sub}${don}</div>`, true);
        }
        async function supCheckout(btn) {
            if (btn) { btn.disabled = true; btn.textContent = 'Ouverture du paiement…'; }
            const d = await v7post('/api/money/checkout', {});
            if (d && d.ok && d.url) { location.href = d.url; return; }
            if (btn) { btn.disabled = false; btn.textContent = '💳 S’abonner'; }
            toast((d && d.error) || 'Paiement indisponible.', '#ff2a5f');
        }
        async function supPortal() {
            const d = await v7post('/api/money/portal', {});
            if (d && d.ok && d.url) location.href = d.url; else toast((d && d.error) || 'Indisponible.', '#ff2a5f');
        }
        async function supPrism(on) {
            const d = await v7post('/api/money/prism', { on });
            if (d && d.ok) { MONEY.me.prism = d.prism; toast(d.prism ? 'Pseudo Prisme activé ✨' : 'Pseudo Prisme désactivé', '#b44dff'); }
        }

        /* ---------- pubs : petites, en bas de page, jamais pendant une partie, fermables ---------- */
        function adClosed() { try { return +localStorage.getItem('adClosedUntil') > Date.now(); } catch (_) { return false; } }
        function adClose(btn) {
            try { localStorage.setItem('adClosedUntil', String(Date.now() + 3 * 3600000)); } catch (_) {}
            document.querySelectorAll('.ad-slot').forEach(s => { s.innerHTML = ''; s.style.display = 'none'; });
        }
        let adsScript = false;
        function adsRender() {
            const slots = document.querySelectorAll('.ad-slot');
            const show = !isSup() && !adClosed();
            slots.forEach(s => {
                if (!show) { s.innerHTML = ''; s.style.display = 'none'; return; }
                if (MONEY.ads && MONEY.ads.client) {
                    if (s.dataset.kind === 'ad') return;
                    s.dataset.kind = 'ad'; s.style.display = '';
                    s.innerHTML = `<div class="ad-box"><div class="ad-top"><small>Publicité</small><button class="ad-x" title="Masquer les pubs" onclick="adClose(this)">✕</button></div>
                        <ins class="adsbygoogle" style="display:block;width:100%;max-height:100px;" data-ad-client="${v7esc(MONEY.ads.client)}"${MONEY.ads.slot ? ` data-ad-slot="${v7esc(MONEY.ads.slot)}"` : ''} data-ad-format="horizontal" data-full-width-responsive="true"></ins>
                        <button class="ad-free" onclick="openSupport()">💎 Retirer les pubs</button></div>`;
                    if (!adsScript) { adsScript = true; const sc = document.createElement('script'); sc.async = true; sc.crossOrigin = 'anonymous'; sc.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + encodeURIComponent(MONEY.ads.client); document.head.appendChild(sc); }
                    try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (_) {}
                } else if (MONEY.kofiUrl && s.parentElement && s.parentElement.id === 'menu-selection') {
                    if (s.dataset.kind === 'house') return;
                    s.dataset.kind = 'house'; s.style.display = '';
                    s.innerHTML = `<div class="ad-box house"><button class="ad-x" title="Masquer" onclick="adClose(this)">✕</button><span>💎</span><div><b>Le jeu te plaît ?</b><br><small>Il est gratuit et sans pub envahissante. Tu peux le soutenir et avoir un badge.</small></div><button class="btn-action" onclick="openSupport()">Soutenir</button></div>`;
                } else { s.innerHTML = ''; s.style.display = 'none'; delete s.dataset.kind; }
            });
        }

        /* ---------- ADMIN : soutien et pubs ---------- */
        (function () {
            const box = document.getElementById('h3-admin') || document.getElementById('admin'); if (!box || document.getElementById('mn-admin')) return;
            const p = document.createElement('div'); p.className = 'opt-panel'; p.id = 'mn-admin';
            p.innerHTML = `<h2>💎 Soutien et pubs</h2><div id="mn-env" class="tl-hint" style="text-align:left;"></div>
                <h3 class="adm-h">Réglages</h3>
                <input id="mn-kofi" class="v7-input" placeholder="Lien Ko-fi (ex : https://ko-fi.com/animegame)">
                <input id="mn-ads-c" class="v7-input" placeholder="ID éditeur AdSense (ex : ca-pub-1234567890123456)">
                <input id="mn-ads-s" class="v7-input" placeholder="Numéro de l’emplacement AdSense (facultatif)">
                <label style="display:block;margin:6px 0;"><input type="checkbox" id="mn-ads-on"> Afficher les pubs (petites, en bas de l’accueil et de la collection, jamais en partie)</label>
                <button class="btn-action" onclick="mnSave()">Enregistrer</button>
                <h3 class="adm-h">Donner / retirer le badge</h3>
                <div class="h3-evt-row"><input id="mn-g-p" class="v7-input" placeholder="Pseudo"><select id="mn-g-d"><option value="30">30 jours</option><option value="90">90 jours</option><option value="365">1 an</option><option value="3650">À vie</option><option value="0">Retirer</option></select><button class="btn-action" onclick="mnGrant()">OK</button></div>
                <h3 class="adm-h">Dons Ko-fi</h3><div id="mn-kofi-list"></div>
                <h3 class="adm-h">Supporters</h3><div id="mn-sups"></div>`;
            box.appendChild(p);
            const o = window.switchTab;
            window.switchTab = function (t) { const r = o.apply(this, arguments); if (t === 'admin') mnLoad(); return r; };
        })();
        async function mnLoad() {
            const d = await v7get('/api/admin/money'); if (!d || !d.ok) return;
            const y = b => b ? '✅' : '❌';
            document.getElementById('mn-env').innerHTML = `${y(d.env.stripe)} Clé Stripe (STRIPE_API_KEY) • ${y(d.env.stripeHook)} Webhook Stripe (STRIPE_WEBHOOK_SECRET) • ${y(d.env.kofi)} Ko-fi automatique (KOFI_TOKEN)<br>
                Adresse webhook Stripe : <code>${v7esc(d.hooks.stripe)}</code><br>Adresse webhook Ko-fi : <code>${v7esc(d.hooks.kofi)}</code>`;
            document.getElementById('mn-kofi').value = d.cfg.kofiUrl || '';
            document.getElementById('mn-ads-c').value = d.cfg.adsClient || '';
            document.getElementById('mn-ads-s').value = d.cfg.adsSlot || '';
            document.getElementById('mn-ads-on').checked = !!d.cfg.adsOn;
            const dt = t => new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: '2-digit' });
            document.getElementById('mn-kofi-list').innerHTML = d.kofi.length ? d.kofi.map(k => `<div class="friend-row"><div><b>${v7esc(k.from || '?')}</b> • ${k.amount} ${v7esc(k.currency)} • ${dt(k.at)}<br><small class="tl-hint">« ${v7esc(k.message || '')} »</small></div>
                ${k.status === 'pending' ? `<div class="ch-in"><input class="v7-input" id="mn-k-${v7esc(k.id)}" placeholder="Pseudo" style="width:110px;"><button onclick="mnGrant('${v7esc(k.id)}',${k.days})">Attribuer ${k.days} j</button></div>` : '<small>✅ attribué</small>'}</div>`).join('') : '<p class="tl-hint">Aucun don pour le moment.</p>';
            document.getElementById('mn-sups').innerHTML = d.supporters.length ? d.supporters.map(s => `<div class="friend-row"><div><b>${v7esc(s.name)}</b> ${s.active ? '💎' : '<small class="tl-hint">(expiré)</small>'}<br><small class="tl-hint">${v7esc(s.source || '')}${s.sub ? ' • abonné' : ''} • jusqu’au ${dt(s.until)}</small></div></div>`).join('') : '<p class="tl-hint">Aucun Supporter pour le moment.</p>';
        }
        async function mnSave() {
            const d = await v7post('/api/admin/money/config', { kofiUrl: document.getElementById('mn-kofi').value, adsClient: document.getElementById('mn-ads-c').value, adsSlot: document.getElementById('mn-ads-s').value, adsOn: document.getElementById('mn-ads-on').checked });
            toast(d && d.ok ? 'Réglages enregistrés ✅' : (d && d.error) || 'Erreur', d && d.ok ? '#00ff88' : '#ff2a5f');
            if (d && d.ok) { mnLoad(); moneyLoad(); }
        }
        async function mnGrant(kofiId, days) {
            const pseudo = kofiId ? document.getElementById('mn-k-' + kofiId).value : document.getElementById('mn-g-p').value;
            const d = await v7post('/api/admin/money/grant', { pseudo, days: kofiId ? days : +document.getElementById('mn-g-d').value, kofiId });
            toast(d && d.ok ? 'C’est fait ✅' : (d && d.error) || 'Erreur', d && d.ok ? '#00ff88' : '#ff2a5f');
            if (d && d.ok) mnLoad();
        }
