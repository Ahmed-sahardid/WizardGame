import { PHASE, ROLE, VOTE_SECONDS } from "../src/constants.js";

const ROLE_POOL = [
  ROLE.KILLER,
  ROLE.KILLER,
  ROLE.WIZARD,
  ROLE.MEMBER,
  ROLE.MEMBER,
  ROLE.MEMBER,
];

function shuffle(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const random = Math.floor(Math.random() * (i + 1));
    [result[i], result[random]] = [result[random], result[i]];
  }
  return result;
}

function majorityChoice(values) {
  const counts = new Map();
  values.forEach((value) => {
    counts.set(value, (counts.get(value) || 0) + 1);
  });
  let max = 0;
  let choice = null;
  counts.forEach((count, value) => {
    if (count > max) {
      max = count;
      choice = value;
    }
  });
  return choice;
}

export class GameRoom {
  constructor(roomId) {
    this.roomId = roomId;
    this.players = [];
    this.botCounter = 1;
    this.hostId = null;
    this.gameStarted = false;
    this.phase = PHASE.SETUP;
    this.round = 0;
    this.logs = [];
    this.gameEnded = false;

    // Role configuration (can be customized by host)
    this.roleCounts = {
      [ROLE.KILLER]: 2,
      [ROLE.WIZARD]: 1,
      [ROLE.MEMBER]: 3,
    };

    this.night = {
      wizardUsedPower: false,
      wizardHealUsedGame: false,
      killSelections: new Map(),
      inspectedByWizard: null,
    };

    this.voting = {
      votes: new Map(),
      startedAt: null,
      endsAt: null,
      timerHandle: null,
    };

    this.onStateChanged = () => {};
  }

  setStateHandler(handler) {
    this.onStateChanged = handler;
  }

  emit() {
    this.onStateChanged();
  }

  addLog(message) {
    this.logs.unshift(message);
    if (this.logs.length > 100) {
      this.logs.pop();
    }
  }

  requireHost(playerId) {
    if (playerId !== this.hostId) {
      throw new Error("Only the host can do this action.");
    }
  }

  connectedCount() {
    return this.players.filter((player) => player.connected).length;
  }

  humanPlayers() {
    return this.players.filter((player) => !player.isBot);
  }

  connectedHumans() {
    return this.players.filter((player) => !player.isBot && player.connected);
  }

  allHumansReady() {
    const humans = this.connectedHumans();
    return humans.length > 0 && humans.every((player) => player.ready);
  }

  allReady() {
    return this.allHumansReady();
  }

  canStartGame() {
    return (
      !this.gameStarted && this.allHumansReady() && this.players.length <= 6
    );
  }

  aliveBotsByRole(role) {
    return this.players.filter(
      (player) => player.isBot && player.alive && player.role === role,
    );
  }

  aliveTargetsForBots(excludeIds = new Set(), disallowRole = null) {
    return this.players.filter(
      (player) =>
        player.alive &&
        !excludeIds.has(player.id) &&
        (disallowRole ? player.role !== disallowRole : true),
    );
  }

