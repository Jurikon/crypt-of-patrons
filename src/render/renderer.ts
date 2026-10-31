import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { createRng, fork, nextU32 } from '../core/rng';
import { getCell, type Vec2 } from '../core/grid';
import { MODIFIERS, getModifier, getStatus } from '../content';
import { t, type TextKey } from '../i18n';
import { intentCells, type Enemy, type GameEvent, type GameState, type Intent, type Preview, type Room } from '../sim';
import { CameraRig, cellCenter } from './cameraRig';
import { buildCaveMeshes, type CaveMeshes } from './caveMesh';
import { CELL, WALL_H } from './dims';
import { Particles } from './fx';
import { Highlights, type Highlight } from './highlights';
import { SurfacesView } from './surfacesView';
import { DoorsView } from './doorsView';
import type { RewardKind } from '../content';
import { UnitsView, type UnitVisual } from './unitsView';
import { buildCave } from './voxel/cave';

export type Quality = 'high' | 'low';

// Look of the reference: warm fog, purple sky / maroon ground hemisphere light for hue-shifted
// shadows, orange point lights from the torch, braziers and lava.
const FOG_COLOR = 0x1a0705;
const BACKGROUND = 0x140504;
const FOG_DENSITY = 0.055;
const HEMI_INTENSITY = 3;
const TORCH_INTENSITY = 3.6;
const BRAZIER_INTENSITY = 8;
const LAVA_LIGHT_INTENSITY = 3;
const BLOOM = { strength: 0.45, radius: 0.35, threshold: 0.8 };
const MAX_PIXEL_RATIO = 2;

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
  /** Status icons to show over the unit. */
  readonly statuses: readonly string[];
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
  private readonly fog = new THREE.FogExp2(FOG_COLOR, FOG_DENSITY);
  private readonly hemi = new THREE.HemisphereLight(0x5a2a70, 0x501008, HEMI_INTENSITY);
  // Shallow falloff: bright enough across the room without blowing out walls at arm's length.
  private readonly torch = new THREE.PointLight(0xffc890, TORCH_INTENSITY, 22, 0.6);
  private readonly topLight = new THREE.AmbientLight(0xc8a890, 0);
  private readonly marker: THREE.Mesh;
  private readonly fx = new Particles();
  private readonly unitsView = new UnitsView(this.fx);
  private readonly highlights = new Highlights();
  private room: CaveMeshes | null = null;
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
    this.canvas = this.renderer.domElement;
    this.canvas.className = 'game-canvas';
    container.appendChild(this.canvas);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), BLOOM.strength, BLOOM.radius, BLOOM.threshold);
    this.composer.addPass(this.bloom);
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
      this.highlights.group,
      this.fx.group,
    );
    this.camera.add(this.torch);
    this.torch.position.set(0.6, 0.5, 0.3);

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

  /** High: full pixel density (up to 2×), bloom and particles. Low: 1×, no bloom, no ambient particles. */
  setQuality(q: Quality): void {
    this.quality = q;
    this.fx.enabled = q === 'high';
    this.resize();
  }

  /** Builds the voxel cave, its lights and particles for a new room. */
  private buildRoom(state: GameState): void {
    if (this.room) {
      this.scene.remove(this.room.group);
      this.room.dispose();
    }
    for (const l of this.roomLights) this.scene.remove(l.light);
    this.roomLights = [];

    const depth = state.run?.depth ?? 1;
    const caveSeed = nextU32(fork(createRng(state.seed), depth === 1 ? 'cave' : `cave:${depth}`));
    const cave = buildCave(state.room.grid, caveSeed);
    this.room = buildCaveMeshes(cave);
    this.scene.add(this.room.group);

    // One light per door (between its two braziers) and per lava pool.
    for (let i = 0; i + 1 < cave.braziers.length; i += 2) {
      const a = cave.braziers[i] as (typeof cave.braziers)[number];
      const b = cave.braziers[i + 1] as (typeof cave.braziers)[number];
      const light = new THREE.PointLight(0xff8030, BRAZIER_INTENSITY, 12, 0.9);
      light.position.set((a.x + b.x) / 2, a.y + 0.1, (a.z + b.z) / 2);
      this.roomLights.push({ light, base: BRAZIER_INTENSITY, a: 9.1 + i, b: 23.7 - i });
    }
    for (const [i, pool] of cave.lavaPools.entries()) {
      const base = LAVA_LIGHT_INTENSITY + Math.min(4, pool.cells) * 0.6;
      const light = new THREE.PointLight(0xff5a10, base, 9, 0.9);
      light.position.set(pool.x, 0.5, pool.z);
      this.roomLights.push({ light, base, a: 3.1 + i * 0.4, b: 7.7 + i * 0.6 });
    }
    for (const l of this.roomLights) this.scene.add(l.light);

    const g = state.room.grid;
    const open: THREE.Vector3[] = [];
    for (let y = 0; y < g.h; y++)
      for (let x = 0; x < g.w; x++)
        if (getCell(g, x, y) !== 'wall' && getCell(g, x, y) !== 'door') open.push(cellCenter({ x, y }));
    this.fx.setRoom(open, CELL, cave.braziers);
  }

  /**
   * Shows `state` immediately, without animation: a new room (rebuilds geometry when the seed changes),
   * a restart, or an undo.
   */
  reset(state: GameState, now: number): void {
    const player = state.players[0];
    if (!player) return;
    const key = `${state.seed}:${state.run?.depth ?? 0}`;
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
    const ratio = this.quality === 'high' ? Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO) : 1;
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(this.cssW, this.cssH, false);
    this.composer.setPixelRatio(ratio);
    this.composer.setSize(this.cssW, this.cssH);
    this.camera.aspect = this.cssW / Math.max(1, this.cssH);
    this.camera.updateProjectionMatrix();
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
          this.doorsView.sync(this.target_);
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
        if (this.target_) this.doorsView.sync(this.target_);
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
        if (e.intent.kind === 'summon') {
          // Where new enemies will rise next turn.
          for (const c of cells) {
            list.push({ cell: c, kind: 'summon' });
            cellLabels.push({ cell: c, text: '☠', kind: 'intent' });
          }
          continue;
        }
        for (const c of cells) list.push({ cell: c, kind: 'intent' });
        const impact = hit ? { x: hit.x, y: hit.y } : cells[cells.length - 1];
        if (e.intent.kind === 'sweep')
          for (const c of cells) cellLabels.push({ cell: c, text: String(e.intent.damage), kind: 'intent' });
        else if (impact) cellLabels.push({ cell: impact, text: String(e.intent.damage), kind: 'intent' });
      }
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

    const s = now / 1000;
    this.torch.intensity = TORCH_INTENSITY * (0.94 + 0.06 * flicker(s, 9.1, 23.7));
    for (const l of this.roomLights) l.light.intensity = l.base * flicker(s, l.a, l.b);
    this.room.lavaMaterial.uniforms.uTime!.value = s;
    this.fx.update(now);
    this.doorsView.update(now);
    this.surfacesView.update(now);

    // Top view: clear the fog, lift the ambient light, drop the ceiling, show the player marker.
    this.fog.density = FOG_DENSITY * (1 - top);
    this.topLight.intensity = top * 2.5;
    this.room.ceiling.visible = top < 0.02;
    this.marker.visible = top > 0.02;
    const p = rig.currentPos(now);
    this.marker.position.set(p.x, WALL_H * 0.5, p.z);
    this.marker.rotation.y = rig.currentYaw(now);
    this.marker.scale.setScalar(0.6 + 0.4 * top);

    const { list, cellLabels } = this.buildHighlights(now);
    this.highlights.draw(list, now);

    if (this.quality === 'high') this.composer.render();
    else this.renderer.render(this.scene, this.camera);

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
        statuses: u.statuses.map((id) => getStatus(id).icon),
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
        if (d) doors.push({ at: this.project(cellCenter(d).setY(2.15)), reward: o.reward });
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
    this.highlights.dispose();
    this.unitsView.clear();
    this.fx.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }
}
