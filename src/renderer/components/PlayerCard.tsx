import React from "react";
import { normalizeWeapon, getWeaponAssetPath } from "../utils/weapons";

interface PlayerCardProps {
  name: string;
  hp: number;
  team: "CT" | "T";
  isDead: boolean;
  money?: number;
  armor?: number;
  hasHelmet?: boolean;
  hasBomb?: boolean;
  activeWeapon?: string;
  weapons?: any[];
  kills?: number;
  deaths?: number;
  assists?: number;
  hs?: number;
  number: number;
  showNicknames: boolean;
  isSelected?: boolean;
  onSelect?: () => void;
}

const PlayerCard: React.FC<PlayerCardProps> = ({
  name,
  hp,
  team,
  isDead,
  money = 0,
  armor = 0,
  hasHelmet = false,
  hasBomb = false,
  activeWeapon = "",
  weapons = [],
  kills = 0,
  deaths = 0,
  assists = 0,
  hs = 0,
  number,
  showNicknames,
  isSelected,
  onSelect,
}) => {
  const teamColor = team === "CT" ? "var(--accent-ct)" : "var(--accent-t)";
  const hpColor =
    hp > 50
      ? "var(--health-high)"
      : hp > 20
        ? "var(--health-mid)"
        : "var(--health-low)";

  const hsPercent = kills > 0 ? Math.round((hs / kills) * 100) : 0;

  // Get active weapon
  const getActiveWeapon = () => {
    if (!activeWeapon) return null;
    const weapon = weapons?.find(
      (w) => w.name === activeWeapon || 
      (activeWeapon && normalizeWeapon(activeWeapon) === normalizeWeapon(w.name))
    );
    return weapon;
  };

  // Get grenades and utility items (excluding C4/knife)
  const getUtilityItems = () => {
    const grenades = ["FLASH", "SMOKE", "HE", "MOLO"];
    return (weapons || []).filter((w) => {
      const wName = normalizeWeapon(w.name);
      return grenades.includes(wName);
    });
  };

  // Render active weapon only
  const renderActiveWeapon = () => {
    const activeWeaponItem = getActiveWeapon();
    if (!activeWeaponItem) return null;

    const wName = normalizeWeapon(activeWeaponItem.name);
    const assetPath = getWeaponAssetPath(activeWeaponItem.name);

    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: teamColor,
          padding: assetPath ? "2px 4px" : "2px 6px",
          borderRadius: "2px",
          minWidth: assetPath ? "24px" : "auto",
          height: assetPath ? "24px" : "auto",
        }}
        title={wName}
      >
        {assetPath ? (
          <img
            src={assetPath}
            alt={wName}
            style={{
              width: "16px",
              height: "16px",
              filter: "brightness(1.2)",
            }}
          />
        ) : (
          <span
            style={{
              fontSize: "0.6rem",
              color: "white",
              fontWeight: 600,
            }}
          >
            {wName}
          </span>
        )}
      </div>
    );
  };

  // Render grenades and utility items
  const renderUtilityItems = () => {
    const utility = getUtilityItems();
    if (utility.length === 0) return null;

    return (
      <div style={{ display: "flex", gap: "3px" }}>
        {utility.sort((a, b) => a.name.localeCompare(b.name)).map((w, i) => {
          const wName = normalizeWeapon(w.name);
          const assetPath = getWeaponAssetPath(w.name);

          return (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "rgba(255,255,255,0.1)",
                padding: assetPath ? "1px 2px" : "1px 3px",
                borderRadius: "2px",
                minWidth: assetPath ? "16px" : "auto",
                height: assetPath ? "16px" : "auto",
              }}
              title={wName}
            >
              {assetPath ? (
                <img
                  src={assetPath}
                  alt={wName}
                  style={{
                    width: "12px",
                    height: "12px",
                    opacity: 0.7,
                  }}
                />
              ) : (
                <span
                  style={{
                    fontSize: "0.5rem",
                    color: "var(--text-secondary)",
                    fontWeight: 600,
                  }}
                >
                  {wName}
                </span>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div
      onClick={onSelect}
      style={{
        background: isSelected
          ? "rgba(255,255,255,0.05)"
          : "var(--bg-tertiary)",
        marginBottom: "6px",
        padding: "10px",
        borderRadius: "4px",
        borderLeft: `4px solid ${isDead ? "#4a5568" : teamColor}`,
        opacity: isDead ? 0.4 : 1,
        transition: "all 0.2s ease",
        position: "relative",
        overflow: "hidden",
        border: isSelected
          ? `1px solid ${teamColor}`
          : "1px solid var(--border-color)",
        cursor: "pointer",
      }}
    >
      {/* HP Bar Background */}
      {!isDead && (
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            height: "2px",
            width: `${hp}%`,
            background: hpColor,
            transition: "width 0.3s ease",
            boxShadow: `0 0 10px ${hpColor}`,
          }}
        />
      )}

      <div
        title={`Kills: ${kills} | Assists: ${assists} | Deaths: ${deaths} | HS%: ${hsPercent}%`}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "4px",
          marginBottom: "2px",
        }}
      >
        <div
          style={{
            width: "14px",
            height: "14px",
            background: teamColor,
            color: "white",
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "0.6rem",
            fontWeight: 900,
          }}
        >
          {number}
        </div>

        <div
          style={{
            flex: 1,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span
            style={{
              fontWeight: 700,
              fontSize: "0.6rem",
              color: isDead ? "var(--text-secondary)" : "var(--text-primary)",
              textTransform: "uppercase",
              maxWidth: "120px", // Always show names in the list
              overflow: "hidden",
              transition: "max-width 0.3s ease",
              whiteSpace: "nowrap",
            }}
          >
            {name}
            {hasBomb && <span style={{ fontSize: "0.65rem" }}>💣</span>}
          </span>

          {renderActiveWeapon()}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          marginTop: "4px",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
          <div
            style={{
              display: "flex",
              gap: "8px",
              fontSize: "0.7rem",
              fontWeight: 600,
            }}
          >
            <span style={{ color: "#4caf50" }}>${money.toLocaleString()}</span>
            {armor > 0 && (
              <span
                style={{
                  color: "var(--text-secondary)",
                  display: "flex",
                  alignItems: "center",
                  gap: "2px",
                }}
              >
                🛡️ {armor}{" "}
                {hasHelmet && <span style={{ fontSize: "0.6rem" }}>⛑️</span>}
              </span>
            )}
          </div>
        </div>

        <div
          style={{
            fontSize: "0.7rem",
            fontWeight: 800,
            color: isDead ? "var(--text-secondary)" : hpColor,
            display: "flex",
            alignItems: "center",
            gap: "4px",
          }}
        >
          {renderUtilityItems()}
          <div>
            {isDead ? "DEAD" : hp}
          </div>
        </div>
      </div>
    </div>
  );
};

export default PlayerCard;
