import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createGame } from '../sim';
import { CameraRig } from './cameraRig';

describe('camera rig', () => {
  it('owner bug: a mouse turn past 45° never leaves a blank (NaN) frame', () => {
    const s = createGame(3);
    const p = s.players[0]!;
    const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.05, 120);
    const rig = new CameraRig(camera, s.room, p, 0);
    rig.look(-400, 0); // past 45° to the left
    expect(rig.lookTurn()).toBe(1);
    rig.expectMouseTurn();
    rig.onEvent({ type: 'turned', unitId: p.id, from: p.dir, to: ((p.dir + 3) % 4) as 0 | 1 | 2 | 3 }, 1000);
    // The very frame of the turn, and the next ones.
    for (const now of [1000, 1001, 1200]) {
      rig.update(now);
      expect(Number.isFinite(camera.quaternion.x + camera.quaternion.y + camera.quaternion.w), `t=${now}`).toBe(true);
    }
  });
});
