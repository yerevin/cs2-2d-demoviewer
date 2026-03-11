import React, { useState } from "react";
import { exportVoiceOggToMp4 } from "../mediaExport";
import { extractVoiceOgg } from "../wasmParser";

interface VoicePlayer {
  steam_id: number;
  name: string;
  segments: number;
  format: string;
}

interface RoundData {
  number: number;
  tick: number;
}

interface VoiceDownloadPanelProps {
  voicePlayers: VoicePlayer[];
  rounds: RoundData[];
  onClose: () => void;
}

type DownloadFormat = "ogg" | "mp4";

const VoiceDownloadPanel: React.FC<VoiceDownloadPanelProps> = ({
  voicePlayers,
  rounds,
  onClose,
}) => {
  const [downloading, setDownloading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloadFormat, setDownloadFormat] =
    useState<DownloadFormat>("mp4");

  const saveBlob = (blob: Blob, fileName: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const downloadVoice = async (
    player: VoicePlayer,
    roundNum: number | null,
  ) => {
    const key = `${player.steam_id}_${roundNum ?? "all"}_${downloadFormat}`;
    setDownloading(key);
    setError(null);

    try {
      let startTick = 0;
      let endTick = 0;

      if (roundNum !== null) {
        const roundIdx = rounds.findIndex((r) => r.number === roundNum);
        if (roundIdx >= 0) {
          startTick = rounds[roundIdx].tick;
          endTick =
            roundIdx + 1 < rounds.length ? rounds[roundIdx + 1].tick : 0;
        }
      }

      const oggData = await extractVoiceOgg(
        player.steam_id,
        startTick,
        endTick,
      );
      const roundLabel =
        roundNum !== null ? `round${roundNum}` : "full_match";
      const safeName = player.name.replace(/[^a-z0-9-_]+/gi, "_");

      if (downloadFormat === "mp4") {
        const subtitle =
          roundNum !== null
            ? `Round ${roundNum} voice chat export`
            : "Full match voice chat export";
        const mp4Data = await exportVoiceOggToMp4(
          oggData,
          player.name,
          subtitle,
        );
        saveBlob(
          new Blob([new Uint8Array(mp4Data)], { type: "video/mp4" }),
          `${safeName}_${roundLabel}.mp4`,
        );
      } else {
        saveBlob(
          new Blob([new Uint8Array(oggData)], { type: "audio/ogg" }),
          `${safeName}_${roundLabel}.ogg`,
        );
      }
    } catch (err: any) {
      setError(err?.message || "Download failed");
    } finally {
      setDownloading(null);
    }
  };

  if (voicePlayers.length === 0) {
    return (
      <div
        style={{
          padding: "15px",
          borderTop: "1px solid var(--border-color)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "10px",
          }}
        >
          <h4
            style={{
              fontSize: "0.7rem",
              fontWeight: 800,
              margin: 0,
              opacity: 0.6,
              letterSpacing: "1px",
            }}
          >
            VOICE CHAT
          </h4>
          <button
            onClick={onClose}
            className="small-btn"
            style={{ fontSize: "0.6rem", padding: "2px 6px" }}
          >
            CLOSE
          </button>
        </div>
        <div
          style={{
            color: "var(--text-secondary)",
            fontSize: "0.7rem",
            textAlign: "center",
            padding: "15px 0",
            opacity: 0.5,
          }}
        >
          No voice data in this demo.
          <br />
          <span style={{ fontSize: "0.6rem" }}>
            Note: Valve MM demos do not contain voice audio.
          </span>
        </div>
      </div>
    );
  }

  // Get available round numbers
  const roundNumbers = rounds
    .map((r) => r.number)
    .filter((n) => n >= 1);

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        borderTop: "1px solid var(--border-color)",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "10px 15px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          borderBottom: "1px solid var(--border-color)",
          flexShrink: 0,
        }}
      >
        <h4
          style={{
            fontSize: "0.7rem",
            fontWeight: 800,
            margin: 0,
            opacity: 0.6,
            letterSpacing: "1px",
          }}
        >
          VOICE CHAT ({voicePlayers.length} PLAYERS)
        </h4>
        <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
          <div
            style={{
              display: "flex",
              gap: "4px",
              padding: "2px",
              border: "1px solid var(--border-color)",
              borderRadius: "3px",
            }}
          >
            <button
              onClick={() => setDownloadFormat("ogg")}
              className="small-btn"
              style={{
                fontSize: "0.55rem",
                padding: "2px 6px",
                background:
                  downloadFormat === "ogg" ? "var(--accent-t)" : "transparent",
                color: downloadFormat === "ogg" ? "white" : undefined,
              }}
            >
              OGG
            </button>
            <button
              onClick={() => setDownloadFormat("mp4")}
              className="small-btn"
              style={{
                fontSize: "0.55rem",
                padding: "2px 6px",
                background:
                  downloadFormat === "mp4"
                    ? "var(--accent-ct)"
                    : "transparent",
                color: downloadFormat === "mp4" ? "white" : undefined,
              }}
            >
              MP4
            </button>
          </div>
          <button
            onClick={onClose}
            className="small-btn"
            style={{ fontSize: "0.6rem", padding: "2px 6px" }}
          >
            CLOSE
          </button>
        </div>
      </div>

      <div
        style={{
          padding: "6px 15px",
          fontSize: "0.6rem",
          color: "var(--text-secondary)",
          borderBottom: "1px solid var(--border-color)",
        }}
      >
        {downloadFormat === "mp4"
          ? "MP4 export wraps the extracted voice in a small black video for upload-friendly playback."
          : "OGG export keeps the original extracted voice container without re-encoding."}
      </div>

      {/* Error */}
      {error && (
        <div
          style={{
            padding: "6px 15px",
            fontSize: "0.6rem",
            color: "var(--health-low)",
            background: "rgba(244, 67, 54, 0.1)",
          }}
        >
          {error}
        </div>
      )}

      {/* Player list */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "8px 15px",
          minHeight: 0,
        }}
      >
        {voicePlayers.map((player) => (
          <VoicePlayerRow
            key={player.steam_id}
            player={player}
            roundNumbers={roundNumbers}
            downloading={downloading}
            downloadFormat={downloadFormat}
            onDownload={downloadVoice}
          />
        ))}
      </div>
    </div>
  );
};

