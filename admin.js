'use strict';
const $ = s => document.querySelector(s);
const KEY = 'commons.admin';
let token = sessionStorage.getItem(KEY), users = [], openId = null;

function h(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}
async function api(path, body) {
  let r;
  try {
    r = await fetch('/api/admin' + path, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', 'x-admin': token || '' },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch { throw new Error('No connection.'); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 401 && token) logout('Session expired. Please log in again.');
    throw new Error(d.error || 'Something went wrong.');
  }
  return d;
}

// ---------- helpers ----------
const FOREVER = 8.64e15;
const isMuted = u => u.mutedUntil > Date.now();
const date = ts => (ts ? new Date(ts).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' }) : 'Never');
const ago = ts => {
  if (!ts) return 'Never';
  const m = Math.round((Date.now() - ts) / 60000);
  return m < 1 ? 'Just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : date(ts);
};
function avatar(u, size) {
  const el = h('span', 'avatar ' + (size || ''));
  el.style.backgroundColor = (u.admin && u.theme?.avatar) || `hsl(${u.color} 68% 46%)`;
  if (u.photo) {
    const clip = h('span', 'pic'), inner = h('span', 'pic-in'), p = { x: 50, y: 50, z: 1, ...u.photoPos };
    inner.style.backgroundImage = `url("${u.photo}")`;
    inner.style.backgroundPosition = `${p.x}% ${p.y}%`;
    inner.style.transformOrigin = `${p.x}% ${p.y}%`;
    inner.style.transform = `scale(${p.z})`;
    clip.append(inner); el.append(clip);
  } else el.textContent = [...(u.name || '?')][0].toUpperCase();
  if (u.online) el.append(h('i', 'dot'));
  return el;
}
function tags(u) {
  const box = h('span');
  if (u.admin) box.append(h('span', 'tag', 'ADMIN'), ' ');
  if (u.banned) box.append(h('span', 'tag ban', 'BANNED'), ' ');
  if (isMuted(u)) box.append(h('span', 'tag mute', 'MUTED'));
  return box;
}

// ---------- list ----------
function render() {
  const q = $('#q').value.trim().toLowerCase();
  const stat = (n, label) => { const d = h('div', 'stat'); d.append(h('b', '', String(n)), h('span', '', label)); return d; };
  $('#stats').replaceChildren(
    stat(users.length, 'People'), stat(users.filter(u => u.online).length, 'Online now'), stat(users.filter(u => u.admin).length, 'Admins'),
    stat(users.filter(u => u.banned).length, 'Banned'), stat(users.filter(isMuted).length, 'Muted'));
  const list = users.filter(u => !q || u.name.toLowerCase().includes(q) || u.id.toLowerCase().includes(q));
  const box = $('#users'); box.replaceChildren();
  if (!list.length) box.append(h('p', 'hint', 'No one matches.'));
  for (const u of list) {
    const row = h('button', 'user-row'), meta = h('span', 'meta'), top = h('span', 'name-row');
    row.type = 'button';
    top.append(h('b', 'name', u.name), tags(u));
    meta.append(top, h('small', '', `ID ${u.id} \u00b7 joined ${date(u.created)} \u00b7 ${u.messages} messages`));
    row.append(avatar(u), meta);
    row.onclick = () => openUser(u.id);
    box.append(row);
  }
}
async function load() {
  users = (await api('/users')).users;
  $('#login').hidden = true; $('#panel').hidden = false;
  render();
}

// ---------- one person ----------
function openUser(id) { openId = id; renderDetail(); if (!$('#user-dialog').open) $('#user-dialog').showModal(); }
function renderDetail() {
  const u = users.find(x => x.id === openId);
  if (!u) return $('#user-dialog').close();
  const box = $('#detail'); box.replaceChildren();

  const top = h('div', 'detail-top'), who = h('div');
  who.append(h('h2', '', u.name), tags(u));
  top.append(avatar(u, 'xl'), who);

  const facts = h('div', 'detail-facts');
  for (const [k, v] of [['ID', u.id], ['Joined', date(u.created)], ['Last seen', u.online ? 'Online now' : ago(u.lastSeen)],
    ['Messages', u.messages], ['Contacts', u.contacts], ['Status', u.banned ? 'Banned' : isMuted(u) ? 'Muted' : 'Active']]) {
    const d = h('div'); d.append(h('small', '', k), h('b', '', String(v))); facts.append(d);
  }

  const act = async (action, extra = {}, msg = 'Done') => {
    try {
      const { user } = await api('/user', { id: u.id, action, ...extra });
      users = users.map(x => (x.id === user.id ? user : x)); render(); renderDetail(); toast(msg);
    } catch (e) { toast(e.message); }
  };

  const adminBox = h('div', 'detail-block');
  adminBox.append(h('h3', '', 'Admin'), h('p', 'hint', u.admin
    ? 'This person is an admin. They can use custom colors on their profile and messages.'
    : 'Admins get a badge and can use custom colors on their profile, name and messages.'));
  const adminBtn = h('button', 'btn ghost', u.admin ? 'Remove admin' : 'Make admin'); adminBtn.type = 'button';
  adminBtn.onclick = () => act(u.admin ? 'unadmin' : 'admin', {}, u.admin ? 'Admin removed' : `${u.name} is now an admin`);
  adminBox.append(adminBtn);

  const muteBox = h('div', 'detail-block'); muteBox.append(h('h3', '', 'Mute'));
  if (isMuted(u)) {
    muteBox.append(h('p', 'hint', u.mutedUntil >= FOREVER ? 'Muted until you unmute them.' : 'Muted until ' + new Date(u.mutedUntil).toLocaleString() + '.'));
    const b = h('button', 'btn ghost', 'Unmute'); b.type = 'button'; b.onclick = () => act('unmute', {}, 'Unmuted'); muteBox.append(b);
  } else {
    muteBox.append(h('p', 'hint', 'A muted person can read messages but cannot send any.'));
    const row = h('div', 'inline'), sel = h('select', 'field');
    for (const [label, mins] of [['10 minutes', 10], ['1 hour', 60], ['1 day', 1440], ['7 days', 10080], ['Until I unmute', 0]]) {
      const o = h('option', '', label); o.value = mins; sel.append(o);
    }
    const b = h('button', 'btn', 'Mute'); b.type = 'button';
    b.onclick = () => act('mute', { minutes: Number(sel.value) }, `${u.name} muted`);
    row.append(sel, b); muteBox.append(row);
  }

  const banBox = h('div', 'detail-block'); banBox.append(h('h3', '', 'Ban'));
  if (u.banned) {
    banBox.append(h('p', 'hint', 'Banned ' + date(u.banned.at) + (u.banned.reason ? '. Reason: ' + u.banned.reason : '.')));
    const b = h('button', 'btn ghost', 'Unban'); b.type = 'button'; b.onclick = () => act('unban', {}, 'Unbanned'); banBox.append(b);
  } else {
    banBox.append(h('p', 'hint', 'A banned person is signed out and cannot use the site with this account.'));
    const reason = h('input', 'field'); reason.placeholder = 'Reason (optional, they will see it)'; reason.maxLength = 120;
    const b = h('button', 'btn ghost danger', 'Ban ' + u.name); b.type = 'button';
    b.onclick = () => { if (confirm(`Ban ${u.name}? They will be signed out right away.`)) act('ban', { reason: reason.value }, `${u.name} banned`); };
    banBox.append(reason, b);
  }
  box.append(top, facts, adminBox, muteBox, banBox);
}

// ---------- login ----------
function logout(msg) {
  token = null; sessionStorage.removeItem(KEY);
  $('#panel').hidden = true; $('#login').hidden = false; $('#user-dialog').close();
  $('#login-err').textContent = msg || ''; $('#password').value = '';
}
$('#login-form').onsubmit = async e => {
  e.preventDefault();
  try {
    const d = await api('/login', { username: $('#username').value, password: $('#password').value });
    token = d.token; sessionStorage.setItem(KEY, token); $('#login-err').textContent = '';
    await load();
  } catch (err) { $('#login-err').textContent = err.message; }
};
$('#logout').onclick = () => logout();
$('#q').oninput = render;
document.addEventListener('click', e => { const b = e.target.closest('[data-close]'); if (b) b.closest('dialog').close(); });
setInterval(() => { if (token && !$('#panel').hidden) load().catch(() => {}); }, 20000);   // keep online status fresh
if (token) load().catch(() => logout());
