import React, { useRef, useEffect, useState } from 'react';
import { normalizeWeapon } from '../utils/weapons';

interface RoundData {
  number: number;
  tick: number;
  freeze_time_tick?: number;
  ct_score?: number; // cumulative CT score after this round (if parser provides it)
  t_score?: number; // cumulative T score after this round (if parser provides it)
}

interface KillEvent {
  tick: number;
  killer_id: number;
  victim_id: number;
  assister_id?: number;
  is_headshot: boolean;
  weapon: string;
}

interface RoundTimelineProps {
  rounds: RoundData[];
  currentTick: number;
  frames: any[];
  onSeek: (frameIndex: number) => void;
  kills: KillEvent[];
  selectedPlayerId: number | null;
  isPlaying?: boolean;
  onTogglePlay?: () => void;
  tickRate?: number;
  originalTickRate?: number;
  playbackSpeed?: number;
  onSpeedChange?: (speed: number) => void;
}

const RoundTimeline: React.FC<RoundTimelineProps> = ({ 
  rounds, currentTick, frames, onSeek, kills, selectedPlayerId, isPlaying = false, onTogglePlay, tickRate = 64, originalTickRate = 64, playbackSpeed = 1.0, onSpeedChange
}) => {
  const [roundsScrollPos, setRoundsScrollPos] = useState(0);
  const roundListRef = useRef<HTMLDivElement>(null);

  if (!rounds || rounds.length === 0 || !frames || frames.length === 0) return null;

  const currentFrame = frames[currentTick];
  const currentIngameTick = currentFrame?.tick || 0;
  
  // Compute per-round winners from cumulative scores (safe if parser provides ct_score/t_score)
  const roundWinners: Record<number, 'CT' | 'T' | undefined> = {};
  for (let i = 0; i < rounds.length; i++) {
    const cur = rounds[i] as any;
    const prev = rounds[i - 1] as any || { ct_score: 0, t_score: 0 };
    const ctDelta = (cur.ct_score || 0) - (prev.ct_score || 0);
    const tDelta = (cur.t_score || 0) - (prev.t_score || 0);
    if (ctDelta > tDelta) roundWinners[cur.number] = 'CT';
    else if (tDelta > ctDelta) roundWinners[cur.number] = 'T';
    else roundWinners[cur.number] = undefined;
  }

  let activeRoundIdx = 0;
  for (let i = rounds.length - 1; i >= 0; i--) {
    if (currentIngameTick >= rounds[i].tick) {
      activeRoundIdx = i;
      break;
    }
  }
  const activeRound = rounds[activeRoundIdx];
  const nextRoundTick = rounds[activeRoundIdx + 1]?.tick || frames[frames.length - 1].tick;

  // Treat round start as the end of freeze (active-only timeline)
  const activeRoundStartTick = activeRound.freeze_time_tick || activeRound.tick;
  const roundDurationTicks = Math.max(1, nextRoundTick - activeRoundStartTick);
  const currentRoundProgress = Math.max(0, Math.min(1, (currentIngameTick - activeRoundStartTick) / roundDurationTicks));

  // Filter kills for this round (active play only — freeze time removed)
  const roundKills = kills.filter(k => k.tick >= activeRoundStartTick && k.tick < nextRoundTick);
  
  // Events for selected player if any, otherwise all kills
  const playerEvents = selectedPlayerId 
    ? roundKills.filter(k => k.killer_id === selectedPlayerId || k.victim_id === selectedPlayerId)
    : roundKills;

  // Find bomb plant tick in this round (active-only)
  let bombPlantTick: number | null = null;
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    if (frame.tick >= activeRoundStartTick && frame.tick < nextRoundTick) {
      // Check if bomb became planted
      const prevFrame = i > 0 ? frames[i - 1] : null;
      if (frame.bomb?.is_planted && (!prevFrame?.bomb?.is_planted)) {
        bombPlantTick = frame.tick;
        break;
      }
    } else if (frame.tick >= nextRoundTick) {
      break;
    }
  }

  const bombPlantProgress = bombPlantTick 
    ? (bombPlantTick - activeRoundStartTick) / roundDurationTicks 
    : null;

  // Freeze time removed — timeline shows active play only

  const handleRoundClick = (round: RoundData) => {
    // Seek to the active round start (skip freeze if present)
    const targetTick = round.freeze_time_tick || round.tick;
    const frameIndex = frames.findIndex(f => f.tick >= targetTick);
    if (frameIndex !== -1) {
      onSeek(frameIndex);
    }
  };

  const handleRoundScroll = () => {
    if (roundListRef.current) {
      setRoundsScrollPos(roundListRef.current.scrollLeft);
    }
  };

  const scroll = (direction: 'left' | 'right') => {
    if (roundListRef.current) {
      const scrollAmount = 200;
      roundListRef.current.scrollBy({
        left: direction === 'left' ? -scrollAmount : scrollAmount,
        behavior: 'smooth'
      });
    }
  };

  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    const targetTick = activeRoundStartTick + (percent * roundDurationTicks);
    
    // Find closest frame index
    let low = 0;
    let high = frames.length - 1;
    let bestIndex = 0;
    
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (frames[mid].tick < targetTick) {
        bestIndex = mid;
        low = mid + 1;
      } else if (frames[mid].tick > targetTick) {
        high = mid - 1;
      } else {
        bestIndex = mid;
        break;
      }
    }
    onSeek(bestIndex);
  };

  // Format time from ticks to MM:SS
  // ticks are in original demo tick space, so use originalTickRate
  const formatTime = (ticks: number) => {
    const seconds = Math.floor(ticks / originalTickRate);
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const elapsedTicks = Math.max(0, currentIngameTick - activeRoundStartTick);
  const remainingTicks = Math.max(0, roundDurationTicks - elapsedTicks);
  const currentRoundTime = formatTime(remainingTicks);

  return (
    <div style={{ 
      width: '100%', 
      background: 'var(--bg-secondary)',
      borderTop: '1px solid var(--border-color)',
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* Round Selector Section */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0',
        padding: '10px 0',
        borderBottom: '1px solid var(--border-color)',
        height: '48px'
      }}>
        {/* Left Arrow */}
        <button
          onClick={() => scroll('left')}
          className="arrow-btn"
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '0 15px',
            fontSize: '0.9rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            transition: 'color 0.2s ease'
          }}
        >
          ‹
        </button>

        {/* Round List */}
        <div
          ref={roundListRef}
          onScroll={handleRoundScroll}
          style={{
            display: 'flex',
            gap: '4px',
            overflow: 'hidden',
            flex: 1,
            paddingBottom: '2px'
          }}
        >
          {(() => {
            // mark pre-game rounds (display number <= 0) and insert a visual divider
            const firstMainIdx = rounds.findIndex(r => r.number >= 1);

            return rounds.map((round, idx) => {
              const isActive = activeRound.number === round.number;
              const winner = roundWinners[round.number];
              const isPreGame = (round.number || 0) <= 0;

              const classes = ["round-button", "large"];
              if (isActive) classes.push("active");
              if (winner === "CT") classes.push("winner-ct");
              if (winner === "T") classes.push("winner-t");
              if (isPreGame) classes.push("pre-game");

              return (
                <React.Fragment key={`round-${idx}`}>
                  {idx === firstMainIdx && (
                    <div className="round-divider" aria-hidden="true" />
                  )}

                  <button
                    className={classes.join(" ")}
                    onClick={() => handleRoundClick(round)}
                    title={winner ? `${winner} won round ${isPreGame ? 'PRE' : round.number}` : (isPreGame ? 'Pre-game round' : undefined)}
                  >
                    {isPreGame ? 'PRE' : round.number}
                  </button>
                </React.Fragment>
              );
            });
          })()}
        </div>

        {/* Right Arrow */}
        <button
          onClick={() => scroll('right')}
          className="arrow-btn"
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '0 15px',
            fontSize: '0.9rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            transition: 'color 0.2s ease'
          }}
        >
          ›
        </button>
      </div>

      {/* Playback & Timeline Section */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '15px',
        padding: '10px 20px',
        height: '60px'
      }}>
        {/* Play Button */}
        {onTogglePlay && (
          <button
            onClick={onTogglePlay}
            className="play-btn"
            style={{
              background: 'var(--accent-ct)',
              border: 'none',
              color: 'white',
              width: '32px',
              height: '32px',
              borderRadius: '50%',
              cursor: 'pointer',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              fontSize: '0.9rem',
              transition: 'all 0.2s ease',
              flexShrink: 0
            }}
          >
            {isPlaying ? '⏸️' : '▶️'}
          </button>
        )}

        {/* Speed Controls */}
        {onSpeedChange && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontWeight: 600, whiteSpace: 'nowrap' }}>SPEED</span>
            <div style={{ display: 'flex', background: 'rgba(0,0,0,0.3)', borderRadius: '4px', padding: '2px', border: '1px solid var(--border-color)' }}>
              {[0.25, 0.5, 1, 2, 4].map(speed => (
                <button
                  key={speed}
                  onClick={() => onSpeedChange(speed)}
                  style={{
                    padding: '4px 6px',
                    background: playbackSpeed === speed ? 'var(--accent-ct)' : 'transparent',
                    border: 'none',
                    color: 'white',
                    borderRadius: '3px',
                    cursor: 'pointer',
                    fontSize: '0.65rem',
                    fontWeight: playbackSpeed === speed ? 'bold' : 'normal',
                    transition: 'all 0.2s ease'
                  }}
                >
                  {speed}x
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Time Display */}
        <div style={{
          fontSize: '0.8rem',
          fontFamily: 'monospace',
          color: 'var(--text-secondary)',
          minWidth: '50px',
          fontWeight: 600
        }}>
          {currentRoundTime}
        </div>

        {/* Timeline Bar */}
        <div
          onClick={handleTimelineClick}
          style={{
            flex: 1,
            height: '30px',
            background: 'rgba(255,255,255,0.05)',
            borderRadius: '4px',
            cursor: 'pointer',
            position: 'relative',
            border: '1px solid rgba(255,255,255,0.1)',
            overflow: 'hidden'
          }}
        >
          {/* Progress Bar */}
          <div style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: `${Math.min(100, Math.max(0, currentRoundProgress * 100))}%`,
            background: 'var(--accent-ct)',
            borderRadius: '4px'
          }} />



          {/* Bomb Plant Overlay (Red) */}
          {bombPlantProgress !== null && (
            <div style={{
              position: 'absolute',
              left: `${bombPlantProgress * 100}%`,
              right: 0,
              top: 0,
              bottom: 0,
              background: 'rgba(255, 0, 0, 0.3)',
              borderRadius: '0 4px 4px 0',
              zIndex: 1,
              pointerEvents: 'none'
            }} />
          )}

          {/* Current Position Marker */}
          <div style={{
            position: 'absolute',
            left: `${Math.min(100, Math.max(0, currentRoundProgress * 100))}%`,
            top: '-2px',
            width: '2px',
            height: '34px',
            background: 'white',
            borderRadius: '2px',
            transform: 'translateX(-50%)',
            boxShadow: '0 0 4px rgba(255,255,255,0.5)',
            zIndex: 5
          }} />

          {/* Kill Markers */}
          {selectedPlayerId ? (
            // Player selected: show kill/death events for that player
            playerEvents.map((event, i) => {
              const isKiller = event.killer_id === selectedPlayerId;
              const progress = (event.tick - activeRoundStartTick) / roundDurationTicks;
              const leftPercent = Math.min(100, Math.max(0, progress * 100));
              
              return (
                <div key={i} style={{ position: 'relative' }}>
                  <div
                    title={isKiller ? `Kill with ${normalizeWeapon(event.weapon)}` : `Died to ${normalizeWeapon(event.weapon)}`}
                    style={{
                      position: 'absolute',
                      left: `${leftPercent}%`,
                      top: 0,
                      bottom: 0,
                      width: '2px',
                      background: isKiller ? 'var(--health-high)' : 'var(--health-low)',
                      zIndex: 2
                    }}
                  />
                  {/* Icon below the line */}
                  <div style={{
                    position: 'absolute',
                    left: `${leftPercent}%`,
                    top: '10px',
                    transform: 'translateX(-50%)',
                    fontSize: '12px',
                    userSelect: 'none',
                    pointerEvents: 'none',
                    zIndex: 3
                  }}>
                    {isKiller ? '🏹' : '💀'}
                  </div>
                </div>
              );
            })
          ) : (
            // No player selected: show all kills as small skull tickers at bottom
            playerEvents.map((event, i) => {
              const progress = (event.tick - activeRoundStartTick) / roundDurationTicks;
              const leftPercent = Math.min(100, Math.max(0, progress * 100));
              
              return (
                <div
                  key={i}
                  title={`Kill with ${normalizeWeapon(event.weapon)}`}
                  style={{
                    position: 'absolute',
                    left: `${leftPercent}%`,
                    bottom: '2px',
                    transform: 'translateX(-50%)',
                    fontSize: '8px',
                    userSelect: 'none',
                    pointerEvents: 'none',
                    zIndex: 3,
                    opacity: 0.7
                  }}
                >
                  💀
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

export default RoundTimeline;
