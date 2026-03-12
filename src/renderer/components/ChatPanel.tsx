import React, { useState, useMemo } from "react";

interface ChatMessage {
  tick: number;
  sender_id: number;
  sender_name: string;
  sender_team: string;
  text: string;
  is_team: boolean;
}

interface RoundData {
  number: number;
  tick: number;
}

interface ChatPanelProps {
  chatMessages: ChatMessage[];
  rounds: RoundData[];
  filterPlayerId: number | null;
  filterPlayerName: string | null;
  onClose: () => void;
}

const ChatPanel: React.FC<ChatPanelProps> = ({
  chatMessages,
  rounds,
  filterPlayerId,
  filterPlayerName,
  onClose,
}) => {
  const [copied, setCopied] = useState(false);

  const getRoundForTick = (tick: number): number => {
    let roundNum = 0;
    for (const round of rounds) {
      if (tick >= round.tick) {
        roundNum = round.number;
      } else {
        break;
      }
    }
    return roundNum;
  };

  const messages = useMemo(() => {
    if (filterPlayerId == null) return chatMessages;
    return chatMessages.filter((m) => m.sender_id === filterPlayerId);
  }, [chatMessages, filterPlayerId]);

  const messagesByRound = useMemo(() => {
    const grouped: Record<number, ChatMessage[]> = {};
    for (const msg of messages) {
      const roundNum = getRoundForTick(msg.tick);
      if (!grouped[roundNum]) grouped[roundNum] = [];
      grouped[roundNum].push(msg);
    }
    return grouped;
  }, [messages, rounds]);

  const sortedRoundNumbers = useMemo(
    () =>
      Object.keys(messagesByRound)
        .map(Number)
        .sort((a, b) => a - b),
    [messagesByRound],
  );

  const getPrefix = (msg: ChatMessage): { label: string; color: string } => {
    if (!msg.is_team) {
      return { label: "(ALL)", color: "var(--text-secondary)" };
    }
    if (msg.sender_team === "CT") {
      return { label: "(CT)", color: "var(--accent-ct)" };
    }
    if (msg.sender_team === "T") {
      return { label: "(T)", color: "var(--accent-t)" };
    }
    return { label: "(TEAM)", color: "var(--text-secondary)" };
  };

  const handleCopy = async () => {
    if (messages.length === 0) return;

    const playerLabel = filterPlayerName
      ? `Chat log for ${filterPlayerName}`
      : "Chat log for full match";

    const lines: string[] = [playerLabel, ""];

    for (const roundNum of sortedRoundNumbers) {
      const roundLabel = roundNum <= 0 ? "Pre-match" : `Round ${roundNum}`;
      lines.push(`--- ${roundLabel} ---`);
      for (const msg of messagesByRound[roundNum]) {
        const prefix = msg.is_team
          ? `(${msg.sender_team || "TEAM"})`
          : "(ALL)";
        lines.push(`${prefix} ${msg.sender_name}: ${msg.text}`);
      }
      lines.push("");
    }

    const text = lines.join("\n");

    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement("textarea");
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch (err) {
      console.warn("Failed to copy chat", err);
    }
  };

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
          {filterPlayerName
            ? `CHAT: ${filterPlayerName.toUpperCase()}`
            : "MATCH CHAT"}
        </h4>
        <div style={{ display: "flex", gap: "6px" }}>
          {messages.length > 0 && (
            <button
              onClick={handleCopy}
              className="small-btn"
              style={{ fontSize: "0.6rem", padding: "2px 6px" }}
            >
              {copied ? "COPIED!" : "COPY"}
            </button>
          )}
          <button
            onClick={onClose}
            className="small-btn"
            style={{ fontSize: "0.6rem", padding: "2px 6px" }}
          >
            CLOSE
          </button>
        </div>
      </div>

      {/* Messages */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "8px 15px",
          minHeight: 0,
        }}
      >
        {messages.length === 0 ? (
          <div
            style={{
              color: "var(--text-secondary)",
              fontSize: "0.7rem",
              textAlign: "center",
              padding: "20px 0",
              opacity: 0.5,
            }}
          >
            {filterPlayerName
              ? `No chat messages from ${filterPlayerName}`
              : "No chat messages in this demo"}
          </div>
        ) : (
          sortedRoundNumbers.map((roundNum) => (
            <div key={roundNum} style={{ marginBottom: "10px" }}>
              <div
                style={{
                  fontSize: "0.6rem",
                  fontWeight: 800,
                  letterSpacing: "1px",
                  color: "var(--accent-ct)",
                  marginBottom: "4px",
                  opacity: 0.7,
                }}
              >
                {roundNum <= 0 ? "PRE-MATCH" : `ROUND ${roundNum}`}
              </div>
              {messagesByRound[roundNum].map((msg, idx) => {
                const prefix = getPrefix(msg);
                return (
                  <div
                    key={idx}
                    style={{
                      fontSize: "0.7rem",
                      lineHeight: "1.5",
                      padding: "2px 0",
                    }}
                  >
                    <span
                      style={{
                        color: prefix.color,
                        fontSize: "0.55rem",
                        fontWeight: 700,
                        marginRight: "4px",
                      }}
                    >
                      {prefix.label}
                    </span>
                    <span
                      style={{
                        color: "var(--text-primary)",
                        fontWeight: 600,
                      }}
                    >
                      {msg.sender_name}
                    </span>
                    <span style={{ color: "var(--text-secondary)" }}>: </span>
                    <span style={{ color: "var(--text-secondary)" }}>
                      {msg.text}
                    </span>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default ChatPanel;
