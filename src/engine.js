import { PHASE, ROLE, VOTE_SECONDS } from "./constants.js";
import { createInitialState } from "./state.js";
import { pickRandom, shuffle } from "./utils.js";

export class GameEngine {
  constructor() {
    this.state = createInitialState();
    this.timerId = null;
    this.onChange = () => {};
  }

  setChangeHandler(handler) {
    this.onChange = handler;
  }

  emit() {
    this.onChange(this.state);
  }

  addLog(message) {
    this.state.logs.unshift(message);
    if (this.state.logs.length > 80) {
      this.state.logs.pop();
    }
  }

  getLocalPlayer() {
    return this.state.players[this.state.localPlayerIndex] ?? null;
  }

  alivePlayers() {
    return this.state.players.filter((player) => player.alive);
  }

  aliveByRole(role) {
    return this.state.players.filter(
      (player) => player.alive && player.role === role,
    );
  }

  canUseRolePower() {
    const local = this.getLocalPlayer();
    return (
      !!local?.alive &&
      this.state.phase === PHASE.NIGHT &&
      !this.state.night.wizardUsedPower
    );
  }

  startNewGame() {
    this.clearTimer();

    const roles = shuffle([
      ROLE.KILLER,
      ROLE.KILLER,
      ROLE.WIZARD,
      ROLE.MEMBER,
      ROLE.MEMBER,
      ROLE.MEMBER,
    ]);

    this.state = createInitialState();
    this.state.players = roles.map((role, index) => ({
      id: index + 1,
      name: `Player ${index + 1}`,
      role,
      alive: true,
    }));

    this.state.localPlayerIndex = Math.floor(
      Math.random() * this.state.players.length,
    );
    this.addLog("New game started with role-exclusive mechanics.");
    this.addLog(`You are ${this.getLocalPlayer()?.name}.`);
    this.emit();
  }

  clearTimer() {
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
    this.state.timer.active = false;
    this.state.timer.remaining = 0;
  }

  startVoteTimer() {
    this.clearTimer();
    this.state.timer.active = true;
    this.state.timer.remaining = VOTE_SECONDS;

    this.timerId = setInterval(() => {
      this.state.timer.remaining -= 1;
      if (this.state.timer.remaining <= 0) {
        this.addLog("Voting time ended. Auto-resolving vote.");
        this.resolveVote();
        return;
      }
      this.emit();
    }, 1000);
  }

  evaluateWin() {
    const killers = this.aliveByRole(ROLE.KILLER).length;
    const town = this.alivePlayers().length - killers;

    if (killers === 0) {
      this.state.phase = PHASE.ENDED;
      this.state.gameEnded = true;
      this.clearTimer();
      this.addLog("Town wins: all killers eliminated.");
      return true;
    }

    if (killers >= town) {
      this.state.phase = PHASE.ENDED;
      this.state.gameEnded = true;
      this.clearTimer();
      this.addLog("Killers win: parity reached.");
      return true;
    }

    return false;
  }

  startNight() {
    if (
      this.state.gameEnded ||
      ![PHASE.SETUP, PHASE.DISCUSSION].includes(this.state.phase)
    ) {
      return;
    }

    this.clearTimer();
    this.state.round += 1;
    this.state.phase = PHASE.NIGHT;
    this.state.selectedSeatIndex = null;
    this.state.currentVoteChoice = null;
    this.state.night.wizardUsedPower = false;
    this.state.night.inspectedText = null;

    const eligibleTargets = this.state.players
      .map((player, index) => ({ player, index }))
      .filter(
        (entry) => entry.player.alive && entry.player.role !== ROLE.KILLER,
      )
      .map((entry) => entry.index);

    this.state.night.killTargetIndex = pickRandom(eligibleTargets);
    this.addLog(`Night ${this.state.round} started.`);
    this.emit();
  }

  endNight() {
    if (this.state.phase !== PHASE.NIGHT || this.state.gameEnded) {
      return;
    }

    if (this.state.night.killTargetIndex !== null) {
      const victim = this.state.players[this.state.night.killTargetIndex];
      victim.alive = false;
      this.addLog(`${victim.name} was killed tonight.`);
    } else {
      this.addLog("No one died tonight.");
    }

    this.state.night.killTargetIndex = null;
    this.state.selectedSeatIndex = null;

    if (this.evaluateWin()) {
      this.emit();
      return;
    }

    this.state.phase = PHASE.DISCUSSION;
    this.addLog("Discussion phase started.");
    this.emit();
  }

  startVote() {
    if (this.state.phase !== PHASE.DISCUSSION || this.state.gameEnded) {
      return;
    }

    this.state.phase = PHASE.VOTING;
    this.state.currentVoteChoice = "skip";
    this.addLog("Voting phase started.");
    this.startVoteTimer();
    this.emit();
  }

