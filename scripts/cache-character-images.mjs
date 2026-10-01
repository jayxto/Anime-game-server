#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';

const ROOT = process.cwd();
const CHAR_FILE = path.join(ROOT, 'char-images.json');
const IMG_ROOT = path.join(ROOT, 'assets', 'images');
const CHAR_ROOT = path.join(IMG_ROOT, 'chars');
const EXTRA_ROOT = path.join(IMG_ROOT, 'external');
const MANIFEST_FILE = path.join(IMG_ROOT, 'image-sources.json');
const REPORT_FILE = path.join(ROOT, 'image-cache-report.json');
const MISSING_FILE = path.join(ROOT, 'images-a-verifier.json');
const REPORT_MD = path.join(ROOT, 'IMAGE_CACHE_REPORT.md');
const DATA_FILES = ['qap-themes.json', 'tierlist-themes.json'];
const CODE_FILES = ['index.html', 'server.js'];
const JS_DIR = path.join(ROOT, 'assets', 'js');

const CONCURRENCY = Math.max(1, Math.min(Number(process.env.IMAGE_CACHE_CONCURRENCY || 6), 10));
const SIZE = Math.max(192, Math.min(Number(process.env.IMAGE_CACHE_SIZE || 384), 640));
const QUALITY = Math.max(60, Math.min(Number(process.env.IMAGE_CACHE_QUALITY || 80), 90));
const REFRESH = process.argv.includes('--refresh') || process.env.IMAGE_CACHE_REFRESH === '1';
const CHECK_ONLY = process.argv.includes('--check-only');
const DEEP = process.argv.includes('--deep') || process.env.IMAGE_CACHE_DEEP !== '0';
const USER_AGENT = 'ANIME-GAME image-cache/3.0 (jayxto/Anime-game-server)';

const animeAliases = {
  naruto: 'Naruto', onepiece: 'One Piece', bleach: 'Bleach', hxh: 'Hunter x Hunter', hunterxhunter: 'Hunter x Hunter',
  snk: 'Attack on Titan', aot: 'Attack on Titan', attackontitan: 'Attack on Titan', nanatsu: 'The Seven Deadly Sins',
  sevendeadlysins: 'The Seven Deadly Sins', deathnote: 'Death Note', cote: 'Classroom of the Elite', classroomoftheelite: 'Classroom of the Elite',
  sololeveling: 'Solo Leveling', blackclover: 'Black Clover', clover: 'Black Clover', fireforce: 'Fire Force',
  mushokutensei: 'Mushoku Tensei: Jobless Reincarnation', rezero: 'Re:ZERO -Starting Life in Another World-', fairy: 'Fairy Tail', fairytail: 'Fairy Tail',
  bluelock: 'Blue Lock', fma: 'Fullmetal Alchemist: Brotherhood', fullmetalalchemist: 'Fullmetal Alchemist: Brotherhood',
  chainsaw: 'Chainsaw Man', chainsawman: 'Chainsaw Man', wakfu: 'Wakfu', demonslayer: 'Demon Slayer: Kimetsu no Yaiba', kimetsu: 'Demon Slayer: Kimetsu no Yaiba',
  pokemon: 'Pokémon', dragonball: 'Dragon Ball', hellsparadise: "Hell's Paradise", jigokuraku: "Hell's Paradise", gachakuta: 'Gachiakuta',
  haikyuu: 'Haikyu!!', jujika: 'Juujika no Rokunin', jojo: "JoJo's Bizarre Adventure", tensura: 'That Time I Got Reincarnated as a Slime',
  onepunchman: 'One Punch Man', opm: 'One Punch Man', sao: 'Sword Art Online', swordartonline: 'Sword Art Online', tokyoghoul: 'Tokyo Ghoul',
  tokyo_revengers: 'Tokyo Revengers', tokyorevengers: 'Tokyo Revengers'
};

