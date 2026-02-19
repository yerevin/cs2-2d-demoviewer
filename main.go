package main

import (
	"encoding/json"
	"fmt"
	"io"
	"sort"

	dem "github.com/markus-wa/demoinfocs-golang/v5/pkg/demoinfocs"
	common "github.com/markus-wa/demoinfocs-golang/v5/pkg/demoinfocs/common"
	events "github.com/markus-wa/demoinfocs-golang/v5/pkg/demoinfocs/events"
	msg "github.com/markus-wa/demoinfocs-golang/v5/pkg/demoinfocs/msg"
)

// Data structures for JSON output
type WeaponData struct {
	Name  string `json:"name"`
	Class string `json:"class"`
}

type PlayerData struct {
	ID           uint64       `json:"id"`
	Name         string       `json:"name"`
	Team         string       `json:"team"`
	IsAlive      bool         `json:"is_alive"`
	X            float64      `json:"x"`
	Y            float64      `json:"y"`
	Z            float64      `json:"z"`
	Rotation     float32      `json:"rotation"`
	Hp           int          `json:"hp"`
	Money        int          `json:"money"`
	Armor        int          `json:"armor"`
	HasHelmet    bool         `json:"has_helmet"`
	HasDefuseKit bool         `json:"has_defuse_kit"`
	HasBomb      bool         `json:"has_bomb"`
	ActiveWeapon string       `json:"active_weapon"`
	Weapons      []WeaponData `json:"weapons"`
	Kills        int          `json:"kills"`
	Deaths       int          `json:"deaths"`
	Assists      int          `json:"assists"`
	HS           int          `json:"hs"`
	IsFlashed    bool         `json:"is_flashed"`
	FlashMs      int          `json:"flash_ms"`
	RosterIndex  int          `json:"roster_index"` // 1-10, assigned at match start
}

type KillEvent struct {
	Tick       int    `json:"tick"`
	KillerID   uint64 `json:"killer_id"`
	VictimID   uint64 `json:"victim_id"`
	AssisterID uint64 `json:"assister_id,omitempty"`
	IsHeadshot bool   `json:"is_headshot"`
	Weapon     string `json:"weapon"`
}

type GrenadeEffect struct {
	ID        int64   `json:"id"`
	EntityID  int64   `json:"-"`    // Internal use for cleanup
	Type      string  `json:"type"` // "SMOKE", "FLASH", "HE", "MOLOTOV"
	X         float64 `json:"x"`
	Y         float64 `json:"y"`
	Z         float64 `json:"z"`
	StartTick int     `json:"start_tick"`
	EndTick   int     `json:"end_tick"`
	FlashedCT int     `json:"flashed_ct,omitempty"`
	FlashedT  int     `json:"flashed_t,omitempty"`
}

type BombData struct {
	X         float64 `json:"x"`
	Y         float64 `json:"y"`
	Z         float64 `json:"z"`
	IsPlanted bool    `json:"is_planted"`
	CarrierID uint64  `json:"carrier_id,omitempty"`
}

type WeaponFire struct {
	PlayerID uint64 `json:"player_id"`
	Weapon   string `json:"weapon"`
}

type ProjectileData struct {
	ID   int64   `json:"id"`
	Type string  `json:"type"`
	X    float64 `json:"x"`
	Y    float64 `json:"y"`
	Z    float64 `json:"z"`
}

type FrameData struct {
	Tick        int              `json:"tick"`
	Players     []PlayerData     `json:"players"`
	Grenades    []GrenadeEffect  `json:"grenades"`
	Projectiles []ProjectileData `json:"projectiles"`
	Fires       []WeaponFire     `json:"fires"`
	Bomb        BombData         `json:"bomb"`
}

type RoundData struct {
	Number         int    `json:"number"`
	Tick           int    `json:"tick"`
	CTScore        int    `json:"ct_score"`
	TScore         int    `json:"t_score"`
	WinningTeam    string `json:"winning_team,omitempty"` // "CT" or "T"
	FreezeTimeTick int    `json:"freeze_time_tick"`       // Tick when freeze time ends
}

type MatchData struct {
	MapName          string      `json:"map_name"`
	TickRate         float64     `json:"tick_rate"`          // Frame-based tick rate (original / tickSkip)
	OriginalTickRate float64     `json:"original_tick_rate"` // Original demo tick rate (64 for CS2)
	Frames           []FrameData `json:"frames"`
	Rounds           []RoundData `json:"rounds"`
	Kills            []KillEvent `json:"kills"`
	CTScore          int         `json:"ct_score"`         // Final CT Score
	TScore           int         `json:"t_score"`          // Final T Score
	MatchStartTick   int         `json:"match_start_tick"` // Tick when match officially started (after knife/restarts)
}