  resolveVote() {
    if (this.state.phase !== PHASE.VOTING || this.state.gameEnded) {
      return;
    }

    this.clearTimer();

    if (
      this.state.currentVoteChoice === "skip" ||
      this.state.currentVoteChoice === null
    ) {
      this.addLog("Vote result: skipped.");
    } else {
      const target = this.state.players[this.state.currentVoteChoice];
      if (target?.alive) {
        target.alive = false;
        this.addLog(`Vote result: ${target.name} eliminated (${target.role}).`);
      }
    }

    this.state.currentVoteChoice = null;
    this.state.selectedSeatIndex = null;

    if (this.evaluateWin()) {
      this.emit();
      return;
    }

    this.state.phase = PHASE.DISCUSSION;
    this.emit();
  }

  setVoteSkip() {
    if (this.state.phase !== PHASE.VOTING || this.state.gameEnded) {
      return;
    }
    this.state.currentVoteChoice = "skip";
    this.addLog("Vote set to skip.");
    this.emit();
  }

  chooseSeat(index) {
    const player = this.state.players[index];
    if (!player || !player.alive || this.state.gameEnded) {
      return;
    }

    this.state.selectedSeatIndex = index;

    if (this.state.phase === PHASE.VOTING) {
      this.state.currentVoteChoice = index;
      this.addLog(`Vote target selected: ${player.name}.`);
    }

    this.emit();
  }

  killerConfirmKill() {
    const local = this.getLocalPlayer();
    if (
      !local?.alive ||
      local.role !== ROLE.KILLER ||
      this.state.phase !== PHASE.NIGHT
    ) {
      return;
    }

    const selected = this.state.selectedSeatIndex;
    if (selected === null) {
      this.addLog("Killer action requires selecting a target seat.");
      this.emit();
      return;
    }

    const target = this.state.players[selected];
    if (!target.alive || target.role === ROLE.KILLER) {
      this.addLog("Killers can only target alive non-killers.");
      this.emit();
      return;
    }

    this.state.night.killTargetIndex = selected;
    this.addLog(`Killer selected ${target.name} as target.`);
    this.emit();
  }

  wizardInspectSelected() {
    const local = this.getLocalPlayer();
    if (
      !local?.alive ||
      local.role !== ROLE.WIZARD ||
      !this.canUseRolePower()
    ) {
      return;
    }

    const selected = this.state.selectedSeatIndex;
    if (selected === null || selected === this.state.localPlayerIndex) {
      this.addLog("Wizard inspect requires selecting another player.");
      this.emit();
      return;
    }

    const target = this.state.players[selected];
    if (!target.alive) {
      this.addLog("Wizard can only inspect alive players.");
      this.emit();
      return;
    }

    this.state.night.wizardUsedPower = true;
    this.state.night.inspectedText = `${target.name} is ${target.role}.`;
    this.addLog(`Wizard reveal: ${this.state.night.inspectedText}`);
    this.emit();
  }

  wizardHealTonight() {
    const local = this.getLocalPlayer();
    if (
      !local?.alive ||
      local.role !== ROLE.WIZARD ||
      !this.canUseRolePower()
    ) {
      return;
    }

    if (this.state.night.wizardHealUsedGame) {
      this.addLog("Wizard heal already used in this game.");
      this.emit();
      return;
    }

    if (this.state.night.killTargetIndex === null) {
      this.addLog("No pending night victim to heal.");
      this.emit();
      return;
    }

    const saved = this.state.players[this.state.night.killTargetIndex];
    this.state.night.killTargetIndex = null;
    this.state.night.wizardUsedPower = true;
    this.state.night.wizardHealUsedGame = true;
    this.addLog(`Wizard healed ${saved.name}.`);
    this.emit();
  }

  memberAccuseSelected() {
    const local = this.getLocalPlayer();
    if (!local?.alive || local.role !== ROLE.MEMBER) {
      return;
    }

    if (![PHASE.DISCUSSION, PHASE.VOTING].includes(this.state.phase)) {
      return;
    }

    const selected = this.state.selectedSeatIndex;
    if (selected === null) {
      this.addLog("Member accuse requires selecting a seat.");
      this.emit();
      return;
    }

    const target = this.state.players[selected];
    if (!target.alive) {
      this.addLog("Cannot accuse a dead player.");
      this.emit();
      return;
    }

    this.state.currentVoteChoice = selected;
    this.addLog(`Member accusation: ${target.name}`);
    this.emit();
  }

  sendChat(message) {
    const text = message.trim();
    if (!text) {
      return;
    }
    this.addLog(`You: ${text}`);
    this.emit();
  }
}
