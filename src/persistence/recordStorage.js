// 保存棋谱：调用主进程 dialog.showSaveDialog 落盘。
// 调用方只需传 gameState 切片,helper 负责序列化 + 默认文件名 + 错误提示。
import { message } from 'antd';
import { buildGameRecord } from '../game';

const appAPI = (typeof window !== 'undefined' && window.appAPI) || null;

export async function saveGameRecord(gameState) {
  if (!appAPI) {
    message.error('保存接口不可用', 2);
    return;
  }
  const record = buildGameRecord(gameState);
  const defaultName = `棋谱-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
  try {
    const result = await appAPI.saveRecord(JSON.stringify(record, null, 2), defaultName);
    if (result?.canceled) return;
    message.success('棋谱已保存', 2);
  } catch (e) {
    message.error(`保存失败：${e.message}`, 2);
  }
}
