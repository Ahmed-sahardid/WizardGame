import { PHASE } from "./constants.js";

export function createInitialState() {
  return {
    players: [],
    phase: PHASE.SETUP,
    round: 0,
    localPlayerIndex: 0,
    selectedSeatIndex: null,
    currentVoteChoice: null,
    gameEnded: false,
    logs: [],
    timer: {
      remaining: 0,
      active: false,
    },
    night: {
      killTargetIndex: null,
      wizardUsedPower: false,
      wizardHealUsedGame: false,
      inspectedText: null,
    },
  };
}
