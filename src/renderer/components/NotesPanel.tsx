import React, { useState } from "react";

interface NotesPanelProps {
  currentRoundNum: number;
  notes: Record<string, string>;
  onSaveNote: (roundNum: number, note: string) => void;
  onRemoveCurrentNote: (roundNum: number) => void;
  onRemoveAllNotes: () => void;
}

const NotesPanel: React.FC<NotesPanelProps> = ({
  currentRoundNum,
  notes,
  onSaveNote,
  onRemoveCurrentNote,
  onRemoveAllNotes,
}) => {
  const [expandedView, setExpandedView] = useState(true);
  const [copied, setCopied] = useState(false);
  const DEFAULT_NOTE_TEMPLATE = `Things I did bad:\nThings I did good:`;

  // Local controlled textarea state so the input remains editable even when
  // parent `notes` is cleared (prevents the "can't type after clear" bug).
  const [localNote, setLocalNote] = useState<string>(
    () => notes[currentRoundNum] ?? DEFAULT_NOTE_TEMPLATE,
  );

  React.useEffect(() => {
    setLocalNote(notes[currentRoundNum] ?? DEFAULT_NOTE_TEMPLATE);
  }, [notes, currentRoundNum]);

  const handleRemoveAllNotes = () => {
    onRemoveAllNotes();
  };

  const handleCopyAllNotes = async () => {
    const entries = Object.entries(notes).sort(
      (a, b) => Number(a[0]) - Number(b[0]),
    );
    if (entries.length === 0) return;

    const text = entries
      .map(([round, note]) => `Round ${round}:\n${note}`)
      .join("\n\n");

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
      console.warn("Failed to copy notes", err);
    }
  };

  return (
    <div
      style={{
        flex: 1,
        padding: "15px",
        borderTop: "1px solid var(--border-color)",
        display: "flex",
        flexDirection: "column",
        gap: "10px",
        minHeight: 0,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
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
          ROUND NOTES (ROUND: {currentRoundNum})
        </h4>
        <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
          {Object.keys(notes).length > 0 && (
            <>
              <button
                onClick={handleCopyAllNotes}
                title="Copy all notes to clipboard"
                className="small-btn"
                style={{
                  fontSize: "0.6rem",
                  padding: "2px 6px",
                }}
              >
                {copied ? "COPIED!" : "COPY ALL"}
              </button>

              <button
                onClick={handleRemoveAllNotes}
                title="Remove all notes"
                className="small-btn"
                style={{ fontSize: "0.6rem", padding: "2px 6px" }}
              >
                CLEAR ALL
              </button>
            </>
          )}
          <button
            onClick={() => setExpandedView(!expandedView)}
            className="small-btn"
            style={{ fontSize: "0.6rem", padding: "2px 6px" }}
          >
            {expandedView ? "COMPACT" : "EXPAND"}
          </button>
        </div>
      </div>

      {/* Current Round Note Input */}
      <div style={{ position: "relative" }}>
        <textarea
          value={localNote}
          onChange={(e) => {
            const v = e.target.value;
            setLocalNote(v);
            onSaveNote(currentRoundNum, v);
          }}
          placeholder={`Notes for round ${currentRoundNum}...`}
          style={{
            width: "100%",
            height: expandedView ? "100px" : "60px",
            background: "rgba(255,255,255,0.03)",
            border: "1px solid var(--border-color)",
            borderRadius: "3px",
            color: "white",
            fontSize: "0.75rem",
            padding: "6px 8px",
            resize: "none",
            outline: "none",
            fontFamily: "inherit",
            transition: "height 0.2s ease",
          }}
          onFocus={(e) => {
            (e.currentTarget as HTMLElement).style.background =
              "rgba(255,255,255,0.06)";
            (e.currentTarget as HTMLElement).style.borderColor =
              "var(--accent-ct)";
            // If the parent has no saved note for this round, the template is shown
            // — auto-select it so typing replaces the template immediately.
            if (
              notes[currentRoundNum] == null &&
              localNote === DEFAULT_NOTE_TEMPLATE
            ) {
              (e.currentTarget as HTMLTextAreaElement).select();
            }
          }}
          onBlur={(e) => {
            (e.currentTarget as HTMLElement).style.background =
              "rgba(255,255,255,0.03)";
            (e.currentTarget as HTMLElement).style.borderColor =
              "var(--border-color)";
          }}
        />
      </div>

      {expandedView && Object.keys(notes).length > 0 && (
        <div
          style={{
            fontSize: "0.7rem",
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            background: "rgba(0,0,0,0.2)",
            padding: "8px",
            borderRadius: "3px",
            borderLeft: "2px solid var(--accent-t)",
          }}
        >
          {Object.entries(notes)
            .sort((a, b) => Number(b[0]) - Number(a[0]))
            .slice(0, 5)
            .map(([round, note]) => (
              <div
                key={round}
                style={{
                  marginBottom: "6px",
                  paddingBottom: "6px",
                  borderBottom: "1px solid rgba(255,255,255,0.05)",
                  fontSize: "0.7rem",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  gap: "6px",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ color: "var(--accent-t)", fontWeight: 700 }}>
                    RD {round}:
                  </span>{" "}
                  <span style={{ opacity: 0.7 }}>
                    {note.substring(0, 40)}
                    {note.length > 40 ? "..." : ""}
                  </span>
                </div>
                <button
                  onClick={() => onRemoveCurrentNote(Number(round))}
                  title="Delete this note"
                  className="icon-btn"
                  style={{
                    fontSize: "0.85rem",
                    cursor: "pointer",
                    padding: "0",
                    width: "16px",
                    height: "16px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    transition: "all 0.2s ease",
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
        </div>
      )}
    </div>
  );
};

export default NotesPanel;
