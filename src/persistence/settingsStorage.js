// 用户设置持久化：localStorage（渲染进程可用）

const KEY = 'gobang-settings';

const PERSISTED_KEYS = [
  'theme',
  'aiFirst',
  'timeLimit',
  'forbiddenEnabled',
  'showMoveNumbers',
  'soundEnabled',
  'showHint',
];

export function loadSettings() {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return PERSISTED_KEYS.reduce((acc, k) => {
      if (parsed[k] !== undefined) acc[k] = parsed[k];
      return acc;
    }, {});
  } catch (e) {
    return {};
  }
}

export function saveSettings(settings) {
  if (typeof window === 'undefined') return;
  try {
    const subset = PERSISTED_KEYS.reduce((acc, k) => {
      if (settings[k] !== undefined) acc[k] = settings[k];
      return acc;
    }, {});
    window.localStorage.setItem(KEY, JSON.stringify(subset));
  } catch (e) {
    // ignore
  }
}
