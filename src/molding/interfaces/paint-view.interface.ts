import {IMoldFrame} from './mold-frame.interface';

/**
 * The six views that paint the cast: the front and back of the mold, and four sides. A side view looks at the model
 * from the side it is named for, back along the opposite axis. side-u-positive stands on the +uAxis side of the mold
 * frame and looks along -uAxis.
 */
export type TPaintViewName =
    | 'front'
    | 'back'
    | 'side-u-positive'
    | 'side-u-negative'
    | 'side-v-positive'
    | 'side-v-negative';

export interface IPaintViewFrame {
    viewName: TPaintViewName;
    frame: IMoldFrame;
}

export interface IPaintView extends IPaintViewFrame {
    /** RGBA8, 4 bytes per pixel, row by row. */
    colors: Uint8ClampedArray;
    /** RGBA8 laid out like colors, or null when the material has no metallic-roughness. */
    metallicRoughness: Uint8ClampedArray | null;
    /** Depth along the frame's depthAxis per pixel, used only for visibility checks. */
    depths: Float32Array;
    /** 1 where the model covers the pixel and 0 where it does not. */
    mask: Uint8Array;
}
