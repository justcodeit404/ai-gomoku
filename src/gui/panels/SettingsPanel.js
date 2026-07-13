import React from 'react';
import { useDispatch, useSelector, shallowEqual } from 'react-redux';
import { Switch, Select } from 'antd';
import {
  setAiFirst, setForbidden, setShowMoveNumbers, setSoundEnabled, setShowHint, setTheme, setDebug,
} from '../../store/gameSlice';
import { engineKindLabel } from '../indicators/engine-label';
import { STATUS } from '../../status';

function SettingsPanel({ embedded = false }) {
  const dispatch = useDispatch();
  const data = useSelector(s => ({
    aiFirst: s.game.aiFirst,
    forbiddenEnabled: s.game.forbiddenEnabled,
    showMoveNumbers: s.game.showMoveNumbers,
    soundEnabled: s.game.soundEnabled,
    showHint: s.game.showHint,
    theme: s.game.theme,
    debug: s.game.debug,
    engineKind: s.game.engine.kind,
    engineBundled: s.game.engine.bundled,
    engineBinary: s.game.engine.binary,
    status: s.game.status,
    editing: s.game.editing,
  }), shallowEqual);
  const canChangeAiFirst = data.status === STATUS.IDLE && !data.editing;

  return (
    <div className={embedded ? 'settings-embedded' : 'panel-card'} style={embedded ? undefined : { flex: 1, minHeight: 0 }}>
      {!embedded && <div className="panel-card-title">设置</div>}
      <div className="settings-list">
        <div className="setting-row" title={canChangeAiFirst ? '' : '对局进行中或摆棋编辑中，请在未开始时切换'}>
          <span>AI 先手</span>
          <Switch checked={data.aiFirst} onChange={v => dispatch(setAiFirst(v))} disabled={!canChangeAiFirst} />
        </div>
        <div className="setting-row" title={data.editing ? '摆棋编辑中不可改' : ''}>
          <span>禁手规则</span>
          <Switch checked={data.forbiddenEnabled} onChange={v => dispatch(setForbidden(v))} disabled={data.editing} />
        </div>
        <div className="setting-row">
          <span>显示步数</span>
          <Switch checked={data.showMoveNumbers} onChange={v => dispatch(setShowMoveNumbers(v))} disabled={data.editing} />
        </div>
        <div className="setting-row">
          <span>音效</span>
          <Switch checked={data.soundEnabled} onChange={v => dispatch(setSoundEnabled(v))} />
        </div>
        <div className="setting-row">
          <span>AI 提示</span>
          <Switch checked={data.showHint} onChange={v => dispatch(setShowHint(v))} disabled={data.editing} />
        </div>
        <div className="setting-row">
          <span>主题</span>
          <Select
            value={data.theme}
            onChange={v => dispatch(setTheme(v))}
            options={[
              { value: 'light', label: '简约浅色' },
              { value: 'dark', label: '简约深色' },
              { value: 'wood', label: '暖木' },
            ]}
          />
        </div>
        <div className="setting-row" style={{ color: '#888', fontSize: 12 }}>
          <span>引擎</span>
          <span style={{ fontWeight: 500 }}>{engineKindLabel(data.engineKind)}</span>
        </div>
        {data.engineBundled && data.engineBinary && (
          <div className="setting-row" style={{ color: '#aaa', fontSize: 11, fontFamily: 'monospace' }}>
            <span>二进制</span>
            <span title={data.engineBinary}>{data.engineBinary.split(/[\\/]/).pop()}</span>
          </div>
        )}
        <div className="setting-row">
          <span>调试信息</span>
          <Switch checked={data.debug} onChange={v => dispatch(setDebug(v))} />
        </div>
      </div>
    </div>
  );
}

export default SettingsPanel;
