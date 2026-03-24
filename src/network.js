export class NetworkClient {
  constructor() {
    this.socket = null;
    this.playerId = null;
    this.roomId = null;
    this.isConnected = false;
    this.handlers = {
      connected: () => {},
      joined: () => {},
      state: () => {},
      error: () => {},
      status: () => {},
    };
    this.storageKey = "wizardgame.sessionId";
    this.tokenStorageKey = "wizardgame.sessionToken";
  }

  on(eventName, handler) {
    this.handlers[eventName] = handler;
  }

  sanitizeWsUrl(input) {
    if (!input) {
      return null;
    }

    const value = String(input).trim();
    if (!value) {
      return null;
    }

    if (/^wss?:\/\//i.test(value)) {
      return value;
    }

    return null;
  }

  buildSocketCandidates() {
    const candidates = [];

    const fromQuery = this.sanitizeWsUrl(
      new URLSearchParams(location.search).get("ws"),
    );
    const fromStorage = this.sanitizeWsUrl(
      localStorage.getItem("wizardgame.wsUrl"),
    );
    const fromGlobal = this.sanitizeWsUrl(window.WIZARDGAME_WS_URL);

    [fromQuery, fromStorage, fromGlobal].forEach((url) => {
      if (url && !candidates.includes(url)) {
        candidates.push(url);
      }
    });

    const protocol = location.protocol === "https:" ? "wss" : "ws";

    if (location.host) {
      const sameOrigin = `${protocol}://${location.host}/ws`;
      if (!candidates.includes(sameOrigin)) {
        candidates.push(sameOrigin);
      }
    }

    const fallbackHosts = new Set([
      location.hostname,
      "localhost",
      "127.0.0.1",
    ]);
    fallbackHosts.forEach((host) => {
      if (!host) {
        return;
      }
      const fallback = `${protocol}://${host}:8080/ws`;
      if (!candidates.includes(fallback)) {
        candidates.push(fallback);
      }
    });

    return candidates;
  }

  connect() {
    const candidates = this.buildSocketCandidates();
    let index = 0;

    const tryNext = () => {
      if (index >= candidates.length) {
        this.isConnected = false;
        this.handlers.status("Disconnected");
        this.handlers.error(
          "Unable to connect to websocket. Make sure `npm start` is running and open http://localhost:8080.",
        );
        return;
      }

      const socketUrl = candidates[index];
      index += 1;
      this.handlers.status("Connecting...");

      let socket;
      try {
        socket = new WebSocket(socketUrl);
      } catch {
        tryNext();
        return;
      }
      let opened = false;

      socket.addEventListener("open", () => {
        opened = true;
        this.socket = socket;
        this.isConnected = true;
        this.handlers.status(`Connected (${socketUrl})`);

        localStorage.setItem("wizardgame.wsUrl", socketUrl);

        const savedSession = localStorage.getItem(this.storageKey) || "";
        const savedToken = localStorage.getItem(this.tokenStorageKey) || "";
        this.send("hello", {
          sessionId: savedSession,
          sessionToken: savedToken,
        });
      });

      socket.addEventListener("error", () => {
        if (!opened) {
          socket.close();
        }
      });

      socket.addEventListener("close", () => {
        if (!opened) {
          tryNext();
          return;
        }
        this.isConnected = false;
        this.handlers.status("Disconnected");
      });

      socket.addEventListener("message", (event) => {
        const message = JSON.parse(event.data);
        const { type, payload } = message;

        if (type === "connected") {
          this.playerId = payload.playerId;
          localStorage.setItem(this.storageKey, payload.playerId);
          if (payload.sessionToken) {
            localStorage.setItem(this.tokenStorageKey, payload.sessionToken);
          }
          this.handlers.connected(payload);
        }
        if (type === "room_joined") {
          this.roomId = payload.roomId;
          this.handlers.joined(payload);
        }
        if (type === "room_state") {
          this.handlers.state(payload);
        }
        if (type === "error") {
          this.handlers.error(payload.message || "Request failed");
        }
      });
    };

    tryNext();
  }

  send(type, payload) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      this.handlers.error("Socket not connected.");
      return;
    }
    this.socket.send(JSON.stringify({ type, payload }));
  }

  createRoom(name, roomId = "") {
    this.send("create_room", { name, roomId });
  }

  joinRoom(name, roomId) {
    this.send("join_room", { name, roomId });
  }

  joinPublic(name) {
    this.send("join_public", { name });
  }

  createPrivate(name, code = "") {
    this.send("create_room", { name, roomId: code });
  }

  joinPrivate(name, code) {
    this.send("join_room", { name, roomId: code });
  }

  action(action, payload = {}) {
    this.send("action", { action, ...payload });
  }
}
