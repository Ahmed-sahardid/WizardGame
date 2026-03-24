# WizardGame

A 6-player Mafia-style browser card game with **server-authoritative multiplayer**.

Roles:

- 2 Killers
- 1 Wizard
- 3 Members

## Multiplayer architecture

- WebSocket room server (authoritative rules + timer sync)
- Room create/join flow with player identity
- Private role channeling (you only see your role while alive)
- Action contracts validated on server (`killer_kill`, `wizard_inspect`, `wizard_heal`, `vote_target`, etc.)
- Role-exclusive controls rendered from server-provided `availableActions`

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

## Room flow

1. Enter your name.
2. Host clicks **Create** (or provides room code).
3. Other players enter the room code and click **Join**.
4. When 6 players are in room, click **Start**.

## Controls

- Global controls are phase-based (`Start Night`, `End Night`, `Start Vote`, `Vote Skip`, `Resolve Vote`).
- Role controls are exclusive:
  - Killer: `Kill Selected`
  - Wizard: `Inspect Selected`, `Heal Tonight`
  - Member: `Accuse Selected`
- Seat selection on the circle table is used for target-based actions.
