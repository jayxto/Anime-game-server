from pathlib import Path
import re

p=Path('server.js')
s=p.read_text(encoding='utf-8')

# 1) Invalidate any v2 transformation cache values so old/bad cached forms cannot win.
s,n=re.subn(r"const persistKey = `v2\|\$\{animeName\}\|\$\{charName\}\|\$\{form\}`;",
            "const persistKey = `v3|${animeName}|${charName}|${form}`;",s,count=1)
if n!=1 and "const persistKey = `v3|${animeName}|${charName}|${form}`;" not in s:
    raise SystemExit('persistKey v2 anchor missing')

# 2) Do not let generic it.img handling bypass the transformation-specific resolver.
old="""            if (it) {
                if (it.img) url = it.img;
                else if (source.startsWith('qt:') && (it.media === 'anime' || ['anime','shonen','isekai','arc'].includes(source.slice(3)))) {"""
new="""            if (it) {
                // Transformation images must go through the strict/persistent resolver below.
                // Otherwise an old embedded `img` can bypass verified mappings entirely.
                if (it.img && source !== 'qt:transformation') url = it.img;
                else if (source.startsWith('qt:') && (it.media === 'anime' || ['anime','shonen','isekai','arc'].includes(source.slice(3)))) {"""
if old in s:
    s=s.replace(old,new,1)
elif "it.img && source !== 'qt:transformation'" not in s:
    raise SystemExit('outer it.img anchor missing')

# 3) Inside the transformation branch, verified/persistent data must win over embedded img.
#    Embedded local/remote img remains a fallback for currently-unverified forms.
old_inner="""                        if (it.img) url = it.img;
                        if (!url) {
                            const parts = String(it.sub || '').split('•').map(s => s.trim()).filter(Boolean);"""
new_inner="""                        if (!url) {
                            const parts = String(it.sub || '').split('•').map(s => s.trim()).filter(Boolean);"""
if old_inner in s:
    s=s.replace(old_inner,new_inner,1)
elif "const persistKey = `v3|" not in s:
    raise SystemExit('inner transformation anchor missing')

# Insert embedded img fallback only AFTER cache + verified seed, before automatic Fandom lookup.
needle="""                            if (!url && host) {
                                let candidate = null;"""
replacement="""                            // Existing theme image is only a fallback now. Critical forms with a
                            // reviewed source always override it; this fixes stale normal portraits.
                            if (!url && it.img) url = it.img;

                            if (!url && host) {
                                let candidate = null;"""
if replacement not in s:
    if needle not in s: raise SystemExit('Fandom fallback anchor missing')
    s=s.replace(needle,replacement,1)

p.write_text(s,encoding='utf-8')
print('v3 key', "const persistKey = `v3|" in s)
print('outer strict', "it.img && source !== 'qt:transformation'" in s)
print('embedded fallback reordered', 'reviewed source always override it' in s)
