const FLOAT_COMPONENT_TYPE = 5126;
const UNSIGNED_SHORT_COMPONENT_TYPE = 5123;
const TRIANGLE_POSITIONS = [0, 0, 0, 1, 0, 0, 0, 1, 0];
const TRIANGLE_UVS = [0, 0, 1, 0, 0, 1];
const TRIANGLE_BOUNDS = {min: [0, 0, 0], max: [1, 1, 0]};

// A 1x1 transparent PNG.
const PNG_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

function encodeBase64(bytes: Uint8Array): string {
    return btoa(String.fromCharCode(...bytes));
}

function createBinaryBuffer(positions: number[], extraBytes = new Uint8Array(0)): Uint8Array<ArrayBuffer> {
    const bytes = new Uint8Array(positions.length * 4 + extraBytes.length);
    bytes.set(new Uint8Array(new Float32Array(positions).buffer));
    bytes.set(extraBytes, positions.length * 4);

    return bytes;
}

function toDataUri(bytes: Uint8Array): string {
    return `data:application/octet-stream;base64,${encodeBase64(bytes)}`;
}

// One triangle with no indices accessor, which glTF allows: Babylon marks such a mesh as unindexed.
function createTriangleJson(bufferUri: string, nodes: object[] = [{mesh: 0}]): object {
    return {
        asset: {version: '2.0'},
        scene: 0,
        scenes: [{nodes: [0]}],
        nodes,
        meshes: [{primitives: [{attributes: {POSITION: 0}}]}],
        accessors: [{bufferView: 0, componentType: FLOAT_COMPONENT_TYPE, count: 3, type: 'VEC3', ...TRIANGLE_BOUNDS}],
        bufferViews: [{buffer: 0, byteLength: 36}],
        buffers: [{byteLength: 36, uri: bufferUri}],
    };
}

function createGltfFile(fileName: string, json: object): File {
    return new File([JSON.stringify(json)], fileName);
}

// Six faces of four corners each, wound counter-clockwise seen from outside, centered on x and z at y = -2.5.
function createCubeGeometry(): {positions: number[]; indices: number[]} {
    const positions: number[] = [];
    const indices: number[] = [];
    for (let axis = 0; axis < 3; axis++) {
        for (const sign of [-1, 1]) {
            const first = positions.length / 3;
            for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
                const corner = [0, 0, 0];
                corner[axis] = sign * 0.5;
                corner[(axis + 1) % 3] = u * 0.5;
                corner[(axis + 2) % 3] = v * 0.5;
                positions.push(corner[0], corner[1] - 2.5, corner[2]);
            }
            const quad = sign > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
            indices.push(...quad.map((corner) => first + corner));
        }
    }

    return {positions, indices};
}

export function createTriangleGltfFile(fileName = 'triangle.gltf'): File {
    const bytes = createBinaryBuffer(TRIANGLE_POSITIONS);

    return createGltfFile(fileName, createTriangleJson(toDataUri(bytes)));
}

// The triangle below a node that moves it, under a node that scales it: its world position is not its mesh's.
export function createTransformedGltfFile(fileName = 'transformed.gltf'): File {
    const nodes = [{children: [1], translation: [3, 4, 5]}, {mesh: 0, scale: [2, 2, 2]}];

    return createGltfFile(fileName, createTriangleJson(toDataUri(createBinaryBuffer(TRIANGLE_POSITIONS)), nodes));
}

export function createCubeGltfFile(fileName = 'cube.gltf'): File {
    const {positions, indices} = createCubeGeometry();
    const bytes = createBinaryBuffer(positions, new Uint8Array(new Uint16Array(indices).buffer));

    return createGltfFile(fileName, {
        asset: {version: '2.0'},
        scene: 0,
        scenes: [{nodes: [0]}],
        nodes: [{mesh: 0}],
        meshes: [{primitives: [{attributes: {POSITION: 0}, indices: 1}]}],
        accessors: [
            {
                bufferView: 0,
                componentType: FLOAT_COMPONENT_TYPE,
                count: positions.length / 3,
                type: 'VEC3',
                min: [-0.5, -3, -0.5],
                max: [0.5, -2, 0.5],
            },
            {bufferView: 1, componentType: UNSIGNED_SHORT_COMPONENT_TYPE, count: indices.length, type: 'SCALAR'},
        ],
        bufferViews: [
            {buffer: 0, byteOffset: 0, byteLength: positions.length * 4},
            {buffer: 0, byteOffset: positions.length * 4, byteLength: indices.length * 2},
        ],
        buffers: [{byteLength: bytes.length, uri: toDataUri(bytes)}],
    });
}

