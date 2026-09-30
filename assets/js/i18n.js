/* =====================================================================
   I18N — dictionnaires externes /locales/*.json
   Ajouter une langue = ajouter son JSON + une entrée dans AVAILABLE_LANGS.
   ===================================================================== */
(() => {
    const AVAILABLE_LANGS = [
        { id: 'fr', label: '🇫🇷 Français' },
        { id: 'en', label: '🇬🇧 English' }
    ];

    const getLang = () => {
        if (window.FORCE_LANG) return String(window.FORCE_LANG).toLowerCase();
        try {
            const saved = localStorage.getItem('lang');
            if (AVAILABLE_LANGS.some(x => x.id === saved)) return saved;
        } catch (_) {}
        return /^fr/i.test(navigator.language || 'fr') ? 'fr' : 'en';
    };

    const LANG = window.LANG = getLang();
    let dict = {};
    let rules = [];
    let observer = null;

    function translateText(text) {
        if (LANG === 'fr' || text == null) return null;
        const raw = String(text);
        const s = raw.trim();
        if (!s) return null;
        if (dict[s]) return raw.replace(s, dict[s]);
        for (const [re, to] of rules) {
            re.lastIndex = 0;
            if (re.test(s)) return raw.replace(s, s.replace(re, to));
        }
        const emoji = s.match(/^([^A-Za-zÀ-ÿ0-9]+\s*)(.+)$/u);
        if (emoji && dict[emoji[2]]) return raw.replace(s, emoji[1] + dict[emoji[2]]);
        const colon = s.match(/^(.+?)\s*:$/);
        if (colon && dict[colon[1]]) return raw.replace(s, dict[colon[1]] + ':');
        return null;
    }

    function translateNode(root) {
        if (!root) return;
        if (root.nodeType === 3) {
            const r = translateText(root.nodeValue);
            if (r != null && r !== root.nodeValue) root.nodeValue = r;
            return;
        }
        if (root.nodeType !== 1 || /^(SCRIPT|STYLE|TEXTAREA)$/.test(root.tagName) || root.isContentEditable) return;

        ['placeholder', 'title', 'aria-label'].forEach(attr => {
            const v = root.getAttribute?.(attr);
            if (!v) return;
            const r = translateText(v);
            if (r != null && r !== v) root.setAttribute(attr, r);
        });

        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
        let n;
        while ((n = walker.nextNode())) {
            if (n.nodeType === 3) {
                if (n.parentNode && /^(SCRIPT|STYLE|TEXTAREA)$/.test(n.parentNode.tagName)) continue;
                const r = translateText(n.nodeValue);
                if (r != null && r !== n.nodeValue) n.nodeValue = r;
            } else {
                ['placeholder', 'title', 'aria-label'].forEach(attr => {
                    const v = n.getAttribute?.(attr);
                    if (!v) return;
                    const r = translateText(v);
                    if (r != null && r !== v) n.setAttribute(attr, r);
                });
            }
        }
    }

    async function loadLocale() {
        document.documentElement.lang = LANG;
        try {
            const res = await fetch(`/locales/${LANG}.json?v=2`, { cache: 'no-cache' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            dict = data.translations || {};
            rules = (data.rules || []).map(r => [new RegExp(r.pattern, r.flags || ''), r.replacement]);
        } catch (e) {
            console.warn('[i18n] locale introuvable :', LANG, e.message);
            dict = {};
            rules = [];
        }

        if (LANG !== 'fr') {
            translateNode(document.body);
            observer?.disconnect();
            observer = new MutationObserver(ms => ms.forEach(m => {
                if (m.type === 'characterData') {
                    const r = translateText(m.target.nodeValue);
                    if (r != null && r !== m.target.nodeValue) m.target.nodeValue = r;
                } else {
                    m.addedNodes.forEach(translateNode);
                }
            }));
            observer.observe(document.body, { childList: true, subtree: true, characterData: true });
        }
        renderLanguagePicker();
    }

    window.setLang = function setLang(lang) {
        if (!AVAILABLE_LANGS.some(x => x.id === lang)) return;
        try { localStorage.setItem('lang', lang); } catch (_) {}
        if (lang === 'fr' && location.pathname.startsWith('/en')) location.href = '/';
        else if (lang === 'en' && !location.pathname.startsWith('/en')) location.href = '/en';
        else location.reload();
    };

    function renderLanguagePicker() {
        const slot = document.getElementById('lang-slot');
        if (!slot) return;
        slot.innerHTML = `<h3 style="margin-top:6px;">🌍 ${LANG === 'en' ? 'Language' : 'Langue'}</h3><div class="hb-btns">${AVAILABLE_LANGS.map(x => `<button class="${LANG === x.id ? 'go' : ''}" onclick="setLang('${x.id}')">${x.label}</button>`).join('')}</div>`;
        if (LANG !== 'fr') translateNode(slot);
    }

    window.i18nText = translateText;
    window.i18nNode = translateNode;

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', loadLocale, { once: true });
    else loadLocale();
})();
