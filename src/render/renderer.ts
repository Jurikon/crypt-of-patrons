import * as THREE from 'three';
import { createRng, fork } from '../core/rng';
import type { Vec2 } from '../core/grid';
import { intentCells, type Enemy, type GameEvent, type GameState, type Intent, type Preview, type Room } from '../sim';
import { CameraRig, cellCenter } from './cameraRig';
import { Highlights, type Highlight } from './highlights';
import { buildRoomMeshes, CELL, WALL_H, type RoomMeshes } from './roomMesh';
import { createRoomTextures, type RoomTextures } from './textures';
import { UnitsView, type UnitVisual } from './unitsView';

/** Internal render height in pixels; the canvas is upscaled with nearest-neighbour filtering. */
export const RENDER_HEIGHT = 360;

const FOG_COLOR = 0x070504;
const FOG_DENSITY = 0.075;
const TORCH_INTENSITY = 28;

// PS1-style output: linear → sRGB, then ordered (Bayer 4×4) dithering into 32 levels per channel.
const POST_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;
const POST_FRAGMENT = /* glsl */ `
  precision highp float;
  uniform sampler2D tScene;
  uniform float uLevels;
  varying vec2 vUv;

  float bayer4(vec2 p) {
    int x = int(mod(p.x, 4.0));
    int y = int(mod(p.y, 4.0));
    int i = x + y * 4;
    float m[16];
    m[0]=0.0; m[1]=8.0; m[2]=2.0; m[3]=10.0;
    m[4]=12.0; m[5]=4.0; m[6]=14.0; m[7]=6.0;
    m[8]=3.0; m[9]=11.0; m[10]=1.0; m[11]=9.0;
    m[12]=15.0; m[13]=7.0; m[14]=13.0; m[15]=5.0;
    for (int k = 0; k < 16; k++) { if (k == i) return m[k] / 16.0 - 0.5; }
    return 0.0;
  }

  vec3 toSrgb(vec3 c) {
    c = max(c, vec3(0.0));
    return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
  }

  void main() {
    vec3 c = toSrgb(texture2D(tScene, vUv).rgb);
    c += bayer4(gl_FragCoord.xy) / uLevels;
    c = floor(c * uLevels + 0.5) / uLevels;
    gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
  }
`;

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
};
const MOVE_MS = 140;
const ENEMY_PHASE_PAUSE_MS = 0;
const FLOATER_MS = 900;
const STRIKE_MS = 350;

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
  readonly type: string;
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
  readonly kind: 'damage' | 'heal' | 'blocked';
  /** 0..1 */
  readonly age: number;
}

export interface CellLabel {
  readonly at: ScreenPoint;
  readonly text: string;
  readonly kind: 'intent' | 'preview' | 'death';
}

/** Everything the HTML overlay needs to draw this frame. */
export interface FrameLabels {
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
  private readonly target: THREE.WebGLRenderTarget;
  private readonly postScene = new THREE.Scene();
  private readonly postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly postMaterial: THREE.ShaderMaterial;
  private readonly fog = new THREE.FogExp2(FOG_COLOR, FOG_DENSITY);
  private readonly torch = new THREE.PointLight(0xff9a4a, TORCH_INTENSITY, 20, 1.25);
  private readonly ambient = new THREE.AmbientLight(0x4a3a2e, 0.9);
  private readonly topLight = new THREE.AmbientLight(0x8a7a6a, 0);
  private readonly marker: THREE.Mesh;
  private readonly unitsView = new UnitsView();
  private readonly highlights = new Highlights();
  private room: RoomMeshes | null = null;
  private textures: RoomTextures | null = null;
  private rig: CameraRig | null = null;
  private currentRoom: Room | null = null;
  private seed = -1;
  private playerIds = new Set<string>();

  /** Events waiting to be animated, and the state they lead to. */
  private queue: GameEvent[] = [];
  private playing: Playing | null = null;
  private target_: GameState | null = null;
  private enemyPhase = false;
  private needsSync = false;
  private preview: { preview: Preview; target: Vec2 } | null = null;
  private strikes: { cells: readonly Vec2[]; start: number }[] = [];
  private floaters: FloatingNumber[] = [];
  private floaterSeq = 0;
  /** Called when a hit on a player is animated (not when it is simulated). */
  onPlayerHit: ((hp: number, now: number) => void) | null = null;
  private cssW = 1;
  private cssH = 1;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(1);
    this.canvas = this.renderer.domElement;
    this.canvas.className = 'game-canvas';
    container.appendChild(this.canvas);

