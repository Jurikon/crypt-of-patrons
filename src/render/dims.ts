/** World dimensions shared by the renderer. Cell (x, y) spans [x*CELL, (x+1)*CELL] on X and the same on Z. */
export const CELL = 2;
/** Voxels per cell edge. */
export const VPC = 10;
/** Voxel edge in world units. */
export const VS = CELL / VPC;
/** Floor top is at y = 0; the ceiling's underside is at WALL_H. */
export const WALL_H = 2.6;
/** Surface of the lava in pits. Falling units sink below it. */
export const LAVA_Y = -0.4;
