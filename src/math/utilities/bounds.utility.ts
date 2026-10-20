import {IBounds} from '@core/math/interfaces/bounds.interface';
import {IVector3} from '@core/math/interfaces/vector.interface';
import {addVectors, scaleVector, subtractVectors} from './vector.utility';

export function getBoundsSize(bounds: IBounds): IVector3 {
    return subtractVectors(bounds.maximum, bounds.minimum);
}

export function getBoundsCenter(bounds: IBounds): IVector3 {
    return scaleVector(addVectors(bounds.minimum, bounds.maximum), 0.5);
}

export function getLargestDimension(bounds: IBounds): number {
    const size = getBoundsSize(bounds);

    return Math.max(size.x, size.y, size.z);
}

export function getGroundingOffset(bounds: IBounds): IVector3 {
    const center = getBoundsCenter(bounds);
    const bottomCenter = {x: center.x, y: bounds.minimum.y, z: center.z};
    const origin = {x: 0, y: 0, z: 0};

    return subtractVectors(origin, bottomCenter);
}