const fandomWikis = {
  naruto:'naruto.fandom.com',onepiece:'onepiece.fandom.com',bleach:'bleach.fandom.com',hxh:'hunterxhunter.fandom.com',
  hunterxhunter:'hunterxhunter.fandom.com',snk:'attackontitan.fandom.com',aot:'attackontitan.fandom.com',
  attackontitan:'attackontitan.fandom.com',nanatsu:'nanatsu-no-taizai.fandom.com',sevendeadlysins:'nanatsu-no-taizai.fandom.com',
  deathnote:'deathnote.fandom.com',cote:'you-zitsu.fandom.com',classroomoftheelite:'you-zitsu.fandom.com',
  sololeveling:'solo-leveling.fandom.com',blackclover:'blackclover.fandom.com',clover:'blackclover.fandom.com', fireforce:'fire-force.fandom.com',
  mushokutensei:'mushokutensei.fandom.com',rezero:'rezero.fandom.com',fairy:'fairytail.fandom.com',fairytail:'fairytail.fandom.com',
  bluelock:'bluelock.fandom.com',fma:'fma.fandom.com',fullmetalalchemist:'fma.fandom.com',
  chainsaw:'chainsaw-man.fandom.com',chainsawman:'chainsaw-man.fandom.com',wakfu:'wakfu.fandom.com',
  demonslayer:'kimetsu-no-yaiba.fandom.com',kimetsu:'kimetsu-no-yaiba.fandom.com',pokemon:'pokemon.fandom.com',
  dragonball:'dragonball.fandom.com',hellsparadise:'jigokuraku.fandom.com',jigokuraku:'jigokuraku.fandom.com',
  gachakuta:'gachiakuta.fandom.com',haikyuu:'haikyuu.fandom.com',jojo:'jojo.fandom.com',tensura:'tensura.fandom.com',
  onepunchman:'onepunchman.fandom.com',opm:'onepunchman.fandom.com',sao:'swordartonline.fandom.com',swordartonline:'swordartonline.fandom.com',
  tokyoghoul:'tokyoghoul.fandom.com',tokyo_revengers:'tokyorevengers.fandom.com',tokyorevengers:'tokyorevengers.fandom.com'
};

const manualAliases = new Map(Object.entries({
  'dragonball|sangoku': 'Son Goku',
  'dragonball|sangohan': 'Son Gohan',
  'dragonball|sangoten': 'Son Goten',
  'dragonball|vegeto': 'Vegito',
  'dragonball|roi vegeta': 'King Vegeta',
  'dragonball|roi cold': 'King Cold',
  'dragonball|grand pretre': 'Grand Priest',
  'dragonball|docteur gero': 'Dr. Gero',
  'dragonball|c 13': 'Android 13',
  'dragonball|c 19': 'Android 19',
  'dragonball|c 21': 'Android 21',
  'chainsaw|demon de la justice': 'Justice Devil',
  'chainsaw|demon de la chute': 'Falling Devil',
  'chainsaw|demon des tenebres': 'Darkness Devil',
  'chainsaw|demon de l enfer': 'Hell Devil',
  'demonslayer|kokushibo': 'Kokushibo',
  'demonslayer|michikatsu tsugikuni': 'Michikatsu Tsugikuni',
  'clover|patolli': 'Patry',
  'fairy|lector': 'Lector',
  'tokyo_revengers|draken': 'Ken Ryuguji'
}));

const report = {
  generatedAt: new Date().toISOString(),
  settings: { concurrency: CONCURRENCY, size: SIZE, quality: QUALITY, refresh: REFRESH, deep: DEEP },
  characterEntries: 0,
  cachedCharacters: 0,
  downloadedCharacters: 0,
  resolvedCharacters: 0,
  aliasReusedCharacters: 0,
  failedCharacters: [],
  externalFound: 0,
  externalDownloaded: 0,
  externalCached: 0,
  externalFailed: [],
  rewrittenFiles: [],
  codeImageUrlsFound: 0,
  codeImageUrlsProcessed: 0,
  bytesBefore: 0,
  bytesAfter: 0
};

