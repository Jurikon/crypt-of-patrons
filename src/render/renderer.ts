import * as THREE from 'three';
import { createRng, fork } from '../core/rng';
import type { GameEvent, GameState, Room } from '../sim';
import { CameraRig } from './cameraRig';
import { buildRoomMeshes, CELL, WALL_H, type RoomMeshes } from './roomMesh';
import { createRoomTextures, type RoomTextures } from './textures';

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
  private room: RoomMeshes | null = null;
  private textures: RoomTextures | null = null;
  private rig: CameraRig | null = null;
  private currentRoom: Room | null = null;
  private seed = -1;

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
    this.scene.add(this.ambient, this.topLight, this.camera);
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

  /** (Re)builds the room when the seed changes and snaps the camera to the player. */
  setState(state: GameState, now: number): void {
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
      if (this.rig) this.rig.snap(state.room, player, now);
      else this.rig = new CameraRig(this.camera, state.room, player, now);
    }
  }

  onEvents(events: readonly GameEvent[], now: number): void {
    for (const e of events) this.rig?.onEvent(e, now);
  }

  look(dx: number, dy: number): void {
    this.rig?.look(dx, dy);
  }

  setTopView(on: boolean, now: number): void {
    this.rig?.setTopView(on, now);
  }

  isBusy(now: number): boolean {
    return this.rig?.isBusy(now) ?? false;
  }

  resize(): void {
    const parent = this.canvas.parentElement;
    const cssW = parent?.clientWidth || window.innerWidth;
    const cssH = parent?.clientHeight || window.innerHeight;
    const aspect = cssW / Math.max(1, cssH);
    const h = RENDER_HEIGHT;
    const w = Math.max(1, Math.round(h * aspect));
    this.renderer.setSize(w, h, false);
    this.target.setSize(w, h);
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    // Re-fit the overhead view to the new aspect ratio.
    if (this.rig && this.currentRoom) this.rig.setRoom(this.currentRoom);
  }

  render(state: GameState, now: number): void {
    const rig = this.rig;
    if (!rig || !this.room) return;
    rig.update(now);
    const top = rig.topBlend;

    // Torch flicker: a few incommensurate sines read as fire without any randomness.
    const s = now / 1000;
    const flicker = 1 + Math.sin(s * 9.1) * 0.05 + Math.sin(s * 23.7) * 0.035 + Math.sin(s * 3.3) * 0.04;
    this.torch.intensity = TORCH_INTENSITY * flicker;

    // Top view: clear the fog, lift the ambient light, drop the ceiling, show the player marker.
    this.fog.density = FOG_DENSITY * (1 - top);
    this.topLight.intensity = top * 3.2;
    this.room.ceiling.visible = top < 0.02;
    const player = state.players[0];
    this.marker.visible = top > 0.02 && player !== undefined;
    if (player) {
      const p = rig.currentPos(now);
      this.marker.position.set(p.x, WALL_H * 0.5, p.z);
      this.marker.rotation.y = rig.currentYaw(now);
      const scale = 0.6 + 0.4 * top;
      this.marker.scale.setScalar(scale);
    }

    this.renderer.setRenderTarget(this.target);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.postScene, this.postCamera);
  }

  dispose(): void {
    this.room?.dispose();
    this.textures?.dispose();
    this.target.dispose();
    this.postMaterial.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }
}
