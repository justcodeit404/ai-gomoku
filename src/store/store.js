import { configureStore } from '@reduxjs/toolkit';
import gameReducer, { initialState as gameInitialState } from './gameSlice';
import { loadSettings, saveSettings } from '../persistence/settingsStorage';

const persisted = loadSettings();
const preloadedState = {
  game: {
    ...gameInitialState,
    ...persisted,
  },
};

const store = configureStore({
  reducer: {
    game: gameReducer,
  },
  preloadedState,
});

let lastSettings = {};
store.subscribe(() => {
  const state = store.getState();
  const settings = {
    theme: state.game.theme,
    aiFirst: state.game.aiFirst,
    timeLimit: state.game.timeLimit,
    forbiddenEnabled: state.game.forbiddenEnabled,
    showMoveNumbers: state.game.showMoveNumbers,
    soundEnabled: state.game.soundEnabled,
    showHint: state.game.showHint,
  };
  if (JSON.stringify(settings) !== JSON.stringify(lastSettings)) {
    lastSettings = settings;
    saveSettings(settings);
  }
});

export default store;
