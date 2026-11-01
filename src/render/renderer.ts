import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { createRng, fork, nextU32 } from '../core/rng';
import { dirVec, getCell, type Vec2 } from '../core/grid';
import { MODIFIERS, getAffix, getModifier, getStatus } from '../content';
import { t, type TextKey } from '../i18n';
import {
  biomeOf,
  intentCells,
  type Enemy,
  type GameEvent,
  type GameState,
  type Intent,
  type Preview,
  type Room,
} from '../sim';
import { CameraRig, cellCenter } from './cameraRig';
import { HandsView } from './look/hands';
import { TORCH_AHEAD, TORCH_REACH, torchAheadFor, torchDimming } from './look/torch';
import { buildRoom, roomLook, type RoomMeshes } from './look/rooms';
import { setTextureStyle, type RenderStyle } from './look/textures';
import { CELL, WALL_H } from './dims';
import { Particles } from './fx';
import { Highlights, type Highlight } from './highlights';
import { SurfacesView } from './surfacesView';
import { AltarView } from './altarView';
import { NpcView } from './npcView';
import { DoorsView } from './doorsView';
import type { RewardKind, RoomGoal } from '../content';
import { UnitsView, type UnitVisual } from './unitsView';

export type Quality = 'high' | 'low';

// The MV look: stone lit by torches in the dark, fire that glows (bloom), the hero's own torch casting
// shadows and a vignette; filmic tone mapping. Everything stays sharp: no depth of field. Per-biome colours in look/rooms.
const FOG_COLOR = 0x0c0806;
const BACKGROUND = 0x0c0806;
const HEMI_INTENSITY = 1.5;
const TORCH_INTENSITY = 3.8;
/** A faint halo around flames, eyes and runes only: the threshold keeps lit stone out of it. */
const BLOOM = { strength: 0.16, radius: 0.25, threshold: 1.05 };
/** Retro pixels: the frame is rendered this many lines tall and scaled up without smoothing. */
const RETRO_LINES = 400;
export type { RenderStyle };
const MAX_PIXEL_RATIO = 1.5;

/** Fire-like flicker from a few incommensurate sines (no randomness, no state). */
const flicker = (s: number, a: number, b: number) => 0.82 + 0.11 * Math.sin(s * a) + 0.07 * Math.sin(s * b + 1.3);

/**
 * How long each event blocks the queue, in ms. Movement does not block: the player's step and every
 * enemy's step animate at the same time, so a turn reads as one quick beat. Hits play one by one.
 */
const EVENT_MS: Partial<Record<GameEvent['type'], number>> = {
  abilityUsed: 110,
  enemyAttack: 200,
  damaged: 130,
  pushed: 90,
  collided: 110,
  fell: 380,
  died: 260,
  allyAttack: 160,
  projectile: 150,
  area: 220,
  summoned: 300,
  teleported: 120,
  swapped: 160,
};
const MOVE_MS = 140;
const ENEMY_PHASE_PAUSE_MS = 0;
const FLOATER_MS = 900;
const STRIKE_MS = 350;
const ARROW_MS = 150;

/** A screen-space point in CSS pixels relative to the canvas. */
export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
  /** In front of the camera and inside the viewport. */
  readonly onScreen: boolean;
  /** Direction from screen centre in the horizontal plane: 0 = ahead, π/2 = right, ±π = behind. */
  readonly bearing: number;
}

export interface LabelUnit {
  readonly id: string;
  readonly isPlayer: boolean;
  /** A summon fighting for the players. */
  readonly ally: boolean;
  readonly type: string;
  /** Status icons to show over the unit (its elite trait and a goal star first). */
  readonly statuses: readonly string[];
  /** Elite trait, for the tooltip. */
  readonly affix: string | null;
  readonly hp: number;
  readonly maxHp: number;
  readonly intent: Intent | null;
  readonly head: ScreenPoint;
  readonly distance: number;
}

export interface Floater {
  readonly id: number;
  readonly at: ScreenPoint;
  readonly text: string;
  readonly kind: 'damage' | 'heal' | 'blocked' | 'info';
  /** 0..1 */
  readonly age: number;
}

export interface CellLabel {
  readonly at: ScreenPoint;
  readonly text: string;
  readonly kind: 'intent' | 'preview' | 'death';
}

/** An open door's reward label, pinned above its arch. */
export interface DoorLabel {
  readonly at: ScreenPoint;
  readonly reward: RewardKind;
  /** An altar's patron. */
  readonly patron?: string | undefined;
  /** The fight's goal behind the door (plain clearing when absent). */
  readonly goal?: RoomGoal | undefined;
}

/** Everything the HTML overlay needs to draw this frame. */
export interface FrameLabels {
  readonly doors: readonly DoorLabel[];
  readonly width: number;
  readonly height: number;
  readonly units: readonly LabelUnit[];
  readonly floaters: readonly Floater[];
  readonly cells: readonly CellLabel[];
  readonly topView: number;
  /** True while enemy actions are playing back. */
  readonly enemyPhase: boolean;
}

