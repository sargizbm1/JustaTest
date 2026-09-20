'use strict';
// Commons v3 – accounts, IDs, contacts, direct messages, live updates.
// Node 18+, no packages. Data is saved to data.json.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 8080;
const DATA_FILE = path.join(__dirname, 'data.json');
const OLD_FILE = path.join(__dirname, 'messages.json');
const PAGES = { '/': 'index.html', '/index.html': 'index.html', '/script.js': 'script.js', '/style.css': 'style.css' };
const MIME = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8' };
const ID_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 chars, no I/O/0/1
const UPLOADS = path.join(__dirname, 'uploads');
const GENDERS = ['Male', 'Female', 'Non-binary', 'Other'];
const VIS_KEYS = ['photo', 'banner', 'status', 'bio', 'gender', 'age'];
const VIS_DEFAULT = { photo: true, banner: true, status: true, bio: true, gender: false, age: false };

const rand = n => crypto.randomBytes(n).toString('hex');
const clean = (s, max) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

// ---------- storage ----------
let db = { users: {}, messages: [] };
try {
  db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
} catch {
  try { // first run: import the old shared-room history if it exists
    const old = JSON.parse(fs.readFileSync(OLD_FILE, 'utf8'));
    if (Array.isArray(old)) {
      db.messages = old.filter(m => m && typeof m.text === 'string').map(m => ({
        id: rand(6), room: 'general', from: null,
        legacyName: clean(m.name || m.user || m.author, 24) || 'Guest',
        text: m.text.slice(0, 500), ts: Number(m.ts || m.time || m.timestamp) || Date.now(),
      }));
    }
  } catch { /* nothing to import */ }
}
// Older accounts get empty profiles; private-by-default for gender and age.
function ensure(u) {
  u.profile = { bio: '', status: '', gender: '', age: null, photo: null, banner: null, ...u.profile };
  u.vis = { ...VIS_DEFAULT, ...u.vis };
}
Object.values(db.users).forEach(ensure);
const byToken = new Map(Object.values(db.users).map(u => [u.token, u]));

let saveTimer;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 300);
}
function saveNow() {
  fs.writeFileSync(DATA_FILE + '.tmp', JSON.stringify(db));
  fs.renameSync(DATA_FILE + '.tmp', DATA_FILE);
}
// Never let one bad request or dead socket take the whole server down.
process.on('uncaughtException', e => console.error(new Date().toISOString(), 'uncaught:', e));
process.on('unhandledRejection', e => console.error(new Date().toISOString(), 'unhandled:', e));
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { try { saveNow(); } catch {} process.exit(0); });

// ---------- helpers ----------
const clients = new Map();   // userId -> Set of open event streams
const lastSend = new Map();  // userId -> timestamp, simple flood guard
const isOnline = id => (clients.get(id)?.size || 0) > 0;
const imgUrl = f => (f ? '/u/' + f : null);
// What other people may see in lists: only fields the owner left visible.
const view = u => ({ id: u.id, name: u.name, color: u.color, online: isOnline(u.id),
  photo: u.vis.photo ? imgUrl(u.profile.photo) : null, status: u.vis.status ? u.profile.status : '' });
// Everything, for the owner only.
const mine = u => ({ id: u.id, name: u.name, color: u.color, online: isOnline(u.id), token: u.token,
  photo: imgUrl(u.profile.photo), banner: imgUrl(u.profile.banner), status: u.profile.status, bio: u.profile.bio,
  gender: u.profile.gender, age: u.profile.age, vis: u.vis });
// The profile card. Hidden fields look exactly like empty ones.
function fullProfile(u, viewer) {
  const p = u.profile, v = u.vis;
  return { ...view(u), banner: v.banner ? imgUrl(p.banner) : null, bio: v.bio ? p.bio : '',
    gender: v.gender ? p.gender : '', age: v.age ? p.age : null, isContact: viewer.contacts.includes(u.id) };
}
const dmRoom = (a, b) => 'dm:' + [a, b].sort().join(':');

