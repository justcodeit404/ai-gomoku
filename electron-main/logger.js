// 轻量带前缀的 logger，给引擎桥接层用
function ts() {
  return new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
}

function format(prefix, args) {
  return [`[${ts()}] [${prefix}]`, ...args];
}

module.exports = {
  log: (...args) => console.log(...format('engine', args)),
  warn: (...args) => console.warn(...format('engine', args)),
  error: (...args) => console.error(...format('engine', args)),
};