interface Playing {
  readonly event: GameEvent;
  readonly start: number;
  readonly dur: number;
}

interface FloatingNumber {
  id: number;
  world: THREE.Vector3;
  text: string;
  kind: Floater['kind'];
  start: number;
}

export class GameRenderer {
  readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.05, 120);
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly fog = new THREE.FogExp2(FOG_COLOR, 0.06);
  private fogDensity = 0.06;
  private style: RenderStyle = 'smooth';
  private flickerFrame = 0;
  private readonly hemi = new THREE.HemisphereLight(0x5a2a70, 0x501008, HEMI_INTENSITY);
  // Shallow falloff: bright enough across the room without blowing out walls at arm's length.
  private readonly torch = new THREE.PointLight(0xffb070, TORCH_INTENSITY, 18, 1.1);
  // A soft warm fill on what the hero holds, from the same torch.
  /**
   * The hands are drawn in a pass of their own, over the room, with their own steady light: the torch
   * right above them would burn them white, and they never poke into a wall.
   */
  private readonly handsScene = new THREE.Scene();
  private readonly handsCamera = new THREE.PerspectiveCamera(70, 1, 0.05, 10);
  private readonly handsAmbient = new THREE.HemisphereLight(0x5a4c3c, 0x140c08, 1.6);
  private readonly handsKey = new THREE.DirectionalLight(0xffc890, 1.4);
  private readonly topLight = new THREE.AmbientLight(0xc8a890, 0);
  private readonly marker: THREE.Mesh;
  private readonly fx = new Particles();
  private readonly unitsView = new UnitsView(this.fx);
  private readonly highlights = new Highlights();
  private readonly hands = new HandsView();
  private room: RoomMeshes | null = null;
  private grid: GameState['room']['grid'] | null = null;
  private torchAhead = TORCH_AHEAD;
  private readonly tmpA = new THREE.Vector3();
  private readonly tmpB = new THREE.Vector3();
  private roomLights: { light: THREE.PointLight; base: number; a: number; b: number }[] = [];
  private rig: CameraRig | null = null;
  private currentRoom: Room | null = null;
  /** Which room the scene shows (seed + room number): a new one rebuilds the cave. */
  private roomKey = '';
  private playerIds = new Set<string>();
  private quality: Quality = 'high';

  /** Events waiting to be animated, and the state they lead to. */
  private queue: GameEvent[] = [];
  private playing: Playing | null = null;
  private target_: GameState | null = null;
  private enemyPhase = false;
  private needsSync = false;
  private preview: { preview: Preview; target: Vec2; options: readonly Vec2[] } | null = null;
  private readonly surfacesView = new SurfacesView();
  private readonly doorsView = new DoorsView();
  private readonly altarView = new AltarView();
  private readonly npcView = new NpcView();
  private blasts: { cells: readonly Vec2[]; start: number }[] = [];
  private strikes: { cells: readonly Vec2[]; start: number }[] = [];
  private floaters: FloatingNumber[] = [];
  private floaterSeq = 0;
  /** Called when a hit on a player is animated (not when it is simulated). */
  onPlayerHit: ((hp: number, now: number) => void) | null = null;
  private cssW = 1;
  private cssH = 1;

  constructor(container: HTMLElement, quality: Quality = 'high') {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.35;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.autoUpdate = false;
    this.canvas = this.renderer.domElement;
    this.canvas.className = 'game-canvas';
    container.appendChild(this.canvas);

    // Multisampled, so edges are smooth in the smooth style.
    this.composer = new EffectComposer(
      this.renderer,
      new THREE.WebGLRenderTarget(4, 4, { samples: 4, type: THREE.HalfFloatType }),
    );
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    const handsPass = new RenderPass(this.handsScene, this.handsCamera);
    handsPass.clear = false;
    handsPass.clearDepth = true;
    this.composer.addPass(handsPass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), BLOOM.strength, BLOOM.radius, BLOOM.threshold);
    this.composer.addPass(this.bloom);
    this.composer.addPass(
      new ShaderPass({
        uniforms: { tDiffuse: { value: null } },
        vertexShader:
          'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
          void main(){ vec4 c = texture2D(tDiffuse, vUv);
          gl_FragColor = vec4(c.rgb * mix(0.55, 1.0, smoothstep(0.95, 0.3, length(vUv - 0.5))), c.a); }`,
      }),
    );
    this.composer.addPass(new OutputPass());

    this.scene.background = new THREE.Color(BACKGROUND);
    this.scene.fog = this.fog;
    this.scene.add(
      this.hemi,
      this.topLight,
      this.camera,
      this.unitsView.group,
      this.surfacesView.group,
      this.doorsView.group,
      this.altarView.group,
      this.npcView.group,
      this.highlights.group,
      this.fx.group,
    );
    // The hero's torch: ahead and above, lighting what stands in front and throwing shadows back.
    this.camera.add(this.torch);
    this.handsCamera.add(this.hands.group, this.handsKey);
    this.handsScene.add(this.handsCamera, this.handsAmbient);
    this.handsKey.position.set(0.6, 1.5, 0.4);
    this.handsKey.target.position.set(0, -0.4, -0.6);
    this.handsCamera.add(this.handsKey.target);
    this.torch.position.set(0.2, 0.9, -TORCH_AHEAD);
    this.torch.castShadow = true;
    this.torch.shadow.mapSize.set(256, 256);
    // Shadows are redrawn every other frame (see render): a cube shadow map renders the scene six times.
    this.torch.shadow.bias = -0.002;

    // Player marker, only visible from above.
    const markerGeo = new THREE.ConeGeometry(CELL * 0.28, CELL * 0.6, 3);
    markerGeo.rotateX(-Math.PI / 2); // point along −Z (north at yaw 0)
    this.marker = new THREE.Mesh(markerGeo, new THREE.MeshBasicMaterial({ color: 0xffc04a, fog: false }));
    this.marker.visible = false;
    this.scene.add(this.marker);

    this.quality = quality;
    this.resize();
  }

  /** True when WebGL runs on the CPU (SwiftShader, llvmpipe…): full quality would crawl there. */
  isSoftwareRendered(): boolean {
    const gl = this.renderer.getContext();
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    return /swiftshader|llvmpipe|software|basic render/i.test(name);
  }

  /** High: full pixel density (up to 2×), bloom, shadows and particles. Low: 1×, none of those. */
  setQuality(q: Quality): void {
    this.quality = q;
    this.fx.enabled = q === 'high';
    this.torch.castShadow = q === 'high';
    this.resize();
  }

  /** Builds the room in its biome's look, its torches and particles. */
  private buildRoom(state: GameState): void {
    if (this.room) {
      this.scene.remove(this.room.group);
      this.room.dispose();
    }
    this.roomLights = [];
    const depth = state.run?.depth ?? 1;
    const act = state.run?.act ?? 1;
    const seed = nextU32(
      fork(createRng(state.seed), act > 1 ? `cave:a${act}:${depth}` : depth === 1 ? 'cave' : `cave:${depth}`),
    );
    const look = roomLook(biomeOf(state).id);
    // The cathedral's boss hall: a carpet from the way in to the far end.
    const spawn = state.room.spawn;
    const d = dirVec(spawn.dir);
    const carpet =
      biomeOf(state).id === 'cathedral' && state.run?.kind === 'boss'
        ? { x: spawn.x, y: spawn.y, dx: d.x, dy: d.y }
        : null;
    this.room = buildRoom(state.room.grid, look, seed, carpet);
    this.grid = state.room.grid;
    this.scene.add(this.room.group);
    this.fog.color.setHex(look.fog);
    this.fogDensity = look.fogDensity;
    (this.scene.background as THREE.Color).setHex(look.fog);
    this.hemi.color.setHex(look.ambient);
    this.hemi.groundColor.setHex(look.ambientGround);
    this.handsAmbient.color.setHex(look.ambient);
    this.handsAmbient.groundColor.setHex(look.ambientGround);
    this.renderer.toneMappingExposure = look.exposure;
    for (const [i, l] of this.room.lights.entries())
      this.roomLights.push({ light: l.light, base: l.base, a: 9.1 + i, b: 23.7 - i * 0.7 });

    const g = state.room.grid;
    const open: THREE.Vector3[] = [];
    for (let y = 0; y < g.h; y++)
      for (let x = 0; x < g.w; x++)
        if (getCell(g, x, y) !== 'wall' && getCell(g, x, y) !== 'door') open.push(cellCenter({ x, y }));
    this.fx.setRoom(open, CELL, this.room.torches);
  }

  /**
   * The hero's torch backs off from the wall ahead and dims as it nears it: a light pressed against
   * stone blows it out to white. It never comes back over the hands, which would burn out instead.
   */
  private placeTorch(): void {
    const g = this.grid;
    if (!g) return;
    const from = this.camera.getWorldPosition(this.tmpA);
    const dir = this.camera.getWorldDirection(this.tmpB).setY(0);
    if (dir.lengthSq() < 1e-6) return;
    dir.normalize();
    // A creature in the way stops the torch short too (without dimming it), so it lights the creature's
    // front instead of hanging over its head.
    const creatures = new Set<string>();
    for (const u of this.unitsView.units.values()) if (!u.isPlayer && u.alive) creatures.add(`${u.cell.x},${u.cell.y}`);
    const own = `${Math.floor(from.x / CELL)},${Math.floor(from.z / CELL)}`;
    let free = TORCH_REACH;
    let toCreature = TORCH_REACH;
    for (let d = 0.1; d <= free; d += 0.1) {
      const x = Math.floor((from.x + dir.x * d) / CELL);
      const y = Math.floor((from.z + dir.z * d) / CELL);
      const cell = getCell(g, x, y);
      if (cell === 'wall' || cell === 'door' || cell === 'pillar') {
        free = d;
        break;
      }
      const k = `${x},${y}`;
      if (toCreature === TORCH_REACH && k !== own && creatures.has(k)) toCreature = d;
    }
    this.torchAhead += (torchAheadFor(free, toCreature) - this.torchAhead) * 0.25;
    this.torch.position.z = -this.torchAhead;
    this.torch.intensity *= torchDimming(free - this.torchAhead);
  }

  /** Smooth (full resolution, smoothed edges and textures) or retro pixels (a low-resolution frame scaled up). */
  setStyle(style: RenderStyle): void {
    this.style = style;
    setTextureStyle(style);
    this.canvas.style.imageRendering = style === 'retro' ? 'pixelated' : 'auto';
    this.resize();
  }

  /**
   * Shows `state` immediately, without animation: a new room (rebuilds geometry when the seed changes),
   * a restart, or an undo.
   */
  reset(state: GameState, now: number): void {
    const player = state.players[0];
    if (!player) return;
    const key = `${state.seed}:${state.run?.act ?? 1}:${state.run?.depth ?? 0}`;
    if (key !== this.roomKey) {
      this.roomKey = key;
      this.buildRoom(state);
      this.currentRoom = state.room;
      this.unitsView.clear();
    }
    this.playerIds = new Set(state.players.map((p) => p.id));
    this.queue = [];
    this.playing = null;
    this.target_ = state;
    this.enemyPhase = false;
    this.needsSync = false;
    this.strikes = [];
    this.blasts = [];
    this.floaters = [];
    this.unitsView.sync(state);
    this.surfacesView.sync(state);
    this.doorsView.sync(state);
    this.altarView.sync(state);
    this.npcView.sync(state);
    this.hands.setClass(player.classId);
    if (this.rig) this.rig.snap(state.room, player, now);
    else this.rig = new CameraRig(this.camera, state.room, player, now);
    this.rig.setRoom(state.room, this.topMargins());
  }

  /** Queues the events of one command for playback; `state` is where they lead. */
  play(events: readonly GameEvent[], state: GameState): void {
    this.queue.push(...events);
    this.target_ = state;
    this.needsSync = true;
  }

  /** The ability preview to draw (target cell, push path, damage numbers), or null. */
  /** The ability preview to draw: valid target cells, the chosen one, pushes, blasts, numbers. */
  setPreview(preview: Preview | null, target: Vec2 | null, options: readonly Vec2[] = []): void {
    this.preview = preview && target ? { preview, target, options } : null;
  }

  /**
   * The floor cell under a screen point (normalised device coordinates, −1..1), or null when the ray
   * misses the floor. Used to aim with the crosshair or the mouse cursor.
   */
  cellAt(ndcX: number, ndcY: number): Vec2 | null {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const hit = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
    if (!hit) return null;
    return { x: Math.floor(hit.x / CELL), y: Math.floor(hit.z / CELL) };
  }

  private floater(unitId: string | null, text: string, kind: Floater['kind'], now: number): void {
    const u = unitId ? this.unitsView.units.get(unitId) : undefined;
    const onScreen = !u || u.isPlayer;
    this.floaters.push({
      id: this.floaterSeq++,
      world: onScreen ? new THREE.Vector3() : this.unitsView.headPosition(u),
      text,
      kind,
      start: now,
    });
  }

  look(dx: number, dy: number): void {
    this.rig?.look(dx, dy);
  }

  /** −1 / +1 when the mouse look has gone past 45° right / left of the body (see CameraRig.lookTurn). */
  lookTurn(): -1 | 0 | 1 {
    return this.rig?.lookTurn() ?? 0;
  }

  expectMouseTurn(): void {
    this.rig?.expectMouseTurn();
  }

  /** Screen fractions the top-view framing keeps clear: the progress bar and labels above the top doors. */
  private topMargins(): { top: number; bottom: number } {
    return { top: Math.min(0.3, 90 / Math.max(1, this.cssH)), bottom: Math.min(0.2, 30 / Math.max(1, this.cssH)) };
  }

  setTopView(on: boolean, now: number): void {
    this.rig?.setTopView(on, now);
  }

  /** True while anything is still animating; new commands wait until it is done. */
  isBusy(now: number): boolean {
    return (
      this.playing !== null ||
      this.queue.length > 0 ||
      (this.rig?.isBusy(now) ?? false) ||
      this.unitsView.isAnimating(now) ||
      this.fx.isBusy(now)
    );
  }

  resize(): void {
    const parent = this.canvas.parentElement;
    this.cssW = parent?.clientWidth || window.innerWidth;
    this.cssH = parent?.clientHeight || window.innerHeight;
    const full = this.quality === 'high' ? Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO) : 1;
    const ratio = this.style === 'retro' ? Math.min(full, RETRO_LINES / Math.max(1, this.cssH)) : full;
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(this.cssW, this.cssH, false);
    this.composer.setPixelRatio(ratio);
    this.composer.setSize(this.cssW, this.cssH);
    this.camera.aspect = this.cssW / Math.max(1, this.cssH);
    this.camera.updateProjectionMatrix();
    this.handsCamera.fov = this.camera.fov;
    this.handsCamera.aspect = this.camera.aspect;
    this.handsCamera.updateProjectionMatrix();
    // Re-fit the overhead view to the new aspect ratio, leaving room for the progress bar and door labels.
    if (this.rig && this.currentRoom) this.rig.setRoom(this.currentRoom, this.topMargins());
  }

  // ---- event playback -------------------------------------------------------------------------

  private advance(now: number): void {
    const rig = this.rig;
    if (!rig) return;
    while (true) {
      if (this.playing && now - this.playing.start < this.playing.dur) return;
      this.playing = null;
      const event = this.queue.shift();
      if (!event) {
        // Done: snap once to the authoritative state in case any animation drifted.
        if (this.needsSync && this.target_) {
          this.needsSync = false;
          this.enemyPhase = false;
          this.unitsView.sync(this.target_);
          this.surfacesView.sync(this.target_);
          this.doorsView.sync(this.target_, now);
          this.altarView.sync(this.target_);
          this.npcView.sync(this.target_);
        }
        return;
      }
      const dur = this.startEvent(event, now);
      if (dur > 0) this.playing = { event, start: now, dur };
    }
  }

  /** Starts animating one event; returns how long to wait before the next one. */
  private startEvent(e: GameEvent, now: number): number {
    const rig = this.rig as CameraRig;
    const v = this.unitsView;
    const isPlayer = 'unitId' in e && this.playerIds.has(e.unitId);
    switch (e.type) {
      case 'moved':
        if (isPlayer) rig.onEvent(e, now);
        else v.moveTo(e.unitId, e.to, now, MOVE_MS);
        return 0;
      case 'turned':
        if (isPlayer) rig.onEvent(e, now);
        else {
          const u = v.units.get(e.unitId);
          if (u) u.dir = e.to;
        }
        return 0;
      case 'bumped':
        rig.onEvent(e, now);
        return 0;
      case 'abilityUsed':
        rig.onEvent(e, now);
        if (isPlayer) this.hands.swing(now);
        this.strikes.push({ cells: [e.target], start: now });
        return EVENT_MS.abilityUsed ?? 0;
      case 'enemyAttack': {
        const u = v.units.get(e.unitId);
        if (u) {
          u.intent = null;
          const first = e.cells[0] ?? {
            x: u.cell.x + [0, 1, 0, -1][e.intent.dir]!,
            y: u.cell.y + [-1, 0, 1, 0][e.intent.dir]!,
          };
          v.lungeTowards(e.unitId, first, now, EVENT_MS.enemyAttack ?? 0, e.intent.kind === 'melee' ? 0.7 : 0.25);
          v.strike(e.unitId, now);
          if (e.intent.kind === 'line') {
            const end = e.cells[e.cells.length - 1] ?? first;
            this.fx.arrow(v.muzzle(u), cellCenter(end).setY(1.05), now, ARROW_MS);
          }
        }
        this.strikes.push({ cells: e.cells, start: now });
        return EVENT_MS.enemyAttack ?? 0;
      }
      case 'damaged': {
        const u = v.units.get(e.unitId);
        if (u) {
          u.hp = e.hp;
          v.flash(e.unitId, now);
          if (e.absorbed > 0) this.floater(e.unitId, `🛡-${e.absorbed}`, 'blocked', now);
          if (e.amount > 0 || e.absorbed === 0)
            this.floater(
              e.unitId,
              e.amount > 0 ? `-${e.amount}${e.backstab ? ' ✶' : ''}` : '0',
              e.amount > 0 ? 'damage' : 'blocked',
              now,
            );
        }
        if (isPlayer) {
          rig.onEvent(e, now);
          this.onPlayerHit?.(e.hp, now);
        }
        return EVENT_MS.damaged ?? 0;
      }
      case 'pushed':
        v.moveTo(e.unitId, e.to, now, EVENT_MS.pushed ?? 0);
        return EVENT_MS.pushed ?? 0;
      case 'collided':
        v.lungeTowards(e.unitId, e.at, now, EVENT_MS.collided ?? 0, 0.35);
        return EVENT_MS.collided ?? 0;
      case 'fell':
        v.die(e.unitId, now, EVENT_MS.fell ?? 0, true);
        return EVENT_MS.fell ?? 0;
      case 'fled':
        v.die(e.unitId, now, EVENT_MS.died ?? 0, false);
        return 0;
      case 'revived':
        this.floater(e.unitId, `✚ ${e.hp}`, 'info', now);
        return EVENT_MS.died ?? 0;
      case 'died':
        if (isPlayer) {
          rig.onEvent(e, now);
          return 700;
        }
        v.die(e.unitId, now, EVENT_MS.died ?? 0, false);
        return EVENT_MS.died ?? 0;
      case 'intentDeclared': {
        const u = v.units.get(e.unitId);
        if (u) u.intent = e.intent;
        return 0;
      }
      case 'intentCanceled': {
        const u = v.units.get(e.unitId);
        if (u) u.intent = null;
        return 0;
      }
      case 'teleported':
        if (isPlayer) rig.onEvent(e, now);
        else v.moveTo(e.unitId, e.to, now, EVENT_MS.teleported ?? 0);
        this.fx.splash(cellCenter(e.from).setY(1), now, 14);
        return EVENT_MS.teleported ?? 0;
      case 'swapped':
        if (isPlayer) rig.onEvent(e, now);
        else v.moveTo(e.unitId, e.to, now, EVENT_MS.swapped ?? 0);
        v.moveTo(e.otherId, e.from, now, EVENT_MS.swapped ?? 0);
        return EVENT_MS.swapped ?? 0;
      case 'allyAttack':
        v.lungeTowards(e.unitId, e.target, now, EVENT_MS.allyAttack ?? 0, 0.7);
        v.strike(e.unitId, now);
        return EVENT_MS.allyAttack ?? 0;
      case 'projectile': {
        const from = cellCenter(e.from).setY(isPlayer ? 1.15 : 1.05);
        this.fx.arrow(from, cellCenter(e.to).setY(1.05), now, EVENT_MS.projectile ?? 0);
        return EVENT_MS.projectile ?? 0;
      }
      case 'area':
        this.blasts.push({ cells: e.cells, start: now });
        this.fx.splash(cellCenter(e.center).setY(0.8), now, 50);
        return EVENT_MS.area ?? 0;
      case 'summoned':
        v.spawn(e.unitId, e.summon, e.side === 'heroes', e.at, e.dir, e.hp, now);
        this.surfacesView.remove('corpse', e.at);
        return EVENT_MS.summoned ?? 0;
      case 'resisted':
        this.floater(e.unitId, t('status.resisted'), 'blocked', now);
        return 0;
      case 'phaseEntered': {
        const u = v.units.get(e.unitId);
        if (u) this.floater(e.unitId, '‼', 'damage', now);
        return EVENT_MS.died ?? 0;
      }
      case 'statusApplied':
      case 'statusExpired':
        v.setStatus(e.unitId, e.status, e.type === 'statusApplied');
        if (e.type === 'statusApplied')
          this.floater(
            e.unitId,
            `${getStatus(e.status).icon} ${t(getStatus(e.status).nameKey as TextKey)}`,
            'info',
            now,
          );
        return 0;
      case 'doorsOpened':
      case 'rewardTaken':
      case 'rewardOffered':
        if (this.target_) {
          this.doorsView.sync(this.target_, now);
          this.altarView.sync(this.target_);
          this.npcView.sync(this.target_);
        }
        return 0;
      case 'surfaceAdded':
        this.surfacesView.add(e.surface, e.at);
        return 0;
      case 'surfaceRemoved':
        this.surfacesView.remove(e.surface, e.at);
        return 0;
      case 'healed':
        if (e.amount > 0) this.floater(e.unitId, `+${e.amount}`, 'heal', now);
        return 0;
      case 'freeActionGained':
        this.floater(null, t('hud.freeAction'), 'info', now);
        return 0;
      case 'triggered':
        // Name the modifier that just fired, so combos read as combos.
        if (MODIFIERS.some((m) => m.id === e.rule))
          this.floater(e.ownerId, `✦ ${t(getModifier(e.rule).nameKey as TextKey)}`, 'info', now);
        return 0;
      case 'chainLimit':
        console.info(`Trigger chain cut at depth ${e.depth}`);
        return 0;
      case 'goldGained':
        this.floater(this.target_?.players[0]?.id ?? null, t('hud.goldGained', { n: e.amount }), 'info', now);
        return 0;
      case 'eventChosen':
        if (this.target_) {
          this.npcView.sync(this.target_);
          this.doorsView.sync(this.target_, now);
        }
        return 0;
      case 'phaseChanged':
        this.enemyPhase = e.phase === 'enemy';
        return this.enemyPhase ? ENEMY_PHASE_PAUSE_MS : 0;
      default:
        return 0;
    }
  }

  // ---- drawing ----------------------------------------------------------------------------------

  /** Units as the renderer currently shows them, shaped like sim state so sim helpers can read them. */
  private visibleState(): GameState | null {
    const base = this.target_;
    if (!base) return null;
    const players = [...this.unitsView.units.values()]
      .filter((u) => u.isPlayer)
      .map((u) => ({ id: u.id, x: u.cell.x, y: u.cell.y, hp: u.hp }));
    const enemies = [...this.unitsView.units.values()]
      .filter((u) => !u.isPlayer && u.alive && !u.dying)
      .map((u) => ({ id: u.id, x: u.cell.x, y: u.cell.y, hp: u.hp, dir: u.dir, intent: u.intent }));
    return { ...base, players, enemies } as unknown as GameState;
  }

  private buildHighlights(now: number): {
    list: Highlight[];
    cellLabels: { cell: Vec2; text: string; kind: CellLabel['kind'] }[];
  } {
    const list: Highlight[] = [];
    const cellLabels: { cell: Vec2; text: string; kind: CellLabel['kind'] }[] = [];
    const vs = this.visibleState();
    if (vs) {
      for (const e of vs.enemies as Enemy[]) {
        if (!e.intent) continue;
        const { cells, hit } = intentCells(vs, e, e.intent);
        if (e.intent.kind === 'summon' || e.intent.kind === 'aid') {
          // Where new enemies will rise next turn, or who will be helped.
          for (const c of cells) {
            list.push({ cell: c, kind: 'summon' });
            cellLabels.push({ cell: c, text: e.intent.kind === 'aid' ? '✚' : '☠', kind: 'intent' });
          }
          continue;
        }
        for (const c of cells) list.push({ cell: c, kind: 'intent' });
        const impact = hit ? { x: hit.x, y: hit.y } : cells[cells.length - 1];
        if (e.intent.kind === 'sweep' || e.intent.kind === 'burst' || e.intent.kind === 'blast')
          for (const c of cells) cellLabels.push({ cell: c, text: String(e.intent.damage), kind: 'intent' });
        else if (impact) cellLabels.push({ cell: impact, text: String(e.intent.damage), kind: 'intent' });
      }
    }
    // Light through the windows: the cells it will strike at the end of the next turn.
    if (vs?.omen)
      for (const c of vs.omen.cells) {
        list.push({ cell: c, kind: 'intent' });
        cellLabels.push({ cell: c, text: `☀${vs.omen.damage}`, kind: 'intent' });
      }
    // Where W leads: a faint frame on the free cell ahead (only when nothing is being aimed).
    const me = this.target_?.players[0];
    if (me && !this.preview && !this.isBusy(now) && me.hp > 0) {
      const ahead = { x: me.x + [0, 1, 0, -1][me.dir]!, y: me.y + [-1, 0, 1, 0][me.dir]! };
      const t = this.target_;
      const free =
        t &&
        getCell(t.room.grid, ahead.x, ahead.y) === 'floor' &&
        ![...t.enemies, ...t.allies].some((u) => u.x === ahead.x && u.y === ahead.y);
      if (free) list.push({ cell: ahead, kind: 'step' });
    }
    if (this.preview && !this.isBusy(now)) {
      const { preview, target, options } = this.preview;
      for (const c of options) if (c.x !== target.x || c.y !== target.y) list.push({ cell: c, kind: 'option' });
      list.push({ cell: target, kind: 'target' });
      for (const c of preview.areas) list.push({ cell: c, kind: 'blast', fade: 0.55 });
      for (const path of preview.pushPaths.values()) for (const c of path) list.push({ cell: c, kind: 'push' });
      if (preview.playerTo) list.push({ cell: preview.playerTo, kind: 'dest' });
    }
    this.blasts = this.blasts.filter((b) => now - b.start < STRIKE_MS * 1.5);
    for (const b of this.blasts) {
      const fade = (now - b.start) / (STRIKE_MS * 1.5);
      for (const c of b.cells) list.push({ cell: c, kind: 'blast', fade });
    }
    this.strikes = this.strikes.filter((s) => now - s.start < STRIKE_MS);
    for (const s of this.strikes) {
      const fade = (now - s.start) / STRIKE_MS;
      for (const c of s.cells) list.push({ cell: c, kind: 'strike', fade });
    }
    return { list, cellLabels };
  }

  private project(world: THREE.Vector3): ScreenPoint {
    const local = world.clone().applyMatrix4(this.camera.matrixWorldInverse);
    const ndc = world.clone().project(this.camera);
    const inFront = local.z < 0;
    const onScreen = inFront && Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1;
    return {
      x: ((ndc.x + 1) / 2) * this.cssW,
      y: ((1 - ndc.y) / 2) * this.cssH,
      onScreen,
      bearing: Math.atan2(local.x, -local.z),
    };
  }

  /** Advances animations, draws the frame and returns the data for the HTML overlay. */
  render(now: number): FrameLabels | null {
    const rig = this.rig;
    if (!rig || !this.room) return null;
    this.advance(now);
    rig.update(now);
    this.unitsView.update(now);
    this.camera.updateMatrixWorld();
    const top = rig.topBlend;
    this.hands.update(now, top);

    const s = now / 1000;
    this.torch.intensity = TORCH_INTENSITY * (0.94 + 0.06 * flicker(s, 9.1, 23.7));
    this.placeTorch();
    for (const l of this.roomLights) l.light.intensity = l.base * flicker(s, l.a, l.b);
    if (++this.flickerFrame % 6 === 0) this.room.flicker();
    if (this.flickerFrame % 2 === 0) this.renderer.shadowMap.needsUpdate = true;
    this.fx.update(now);
    this.doorsView.update(now);
    this.altarView.update(now);
    this.surfacesView.update(now);

    // Top view: clear the fog, lift the ambient light, drop the ceiling, show the player marker.
    this.fog.density = this.fogDensity * (1 - top);
    this.topLight.intensity = top * 4;
    this.room.ceiling.visible = top < 0.02;
    this.marker.visible = top > 0.02;
    const p = rig.currentPos(now);
    this.marker.position.set(p.x, WALL_H * 0.5, p.z);
    this.marker.rotation.y = rig.currentYaw(now);
    this.marker.scale.setScalar(0.6 + 0.4 * top);

    const { list, cellLabels } = this.buildHighlights(now);
    this.highlights.draw(list, now);

    if (this.quality === 'high') this.composer.render();
    else {
      this.renderer.render(this.scene, this.camera);
      this.renderer.autoClear = false;
      this.renderer.clearDepth();
      this.renderer.render(this.handsScene, this.handsCamera);
      this.renderer.autoClear = true;
    }

    return this.labels(now, cellLabels, top);
  }

  private labels(
    now: number,
    cellLabels: { cell: Vec2; text: string; kind: CellLabel['kind'] }[],
    top: number,
  ): FrameLabels {
    const camPos = this.camera.position;
    const units: LabelUnit[] = [];
    for (const u of this.unitsView.units.values()) {
      if (u.isPlayer || !u.alive || u.dying) continue;
      const head = this.unitsView.headPosition(u);
      units.push({
        id: u.id,
        isPlayer: false,
        ally: u.ally,
        statuses: [
          ...(u.affix ? [getAffix(u.affix).icon] : []),
          ...(this.target_?.combat.goalTarget === u.id ? ['★'] : []),
          ...u.statuses.map((id) => getStatus(id).icon),
        ],
        affix: u.affix ?? null,
        type: u.type,
        hp: u.hp,
        maxHp: u.maxHp,
        intent: u.intent,
        head: this.project(head),
        distance: head.distanceTo(camPos),
      });
    }
    this.floaters = this.floaters.filter((f) => now - f.start < FLOATER_MS);
    const floaters: Floater[] = this.floaters.map((f) => {
      const age = (now - f.start) / FLOATER_MS;
      const isScreen = f.world.lengthSq() === 0; // player hits are shown in screen space
      const at: ScreenPoint = isScreen
        ? { x: this.cssW / 2, y: this.cssH * 0.62, onScreen: true, bearing: 0 }
        : this.project(f.world.clone().setY(f.world.y + age * 0.6));
      return { id: f.id, at, text: f.text, kind: f.kind, age };
    });

    const cells: CellLabel[] = cellLabels.map((c) => ({
      at: this.project(cellCenter(c.cell).setY(0.1)),
      text: c.text,
      kind: c.kind,
    }));
    // Preview numbers sit above the units they affect.
    if (this.preview && !this.isBusy(now)) {
      for (const [id, dmg] of this.preview.preview.damage) {
        const u = this.unitsView.units.get(id);
        if (!u || u.isPlayer) continue;
        const dies = this.preview.preview.deaths.has(id);
        const path = this.preview.preview.pushPaths.get(id);
        const end = path?.[path.length - 1] ?? u.cell;
        const head = this.unitsView.headPosition({ ...u, pos: cellCenter(end) } as UnitVisual);
        const icons = (this.preview.preview.statuses.get(id) ?? []).map((st) => getStatus(st).icon).join('');
        cells.push({
          at: this.project(head.setY(head.y + 0.35)),
          text: dies ? '☠' : `-${dmg}${icons ? ` ${icons}` : ''}`,
          kind: dies ? 'death' : 'preview',
        });
      }
      // Statuses without damage (a taunt, a stun from a zero-damage effect).
      for (const [id, list] of this.preview.preview.statuses) {
        if (this.preview.preview.damage.has(id) || this.preview.preview.deaths.has(id)) continue;
        const u = this.unitsView.units.get(id);
        if (!u || u.isPlayer) continue;
        const head = this.unitsView.headPosition(u);
        cells.push({
          at: this.project(head.setY(head.y + 0.35)),
          text: list.map((st) => getStatus(st).icon).join(''),
          kind: 'preview',
        });
      }
      for (const id of this.preview.preview.deaths) {
        if (this.preview.preview.damage.has(id)) continue;
        const u = this.unitsView.units.get(id);
        if (!u || u.isPlayer) continue;
        const path = this.preview.preview.pushPaths.get(id);
        const end = path?.[path.length - 1] ?? u.cell;
        cells.push({ at: this.project(cellCenter(end).setY(1)), text: '☠', kind: 'death' });
      }
    }
    const doors: DoorLabel[] = [];
    const run = this.target_?.run;
    if (run?.phase === 'doors' && this.target_)
      for (const o of run.doors) {
        const d = this.target_.room.doors[o.door];
        if (d)
          doors.push({ at: this.project(cellCenter(d).setY(2.15)), reward: o.reward, patron: o.patron, goal: o.goal });
      }
    return {
      width: this.cssW,
      height: this.cssH,
      units,
      floaters,
      cells,
      doors,
      topView: top,
      enemyPhase: this.enemyPhase,
    };
  }

  /**
   * Debug: renders `frames` frames back to back and returns the average milliseconds per frame,
   * waiting for the GPU each time. Independent of the browser's frame pacing (hidden tabs, vsync).
   */
  benchmark(frames: number): number {
    const gl = this.renderer.getContext();
    const px = new Uint8Array(4);
    const start = performance.now();
    for (let i = 0; i < frames; i++) {
      this.render(start + i * 16);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    }
    return (performance.now() - start) / frames;
  }

  dispose(): void {
    this.room?.dispose();
    this.surfacesView.dispose();
    this.doorsView.dispose();
    this.altarView.dispose();
    this.npcView.dispose();
    this.highlights.dispose();
    this.unitsView.clear();
    this.fx.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }
}
