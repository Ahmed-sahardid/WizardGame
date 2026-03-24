import { createServer } from "http";
import { readFileSync, existsSync, statSync } from "fs";
import { extname, join, resolve } from "path";
import { WebSocketServer } from "ws";
import { randomUUID } from "crypto";
import { GameRoom } from "./gameRoom.js";

const root = resolve(process.cwd());
const clientRoot = root;
const port = process.env.PORT ? Number(process.env.PORT) : 8080;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function safePath(urlPath) {
  const clean = urlPath === "/" ? "/index.html" : urlPath;
  return join(clientRoot, clean.replace(/^\/+/, ""));
}

const rooms = new Map();
const playerRoom = new Map();
const sockets = new Map();

function send(socket, type, payload) {
  if (!socket || socket.readyState !== 1) {
    return;
  }
  socket.send(JSON.stringify({ type, payload }));
}

function getOrCreateRoom(roomId) {
  if (!rooms.has(roomId)) {
    const room = new GameRoom(roomId);
    room.isPublic = false;
    room.setStateHandler(() => {
      room.players.forEach((player) => {
        send(player.socket, "room_state", room.serializeFor(player.id));
      });
    });
    rooms.set(roomId, room);
  }
  return rooms.get(roomId);
}

function findOrCreatePublicRoom() {
  const available = [...rooms.values()].find(
    (room) => room.isPublic && room.players.length < 6 && !room.gameStarted,
  );

  if (available) {
    return available;
  }

  const roomId = `PUB${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const room = getOrCreateRoom(roomId);
  room.isPublic = true;
  return room;
}

function handleAction(room, playerId, action, payload = {}) {
  switch (action) {
    case "toggle_ready":
      room.toggleReady(playerId);
      break;
    case "start_game":
      room.startGame(playerId);
      break;
    case "start_night":
      room.startNight(playerId);
      break;
    case "end_night":
      room.endNight(playerId);
      break;
    case "start_vote":
      room.startVote(playerId);
      break;
    case "vote_skip":
      room.castVote(playerId, "skip");
      break;
    case "vote_target":
      room.castVote(playerId, payload.targetId);
      break;
    case "resolve_vote":
      room.resolveVote(playerId);
      break;
    case "killer_kill":
      room.killerKill(playerId, payload.targetId);
      break;
    case "wizard_inspect":
      room.wizardInspect(playerId, payload.targetId);
      break;
    case "wizard_heal":
      room.wizardHeal(playerId);
      break;
    case "member_accuse":
      room.castVote(playerId, payload.targetId);
      break;
    case "chat":
      room.sendChat(playerId, payload.message || "");
      break;
    default:
      throw new Error(`Unknown action: ${action}`);
  }
}

const server = createServer((req, res) => {
  try {
    const filePath = safePath(req.url || "/");
    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const extension = extname(filePath);
    const contentType = mimeTypes[extension] || "application/octet-stream";
    const content = readFileSync(filePath);

    res.writeHead(200, { "Content-Type": contentType });
    res.end(content);
  } catch (error) {
    res.writeHead(500);
    res.end("Internal server error");
  }
});

const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (socket) => {
  let playerId = null;

  function bindIdentity(identity) {
    playerId = identity;
    sockets.set(playerId, socket);
    send(socket, "connected", { playerId });

    const existingRoomId = playerRoom.get(playerId);
    if (existingRoomId && rooms.has(existingRoomId)) {
      const room = rooms.get(existingRoomId);
      try {
        room.addPlayer({ id: playerId, name: null, socket });
        send(socket, "room_joined", {
          roomId: existingRoomId,
          playerId,
          isPublic: !!room.isPublic,
        });
        room.emit();
      } catch {
        // ignore automatic rejoin failures; explicit join/create can recover
      }
    }
  }

  socket.on("message", (raw) => {
    try {
      const message = JSON.parse(raw.toString());
      const { type, payload } = message;

      if (type === "hello") {
        const requestedId = String(payload?.sessionId || "").trim();
        const identity = requestedId || randomUUID();
        bindIdentity(identity);
        return;
      }

      if (!playerId) {
        throw new Error("Client must send hello first.");
      }

      if (type === "create_room") {
        const existingRoomId = playerRoom.get(playerId);
        if (existingRoomId && rooms.has(existingRoomId)) {
          const existingRoom = rooms.get(existingRoomId);
          send(socket, "room_joined", {
            roomId: existingRoomId,
            playerId,
            isPublic: !!existingRoom.isPublic,
          });
          existingRoom.emit();
          return;
        }

        const roomId = (
          payload.roomId || Math.random().toString(36).slice(2, 7)
        ).toUpperCase();
        const room = getOrCreateRoom(roomId);
        room.isPublic = false;
        room.addPlayer({ id: playerId, name: payload.name, socket });
        playerRoom.set(playerId, roomId);
        send(socket, "room_joined", { roomId, playerId, isPublic: false });
        room.emit();
        return;
      }

      if (type === "join_room") {
        const existingRoomId = playerRoom.get(playerId);
        if (existingRoomId && rooms.has(existingRoomId)) {
          const existingRoom = rooms.get(existingRoomId);
          send(socket, "room_joined", {
            roomId: existingRoomId,
            playerId,
            isPublic: !!existingRoom.isPublic,
          });
          existingRoom.emit();
          return;
        }

        const roomId = String(payload.roomId || "")
          .trim()
          .toUpperCase();
        if (!roomId || !rooms.has(roomId)) {
          throw new Error("Room not found.");
        }
        const room = rooms.get(roomId);
        room.addPlayer({ id: playerId, name: payload.name, socket });
        playerRoom.set(playerId, roomId);
        send(socket, "room_joined", {
          roomId,
          playerId,
          isPublic: !!room.isPublic,
        });
        room.emit();
        return;
      }

      if (type === "join_public") {
        const existingRoomId = playerRoom.get(playerId);
        if (existingRoomId && rooms.has(existingRoomId)) {
          const existingRoom = rooms.get(existingRoomId);
          send(socket, "room_joined", {
            roomId: existingRoomId,
            playerId,
            isPublic: !!existingRoom.isPublic,
          });
          existingRoom.emit();
          return;
        }

        const room = findOrCreatePublicRoom();
        room.addPlayer({ id: playerId, name: payload.name, socket });
        playerRoom.set(playerId, room.roomId);
        send(socket, "room_joined", {
          roomId: room.roomId,
          playerId,
          isPublic: true,
        });
        room.emit();
        return;
      }

      const roomId = playerRoom.get(playerId);
      if (!roomId || !rooms.has(roomId)) {
        throw new Error("Join a room first.");
      }
      const room = rooms.get(roomId);

      if (type === "action") {
        handleAction(room, playerId, payload.action, payload);
      }
    } catch (error) {
      send(socket, "error", { message: error.message || "Request failed" });
    }
  });

  socket.on("close", () => {
    if (!playerId) {
      return;
    }

    const roomId = playerRoom.get(playerId);
    if (roomId && rooms.has(roomId)) {
      const room = rooms.get(roomId);
      room.removePlayer(playerId);
      room.emit();
    }
    sockets.delete(playerId);
    playerRoom.delete(playerId);
  });
});

server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`WizardGame server running at http://localhost:${port}`);
});
