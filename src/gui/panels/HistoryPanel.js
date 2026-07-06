import React, { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Button, List, Modal, message } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import { restoreGame } from '../../store/gameSlice';
import { formatGameRecord } from '../../game';

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function HistoryPanel() {
  const dispatch = useDispatch();
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(null);
  const status = useSelector((s) => s.game.status);

  const appAPI = (typeof window !== 'undefined' && window.appAPI) || null;

  useEffect(() => {
    const load = async () => {
      if (!appAPI) return;
      setLoading(true);
      try {
        const result = await appAPI.historyList();
        setRecords(result?.records || []);
      } catch (e) {
        message.error('读取历史失败', 2);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [appAPI]);

  const onDelete = async (id, e) => {
    e.stopPropagation();
    if (!appAPI) return;
    try {
      await appAPI.historyDelete(id);
      setRecords((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      message.error('删除失败', 2);
    }
  };

  const onRestore = (record) => {
    const history = (record.history || []).map((h) => ({
      i: h.i,
      j: h.j,
      role: h.role === 'black' ? 1 : -1,
      elapsedMs: h.elapsedMs || 0,
    }));
    dispatch(restoreGame({
      board_size: record.size || 15,
      history,
      currentPlayer: history.length % 2 === 0 ? 1 : -1,
      timeLimit: 5000,
      forbiddenEnabled: !!record.forbiddenEnabled,
      aiFirst: !!record.aiFirst,
      triggerAiMove: false,
    }));
    setSelected(null);
  };

  if (!appAPI) return null;

  return (
    <div className="panel-card" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div className="panel-card-title">对局历史</div>
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        <List
          size="small"
          loading={loading}
          dataSource={records}
          locale={{ emptyText: '暂无历史对局' }}
          renderItem={(item) => (
            <List.Item
              className="history-item"
              onClick={() => setSelected(item)}
              actions={[
                <Button size="small" icon={<DeleteOutlined />} onClick={(e) => onDelete(item.id, e)} />,
              ]}
            >
              <List.Item.Meta
                title={
                  <span className="history-item-meta">
                    {formatTime(item.savedAt)} · {item.size || 15}路 · {item.history?.length || 0}步
                  </span>
                }
                description={
                  <span className="history-item-result">
                    {item.winner === 1 ? '黑胜' : item.winner === -1 ? '白胜' : '未分胜负'}
                  </span>
                }
              />
            </List.Item>
          )}
        />
      </div>

      <Modal
        title="复盘确认"
        open={!!selected}
        onOk={() => selected && onRestore(selected)}
        onCancel={() => setSelected(null)}
        okText="复盘"
        cancelText="取消"
        centered
        okButtonProps={{ disabled: status !== 'idle' }}
      >
        <p>确定要复盘这条历史记录吗？</p>
        {selected && (
          <div style={{ fontSize: 12, color: '#666', lineHeight: 1.6 }}>
            <div>时间：{formatTime(selected.savedAt)}</div>
            <div>步数：{selected.history?.length || 0}</div>
            <div>结果：{selected.winner === 1 ? '黑胜' : selected.winner === -1 ? '白胜' : '未分胜负'}</div>
            <div style={{ marginTop: 8, wordBreak: 'break-all' }}>
              {formatGameRecord((selected.history || []).map((h) => ({ i: h.i, j: h.j, role: h.role === 'black' ? 1 : -1 })))}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

export default HistoryPanel;
