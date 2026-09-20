# Commons

A simple chat app: plain HTML, CSS and JavaScript in the browser, plus a small Node.js server.

## Version 3 (current)

- Accounts: pick a name and get a personal 6-character ID (like `K7QX2M`)
- Contacts: add a friend by their ID and chat with them privately
- Rooms: a shared **General** room plus one direct-message chat per contact
- Live updates (no refreshing), online status and unread badges
- Profile: change your name and avatar color
- Account key: sign in on another device with the key in your profile
- New look, light and dark mode, works on phones
- Still no packages to install; the server uses only Node.js built-ins (Node 18 or newer)

## Run

```
node server.js
```

Then open <http://localhost:8080> (set another port with `PORT=3000 node server.js`).

Data is saved to `data.json` (kept out of git, because it contains account keys).
If an old `messages.json` exists, its messages are imported into General on the first run.

## Update on the server

```
pkill -f "node server.js"
git pull
setsid nohup node server.js > server.log 2>&1 &
```

## Planned upgrades

- Contact requests (accept / decline) and removing contacts
- Typing indicators and read receipts
- Password logins instead of account keys
- A database instead of data.json
