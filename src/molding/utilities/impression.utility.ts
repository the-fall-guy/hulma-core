/**
 * Removes the islands and fills the holes of a mask that cover fewer than minimumArea pixels. Islands and holes are
 * found with 4-connected labeling, and a hole is a background region that does not connect to the image border.
 * Returns a new mask.
 */
export function removeCrumbs(mask: Uint8Array, width: number, height: number, minimumArea: number): Uint8Array {
    // A region has at least one pixel, so none is smaller than a minimum area of 1 or less.
    if (minimumArea <= 1) {
        return mask.slice();
    }

    const withoutIslands = flipSmallRegions(mask, width, height, true, minimumArea);

    return flipSmallRegions(withoutIslands, width, height, false, minimumArea);
}

/**
 * Smooths the depths with a Gaussian of the given sigma in pixels, reaching ceil(3 * sigma) pixels out. Only masked
 * pixels take part, both as the pixel being smoothed and as its neighbors, and the weights are normalized over them,
 * so the background never bleeds into the edge. The result is NaN outside the mask. Returns a new array.
 */
export function smoothDepths(
    depths: Float32Array,
    mask: Uint8Array,
    width: number,
    height: number,
    sigma: number
): Float32Array {
    if (sigma <= 0) {
        return depths.slice();
    }

    const radius = Math.ceil(3 * sigma);
    const weights = new Float64Array(radius + 1);
    for (let offset = 0; offset <= radius; offset++) {
        weights[offset] = Math.exp(-(offset * offset) / (2 * sigma * sigma));
    }

    // Pass one runs along the rows. It keeps the weighted depth and the weight itself, summed over the masked pixels
    // in reach. Pass two runs down the columns over both sums, and dividing them gives exactly the 2D average.
    const pixelCount = width * height;
    const rowDepthSums = new Float32Array(pixelCount);
    const rowWeightSums = new Float32Array(pixelCount);
    for (let y = 0; y < height; y++) {
        const rowStart = y * width;
        for (let x = 0; x < width; x++) {
            const lastX = Math.min(x + radius, width - 1);
            let depthSum = 0;
            let weightSum = 0;
            for (let neighborX = Math.max(x - radius, 0); neighborX <= lastX; neighborX++) {
                if (mask[rowStart + neighborX] === 0) {
                    continue;
                }

                const weight = weights[Math.abs(neighborX - x)];
                depthSum += weight * depths[rowStart + neighborX];
                weightSum += weight;
            }
            rowDepthSums[rowStart + x] = depthSum;
            rowWeightSums[rowStart + x] = weightSum;
        }
    }

    const smoothed = new Float32Array(pixelCount).fill(NaN);
    const depthSums = new Float64Array(width);
    const weightSums = new Float64Array(width);
    for (let y = 0; y < height; y++) {
        const lastY = Math.min(y + radius, height - 1);
        depthSums.fill(0);
        weightSums.fill(0);
        for (let neighborY = Math.max(y - radius, 0); neighborY <= lastY; neighborY++) {
            const weight = weights[Math.abs(neighborY - y)];
            const neighborRowStart = neighborY * width;
            for (let x = 0; x < width; x++) {
                depthSums[x] += weight * rowDepthSums[neighborRowStart + x];
                weightSums[x] += weight * rowWeightSums[neighborRowStart + x];
            }
        }
        for (let x = 0; x < width; x++) {
            if (mask[y * width + x] !== 0) {
                smoothed[y * width + x] = depthSums[x] / weightSums[x];
            }
        }
    }

    return smoothed;
}

/**
 * Spreads the depths a few pixels past the edge of the mask, so that triangles near the outline have data to sample.
 * Each pixel outside the mask that is within radius steps of it, counting a diagonal as one step, takes the depth of
 * the nearest pixel inside. Pixels further out stay as they were. The mask is not changed. Returns a new array.
 */
export function extendDepths(
    depths: Float32Array,
    mask: Uint8Array,
    width: number,
    height: number,
    radius: number
): Float32Array {
    if (radius <= 0) {
        return depths.slice();
    }

    const extended = depths.slice();
    const pixelCount = width * height;
    // Marks the pixels that hold a depth: the mask, then each pixel as it gets filled.
    const hasDepth = mask.slice();
    // The breadth-first queue. It starts with every pixel inside the mask, and each pixel enters it once.
    const queue = new Int32Array(pixelCount);
    let queueEnd = 0;
    for (let index = 0; index < pixelCount; index++) {
        if (mask[index] !== 0) {
            queue[queueEnd++] = index;
        }
    }

    let queueStart = 0;
    for (let step = 0; step < radius; step++) {
        const levelEnd = queueEnd;
        while (queueStart < levelEnd) {
            const index = queue[queueStart++];
            const x = index % width;
            const y = (index - x) / width;
            const lastX = Math.min(x + 1, width - 1);
            const lastY = Math.min(y + 1, height - 1);
            for (let neighborY = Math.max(y - 1, 0); neighborY <= lastY; neighborY++) {
                for (let neighborX = Math.max(x - 1, 0); neighborX <= lastX; neighborX++) {
                    const neighbor = neighborY * width + neighborX;
                    if (hasDepth[neighbor] !== 0) {
                        continue;
                    }

                    hasDepth[neighbor] = 1;
                    extended[neighbor] = extended[index];
                    queue[queueEnd++] = neighbor;
                }
            }
        }
    }

    return extended;
}

/**
 * Flips every 4-connected region of foreground (or of background) that has fewer than minimumArea pixels. Background
 * that reaches the image border is the outside of the model rather than a hole, so it never flips. Returns a new mask.
 */
function flipSmallRegions(
    mask: Uint8Array,
    width: number,
    height: number,
    isForeground: boolean,
    minimumArea: number
): Uint8Array {
    const flipped = mask.slice();
    const pixelCount = width * height;
    const isVisited = new Uint8Array(pixelCount);
    // The pixels of the region being labeled. Each pixel joins one region only, so one queue serves them all.
    const region = new Int32Array(pixelCount);
    const neighborOffsetsX = [-1, 1, 0, 0];
    const neighborOffsetsY = [0, 0, -1, 1];

    for (let seed = 0; seed < pixelCount; seed++) {
        if (isVisited[seed] === 1 || (mask[seed] !== 0) !== isForeground) {
            continue;
        }

        let regionSize = 0;
        let isTouchingBorder = false;
        region[regionSize++] = seed;
        isVisited[seed] = 1;
        for (let cursor = 0; cursor < regionSize; cursor++) {
            const index = region[cursor];
            const x = index % width;
            const y = (index - x) / width;
            if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
                isTouchingBorder = true;
            }
            for (let direction = 0; direction < 4; direction++) {
                const neighborX = x + neighborOffsetsX[direction];
                const neighborY = y + neighborOffsetsY[direction];
                if (neighborX < 0 || neighborX >= width || neighborY < 0 || neighborY >= height) {
                    continue;
                }

                const neighbor = neighborY * width + neighborX;
                if (isVisited[neighbor] === 1 || (mask[neighbor] !== 0) !== isForeground) {
                    continue;
                }

                isVisited[neighbor] = 1;
                region[regionSize++] = neighbor;
            }
        }

        const isSmall = regionSize < minimumArea;
        const isOutside = !isForeground && isTouchingBorder;
        if (!isSmall || isOutside) {
            continue;
        }

        for (let cursor = 0; cursor < regionSize; cursor++) {
            flipped[region[cursor]] = isForeground ? 0 : 1;
        }
    }

    return flipped;
}
