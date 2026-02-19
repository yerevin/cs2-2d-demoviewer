import React from 'react';

interface PlaybackControlsProps {
  currentTick: number;
  totalTicks: number;
  isPlaying: boolean;
  playbackSpeed: number;
  onTogglePlay: () => void;
  onSeek: (tick: number) => void;
  onSpeedChange: (speed: number) => void;
}

const PlaybackControls: React.FC<PlaybackControlsProps> = ({
  currentTick,
  totalTicks,
  isPlaying,
  playbackSpeed,
  onTogglePlay,
  onSeek,
  onSpeedChange
}) => {
  const progress = (currentTick / (totalTicks - 1)) * 100;

  return (
    <div style={{ 
      display: 'flex', 
      flexDirection: 'column', 
      height: '100%', 
      width: '100%', 
      padding: '10px 30px',
      justifyContent: 'center',
      gap: '10px'
    }}>
      {/* Seeker Bar */}
      <div style={{ position: 'relative', width: '100%', height: '20px', display: 'flex', alignItems: 'center' }}>
        <input 
          type="range" 
          min={0} 
          max={totalTicks - 1} 
          value={currentTick} 
          onChange={(e) => onSeek(parseInt(e.target.value))}
          style={{ 
            width: '100%', 
            cursor: 'pointer',
            accentColor: 'var(--accent-ct)',
            height: '4px',
            background: '#333'
          }}
        />
        <div style={{ 
          position: 'absolute', 
          bottom: '-15px', 
          left: '0', 
          right: '0', 
          display: 'flex', 
          justifyContent: 'space-between',
          fontSize: '0.7rem',
          color: 'var(--text-secondary)',
          fontFamily: 'monospace'
        }}>
          <span>0</span>
          <span>TICK: {currentTick} / {totalTicks}</span>
          <span>{totalTicks}</span>
        </div>
      </div>

      {/* Control Buttons */}
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '40px', marginTop: '5px' }}>
        <div style={{ display: 'flex', gap: '20px' }}>
          <button 
            onClick={() => onSeek(Math.max(0, currentTick - 100))}
            style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', fontSize: '1.2rem' }}
          >
            ⏮️
          </button>
          <button 
            onClick={onTogglePlay}
            style={{ 
              background: 'var(--accent-ct)', 
              border: 'none', 
              color: 'white', 
              width: '40px', 
              height: '40px', 
              borderRadius: '50%', 
              cursor: 'pointer',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              fontSize: '1rem',
              boxShadow: '0 0 15px rgba(93, 121, 174, 0.3)'
            }}
          >
            {isPlaying ? '⏸️' : '▶️'}
          </button>
          <button 
            onClick={() => onSeek(Math.min(totalTicks - 1, currentTick + 100))}
            style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', fontSize: '1.2rem' }}
          >
            ⏭️
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>SPEED</span>
          <div style={{ display: 'flex', background: 'var(--bg-tertiary)', borderRadius: '4px', padding: '2px', border: '1px solid var(--border-color)' }}>
            {[0.25, 0.5, 1, 2, 4].map(speed => (
              <button
                key={speed}
                onClick={() => onSpeedChange(speed)}
                style={{
                  padding: '4px 10px',
                  background: playbackSpeed === speed ? 'var(--accent-ct)' : 'transparent',
                  border: 'none',
                  color: 'white',
                  borderRadius: '3px',
                  cursor: 'pointer',
                  fontSize: '0.75rem',
                  fontWeight: playbackSpeed === speed ? 'bold' : 'normal'
                }}
              >
                {speed}x
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default PlaybackControls;