    this.target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      magFilter: THREE.NearestFilter,
      minFilter: THREE.NearestFilter,
      depthBuffer: true,
    });
    this.postMaterial = new THREE.ShaderMaterial({
      uniforms: { tScene: { value: this.target.texture }, uLevels: { value: 31 } },
      vertexShader: POST_VERTEX,
      fragmentShader: POST_FRAGMENT,
      depthTest: false,
      depthWrite: false,
    });
    this.postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.postMaterial));

    this.scene.background = new THREE.Color(FOG_COLOR);
    this.scene.fog = this.fog;
    this.scene.add(this.ambient, this.topLight, this.camera, this.unitsView.group, this.highlights.group);
    this.camera.add(this.torch);
    this.torch.position.set(0.25, -0.15, -0.1);

    // Player marker, only visible from above.
    const markerGeo = new THREE.ConeGeometry(CELL * 0.28, CELL * 0.6, 3);
    markerGeo.rotateX(-Math.PI / 2); // point along −Z (north at yaw 0)
    this.marker = new THREE.Mesh(markerGeo, new THREE.MeshBasicMaterial({ color: 0xffc04a, fog: false }));
    this.marker.visible = false;
    this.scene.add(this.marker);

    this.resize();
  }

  /**
   * Shows `state` immediately, without animation: a new room (rebuilds geometry when the seed changes),
   * a restart, or an undo.
   */
  reset(state: GameState, now: number): void {
    const player = state.players[0];
    if (!player) return;
    if (state.seed !== this.seed) {
      this.seed = state.seed;
      if (this.room) {
        this.scene.remove(this.room.group);
        this.room.dispose();
      }
      this.textures?.dispose();
      this.textures = createRoomTextures(fork(createRng(state.seed), 'textures'));
      this.room = buildRoomMeshes(state.room, this.textures);
      this.scene.add(this.room.group);
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
    this.floaters = [];
    this.unitsView.sync(state);
    if (this.rig) this.rig.snap(state.room, player, now);
    else this.rig = new CameraRig(this.camera, state.room, player, now);
  }

  /** Queues the events of one command for playback; `state` is where they lead. */
  play(events: readonly GameEvent[], state: GameState): void {
    this.queue.push(...events);
    this.target_ = state;
    this.needsSync = true;
  }

  /** The ability preview to draw (target cell, push path, damage numbers), or null. */
  setPreview(preview: Preview | null, target: Vec2 | null): void {
    this.preview = preview && target ? { preview, target } : null;
  }

  look(dx: number, dy: number): void {
    this.rig?.look(dx, dy);
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
      this.unitsView.isAnimating(now)
    );
  }

  resize(): void {
    const parent = this.canvas.parentElement;
    this.cssW = parent?.clientWidth || window.innerWidth;
    this.cssH = parent?.clientHeight || window.innerHeight;
    const aspect = this.cssW / Math.max(1, this.cssH);
    const h = RENDER_HEIGHT;
    const w = Math.max(1, Math.round(h * aspect));
    this.renderer.setSize(w, h, false);
    this.target.setSize(w, h);
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    // Re-fit the overhead view to the new aspect ratio.
    if (this.rig && this.currentRoom) this.rig.setRoom(this.currentRoom);
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
        }
        this.strikes.push({ cells: e.cells, start: now });
        return EVENT_MS.enemyAttack ?? 0;
      }
      case 'damaged': {
        const u = v.units.get(e.unitId);
        if (u) {
          u.hp = e.hp;
          v.flash(e.unitId, now);
          const at = isPlayer ? null : v.headPosition(u);
          this.floaters.push({
            id: this.floaterSeq++,
            world: at ?? new THREE.Vector3(),
            text: e.amount > 0 ? `-${e.amount}` : '0',
            kind: e.amount > 0 ? 'damage' : 'blocked',
            start: now,
          });
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
        for (const c of cells) list.push({ cell: c, kind: 'intent' });
        const impact = hit ? { x: hit.x, y: hit.y } : cells[cells.length - 1];
        if (impact) cellLabels.push({ cell: impact, text: String(e.intent.damage), kind: 'intent' });
      }
    }
    if (this.preview && !this.isBusy(now)) {
      const { preview, target } = this.preview;
      list.push({ cell: target, kind: 'target' });
      for (const path of preview.pushPaths.values()) for (const c of path) list.push({ cell: c, kind: 'push' });
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

    // Torch flicker: a few incommensurate sines read as fire without any randomness.
    const s = now / 1000;
    const flicker = 1 + Math.sin(s * 9.1) * 0.05 + Math.sin(s * 23.7) * 0.035 + Math.sin(s * 3.3) * 0.04;
    this.torch.intensity = TORCH_INTENSITY * flicker;

    // Top view: clear the fog, lift the ambient light, drop the ceiling, show the player marker.
    this.fog.density = FOG_DENSITY * (1 - top);
    this.topLight.intensity = top * 3.2;
    this.room.ceiling.visible = top < 0.02;
    this.marker.visible = top > 0.02;
    const p = rig.currentPos(now);
    this.marker.position.set(p.x, WALL_H * 0.5, p.z);
    this.marker.rotation.y = rig.currentYaw(now);
    this.marker.scale.setScalar(0.6 + 0.4 * top);

    const { list, cellLabels } = this.buildHighlights(now);
    this.highlights.draw(list, now);

    this.renderer.setRenderTarget(this.target);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.postScene, this.postCamera);

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
        cells.push({
          at: this.project(head.setY(head.y + 0.35)),
          text: dies ? '☠' : `-${dmg}`,
          kind: dies ? 'death' : 'preview',
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
    return { width: this.cssW, height: this.cssH, units, floaters, cells, topView: top, enemyPhase: this.enemyPhase };
  }

  dispose(): void {
    this.room?.dispose();
    this.textures?.dispose();
    this.highlights.dispose();
    this.unitsView.clear();
    this.target.dispose();
    this.postMaterial.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }
}