const key = v => String(v || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const keyCompact = v => key(v).replace(/\s+/g, '');
const slug = v => String(v || 'unknown').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
const hash = v => crypto.createHash('sha1').update(String(v)).digest('hex').slice(0, 16);
const remote = v => typeof v === 'string' && /^https?:\/\//i.test(v);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const franchiseQueries = {
  naruto:['Naruto','Naruto Shippuden','Boruto: Naruto Next Generations'],
  onepiece:['One Piece'],
  bleach:['Bleach','Bleach: Thousand-Year Blood War'],
  hxh:['Hunter x Hunter'], hunterxhunter:['Hunter x Hunter'],
  snk:['Attack on Titan'], aot:['Attack on Titan'], attackontitan:['Attack on Titan'],
  nanatsu:['The Seven Deadly Sins'], sevendeadlysins:['The Seven Deadly Sins'],
  deathnote:['Death Note'], cote:['Classroom of the Elite'], classroomoftheelite:['Classroom of the Elite'],
  sololeveling:['Solo Leveling'], blackclover:['Black Clover'], clover:['Black Clover'], fireforce:['Fire Force'],
  mushokutensei:['Mushoku Tensei'], rezero:['Re:Zero'], fairy:['Fairy Tail'], fairytail:['Fairy Tail'],
  bluelock:['Blue Lock'], fma:['Fullmetal Alchemist'], fullmetalalchemist:['Fullmetal Alchemist'],
  chainsaw:['Chainsaw Man'], chainsawman:['Chainsaw Man'], demonslayer:['Demon Slayer'], kimetsu:['Demon Slayer'],
  pokemon:['Pokemon'], dragonball:['Dragon Ball','Dragon Ball Z','Dragon Ball Super','Dragon Ball GT'],
  hellsparadise:["Hell's Paradise"], jigokuraku:["Hell's Paradise"], gachakuta:['Gachiakuta'],
  haikyuu:['Haikyuu'], jujika:['Juujika no Rokunin'], jojo:["JoJo's Bizarre Adventure"],
  tensura:['That Time I Got Reincarnated as a Slime'], onepunchman:['One Punch Man'], opm:['One Punch Man'],
  sao:['Sword Art Online'], swordartonline:['Sword Art Online'], tokyoghoul:['Tokyo Ghoul'],
  tokyo_revengers:['Tokyo Revengers'], tokyorevengers:['Tokyo Revengers']
};

let jikanGate = Promise.resolve();
let jikanNextAt = 0;
async function jikanRequest(url) {
  let release;
  const prev = jikanGate;
  jikanGate = new Promise(r => { release = r; });
  await prev.catch(() => {});
  try {
    const wait = Math.max(0, jikanNextAt - Date.now());
    if (wait) await sleep(wait);
    let last;
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        const r = await fetchTimed(url, { headers: { 'Accept':'application/json', 'User-Agent': USER_AGENT } }, 25000);
        if (r.status === 429) {
          const ra = Number(r.headers.get('retry-after') || 1);
          await sleep(Math.max(1200, ra * 1000));
          last = new Error('HTTP 429');
          continue;
        }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const json = await r.json();
        jikanNextAt = Date.now() + 420;
        return json;
      } catch (e) {
        last = e;
        await sleep(650 * attempt);
      }
    }
    throw last || new Error('Jikan request failed');
  } finally {
    jikanNextAt = Math.max(jikanNextAt, Date.now() + 420);
    release();
  }
}

const jikanRosterPromises = new Map();
function universeQueries(universe) {
  const k = keyCompact(universe);
  return franchiseQueries[k] || [animeAliases[k] || String(universe).replace(/[_-]+/g,' ')];
}
async function getJikanRoster(universe) {
  const uk = keyCompact(universe);
  if (jikanRosterPromises.has(uk)) return jikanRosterPromises.get(uk);
  const promise = (async () => {
    const roster = [];
    const seenChar = new Set();
    const seenMedia = new Set();
    for (const q of universeQueries(universe)) {
      for (const mediaType of ['anime','manga']) {
        try {
          const search = await jikanRequest(`https://api.jikan.moe/v4/${mediaType}?q=${encodeURIComponent(q)}&limit=5`);
          const media = Array.isArray(search?.data) ? search.data : [];
          const ranked = media.map(m => {
            const titles = [m?.title, m?.title_english, m?.title_japanese, ...(m?.titles || []).map(t=>t?.title)].filter(Boolean);
            return { m, s: scoreNames(titles, [q]) };
          }).sort((a,b)=>b.s-a.s).filter(x=>x.s>=50).slice(0,3);
          for (const {m} of ranked) {
            const mk = `${mediaType}:${m.mal_id}`;
            if (seenMedia.has(mk)) continue;
            seenMedia.add(mk);
            try {
              const chars = await jikanRequest(`https://api.jikan.moe/v4/${mediaType}/${m.mal_id}/characters`);
              for (const row of (chars?.data || [])) {
                const c = row?.character || row;
                const cid = c?.mal_id;
                if (!cid || seenChar.has(cid)) continue;
                seenChar.add(cid);
                const names = [c?.name, ...(c?.nicknames || [])].filter(Boolean);
                const image = c?.images?.jpg?.image_url || c?.images?.webp?.image_url;
                if (image) roster.push({ names, image, source: `jikan-${mediaType}-roster`, media: m?.title, malId: cid });
              }
            } catch {}
          }
        } catch {}
      }
    }
    return roster;
  })();
  jikanRosterPromises.set(uk, promise);
  return promise;
}

