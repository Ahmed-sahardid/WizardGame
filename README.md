# WizardGame

A 6-player Mafia-style browser card game with **server-authoritative multiplayer**.

Roles:

- 2 Killers
- 1 Wizard
- 3 Members

## Multiplayer architecture

- WebSocket room server (authoritative rules + timer sync)
- Room create/join flow with player identity
- Reconnectable identity (refresh keeps the same player session)
- Private role channeling (you only see your role while alive)
- Action contracts validated on server (`killer_kill`, `wizard_inspect`, `wizard_heal`, `vote_target`, etc.)
- Role-exclusive controls rendered from server-provided `availableActions`
- Host-only control permissions for phase transitions and game start
- Ready-check lobby (all 6 players must be ready before host can start)

## Rules implemented

- Roles are assigned randomly at the start of each new game.
- The game runs in rounds with **Night → Discussion → Voting**.
- At night, killers pick a target (server resolves kill).
- The wizard can use **one power per night**:
  - **Inspect** (see selected target role)
  - **Heal** (cancel night kill, once per game)
- During discussion, players can move to a vote.
- Vote has a synced timer and can eliminate or skip.
- Win conditions:
  - Town (Members + Wizard) wins when all killers are eliminated.
  - Killers win when killers are equal to or outnumber everyone else.

## Run locally

1. Open this folder in VS Code.
2. Install dependencies: `npm install`
3. Start server: `npm start`
4. Open `http://localhost:8080` in your browser.

## Run on the internet (not local)

Deploy this app to any Node host (Render, Railway, Fly.io, VPS, etc.).

- The server already uses `PORT` from environment.
- Serve the same app origin over HTTPS so the client can use secure WebSockets automatically.
- Optional: force a remote websocket endpoint with query param:
  - `https://your-frontend.example.com/?ws=wss://your-backend.example.com/ws`

### Docker option

1. Build image: `docker build -t wizardgame .`
2. Run container: `docker run -p 8080:8080 -e PORT=8080 wizardgame`
3. Open `http://localhost:8080` (or your deployed host URL).

### Render one-click option

1. Push this project to GitHub.
2. In Render, click **New +** → **Blueprint**.
3. Select your repo (Render will detect `render.yaml`).
4. Deploy.
5. Open the generated `https://...onrender.com` URL.

If you host frontend and backend on different domains, use:

- `https://your-frontend.example.com/?ws=wss://your-backend.example.com/ws`

### Railway quick deploy

1. Push this project to GitHub.
2. In Railway, click **New Project** → **Deploy from GitHub repo**.
3. Select this repo (Railway reads `railway.json`).
4. Railway builds and runs `npm start`.
5. Open your generated Railway URL.

If frontend and backend are on different domains, use:

- `https://your-frontend.example.com/?ws=wss://your-railway-backend.example.com/ws`

## Room flow

1. Enter your name.
2. Either click **Join Public** for automatic public matchmaking, or use private code flow.
3. Private flow: host clicks **Create Private** with a code, others click **Join Private** with the same code.
4. Each player clicks **Ready**.
5. Host clicks **Start** when all 6 are connected and ready.

## Controls

- Global controls are phase-based (`Start Night`, `End Night`, `Start Vote`, `Vote Skip`, `Resolve Vote`).
- Role controls are exclusive:
  - Killer: `Kill Selected`
  - Wizard: `Inspect Selected`, `Heal Tonight`
  - Member: `Accuse Selected`
- Seat selection on the circle table is used for target-based actions.
