import {
    addVectors,
    subtractVectors,
    scaleVector,
    dotVectors,
    crossVectors,
    getVectorLength,
    normalizeVector
} from '@core/math/utilities/vector.utility';

describe('vector utility', () => {
    it('adds vectors component-wise', () => {
        expect(addVectors({x: 1, y: 2, z: 3}, {x: 4, y: 5, z: 6})).toEqual({x: 5, y: 7, z: 9});
    });

    it('subtracts vectors component-wise', () => {
        expect(subtractVectors({x: 4, y: 5, z: 6}, {x: 1, y: 2, z: 3})).toEqual({x: 3, y: 3, z: 3});
    });

    it('scales a vector', () => {
        expect(scaleVector({x: 1, y: -2, z: 3}, 2)).toEqual({x: 2, y: -4, z: 6});
    });

    it('computes the dot product', () => {
        expect(dotVectors({x: 1, y: 2, z: 3}, {x: 4, y: 5, z: 6})).toBe(32);
    });

    it('computes the cross product', () => {
        expect(crossVectors({x: 1, y: 0, z: 0}, {x: 0, y: 1, z: 0})).toEqual({x: 0, y: 0, z: 1});
    });

    it('measures length', () => {
        expect(getVectorLength({x: 3, y: 4, z: 12})).toBe(13);
    });

    it('normalizes to unit length', () => {
        const normalized = normalizeVector({x: 0, y: 3, z: 4});

        expect(normalized.x).toBeCloseTo(0);
        expect(normalized.y).toBeCloseTo(0.6);
        expect(normalized.z).toBeCloseTo(0.8);
    });

    it('returns the zero vector when normalizing a zero vector', () => {
        expect(normalizeVector({x: 0, y: 0, z: 0})).toEqual({x: 0, y: 0, z: 0});
    });
});