const repoUrl = p => '/' + path.relative(ROOT, p).split(path.sep).join('/');

function imageUrl(v) {
  if (!remote(v)) return false;
  try {
    const u = new URL(v), p = u.pathname.toLowerCase();
    return /\.(png|jpe?g|webp|gif|avif)(?:$|\/)/i.test(p)
      || u.hostname.includes('anilistcdn')
      || u.hostname.includes('myanimelist.net')
      || (u.hostname.includes('wikia') && p.includes('/images/'))
      || u.hostname.includes('fandom.com');
  } catch {
    return false;
  }
}

async function exists(p) { try { const s = await fs.stat(p); return s.isFile() && s.size > 128; } catch { return false; } }
async function readJson(p, fallback = {}) { try { return JSON.parse(await fs.readFile(p, 'utf8')); } catch { return fallback; } }
async function writeJson(p, v) { await fs.mkdir(path.dirname(p), { recursive: true }); await fs.writeFile(p, JSON.stringify(v, null, 2) + '\n'); }
function leaves(obj, parts = [], out = []) { if (typeof obj === 'string') { out.push({ parts, value: obj }); return out; } if (!obj || typeof obj !== 'object') return out; for (const [k, v] of Object.entries(obj)) leaves(v, [...parts, k], out); return out; }
function getAt(obj, parts) { let r = obj; for (const p of parts) r = r?.[p]; return r; }
function setAt(obj, parts, v) { let r = obj; for (let i = 0; i < parts.length - 1; i++) r = r[parts[i]]; r[parts.at(-1)] = v; }
function pushUnique(arr, value) { if (!value) return; if (!arr.includes(value)) arr.push(value); }

