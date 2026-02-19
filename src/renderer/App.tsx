import React, { useState, useMemo, useRef, useEffect } from "react";
import MapView from "./MapView";
import PlayerSidebar from "./components/PlayerSidebar";
import ScoreboardHeader from "./components/ScoreboardHeader";
import ScoresHeader from "./components/ScoresHeader";
import RoundTimeline from "./components/RoundTimeline";
import NotesPanel from "./components/NotesPanel";
import { parseDemoWithWasm } from "./wasmParser";
import { loadDemoFromArchiveUrl } from "./demoLoader";

const App: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [remoteSourceUrl, setRemoteSourceUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const remoteLoadKeyRef = useRef<string | null>(null);

  // Playback State
  const [currentTick, setCurrentTick] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);

  // New Feature State
  const [selectedPlayerId, setSelectedPlayerId] = useState<number | null>(null);
  const [showNicknames, setShowNicknames] = useState(true);

  const [notes, setNotes] = useState<Record<string, string>>({}); // round_num -> note

  // Load notes from localStorage
  useEffect(() => {
    if (data && data.file_path) {
      const saved = localStorage.getItem(`notes_${data.file_path}`);
      if (saved) {
        try {
          setNotes(JSON.parse(saved));
        } catch (e) {}
      }
    } else {
      setNotes({});
    }
  }, [data?.file_path]);

  // Save notes to localStorage
  useEffect(() => {
    if (data && data.file_path && Object.keys(notes).length > 0) {
      localStorage.setItem(`notes_${data.file_path}`, JSON.stringify(notes));
    }
  }, [notes, data?.file_path]);

  // Find the index of the first "match" round — a round where players start with $800.
  // We will use that index as the match start so the UI round counter starts from 1 there.
  const matchStartIndex = useMemo(() => {
    if (!data || !data.rounds || !data.frames) return 0;

    for (let i = 0; i < data.rounds.length; i++) {
      const round = data.rounds[i];
      const frameIndex = data.frames.findIndex((f: any) => f.tick >= round.tick);
      if (frameIndex === -1) continue;
      const frame = data.frames[frameIndex];
      if (!frame?.players || frame.players.length === 0) continue;

      const playersWith800 = frame.players.filter((p: any) => p.money === 800).length;
      // require majority (>=75%) OR at least 5 players with $800 to be robust across partial demos
      const threshold = Math.max(5, Math.ceil(frame.players.length * 0.75));
      if (playersWith800 >= threshold) return i;
    }

    return 0;
  }, [data]);

  // Derived rounds for UI: renumber so `matchStartIndex` becomes round 1
  const roundsForView = useMemo(() => {
    if (!data || !data.rounds) return [] as any[];
    return data.rounds.map((r: any, idx: number) => ({ ...r, number: idx - matchStartIndex + 1 }));
  }, [data, matchStartIndex]);

  // Current round: return the display number (1-based from detected match start)
  const currentRoundNum = useMemo(() => {
    if (!data || !data.rounds || !data.frames) return 1;
    const currentIngameTick = data.frames[currentTick]?.tick || 0;
    let bestIdx = 0;
    for (let i = 0; i < data.rounds.length; i++) {
      if (currentIngameTick >= data.rounds[i].tick) bestIdx = i;
      else break;
    }
    return Math.max(1, bestIdx - matchStartIndex + 1);
  }, [data, currentTick, matchStartIndex]);

  const handleSaveNote = (roundNum: number, note: string) => {
    setNotes((prev) => ({ ...prev, [roundNum]: note }));
  };

  const handleRemoveCurrentNote = (roundNum: number) => {
    if (confirm(`Remove note for round ${roundNum}?`)) {
      setNotes((prev) => {
        const updated = { ...prev };
        delete updated[roundNum];
        return updated;
      });
    }
  };

  const handleRemoveAllNotes = () => {
    if (confirm("Remove all notes? This cannot be undone.")) {
      setNotes({});
    }
  };

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in an input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      if (e.code === "Space") {
        e.preventDefault();
        setIsPlaying((prev) => !prev);
      } else if (e.code === "ArrowLeft") {
        e.preventDefault();
        const skipFrames = 5 * playbackSpeed * (data?.tick_rate || 64);
        setCurrentTick((prev) => Math.max(0, prev - skipFrames));
      } else if (e.code === "ArrowRight") {
        e.preventDefault();
        const skipFrames = 5 * playbackSpeed * (data?.tick_rate || 64);
        setCurrentTick((prev) =>
          Math.min((data?.frames?.length || 1) - 1, prev + skipFrames),
        );
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [data, playbackSpeed]);

  const handleFileChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = (event.target as any).files?.[0];
    if (!file) return;

    setLoading(true);
    setError(null);
    setCurrentTick(0);
    setIsPlaying(false);
    setRemoteSourceUrl(null);

    try {
      const result = await parseDemoWithWasm(file);
      setData({ ...result, file_path: file.name });
    } catch (err: any) {
      setError(err.toString());
      console.error("Error parsing demo:", err);
    } finally {
      setLoading(false);
    }
  };

  const loadFromArchiveUrl = async (archiveUrl: string) => {
    setLoading(true);
    setError(null);
    setCurrentTick(0);
    setIsPlaying(false);

    try {
      const result = await loadDemoFromArchiveUrl(archiveUrl);
      setData({ ...result.parsed, file_path: result.fileName });
      setRemoteSourceUrl(result.sourceUrl || archiveUrl);
    } catch (err: any) {
      setError(err?.toString?.() || "Failed to load remote demo archive");
      console.error("Error loading remote demo archive:", err);
    } finally {
      setLoading(false);
    }
  };

  const triggerFileInput = () => {
    fileInputRef.current?.click();
  };

  const handleReset = () => {
    setData(null);
    setCurrentTick(0);
    setIsPlaying(false);
    setSelectedPlayerId(null);
    setNotes({});
    setRemoteSourceUrl(null);

    const params = new URLSearchParams(window.location.search);
    if (params.has("demoArchiveUrl")) {
      params.delete("demoArchiveUrl");
      const next = params.toString()
        ? `${window.location.pathname}?${params.toString()}`
        : window.location.pathname;
      window.history.replaceState({}, "", next);
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const archiveUrl = params.get("demoArchiveUrl");
    if (!archiveUrl) return;
    if (remoteLoadKeyRef.current === archiveUrl) return;

    remoteLoadKeyRef.current = archiveUrl;
    loadFromArchiveUrl(archiveUrl);
  }, []);

  // Memoize current frame
  const currentFrame = useMemo(() => {
    if (!data || !data.frames) return null;
    return data.frames[currentTick] || data.frames[data.frames.length - 1];
  }, [data, currentTick]);

  // Derived Player Lists
  const ctPlayers = useMemo(() => {
    if (!currentFrame) return [];
    return currentFrame.players
      .filter((p: any) => p.team === "CT")
      .sort((a: any, b: any) => a.name.localeCompare(b.name));
  }, [currentFrame]);

  const tPlayers = useMemo(() => {
    if (!currentFrame) return [];
    return currentFrame.players
      .filter((p: any) => p.team === "T")
      .sort((a: any, b: any) => a.name.localeCompare(b.name));
  }, [currentFrame]);

  return (
    <div className="app-grid">
      <header className="header-area">
        <ScoreboardHeader
          onOpenFile={triggerFileInput}
          isLoading={loading}
          hasDemo={!!data}
          onReset={handleReset}
        />
        <input
          type="file"
          ref={fileInputRef}
          accept=".dem"
          onChange={handleFileChange}
          style={{ display: "none" }}
        />
        {remoteSourceUrl && (
          <div
            style={{
              borderTop: "1px solid var(--border-color)",
              padding: "6px 30px",
              color: "var(--text-secondary)",
              fontSize: "0.65rem",
              letterSpacing: "1px",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
            title={remoteSourceUrl}
          >
            SOURCE URL: {remoteSourceUrl}
          </div>
        )}
      </header>

      <aside
        className="left-sidebar-area"
        style={{ overflowY: "auto", display: "flex", flexDirection: "column" }}
      >
        {/* Notes Panel */}
        {data && (
          <NotesPanel
            currentRoundNum={currentRoundNum}
            notes={notes}
            onSaveNote={handleSaveNote}
            onRemoveCurrentNote={handleRemoveCurrentNote}
            onRemoveAllNotes={handleRemoveAllNotes}
          />
        )}
      </aside>

      <main
        className="map-area"
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "stretch",
        }}
      >
        <div
          style={{
            padding: "10px 15px",
            borderBottom: "1px solid var(--border-color)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "10px",
          }}
        >
          <span
            style={{
              fontSize: "0.65rem",
              fontWeight: 800,
              letterSpacing: "1px",
              opacity: 0.5,
            }}
          >
            VIEW OPTIONS
          </span>
          <div style={{ display: "flex", gap: "10px" }}>
            <button
              onClick={() => setShowNicknames(!showNicknames)}
              style={{
                background: showNicknames ? "var(--accent-ct)" : "transparent",
                border: "1px solid var(--border-color)",
                color: "white",
                fontSize: "0.6rem",
                padding: "2px 6px",
                borderRadius: "2px",
                cursor: "pointer",
              }}
            >
              {showNicknames ? "HIDE NAMES" : "SHOW NAMES"}
            </button>
          </div>
        </div>

        <div
          style={{
            flex: 1,
            position: "relative",
            overflow: "hidden",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {error && (
            <div
              style={{
                color: "#ff6b6b",
                background: "rgba(255, 107, 107, 0.05)",
                padding: "20px 40px",
                borderRadius: "4px",
                border: "1px solid rgba(255, 107, 107, 0.2)",
                textAlign: "center",
              }}
            >
              <h3 style={{ marginBottom: "10px" }}>ANALYSIS FAILED</h3>
              <p style={{ fontSize: "0.9rem" }}>{error}</p>
            </div>
          )}

          {data ? (
            <MapView
              data={data}
              currentTick={currentTick}
              setCurrentTick={setCurrentTick}
              isPlaying={isPlaying}
              setIsPlaying={setIsPlaying}
              playbackSpeed={playbackSpeed}
              selectedPlayerId={selectedPlayerId}
              showNicknames={showNicknames}
              skipFreezeTime={true}
            />
          ) : (
            !loading &&
            !error && (
              <div
                style={{ color: "var(--text-secondary)", textAlign: "center" }}
              >
                <div
                  style={{
                    fontSize: "5rem",
                    marginBottom: "20px",
                    opacity: 0.05,
                    filter: "grayscale(1)",
                  }}
                >
                  🎮
                </div>
                <h2
                  style={{
                    color: "white",
                    marginBottom: "10px",
                    fontWeight: 900,
                    letterSpacing: "2px",
                  }}
                >
                  SYSTEM READY
                </h2>
                <p
                  style={{
                    fontSize: "0.85rem",
                    maxWidth: "300px",
                    margin: "0 auto",
                    lineHeight: "1.6",
                    opacity: 0.6,
                  }}
                >
                  Please import a Counter-Strike 2 demo file to begin
                  frame-by-frame spatial analysis.
                </p>
                <button
                  onClick={triggerFileInput}
                  style={{
                    marginTop: "30px",
                    padding: "12px 30px",
                    background: "var(--accent-ct)",
                    color: "white",
                    border: "none",
                    borderRadius: "4px",
                    fontWeight: 800,
                    cursor: "pointer",
                    boxShadow: "0 4px 15px rgba(93, 121, 174, 0.4)",
                  }}
                >
                  SELECT DEMO FILE
                </button>
              </div>
            )
          )}
        </div>

        {loading && (
          <div className="loading-overlay">
            <div
              className="spinner"
              style={{ width: "60px", height: "60px" }}
            ></div>
            <div style={{ textAlign: "center" }}>
              <p
                style={{
                  fontWeight: 900,
                  marginBottom: "8px",
                  letterSpacing: "2px",
                  fontSize: "1.1rem",
                }}
              >
                PARSING DEMO
              </p>
              <div
                style={{
                  width: "200px",
                  height: "2px",
                  background: "var(--border-color)",
                  margin: "10px auto",
                  position: "relative",
                  overflow: "hidden",
                }}
              >
                <div
                  className="progress-shimmer"
                  style={{
                    position: "absolute",
                    width: "100px",
                    height: "100%",
                    background: "var(--accent-ct)",
                    boxShadow: "0 0 15px var(--accent-ct)",
                  }}
                ></div>
              </div>
              <p
                style={{
                  color: "var(--text-secondary)",
                  fontSize: "0.75rem",
                  fontWeight: 600,
                }}
              >
                WORKING...
              </p>
            </div>
          </div>
        )}
      </main>

      <aside
        className="right-sidebar-area"
        style={{ overflowY: "auto", display: "flex", flexDirection: "column" }}
      >
        {data ? (
          <>
            {/* CT Team */}
            <div style={{ flex: 1, overflowY: "auto" }}>
              <ScoresHeader
                team="CT"
                score={data?.rounds?.[Math.max(0, matchStartIndex + currentRoundNum - 1)]?.ct_score || 0}
              />
              <div style={{ padding: "0 15px" }}>
                <PlayerSidebar
                  team="CT"
                  players={ctPlayers}
                  showNicknames={showNicknames}
                  selectedPlayerId={selectedPlayerId}
                  onSelectPlayer={setSelectedPlayerId}
                  compactMode={true}
                />
              </div>
            </div>

            {/* T Team */}
            <div style={{ flex: 1, overflowY: "auto" }}>
              <ScoresHeader
                team="T"
                score={data?.rounds?.[Math.max(0, matchStartIndex + currentRoundNum - 1)]?.t_score || 0}
              />
              <div style={{ padding: "0 15px" }}>
                <PlayerSidebar
                  team="T"
                  players={tPlayers}
                  showNicknames={showNicknames}
                  selectedPlayerId={selectedPlayerId}
                  onSelectPlayer={setSelectedPlayerId}
                  compactMode={true}
                />
              </div>
            </div>
          </>
        ) : (
          <div
            style={{
              padding: "30px",
              textAlign: "center",
              color: "var(--text-secondary)",
            }}
          >
            <p
              style={{
                fontSize: "0.75rem",
                fontWeight: 700,
                letterSpacing: "1px",
              }}
            >
              TEAMS
            </p>
            <div style={{ marginTop: "20px", opacity: 0.1, fontSize: "2rem" }}>
              👥
            </div>
          </div>
        )}
      </aside>

      <footer
        className="footer-area"
        style={{ display: "flex", flexDirection: "column", height: "auto" }}
      >
        {data ? (
          <RoundTimeline
            rounds={roundsForView}
            currentTick={currentTick}
            frames={data.frames}
            kills={data.kills}
            selectedPlayerId={selectedPlayerId}
            onSeek={setCurrentTick}
            isPlaying={isPlaying}
            onTogglePlay={() => setIsPlaying(!isPlaying)}
            tickRate={data.tick_rate}
            originalTickRate={data.original_tick_rate}
            playbackSpeed={playbackSpeed}
            onSpeedChange={setPlaybackSpeed}
          />
        ) : (
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              height: "var(--footer-height)",
              color: "var(--text-secondary)",
              fontSize: "0.7rem",
              fontWeight: 800,
              letterSpacing: "3px",
              opacity: 0.3,
            }}
          >
            NO ACTIVE STREAM
          </div>
        )}
      </footer>
    </div>
  );
};

export default App;
