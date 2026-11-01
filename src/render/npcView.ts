import * as THREE from 'three';
import { getEvent } from '../content';
import type { GameState } from '../sim';
import { PROPS } from './look/creatureKit';
import { buildProp } from './look/creatures';
import { CELL } from './dims';

/**
 * The merchant or an event's object in a peaceful room (M6c), turned towards the way the heroes came
 * in. Its lantern light always exists (adding lights recompiles shaders) and is off elsewhere.
 */
export class NpcView {
  readonly group = new THREE.Group();
  private readonly light = new THREE.PointLight(0xffb060, 0, 6, 1.4);
  private shown: { key: string; root: THREE.Group; materials: THREE.Material[] } | null = null;

  constructor() {
    this.group.add(this.light);
  }

  sync(state: GameState): void {
    const run = state.run;
    const npc = run?.npc ?? null;
    const prop =
      run?.kind === 'merchant'
        ? 'merchant'
        : run?.kind === 'event'
          ? getEvent(run.event ?? run.seenEvents[run.seenEvents.length - 1] ?? 'mirror').prop
          : null;
    const key = npc && prop ? `${state.seed}:${run?.act}:${run?.depth}:${prop}:${npc.x},${npc.y}` : '';
    if (key === (this.shown?.key ?? '')) return;
    this.clear();
    if (!npc || !prop || !PROPS[prop]) return;
    const { group, materials } = buildProp(prop, PROPS[prop]!);
    group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = true;
    });
    const at = new THREE.Vector3((npc.x + 0.5) * CELL, 0, (npc.y + 0.5) * CELL);
    const spawn = state.room.spawn;
    group.position.copy(at);
    group.rotation.y = Math.atan2((spawn.x - npc.x) * CELL, (spawn.y - npc.y) * CELL);
    this.group.add(group);
    this.shown = { key, root: group, materials };
    // The merchant's lantern lights the stall; event objects get a dimmer glow.
    this.light.color.setHex(prop === 'merchant' ? 0xffb060 : 0xc8a0ff);
    this.light.intensity = prop === 'merchant' ? 3 : 1.5;
    const lamp = new THREE.Vector3(0.33, 1.15, 0.45).applyEuler(group.rotation);
    this.light.position.copy(at).add(prop === 'merchant' ? lamp : new THREE.Vector3(0, 1.6, 0));
  }

  clear(): void {
    if (this.shown) {
      this.group.remove(this.shown.root);
      for (const m of this.shown.materials) m.dispose();
      this.shown = null;
    }
    this.light.intensity = 0;
  }

  dispose(): void {
    this.clear();
  }
}