function translateName(n) {
  let s = String(n || '').trim();
  s = s
    .replace(/\bdocteur\b/gi, 'doctor')
    .replace(/\bdr\b/gi, 'doctor')
    .replace(/\broi\b/gi, 'king')
    .replace(/\bgrand pretre\b/gi, 'grand priest')
    .replace(/\bdemon(?:e)?\s+de\s+la\s+justice\b/gi, 'justice devil')
    .replace(/\bdemon(?:e)?\s+de\s+la\s+chute\b/gi, 'falling devil')
    .replace(/\bdemon(?:e)?\s+des\s+tenebres\b/gi, 'darkness devil')
    .replace(/\bdemon(?:e)?\s+de\s+l[’']?enfer\b/gi, 'hell devil')
    .replace(/\bsangoku\b/gi, 'son goku')
    .replace(/\bsangohan\b/gi, 'son gohan')
    .replace(/\bsangoten\b/gi, 'son goten')
    .replace(/\bvegeto\b/gi, 'vegito')
    .replace(/\bc\s*([0-9]{1,2})\b/gi, 'android $1');
  return s.replace(/\s+/g, ' ').trim();
}

function nameVariants(universe, name) {
  const out = [];
  const add = v => pushUnique(out, String(v || '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim());
  add(name);
  add(translateName(name));
  add(String(name).replace(/[()]/g, ' '));
  add(String(name).replace(/\//g, ' '));
  add(String(name).replace(/-/g, ' '));
  add(String(name).replace(/\bssj\b/i, 'super saiyan'));

  const mk = `${key(universe).replace(/\s+/g, '')}|${key(name)}`;
  if (manualAliases.has(mk)) add(manualAliases.get(mk));

  const words = key(name).split(' ').filter(Boolean);
  if (words.length === 2) add(words.slice().reverse().join(' '));

  // Remove honorific-like suffixes or descriptors
  add(key(name).replace(/\b(form|mode|version|adult|young|kid|child|prime)\b/g, '').trim());

  if (DEEP) {
    add(key(name));
    add(keyCompact(name));
    if (/ devil$/i.test(translateName(name))) add(translateName(name).replace(/ devil$/i, ''));
    if (/^android\s+/i.test(translateName(name))) add(translateName(name).replace(/^android\s+/i, ''));    
  }

  return out.filter(Boolean);
}

async function fetchTimed(url, opts = {}, ms = 18000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    return await fetch(url, { redirect: 'follow', ...opts, signal: c.signal });
  } finally {
    clearTimeout(t);
  }
}

async function download(url) {
  let last;
  for (let i = 1; i <= 3; i++) {
    try {
      const r = await fetchTimed(url, {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'image/avif,image/webp,image/*,*/*;q=0.8',
          'Referer': 'https://anime-game-server.onrender.com/'
        }
      }, 16000 + i * 4000);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const type = r.headers.get('content-type') || '';
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 200) throw new Error(`too small (${buf.length} bytes)`);
      if (/text\/html|application\/json/i.test(type)) throw new Error(`not image (${type})`);
      return { buf, type, finalUrl: r.url || url };
    } catch (e) {
      last = e;
      if (i < 3) await sleep(650 * i);
    }
  }
  throw last;
}

async function convert(url, out) {
  const d = await download(url);
  const im = sharp(d.buf, { animated: false, failOn: 'none' }).rotate();
  const meta = await im.metadata();
  if (!meta.width || !meta.height) throw new Error('invalid dimensions');
  const webp = await im.resize({ width: SIZE, height: SIZE, fit: 'cover', position: 'attention' }).webp({ quality: QUALITY, effort: 5, smartSubsample: true }).toBuffer();
  if (webp.length < 100) throw new Error('bad WebP');
  if (!CHECK_ONLY) {
    await fs.mkdir(path.dirname(out), { recursive: true });
    const tmp = out + '.tmp';
    await fs.writeFile(tmp, webp);
    await fs.rename(tmp, out);
  }
  report.bytesBefore += d.buf.length;
  report.bytesAfter += webp.length;
  return { ...d, width: meta.width, height: meta.height, before: d.buf.length, after: webp.length };
}

function scoreNames(candidate, queries) {
  const names = Array.isArray(candidate) ? candidate : [candidate];
  let best = 0;
  for (const n of names.filter(Boolean)) {
    const a = key(n);
    for (const q of queries) {
      const b = key(q);
      if (!a || !b) continue;
      if (a === b) best = Math.max(best, 100);
      else if (a.includes(b) || b.includes(a)) best = Math.max(best, 70);
      else if (keyCompact(a) === keyCompact(b)) best = Math.max(best, 90);
    }
  }
  return best;
}

async function resolveAniList(universe, queries) {
  const media = animeAliases[keyCompact(universe)] || String(universe).replace(/[_-]+/g, ' ');

  for (const q of queries) {
    try {
      const query = `query($media:String,$char:String){Media(search:$media,type:ANIME){characters(search:$char,perPage:12){nodes{name{full native alternative} image{large}}}}}`;
      const r = await fetchTimed('https://graphql.anilist.co', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'User-Agent': USER_AGENT },
        body: JSON.stringify({ query, variables: { media, char: q } })
      }, 20000);
      if (!r.ok) continue;
      const j = await r.json();
      const nodes = j?.data?.Media?.characters?.nodes || [];
      nodes.sort((a, b) => scoreNames([b?.name?.full, b?.name?.native, ...(b?.name?.alternative || [])], queries) - scoreNames([a?.name?.full, a?.name?.native, ...(a?.name?.alternative || [])], queries));
      const top = nodes.find(n => n?.image?.large && scoreNames([n?.name?.full, n?.name?.native, ...(n?.name?.alternative || [])], queries) >= 60);
      if (top) return { url: top.image.large, source: 'anilist-media', matched: top?.name?.full || q };
    } catch {}
  }

  for (const q of queries) {
    try {
      const query = `query($char:String){Character(search:$char){name{full native alternative} image{large}}}`;
      const r = await fetchTimed('https://graphql.anilist.co', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'User-Agent': USER_AGENT },
        body: JSON.stringify({ query, variables: { char: q } })
      }, 20000);
      if (!r.ok) continue;
      const j = await r.json();
      const c = j?.data?.Character;
      if (c?.image?.large && scoreNames([c?.name?.full, c?.name?.native, ...(c?.name?.alternative || [])], queries) >= 60) {
        return { url: c.image.large, source: 'anilist-character', matched: c?.name?.full || q };
      }
    } catch {}
  }
  return null;
}

