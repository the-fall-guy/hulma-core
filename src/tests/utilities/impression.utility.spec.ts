import {extendDepths, removeCrumbs, smoothDepths} from '@core/molding/utilities/impression.utility';

describe('impression utility', () => {
    function createMask(width: number, height: number, isFilled: (x: number, y: number) => boolean): Uint8Array {
        const mask = new Uint8Array(width * height);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                mask[y * width + x] = isFilled(x, y) ? 1 : 0;
            }
        }

        return mask;
    }

    function isInsideRectangle(
        x: number,
        y: number,
        left: number,
        top: number,
        rectangleWidth: number,
        rectangleHeight: number
    ): boolean {
        return x >= left && x < left + rectangleWidth && y >= top && y < top + rectangleHeight;
    }

    // Depths inside the mask and NaN outside it, the way an impression holds them.
    function createDepths(mask: Uint8Array, width: number, getDepth: (x: number, y: number) => number): Float32Array {
        return Float32Array.from(mask, (value, index) => {
            return value === 0 ? NaN : getDepth(index % width, Math.floor(index / width));
        });
    }

    // Draws # for a filled pixel and . for an empty one, so that a failing mask shows its shape.
    function drawMask(mask: Uint8Array, width: number): string[] {
        const rows: string[] = [];
        for (let start = 0; start < mask.length; start += width) {
            rows.push(Array.from(mask.slice(start, start + width), (value) => (value === 0 ? '.' : '#')).join(''));
        }

        return rows;
    }

    function parseMask(rows: string[]): Uint8Array {
        return Uint8Array.from(rows.join(''), (character) => (character === '#' ? 1 : 0));
    }

    describe('removeCrumbs', () => {
        const block = (x: number, y: number): boolean => isInsideRectangle(x, y, 3, 3, 6, 6);
        const island = (x: number, y: number): boolean => isInsideRectangle(x, y, 14, 14, 2, 2);
        const solid = (x: number, y: number): boolean => isInsideRectangle(x, y, 2, 2, 10, 10);

        it('removes islands smaller than the minimum area', () => {
            const mask = createMask(20, 20, (x, y) => block(x, y) || island(x, y));

            const cleaned = removeCrumbs(mask, 20, 20, 10);

            expect(cleaned).toEqual(createMask(20, 20, block));
        });

        it('fills holes smaller than the minimum area', () => {
            const mask = createMask(14, 14, (x, y) => solid(x, y) && !isInsideRectangle(x, y, 6, 6, 2, 2));

            const cleaned = removeCrumbs(mask, 14, 14, 10);

            expect(cleaned).toEqual(createMask(14, 14, solid));
        });

        it('keeps holes at least the minimum area', () => {
            const mask = createMask(14, 14, (x, y) => solid(x, y) && !isInsideRectangle(x, y, 5, 5, 4, 4));

            const cleaned = removeCrumbs(mask, 14, 14, 10);

            expect(cleaned).toEqual(mask);
        });

        it('keeps an island and a hole that are exactly the minimum area', () => {
            const mask = createMask(24, 14, (x, y) => {
                const isRing = solid(x, y) && !isInsideRectangle(x, y, 5, 5, 5, 2);

                return isRing || isInsideRectangle(x, y, 16, 2, 5, 2);
            });

            const cleaned = removeCrumbs(mask, 24, 14, 10);

            expect(cleaned).toEqual(mask);
        });

        it('does not mutate its input', () => {
            const mask = createMask(20, 20, (x, y) => block(x, y) || island(x, y));
            const originalMask = mask.slice();

            const cleaned = removeCrumbs(mask, 20, 20, 10);

            expect(cleaned).not.toEqual(originalMask);
            expect(cleaned).not.toBe(mask);
            expect(mask).toEqual(originalMask);
        });

        it('removes an island that touches the image border', () => {
            const mask = parseMask([
                '#....',
                '#.###',
                '..###',
                '..###',
                '.....',
            ]);

            expect(drawMask(removeCrumbs(mask, 5, 5, 3), 5)).toEqual([
                '.....',
                '..###',
                '..###',
                '..###',
                '.....',
            ]);
        });

        it('never fills background that touches the image border', () => {
            const mask = parseMask([
                '.####',
                '#####',
                '#####',
                '#####',
                '#####',
            ]);

            expect(removeCrumbs(mask, 5, 5, 3)).toEqual(mask);
        });

        it('counts islands that meet only at a corner as separate islands', () => {
            // Two blocks of 9 pixels. Joined they would reach the minimum area of 10.
            const mask = createMask(8, 8, (x, y) => {
                return isInsideRectangle(x, y, 1, 1, 3, 3) || isInsideRectangle(x, y, 4, 4, 3, 3);
            });

            expect(removeCrumbs(mask, 8, 8, 10)).toEqual(new Uint8Array(64));
        });

        it('treats a gap that is only diagonal as closed, so the pixel inside is a hole', () => {
            const mask = parseMask([
                '.....',
                '.###.',
                '.#.#.',
                '.##..',
                '.....',
            ]);

            expect(drawMask(removeCrumbs(mask, 5, 5, 2), 5)).toEqual([
                '.....',
                '.###.',
                '.###.',
                '.##..',
                '.....',
            ]);
        });

        it('returns an unchanged copy when the minimum area is 0', () => {
            const mask = createMask(20, 20, (x, y) => block(x, y) || island(x, y));

            const cleaned = removeCrumbs(mask, 20, 20, 0);

            expect(cleaned).toEqual(mask);
            expect(cleaned).not.toBe(mask);
        });

        it('takes a single pixel for a crumb only from a minimum area of 2', () => {
            const mask = parseMask([
                '#....',
                '.....',
                '..###',
                '..#.#',
                '..###',
            ]);

            expect(removeCrumbs(mask, 5, 5, 1)).toEqual(mask);
            expect(drawMask(removeCrumbs(mask, 5, 5, 2), 5)).toEqual([
                '.....',
                '.....',
                '..###',
                '..###',
                '..###',
            ]);
        });
    });

    describe('smoothDepths', () => {
        // The same average, summed pixel by pixel over the whole square window instead of in two passes.
        function smoothDirectly(
            depths: Float32Array,
            mask: Uint8Array,
            width: number,
            height: number,
            sigma: number
        ): Float32Array {
            const radius = Math.ceil(3 * sigma);
            const smoothed = new Float32Array(depths.length).fill(NaN);
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    if (mask[y * width + x] === 0) {
                        continue;
                    }

                    const firstX = Math.max(x - radius, 0);
                    const lastX = Math.min(x + radius, width - 1);
                    const firstY = Math.max(y - radius, 0);
                    const lastY = Math.min(y + radius, height - 1);
                    let weightedSum = 0;
                    let weightSum = 0;
                    for (let neighborY = firstY; neighborY <= lastY; neighborY++) {
                        for (let neighborX = firstX; neighborX <= lastX; neighborX++) {
                            if (mask[neighborY * width + neighborX] === 0) {
                                continue;
                            }

                            const squaredDistance = (neighborX - x) ** 2 + (neighborY - y) ** 2;
                            const weight = Math.exp(-squaredDistance / (2 * sigma * sigma));
                            weightedSum += weight * depths[neighborY * width + neighborX];
                            weightSum += weight;
                        }
                    }
                    smoothed[y * width + x] = weightedSum / weightSum;
                }
            }

            return smoothed;
        }

        it('keeps a flat surface flat', () => {
            const width = 12;
            const height = 10;
            // An L shape, so the mask has corners and a concave edge.
            const mask = createMask(width, height, (x, y) => {
                return isInsideRectangle(x, y, 2, 2, 8, 6) && !isInsideRectangle(x, y, 6, 2, 4, 3);
            });
            const depths = createDepths(mask, width, () => 0.3);

            const smoothed = smoothDepths(depths, mask, width, height, 1.5);

            for (let index = 0; index < mask.length; index++) {
                if (mask[index] === 0) {
                    expect(smoothed[index]).toBeNaN();
                    continue;
                }
                expect(Math.abs(smoothed[index] - 0.3)).toBeLessThan(1e-6);
            }
        });

        it('never pulls the background into the edge', () => {
            const width = 8;
            const height = 5;
            const mask = createMask(width, height, (x) => x <= 3);
            // Depths from 0.4 to 0.55 across the mask. Background counted as 0 would drag the edge far below 0.4.
            const depths = createDepths(mask, width, (x) => 0.4 + 0.05 * x);

            const smoothed = smoothDepths(depths, mask, width, height, 1);

            // Pixel (3, 2) sits right next to the NaN background.
            const edgeDepth = smoothed[2 * width + 3];
            expect(Number.isFinite(edgeDepth)).toBe(true);
            expect(edgeDepth).toBeGreaterThanOrEqual(0.4);
            expect(edgeDepth).toBeLessThanOrEqual(0.55);
            for (let index = 0; index < mask.length; index++) {
                if (mask[index] === 0) {
                    expect(smoothed[index]).toBeNaN();
                    continue;
                }
                expect(smoothed[index]).toBeGreaterThanOrEqual(0.4 - 1e-6);
                expect(smoothed[index]).toBeLessThanOrEqual(0.55 + 1e-6);
            }
        });

        it('returns a copy when sigma is 0', () => {
            const width = 6;
            const height = 4;
            const mask = createMask(width, height, (x, y) => isInsideRectangle(x, y, 1, 1, 4, 2));
            const depths = createDepths(mask, width, (x, y) => 0.1 * x + 0.01 * y);

            const smoothed = smoothDepths(depths, mask, width, height, 0);

            expect(smoothed).not.toBe(depths);
            expect(smoothed).toEqual(depths);
        });

        it('averages each pixel with a Gaussian over the masked pixels around it', () => {
            const width = 15;
            const height = 12;
            const sigma = 1.3;
            const mask = createMask(width, height, (x, y) => {
                return isInsideRectangle(x, y, 1, 1, 12, 9) && !isInsideRectangle(x, y, 5, 4, 3, 3);
            });
            // Depths that jump about from pixel to pixel, so that smoothing visibly changes them.
            const depths = createDepths(mask, width, (x, y) => 0.2 + 0.05 * ((x * 7 + y * 13) % 11));

            const smoothed = smoothDepths(depths, mask, width, height, sigma);
            const expected = smoothDirectly(depths, mask, width, height, sigma);

            let largestChange = 0;
            for (let index = 0; index < mask.length; index++) {
                if (mask[index] === 0) {
                    expect(smoothed[index]).toBeNaN();
                    continue;
                }
                expect(Math.abs(smoothed[index] - expected[index])).toBeLessThan(1e-6);
                largestChange = Math.max(largestChange, Math.abs(smoothed[index] - depths[index]));
            }
            expect(largestChange).toBeGreaterThan(0.05);
        });

        it('does not mutate its inputs', () => {
            const width = 8;
            const height = 6;
            const mask = createMask(width, height, (x, y) => isInsideRectangle(x, y, 1, 1, 5, 3));
            const depths = createDepths(mask, width, (x, y) => 0.1 * x + 0.02 * y);
            const originalMask = mask.slice();
            const originalDepths = depths.slice();

            smoothDepths(depths, mask, width, height, 1.5);

            expect(mask).toEqual(originalMask);
            expect(depths).toEqual(originalDepths);
        });
    });

    describe('extendDepths', () => {
        it('fills a ring outside the mask with the nearest inside value', () => {
            const width = 12;
            const height = 12;
            const mask = createMask(width, height, (x, y) => isInsideRectangle(x, y, 4, 4, 4, 4));
            const depths = createDepths(mask, width, () => 0.5);
            const originalMask = mask.slice();

            const extended = extendDepths(depths, mask, width, height, 2);

            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    // The distance to the 4 × 4 block, counting a diagonal step as one.
                    const distance = Math.max(Math.max(4 - x, x - 7, 0), Math.max(4 - y, y - 7, 0));
                    const depth = extended[y * width + x];
                    if (distance <= 2) {
                        expect(depth, `(${x}, ${y})`).toBe(0.5);
                    } else {
                        expect(depth, `(${x}, ${y})`).toBeNaN();
                    }
                }
            }
            expect(mask).toEqual(originalMask);
        });

        it('takes the value of the nearest inside pixel on each side', () => {
            const width = 12;
            const height = 12;
            const mask = createMask(width, height, (x, y) => isInsideRectangle(x, y, 4, 4, 4, 4));
            const depths = createDepths(mask, width, (x) => (x < 6 ? 0.2 : 0.8));

            const extended = extendDepths(depths, mask, width, height, 2);

            // Left of the block, above its left half, above its right half and on the right.
            for (const [x, y] of [[2, 5], [3, 5], [3, 3], [4, 3]]) {
                expect(extended[y * width + x], `(${x}, ${y})`).toBeCloseTo(0.2, 6);
            }
            for (const [x, y] of [[7, 3], [8, 3], [8, 5], [9, 5]]) {
                expect(extended[y * width + x], `(${x}, ${y})`).toBeCloseTo(0.8, 6);
            }
            // The pixels inside the mask keep their own depth.
            expect(extended[5 * width + 4]).toBeCloseTo(0.2, 6);
            expect(extended[5 * width + 7]).toBeCloseTo(0.8, 6);
        });

        it('does not wrap around the image edges', () => {
            const width = 8;
            const height = 6;
            const mask = createMask(width, height, (x, y) => isInsideRectangle(x, y, 6, 2, 2, 2));
            const depths = createDepths(mask, width, () => 0.5);

            const extended = extendDepths(depths, mask, width, height, 2);

            for (let y = 0; y < height; y++) {
                expect(extended[y * width], `(0, ${y})`).toBeNaN();
                expect(extended[y * width + 1], `(1, ${y})`).toBeNaN();
            }
            expect(extended[1 * width + 4]).toBe(0.5);
            expect(extended[4 * width + 7]).toBe(0.5);
        });

        it('returns a copy when the radius is 0', () => {
            const width = 6;
            const height = 6;
            const mask = createMask(width, height, (x, y) => isInsideRectangle(x, y, 2, 2, 2, 2));
            const depths = createDepths(mask, width, () => 0.5);

            const extended = extendDepths(depths, mask, width, height, 0);

            expect(extended).not.toBe(depths);
            expect(extended).toEqual(depths);
        });

        it('does not mutate its inputs', () => {
            const width = 8;
            const height = 8;
            const mask = createMask(width, height, (x, y) => isInsideRectangle(x, y, 3, 3, 2, 2));
            const depths = createDepths(mask, width, () => 0.5);
            const originalMask = mask.slice();
            const originalDepths = depths.slice();

            extendDepths(depths, mask, width, height, 2);

            expect(mask).toEqual(originalMask);
            expect(depths).toEqual(originalDepths);
        });
    });
});
