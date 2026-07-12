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

// ponytail: 7 字段原始比对替代 2 次 JSON.stringify,落子/AI 应手每个 action 都跑这
// 段——200+ 步对局能省 200 次字符串化。
const SETTINGS_KEYS = [
  'theme', 'aiFirst', 'timeLimit', 'forbiddenEnabled',
  'showMoveNumbers', 'soundEnabled', 'showHint',
];
const lastSettings = {};
const initialState = store.getState().game;
for (const k of SETTINGS_KEYS) lastSettings[k] = initialState[k];
store.subscribe(() => {
  const state = store.getState().game;
  let dirty = false;
  for (const k of SETTINGS_KEYS) {
    if (state[k] !== lastSettings[k]) {
      lastSettings[k] = state[k];
      dirty = true;
    }
  }
  if (dirty) saveSettings(lastSettings);
});

export default store;