function newId() {
  let id;
  do { id = Array.from(crypto.randomBytes(6), b => ID_CHARS[b % 32]).join(''); } while (db.users[id]);
  return id;
}
function pubMsg(m) {
  const u = db.users[m.from];
  return { id: m.id, room: m.room, from: m.from, name: u ? u.name : (m.legacyName || 'Guest'), color: u ? u.color : 220, text: m.text, ts: m.ts };
}
function roomMembers(room) { return room.slice(3).split(':'); }
function canAccess(u, room) {
  if (room === 'general') return true;
  if (typeof room !== 'string' || !room.startsWith('dm:')) return false;
  const ids = roomMembers(room);
  if (ids.length !== 2 || !ids.includes(u.id)) return false;
  return u.contacts.includes(ids[0] === u.id ? ids[1] : ids[0]);
}
function lastByRoom(rooms) {
  const need = new Set(rooms), out = {};
  for (let i = db.messages.length - 1; i >= 0 && need.size; i--) {
    const m = db.messages[i];
    if (need.has(m.room)) { out[m.room] = pubMsg(m); need.delete(m.room); }
  }
  return out;
}
function push(ids, event) {
  const line = `data: ${JSON.stringify(event)}\n\n`;
  for (const id of new Set(ids)) for (const res of clients.get(id) || []) {
    try { res.write(line); } catch { res.destroy(); }
  }
}
// Heartbeat: the browser treats silence as a dead connection and reconnects.
setInterval(() => push([...clients.keys()], { type: 'ping' }), 15000);
const seen = new Map(); // "userId:cid" -> message, so a retried send is never posted twice
setInterval(() => { for (const [k, m] of seen) if (m.ts < Date.now() - 6e5) seen.delete(k); }, 60000);

function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', c => { s += c; if (s.length > 10000) { reject(new Error('Too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
function readRaw(req, limit) {
  return new Promise((resolve, reject) => {
    const parts = []; let size = 0, over = false;
    req.on('data', c => { size += c.length; if (size > limit * 4) req.destroy(); else if (size > limit) over = true; else parts.push(c); });
    req.on('end', () => over ? reject(Object.assign(new Error('Too large'), { status: 413 })) : resolve(Buffer.concat(parts)));
    req.on('error', reject);
  });
}
function assetVersion(f) {
  try { return crypto.createHash('md5').update(fs.readFileSync(path.join(__dirname, f))).digest('hex').slice(0, 8); } catch { return '0'; }
}
const json = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
};