async function resolveJikan(universe, queries) {
  // First use a cached roster for the whole franchise. This is much more reliable
  // than asking Jikan once per missing character, and it avoids rate-limit storms.
  try {
    const roster = await getJikanRoster(universe);
    const ranked = roster.map(x => ({ x, s: scoreNames(x.names, queries) })).sort((a,b)=>b.s-a.s);
    const top = ranked.find(v => v.s >= 65 && v.x?.image);
    if (top) return { url: top.x.image, source: top.x.source, matched: top.x.names?.[0] || queries[0], media: top.x.media };
  } catch {}

  // Direct global character search as a second pass for manga-only / obscure entries.
  for (const q of queries) {
    try {
      const j = await jikanRequest(`https://api.jikan.moe/v4/characters?q=${encodeURIComponent(q)}&limit=12`);
      const data = Array.isArray(j?.data) ? j.data : [];
      const scored = data.map(x => ({
        s: scoreNames([x?.name, ...(x?.nicknames || [])], queries),
        x
      })).sort((a,b)=>b.s-a.s);
      const top = scored.find(v => v.s >= 70 && (v.x?.images?.jpg?.image_url || v.x?.images?.webp?.image_url));
      if (top) return {
        url: top.x.images.jpg?.image_url || top.x.images.webp?.image_url,
        source: 'jikan-character-search',
        matched: top.x?.name || q
      };
    } catch {}
  }
  return null;
}

async function resolveFandom(universe, queries) {
  const host = fandomWikis[keyCompact(universe)];
  if (!host) return null;
  for (const q of queries) {
    const p = new URLSearchParams({
      action: 'query', generator: 'search', gsrsearch: q, gsrnamespace: '0', gsrlimit: '12',
      prop: 'pageimages|info', piprop: 'original|thumbnail', pithumbsize: '700', inprop: 'url', redirects: '1', format: 'json', origin: '*'
    });
    try {
      const r = await fetchTimed(`https://${host}/api.php?${p}`, { headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' } }, 20000);
      if (!r.ok) continue;
      const j = await r.json();
      const pages = Object.values(j?.query?.pages || {});
      pages.sort((a, b) => scoreNames([b?.title], queries) - scoreNames([a?.title], queries));
      for (const x of pages) {
        const s = scoreNames([x?.title], queries);
        const url = x?.original?.source || x?.thumbnail?.source;
        if (url && s >= 50) return { url, source: 'fandom', page: x?.fullurl || null, matched: x?.title || q };
      }
      await sleep(300);
    } catch {}
  }
  return null;
}

async function pool(items, fn, n = CONCURRENCY) {
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(n, Math.max(items.length, 1)) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) break;
      try { await fn(items[i], i); } catch (e) { console.error('worker:', e.message); }
    }
  }));
}

function progress(done, total, msg) {
  if (done < 5 || done % 25 === 0 || done === total) console.log(`[${done}/${total}] ${msg}`);
}

async function buildAliasIndex(map, manifest) {
  const index = new Map();
  const jobs = leaves(map).filter(x => x.parts.length >= 2);

  for (const job of jobs) {
    const universe = job.parts[0];
    const rawName = job.parts.slice(1).join(' / ');
    const id = job.parts.join('|');
    const current = getAt(map, job.parts);
    const m = manifest.characters?.[id] || null;
    const local = (typeof current === 'string' && current.startsWith('/assets/images/')) ? current : m?.localUrl;
    if (local) {
      for (const v of nameVariants(universe, rawName)) {
        const k = `${keyCompact(universe)}|${key(v)}`;
        if (!index.has(k)) index.set(k, local);
      }
    }
  }
  return index;
}

