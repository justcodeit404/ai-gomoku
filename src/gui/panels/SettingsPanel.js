import React from 'react';
import { useDispatch, useSelector, shallowEqual } from 'react-redux';
import { Switch, Select } from 'antd';
import {
  setAiFirst, setTimeLimit, setForbidden, setShowMoveNumbers, setSoundEnabled, setShowHint, setTheme, setDebug,
} from '../../store/gameSlice';
import { engineKindLabel } from '../indicators/engine-label';
import { STATUS } from '../../status';

function SettingsPanel() {
  const dispatch = useDispatch();
  const data = useSelector(s => ({
    aiFirst: s.game.aiFirst,
    timeLimit: s.game.timeLimit,
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
  }), shallowEqual);
  const canChangeAiFirst = data.status === STATUS.IDLE;

  return (
    <div className="panel-card" style={{ flex: 1, minHeight: 0 }}>
      <div className="panel-card-title">设置</div>
      <div className="settings-list">
        <div className="setting-row" title={canChangeAiFirst ? '' : '对局进行中，请在未开始时切换'}>
          <span>AI 先手</span>
          <Switch checked={data.aiFirst} onChange={v => dispatch(setAiFirst(v))} disabled={!canChangeAiFirst} />
        </div>
        <div className="setting-row">
          <span>每步限时</span>
          <Select
            value={String(data.timeLimit)}
            onChange={v => dispatch(setTimeLimit(v))}
            options={[
              { value: '1000', label: '1秒' },
              { value: '3000', label: '3秒' },
              { value: '5000', label: '5秒' },
              { value: '10000', label: '10秒' },
              { value: '30000', label: '30秒' },
            ]}
          />
        </div>
        <div className="setting-row">
          <span>禁手规则</span>
          <Switch checked={data.forbiddenEnabled} onChange={v => dispatch(setForbidden(v))} />
        </div>
        <div className="setting-row">
          <span>显示步数</span>
          <Switch checked={data.showMoveNumbers} onChange={v => dispatch(setShowMoveNumbers(v))} />
        </div>
        <div className="setting-row">
          <span>音效</span>
          <Switch checked={data.soundEnabled} onChange={v => dispatch(setSoundEnabled(v))} />
        </div>
        <div className="setting-row">
          <span>AI 提示</span>
          <Switch checked={data.showHint} onChange={v => dispatch(setShowHint(v))} />
        </div>
        <div className="setting-row">
          <span>主题</span>
          <Select
            value={data.theme}
            onChange={v => dispatch(setTheme(v))}
            options={[
              { value: 'light', label: '明亮' },
              { value: 'dark', label: '深色' },
              { value: 'wood', label: '木纹' },
            ]}
          />
        </div>
        <div className="setting-row" style={{ color: '#888', fontSize: 12 }} title="每步独立限时，全局包时不启用">
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
