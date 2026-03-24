import { createUI } from "./ui.js";
import { NetworkClient } from "./network.js";

const network = new NetworkClient();
const ui = createUI(network);

network.on("status", (value) => ui.setConnectionStatus(value));
network.on("joined", ({ roomId, isPublic }) =>
  ui.setRoomId(roomId, !!isPublic),
);
network.on("state", (state) => ui.render(state));
network.on("error", (message) => ui.pushSystemMessage(`Error: ${message}`));

network.connect();
