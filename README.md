# Commons

A simple chat app: plain HTML, CSS and JavaScript in the browser, plus a small Node.js server.

## Version 3 (current)

- Accounts: pick a name and get a personal 6-character ID (like `K7QX2M`)
- Contacts: add a friend by their ID and chat with them privately
- Rooms: a shared **General** room plus one direct-message chat per contact
- Live updates (no refreshing), online status and unread badges
- Profiles: photo, banner, bio, status, gender and age, each with its own show/hide switch (gender and age start hidden)
- Tap a name (in a chat header or in General) to see that person's profile card
- Settings button opens your profile, visibility and account key
- Account key: sign in on another device with the key in your profile
- New look, light and dark mode, works on phones
- Still no packages to install; the server uses only Node.js built-ins (Node 18 or newer)

## Run

```
node server.js
```

Then open <http://localhost:8080> (set another port with `PORT=3000 node server.js`).

Data is saved to `data.json` and uploaded photos to `uploads/` (both kept out of git; back them up if you care about them).
If an old `messages.json` exists, its messages are imported into General on the first run.

## Staying online (recommended)

Run it as a service so it restarts itself after crashes and reboots:

```
sudo cp commons.service /etc/systemd/system/   # edit WorkingDirectory first
sudo systemctl enable --now commons
```

Optional: restart it automatically if it ever freezes (checks `/api/health` every minute):

```
chmod +x healthcheck.sh
(crontab -l 2>/dev/null; echo "* * * * * $PWD/healthcheck.sh") | crontab -
```

The browser side also copes with dropped connections: it reconnects on its own, catches up on
missed messages, and keeps unsent messages queued until the connection is back.

## Update on the server

With the service: `git pull && sudo systemctl restart commons`

Without it:

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
