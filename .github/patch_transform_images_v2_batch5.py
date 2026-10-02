from pathlib import Path

p = Path('server.js')
s = p.read_text(encoding='utf-8')
start = s.find('const QAP_VERIFIED_TRANSFORM_SOURCES_V2 = [')
end = s.find('\n];', start)
if start < 0 or end < 0:
    raise SystemExit('verified transform array not found')

marker = 'QAP_VERIFIED_TRANSFORM_BATCH5'
if marker not in s[start:end]:
    rows = r''',
    // QAP_VERIFIED_TRANSFORM_BATCH5 — Shield Hero.
    // Checked against the anime's red/black Rage Shield silhouette and central gem.
    {
        needs:['rage shield'],
        url:'https://w0.peakpx.com/wallpaper/403/743/HD-wallpaper-naofumi-rage-shield-tate-no-yuusha.jpg'
    },
    {
        needs:['shield of rage'],
        url:'https://w0.peakpx.com/wallpaper/403/743/HD-wallpaper-naofumi-rage-shield-tate-no-yuusha.jpg'
    }'''
    s = s[:end] + rows + s[end:]

p.write_text(s, encoding='utf-8')
print('batch5:', marker in s)
print('rage shield:', 'HD-wallpaper-naofumi-rage-shield-tate-no-yuusha.jpg' in s)
