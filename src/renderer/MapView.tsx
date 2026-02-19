import React, { useEffect, useRef } from "react";
import * as PIXI from "pixi.js";

interface PlayerData {
  id: number;
  name: string;
  team: string;
  is_alive: boolean;
  x: number;
  y: number;
  z: number;
  rotation: number;
  hp: number;
  has_bomb: boolean;
  kills: number;
  deaths: number;
  assists: number;
  hs: number;
  is_flashed: boolean;
  flash_ms: number;
  roster_index: number;
}

interface KillEvent {
  tick: number;
  killer_id: number;
  victim_id: number;
  assister_id?: number;
  is_headshot: boolean;
  weapon: string;
}

interface GrenadeEffect {
  id: number;
  type: string;
  x: number;
  y: number;
  z: number;
  start_tick: number;
  end_tick: number;
  flashed_ct?: number;
  flashed_t?: number;
}

interface BombData {
  x: number;
  y: number;
  z: number;
  is_planted: boolean;
  carrier_id?: number;
}

interface WeaponFire {
  player_id: number;
  weapon: string;
}

interface ProjectileData {
  id: number;
  type: string;
  x: number;
  y: number;
  z: number;
}

interface FrameData {
  tick: number;
  players: PlayerData[];
  grenades: GrenadeEffect[];
  projectiles: ProjectileData[];
  fires: WeaponFire[];
  bomb: BombData;
}

interface RoundData {
  number: number;
  tick: number;
  ct_score: number;
  t_score: number;
  winning_team?: string;
  freeze_time_tick: number;
}

interface MatchData {
  map_name: string;
  tick_rate: number;
  original_tick_rate: number;
  frames: FrameData[];
  kills: KillEvent[];
  rounds: RoundData[];
  ct_score: number;
  t_score: number;
  match_start_tick: number;
}

interface MapViewProps {
  data: MatchData;
  currentTick: number;
  setCurrentTick: (tick: number) => void;
  isPlaying: boolean;
  setIsPlaying: (playing: boolean) => void;
  playbackSpeed: number;
  selectedPlayerId: number | null;
  showNicknames: boolean;
  skipFreezeTime?: boolean;
}

interface MapConfig {
  mapName: string;
  radarImage: string;
  pos_x: number;
  pos_y: number;
  scale: number;
  zoom?: number;
  levels?: Array<{
    id: string;
    min_z: number;
    max_z: number;
  }>;
}

interface FireMask {
  width: number;
  height: number;
  blocked: Uint8Array;
}

interface FireSpreadSpot {
  angle: number;
  distance: number;
  radius: number;
  color: number;
}

interface FireSpreadProfile {
  radii: number[];
  spots: FireSpreadSpot[];
  maxRadius: number;
}