async function cacheCharacters() {
  const map = await readJson(CHAR_FILE, null);
  if (!map) throw new Error('char-images.json invalid');

  const manifest = await readJson(MANIFEST_FILE, { version: 3, characters: {}, external: {} });
  manifest.characters ||= {};
  manifest.external ||= {};

  let aliasIndex = await buildAliasIndex(map, manifest);
  const jobs = leaves(map).filter(x => x.parts.length >= 2);
  report.characterEntries = jobs.length;
  let done = 0;

  await pool(jobs, async job => {
    const universe = job.parts[0];
    const name = job.parts.slice(1).join(' / ');
    const id = job.parts.join('|');
    const out = path.join(CHAR_ROOT, slug(universe), slug(name) + '.webp');
    const local = repoUrl(out);
    const old = manifest.characters[id] || {};
    const current = getAt(map, job.parts);
    const variants = nameVariants(universe, name);

    // 1) existing local image
    if (!REFRESH && await exists(out)) {
      if (!CHECK_ONLY) setAt(map, job.parts, local);
      manifest.characters[id] = { ...old, universe, name, localUrl: local, sourceUrl: old.sourceUrl || (remote(current) ? current : null), status: 'cached', updatedAt: new Date().toISOString() };
      report.cachedCharacters++;
      done++; progress(done, jobs.length, `${universe} / ${name} cached`); return;
    }

    // 2) alias reuse from already-known successful image
    let reusedLocal = null;
    for (const v of variants) {
      const k = `${keyCompact(universe)}|${key(v)}`;
      if (aliasIndex.has(k)) { reusedLocal = aliasIndex.get(k); break; }
    }
    if (reusedLocal && reusedLocal !== local) {
      if (!CHECK_ONLY) setAt(map, job.parts, reusedLocal);
      manifest.characters[id] = { ...old, universe, name, localUrl: reusedLocal, sourceUrl: old.sourceUrl || (remote(current) ? current : null), status: 'alias-reused', updatedAt: new Date().toISOString() };
      report.aliasReusedCharacters++;
      done++; progress(done, jobs.length, `${universe} / ${name} alias reused`); return;
    }

    const candidates = [];
    const addCandidate = (url, source, page = null) => {
      if (imageUrl(url) && !candidates.some(x => x.url === url)) candidates.push({ url, source, page });
    };
    addCandidate(remote(current) ? current : null, 'char-images');
    addCandidate(old.sourceUrl, 'manifest');

    let success = null, resolved = false, errors = [];

    for (const c of candidates) {
      try { success = { ...c, ...await convert(c.url, out) }; break; }
      catch (e) { errors.push(`${c.source}: ${e.message}`); }
    }

    if (!success) {
      const lookups = [
        await resolveAniList(universe, variants),
        await resolveJikan(universe, variants),
        await resolveFandom(universe, variants)
      ].filter(Boolean);

      for (const r of lookups) addCandidate(r.url, r.source, r.page || null);
      resolved = lookups.length > 0;

      for (const c of candidates.slice(2)) {
        try { success = { ...c, ...await convert(c.url, out) }; break; }
        catch (e) { errors.push(`${c.source}: ${e.message}`); }
      }
    }

    if (success) {
      if (!CHECK_ONLY) setAt(map, job.parts, local);
      manifest.characters[id] = {
        universe, name, localUrl: local, sourceUrl: success.url, resolvedBy: success.source,
        finalSourceUrl: success.finalUrl || success.url, sourcePage: success.page || null,
        originalDimensions: [success.width, success.height], originalBytes: success.before, webpBytes: success.after,
        status: 'ok', updatedAt: new Date().toISOString()
      };
      for (const v of variants) aliasIndex.set(`${keyCompact(universe)}|${key(v)}`, local);
      report.downloadedCharacters++;
      if (resolved) report.resolvedCharacters++;
    } else {
      manifest.characters[id] = { ...old, universe, name, localUrl: local, sourceUrl: old.sourceUrl || (remote(current) ? current : null), status: 'failed', errors, updatedAt: new Date().toISOString() };
      report.failedCharacters.push({ universe, name, current, errors });
    }

    done++; progress(done, jobs.length, `${universe} / ${name} ${success ? 'ok' : 'FAILED'}`);
  });

  manifest.generatedAt = new Date().toISOString();
  manifest.version = 3;
  if (!CHECK_ONLY) {
    await writeJson(CHAR_FILE, map);
    await writeJson(MANIFEST_FILE, manifest);
  }
  return manifest;
}

async function cacheRemoteToExternal(url, manifest) {
  const ext = path.extname(new URL(url).pathname || '').replace('.', '') || 'img';
  const out = path.join(EXTRA_ROOT, `${hash(url)}.${ext === 'webp' ? 'webp' : 'webp'}`);
  const localUrl = repoUrl(out);
  if (await exists(out)) {
    report.externalCached++;
    manifest.external[url] = { ...(manifest.external[url] || {}), localUrl, sourceUrl: url, status: 'cached', updatedAt: new Date().toISOString() };
    return localUrl;
  }
  const info = await convert(url, out);
  report.externalDownloaded++;
  manifest.external[url] = { localUrl, sourceUrl: url, finalSourceUrl: info.finalUrl || url, status: 'ok', updatedAt: new Date().toISOString() };
  return localUrl;
}

