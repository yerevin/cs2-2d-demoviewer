import React from "react";
import PlayerCard from "./PlayerCard";

interface PlayerData {
  id: number;
  name: string;
  team: string;
  hp: number;
  has_bomb: boolean;
  money: number;
  armor: number;
  has_helmet: boolean;
  has_defuse_kit: boolean;
  active_weapon: string;
  weapons: { name: string; class: string }[];
  kills: number;
  deaths: number;
  assists: number;
  hs: number;
  roster_index: number;
}

interface PlayerSidebarProps {
  team: "CT" | "T";
  players: PlayerData[];
  showNicknames: boolean;
  selectedPlayerId: number | null;
  onSelectPlayer: (id: number | null) => void;
  compactMode?: boolean;
}

const PlayerSidebar: React.FC<PlayerSidebarProps> = ({
  team,
  players,
  showNicknames,
  selectedPlayerId,
  onSelectPlayer,
  compactMode = false,
}) => {
  const teamLabel = team === "CT" ? "COUNTER-TERRORISTS" : "TERRORISTS";
  const teamColor = team === "CT" ? "var(--accent-ct)" : "var(--accent-t)";

  return (
    <div style={{ padding: compactMode ? "0" : "5px" }}>
      {!compactMode && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            marginBottom: "5px",
            borderBottom: `2px solid ${teamColor}`,
            paddingBottom: "3px",
          }}
        >
          <h3
            style={{
              fontSize: "0.8rem",
              fontWeight: 800,
              color: teamColor,
              letterSpacing: "1px",
            }}
          >
            {teamLabel}
          </h3>
          <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>
            {players.filter((p) => p.hp > 0).length} ALIVE
          </span>
        </div>
      )}

      <div className="player-list">
        {players.map((player, index) => {
          // Use roster_index if assigned, otherwise use index (before match start)
          const displayNumber = player.roster_index > 0 ? player.roster_index : (index + 1);
          return (
          <PlayerCard
            key={player.id}
            number={displayNumber}
            name={player.name}
            hp={player.hp}
            team={team}
            isDead={player.hp <= 0}
            hasBomb={player.has_bomb}
            money={player.money}
            armor={player.armor}
            hasHelmet={player.has_helmet}
            activeWeapon={player.active_weapon}
            weapons={player.weapons}
            kills={player.kills}
            deaths={player.deaths}
            assists={player.assists}
            hs={player.hs}
            showNicknames={showNicknames}
            isSelected={selectedPlayerId === player.id}
            onSelect={() =>
              onSelectPlayer(selectedPlayerId === player.id ? null : player.id)
            }
          />
          );
        })}
      </div>
    </div>
  );
};

export default PlayerSidebar;
