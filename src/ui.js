import { PHASE, ROLE } from "./constants.js";

export function createUI(network) {
  const elements = {
    phase: document.getElementById("phase"),
    round: document.getElementById("round"),
    wizardState: document.getElementById("wizard-state"),
    you: document.getElementById("you"),
    roleBadge: document.getElementById("role-badge"),
    actionHint: document.getElementById("action-hint"),
    cards: document.getElementById("cards"),
    playersCircle: document.getElementById("players-circle"),
    timer: document.getElementById("timer"),
    timerContainer: document.getElementById("timer-container"),
    roleActions: document.getElementById("role-actions"),
    globalActions: document.getElementById("global-actions"),
    chat: document.getElementById("chat"),
    chatInput: document.getElementById("chat-input"),
    sendChat: document.getElementById("send-chat"),

    connectionStatus: document.getElementById("connection-status"),
    playerName: document.getElementById("player-name"),
    roomId: document.getElementById("room-id"),
    createRoom: document.getElementById("create-room"),
    joinRoom: document.getElementById("join-room"),
    startGame: document.getElementById("start-game"),
  };

  const uiState = {
    roomState: null,
    selectedSeatId: null,
  };

  elements.createRoom.disabled = true;
  elements.joinRoom.disabled = true;
  elements.startGame.disabled = true;
  elements.sendChat.disabled = true;

  function safeName() {
    return elements.playerName.value.trim() || "Guest";
  }

  elements.createRoom.addEventListener("click", () => {
    network.createRoom(safeName(), elements.roomId.value.trim().toUpperCase());
  });

  elements.joinRoom.addEventListener("click", () => {
    network.joinRoom(safeName(), elements.roomId.value.trim().toUpperCase());
  });

  elements.startGame.addEventListener("click", () => {
    network.action("start_game");
  });

  elements.sendChat.addEventListener("click", () => {
    const message = elements.chatInput.value.trim();
    if (!message) {
      return;
    }
    network.action("chat", { message });
    elements.chatInput.value = "";
  });

  elements.chatInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      const message = elements.chatInput.value.trim();
      if (!message) {
        return;
      }
      network.action("chat", { message });
      elements.chatInput.value = "";
    }
  });

  function hasAction(name) {
    const actions = uiState.roomState?.private?.availableActions || [];
    return actions.includes(name);
  }

  function renderButtons(container, buttonDefs) {
    container.innerHTML = "";

    buttonDefs.forEach((definition) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn-sm";
      button.textContent = definition.label;
      button.disabled = !!definition.disabled;
      button.addEventListener("click", definition.onClick);
      container.appendChild(button);
    });
  }

  function renderRoleActions(state) {
    const localRole = state.private.role;
    const selected = uiState.selectedSeatId;

    const actions = [];

    if (localRole === ROLE.KILLER && hasAction("killer_kill")) {
      actions.push({
        label: "Kill Selected",
        disabled: !selected,
        onClick: () => network.action("killer_kill", { targetId: selected }),
      });
    }

    if (localRole === ROLE.WIZARD && hasAction("wizard_inspect")) {
      actions.push({
        label: "Inspect Selected",
        disabled: !selected || selected === state.private.playerId,
        onClick: () => network.action("wizard_inspect", { targetId: selected }),
      });
    }

    if (localRole === ROLE.WIZARD && hasAction("wizard_heal")) {
      actions.push({
        label: "Heal Tonight",
        disabled: false,
        onClick: () => network.action("wizard_heal"),
      });
    }

    if (localRole === ROLE.MEMBER && hasAction("member_accuse")) {
      actions.push({
        label: "Accuse Selected",
        disabled: !selected,
        onClick: () => network.action("member_accuse", { targetId: selected }),
      });
    }

    renderButtons(elements.roleActions, actions);
  }

  function renderGlobalActions() {
    const actions = [
      {
        key: "start_night",
        label: "Start Night",
      },
      {
        key: "end_night",
        label: "End Night",
      },
      {
        key: "start_vote",
        label: "Start Vote",
      },
      {
        key: "vote_skip",
        label: "Vote Skip",
      },
      {
        key: "resolve_vote",
        label: "Resolve Vote",
      },
    ].map((item) => ({
      label: item.label,
      disabled: !hasAction(item.key),
      onClick: () => network.action(item.key),
    }));

    renderButtons(elements.globalActions, actions);
  }

  function renderCards(state) {
    elements.cards.innerHTML = "";

    state.players.forEach((player) => {
      const visibleRole = player.role;
      const card = document.createElement("article");
      const roleClass = (visibleRole || "hidden").toLowerCase();
      card.className =
        `role-card ${visibleRole ? "revealed" : "hidden"} ${roleClass} ${player.alive ? "" : "dead"}`.trim();

      if (visibleRole) {
        const title = document.createElement("div");
        title.className = "role-title";
        title.textContent = player.name;

        const value = document.createElement("div");
        value.className = "role-value";
        value.textContent = visibleRole[0].toUpperCase();

        const note = document.createElement("div");
        note.className = "role-note";
        note.textContent = visibleRole;

        card.append(title, value, note);
      }

      elements.cards.appendChild(card);
    });
  }

  function renderTable(state) {
    elements.playersCircle.innerHTML = "";
    const total = state.players.length;
    if (!total) {
      return;
    }

    if (uiState.selectedSeatId) {
      const stillValid = state.players.some(
        (entry) => entry.id === uiState.selectedSeatId && entry.alive,
      );
      if (!stillValid) {
        uiState.selectedSeatId = null;
      }
    }

    const radius = 130;
    const step = (Math.PI * 2) / total;

    state.players.forEach((player, index) => {
      const angle = index * step - Math.PI / 2;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;

      const seat = document.createElement("button");
      seat.type = "button";
      seat.className =
        `circle-seat ${player.alive ? "" : "dead"} ${uiState.selectedSeatId === player.id ? "selected" : ""} ${state.voting.yourVote === player.id ? "voting" : ""}`.trim();
      seat.style.left = `calc(50% + ${x}px - 40px)`;
      seat.style.top = `calc(50% + ${y}px - 40px)`;
      seat.disabled = !player.alive;

      seat.addEventListener("click", () => {
        uiState.selectedSeatId = player.id;

        if (hasAction("vote_target") && state.phase === PHASE.VOTING) {
          network.action("vote_target", { targetId: player.id });
        }

        render(state);
      });

      const name = document.createElement("div");
      name.className = "seat-name";
      name.textContent = player.name;

      const status = document.createElement("div");
      status.className = "seat-status";
      status.textContent = player.alive ? "Alive" : "Dead";

      seat.append(name, status);
      elements.playersCircle.appendChild(seat);
    });
  }

  function renderChat(state) {
    elements.chat.innerHTML = "";
    state.logs.forEach((line) => {
      const item = document.createElement("div");
      item.className = "chat-message";
      item.textContent = line;
      elements.chat.appendChild(item);
    });
  }

  function render(state) {
    uiState.roomState = state;

    const me = state.players.find(
      (player) => player.id === state.private.playerId,
    );

    elements.phase.textContent = state.phase;
    elements.round.textContent = String(state.round);
    elements.you.textContent = `You: ${me?.name || "Unknown"}`;
    elements.roleBadge.textContent = state.private.role || "Unknown";

    const wizard = state.players.find((player) => player.role === ROLE.WIZARD);
    if (!wizard) {
      elements.wizardState.textContent = "Unknown";
    } else if (!wizard.alive) {
      elements.wizardState.textContent = "Dead";
    } else if (state.private.wizardHealUsedGame) {
      elements.wizardState.textContent = "Alive (heal used)";
    } else {
      elements.wizardState.textContent = "Alive (heal ready)";
    }

    if (!state.private.alive) {
      elements.actionHint.textContent = "You are dead. Observe and chat.";
    } else if (state.private.role === ROLE.KILLER) {
      elements.actionHint.textContent =
        "Night: pick non-killer target, then kill.";
    } else if (state.private.role === ROLE.WIZARD) {
      elements.actionHint.textContent =
        "Night: inspect selected or heal once/game.";
    } else {
      elements.actionHint.textContent =
        "Discussion/Voting: accuse selected seat.";
    }

    if (state.private.wizardInspection) {
      elements.actionHint.textContent = `Inspect result: ${state.private.wizardInspection.role}`;
    }

    if (state.timer.active) {
      elements.timerContainer.style.display = "flex";
      elements.timer.textContent = `${state.timer.remaining}s`;
    } else {
      elements.timerContainer.style.display = "none";
      elements.timer.textContent = "--";
    }

    renderRoleActions(state);
    renderGlobalActions();
    renderCards(state);
    renderTable(state);
    renderChat(state);
  }

  function setConnectionStatus(status) {
    elements.connectionStatus.textContent = status;
    const connected = status.startsWith("Connected");
    elements.createRoom.disabled = !connected;
    elements.joinRoom.disabled = !connected;
    elements.startGame.disabled = !connected;
    elements.sendChat.disabled = !connected;
  }

  function setRoomId(roomId) {
    elements.roomId.value = roomId;
    pushSystemMessage(`Joined room ${roomId}.`);
  }

  function pushSystemMessage(text) {
    const item = document.createElement("div");
    item.className = "chat-message";
    item.textContent = text;
    elements.chat.prepend(item);
  }

  return {
    render,
    setConnectionStatus,
    setRoomId,
    pushSystemMessage,
  };
}
