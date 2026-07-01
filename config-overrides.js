module.exports = function override(config, env) {
  // 已移除 worker-loader：Yixin 是唯一引擎，不再需要 JS AI worker
  return config;
};
