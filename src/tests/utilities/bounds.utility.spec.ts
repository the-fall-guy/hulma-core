import {
    getBoundsSize,
    getBoundsCenter,
    getLargestDimension,
    getGroundingOffset
} from '@core/math/utilities/bounds.utility';

describe('bounds utility', () => {
    const bounds = {minimum: {x: 1, y: -0.3, z: 2}, maximum: {x: 3, y: 0.3, z: 6}};

    it('measures the size of the bounds', () => {
        const size = getBoundsSize(bounds);

        expect(size.x).toBeCloseTo(2);
        expect(size.y).toBeCloseTo(0.6);
        expect(size.z).toBeCloseTo(4);
    });

    it('finds the center of the bounds', () => {
        expect(getBoundsCenter(bounds)).toEqual({x: 2, y: 0, z: 4});
    });

    it('finds the largest dimension', () => {
        expect(getLargestDimension(bounds)).toBe(4);
    });

    it('computes the offset that centers on X and Z and puts the bottom at 0', () => {
        expect(getGroundingOffset(bounds)).toEqual({x: -2, y: 0.3, z: -4});
    });

    it('does not mutate the bounds', () => {
        const originalBounds = structuredClone(bounds);

        getBoundsSize(bounds);
        getBoundsCenter(bounds);
        getLargestDimension(bounds);
        getGroundingOffset(bounds);

        expect(bounds).toEqual(originalBounds);
    });
});
