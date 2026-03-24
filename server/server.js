import { createServer } from "http";
import { readFileSync, existsSync, statSync } from "fs";
import { extname, relative, resolve } from "path";
import { WebSocketServer } from "ws";
import { randomUUID, randomBytes, createHmac, timingSafeEqual } from "crypto";
import { GameRoom } from "./gameRoom.js";

const root = resolve(process.cwd());
const clientRoot = resolve(root);
const port = process.env.PORT ? Number(process.env.PORT) : 8080;
const SESSION_SECRET = process.env.SESSION_SECRET || randomUUID();
const MAX_MESSAGE_BYTES = 8 * 1024;
const RATE_WINDOW_MS = 10_000;
const MAX_MESSAGES_PER_WINDOW = 120;
const MAX_IP_MESSAGES_PER_WINDOW = 400;
const allowedOrigins = String(process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const ipRateState = new Map();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function isAllowedStaticPath(pathname) {
  if (pathname === "/" || pathname === "/index.html") {
    return true;
  }
  if (pathname === "/styles.css") {
    return true;
  }
  if (pathname.startsWith("/src/")) {
    return true;
  }
  return false;
}

function safePath(urlPath) {
  const parsed = new URL(urlPath || "/", "http://localhost");
  const pathname = parsed.pathname === "/" ? "/index.html" : parsed.pathname;

  if (!isAllowedStaticPath(pathname)) {
    return null;
  }

  const fullPath = resolve(clientRoot, `.${pathname}`);
  const rel = relative(clientRoot, fullPath);
  if (rel.startsWith("..") || rel.includes("..") || rel.startsWith("/")) {
    return null;
  }

  return fullPath;
}

function createSecureRoomId(prefix = "") {
  const value = randomBytes(4)
    .toString("base64url")
    .replace(/[^A-Z0-9]/gi, "")
    .toUpperCase()
    .slice(0, 5)
    .padEnd(5, "A");
  return `${prefix}${value}`;
}

function signSession(playerId) {
  return createHmac("sha256", SESSION_SECRET).update(playerId).digest("hex");
}

function verifySession(playerId, token) {
  if (!playerId || !token) {
    return false;
  }

  const expected = signSession(playerId);
  const actualBuffer = Buffer.from(String(token), "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  if (actualBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(actualBuffer, expectedBuffer);
}

function sanitizeName(value) {
  const cleaned = String(value || "")
    .replace(/[\r\n\t]/g, " ")
    .trim()
    .slice(0, 16);
  return cleaned || "Guest";
}

function sanitizeRoomId(value) {
  const id = String(value || "")
    .trim()
    .toUpperCase();
  if (!id) {
    return "";
  }
  if (!/^[A-Z0-9]{4,8}$/.test(id)) {
    throw new Error("Room code must be 4-8 letters/numbers.");
  }
  return id;
}

function isOriginAllowed(originHeader, hostHeader) {
  const origin = String(originHeader || "").trim();
  if (!origin) {
    return false;
  }

  let parsedOrigin;
  try {
    parsedOrigin = new URL(origin);
  } catch {
    return false;
  }

  const originHost = parsedOrigin.host;
  const requestHost = String(hostHeader || "").trim();

  if (allowedOrigins.includes("*")) {
    return true;
  }

  if (allowedOrigins.length > 0) {
    return allowedOrigins.includes(origin);
  }

  return originHost === requestHost;
}

function hitIpRateLimit(ipAddress) {
  const key = ipAddress || "unknown";
  const now = Date.now();
  const state = ipRateState.get(key) || { startedAt: now, count: 0 };

  if (now - state.startedAt >= RATE_WINDOW_MS) {
    state.startedAt = now;
    state.count = 0;
  }

  state.count += 1;
  ipRateState.set(key, state);

  return state.count > MAX_IP_MESSAGES_PER_WINDOW;
}

function cleanupRoomIfIdle(roomId) {
  if (!roomId || !rooms.has(roomId)) {
    return;
  }

  const room = rooms.get(roomId);
  if (room.connectedHumans().length === 0) {
    room.clearVoteTimer();
    rooms.delete(roomId);
  }
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

  const roomId = createSecureRoomId("PUB");
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
    case "add_bot":
      room.addBot(playerId);
      break;
    case "set_role_count":
      room.setRoleCount(playerId, payload.role, payload.count);
      break;
    default:
      throw new Error(`Unknown action: ${action}`);
  }
}

const server = createServer((req, res) => {
  try {
    if (!["GET", "HEAD"].includes(req.method || "")) {
      res.writeHead(405);
      res.end("Method not allowed");
      return;
    }

    const filePath = safePath(req.url || "/");
    if (!filePath || !existsSync(filePath) || !statSync(filePath).isFile()) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const extension = extname(filePath);
    const contentType = mimeTypes[extension] || "application/octet-stream";
    const content = readFileSync(filePath);

    res.writeHead(200, {
      "Content-Type": contentType,
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Content-Security-Policy":
        "default-src 'self'; connect-src 'self' ws: wss:; style-src 'self' 'unsafe-inline'; script-src 'self';",
    });
    res.end(content);
  } catch (error) {
    res.writeHead(500);
    res.end("Internal server error");
  }
});

const wss = new WebSocketServer({
  server,
  path: "/ws",
  maxPayload: MAX_MESSAGE_BYTES,
});

wss.on("connection", (socket, req) => {
  if (!isOriginAllowed(req.headers.origin, req.headers.host)) {
    socket.close(1008, "Origin not allowed");
    return;
  }

  let playerId = null;
  const remoteIp = req.socket?.remoteAddress || "unknown";
  let windowStartedAt = Date.now();
  let messagesInWindow = 0;

  function bindIdentity(identity) {
    const active = sockets.get(identity);
    if (active && active !== socket && active.readyState === 1) {
      throw new Error("Session already connected elsewhere.");
    }

    playerId = identity;
    sockets.set(playerId, socket);
    send(socket, "connected", {
      playerId,
      sessionToken: signSession(playerId),
    });

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
      const now = Date.now();
      if (now - windowStartedAt >= RATE_WINDOW_MS) {
        windowStartedAt = now;
        messagesInWindow = 0;
      }
      messagesInWindow += 1;
      if (messagesInWindow > MAX_MESSAGES_PER_WINDOW) {
        throw new Error("Too many requests. Slow down.");
      }

      if (hitIpRateLimit(remoteIp)) {
        throw new Error("Too many requests from this IP. Slow down.");
      }

      if (Buffer.byteLength(raw) > MAX_MESSAGE_BYTES) {
        throw new Error("Payload too large.");
      }

      const message = JSON.parse(raw.toString());
      const { type, payload } = message;

      if (type === "hello") {
        const requestedId = String(payload?.sessionId || "").trim();
        const requestedToken = String(payload?.sessionToken || "").trim();
        const identity =
          requestedId && verifySession(requestedId, requestedToken)
            ? requestedId
            : randomUUID();
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
          sanitizeRoomId(payload.roomId) || createSecureRoomId()
        ).toUpperCase();
        const room = getOrCreateRoom(roomId);
        room.isPublic = false;
        room.addPlayer({
          id: playerId,
          name: sanitizeName(payload.name),
          socket,
        });
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

        const roomId = sanitizeRoomId(payload.roomId);
        if (!roomId || !rooms.has(roomId)) {
          throw new Error("Room not found.");
        }
        const room = rooms.get(roomId);
        room.addPlayer({
          id: playerId,
          name: sanitizeName(payload.name),
          socket,
        });
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
        room.addPlayer({
          id: playerId,
          name: sanitizeName(payload.name),
          socket,
        });
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
        if (!payload || typeof payload.action !== "string") {
          throw new Error("Invalid action payload.");
        }
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
      cleanupRoomIfIdle(roomId);
    }
    sockets.delete(playerId);
    playerRoom.delete(playerId);
  });
});

server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`WizardGame server running at http://localhost:${port}`);
});