// ---------- API ----------
async function api(req, res, url) {
  const p = url.pathname, get = req.method === 'GET', post = req.method === 'POST';
  if (p === '/api/health') return json(res, 200, { ok: true, uptime: Math.round(process.uptime()) });

  if (p === '/api/register' && post) {
    const b = await readBody(req);
    const u = { id: newId(), name: clean(b.name, 24) || 'Guest', color: Math.floor(Math.random() * 360), token: rand(24), contacts: [], created: Date.now() };
    ensure(u); db.users[u.id] = u; byToken.set(u.token, u); save();
    return json(res, 200, { me: mine(u) });
  }

  const me = byToken.get(req.headers['x-token'] || url.searchParams.get('token'));
  if (!me) return json(res, 401, { error: 'Not signed in' });

  if (p === '/api/events' && get) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 2000\n\n');
    let set = clients.get(me.id);
    if (!set) clients.set(me.id, set = new Set());
    const first = set.size === 0;
    set.add(res);
    if (first) push(me.contacts, { type: 'presence', id: me.id, online: true });
    res.on('error', () => {});
    res.on('close', () => {
      set.delete(res);
      if (!set.size) push(me.contacts, { type: 'presence', id: me.id, online: false });
    });
    return;
  }

  if (p === '/api/me' && get) {
    const contacts = me.contacts.map(id => ({ ...view(db.users[id]), room: dmRoom(me.id, id) }));
    return json(res, 200, { me: mine(me), contacts, last: lastByRoom(['general', ...contacts.map(c => c.room)]) });
  }

  if (p === '/api/profile' && post) {
    const b = await readBody(req);
    const name = clean(b.name, 24); if (name) me.name = name;
    const c = Number(b.color); if (b.color != null && Number.isInteger(c) && c >= 0 && c < 360) me.color = c;
    const pr = me.profile;
    if ('status' in b) pr.status = clean(b.status, 60);
    if ('bio' in b) pr.bio = clean(b.bio, 160);
    if ('gender' in b) pr.gender = GENDERS.includes(b.gender) ? b.gender : '';
    if ('age' in b) { const a = Math.round(Number(b.age)); pr.age = b.age !== '' && b.age != null && a >= 13 && a <= 120 ? a : null; }
    if (b.vis && typeof b.vis === 'object') for (const k of VIS_KEYS) if (typeof b.vis[k] === 'boolean') me.vis[k] = b.vis[k];
    save(); push([me.id, ...me.contacts], { type: 'refresh' });
    return json(res, 200, { me: mine(me) });
  }

  // Someone's profile card (respects their visibility settings)
  if (p === '/api/user' && get) {
    const u = db.users[clean(url.searchParams.get('id'), 12).toUpperCase()];
    if (!u) return json(res, 404, { error: 'No one has that ID.' });
    return json(res, 200, { user: fullProfile(u, me) });
  }

  // Upload a photo or banner (the browser sends a resized JPEG). An empty body removes it.
  if (p === '/api/image' && post) {
    const kind = url.searchParams.get('kind');
    if (kind !== 'photo' && kind !== 'banner') return json(res, 400, { error: 'Unknown image type.' });
    const buf = await readRaw(req, kind === 'photo' ? 250e3 : 600e3);
    const old = me.profile[kind];
    if (!buf.length) me.profile[kind] = null;
    else {
      if (!(buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)) return json(res, 400, { error: 'Please choose a JPG or PNG image.' });
      const file = rand(12) + '.jpg';
      fs.mkdirSync(UPLOADS, { recursive: true });
      fs.writeFileSync(path.join(UPLOADS, file), buf);
      me.profile[kind] = file;
    }
    if (old) fs.unlink(path.join(UPLOADS, old), () => {});
    save(); push([me.id, ...me.contacts], { type: 'refresh' });
    return json(res, 200, { me: mine(me) });
  }

  if (p === '/api/contacts' && post) {
    const b = await readBody(req);
    const id = clean(b.id, 12).replace(/^#/, '').toUpperCase();
    const other = db.users[id];
    if (!other) return json(res, 404, { error: 'No one has that ID. Check it and try again.' });
    if (other.id === me.id) return json(res, 400, { error: 'That is your own ID. Share it with a friend instead.' });
    if (me.contacts.includes(id)) return json(res, 409, { error: `${other.name} is already in your contacts.` });
    me.contacts.push(id);
    if (!other.contacts.includes(me.id)) other.contacts.push(me.id);
    save(); push([me.id, id], { type: 'refresh' });
    return json(res, 200, { contact: view(other) });
  }

  if (p === '/api/messages' && get) {
    const room = url.searchParams.get('room') || '';
    if (!canAccess(me, room)) return json(res, 403, { error: 'You do not have access to that chat.' });
    const out = [];
    for (let i = db.messages.length - 1; i >= 0 && out.length < 150; i--) if (db.messages[i].room === room) out.push(pubMsg(db.messages[i]));
    return json(res, 200, { messages: out.reverse() });
  }

  if (p === '/api/messages' && post) {
    const b = await readBody(req);
    const text = String(b.text ?? '').trim().slice(0, 500);
    if (!text) return json(res, 400, { error: 'Write something first.' });
    if (!canAccess(me, b.room)) return json(res, 403, { error: 'You do not have access to that chat.' });
    const cid = clean(b.cid, 40), dupKey = me.id + ':' + cid;
    if (cid && seen.has(dupKey)) return json(res, 200, { message: seen.get(dupKey) });
    const now = Date.now();
    if (now - (lastSend.get(me.id) || 0) < 250) return json(res, 429, { error: 'Slow down a little.' });
    lastSend.set(me.id, now);
    const m = { id: rand(6), room: b.room, from: me.id, text, ts: now };
    db.messages.push(m);
    if (db.messages.length > 20000) db.messages.splice(0, 2000);
    save();
    const message = pubMsg(m);
    if (cid) seen.set(dupKey, message);
    push(m.room === 'general' ? [...clients.keys()] : roomMembers(m.room), { type: 'message', message });
    return json(res, 200, { message });
  }

  json(res, 404, { error: 'Not found' });
}

// ---------- server ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (req.method === 'GET' && /^\/u\/[a-f0-9]{24}\.jpg$/.test(url.pathname)) {   // uploaded photos and banners
      return fs.readFile(path.join(UPLOADS, url.pathname.slice(3)), (err, buf) => {
        if (err) { res.writeHead(404); return res.end('Not found'); }
        res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' });
        res.end(buf);
      });
    }
    const file = PAGES[url.pathname];
    if (!file || req.method !== 'GET') { res.writeHead(404); return res.end('Not found'); }
    fs.readFile(path.join(__dirname, file), (err, buf) => {
      if (err) { res.writeHead(500); return res.end('Error'); }
      // Stamp script.js / style.css with a content hash so no browser or proxy can serve an outdated copy.
      if (file === 'index.html') buf = Buffer.from(buf.toString().replace(/(src|href)="(script\.js|style\.css)"/g, (m, a, f) => `${a}="${f}?v=${assetVersion(f)}"`));
      res.writeHead(200, { 'Content-Type': MIME[file.split('.').pop()], 'Cache-Control': 'no-store' });
      res.end(buf);
    });
  } catch (e) {
    if (!res.headersSent) json(res, e.status || 400, { error: e.status === 413 ? 'That image is too large.' : 'Bad request' }); else res.end();
  }
});
server.keepAliveTimeout = 65000; // longer than most proxies, avoids random resets
server.headersTimeout = 66000;
server.on('clientError', (e, socket) => socket.destroy());
server.on('error', e => { console.error('server error:', e.message); if (e.code === 'EADDRINUSE') process.exit(1); });
server.listen(PORT, () => console.log(`Commons running on http://localhost:${PORT}`));
