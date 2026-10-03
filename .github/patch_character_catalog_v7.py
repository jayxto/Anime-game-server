from pathlib import Path

p = Path('server.js')
s = p.read_text(encoding='utf-8')

marker = 'SIMPLE_NON_CHARACTER_EXACT_V7'
if marker not in s:
    start = s.find('const SIMPLE_NON_CHARACTER_EXACT_V1 = new Set([')
    if start < 0:
        raise SystemExit('SIMPLE_NON_CHARACTER_EXACT_V1 not found')
    end = s.find('\n]);', start)
    if end < 0:
        raise SystemExit('SIMPLE_NON_CHARACTER_EXACT_V1 end not found')

    # V6 ended with an inline comment. The comma must be before // or JS treats it as commented out.
    bad = "    'cote|tetsuya machida' // malformed composite, not a canonical character"
    good = "    'cote|tetsuya machida', // malformed composite, not a canonical character"
    if bad in s[start:end]:
        s = s.replace(bad, good, 1)
        end = s.find('\n]);', start)

    rows = r'''
    // SIMPLE_NON_CHARACTER_EXACT_V7 — verified non-character catalogue entries.
    'fatestay|fate route',
    'fatestay|heaven s feel',
    'fatestay|unlimited blade works',
    'clover|asta s parents',
    'clover|baro s gang',
    'clover|charlotte s squad',
    'clover|clover kingdom magic knights',
    'clover|diamond kingdom shining generals',
    'clover|fuegoleon s squad',
    'clover|heart kingdom spirit guardians'
    // END SIMPLE_NON_CHARACTER_EXACT_V7'''
    s = s[:end] + rows + s[end:]

p.write_text(s, encoding='utf-8')
print('catalog cleanup v7:', marker in s)
