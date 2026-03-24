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
    privateCode: document.getElementById("private-code"),
    joinPublic: document.getElementById("join-public"),
    createPrivate: document.getElementById("create-private"),
    joinPrivate: document.getElementById("join-private"),
    toggleReady: document.getElementById("toggle-ready"),
    startGame: document.getElementById("start-game"),
    addBot: document.getElementById("add-bot"),
    roleSettings: document.getElementById("role-settings"),
    killerCount: document.getElementById("killer-count"),
    wizardCount: document.getElementById("wizard-count"),
    memberCount: document.getElementById("member-count"),
    killerMinus: document.getElementById("killer-minus"),
    killerPlus: document.getElementById("killer-plus"),
    wizardMinus: document.getElementById("wizard-minus"),
    wizardPlus: document.getElementById("wizard-plus"),
    memberMinus: document.getElementById("member-minus"),
    memberPlus: document.getElementById("member-plus"),
  };

  const uiState = {
    roomState: null,
    selectedSeatId: null,
  };

  elements.joinPublic.disabled = true;
  elements.createPrivate.disabled = true;
  elements.joinPrivate.disabled = true;
  elements.toggleReady.disabled = true;
  elements.startGame.disabled = true;
  elements.addBot.disabled = true;
  elements.sendChat.disabled = true;

  function safeName() {
    return elements.playerName.value.trim() || "Guest";
  }

  elements.joinPublic.addEventListener("click", () => {
    network.joinPublic(safeName());
  });

  elements.createPrivate.addEventListener("click", () => {
    network.createPrivate(
      safeName(),
      elements.privateCode.value.trim().toUpperCase(),
    );
  });

  elements.joinPrivate.addEventListener("click", () => {
    network.joinPrivate(
      safeName(),
      elements.privateCode.value.trim().toUpperCase(),
    );
  });

  elements.startGame.addEventListener("click", () => {
    network.action("start_game");
  });

  elements.toggleReady.addEventListener("click", () => {
    network.action("toggle_ready");
  });

  elements.addBot.addEventListener("click", () => {
    network.action("add_bot");
  });

  // Role settings handlers
  elements.killerMinus.addEventListener("click", () => {
    const current = uiState.roomState?.lobby?.roleCounts?.[ROLE.KILLER] || 0;
    network.action("set_role_count", {
      role: ROLE.KILLER,
      count: Math.max(0, current - 1),
    });
  });
  elements.killerPlus.addEventListener("click", () => {
    const current = uiState.roomState?.lobby?.roleCounts?.[ROLE.KILLER] || 0;
    network.action("set_role_count", {
      role: ROLE.KILLER,
      count: Math.min(6, current + 1),
    });
  });
  elements.wizardMinus.addEventListener("click", () => {
    const current = uiState.roomState?.lobby?.roleCounts?.[ROLE.WIZARD] || 0;
    network.action("set_role_count", {
      role: ROLE.WIZARD,
      count: Math.max(0, current - 1),
    });
  });
  elements.wizardPlus.addEventListener("click", () => {
    const current = uiState.roomState?.lobby?.roleCounts?.[ROLE.WIZARD] || 0;
    network.action("set_role_count", {
      role: ROLE.WIZARD,
      count: Math.min(6, current + 1),
    });
  });
  elements.memberMinus.addEventListener("click", () => {
    const current = uiState.roomState?.lobby?.roleCounts?.[ROLE.MEMBER] || 0;
    network.action("set_role_count", {
      role: ROLE.MEMBER,
      count: Math.max(0, current - 1),
    });
  });
  elements.memberPlus.addEventListener("click", () => {
    const current = uiState.roomState?.lobby?.roleCounts?.[ROLE.MEMBER] || 0;
    network.action("set_role_count", {
      role: ROLE.MEMBER,
      count: Math.min(6, current + 1),
    });
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
      name.textContent = player.isBot ? `${player.name} 🤖` : player.name;

      const status = document.createElement("div");
      status.className = "seat-status";
      if (player.isBot) {
        status.textContent = player.alive ? "Bot · Alive" : "Bot · Dead";
      } else {
        status.textContent = player.alive ? "Alive" : "Dead";
      }

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

    if (!state.gameStarted) {
      const hostTag = state.private.isHost ? "Host" : "Player";
      const readyTag = me?.ready ? "Ready" : "Not ready";
      elements.actionHint.textContent = `${hostTag} · ${readyTag} · Humans ${state.lobby.connectedHumans}/6 · Bots ${state.lobby.botCount}`;
    } else if (!state.private.alive) {
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

    // Show role settings only for host during lobby
    if (!state.gameStarted && state.private.isHost) {
      elements.roleSettings.style.display = "block";
      elements.killerCount.textContent =
        state.lobby.roleCounts[ROLE.KILLER] || 0;
      elements.wizardCount.textContent =
        state.lobby.roleCounts[ROLE.WIZARD] || 0;
      elements.memberCount.textContent =
        state.lobby.roleCounts[ROLE.MEMBER] || 0;
    } else {
      elements.roleSettings.style.display = "none";
    }

    elements.toggleReady.disabled = !hasAction("toggle_ready");
    elements.toggleReady.textContent = me?.ready ? "Unready" : "Ready";

    elements.addBot.disabled = !hasAction("add_bot");

    elements.startGame.disabled = !hasAction("start_game");
    elements.startGame.textContent = state.private.isHost
      ? "Start"
      : "Host Only";

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
    elements.joinPublic.disabled = !connected;
    elements.createPrivate.disabled = !connected;
    elements.joinPrivate.disabled = !connected;
    elements.toggleReady.disabled = !connected;
    elements.startGame.disabled = !connected;
    elements.sendChat.disabled = !connected;
  }

  function setRoomId(roomId, isPublic = false) {
    if (!isPublic) {
      elements.privateCode.value = roomId;
    }
    pushSystemMessage(
      `Joined ${isPublic ? "public" : "private"} room ${roomId}.`,
    );
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
