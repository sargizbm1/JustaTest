'use strict';
const $ = s => document.querySelector(s);
const TOKEN_KEY = 'commons.token', READ_KEY = 'commons.read';
const HUES = [250, 330, 160, 30, 200, 285];

const state = { me: null, contacts: [], last: {}, unread: {}, msgs: {}, room: 'general', es: null, filter: '' };
let token = localStorage.getItem(TOKEN_KEY);
const reads = JSON.parse(localStorage.getItem(READ_KEY) || '{}');

// ---------- small helpers ----------
function h(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
const dmRoom = (a, b) => 'dm:' + [a, b].sort().join(':');
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
const clock = ts => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const shortTime = ts => sameDay(ts, Date.now()) ? clock(ts) : new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' });
function dayLabel(ts) {
  if (sameDay(ts, Date.now())) return 'Today';
  if (sameDay(ts, Date.now() - 864e5)) return 'Yesterday';
  return new Date(ts).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}
const hsl = (hue, l = 50) => `hsl(${hue} 68% ${l}%)`;

function avatar(u, cls = '', online = false) {
  const el = h('span', 'avatar ' + cls);
  if (u === 'room') { el.classList.add('room'); el.textContent = '#'; }
  else { el.textContent = [...(u.name || '?')][0].toUpperCase(); el.style.background = hsl(u.color, 46); }
  if (online) el.append(h('i', 'dot'));
  return el;
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); }
  catch { const t = h('textarea'); t.value = text; document.body.append(t); t.select(); document.execCommand('copy'); t.remove(); }
  toast('Copied');
}