// A triangle whose base color is one image, and whose metallic-roughness and occlusion are another one.
export function createTexturedGltfFile(fileName = 'textured.gltf'): File {
    const uvBytes = new Uint8Array(new Float32Array(TRIANGLE_UVS).buffer);
    const bytes = createBinaryBuffer(TRIANGLE_POSITIONS, uvBytes);
    const imageUri = `data:image/png;base64,${PNG_BASE64}`;

    return createGltfFile(fileName, {
        asset: {version: '2.0'},
        scene: 0,
        scenes: [{nodes: [0]}],
        nodes: [{mesh: 0}],
        meshes: [{primitives: [{attributes: {POSITION: 0, TEXCOORD_0: 1}, material: 0}]}],
        materials: [
            {
                name: 'stone',
                pbrMetallicRoughness: {baseColorTexture: {index: 0}, metallicRoughnessTexture: {index: 1}},
                occlusionTexture: {index: 1},
            },
        ],
        textures: [{source: 0}, {source: 1}],
        images: [{uri: imageUri}, {uri: imageUri}],
        accessors: [
            {bufferView: 0, componentType: FLOAT_COMPONENT_TYPE, count: 3, type: 'VEC3', ...TRIANGLE_BOUNDS},
            {bufferView: 1, componentType: FLOAT_COMPONENT_TYPE, count: 3, type: 'VEC2'},
        ],
        bufferViews: [
            {buffer: 0, byteOffset: 0, byteLength: 36},
            {buffer: 0, byteOffset: 36, byteLength: uvBytes.length},
        ],
        buffers: [{byteLength: bytes.length, uri: toDataUri(bytes)}],
    });
}

export function createSplitGltfFiles(baseName = 'pair'): File[] {
    const binary = new File([createBinaryBuffer(TRIANGLE_POSITIONS)], `${baseName}.bin`);

    return [createGltfFile(`${baseName}.gltf`, createTriangleJson(`${baseName}.bin`)), binary];
}

// A scene with one node that has no mesh.
export function createEmptyGltfFile(fileName = 'empty.gltf'): File {
    return createGltfFile(fileName, {asset: {version: '2.0'}, scene: 0, scenes: [{nodes: [0]}], nodes: [{}]});
}

export function createUnreadableGlbFile(fileName = 'broken.glb'): File {
    return new File([crypto.getRandomValues(new Uint8Array(64))], fileName);
}

function createPlyFile(fileName: string, propertyNames: string[], vertices: number[][]): File {
    const header = [
        'ply',
        'format binary_little_endian 1.0',
        `element vertex ${vertices.length}`,
        ...propertyNames.map((name) => `property float ${name}`),
        'end_header',
        '',
    ].join('\n');

    return new File([header, new Float32Array(vertices.flat())], fileName);
}

// Three vertices and no faces, which Babylon loads as a point cloud.
export function createPointCloudPlyFile(fileName = 'points.ply'): File {
    return createPlyFile(fileName, ['x', 'y', 'z'], [[0, 0, 0], [1, 0, 0], [0, 1, 0]]);
}

// One Gaussian splat: position, color, opacity, scale and rotation, which Babylon loads as a splat mesh.
export function createSplatPlyFile(fileName = 'splat.ply'): File {
    const propertyNames = ['x', 'y', 'z', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity'];
    propertyNames.push('scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3');

    return createPlyFile(fileName, propertyNames, [[0, 0, 0, 0.5, 0.5, 0.5, 1, -2, -2, -2, 1, 0, 0, 0]]);
}
