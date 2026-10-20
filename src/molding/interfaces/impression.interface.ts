import {IMoldFrame} from './mold-frame.interface';

/** What the press leaves behind. Every array runs row by row, so pixel (i, j) is at index j * frame.width + i. */
export interface IImpression {
    frame: IMoldFrame;
    /** Depth of the front surface, in world units from the front plane. NaN where the mask is 0. */
    frontDepths: Float32Array;
    /**
     * Depth of the back surface, also from the front plane, and never less than the front depth. NaN where the mask
     * is 0.
     */
    backDepths: Float32Array;
    /** 1 where the model covers the pixel and 0 where it does not. */
    mask: Uint8Array;
}