  pickRandomPlayer(candidates) {
    if (!candidates.length) {
      return null;
    }
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  fillBotsToSix() {
    while (this.players.length < 6) {
      const botId = `bot-${this.roomId}-${this.botCounter}`;
      this.botCounter += 1;

      this.players.push({
        id: botId,
        name: `Bot ${this.botCounter - 1}`,
        socket: null,
        ready: true,
        alive: true,
        role: null,
        connected: true,
        isBot: true,
      });
    }
  }

  transferHostIfNeeded() {
    const host = this.players.find((player) => player.id === this.hostId);
    if (host?.connected) {
      return;
    }

    const nextHost = this.players.find((player) => player.connected);
    this.hostId = nextHost?.id || null;
    if (nextHost) {
      this.addLog(`${nextHost.name} is now the host.`);
    }
  }

  addPlayer({ id, name, socket }) {
    const existing = this.players.find((entry) => entry.id === id);
    if (existing) {
      if (existing.connected) {
        throw new Error("This identity is already connected.");
      }

      existing.socket = socket;
      existing.connected = true;
      existing.name = name?.trim() || existing.name;
      this.addLog(`${existing.name} reconnected.`);
      this.emit();
      return;
    }

    if (this.players.length >= 6) {
      throw new Error("Room is full (max 6 players).");
    }

    this.players.push({
      id,
      name: name?.trim() || `Player ${this.players.length + 1}`,
      socket,
      ready: false,
      alive: true,
      role: null,
      connected: true,
      isBot: false,
    });

    if (!this.hostId) {
      this.hostId = id;
    }

    this.addLog(
      `${this.players[this.players.length - 1].name} joined room ${this.roomId}.`,
    );
    this.emit();
  }

  removePlayer(playerId) {
    const player = this.players.find((entry) => entry.id === playerId);
    if (!player) {
      return;
    }
    player.connected = false;
    player.ready = false;
    this.addLog(`${player.name} disconnected.`);
    this.transferHostIfNeeded();
    this.emit();
  }

  toggleReady(playerId) {
    if (this.gameStarted) {
      throw new Error("Ready state is available only before game start.");
    }

    const player = this.assertPlayer(playerId);
    if (player.isBot) {
      throw new Error("Bots do not toggle ready.");
    }
    if (!player.connected) {
      throw new Error("Disconnected player cannot toggle ready.");
    }

    player.ready = !player.ready;
    this.addLog(`${player.name} is ${player.ready ? "ready" : "not ready"}.`);
    this.emit();
  }

  addBot(playerId) {
    this.requireHost(playerId);
    if (this.gameStarted) {
      throw new Error("Cannot add bots after game start.");
    }
    if (this.players.length >= 6) {
      throw new Error("Room is full (max 6 players).");
    }

    const botId = `bot-${this.roomId}-${this.botCounter}`;
    this.botCounter += 1;

    this.players.push({
      id: botId,
      name: `Bot ${this.botCounter - 1}`,
      socket: null,
      ready: true,
      alive: true,
      role: null,
      connected: true,
      isBot: true,
    });

    this.addLog(`Bot ${this.botCounter - 1} joined.`);
    this.emit();
  }

  setRoleCount(playerId, role, count) {
    this.requireHost(playerId);
    if (this.gameStarted) {
      throw new Error("Cannot adjust roles after game start.");
    }

    const validRoles = [ROLE.KILLER, ROLE.WIZARD, ROLE.MEMBER];
    if (!validRoles.includes(role)) {
      throw new Error("Invalid role.");
    }

    const countNum = Number(count);
    if (countNum < 0 || countNum > 6) {
      throw new Error("Role count must be 0-6.");
    }

    this.roleCounts[role] = countNum;
    this.addLog(`Host adjusted ${role} count to ${countNum}.`);
    this.emit();
  }

  buildRolePool() {
    const pool = [];
    Object.entries(this.roleCounts).forEach(([role, count]) => {
      for (let i = 0; i < count; i += 1) {
        pool.push(role);
      }
    });
    return pool;
  }

  clearVoteTimer() {
    if (this.voting.timerHandle) {
      clearInterval(this.voting.timerHandle);
      this.voting.timerHandle = null;
    }
    this.voting.startedAt = null;
    this.voting.endsAt = null;
  }

  runBotNightActions() {
    if (this.phase !== PHASE.NIGHT || this.gameEnded) {
      return;
    }

    const killerBots = this.aliveBotsByRole(ROLE.KILLER);
    killerBots.forEach((killerBot) => {
      const targets = this.aliveTargetsForBots(
        new Set([killerBot.id]),
        ROLE.KILLER,
      );
      const target = this.pickRandomPlayer(targets);
      if (target) {
        this.night.killSelections.set(killerBot.id, target.id);
      }
    });

    const wizardBot = this.aliveBotsByRole(ROLE.WIZARD)[0] || null;
    if (!wizardBot || this.night.wizardUsedPower) {
      return;
    }

    const shouldHeal =
      !this.night.wizardHealUsedGame &&
      this.night.killSelections.size > 0 &&
      Math.random() < 0.4;

    if (shouldHeal) {
      this.night.wizardUsedPower = true;
      this.night.wizardHealUsedGame = true;
      this.night.killSelections = new Map();
      this.addLog("Wizard bot used heal.");
      return;
    }

    const inspectTargets = this.aliveTargetsForBots(new Set([wizardBot.id]));
    const inspectTarget = this.pickRandomPlayer(inspectTargets);
    if (inspectTarget) {
      this.night.wizardUsedPower = true;
      this.night.inspectedByWizard = {
        viewerId: wizardBot.id,
        targetId: inspectTarget.id,
        role: inspectTarget.role,
      };
      this.addLog("Wizard bot used inspect.");
    }
  }

  applyBotVotes() {
    if (this.phase !== PHASE.VOTING || this.gameEnded) {
      return;
    }

    const aliveBots = this.players.filter(
      (player) => player.isBot && player.alive,
    );
    aliveBots.forEach((bot) => {
      if (this.voting.votes.has(bot.id)) {
        return;
      }

      const skip = Math.random() < 0.3;
      if (skip) {
        this.voting.votes.set(bot.id, "skip");
        return;
      }

      const targets = this.aliveTargetsForBots(new Set([bot.id]));
      const target = this.pickRandomPlayer(targets);
      this.voting.votes.set(bot.id, target ? target.id : "skip");
    });
  }

  startGame(playerId) {
    this.requireHost(playerId);

    if (!this.canStartGame()) {
      throw new Error("All connected human players must be ready to start.");
    }

    this.fillBotsToSix();

    this.clearVoteTimer();
    this.gameStarted = true;
    this.phase = PHASE.SETUP;
    this.round = 0;
    this.logs = [];
    this.gameEnded = false;

    this.night = {
      wizardUsedPower: false,
      wizardHealUsedGame: false,
      killSelections: new Map(),
      inspectedByWizard: null,
    };

    this.voting = {
      votes: new Map(),
      startedAt: null,
      endsAt: null,
      timerHandle: null,
    };

    const roles = shuffle(this.buildRolePool());
    this.players.forEach((player, index) => {
      player.role = roles[index] || ROLE.MEMBER;
      player.alive = true;
      player.ready = false;
    });

    this.addLog("Game started. Roles assigned.");
    this.emit();
  }

  getAlivePlayers() {
    return this.players.filter((player) => player.alive);
  }

  getAliveByRole(role) {
    return this.players.filter(
      (player) => player.alive && player.role === role,
    );
  }

  evaluateWin() {
    const killers = this.getAliveByRole(ROLE.KILLER).length;
    const town = this.getAlivePlayers().length - killers;

    if (killers === 0) {
      this.phase = PHASE.ENDED;
      this.gameEnded = true;
      this.clearVoteTimer();
      this.addLog("Town wins.");
      return true;
    }

    if (killers >= town) {
      this.phase = PHASE.ENDED;
      this.gameEnded = true;
      this.clearVoteTimer();
      this.addLog("Killers win.");
      return true;
    }

    return false;
  }

  assertPlayer(playerId) {
    const player = this.players.find((entry) => entry.id === playerId);
    if (!player) {
      throw new Error("Player not found.");
    }
    return player;
  }

  startNight(playerId) {
    const player = this.assertPlayer(playerId);
    this.requireHost(playerId);
    if (!player.alive) {
      throw new Error("Dead players cannot start phase transitions.");
    }
    if (!this.gameStarted) {
      throw new Error("Game has not started yet.");
    }
    if (
      ![PHASE.SETUP, PHASE.DISCUSSION].includes(this.phase) ||
      this.gameEnded
    ) {
      throw new Error("Cannot start night now.");
    }

    this.clearVoteTimer();
    this.round += 1;
    this.phase = PHASE.NIGHT;
    this.night.wizardUsedPower = false;
    this.night.killSelections = new Map();
    this.night.inspectedByWizard = null;
    this.voting.votes = new Map();

    this.addLog(`Night ${this.round} started.`);
    this.runBotNightActions();
    this.emit();
  }

  killerKill(playerId, targetId) {
    const player = this.assertPlayer(playerId);
    const target = this.assertPlayer(targetId);

    if (this.phase !== PHASE.NIGHT || this.gameEnded) {
      throw new Error("Killer action is night-only.");
    }
    if (!player.alive || player.role !== ROLE.KILLER) {
      throw new Error("Only alive killers can kill.");
    }
    if (!target.alive || target.role === ROLE.KILLER) {
      throw new Error("Invalid kill target.");
    }

    this.night.killSelections.set(playerId, targetId);
    this.addLog(`${player.name} locked a night target.`);
    this.emit();
  }

  wizardInspect(playerId, targetId) {
    const player = this.assertPlayer(playerId);
    const target = this.assertPlayer(targetId);

    if (this.phase !== PHASE.NIGHT || this.gameEnded) {
      throw new Error("Wizard action is night-only.");
    }
    if (!player.alive || player.role !== ROLE.WIZARD) {
      throw new Error("Only alive wizard can inspect.");
    }
    if (this.night.wizardUsedPower) {
      throw new Error("Wizard already used power this night.");
    }
    if (!target.alive || target.id === player.id) {
      throw new Error("Invalid inspect target.");
    }

    this.night.wizardUsedPower = true;
    this.night.inspectedByWizard = {
      viewerId: playerId,
      targetId,
      role: target.role,
    };
    this.addLog("Wizard used inspect.");
    this.emit();
  }

  wizardHeal(playerId) {
    const player = this.assertPlayer(playerId);
    if (this.phase !== PHASE.NIGHT || this.gameEnded) {
      throw new Error("Wizard action is night-only.");
    }
    if (!player.alive || player.role !== ROLE.WIZARD) {
      throw new Error("Only alive wizard can heal.");
    }
    if (this.night.wizardUsedPower) {
      throw new Error("Wizard already used power this night.");
    }
    if (this.night.wizardHealUsedGame) {
      throw new Error("Wizard heal already used this game.");
    }

    this.night.wizardUsedPower = true;
    this.night.wizardHealUsedGame = true;
    this.night.killSelections = new Map();

    this.addLog("Wizard used heal.");
    this.emit();
  }

  endNight(playerId) {
    const player = this.assertPlayer(playerId);
    this.requireHost(playerId);
    if (!player.alive) {
      throw new Error("Dead players cannot end night.");
    }
    if (this.phase !== PHASE.NIGHT || this.gameEnded) {
      throw new Error("Cannot end night now.");
    }

    const targetId = majorityChoice([...this.night.killSelections.values()]);
    if (targetId) {
      const victim = this.players.find((entry) => entry.id === targetId);
      if (victim?.alive) {
        victim.alive = false;
        this.addLog(`${victim.name} died during the night.`);
      }
    } else {
      this.addLog("No night kill succeeded.");
    }

    this.night.killSelections = new Map();
    this.night.inspectedByWizard = null;

    if (this.evaluateWin()) {
      this.emit();
      return;
    }

    this.phase = PHASE.DISCUSSION;
    this.addLog("Discussion phase started.");
    this.emit();
  }

  startVote(playerId) {
    const player = this.assertPlayer(playerId);
    this.requireHost(playerId);
    if (!player.alive) {
      throw new Error("Dead players cannot start vote.");
    }
    if (this.phase !== PHASE.DISCUSSION || this.gameEnded) {
      throw new Error("Cannot start vote now.");
    }

    this.phase = PHASE.VOTING;
    this.voting.votes = new Map();
    this.voting.startedAt = Date.now();
    this.voting.endsAt = Date.now() + VOTE_SECONDS * 1000;

    this.clearVoteTimer();
    this.voting.startedAt = Date.now();
    this.voting.endsAt = Date.now() + VOTE_SECONDS * 1000;
    this.voting.timerHandle = setInterval(() => {
      if (!this.voting.endsAt) {
        return;
      }
      if (Date.now() >= this.voting.endsAt) {
        this.addLog("Vote timer expired. Resolving vote.");
        this.resolveVote(this.hostId || playerId, true);
      } else {
        this.emit();
      }
    }, 1000);

    this.addLog("Voting phase started.");
    this.applyBotVotes();
    this.emit();
  }

  castVote(playerId, targetIdOrSkip) {
    const player = this.assertPlayer(playerId);
    if (!player.alive || this.phase !== PHASE.VOTING || this.gameEnded) {
      throw new Error("Cannot vote now.");
    }

    if (targetIdOrSkip !== "skip") {
      const target = this.assertPlayer(targetIdOrSkip);
      if (!target.alive) {
        throw new Error("Cannot vote dead target.");
      }
    }

    this.voting.votes.set(playerId, targetIdOrSkip);
    this.addLog(`${player.name} cast a vote.`);
    this.emit();
  }

  resolveVote(playerId, fromTimer = false) {
    if (this.phase !== PHASE.VOTING || this.gameEnded) {
      return;
    }

    if (!fromTimer) {
      this.requireHost(playerId);
    }

    if (!fromTimer) {
      const player = this.assertPlayer(playerId);
      if (!player.alive) {
        throw new Error("Dead players cannot resolve vote.");
      }
    }

    this.clearVoteTimer();

    this.applyBotVotes();
    const choice = majorityChoice([...this.voting.votes.values()]);
    if (!choice || choice === "skip") {
      this.addLog("Vote result: skip.");
    } else {
      const target = this.players.find((entry) => entry.id === choice);
      if (target?.alive) {
        target.alive = false;
        this.addLog(`Vote result: ${target.name} eliminated.`);
      }
    }

    this.voting.votes = new Map();

    if (this.evaluateWin()) {
      this.emit();
      return;
    }

    this.phase = PHASE.DISCUSSION;
    this.addLog("Back to discussion.");
    this.emit();
  }

  sendChat(playerId, text) {
    const player = this.assertPlayer(playerId);
    const message = text?.trim();
    if (!message) {
      return;
    }
    this.addLog(`${player.name}: ${message}`);
    this.emit();
  }

  availableActionsFor(player) {
    if (!player || !player.alive || this.gameEnded) {
      return [];
    }

    const actions = [];

    if (!this.gameStarted) {
      actions.push("toggle_ready");
      if (player.id === this.hostId) {
        if (this.players.length < 6) {
          actions.push("add_bot");
        }
        if (this.canStartGame()) {
          actions.push("start_game");
        }
      }
      return actions;
    }

    if (
      player.id === this.hostId &&
      [PHASE.SETUP, PHASE.DISCUSSION].includes(this.phase)
    ) {
      actions.push("start_night");
    }
    if (player.id === this.hostId && this.phase === PHASE.NIGHT) {
      actions.push("end_night");
    }
    if (player.id === this.hostId && this.phase === PHASE.DISCUSSION) {
      actions.push("start_vote");
    }
    if (this.phase === PHASE.VOTING) {
      actions.push("vote_skip", "vote_target");
      if (player.id === this.hostId) {
        actions.push("resolve_vote");
      }
    }

    if (this.phase === PHASE.NIGHT) {
      if (player.role === ROLE.KILLER) {
        actions.push("killer_kill");
      }
      if (player.role === ROLE.WIZARD) {
        if (!this.night.wizardUsedPower) {
          actions.push("wizard_inspect");
          if (!this.night.wizardHealUsedGame) {
            actions.push("wizard_heal");
          }
        }
      }
    }

    if (
      [PHASE.DISCUSSION, PHASE.VOTING].includes(this.phase) &&
      player.role === ROLE.MEMBER
    ) {
      actions.push("member_accuse");
    }

    return actions;
  }

  serializeFor(playerId) {
    const viewer = this.players.find((entry) => entry.id === playerId) || null;
    const revealRoles = this.phase === PHASE.ENDED;

    const players = this.players.map((player) => ({
      id: player.id,
      name: player.name,
      ready: player.ready,
      alive: player.alive,
      connected: player.connected,
      isBot: !!player.isBot,
      role:
        revealRoles || player.id === playerId || !player.alive
          ? player.role
          : null,
    }));

    const wizardPrivateInspection =
      this.night.inspectedByWizard?.viewerId === playerId
        ? this.night.inspectedByWizard
        : null;

    return {
      roomId: this.roomId,
      hostId: this.hostId,
      gameStarted: this.gameStarted,
      phase: this.phase,
      round: this.round,
      gameEnded: this.gameEnded,
      players,
      logs: this.logs,
      timer: {
        active: this.phase === PHASE.VOTING,
        remaining: this.voting.endsAt
          ? Math.max(0, Math.ceil((this.voting.endsAt - Date.now()) / 1000))
          : 0,
      },
      voting: {
        votesCount: this.voting.votes.size,
        yourVote: this.voting.votes.get(playerId) || null,
      },
      lobby: {
        connectedCount: this.connectedCount(),
        connectedHumans: this.connectedHumans().length,
        botCount: this.players.filter((player) => player.isBot).length,
        allReady: this.allReady(),
        canStart: this.canStartGame(),
        roleCounts: this.roleCounts,
      },
      private: {
        playerId,
        role: viewer?.role || null,
        alive: viewer?.alive || false,
        isHost: viewer?.id === this.hostId,
        availableActions: this.availableActionsFor(viewer),
        wizardHealUsedGame: this.night.wizardHealUsedGame,
        wizardInspection: wizardPrivateInspection
          ? {
              targetId: wizardPrivateInspection.targetId,
              role: wizardPrivateInspection.role,
            }
          : null,
      },
    };
  }
}
