'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function captureSocketHandler(event) {
  const start = source.indexOf("socket.on('" + event + "',");
  assert.ok(start >= 0, 'Missing socket event: ' + event);
  const end = source.indexOf('\n    });', start);
  assert.ok(end > start, 'Missing handler close for ' + event);
  let fn;
  return function(context) {
    vm.runInNewContext(source.slice(start, end + '\n    });'.length), {
      ...context,
      socket: { id: 'player-1', on: (_, cb) => { fn = cb; }, ...(context.socket || {}) }
    });
    assert.equal(typeof fn, 'function');
    return fn;
  };
}
function route(path) {
  const prefix = "app.post('" + path + "',";
  const start = source.indexOf(prefix);
  assert.ok(start >= 0, 'Missing route ' + path);
  const end = source.indexOf('\n});', start);
  assert.ok(end > start);
  let cb;
  const app = { post: (_p, _json, handler) => { cb = handler; } };
  vm.runInNewContext(source.slice(start, end + 4), {
    app, express: { json: () => () => {} }, isAdmin: async () => false
  });
  return cb;
}
test('Server and all inline client scripts parse', () => {
  new vm.Script(source);
  let scripts = 0;
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/src=|application\/ld\+json/.test(m[1]) || !m[2].trim()) continue;
    new vm.Script(m[2]);
    scripts++;
  }
  assert.ok(scripts > 25, 'Expected all client page scripts to be checked');
});
test('User-controlled HTML is escaped in all Undercover clue displays', () => {
  const start = html.indexOf('function agSafeHtml(value)');
  const end = html.indexOf('\n        function updateGameplayUI', start);
  assert.ok(start > -1 && end > start);
  const fn = vm.runInNewContext('(' + html.slice(start, end).trim() + ')');
  assert.equal(fn('<img src=x onerror="alert(1)">'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  assert.ok(html.includes('agSafeHtml(status)'));
  assert.ok(html.includes("agSafeHtml(p.clue || 'Aucun')"));
  assert.ok(html.includes('agSafeHtml(secretTxt)'));
});
test('Guests authenticate using private entropy instead of choosing any pseudonym', () => {
  assert.match(source, /\^\[a-f0-9\]\{32\}\$/);
  assert.match(source, /p\.__guestIdentity === socket\.user\.guestIdentity/);
  assert.match(source, /Object\.defineProperty\(room\.players\[room\.players\.length - 1\], '__guestIdentity'/);
  assert.doesNotMatch(source, /!socket\.user\.id && p\.name === socket\.user\.pseudo/);
  assert.match(html, /crypto\.getRandomValues\(new Uint8Array\(16\)\)/);
  assert.match(html, /sessionStorage\.setItem\(key, guestIdentity\)/);
});
test('Public profile-import route rejects non-admin writers', async () => {
  const handler = route('/api/dle-import-fandom-profile');
  let status = 0, output;
  await handler({ body: { universeKey: 'naruto', name: 'Naruto', fields: {} } }, {
    status: n => { status = n; return { json: o => { output = o; } }; },
    json: o => { output = o; }
  });
  assert.equal(status, 403);
  assert.equal(output.error, 'admin_required');
});
test('Public character-image cache route rejects non-admin writers', async () => {
  const handler = route('/api/character-image-cache');
  let status = 0, output;
  await handler({ body: { universeKey: 'naruto', name: 'Naruto', imageUrl: 'https://example.com/not-naruto.png' } }, {
    status: n => { status = n; return { json: o => { output = o; } }; },
    json: o => { output = o; }
  });
  assert.equal(status, 403);
  assert.equal(output.error, 'admin_required');
});
test('Voting cannot be forced from another player or another phase', () => {
  const room = { mode: 'undercover', status: 'end_clues', players: [{ id: 'player-1', isAlive: true }], votes: {x:'y'} };
  const emitted = [];
  const fn = captureSocketHandler('force_start_voting')({ rooms: { A: room }, io: { to: () => ({emit: (...args) => emitted.push(args)}) } });
  fn({ roomCode: 'A' });
  assert.equal(room.status, 'voting');
  assert.deepEqual(Object.keys(room.votes), []);
  assert.equal(emitted.length, 1);
  room.status = 'gameplay';
  fn({ roomCode: 'A' });
  assert.equal(room.status, 'gameplay');
  room.status = 'end_clues'; room.players = [];
  fn({ roomCode: 'A' });
  assert.equal(room.status, 'end_clues');
});
test('Tied votes never eliminate the first-seen target', () => {
  const start = source.indexOf('        const voteCounts = {};',source.indexOf('function resolveVotes('));
  const end = source.indexOf('        let eliminatedPlayer = null;', start);
  assert.ok(start > -1 && end > start);
  const getChoice = votes => {
    const context = {room:{votes}};
    vm.runInNewContext(source.slice(start,end)+'\nglobalThis.chosen = eliminatedTargetId;',context);
    return context.chosen;
  };
  assert.equal(getChoice({a:'p1',b:'p2',c:'p1',d:'p2'}),null);
  assert.equal(getChoice({a:'p1',b:'p2',c:'p1'}),'p1');
  assert.equal(getChoice({a:'pass',b:'pass',c:'p1'}),'pass');
});
test('A participant cannot cancel another host’s ongoing game', () => {
  const room={host:'player-2',players:[{id:'player-1'},{id:'player-2'}],status:'gameplay'};
  const fn=captureSocketHandler('back_to_menu')({ rooms:{ABC:room} });
  fn('ABC');
  assert.equal(room.status,'gameplay');
});
test('Only the host can request another game round', async () => {
  const room={host:'player-2',mode:'undercover',status:'results'};
  const fn=captureSocketHandler('next_step_game')({ rooms:{ABC:room} });
  await fn('ABC');
  assert.equal(room.status,'results');
});
test('Non-host cannot override the randomly chosen theme master', () => {
  const room={status:'choosing_theme',host:'player-2',themeMasterId:'player-3',currentTheme:'Original'};
  const fn=captureSocketHandler('submit_custom_theme')({ rooms:{ABC:room} });
  fn({roomCode:'ABC',theme:'HACKED'});
  assert.equal(room.currentTheme,'Original');
});
test('State-mutating moderation is enabled, JWT secrets never use a known default', () => {
  assert.doesNotMatch(source,/const JWT_SECRET = process\.env\.JWT_SECRET \|\| 'change-this-secret-in-production'/);
  assert.match(source,/require\('crypto'\)\.randomBytes\(32\)/);
  assert.match(source,/room\.host !== socket\.id/);
  assert.match(source,/if \(!room \|\| room\.host !== socket\.id \|\| \(!room\.chaine/);
});

test('Invalid room codes are rejected before a Socket.IO room is joined', () => {
  const rejects = [];
  let joined = 0;
  const fn = captureSocketHandler('join_room')({
    rooms: {}, roomKicked: {},
    socket: {
      join: () => { joined++; },
      emit: (event, payload) => rejects.push({ event, payload })
    }
  });
  for (const roomCode of ['__proto__', 'constructor', '', 'A', 'ABCDE', null, 42, 'A<script>']) {
    fn({ roomCode, mode: 'undercover', subMode: 'normal' });
  }
  assert.equal(joined, 0);
  assert.equal(rejects.length, 8);
  assert.ok(rejects.every(x => x.event === 'game_error'));
});

test('Each player can vote once and cannot replace the ballot later', () => {
  const room = {
    status: 'voting', mode: 'undercover', subMode: 'normal',
    players: [{ id: 'player-1', isAlive: true }, { id: 'player-2', isAlive: true }, { id: 'player-3', isAlive: true }],
    votes: {}
  };
  const emitted = [];
  const fn = captureSocketHandler('cast_vote')({
    rooms: { ABCD: room },
    io: { to: () => ({ emit: (event, payload) => emitted.push({event,payload}) }) }
  });
  fn({ roomCode: 'ABCD', targetId: 'player-2' });
  fn({ roomCode: 'ABCD', targetId: 'player-3' });
  assert.equal(room.votes['player-1'], 'player-2');
  assert.equal(emitted.filter(x => x.event === 'vote_progress').length, 1);
});

test('Self-vote and special no-impostor vote outside Hardcore are rejected', () => {
  const room = {
    status: 'voting', mode: 'undercover', subMode: 'normal',
    players: [{ id: 'player-1', isAlive: true }, { id: 'player-2', isAlive: true }],
    votes: {}
  };
  const fn = captureSocketHandler('cast_vote')({ rooms: { ABCD: room } });
  fn({ roomCode: 'ABCD', targetId: 'player-1' });
  fn({ roomCode: 'ABCD', targetId: 'no_impostor' });
  assert.deepEqual(Object.keys(room.votes), []);
  room.subMode = 'hardcore';
  fn({ roomCode: 'ABCD', targetId: 'no_impostor' });
  assert.equal(room.votes['player-1'], 'no_impostor');
});

test('JWT_SECRET must be configured explicitly when NODE_ENV is production', () => {
  const start = source.indexOf('const JWT_SECRET =');
  const end = source.indexOf('const JWT_EXPIRES_IN', start);
  assert.ok(start >= 0 && end > start);
  const expr = source.slice(start, end);
  assert.throws(
    () => vm.runInNewContext(expr, { process: {env: {NODE_ENV:'production'}}, require, console }),
    /JWT_SECRET/
  );
  assert.doesNotThrow(
    () => vm.runInNewContext(expr, { process: {env: {NODE_ENV:'production',JWT_SECRET:'test-only-secret'}}, require, console })
  );
});

test('More multiplayer player-name displays escape special HTML characters', () => {
  assert.match(html, /list\.innerHTML \+= \`<li><span>\$\{agSafeHtml\(p\.name\)\}/);
  const rg = html.slice(html.indexOf('function renderRgState('), html.indexOf('function renderEnchereState('));
  const conn = html.slice(html.indexOf('function renderConnexionState('), html.indexOf('function sendChatMessage('));
  assert.ok(rg.includes('agSafeHtml(p.name)'));
  assert.ok(conn.includes('agSafeHtml(p.name)'));
});
