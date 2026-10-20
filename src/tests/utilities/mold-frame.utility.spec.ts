import {IBounds} from '@core/math/interfaces/bounds.interface';
import {IVector3} from '@core/math/interfaces/vector.interface';
import {crossVectors, dotVectors, getVectorLength} from '@core/math/utilities/vector.utility';
import {TMoldDirection} from '@core/molding/interfaces/molding-settings.interface';
import {TPaintViewName} from '@core/molding/interfaces/paint-view.interface';
import {
    createMoldFrame,
    getFramePoint,
    getMoldAxes,
    getPaintViewAxes,
    getPaintViewWorldSizes,
    projectToFrame
} from '@core/molding/utilities/mold-frame.utility';

describe('mold frame utility', () => {
    const bounds: IBounds = {minimum: {x: -0.5, y: 0, z: -0.25}, maximum: {x: 0.5, y: 0.6, z: 0.25}};
    const directions: TMoldDirection[] = ['front-back', 'left-right', 'top-bottom'];
    const viewNames: TPaintViewName[] = [
        'front',
        'back',
        'side-u-positive',
        'side-u-negative',
        'side-v-positive',
        'side-v-negative',
    ];

    function expectVectorToBeClose(actual: IVector3, expected: IVector3): void {
        expect(actual.x).toBeCloseTo(expected.x, 9);
        expect(actual.y).toBeCloseTo(expected.y, 9);
        expect(actual.z).toBeCloseTo(expected.z, 9);
    }

    // A fixed sequence of numbers in [0, 1), so a failing round trip fails the same way on every run.
    function createRandomSequence(seed: number): () => number {
        let state = seed;

        return () => {
            state = (state * 1664525 + 1013904223) % 4294967296;

            return state / 4294967296;
        };
    }

    describe('getMoldAxes', () => {
        const rows = [
            {
                direction: 'front-back',
                depthAxis: {x: 0, y: 0, z: -1},
                uAxis: {x: 1, y: 0, z: 0},
                vAxis: {x: 0, y: -1, z: 0},
            },
            {
                direction: 'left-right',
                depthAxis: {x: -1, y: 0, z: 0},
                uAxis: {x: 0, y: 0, z: -1},
                vAxis: {x: 0, y: -1, z: 0},
            },
            {
                direction: 'top-bottom',
                depthAxis: {x: 0, y: -1, z: 0},
                uAxis: {x: 1, y: 0, z: 0},
                vAxis: {x: 0, y: 0, z: 1},
            },
        ] as const;

        for (const {direction, ...axes} of rows) {
            it(`returns the axes of ${direction} exactly`, () => {
                expect(getMoldAxes(direction)).toEqual(axes);
            });
        }

        it('makes u × v equal depth in every direction', () => {
            for (const direction of directions) {
                const {uAxis, vAxis, depthAxis} = getMoldAxes(direction);

                expectVectorToBeClose(crossVectors(uAxis, vAxis), depthAxis);
            }
        });

        it('returns new vectors on every call', () => {
            const first = getMoldAxes('front-back');
            first.uAxis.x = 99;

            expect(getMoldAxes('front-back').uAxis.x).toBe(1);
        });
    });

    describe('createMoldFrame', () => {
        const cases = [
            {
                direction: 'front-back',
                pixelSize: 1 / 96,
                width: 100,
                height: 62,
                depthRange: 0.5,
                nearCorner: {x: -0.5, y: 0.6, z: 0.25},
                farPixel: {u: 98, v: 59.6, depth: 0.5},
                farCorner: {x: 0.5, y: 0, z: -0.25},
            },
            {
                // The image is taller than it is wide here, so v carries the longest side.
                direction: 'left-right',
                pixelSize: 0.6 / 96,
                width: 84,
                height: 100,
                depthRange: 1,
                nearCorner: {x: 0.5, y: 0.6, z: 0.25},
                farPixel: {u: 82, v: 98, depth: 1},
                farCorner: {x: -0.5, y: 0, z: -0.25},
            },
            {
                direction: 'top-bottom',
                pixelSize: 1 / 96,
                width: 100,
                height: 52,
                depthRange: 0.6,
                nearCorner: {x: -0.5, y: 0.6, z: -0.25},
                farPixel: {u: 98, v: 50, depth: 0.6},
                farCorner: {x: 0.5, y: 0, z: 0.25},
            },
        ] as const;

        it('fits the longest side to the requested pixels, margins included', () => {
            const frame = createMoldFrame(bounds, 'front-back', 100, 2);

            expect(frame.width).toBe(100);
            expect(frame.height).toBe(62);
            expect(frame.pixelSize).toBeCloseTo(1 / 96, 12);
            expect(frame.depthRange).toBeCloseTo(0.5, 12);
        });

        it('maps pixel (2, 2) at depth 0 to the corner of the bounds', () => {
            const frame = createMoldFrame(bounds, 'front-back', 100, 2);

            expectVectorToBeClose(getFramePoint(frame, 2, 2, 0), {x: -0.5, y: 0.6, z: 0.25});
        });

        it('keeps the axes of the direction', () => {
            for (const direction of directions) {
                const frame = createMoldFrame(bounds, direction, 100, 2);
                const {uAxis, vAxis, depthAxis} = getMoldAxes(direction);

                expect(frame.uAxis).toEqual(uAxis);
                expect(frame.vAxis).toEqual(vAxis);
                expect(frame.depthAxis).toEqual(depthAxis);
            }
        });

        for (const testCase of cases) {
            it(`frames the bounds corner to corner for ${testCase.direction}`, () => {
                const frame = createMoldFrame(bounds, testCase.direction, 100, 2);

                expect(frame.width).toBe(testCase.width);
                expect(frame.height).toBe(testCase.height);
                expect(frame.pixelSize).toBeCloseTo(testCase.pixelSize, 12);
                expect(frame.depthRange).toBeCloseTo(testCase.depthRange, 12);
                expectVectorToBeClose(getFramePoint(frame, 2, 2, 0), testCase.nearCorner);
                const {u, v, depth} = testCase.farPixel;
                expectVectorToBeClose(getFramePoint(frame, u, v, depth), testCase.farCorner);
            });
        }

        it('scales the margin with the requested size', () => {
            const frame = createMoldFrame(bounds, 'front-back', 512, 8);

            expect(frame.width).toBe(512);
            expect(frame.height).toBe(Math.round(496 * 0.6) + 16);
            expectVectorToBeClose(getFramePoint(frame, 8, 8, 0), {x: -0.5, y: 0.6, z: 0.25});
        });

        it('does not mutate the bounds', () => {
            const originalBounds = structuredClone(bounds);

            createMoldFrame(bounds, 'front-back', 100, 2);

            expect(bounds).toEqual(originalBounds);
        });
    });

    describe('getFramePoint and projectToFrame', () => {
        it('round-trips 20 random points inside the bounds', () => {
            const random = createRandomSequence(7);

            for (const direction of directions) {
                const frame = createMoldFrame(bounds, direction, 100, 2);

                for (let count = 0; count < 20; count++) {
                    const point = {x: -0.5 + random(), y: 0.6 * random(), z: -0.25 + 0.5 * random()};

                    const {u, v, depth} = projectToFrame(frame, point);
                    const roundTrip = getFramePoint(frame, u, v, depth);

                    expect(roundTrip.x).toBeCloseTo(point.x, 6);
                    expect(roundTrip.y).toBeCloseTo(point.y, 6);
                    expect(roundTrip.z).toBeCloseTo(point.z, 6);
                }
            }
        });

        it('measures u and v in pixels and depth in world units from the front plane', () => {
            const frame = createMoldFrame(bounds, 'front-back', 100, 2);

            const center = projectToFrame(frame, {x: 0, y: 0.3, z: 0});

            expect(center.u).toBeCloseTo(50, 9);
            expect(center.v).toBeCloseTo(30.8, 9);
            expect(center.depth).toBeCloseTo(0.25, 9);
        });

        it('moves along u, v and depth one axis at a time', () => {
            const frame = createMoldFrame(bounds, 'front-back', 100, 2);
            const {x, y, z} = getFramePoint(frame, 10, 20, 0.1);

            // For front-back, u runs along +x, v along -y and depth along -z.
            expectVectorToBeClose(getFramePoint(frame, 11, 20, 0.1), {x: x + frame.pixelSize, y, z});
            expectVectorToBeClose(getFramePoint(frame, 10, 21, 0.1), {x, y: y - frame.pixelSize, z});
            expectVectorToBeClose(getFramePoint(frame, 10, 20, 0.2), {x, y, z: z - 0.1});
        });
    });

    describe('getPaintViewAxes', () => {
        it('returns six axis sets in the paint view order', () => {
            for (const direction of directions) {
                expect(getPaintViewAxes(direction).map((view) => view.viewName)).toEqual(viewNames);
            }
        });

        it('returns orthonormal axes for every view', () => {
            for (const direction of directions) {
                for (const {uAxis, vAxis, depthAxis} of getPaintViewAxes(direction)) {
                    expect(getVectorLength(uAxis)).toBeCloseTo(1, 9);
                    expect(getVectorLength(vAxis)).toBeCloseTo(1, 9);
                    expect(getVectorLength(depthAxis)).toBeCloseTo(1, 9);
                    expect(dotVectors(uAxis, vAxis)).toBeCloseTo(0, 9);
                    expect(dotVectors(uAxis, depthAxis)).toBeCloseTo(0, 9);
                    expect(dotVectors(vAxis, depthAxis)).toBeCloseTo(0, 9);
                }
            }
        });

        it('makes u × v equal depth for every view except back', () => {
            for (const direction of directions) {
                for (const {viewName, uAxis, vAxis, depthAxis} of getPaintViewAxes(direction)) {
                    if (viewName === 'back') {
                        continue;
                    }

                    expectVectorToBeClose(crossVectors(uAxis, vAxis), depthAxis);
                }
            }
        });

        it('mirrors back on purpose: the front u and v with the opposite depth', () => {
            for (const direction of directions) {
                const [front, back] = getPaintViewAxes(direction);

                expectVectorToBeClose(back.uAxis, front.uAxis);
                expectVectorToBeClose(back.vAxis, front.vAxis);
                expectVectorToBeClose(back.depthAxis, {
                    x: -front.depthAxis.x,
                    y: -front.depthAxis.y,
                    z: -front.depthAxis.z,
                });
                expectVectorToBeClose(crossVectors(back.uAxis, back.vAxis), front.depthAxis);
            }
        });

        it('uses the mold frame as the front view', () => {
            for (const direction of directions) {
                const [front] = getPaintViewAxes(direction);

                expect(front).toEqual({viewName: 'front', ...getMoldAxes(direction)});
            }
        });

        it('looks at each side view from its own side, back along the opposite axis', () => {
            for (const direction of directions) {
                const {uAxis, vAxis} = getMoldAxes(direction);
                const [, , uPositive, uNegative, vPositive, vNegative] = getPaintViewAxes(direction);

                expect(dotVectors(uPositive.depthAxis, uAxis)).toBeCloseTo(-1, 9);
                expect(dotVectors(uNegative.depthAxis, uAxis)).toBeCloseTo(1, 9);
                expect(dotVectors(vPositive.depthAxis, vAxis)).toBeCloseTo(-1, 9);
                expect(dotVectors(vNegative.depthAxis, vAxis)).toBeCloseTo(1, 9);
            }
        });

        it('keeps the depth of every side view perpendicular to the mold axis', () => {
            for (const direction of directions) {
                const moldDepthAxis = getMoldAxes(direction).depthAxis;
                const sideViews = getPaintViewAxes(direction).filter((view) => view.viewName.startsWith('side-'));

                expect(sideViews).toHaveLength(4);
                for (const view of sideViews) {
                    expect(dotVectors(view.depthAxis, moldDepthAxis), view.viewName).toBeCloseTo(0, 9);
                }
            }
        });

        it('lays out the views of front-back', () => {
            expect(getPaintViewAxes('front-back')).toEqual([
                {
                    viewName: 'front',
                    uAxis: {x: 1, y: 0, z: 0},
                    vAxis: {x: 0, y: -1, z: 0},
                    depthAxis: {x: 0, y: 0, z: -1},
                },
                {
                    viewName: 'back',
                    uAxis: {x: 1, y: 0, z: 0},
                    vAxis: {x: 0, y: -1, z: 0},
                    depthAxis: {x: 0, y: 0, z: 1},
                },
                {
                    viewName: 'side-u-positive',
                    uAxis: {x: 0, y: 0, z: -1},
                    vAxis: {x: 0, y: -1, z: 0},
                    depthAxis: {x: -1, y: 0, z: 0},
                },
                {
                    viewName: 'side-u-negative',
                    uAxis: {x: 0, y: 0, z: 1},
                    vAxis: {x: 0, y: -1, z: 0},
                    depthAxis: {x: 1, y: 0, z: 0},
                },
                {
                    viewName: 'side-v-positive',
                    uAxis: {x: 1, y: 0, z: 0},
                    vAxis: {x: 0, y: 0, z: -1},
                    depthAxis: {x: 0, y: 1, z: 0},
                },
                {
                    viewName: 'side-v-negative',
                    uAxis: {x: 1, y: 0, z: 0},
                    vAxis: {x: 0, y: 0, z: 1},
                    depthAxis: {x: 0, y: -1, z: 0},
                },
            ]);
        });
    });

    describe('getPaintViewWorldSizes', () => {
        it('measures the image extent of each view for front-back', () => {
            expect(getPaintViewWorldSizes(bounds, 'front-back')).toEqual([
                {viewName: 'front', width: 1, height: 0.6},
                {viewName: 'back', width: 1, height: 0.6},
                {viewName: 'side-u-positive', width: 0.5, height: 0.6},
                {viewName: 'side-u-negative', width: 0.5, height: 0.6},
                {viewName: 'side-v-positive', width: 1, height: 0.5},
                {viewName: 'side-v-negative', width: 1, height: 0.5},
            ]);
        });

        it('measures the image extent of each view for left-right', () => {
            expect(getPaintViewWorldSizes(bounds, 'left-right')).toEqual([
                {viewName: 'front', width: 0.5, height: 0.6},
                {viewName: 'back', width: 0.5, height: 0.6},
                {viewName: 'side-u-positive', width: 1, height: 0.6},
                {viewName: 'side-u-negative', width: 1, height: 0.6},
                {viewName: 'side-v-positive', width: 0.5, height: 1},
                {viewName: 'side-v-negative', width: 0.5, height: 1},
            ]);
        });

        it('measures the image extent of each view for top-bottom', () => {
            expect(getPaintViewWorldSizes(bounds, 'top-bottom')).toEqual([
                {viewName: 'front', width: 1, height: 0.5},
                {viewName: 'back', width: 1, height: 0.5},
                {viewName: 'side-u-positive', width: 0.6, height: 0.5},
                {viewName: 'side-u-negative', width: 0.6, height: 0.5},
                {viewName: 'side-v-positive', width: 1, height: 0.6},
                {viewName: 'side-v-negative', width: 1, height: 0.6},
            ]);
        });

        it('does not depend on where the bounds sit', () => {
            const movedBounds = {minimum: {x: 10, y: -4, z: 7}, maximum: {x: 11, y: -3.4, z: 7.5}};

            for (const direction of directions) {
                const sizes = getPaintViewWorldSizes(movedBounds, direction);
                const expectedSizes = getPaintViewWorldSizes(bounds, direction);

                sizes.forEach((size, index) => {
                    expect(size.viewName).toBe(expectedSizes[index].viewName);
                    expect(size.width).toBeCloseTo(expectedSizes[index].width, 9);
                    expect(size.height).toBeCloseTo(expectedSizes[index].height, 9);
                });
            }
        });

        it('does not mutate the bounds', () => {
            const originalBounds = structuredClone(bounds);

            getPaintViewWorldSizes(bounds, 'front-back');

            expect(bounds).toEqual(originalBounds);
        });
    });
});
