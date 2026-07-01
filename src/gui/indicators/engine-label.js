// 引擎 kind → 用户可见名称（SettingsPanel / AIProgressBar 共用）
export function engineKindLabel(kind) {
  if (kind === 'rapfi') return 'Rapfi 引擎';
  return '引擎不可用';
}
