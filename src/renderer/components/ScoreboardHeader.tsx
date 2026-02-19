import React from "react";

interface ScoreboardHeaderProps {
  onOpenFile: () => void;
  isLoading: boolean;
  hasDemo?: boolean;
  onReset?: () => void;
}

const ScoreboardHeader: React.FC<ScoreboardHeaderProps> = ({
  onOpenFile,
  isLoading,
  hasDemo = false,
  onReset,
}) => {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        height: "100%",
        padding: "0 30px",
        background:
          "linear-gradient(to bottom, var(--bg-secondary), var(--bg-primary))",
      }}
    >
      {/* Left side: Logo/App Name */}
      <div style={{ display: "flex", alignItems: "center", gap: "15px" }}>
        <div
          style={{
            background: "var(--accent-ct)",
            width: "5px",
            height: "24px",
            boxShadow: "0 0 10px var(--accent-ct)",
          }}
        ></div>
        <h2
          style={{
            fontSize: "1.1rem",
            fontWeight: 900,
            letterSpacing: "3px",
            color: "white",
            margin: 0,
          }}
        >
          CS2 2D Demoviewer
        </h2>
      </div>

      {/* Center: The Scoreboard */}
      <div style={{ display: "flex", alignItems: "center", gap: "0" }}></div>

      {/* Right side: File Input / Reset Button */}
      <div>
        <button
          onClick={hasDemo && onReset ? onReset : onOpenFile}
          disabled={isLoading}
          className="primary-btn"
          style={{
            padding: "10px 24px",
            background: "transparent",
            color: "white",
            borderRadius: "4px",
            cursor: isLoading ? "not-allowed" : "pointer",
            fontSize: "0.75rem",
            fontWeight: 800,
            transition: "all 0.2s",
            letterSpacing: "1px",
          }}
        >
          {isLoading ? "ANALYZING..." : hasDemo ? "RESET DEMO" : "IMPORT DEMO"}
        </button>
      </div>
    </div>
  );
};

export default ScoreboardHeader;