async function cacheDataFiles(manifest) {
  const urlRegex = /https?:\/\/[^\s'"`<>\\)]+/g;
  for (const filename of DATA_FILES) {
    const file = path.join(ROOT, filename);
    let text;
    try { text = await fs.readFile(file, 'utf8'); } catch { continue; }
    const urls = [...new Set((text.match(urlRegex) || []).filter(imageUrl))];
    report.externalFound += urls.length;
    let changed = text;
    for (const url of urls) {
      try {
        const local = await cacheRemoteToExternal(url, manifest);
        if (local && !CHECK_ONLY) changed = changed.split(url).join(local);
      } catch (e) {
        report.externalFailed.push({ file: filename, url, error: e.message });
      }
    }
    if (!CHECK_ONLY && changed !== text) {
      await fs.writeFile(file, changed);
      report.rewrittenFiles.push(filename);
    }
  }
  if (!CHECK_ONLY) await writeJson(MANIFEST_FILE, manifest);
}

async function walkJs(dir) {
  try {
    const es = await fs.readdir(dir, { withFileTypes: true });
    const out = [];
    for (const e of es) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) out.push(...await walkJs(p));
      else if (/\.(js|mjs|html)$/i.test(e.name)) out.push(p);
    }
    return out;
  } catch {
    return [];
  }
}

async function scanAndRewriteCode(manifest) {
  const files = [];
  for (const n of CODE_FILES) { const p = path.join(ROOT, n); try { await fs.access(p); files.push(p); } catch {} }
  files.push(...await walkJs(JS_DIR));

  const seen = new Set();
  const rx = /https?:\/\/[^\s'"`<>\\)]+/g;
  for (const file of files) {
    let text = '';
    try { text = await fs.readFile(file, 'utf8'); } catch { continue; }
    const urls = [...new Set((text.match(rx) || []).map(x => x.replace(/[;,]+$/, '')).filter(imageUrl))];
    report.codeImageUrlsFound += urls.length;
    let changed = text;
    for (const url of urls) {
      if (seen.has(url)) continue;
      seen.add(url);
      try {
        const local = await cacheRemoteToExternal(url, manifest);
        if (local) {
          changed = changed.split(url).join(local);
          report.codeImageUrlsProcessed++;
        }
      } catch (e) {
        report.externalFailed.push({ file: path.relative(ROOT, file), url, error: e.message });
      }
    }
    if (!CHECK_ONLY && changed !== text) {
      await fs.writeFile(file, changed);
      report.rewrittenFiles.push(path.relative(ROOT, file));
    }
  }
}

async function writeReports() {
  report.generatedAt = new Date().toISOString();
  if (!CHECK_ONLY) {
    await writeJson(REPORT_FILE, report);
    await writeJson(MISSING_FILE, { generatedAt: report.generatedAt, characters: report.failedCharacters, external: report.externalFailed });
  }
  const saved = report.bytesBefore ? Math.round((1 - report.bytesAfter / report.bytesBefore) * 100) : 0;
  const md = [
    '# Image cache report',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    `- Character entries: **${report.characterEntries}**`,
    `- Already cached: **${report.cachedCharacters}**`,
    `- Downloaded / converted: **${report.downloadedCharacters}**`,
    `- Missing images resolved automatically: **${report.resolvedCharacters}**`,
    `- Alias reuses: **${report.aliasReusedCharacters}**`,
    `- Character failures: **${report.failedCharacters.length}**`,
    `- Extra JSON image URLs: **${report.externalFound}**`,
    `- Extra images downloaded: **${report.externalDownloaded}**`,
    `- Hard-coded code image URLs processed: **${report.codeImageUrlsProcessed}**`,
    `- Approx. size reduction this run: **${saved}%**`,
    '',
    '## Failed characters',
    ''
  ];
  for (const f of report.failedCharacters) md.push(`- **${f.universe} — ${f.name}**: ${Array.isArray(f.errors) ? f.errors.join(' | ') : String(f.errors || '')}`);
  if (!CHECK_ONLY) await fs.writeFile(REPORT_MD, md.join('\n') + '\n');
}

async function main() {
  console.log(`Starting image cache v3 • refresh=${REFRESH} • deep=${DEEP}`);
  await fs.mkdir(CHAR_ROOT, { recursive: true });
  await fs.mkdir(EXTRA_ROOT, { recursive: true });
  const manifest = await cacheCharacters();
  await cacheDataFiles(manifest);
  await scanAndRewriteCode(manifest);
  await writeJson(MANIFEST_FILE, manifest);
  await writeReports();
  console.log(`Done. characters=${report.characterEntries} failures=${report.failedCharacters.length} resolved=${report.resolvedCharacters} aliases=${report.aliasReusedCharacters}`);
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
