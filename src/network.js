export class NetworkClient {
  constructor() {
    this.socket = null;
    this.playerId = null;
    this.roomId = null;
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

  connect() {
    const protocol = location.protocol === "https:" ? "wss" : "ws";
    const socketUrl = `${protocol}://${location.host}/ws`;
    this.socket = new WebSocket(socketUrl);

    this.socket.addEventListener("open", () => {
      this.handlers.status("Connected");
    });

    this.socket.addEventListener("close", () => {
      this.handlers.status("Disconnected");
    });

    this.socket.addEventListener("message", (event) => {
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