interface VoicePlayerRowProps {
  player: VoicePlayer;
  roundNumbers: number[];
  downloading: string | null;
  downloadFormat: DownloadFormat;
  onDownload: (player: VoicePlayer, roundNum: number | null) => void;
}

const VoicePlayerRow: React.FC<VoicePlayerRowProps> = ({
  player,
  roundNumbers,
  downloading,
  downloadFormat,
  onDownload,
}) => {
  const [expanded, setExpanded] = useState(false);
  const isDownloading = (roundNum: number | null) =>
    downloading === `${player.steam_id}_${roundNum ?? "all"}_${downloadFormat}`;

  return (
    <div
      style={{
        marginBottom: "6px",
        background: "var(--bg-tertiary)",
        borderRadius: "4px",
        border: "1px solid var(--border-color)",
        overflow: "hidden",
      }}
    >
      {/* Player header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "6px 8px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span
            style={{
              fontSize: "0.65rem",
              fontWeight: 700,
              color: "var(--text-primary)",
              textTransform: "uppercase",
            }}
          >
            {player.name}
          </span>
          <span
            style={{
              fontSize: "0.5rem",
              color: "var(--text-secondary)",
              opacity: 0.6,
            }}
          >
            {player.segments} segments | {player.format.toUpperCase()}
          </span>
        </div>
        <div style={{ display: "flex", gap: "4px" }}>
          <button
            onClick={() => onDownload(player, null)}
            disabled={isDownloading(null)}
            className="small-btn"
            style={{
              fontSize: "0.55rem",
              padding: "2px 6px",
              background: isDownloading(null) ? "var(--accent-ct)" : undefined,
              opacity: isDownloading(null) ? 0.6 : 1,
            }}
          >
            {isDownloading(null)
              ? "..."
              : `FULL ${downloadFormat.toUpperCase()}`}
          </button>
          <button
            onClick={() => setExpanded(!expanded)}
            className="small-btn"
            style={{ fontSize: "0.55rem", padding: "2px 6px" }}
          >
            {expanded ? "HIDE" : "ROUNDS"}
          </button>
        </div>
      </div>

      {/* Per-round download */}
      {expanded && (
        <div
          style={{
            padding: "4px 8px 6px",
            borderTop: "1px solid var(--border-color)",
            display: "flex",
            flexWrap: "wrap",
            gap: "3px",
          }}
        >
          {roundNumbers.map((roundNum) => (
            <button
              key={roundNum}
              onClick={() => onDownload(player, roundNum)}
              disabled={isDownloading(roundNum)}
              className="small-btn"
              style={{
                fontSize: "0.5rem",
                padding: "2px 4px",
                minWidth: "22px",
                textAlign: "center",
                background: isDownloading(roundNum)
                  ? "var(--accent-ct)"
                  : undefined,
                opacity: isDownloading(roundNum) ? 0.6 : 1,
              }}
              title={`Download round ${roundNum}`}
            >
              {isDownloading(roundNum) ? "..." : roundNum}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default VoiceDownloadPanel;