func ParseDemo(r io.Reader) ([]byte, error) {
	p := dem.NewParser(r)
	defer p.Close()

	var mapName string
	p.RegisterNetMessageHandler(func(m *msg.CDemoFileHeader) {
		mapName = m.GetMapName()
	})

	frames := []FrameData{}
	rounds := []RoundData{}
	killEvents := []KillEvent{}

	ctScore := 0
	tScore := 0
	baseCTScore := 0 // Score to subtract (from knife round/warmup)
	baseTScore := 0
	matchStartTick := -1  // Will be set when match officially starts
	matchStarted := false // Flag to track if match has started

	type Stats struct {
		Kills   int
		Deaths  int
		Assists int
		HS      int
	}
	playerStats := make(map[uint64]*Stats)

	// Roster mapping: SteamID -> RosterIndex (1-10)
	// CT players: 1-5, T players: 6-10
	rosterMap := make(map[uint64]int)
	rosterBuilt := false

	getStats := func(id uint64) *Stats {
		if _, ok := playerStats[id]; !ok {
			playerStats[id] = &Stats{}
		}
		return playerStats[id]
	}

	p.RegisterEventHandler(func(e events.RoundEnd) {
		gs := p.GameState()

		// Only accumulate scores after match has started
		if matchStarted {
			// Subtract the base scores to get actual match score
			ctScore = gs.TeamCounterTerrorists().Score() - baseCTScore
			tScore = gs.TeamTerrorists().Score() - baseTScore
		}

		var winningTeam string
		if e.Winner == common.TeamCounterTerrorists {
			winningTeam = "CT"
		} else if e.Winner == common.TeamTerrorists {
			winningTeam = "T"
		}

		// Update the last round with scores and winning team
		if len(rounds) > 0 {
			rounds[len(rounds)-1].CTScore = ctScore
			rounds[len(rounds)-1].TScore = tScore
			rounds[len(rounds)-1].WinningTeam = winningTeam
		}
	})

	p.RegisterEventHandler(func(e events.Kill) {
		if e.Killer != nil {
			s := getStats(e.Killer.SteamID64)
			s.Kills++
			if e.IsHeadshot {
				s.HS++
			}
		}
		if e.Victim != nil {
			getStats(e.Victim.SteamID64).Deaths++
		}
		if e.Assister != nil {
			getStats(e.Assister.SteamID64).Assists++
		}

		ke := KillEvent{
			Tick:       p.GameState().IngameTick(),
			KillerID:   0,
			VictimID:   0,
			IsHeadshot: e.IsHeadshot,
			Weapon:     e.Weapon.String(),
		}
		if e.Killer != nil {
			ke.KillerID = e.Killer.SteamID64
		}
		if e.Victim != nil {
			ke.VictimID = e.Victim.SteamID64
		}
		if e.Assister != nil {
			ke.AssisterID = e.Assister.SteamID64
		}
		killEvents = append(killEvents, ke)
	})

	// Tracking utilities with unique IDs
	activeEffects := []GrenadeEffect{}
	effectIDCounter := int64(0)
	isBombPlanted := false
	currentFires := []WeaponFire{}
	currentTickFlashIDs := []int64{}

	p.RegisterEventHandler(func(e events.WeaponFire) {
		if e.Shooter != nil {
			currentFires = append(currentFires, WeaponFire{
				PlayerID: e.Shooter.SteamID64,
				Weapon:   e.Weapon.String(),
			})
		}
	})

	p.RegisterEventHandler(func(e events.PlayerFlashed) {
		// Attribute flash to all flashes that exploded in this tick
		for _, id := range currentTickFlashIDs {
			for i := range activeEffects {
				if activeEffects[i].ID == id {
					if e.Player.Team == common.TeamCounterTerrorists {
						activeEffects[i].FlashedCT++
					} else if e.Player.Team == common.TeamTerrorists {
						activeEffects[i].FlashedT++
					}
				}
			}
		}
	})

	// Constants for grenade durations (approximate for CS2)
	smokeDurationTicks := int(18.0 * 64.0)  // 18s * 64tick
	molotovDurationTicks := int(7.0 * 64.0) // 7s * 64tick
	flashDurationTicks := 32                // 0.5s visibility

	p.RegisterEventHandler(func(e events.SmokeStart) {
		effectIDCounter++
		start := p.GameState().IngameTick()
		var entityID int64 = -1
		if e.Grenade != nil && e.Grenade.Entity != nil {
			entityID = int64(e.Grenade.Entity.ID())
		}
		activeEffects = append(activeEffects, GrenadeEffect{
			ID:        effectIDCounter,
			EntityID:  entityID,
			Type:      "SMOKE",
			X:         e.Position.X,
			Y:         e.Position.Y,
			Z:         e.Position.Z,
			StartTick: start,
			EndTick:   start + smokeDurationTicks,
		})
	})

	p.RegisterEventHandler(func(e events.SmokeExpired) {
		if e.Grenade != nil && e.Grenade.Entity != nil {
			eid := int64(e.Grenade.Entity.ID())
			// Find and expire early
			for i := range activeEffects {
				if activeEffects[i].EntityID == eid && activeEffects[i].Type == "SMOKE" {
					activeEffects[i].EndTick = p.GameState().IngameTick()
				}
			}
		}
	})

	p.RegisterEventHandler(func(e events.FireGrenadeStart) {
		effectIDCounter++
		start := p.GameState().IngameTick()
		var entityID int64 = -1
		if e.Grenade != nil && e.Grenade.Entity != nil {
			entityID = int64(e.Grenade.Entity.ID())
		}
		activeEffects = append(activeEffects, GrenadeEffect{
			ID:        effectIDCounter,
			EntityID:  entityID,
			Type:      "MOLOTOV",
			X:         e.Position.X,
			Y:         e.Position.Y,
			Z:         e.Position.Z,
			StartTick: start,
			EndTick:   start + molotovDurationTicks,
		})
	})

	p.RegisterEventHandler(func(e events.FireGrenadeExpired) {
		if e.Grenade != nil && e.Grenade.Entity != nil {
			eid := int64(e.Grenade.Entity.ID())
			for i := range activeEffects {
				if activeEffects[i].EntityID == eid && activeEffects[i].Type == "MOLOTOV" {
					activeEffects[i].EndTick = p.GameState().IngameTick()
				}
			}
		}
	})

	p.RegisterEventHandler(func(e events.FlashExplode) {
		effectIDCounter++
		start := p.GameState().IngameTick()
		activeEffects = append(activeEffects, GrenadeEffect{
			ID:        effectIDCounter,
			Type:      "FLASH",
			X:         e.Position.X,
			Y:         e.Position.Y,
			Z:         e.Position.Z,
			StartTick: start,
			EndTick:   start + flashDurationTicks,
		})
		currentTickFlashIDs = append(currentTickFlashIDs, effectIDCounter)
	})

	p.RegisterEventHandler(func(e events.HeExplode) {
		effectIDCounter++
		start := p.GameState().IngameTick()
		activeEffects = append(activeEffects, GrenadeEffect{
			ID:        effectIDCounter,
			Type:      "HE",
			X:         e.Position.X,
			Y:         e.Position.Y,
			Z:         e.Position.Z,
			StartTick: start,
			EndTick:   start + 20,
		})
	})

	p.RegisterEventHandler(func(e events.BombPlanted) {
		isBombPlanted = true
	})

	p.RegisterEventHandler(func(e events.BombDefused) {
		isBombPlanted = false
	})

	p.RegisterEventHandler(func(e events.BombExplode) {
		isBombPlanted = false
	})

	// Append rounds only after the actual match has started (exclude pregame/knife/captain rounds)
	p.RegisterEventHandler(func(e events.RoundStart) {
		gs := p.GameState()
		if !gs.IsMatchStarted() {
			return
		}

		if !matchStarted {
			matchStarted = true
			matchStartTick = gs.IngameTick()
			// Capture scores at official start to exclude all pregame rounds
			baseCTScore = gs.TeamCounterTerrorists().Score()
			baseTScore = gs.TeamTerrorists().Score()
			// Initialize match scores to 0-0
			ctScore = 0
			tScore = 0

			// Build roster map at match start
			if !rosterBuilt {
				// Collect CT and T players, sorted by name for stability
				var ctPlayers []*common.Player
				var tPlayers []*common.Player

				for _, player := range gs.Participants().Playing() {
					if player.Team == common.TeamCounterTerrorists {
						ctPlayers = append(ctPlayers, player)
					} else if player.Team == common.TeamTerrorists {
						tPlayers = append(tPlayers, player)
					}
				}

				// Sort both teams by name for consistent ordering
				sort.Slice(ctPlayers, func(i, j int) bool {
					return ctPlayers[i].Name < ctPlayers[j].Name
				})
				sort.Slice(tPlayers, func(i, j int) bool {
					return tPlayers[i].Name < tPlayers[j].Name
				})

				// Assign roster indices: CT=1-5, T=6-10
				for i, player := range ctPlayers {
					rosterMap[player.SteamID64] = i + 1
				}
				for i, player := range tPlayers {
					rosterMap[player.SteamID64] = 6 + i
				}

				rosterBuilt = true
			}
		}

		roundNum := len(rounds) + 1
		rounds = append(rounds, RoundData{
			Number: roundNum,
			Tick:   gs.IngameTick(),
		})
		activeEffects = []GrenadeEffect{}
		isBombPlanted = false
	})

	// Track when freeze time ends for each round
	p.RegisterEventHandler(func(e events.RoundFreezetimeEnd) {
		if len(rounds) > 0 {
			rounds[len(rounds)-1].FreezeTimeTick = p.GameState().IngameTick()
		}
	})

	tickSkip := 4
	currentTickCount := 0

	p.RegisterEventHandler(func(e events.FrameDone) {
		currentTickCount++
		if currentTickCount%tickSkip != 0 {
			return
		}

		gameState := p.GameState()
		currentTick := gameState.IngameTick()
		currentPlayers := []PlayerData{}

		for _, player := range gameState.Participants().Playing() {
			teamName := "SPECTATOR"
			if player.Team == common.TeamTerrorists {
				teamName = "T"
			} else if player.Team == common.TeamCounterTerrorists {
				teamName = "CT"
			}

			rotation := player.ViewDirectionX()
			pos := player.Position()

			var weapons []WeaponData
			hasBomb := false
			activeWeaponName := ""

			activeWeapon := player.ActiveWeapon()
			if activeWeapon != nil {
				activeWeaponName = activeWeapon.String()
			}

			for _, w := range player.Weapons() {
				if w.Type == common.EqBomb {
					hasBomb = true
				}
				weapons = append(weapons, WeaponData{
					Name:  w.String(),
					Class: fmt.Sprintf("%v", w.Class()),
				})
			}

			stats := getStats(player.SteamID64)

			pData := PlayerData{
				ID:           player.SteamID64,
				Name:         player.Name,
				Team:         teamName,
				IsAlive:      player.IsAlive(),
				X:            pos.X,
				Y:            pos.Y,
				Z:            pos.Z,
				Rotation:     rotation,
				Hp:           player.Health(),
				Money:        player.Money(),
				Armor:        player.Armor(),
				HasHelmet:    player.HasHelmet(),
				HasDefuseKit: player.HasDefuseKit(),
				HasBomb:      hasBomb,
				ActiveWeapon: activeWeaponName,
				Weapons:      weapons,
				Kills:        stats.Kills,
				Deaths:       stats.Deaths,
				Assists:      stats.Assists,
				HS:           stats.HS,
				IsFlashed:    player.IsBlinded(),
				FlashMs:      int(player.FlashDurationTimeRemaining().Milliseconds()),
				RosterIndex:  rosterMap[player.SteamID64], // Will be 0 if not yet assigned (before match start)
			}
			currentPlayers = append(currentPlayers, pData)
		}

		// Filter active grenades
		visibleGrenades := []GrenadeEffect{}
		remainingEffects := []GrenadeEffect{}
		for _, eff := range activeEffects {
			if currentTick <= eff.EndTick {
				visibleGrenades = append(visibleGrenades, eff)
				remainingEffects = append(remainingEffects, eff)
			}
		}
		activeEffects = remainingEffects

		bomb := gameState.Bomb()
		bombData := BombData{
			X:         bomb.Position().X,
			Y:         bomb.Position().Y,
			Z:         bomb.Position().Z,
			IsPlanted: isBombPlanted,
		}
		if bomb.Carrier != nil {
			bombData.CarrierID = bomb.Carrier.SteamID64
		}

		projectiles := []ProjectileData{}
		for _, p := range gameState.GrenadeProjectiles() {
			projectiles = append(projectiles, ProjectileData{
				ID:   int64(p.Entity.ID()),
				Type: p.WeaponInstance.String(),
				X:    p.Position().X,
				Y:    p.Position().Y,
				Z:    p.Position().Z,
			})
		}

		frames = append(frames, FrameData{
			Tick:        currentTick,
			Players:     currentPlayers,
			Grenades:    visibleGrenades,
			Projectiles: projectiles,
			Fires:       currentFires,
			Bomb:        bombData,
		})
		currentFires = []WeaponFire{}
		currentTickFlashIDs = []int64{}
	})

	err := p.ParseToEnd()
	if err != nil && err != dem.ErrUnexpectedEndOfDemo {
		return nil, err
	}

	tickRate := p.TickRate()
	if tickRate <= 0 {
		tickRate = 64
	}

	// Store both original and frame-based tick rates
	originalTickRate := tickRate
	frameTickRate := tickRate / float64(tickSkip)

	matchData := MatchData{
		MapName:          mapName,
		TickRate:         frameTickRate,
		OriginalTickRate: originalTickRate,
		Frames:           frames,
		Rounds:           rounds,
		Kills:            killEvents,
		CTScore:          ctScore,
		TScore:           tScore,
		MatchStartTick:   matchStartTick,
	}

	jsonData, err := json.Marshal(matchData)
	if err != nil {
		return nil, err
	}

	return jsonData, nil
}
