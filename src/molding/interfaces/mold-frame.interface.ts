import {IVector3} from '@core/math/interfaces/vector.interface';

/**
 * The orthographic window a mold presses through. In image space u points right and v points down, and pixel (i, j)
 * has its center at integer coordinates (i, j). Depth is measured along depthAxis from the front plane.
 */
export interface IMoldFrame {
    /** World position of the center of pixel (0, 0) on the front plane. */
    origin: IVector3;
    /** Unit vector along which u grows. */
    uAxis: IVector3;
    /** Unit vector along which v grows. */
    vAxis: IVector3;
    /** Unit vector from the front plane toward the back. */
    depthAxis: IVector3;
    /** World units per pixel. */
    pixelSize: number;
    /** Image width in pixels. */
    width: number;
    /** Image height in pixels. */
    height: number;
    /** How far the bounds reach along depthAxis from the front plane, in world units. */
    depthRange: number;
}
