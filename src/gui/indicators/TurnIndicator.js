import React from 'react';
import { useSelector } from 'react-redux';
import { STATUS } from '../../status';
import { TimeClock, useCountdowns } from './TimeClock';

function PlayerCard({ role, name, timeMs, isActive, isHuman, isIdle }) {
  return (
    <div className={`player-card ${role === 1 ? 'black' : 'white'} ${isActive ? 'active' : ''}`}>
      <div className={`player-avatar ${role === 1 ? 'black' : 'white'}`} />
      <div className="player-info">
        <div className="player-name">
          {name}
          {isActive && <span className="player-role">轮到</span>}
          {isHuman && <span className="player-role human">你</span>}
        </div>
        <TimeClock timeMs={timeMs} isActive={isActive} isIdle={isIdle} />
      </div>
    </div>
  );
}

function TurnIndicator() {
  const { currentPlayer, status, aiFirst } = useSelector(s => ({
    currentPlayer: s.game.currentPlayer,
    status: s.game.status,
    aiFirst: s.game.aiFirst,
  }));
  const { black, white } = useCountdowns();

  const isGaming = status === STATUS.GAMING;
  const isIdle = status === STATUS.IDLE;
  const blackName = aiFirst ? 'AI' : '你';
  const whiteName = aiFirst ? '你' : 'AI';

  return (
    <div className="panel-card combat-status">
      <div className="panel-card-title">对局</div>
      <div className="player-list">
        <PlayerCard
          role={1} name={blackName} timeMs={black}
          isActive={isGaming && currentPlayer === 1}
          isHuman={!aiFirst} isIdle={isIdle}
        />
        <PlayerCard
          role={-1} name={whiteName} timeMs={white}
          isActive={isGaming && currentPlayer === -1}
          isHuman={aiFirst} isIdle={isIdle}
        />
      </div>
    </div>
  );
}

export default TurnIndicator;