const MapView: React.FC<MapViewProps> = ({
  data,
  currentTick,
  setCurrentTick,
  isPlaying,
  setIsPlaying,
  playbackSpeed,
  selectedPlayerId,
  showNicknames,
  skipFreezeTime = true,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<PIXI.Application | null>(null);
  const playerSpritesRef = useRef<Map<number, PIXI.Container>>(new Map());
  const grenadeSpritesRef = useRef<Map<string, PIXI.Graphics>>(new Map());
  const bombSpriteRef = useRef<PIXI.Container | null>(null);
  const mapContainerRef = useRef<PIXI.Container | null>(null);
  const viewportRef = useRef<PIXI.Container | null>(null);
  const effectsContainerRef = useRef<PIXI.Container | null>(null);
  const activeEffectsRef = useRef<{ sprite: PIXI.Graphics; life: number }[]>(
    [],
  );

  // State for loaded map configuration
  const [mapConfig, setMapConfig] = React.useState<MapConfig>({
    mapName: data.map_name || "de_mirage",
    // default radar file should match the map (prevents 404 -> mirage fallback)
    radarImage: `${data.map_name || "de_mirage"}_radar.png`,
    pos_x: -3230,
    pos_y: 1713,
    scale: 5.0,
  });

  // Keep a ref copy of mapConfig so long-lived closures (PIXI ticker) always
  // read the most recent config (avoids stale-closure teleport issues).
  const mapConfigRef = React.useRef<MapConfig>(mapConfig);
  React.useEffect(() => {
    mapConfigRef.current = mapConfig;
  }, [mapConfig]);

  // Track grenade trajectories: ID -> Array of positions
  const trajectoriesRef = useRef<
    Map<number, { x: number; y: number; time: number }[]>
  >(new Map());
  
  // Track trajectory graphics: ID -> Graphics object (persistent)
  const trajectoryGraphicsRef = useRef<Map<number, PIXI.Graphics>>(new Map());
  const fireMaskRef = useRef<FireMask | null>(null);
  const fireSpreadProfilesRef = useRef<Map<string, FireSpreadProfile>>(
    new Map(),
  );

  // How long (ms) a trajectory point should remain visible before being
  // removed from the start of the line.
  const TRAJECTORY_LIFETIME_MS = 4000; // 4 seconds

  // Panning/Zooming state
  const interactionRef = useRef({
    isDragging: false,
    lastPos: { x: 0, y: 0 },
    zoom: 1,
  });

  const hashNoise = (value: number): number => {
    const n = Math.sin(value * 12.9898 + 78.233) * 43758.5453;
    return n - Math.floor(n);
  };

  const fireSeed = (id: number, x: number, y: number): number => {
    return id * 92821 + Math.round(x) * 73 + Math.round(y) * 193;
  };

  const isBlockedForFire = (x: number, y: number): boolean => {
    const mask = fireMaskRef.current;
    if (!mask) {
      return false;
    }

    const px = Math.round(x);
    const py = Math.round(y);

    if (px < 1 || py < 1 || px >= mask.width - 1 || py >= mask.height - 1) {
      return true;
    }

    const idx = py * mask.width + px;
    return mask.blocked[idx] === 1;
  };

  const getFireSpreadProfile = (
    grenade: GrenadeEffect,
    mapX: number,
    mapY: number,
  ): FireSpreadProfile => {
    const key = `${data.map_name}_${grenade.id}`;
    const existing = fireSpreadProfilesRef.current.get(key);
    if (existing) {
      return existing;
    }

    const rayCount = 28;
    const baseRadius = 34;
    const maxCandidateRadius = 60;
    const seed = fireSeed(grenade.id, mapX, mapY);
    let radii = new Array(rayCount).fill(baseRadius);

    for (let i = 0; i < rayCount; i++) {
      const angle = (i / rayCount) * Math.PI * 2;
      const variation = 0.72 + hashNoise(seed + i * 11.17) * 0.56;
      let targetRadius = baseRadius * variation + 8;

      if (fireMaskRef.current) {
        const maxSearch = Math.min(maxCandidateRadius, targetRadius + 16);
        let allowedRadius = 10;
        for (let distance = 10; distance <= maxSearch; distance += 2.5) {
          const sampleX = mapX + Math.cos(angle) * distance;
          const sampleY = mapY + Math.sin(angle) * distance;
          if (isBlockedForFire(sampleX, sampleY)) {
            break;
          }
          allowedRadius = distance;
        }
        targetRadius = Math.min(targetRadius, allowedRadius);
      }

      radii[i] = Math.max(10, Math.min(maxCandidateRadius, targetRadius));
    }

    for (let pass = 0; pass < 2; pass++) {
      const smoothed = [...radii];
      for (let i = 0; i < rayCount; i++) {
        const prev = radii[(i - 1 + rayCount) % rayCount];
        const curr = radii[i];
        const next = radii[(i + 1) % rayCount];
        smoothed[i] = curr * 0.65 + ((prev + next) / 2) * 0.35;
      }
      radii = smoothed;
    }

    const spots: FireSpreadSpot[] = [];
    for (let i = 0; i < 9; i++) {
      const spotAngle = (i / 9) * Math.PI * 2 + hashNoise(seed + i * 33.3) * 0.25;
      const rayIndex = Math.floor(((spotAngle % (Math.PI * 2)) / (Math.PI * 2)) * rayCount) % rayCount;
      const edge = radii[Math.max(0, rayIndex)];
      const spotDistance = Math.max(6, edge * (0.35 + hashNoise(seed + i * 17.77) * 0.45));
      const spotRadius = 4.5 + hashNoise(seed + i * 21.19) * 5.5;
      const color = i % 2 === 0 ? 0xff4a00 : 0xffbf2a;
      spots.push({
        angle: spotAngle,
        distance: spotDistance,
        radius: spotRadius,
        color,
      });
    }

    const profile: FireSpreadProfile = {
      radii,
      spots,
      maxRadius: radii.reduce((max, r) => Math.max(max, r), 0),
    };

    fireSpreadProfilesRef.current.set(key, profile);
    return profile;
  };

  const buildFireMaskFromPixels = (
    pixels: Uint8Array,
    width: number,
    height: number,
  ): FireMask => {
    const blocked = new Uint8Array(width * height);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const pixelIndex = (y * width + x) * 4;
        const r = pixels[pixelIndex];
        const g = pixels[pixelIndex + 1];
        const b = pixels[pixelIndex + 2];
        const a = pixels[pixelIndex + 3];

        const luminance = r * 0.2126 + g * 0.7152 + b * 0.0722;
        const isBlocked = a < 35 || luminance < 18;
        blocked[y * width + x] = isBlocked ? 1 : 0;
      }
    }

    const filtered = blocked.slice();
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        if (blocked[idx] === 0) continue;

        let darkNeighbors = 0;
        for (let oy = -1; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            if (ox === 0 && oy === 0) continue;
            const nIdx = (y + oy) * width + (x + ox);
            if (blocked[nIdx] === 1) darkNeighbors++;
          }
        }

        if (darkNeighbors <= 1) {
          filtered[idx] = 0;
        }
      }
    }

    return {
      width,
      height,
      blocked: filtered,
    };
  };

  // Use refs for values needed in the ticker to avoid closure issues
  const playbackRef = useRef({
    currentTick: currentTick,
    isPlaying: isPlaying,
    playbackSpeed: playbackSpeed,
    totalFrames: data.frames.length,
    tickRate: data.tick_rate,
    selectedPlayerId: selectedPlayerId,
    showNicknames: showNicknames,
    skipFreezeTime: skipFreezeTime,
    lastFrameTime: 0,
  });

  useEffect(() => {
    playbackRef.current.totalFrames = data.frames.length;
    playbackRef.current.tickRate = data.tick_rate;
  }, [data]);

  useEffect(() => {
    playbackRef.current.isPlaying = isPlaying;
    playbackRef.current.playbackSpeed = playbackSpeed;
    playbackRef.current.skipFreezeTime = skipFreezeTime;
  }, [isPlaying, playbackSpeed, skipFreezeTime]);

  useEffect(() => {
    playbackRef.current.selectedPlayerId = selectedPlayerId;
    playbackRef.current.showNicknames = showNicknames;
    // Force immediate re-render of current frame when selection or toggle changes
    renderTick(Math.floor(playbackRef.current.currentTick));
  }, [selectedPlayerId, showNicknames]);

  useEffect(() => {
    fireSpreadProfilesRef.current.clear();
    fireMaskRef.current = null;
  }, [data.map_name]);

  // Load map configuration from config.json
  useEffect(() => {
    const loadMapConfig = async () => {
      try {
        const mapName = data.map_name || "de_mirage";
        const finalPath = `assets/maps/${mapName}/config.json`;

        const response = await fetch(finalPath);
        if (response.ok) {
          const config = await response.json();
          setMapConfig(config);
        } else {
          console.warn(`Failed to load config for ${mapName}, attempting fallback to de_mirage`);
          // Try fallback to de_mirage config.json so we at least have sane coordinates
          try {
            const fallbackPath = "assets/maps/de_mirage/config.json";
            const fbResp = await fetch(fallbackPath);
            if (fbResp.ok) {
              const fbConfig = await fbResp.json();
              setMapConfig(fbConfig);
            } else {
              // If fallback also missing, at minimum set radar filename to match map
              setMapConfig((prev) => ({ ...prev, mapName, radarImage: `${mapName}_radar.png` }));
            }
          } catch (fbErr) {
            console.warn("Error loading fallback config:", fbErr);
            setMapConfig((prev) => ({ ...prev, mapName, radarImage: `${mapName}_radar.png` }));
          }
        }
      } catch (error) {
        console.warn("Error loading map config:", error);
      }
    };

    loadMapConfig();
  }, [data.map_name]);

  // When `mapConfig` or `data.map_name` changes, reload the radar sprite and rebuild fire mask
  useEffect(() => {
    const updateMapSprite = async () => {
      const app = appRef.current;
      const mapContainer = mapContainerRef.current;
      if (!app || !mapContainer) return;

      // Remove any existing base sprite (index 0) so we can replace it
      const existing = mapContainer.getChildAt(0);
      if (existing) {
        try {
          mapContainer.removeChild(existing);
          (existing as any).destroy?.({ children: true, texture: true });
        } catch (e) {
          // ignore
        }
      }

      const mapName = data.map_name || "de_mirage";
      const radarFilename = mapConfig.radarImage || `${mapName}_radar.png`;
      const finalPath = `assets/maps/${mapName}/${radarFilename}`;

      try {
        const texture = await PIXI.Assets.load(finalPath);
        const mapSprite = new PIXI.Sprite(texture);
        mapContainer.addChildAt(mapSprite, 0);

        // rebuild fire mask from texture pixels if available
        try {
          const extractSystem = (app.renderer as any).extract;
          if (extractSystem?.pixels) {
            const pixels = extractSystem.pixels(mapSprite) as Uint8Array;
            const width = Math.max(1, Math.round(mapSprite.width));
            const height = Math.max(1, Math.round(mapSprite.height));
            if (pixels && pixels.length >= width * height * 4) {
              fireMaskRef.current = buildFireMaskFromPixels(pixels, width, height);
              fireSpreadProfilesRef.current.clear();
            }
          }
        } catch (maskErr) {
          console.warn("Could not build fire spread mask from radar texture", maskErr);
          fireMaskRef.current = null;
        }

        // adjust initial zoom/position (same logic used on init)
        const canvasWidth = app.canvas.width;
        const canvasHeight = app.canvas.height;
        const mapWidth = mapSprite.width;
        const mapHeight = mapSprite.height;

        const scaleX = canvasWidth / mapWidth;
        const scaleY = canvasHeight / mapHeight;
        const initialZoom = Math.min(scaleX, scaleY) * 0.9;

        interactionRef.current.zoom = initialZoom;
        viewportRef.current?.scale.set(initialZoom);

        viewportRef.current!.x = (canvasWidth - mapWidth * initialZoom) / 2;
        viewportRef.current!.y = (canvasHeight - mapHeight * initialZoom) / 2;
      } catch (e) {
        console.warn(`Failed to load radar for ${data.map_name}, falling back to mirage`, e);
        try {
          const texture = await PIXI.Assets.load("/assets/maps/de_mirage/de_mirage_radar.png");
          const mapSprite = new PIXI.Sprite(texture);
          mapContainer.addChildAt(mapSprite, 0);
        } catch (err) {}
      }
    };

    updateMapSprite();
  }, [mapConfig.mapName, mapConfig.radarImage, data.map_name]);

  // Sync ref with external currentTick when it's changed from outside (seeking)
  useEffect(() => {
    if (Math.abs(playbackRef.current.currentTick - currentTick) > 1) {
      playbackRef.current.currentTick = currentTick;
      renderTick(Math.floor(currentTick));
    }
  }, [currentTick]);

  const worldToMap = (x: number, y: number) => {
    const cfg = mapConfigRef.current || mapConfig;
    // Guard against bad config values (avoid division by zero / NaN)
    const scale = Number(cfg?.scale) || 1;
    if (!isFinite(scale) || scale === 0) {
      return { x: 0, y: 0 };
    }

    const mapX = (x - (cfg.pos_x ?? 0)) / scale;
    const mapY = ((cfg.pos_y ?? 0) - y) / scale;
    return { x: mapX, y: mapY };
  };

  // Helper function to check if a frame index is in freeze time
  const isInFreezeTime = (frameIndex: number): boolean => {
    if (!playbackRef.current.skipFreezeTime || !data.rounds) {
      return false;
    }
    
    const frame = data.frames[frameIndex];
    if (!frame) return false;

    // Find which round this frame belongs to
    for (let i = data.rounds.length - 1; i >= 0; i--) {
      const round = data.rounds[i];
      const nextRound = data.rounds[i + 1];
      const nextRoundTick = nextRound ? nextRound.tick : data.frames[data.frames.length - 1].tick;
      
      if (frame.tick >= round.tick && frame.tick < nextRoundTick) {
        // Frame is in this round
        // Check if it's before freeze time ends
        const freezeTimeTick = (round as any).freeze_time_tick;
        return freezeTimeTick > 0 && frame.tick < freezeTimeTick;
      }
    }
    
    return false;
  };

  const renderTick = (frameIndex: number) => {
    const tickData = data.frames[frameIndex];
    if (!tickData || !mapContainerRef.current || !tickData.players) return;

    // Set all existing player containers to invisible first
    playerSpritesRef.current.forEach((container) => {
      container.visible = false;
    });

    const selectedPlayer = tickData.players.find(
      (p) => p.id === playbackRef.current.selectedPlayerId,
    );
    const selectedTeam = selectedPlayer?.team;

    tickData.players.forEach((player, index) => {
      let playerContainer = playerSpritesRef.current.get(player.id);

      if (!playerContainer) {
        playerContainer = new PIXI.Container();

        // 1. FOV Cone (Semi-transparent)
        const fov = new PIXI.Graphics();
        fov.name = "fov";
        fov
          .moveTo(0, 0)
          .arc(0, 0, 40, -Math.PI / 6, Math.PI / 6)
          .lineTo(0, 0)
          .fill({ color: 0xffffff, alpha: 0.2 });
        playerContainer.addChild(fov);

        // 2. Player Marker (Main Circle)
        const marker = new PIXI.Graphics();
        marker.name = "marker";
        const teamColor = player.team === "CT" ? 0x5d79ae : 0xde9b35;

        marker.circle(0, 0, 10);
        marker.fill(teamColor);
        marker.stroke({ width: 2, color: 0xffffff });

        // Direction Pointer
        marker.moveTo(10, 0);
        marker.lineTo(15, 0);
        marker.stroke({ width: 2, color: 0xffffff });

        playerContainer.addChild(marker);

        // 2b. HP Fill Bar (stored for updates)
        const hpBar = new PIXI.Graphics();
        hpBar.name = "hpBar";
        playerContainer.addChild(hpBar);

        // 3. Player Number Label (Inside Marker)
        // Use roster_index if assigned (>0), otherwise use fallback
        const displayNumber = player.roster_index > 0 ? player.roster_index : ((index % 5) + 1);
        const numberLabel = new PIXI.Text({
          text: displayNumber.toString(),
          style: {
            fontSize: 10,
            fill: 0xffffff,
            fontWeight: "bold",
            align: "center",
          },
        });
        numberLabel.anchor.set(0.5);
        playerContainer.addChild(numberLabel);

        // 4. Name Label (Above Marker)
        const nameText = new PIXI.Text({
          text: player.name,
          style: {
            fontSize: 12,
            fill: 0xffffff,
            align: "center",
            dropShadow: { alpha: 0.5, blur: 2, color: 0x000000, distance: 1 },
          },
        });
        nameText.name = "nameText";
        nameText.anchor.set(0.5, 1.8);
        playerContainer.addChild(nameText);

        // 5. Death Marker (Hidden by default)
        const deathMarker = new PIXI.Text({
          text: "💀",
          style: {
            fontSize: 16,
            align: "center",
          },
        });
        deathMarker.name = "deathMarker";
        deathMarker.anchor.set(0.5);
        deathMarker.visible = false;
        playerContainer.addChild(deathMarker);

        // 6. Flash indicator (hidden by default)
        const flashIndicator = new PIXI.Graphics();
        flashIndicator.name = "flashIndicator";
        flashIndicator.visible = false;
        playerContainer.addChild(flashIndicator);

        playerSpritesRef.current.set(player.id, playerContainer);
        mapContainerRef.current!.addChild(playerContainer);
      }

      playerContainer.visible = true;
      const coords = worldToMap(player.x, player.y);
      playerContainer.x = coords.x;
      playerContainer.y = coords.y;

      const isAlive = player.is_alive;
      const marker = playerContainer.getChildByName("marker") as PIXI.Graphics;
      const hpBar = playerContainer.getChildByName("hpBar") as PIXI.Graphics;
      const fov = playerContainer.getChildByName("fov") as PIXI.Graphics;
      const deathMarker = playerContainer.getChildByName(
        "deathMarker",
      ) as PIXI.Text;
      const nameText = playerContainer.getChildByName("nameText") as PIXI.Text;
      const flashIndicator = playerContainer.getChildByName(
        "flashIndicator",
      ) as PIXI.Graphics;

      const isSelected = player.id === playbackRef.current.selectedPlayerId;
      const isTeammate =
        selectedTeam && player.team === selectedTeam && !isSelected;

      // Update HP Bar (always, even for dead players)
      if (hpBar) {
        hpBar.clear();
        if (isAlive && player.hp > 0) {
          const hpPercent = Math.min(100, player.hp) / 100;
          const radius = 10;
          const arcRadius = radius * 0.85;
          
          // HP bar color: team color (bright)
          const barColor = player.team === "CT" ? 0x5da9f9 : 0xffdd00;
          
          // Background circle (dark gray) - shows max health outline
          hpBar.circle(0, 0, arcRadius);
          hpBar.fill({ color: 0x333333, alpha: 0.6 });
          
          // HP fill as a circular progress arc
          // Arc goes from top (-π/2) clockwise based on HP percentage
          if (hpPercent > 0) {
            const startAngle = -Math.PI / 2;
            const endAngle = startAngle + Math.PI * 2 * hpPercent;
            
            hpBar.moveTo(0, 0); // Move to center
            hpBar.arc(0, 0, arcRadius, startAngle, endAngle); // Draw arc to center
            hpBar.lineTo(0, 0); // Close back to center
            hpBar.fill(barColor);
          }
          
          // Add a bright outline stroke on the arc for extra visibility
          hpBar.moveTo(0, -arcRadius);
          const endAngle = -Math.PI / 2 + Math.PI * 2 * hpPercent;
          hpBar.arc(0, 0, arcRadius, -Math.PI / 2, endAngle);
          hpBar.stroke({ width: 1.5, color: 0xffffff, alpha: 0.8 });
        }
      }

      if (isAlive) {
        playerContainer.rotation = -player.rotation * (Math.PI / 180);
        marker.visible = true;
        fov.visible = true;
        deathMarker.visible = false;
        nameText.alpha = 1;
        nameText.visible = playbackRef.current.showNicknames;
        flashIndicator.clear();
        const flashIntensity = Math.min(1, Math.max(0, player.flash_ms / 2500));
        flashIndicator.visible = player.is_flashed && flashIntensity > 0;
        if (flashIndicator.visible) {
          const pulse = 1 + Math.sin(tickData.tick * 0.25) * 0.12;
          flashIndicator.circle(0, 0, 7 * pulse);
          flashIndicator.fill({ color: 0xffffcc, alpha: 0.5 + flashIntensity * 0.35 });
          flashIndicator.stroke({ width: 0.5, color: 0xffffff, alpha: 0.9 });
        }

        // Highlight selected player
        if (isSelected) {
          playerContainer.alpha = 1;
          marker
            .clear()
            .circle(0, 0, 12)
            .fill(player.team === "CT" ? 0x5d79ae : 0xde9b35)
            .stroke({ width: 4, color: 0x000000 }); // Black stroke for selected
          fov.alpha = 0.4;
          playerContainer.zIndex = 100; // Bring to front
        } else if (isTeammate) {
          playerContainer.alpha = 0.4; // Reduced opacity for teammates
          marker
            .clear()
            .circle(0, 0, 10)
            .fill(player.team === "CT" ? 0x5d79ae : 0xde9b35)
            .stroke({ width: 2, color: 0xffffff });
          fov.alpha = 0.2;
          playerContainer.zIndex = 0;
        } else {
          playerContainer.alpha = 1;
          marker
            .clear()
            .circle(0, 0, 10)
            .fill(player.team === "CT" ? 0x5d79ae : 0xde9b35)
            .stroke({ width: 2, color: 0xffffff });
          fov.alpha = 0.2;
          playerContainer.zIndex = 0;
        }
      } else {
        playerContainer.alpha = isTeammate ? 0.4 : 1;
        marker.visible = false;
        fov.visible = false;
        deathMarker.visible = true;
        flashIndicator.visible = false;
        nameText.alpha = 0.5;
        nameText.visible = playbackRef.current.showNicknames;
        playerContainer.rotation = 0; // Reset rotation for the skull
      }
    });

    // --- BOMB RENDERING ---
    if (tickData.bomb) {
      if (!bombSpriteRef.current) {
        const bombContainer = new PIXI.Container();
        const bombGraphic = new PIXI.Graphics();

        // Draw a red C4-like box or circle
        bombGraphic.rect(-6, -6, 12, 12);
        bombGraphic.fill(0xff0000);
        bombGraphic.stroke({ width: 2, color: 0xffffff });

        const bombLabel = new PIXI.Text({
          text: "💣",
          style: { fontSize: 14 },
        });
        bombLabel.anchor.set(0.5);

        bombContainer.addChild(bombGraphic);
        bombContainer.addChild(bombLabel);
        bombSpriteRef.current = bombContainer;
        mapContainerRef.current.addChild(bombContainer);
      }

      const bombPos = worldToMap(tickData.bomb.x, tickData.bomb.y);
      bombSpriteRef.current.x = bombPos.x;
      bombSpriteRef.current.y = bombPos.y;

      // Only show if planted OR not carried
      bombSpriteRef.current.visible =
        tickData.bomb.is_planted || !tickData.bomb.carrier_id;

      if (tickData.bomb.is_planted) {
        // Pulse effect for planted bomb
        const pulse = (Math.sin(Date.now() / 200) + 1) * 0.2 + 1;
        bombSpriteRef.current.scale.set(pulse);
      } else {
        bombSpriteRef.current.scale.set(1);
      }
    }

    // --- GRENADE RENDERING ---
    // Hide all existing grenade sprites first
    grenadeSpritesRef.current.forEach((g) => (g.visible = false));

    // Render Trajectories with persistent graphics
    const activeProjectileIds = new Set(
      tickData.projectiles?.map((p) => p.id) || [],
    );
    
    // First, hide all trajectory graphics
    trajectoryGraphicsRef.current.forEach((graphic) => {
      graphic.visible = false;
    });
    
    tickData.projectiles?.forEach((p) => {
      const pos = worldToMap(p.x, p.y);
      
      // Bounds check - skip if position is way out of reasonable range
      const mapSprite = mapContainerRef.current?.children[0] as PIXI.Sprite;
      if (mapSprite) {
        const mapWidth = mapSprite.width;
        const mapHeight = mapSprite.height;
        const margin = 200; // Allow some margin outside the map
        if (pos.x < -margin || pos.x > mapWidth + margin || 
            pos.y < -margin || pos.y > mapHeight + margin) {
          return; // Skip this projectile
        }
      }
      
      let history = trajectoriesRef.current.get(p.id) || [];
      // Only add if last pos is different
      if (
        history.length === 0 ||
        history[history.length - 1].x !== pos.x ||
        history[history.length - 1].y !== pos.y
      ) {
        history.push({ ...pos, time: Date.now() });
      }
      // Keep only last 100 points for smoother trajectories
      if (history.length > 100) history.shift();
      trajectoriesRef.current.set(p.id, history);

      // Get or create persistent trajectory graphic
      let line = trajectoryGraphicsRef.current.get(p.id);
      if (!line) {
        line = new PIXI.Graphics();
        trajectoryGraphicsRef.current.set(p.id, line);
        effectsContainerRef.current?.addChild(line);
      }
      
      // Redraw trajectory line with time-based trimming and fading from the start.
      const now = Date.now();

      // Trim history by lifetime so old points are removed from the start
      history = history.filter((pt) => now - pt.time <= TRAJECTORY_LIFETIME_MS);
      trajectoriesRef.current.set(p.id, history);

      line.clear();
      if (history.length > 1) {
        // Draw each segment with alpha based on age (older = more transparent)
        for (let i = 1; i < history.length; i++) {
          const prev = history[i - 1];
          const cur = history[i];
          const age = now - prev.time;
          const t = Math.max(0, Math.min(1, 1 - age / TRAJECTORY_LIFETIME_MS));

          // Use a slightly reduced max alpha so lines don't overpower map
          const segAlpha = t * 0.9;

          line.moveTo(prev.x, prev.y);
          line.lineTo(cur.x, cur.y);
          line.stroke({ width: 2, color: 0xffffff, alpha: segAlpha });
        }

        // Draw a small head dot for the most recent position
        const last = history[history.length - 1];
        line.circle(last.x, last.y, 3);
        line.fill({ color: 0xffffff, alpha: 1 });
      }
      line.visible = history.length > 0;
    });

    // Cleanup finished trajectories
    for (const id of trajectoriesRef.current.keys()) {
      if (!activeProjectileIds.has(id)) {
        trajectoriesRef.current.delete(id);
        // Remove and destroy the graphics object
        const graphic = trajectoryGraphicsRef.current.get(id);
        if (graphic) {
          graphic.destroy();
          trajectoryGraphicsRef.current.delete(id);
        }
      }
    }

    // Render Shoot Animations (Muzzle Flashes)
    tickData.fires?.forEach((f) => {
      // don't render muzzle flashes for melee/knife attacks
      const weaponName = (f.weapon || "").toString().toLowerCase();
      if (weaponName.includes("knife")) return;

      const shooter = tickData.players.find((p) => p.id === f.player_id);
      if (shooter) {
        const sPos = worldToMap(shooter.x, shooter.y);
        const flash = new PIXI.Graphics();

        // Calculate point in front of player based on rotation
        const angle = -shooter.rotation * (Math.PI / 180);
        const flashX = sPos.x + Math.cos(angle) * 15;
        const flashY = sPos.y + Math.sin(angle) * 15;

        flash.circle(flashX, flashY, 4);
        flash.fill({ color: 0xffff00, alpha: 0.8 });
        flash.stroke({ width: 2, color: 0xffa500, alpha: 0.5 });

        effectsContainerRef.current?.addChild(flash);
        activeEffectsRef.current.push({ sprite: flash, life: 0.1 }); // Very transient
      }
    });

    tickData.grenades?.forEach((grenade) => {
      const key = `${grenade.type}_${grenade.id}`;
      let gSprite = grenadeSpritesRef.current.get(key);

      if (!gSprite) {
        gSprite = new PIXI.Graphics();
        grenadeSpritesRef.current.set(key, gSprite);
        mapContainerRef.current!.addChild(gSprite);
      }

      gSprite.clear();
      const gPos = worldToMap(grenade.x, grenade.y);
      gSprite.x = gPos.x;
      gSprite.y = gPos.y;
      gSprite.visible = true;

      const totalTicks = grenade.end_tick - grenade.start_tick;
      const remainingTicks = grenade.end_tick - tickData.tick;
      const progress = Math.max(0, Math.min(1, remainingTicks / totalTicks));

      switch (grenade.type) {
        case "SMOKE":
          gSprite.circle(0, 0, 45);
          gSprite.fill({ color: 0xcccccc, alpha: 0.5 });
          // Animated stroke (countdown)
          if (progress > 0) {
            gSprite
              .moveTo(0, -45)
              .arc(
                0,
                0,
                45,
                -Math.PI / 2,
                -Math.PI / 2 + Math.PI * 2 * progress,
              )
              .stroke({ width: 3, color: 0xffffff, alpha: 0.8 });
          }
          break;
        case "MOLOTOV":
        case "INCENDIARY":
          const firePhase = tickData.tick * 0.15 + grenade.id;
          const spreadProfile = getFireSpreadProfile(grenade, gPos.x, gPos.y);
          const rayCount = spreadProfile.radii.length;

          const drawFirePolygon = (
            radiusScale: number,
            color: number,
            alpha: number,
            wobbleStrength: number,
          ) => {
            let firstX = 0;
            let firstY = 0;

            for (let i = 0; i < rayCount; i++) {
              const angle = (i / rayCount) * Math.PI * 2;
              const wobble =
                1 +
                Math.sin(firePhase * (1.2 + wobbleStrength * 0.3) + i * 0.65) *
                  wobbleStrength;
              const radius = spreadProfile.radii[i] * radiusScale * wobble;
              const px = Math.cos(angle) * radius;
              const py = Math.sin(angle) * radius;

              if (i === 0) {
                firstX = px;
                firstY = py;
                gSprite.moveTo(px, py);
              } else {
                gSprite.lineTo(px, py);
              }
            }

            gSprite.lineTo(firstX, firstY);
            gSprite.fill({ color, alpha });
          };

          drawFirePolygon(1.0, 0xff2c00, 0.22, 0.035);
          drawFirePolygon(0.78, 0xff7a00, 0.28, 0.045);
          drawFirePolygon(0.56, 0xffd24a, 0.34, 0.055);

          spreadProfile.spots.forEach((spot, index) => {
            const wobble = 1 + Math.sin(firePhase * 1.6 + index * 0.8) * 0.2;
            const spotX = Math.cos(spot.angle + firePhase * 0.02) * spot.distance;
            const spotY = Math.sin(spot.angle + firePhase * 0.02) * spot.distance;
            gSprite.circle(spotX, spotY, spot.radius * wobble);
            gSprite.fill({ color: spot.color, alpha: 0.3 });
          });

          // Animated stroke (countdown)
          if (progress > 0) {
            const strokeRadius = spreadProfile.maxRadius;
            gSprite
              .moveTo(0, -strokeRadius)
              .arc(
                0,
                0,
                strokeRadius,
                -Math.PI / 2,
                -Math.PI / 2 + Math.PI * 2 * progress,
              )
              .stroke({ width: 3, color: 0xffa500, alpha: 0.9 });
          }
          break;
        case "FLASH":
          // Flash burst effect (transient, fades out)
          const flashAlpha = Math.max(0, progress * 0.8);
          gSprite.circle(0, 0, 30);
          gSprite.fill({ color: 0xffffff, alpha: flashAlpha });
          gSprite.stroke({ width: 2, color: 0xffff00, alpha: flashAlpha });

          // Render flash count text (CT:1|T:2)
          if (grenade.flashed_ct !== undefined || grenade.flashed_t !== undefined) {
            const ctCount = grenade.flashed_ct || 0;
            const tCount = grenade.flashed_t || 0;
            if (ctCount > 0 || tCount > 0) {
              let flashLabel = gSprite.getChildByName("flashLabel") as PIXI.Text;
              if (!flashLabel) {
                flashLabel = new PIXI.Text({
                  text: "",
                  style: {
                    fontSize: 12,
                    fill: 0x000000,
                    fontWeight: "bold"
                  },
                });
                flashLabel.name = "flashLabel";
                flashLabel.anchor.set(0.5);
                gSprite.addChild(flashLabel);
              }
              flashLabel.text = `CT:${ctCount} | T:${tCount}`;
              flashLabel.alpha = Math.min(1, flashAlpha * 1.5);
              flashLabel.visible = true;
            } else {
              const flashLabel = gSprite.getChildByName("flashLabel");
              if (flashLabel) flashLabel.visible = false;
            }
          }
          break;
        case "HE":
          const heAlpha = Math.max(0, progress * 0.7);
          gSprite.circle(0, 0, 25);
          gSprite.fill({ color: 0x333333, alpha: heAlpha });
          gSprite.stroke({ width: 3, color: 0xff4500, alpha: heAlpha });
          break;
      }
    });
  };

  useEffect(() => {
    let active = true;
    const initPixi = async () => {
      const app = new PIXI.Application();
      await app.init({
        width: 1024,
        height: 1024,
        background: "#0b0e11",
        antialias: true,
      });

      if (!active) {
        app.destroy(true, { children: true, texture: true });
        return;
      }

      if (containerRef.current) {
        // Clear container to avoid double canvas if remounted quickly
        containerRef.current.innerHTML = "";
        containerRef.current.appendChild(app.canvas);

        // Panning and Zooming Events
        const canvas = app.canvas;

        canvas.addEventListener(
          "wheel",
          (e) => {
            e.preventDefault();
            const zoomSpeed = 0.001;
            const delta = -e.deltaY;
            const oldZoom = interactionRef.current.zoom;
            const newZoom = Math.min(
              Math.max(oldZoom + delta * zoomSpeed, 0.2),
              3,
            );

            if (viewportRef.current) {
              // Zoom towards mouse
              const rect = canvas.getBoundingClientRect();
              const mouseX = e.clientX - rect.left;
              const mouseY = e.clientY - rect.top;

              const worldPos = {
                x: (mouseX - viewportRef.current.x) / oldZoom,
                y: (mouseY - viewportRef.current.y) / oldZoom,
              };

              interactionRef.current.zoom = newZoom;
              viewportRef.current.scale.set(newZoom);

              viewportRef.current.x = mouseX - worldPos.x * newZoom;
              viewportRef.current.y = mouseY - worldPos.y * newZoom;
            }
          },
          { passive: false },
        );

        canvas.addEventListener("mousedown", (e) => {
          interactionRef.current.isDragging = true;
          interactionRef.current.lastPos = { x: e.clientX, y: e.clientY };
        });

        const handleMouseMove = (e: MouseEvent) => {
          if (!interactionRef.current.isDragging || !viewportRef.current)
            return;
          const dx = e.clientX - interactionRef.current.lastPos.x;
          const dy = e.clientY - interactionRef.current.lastPos.y;
          viewportRef.current.x += dx;
          viewportRef.current.y += dy;
          interactionRef.current.lastPos = { x: e.clientX, y: e.clientY };
        };

        const handleMouseUp = () => {
          interactionRef.current.isDragging = false;
        };

        window.addEventListener("mousemove", handleMouseMove);
        window.addEventListener("mouseup", handleMouseUp);

        // Remember to cleanup these window listeners in the useEffect return
        (app as any)._cleanup = () => {
          window.removeEventListener("mousemove", handleMouseMove);
          window.removeEventListener("mouseup", handleMouseUp);
        };
      }
      appRef.current = app;

      const viewport = new PIXI.Container();
      viewport.scale.set(1); // Start at scale 1, will be adjusted after loading
      viewport.x = 0;
      viewport.y = 0;
      app.stage.addChild(viewport);
      viewportRef.current = viewport;

      const mapContainer = new PIXI.Container();
      mapContainer.sortableChildren = true;
      viewport.addChild(mapContainer);
      mapContainerRef.current = mapContainer;

      const effectsContainer = new PIXI.Container();
      viewport.addChild(effectsContainer);
      effectsContainerRef.current = effectsContainer;

      try {
        // Load radar based on map name from data and config
        const mapName = data.map_name || "de_mirage";
        // Use radarImage filename from loaded config
        const radarFilename = mapConfig.radarImage || `${mapName}_radar.png`;
        const finalPath = `assets/maps/${mapName}/${radarFilename}`;

        const texture = await PIXI.Assets.load(finalPath);
        const mapSprite = new PIXI.Sprite(texture);
        mapContainer.addChildAt(mapSprite, 0);

        try {
          const extractSystem = (app.renderer as any).extract;
          if (extractSystem?.pixels) {
            const pixels = extractSystem.pixels(mapSprite) as Uint8Array;
            const width = Math.max(1, Math.round(mapSprite.width));
            const height = Math.max(1, Math.round(mapSprite.height));

            if (pixels && pixels.length >= width * height * 4) {
              fireMaskRef.current = buildFireMaskFromPixels(pixels, width, height);
              fireSpreadProfilesRef.current.clear();
            }
          }
        } catch (maskErr) {
          console.warn("Could not build fire spread mask from radar texture", maskErr);
          fireMaskRef.current = null;
        }

        // Calculate initial zoom and position to fit map with padding
        const canvasWidth = app.canvas.width;
        const canvasHeight = app.canvas.height;
        const mapWidth = mapSprite.width;
        const mapHeight = mapSprite.height;

        const scaleX = canvasWidth / mapWidth;
        const scaleY = canvasHeight / mapHeight;
        const initialZoom = Math.min(scaleX, scaleY) * 0.9; // 90% of screen to give good padding

        interactionRef.current.zoom = initialZoom;
        viewport.scale.set(initialZoom);

        // Center the map properly
        viewport.x = (canvasWidth - mapWidth * initialZoom) / 2;
        viewport.y = (canvasHeight - mapHeight * initialZoom) / 2;
      } catch (e) {
        console.warn(
          `Failed to load radar for ${data.map_name}, falling back to mirage`,
          e,
        );
        try {
          const texture = await PIXI.Assets.load(
            "/assets/maps/de_mirage/de_mirage_radar.png",
          );
          const mapSprite = new PIXI.Sprite(texture);
          mapContainer.addChildAt(mapSprite, 0);
        } catch (err) {}
      }

      app.ticker.add((ticker) => {
        activeEffectsRef.current.forEach((effect, index) => {
          effect.life -= 0.02 * ticker.deltaTime;
          effect.sprite.alpha = effect.life;
          effect.sprite.scale.set(1 + (1 - effect.life));

          if (effect.life <= 0) {
            effectsContainerRef.current?.removeChild(effect.sprite);
            activeEffectsRef.current.splice(index, 1);
          }
        });

        if (!playbackRef.current.isPlaying) {
          playbackRef.current.lastFrameTime = Date.now();
          return;
        }

        // Use real time for accurate playback speed regardless of screen refresh rate
        const now = Date.now();
        let deltaTimeMs = now - playbackRef.current.lastFrameTime;
        
        // Cap deltaTime to prevent huge jumps (e.g., tab switch)
        if (deltaTimeMs > 100) {
          deltaTimeMs = 100;
        }
        
        playbackRef.current.lastFrameTime = now;
        
        // Convert to frame advancement
        // tickRate is in frames per second, playbackSpeed is multiplier
        // deltaTimeMs is in milliseconds
        let deltaFrames = playbackRef.current.tickRate * 
                          playbackRef.current.playbackSpeed * 
                          (deltaTimeMs / 1000);
        
        // If skip freeze time is enabled and we're in freeze time, speed up advancement
        if (playbackRef.current.skipFreezeTime) {
          const currentFrameIndex = Math.floor(playbackRef.current.currentTick);
          if (isInFreezeTime(currentFrameIndex)) {
            // Jump forward faster during freeze time (5x speed)
            deltaFrames *= 5;
          }
        }
        
        playbackRef.current.currentTick += deltaFrames;

        if (
          playbackRef.current.currentTick >= playbackRef.current.totalFrames
        ) {
          playbackRef.current.currentTick = 0;
          setIsPlaying(false);
        }

        // Auto-skip to freeze time end when transitioning to a new round (if skipFreezeTime enabled)
        if (playbackRef.current.skipFreezeTime && playbackRef.current.isPlaying) {
          const currentFrameIndex = Math.floor(playbackRef.current.currentTick);
          const currentFrame = data.frames[currentFrameIndex];
          
          if (currentFrame) {
            const currentIngameTick = currentFrame.tick;
            
            // Find which round we're in
            let currentRoundIdx = 0;
            for (let i = data.rounds.length - 1; i >= 0; i--) {
              if (currentIngameTick >= data.rounds[i].tick) {
                currentRoundIdx = i;
                break;
              }
            }
            
            const currentRound = data.rounds[currentRoundIdx];
            
            // Check if we just entered a new round (transition point)
            // This happens when we cross from one round's tick range into another
            if (currentRoundIdx > 0) {
              const prevRound = data.rounds[currentRoundIdx - 1];
              const prevFrameIndex = Math.max(0, currentFrameIndex - 1);
              const prevFrame = data.frames[prevFrameIndex];
              const prevIngameTick = prevFrame?.tick || 0;
              
              // Detect transition: previous frame was in different round
              let prevRoundIdx = 0;
              for (let i = data.rounds.length - 1; i >= 0; i--) {
                if (prevIngameTick >= data.rounds[i].tick) {
                  prevRoundIdx = i;
                  break;
                }
              }
              
              // If we've moved into a new round, jump to its freeze time end
              if (prevRoundIdx !== currentRoundIdx && currentRound.freeze_time_tick) {
                const freezeTimeFrameIndex = data.frames.findIndex(
                  f => f.tick >= currentRound.freeze_time_tick
                );
                if (freezeTimeFrameIndex !== -1) {
                  playbackRef.current.currentTick = freezeTimeFrameIndex;
                }
              }
            }
          }
        }

        const frameIndex = Math.floor(playbackRef.current.currentTick);
        renderTick(frameIndex);
        setCurrentTick(frameIndex);
      });
    };

    initPixi();

    return () => {
      active = false;
      if (appRef.current) {
        if ((appRef.current as any)._cleanup)
          (appRef.current as any)._cleanup();
        appRef.current.destroy(true, { children: true, texture: true });
        appRef.current = null;
      }
    };
  }, []);

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <div
        ref={containerRef}
        style={{
          overflow: "hidden",
          maxWidth: "100%",
          maxHeight: "100%",
        }}
      ></div>
    </div>
  );
};

export default MapView;
