import React from "react";

interface ScoresHeaderProps {
  team: "CT" | "T";
  score: number;
}

const ScoresHeader: React.FC<ScoresHeaderProps> = ({ team }) => {
  const isCT = team === "CT";
  const teamColor = isCT ? "var(--accent-ct)" : "var(--accent-t)";
  const teamName = isCT ? "COUNTER-TERRORISTS" : "TERRORISTS";

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "5px 10px",
        background: "rgba(0,0,0,0.2)",
        borderBottom: `2px solid ${teamColor}`,
        marginTop: "4px",
        marginBottom: "4px",
        borderRadius: "4px",
      }}
    >
      <h4
        style={{
          fontSize: "0.65rem",
          fontWeight: 900,
          color: teamColor,
          letterSpacing: "1px",
          margin: 0,
        }}
      >
        {teamName}
      </h4>
    </div>
  );
};

export default ScoresHeader;
