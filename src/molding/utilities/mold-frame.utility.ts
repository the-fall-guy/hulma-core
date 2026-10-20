import {IBounds} from '@core/math/interfaces/bounds.interface';
import {IVector3} from '@core/math/interfaces/vector.interface';
import {getBoundsSize} from '@core/math/utilities/bounds.utility';
import {addVectors, dotVectors, scaleVector, subtractVectors} from '@core/math/utilities/vector.utility';
import {IMoldFrame} from '@core/molding/interfaces/mold-frame.interface';
import {TMoldDirection} from '@core/molding/interfaces/molding-settings.interface';
import {TPaintViewName} from '@core/molding/interfaces/paint-view.interface';

/**
 * The image axes and the pressing direction of a mold. The front of the mold is the +Z side for front-back, the +X
 * side for left-right and the +Y side for top-bottom, and depth runs from there toward the back. In the image u
 * points right and v points down, and u × v is depth.
 */
export function getMoldAxes(direction: TMoldDirection): {uAxis: IVector3; vAxis: IVector3; depthAxis: IVector3} {
    switch (direction) {
        case 'front-back':
            return {uAxis: {x: 1, y: 0, z: 0}, vAxis: {x: 0, y: -1, z: 0}, depthAxis: {x: 0, y: 0, z: -1}};
        case 'left-right':
            return {uAxis: {x: 0, y: 0, z: -1}, vAxis: {x: 0, y: -1, z: 0}, depthAxis: {x: -1, y: 0, z: 0}};
        case 'top-bottom':
            return {uAxis: {x: 1, y: 0, z: 0}, vAxis: {x: 0, y: 0, z: 1}, depthAxis: {x: 0, y: -1, z: 0}};
    }
}

/**
 * Fits an image around the bounds, seen from the front of the mold. The longer side of the image, margins included,
 * is longestSidePixels pixels, and every side has marginPixels of margin. The top left corner of the bounds' front face
 * is the center of pixel (marginPixels, marginPixels) at depth 0.
 */
export function createMoldFrame(
    bounds: IBounds,
    direction: TMoldDirection,
    longestSidePixels: number,
    marginPixels: number
): IMoldFrame {
    const {uAxis, vAxis, depthAxis} = getMoldAxes(direction);
    const size = getBoundsSize(bounds);
    const uExtent = getExtentAlongAxis(size, uAxis);
    const vExtent = getExtentAlongAxis(size, vAxis);
    const pixelSize = Math.max(uExtent, vExtent) / (longestSidePixels - 2 * marginPixels);

    // Each world axis belongs to exactly one of the three frame axes, so their sum holds the sign it runs with. Where
    // that is positive the corner sits at the minimum of the bounds, and where it is negative at the maximum.
    const axisSigns = addVectors(addVectors(uAxis, vAxis), depthAxis);
    const corner = {
        x: axisSigns.x > 0 ? bounds.minimum.x : bounds.maximum.x,
        y: axisSigns.y > 0 ? bounds.minimum.y : bounds.maximum.y,
        z: axisSigns.z > 0 ? bounds.minimum.z : bounds.maximum.z,
    };
    const origin = subtractVectors(corner, scaleVector(addVectors(uAxis, vAxis), marginPixels * pixelSize));

    return {
        origin,
        uAxis,
        vAxis,
        depthAxis,
        pixelSize,
        width: Math.round(uExtent / pixelSize) + 2 * marginPixels,
        height: Math.round(vExtent / pixelSize) + 2 * marginPixels,
        depthRange: getExtentAlongAxis(size, depthAxis),
    };
}

/**
 * The axes of the six paint views, in TPaintViewName order. Every view except back is a proper view, not a mirror
 * image, so u × v is depth. Back keeps the front's u and v and flips depth, so it is mirrored on purpose and its pixels
 * line up with the front's. A side view looks at the model from the side it is named for, back along the opposite
 * axis: side-u-positive stands on the +uAxis side, so its depth runs along -uAxis.
 */
export function getPaintViewAxes(
    direction: TMoldDirection
): {viewName: TPaintViewName; uAxis: IVector3; vAxis: IVector3; depthAxis: IVector3}[] {
    const {uAxis, vAxis, depthAxis} = getMoldAxes(direction);
    // Subtracting from zero rather than scaling by -1 keeps the zero components +0.
    const zero = {x: 0, y: 0, z: 0};
    const negativeUAxis = subtractVectors(zero, uAxis);
    const negativeVAxis = subtractVectors(zero, vAxis);
    const negativeDepthAxis = subtractVectors(zero, depthAxis);

    return [
        {viewName: 'front', uAxis, vAxis, depthAxis},
        {viewName: 'back', uAxis, vAxis, depthAxis: negativeDepthAxis},
        {viewName: 'side-u-positive', uAxis: depthAxis, vAxis, depthAxis: negativeUAxis},
        {viewName: 'side-u-negative', uAxis: negativeDepthAxis, vAxis, depthAxis: uAxis},
        {viewName: 'side-v-positive', uAxis, vAxis: depthAxis, depthAxis: negativeVAxis},
        {viewName: 'side-v-negative', uAxis, vAxis: negativeDepthAxis, depthAxis: vAxis},
    ];
}

/** The extent of the bounds in the image of each paint view, in world units, in TPaintViewName order. */
export function getPaintViewWorldSizes(
    bounds: IBounds,
    direction: TMoldDirection
): {viewName: TPaintViewName; width: number; height: number}[] {
    const size = getBoundsSize(bounds);

    return getPaintViewAxes(direction).map(({viewName, uAxis, vAxis}) => ({
        viewName,
        width: getExtentAlongAxis(size, uAxis),
        height: getExtentAlongAxis(size, vAxis),
    }));
}

/** The world point at image position (u, v) in pixels and depth in world units. Pixel centers are whole numbers. */
export function getFramePoint(frame: IMoldFrame, u: number, v: number, depth: number): IVector3 {
    const alongU = scaleVector(frame.uAxis, u * frame.pixelSize);
    const alongV = scaleVector(frame.vAxis, v * frame.pixelSize);
    const alongDepth = scaleVector(frame.depthAxis, depth);

    return addVectors(addVectors(addVectors(frame.origin, alongU), alongV), alongDepth);
}

/** The image position of a world point, as u and v in pixels and depth in world units from the front plane. */
export function projectToFrame(frame: IMoldFrame, point: IVector3): {u: number; v: number; depth: number} {
    const offset = subtractVectors(point, frame.origin);

    return {
        u: dotVectors(offset, frame.uAxis) / frame.pixelSize,
        v: dotVectors(offset, frame.vAxis) / frame.pixelSize,
        depth: dotVectors(offset, frame.depthAxis),
    };
}

function getExtentAlongAxis(size: IVector3, axis: IVector3): number {
    return Math.abs(dotVectors(size, axis));
}
