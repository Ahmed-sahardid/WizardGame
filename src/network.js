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
  }

  on(eventName, handler) {
    this.handlers[eventName] = handler;
  }

  buildSocketCandidates() {
    const protocol = location.protocol === "https:" ? "wss" : "ws";
    const candidates = [`${protocol}://${location.host}/ws`];

    const fallbackHost = location.hostname || "localhost";
    const fallback = `${protocol}://${fallbackHost}:8080/ws`;
    if (!candidates.includes(fallback)) {
      candidates.push(fallback);
    }

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

      const socket = new WebSocket(socketUrl);
      let opened = false;

      socket.addEventListener("open", () => {
        opened = true;
        this.socket = socket;
        this.isConnected = true;
        this.handlers.status(`Connected (${socketUrl})`);
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

  action(action, payload = {}) {
    this.send("action", { action, ...payload });
  }
}
