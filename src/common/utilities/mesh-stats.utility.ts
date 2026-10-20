/**
 * Counts the distinct positions in a flat list of x, y, z triples. Two positions are the same when all three
 * coordinates are equal with ===, so -0 matches 0. A trailing incomplete triple is ignored.
 */
export function countUniquePoints(positions: ArrayLike<number>): number {
    const pointCount = Math.floor(positions.length / 3);

    // A hash table of point numbers (plus one, so that 0 marks a free slot) with linear probing, between 35% and 70%
    // full. A string key per point in a Set would be far too slow for a mesh of several hundred thousand vertices.
    let capacity = 2;
    while (capacity < pointCount * 0.5) {
        capacity *= 2;
    }
    const mask = capacity - 1;
    const table = new Int32Array(capacity);

    // The two 32-bit halves of a float, which are what gets hashed.
    const scratch = new Float64Array(1);
    const halves = new Uint32Array(scratch.buffer);
    const hashFloat = (hash: number, value: number): number => {
        // Adding 0 turns -0 into 0, so both hash alike.
        scratch[0] = value + 0;
        const mixed = Math.imul(Math.imul(hash ^ halves[0], 0x85ebca6b) ^ halves[1], 0xc2b2ae35);

        return mixed ^ (mixed >>> 15);
    };

    let uniqueCount = 0;
    for (let point = 0; point < pointCount; point++) {
        const x = positions[point * 3];
        const y = positions[point * 3 + 1];
        const z = positions[point * 3 + 2];

        // NaN equals nothing, not even itself, so such a point is always its own and is never looked up.
        if (Number.isNaN(x) || Number.isNaN(y) || Number.isNaN(z)) {
            uniqueCount++;
            continue;
        }

        let slot = hashFloat(hashFloat(hashFloat(0, x), y), z) & mask;
        while (table[slot] !== 0) {
            const other = (table[slot] - 1) * 3;
            if (positions[other] === x && positions[other + 1] === y && positions[other + 2] === z) {
                break;
            }
            slot = (slot + 1) & mask;
        }
        if (table[slot] === 0) {
            table[slot] = point + 1;
            uniqueCount++;
        }
    }

    return uniqueCount;
}
