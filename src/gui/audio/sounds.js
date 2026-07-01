// Web Audio API 合成音效，无外部音频文件依赖
// ponytail: 使用简单振荡器，音质一般但零资源占用

const ctx = (typeof window !== 'undefined' && window.AudioContext)
  ? new window.AudioContext()
  : null;

let enabled = true;

export function setSoundEnabled(value) {
  enabled = !!value;
}

function resumeIfNeeded() {
  if (!ctx) return false;
  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }
  return enabled;
}

// 落子音：短促木鱼感
export function playMoveSound() {
  if (!resumeIfNeeded()) return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(880, t);
  osc.frequency.exponentialRampToValueAtTime(440, t + 0.06);
  gain.gain.setValueAtTime(0.2, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 0.1);
}

// 胜利音：上行双音
export function playWinSound() {
  if (!resumeIfNeeded()) return;
  const t = ctx.currentTime;
  [523.25, 659.25, 783.99].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, t + i * 0.08);
    gain.gain.setValueAtTime(0, t + i * 0.08);
    gain.gain.linearRampToValueAtTime(0.2, t + i * 0.08 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.08 + 0.35);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t + i * 0.08);
    osc.stop(t + i * 0.08 + 0.4);
  });
}
