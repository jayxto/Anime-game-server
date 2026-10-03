from pathlib import Path
import re

def replace_once(text, old, new, label):
    n=text.count(old)
    if n != 1:
        raise SystemExit(f"{label}: expected 1 target, got {n}")
    print("patched:", label)
    return text.replace(old,new,1)

p=Path("index.html")
s=p.read_text(encoding="utf-8")

old="""    const imageOf = x => String(x?.img || x?.imageUrl || x?.originalImg || '').trim();
    const isLocal = u => /^\\/assets\\/images\\/chars\\//i.test(String(u||''));"""
new="""    const imageOf = x => String(x?.img || x?.imageUrl || x?.originalImg || '').trim();
    // AG_MANUAL_IMAGE_LOCK_V10 — DB-backed images are local/stable too.
    const isLocal = u => /^(?:\\/assets\\/images\\/chars\\/|\\/api\\/(?:character-image-file|local-character-image))/i.test(String(u||''));"""
s=replace_once(s,old,new,"stable DB routes count as local")

old="""            const old = map.get(k);
            old.sources = [...new Set([...sourcesOf(old), ...src])];
            if (!old.anime && anime) old.anime = anime;
            const a = imageOf(old), b = imageOf(candidate);
            if ((!a && b) || (!isLocal(a) && isLocal(b))) {
                old.img = b;
                old.originalImg = candidate.originalImg || b;
            }"""
new="""            const old = map.get(k);
            old.sources = [...new Set([...sourcesOf(old), ...src])];
            if (!old.anime && anime) old.anime = anime;
            const a = imageOf(old), b = imageOf(candidate);
            const oldManual = !!old.manualOverride || old.status === 'manual-admin';
            const candidateManual = !!candidate.manualOverride || candidate.status === 'manual-admin';

            // AG_MANUAL_IMAGE_LOCK_V10 — duplicate merging can NEVER discard an admin override.
            if (candidateManual) {
                const manualImage = b || candidate.imageUrl || candidate.originalImg || a;
                old.img = manualImage;
                old.imageUrl = candidate.imageUrl || manualImage;
                old.originalImg = candidate.originalImg || manualImage;
                old.sourceUrl = candidate.sourceUrl || old.sourceUrl || '';
                old.status = 'manual-admin';
                old.manualOverride = true;
            } else if (!oldManual && ((!a && b) || (!isLocal(a) && isLocal(b)))) {
                old.img = b;
                old.imageUrl = candidate.imageUrl || b;
                old.originalImg = candidate.originalImg || b;
                if (candidate.sourceUrl) old.sourceUrl = candidate.sourceUrl;
            }"""
s=replace_once(s,old,new,"manual override wins duplicate merge")

old="""    function instantStatus(x) {
        const u = imageOf(x);
        if (!u) return 'bad';
        // Never trust a URL just because it is local: the browser verifies the
        // actual file immediately. This catches stale /assets paths after deploys.
        return 'checking';
    }"""
new="""    function instantStatus(x) {
        const u = imageOf(x);
        if (!u) return 'bad';
        // AG_MANUAL_IMAGE_LOCK_V10 — persistent admin rows are returned only when
        // PostgreSQL has real image bytes, so they are authoritative after refresh.
        if (x.manualOverride || x.status === 'manual-admin') return 'ok';
        // Auto/local legacy images are still verified by the browser.
        return 'checking';
    }"""
s=replace_once(s,old,new,"manual rows start saved after refresh")

old="""                if (x.imgs?.length > 1) {
                    for (const url of x.imgs.slice(1)) { const extra = document.createElement('img'); extra.loading = 'lazy'; extra.src = url; extra.alt = x.name; card.insertBefore(extra, card.querySelector('.ag-charcard-copy')); }
                }"""
new="""                // AG_MANUAL_IMAGE_LOCK_V10 — while the server is resolving the authoritative
                // image, never draw stale secondary artwork behind the selected/admin image.
                if (!x.imagePending && !x.manualOverride && x.imgs?.length > 1) {
                    for (const url of x.imgs.slice(1)) { const extra = document.createElement('img'); extra.loading = 'lazy'; extra.src = url; extra.alt = x.name; card.insertBefore(extra, card.querySelector('.ag-charcard-copy')); }
                }"""
s=replace_once(s,old,new,"hide stale QAP secondary images")

p.write_text(s,encoding="utf-8")
print("DONE")
