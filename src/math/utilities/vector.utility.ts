import {IVector3} from '@core/math/interfaces/vector.interface';

export function addVectors(first: IVector3, second: IVector3): IVector3 {
    return {x: first.x + second.x, y: first.y + second.y, z: first.z + second.z};
}

export function subtractVectors(first: IVector3, second: IVector3): IVector3 {
    return {x: first.x - second.x, y: first.y - second.y, z: first.z - second.z};
}

export function scaleVector(vector: IVector3, factor: number): IVector3 {
    return {x: vector.x * factor, y: vector.y * factor, z: vector.z * factor};
}

export function dotVectors(first: IVector3, second: IVector3): number {
    return first.x * second.x + first.y * second.y + first.z * second.z;
}

export function crossVectors(first: IVector3, second: IVector3): IVector3 {
    return {
        x: first.y * second.z - first.z * second.y,
        y: first.z * second.x - first.x * second.z,
        z: first.x * second.y - first.y * second.x,
    };
}

export function getVectorLength(vector: IVector3): number {
    return Math.sqrt(dotVectors(vector, vector));
}

export function normalizeVector(vector: IVector3): IVector3 {
    const length = getVectorLength(vector);
    if (length === 0) {
        return {x: 0, y: 0, z: 0};
    }

    return scaleVector(vector, 1 / length);
}