async function api(path, body) {
  const r = await fetch('/api' + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', 'x-token': token || '' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.error || 'Something went wrong. Try again.'), { status: r.status });
  return data;
}

// ---------- data ----------
async function loadMe() {
  const d = await api('/me');
  state.me = d.me; state.contacts = d.contacts; state.last = d.last;
  state.unread = {};
  for (const r of rooms()) {
    const l = state.last[r.room];
    if (l && l.from !== state.me.id && l.ts > (reads[r.room] || 0)) state.unread[r.room] = 1;
  }
}
function rooms() {
  return [{ room: 'general', name: 'General', general: true },
    ...state.contacts.map(c => ({ room: dmRoom(state.me.id, c.id), name: c.name, user: c }))];
}
function markRead(room) {
  state.unread[room] = 0;
  reads[room] = state.last[room]?.ts || Date.now();
  localStorage.setItem(READ_KEY, JSON.stringify(reads));
  updateTitle();
}
function updateTitle() {
  const n = Object.values(state.unread).reduce((a, b) => a + b, 0);
  document.title = (n ? `(${n}) ` : '') + 'Commons';
}

// ---------- rendering ----------
function renderMe() {
  $('#me-name').textContent = state.me.name;
  $('#my-id').textContent = state.me.id;
  $('#me-avatar').replaceChildren(avatar(state.me));
}

function renderList() {
  const ul = $('#list'), q = state.filter.trim().toLowerCase();
  ul.replaceChildren();
  const items = rooms().filter(r => !q || r.name.toLowerCase().includes(q) || r.user?.id.toLowerCase().includes(q));
  items.sort((a, b) =>
    (b.general ? 1 : 0) - (a.general ? 1 : 0) ||
    (state.last[b.room]?.ts || 0) - (state.last[a.room]?.ts || 0) ||
    a.name.localeCompare(b.name));
  if (!items.length) ul.append(h('li', 'none', 'No chats match your search.'));
  for (const r of items) {
    const last = state.last[r.room], n = state.unread[r.room] || 0;
    const btn = h('button', 'item' + (r.room === state.room ? ' active' : ''));
    btn.type = 'button';
    btn.append(avatar(r.general ? 'room' : r.user, '', !r.general && r.user.online));
    const meta = h('span', 'meta');
    const top = h('span', 'row'); top.append(h('span', 'name', r.name), h('span', 'time', last ? shortTime(last.ts) : ''));
    const prefix = !last ? '' : last.from === state.me.id ? 'You: ' : r.general ? last.name + ': ' : '';
    const bottom = h('span', 'row');
    bottom.append(h('span', 'preview', last ? prefix + last.text : r.general ? 'Everyone on this server' : 'Say hello'));
    if (n) bottom.append(h('span', 'badge', n > 99 ? '99+' : String(n)));
    meta.append(top, bottom);
    btn.append(meta);
    btn.onclick = () => selectRoom(r.room);
    const li = h('li'); li.append(btn); ul.append(li);
  }
  if (!q && state.contacts.length === 0) ul.append(h('li', 'none', 'Tap the person icon above and enter a friend\u2019s ID to start a private chat.'));
}

function renderHead() {
  const r = rooms().find(x => x.room === state.room) || rooms()[0];
  const who = $('#head-who'), t = h('div');
  who.replaceChildren(avatar(r.general ? 'room' : r.user, 'sm', !r.general && r.user.online));
  t.append(h('b', '', r.name));
  t.append(r.general ? h('small', '', 'Everyone on this server') : h('small', r.user.online ? 'on' : '', (r.user.online ? 'Online' : 'Offline') + ' \u00b7 ID ' + r.user.id));
  who.append(t);
}

function renderMessages(stick) {
  const box = $('#messages');
  const near = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
  const list = state.msgs[state.room];
  box.replaceChildren();
  if (!list) return void box.append(h('p', 'empty', 'Loading messages\u2026'));
  if (!list.length) return void box.append(h('p', 'empty', state.room === 'general' ? 'No messages yet. Say hello to everyone here.' : 'No messages yet. Say hi and start the conversation.'));
  list.forEach((m, i) => {
    const prev = list[i - 1], next = list[i + 1];
    const newDay = !prev || !sameDay(prev.ts, m.ts);
    if (newDay) box.append(h('div', 'day', dayLabel(m.ts)));
    const first = newDay || prev.from !== m.from || m.ts - prev.ts > 3e5;
    const last = !next || next.from !== m.from || next.ts - m.ts > 3e5 || !sameDay(next.ts, m.ts);
    const mine = m.from === state.me.id;
    const wrap = h('div', `msg ${mine ? 'mine' : 'theirs'}${first ? ' first' : ''}`);
    if (first && !mine && state.room === 'general') {
      const w = h('span', 'who-name', m.name); w.style.color = hsl(m.color, 46); wrap.append(w);
    }
    wrap.append(h('div', 'bubble', m.text));
    if (last) wrap.append(h('span', 'stamp', clock(m.ts)));
    box.append(wrap);
  });
  if (stick || near) box.scrollTop = box.scrollHeight;
}

// ---------- chats ----------
async function selectRoom(room, show = true) {
  state.room = room;
  markRead(room);
  if (show) $('#shell').classList.add('in-chat');
  renderHead(); renderList(); renderMessages(true);
  if (!state.msgs[room]) {
    try { state.msgs[room] = (await api('/messages?room=' + encodeURIComponent(room))).messages; }
    catch (e) { return toast(e.message); }
    if (state.room === room) renderMessages(true);
  }
  if (matchMedia('(min-width: 761px)').matches) $('#text').focus();
}

function addMsg(m) {
  const list = state.msgs[m.room];
  if (list ? list.some(x => x.id === m.id) : state.last[m.room]?.id === m.id) return;
  if (list) list.push(m);
  if (!state.last[m.room] || state.last[m.room].ts <= m.ts) state.last[m.room] = m;
  if (m.from === state.me.id || (m.room === state.room && !document.hidden)) markRead(m.room);
  else { state.unread[m.room] = (state.unread[m.room] || 0) + 1; updateTitle(); }
  if (m.room === state.room) renderMessages(m.from === state.me.id);
  renderList();
}

$('#composer').addEventListener('submit', async e => {
  e.preventDefault();
  const input = $('#text'), text = input.value.trim();
  if (!text) return;
  input.value = '';
  try { addMsg((await api('/messages', { room: state.room, text })).message); }
  catch (err) { input.value = text; toast(err.message); }
});
$('#search').addEventListener('input', e => { state.filter = e.target.value; renderList(); });
$('#back').onclick = () => $('#shell').classList.remove('in-chat');
document.addEventListener('visibilitychange', () => { if (!document.hidden && state.me) { markRead(state.room); renderList(); } });

// ---------- live connection ----------
function setLive(on) {
  $('#status').dataset.on = on;
  $('#status-text').textContent = on ? 'Live' : 'Reconnecting\u2026';
}
function connect() {
  if (state.es) state.es.close();
  let dropped = false;
  const es = new EventSource('/api/events?token=' + encodeURIComponent(token));
  es.onopen = async () => {
    setLive(true);
    if (!dropped) return;
    dropped = false;                      // catch up on anything missed while offline
    state.msgs = {};
    await loadMe(); renderMe(); await selectRoom(state.room, false);
  };
  es.onerror = () => { dropped = true; setLive(false); };
  es.onmessage = async e => {
    const ev = JSON.parse(e.data);
    if (ev.type === 'message') addMsg(ev.message);
    else if (ev.type === 'presence') {
      const c = state.contacts.find(x => x.id === ev.id);
      if (c) { c.online = ev.online; renderList(); renderHead(); }
    } else if (ev.type === 'refresh') {
      await loadMe(); renderMe(); renderList(); renderHead();
    }
  };
  state.es = es;
}

// ---------- dialogs ----------
document.addEventListener('click', e => { const b = e.target.closest('[data-close]'); if (b) b.closest('dialog').close(); });
$('#copy-id').onclick = () => copy(state.me.id);

// add contact
$('#add-btn').onclick = () => { $('#add-id').value = ''; $('#add-err').textContent = ''; $('#add-dialog').showModal(); };
$('#add-form').onsubmit = async e => {
  e.preventDefault();
  try {
    const { contact } = await api('/contacts', { id: $('#add-id').value });
    await loadMe(); $('#add-dialog').close();
    await selectRoom(dmRoom(state.me.id, contact.id));
    toast(`${contact.name} added`);
  } catch (err) { $('#add-err').textContent = err.message; }
};

// profile
let pickedColor = 0;
function paintSwatches() {
  const box = $('#swatches'); box.replaceChildren();
  for (const hue of HUES) {
    const b = h('button', 'sw'); b.type = 'button'; b.style.background = hsl(hue, 46);
    b.setAttribute('aria-label', 'Color ' + hue); b.setAttribute('aria-pressed', String(hue === pickedColor));
    b.onclick = () => { pickedColor = hue; paintSwatches(); };
    box.append(b);
  }
}
$('#me-btn').onclick = () => {
  $('#profile-name').value = state.me.name; $('#profile-key').value = state.me.token;
  pickedColor = HUES.includes(state.me.color) ? state.me.color : HUES[0];
  paintSwatches(); $('#profile-dialog').showModal();
};
$('#profile-form').onsubmit = async e => {
  e.preventDefault();
  try {
    const { me } = await api('/profile', { name: $('#profile-name').value, color: pickedColor });
    state.me = me; renderMe(); renderList(); $('#profile-dialog').close(); toast('Profile saved');
  } catch (err) { toast(err.message); }
};
$('#copy-key').onclick = () => copy(state.me.token);
$('#signout').onclick = () => {
  if (!confirm('Sign out? Make sure you have saved your account key, or you will lose access to this account.')) return;
  localStorage.removeItem(TOKEN_KEY); location.reload();
};

// welcome / sign in
const welcome = $('#welcome');
welcome.addEventListener('cancel', e => e.preventDefault());
$('#welcome-form').onsubmit = async e => {
  e.preventDefault();
  try {
    const { me } = await api('/register', { name: $('#welcome-name').value });
    token = me.token; localStorage.setItem(TOKEN_KEY, token);
    welcome.close(); await start();
  } catch (err) { $('#welcome-err').textContent = err.message; }
};
$('#key-form').onsubmit = async e => {
  e.preventDefault();
  token = $('#key-input').value.trim();
  try { await loadMe(); localStorage.setItem(TOKEN_KEY, token); welcome.close(); await start(); }
  catch { token = null; $('#key-err').textContent = 'That account key was not found.'; }
};

// ---------- start ----------
async function start() {
  if (!state.me) await loadMe();
  renderMe(); connect(); await selectRoom('general', false);
}
(async () => {
  if (token) {
    try { await start(); return; }
    catch (e) { if (e.status !== 401) return toast('Cannot reach the server.'); token = null; localStorage.removeItem(TOKEN_KEY); }
  }
  welcome.showModal();
})();
