import {countUniquePoints} from '@core/common/utilities/mesh-stats.utility';

describe('mesh stats utility', () => {
    // The 24 vertices of a cube whose six faces each have their own four: 8 distinct positions.
    function createCubeCornerPositions(): number[] {
        const positions: number[] = [];
        for (let axis = 0; axis < 3; axis++) {
            for (const side of [0, 1]) {
                for (const [first, second] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
                    const corner = [0, 0, 0];
                    corner[axis] = side;
                    corner[(axis + 1) % 3] = first;
                    corner[(axis + 2) % 3] = second;
                    positions.push(...corner);
                }
            }
        }

        return positions;
    }

    it('counts the distinct positions of a cube with split faces', () => {
        const positions = createCubeCornerPositions();

        expect(positions).toHaveLength(72);
        expect(countUniquePoints(positions)).toBe(8);
    });

    it('counts nothing for no positions', () => {
        expect(countUniquePoints([])).toBe(0);
        expect(countUniquePoints(new Float32Array(0))).toBe(0);
    });

    it('counts each position once however often it repeats', () => {
        expect(countUniquePoints([1, 2, 3, 1, 2, 3, 1, 2, 3])).toBe(1);
    });

    it('tells apart positions that differ in a single component', () => {
        expect(countUniquePoints([1, 2, 3, 1, 2, 4, 1, 5, 3, 6, 2, 3])).toBe(4);
    });

    it('does not merge positions that are merely close', () => {
        expect(countUniquePoints([0.1, 0.2, 0.3, 0.1 + Number.EPSILON, 0.2, 0.3])).toBe(2);
    });

    it('treats -0 and 0 as the same coordinate', () => {
        expect(countUniquePoints([0, 0, 0, -0, -0, -0, 0, -0, 0])).toBe(1);
    });

    it('counts the same positions in a typed array as in a plain array', () => {
        const positions = [0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0];

        expect(countUniquePoints(new Float32Array(positions))).toBe(3);
        expect(countUniquePoints(positions)).toBe(3);
    });

    it('counts a position with a NaN component as its own, because NaN equals nothing', () => {
        expect(countUniquePoints([NaN, 0, 0, NaN, 0, 0, 1, 2, 3, 1, 2, 3])).toBe(3);
    });

    it('keeps count of thousands of positions that differ in one coordinate only', () => {
        for (const axis of [0, 1, 2]) {
            const line: number[] = [];
            for (let step = 0; step < 3000; step++) {
                const position = [7, 8, 9];
                position[axis] = step * 0.001;
                line.push(...position);
            }

            expect(countUniquePoints(line), `axis ${axis}`).toBe(3000);
            expect(countUniquePoints([...line, ...line]), `axis ${axis}, twice`).toBe(3000);
        }
    });

    it('counts a hundred thousand NaN positions without slowing down', () => {
        const positions = new Float32Array(300000).fill(NaN);
        const startedAt = performance.now();

        const count = countUniquePoints(positions);

        expect(count).toBe(100000);
        expect(performance.now() - startedAt).toBeLessThan(1000);
    });

    it('ignores a trailing incomplete position', () => {
        expect(countUniquePoints([1, 2, 3, 4, 5])).toBe(1);
    });
});
