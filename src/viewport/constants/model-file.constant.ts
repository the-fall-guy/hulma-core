export const SUPPORTED_MODEL_EXTENSIONS = ['glb', 'gltf', 'obj', 'fbx', 'stl', 'ply'];

export const RESOURCE_FILE_EXTENSIONS = ['bin', 'mtl', 'png', 'jpg', 'jpeg', 'webp', 'ktx2', 'tga', 'bmp'];

// Babylon reads the header of a PLY file from its first 10 KB, and so does the check that comes before it.
export const PLY_HEADER_BYTE_COUNT = 10 * 1024;

// A damaged file can leave Babylon's loader pending for good, which would hold every later import back with it.
export const MODEL_LOAD_TIMEOUT_MS = 60000;

// A texture Babylon's serializer cannot write can leave it pending for good, which would keep drawing paused and hold
// every later import and export back with it.
export const MODEL_EXPORT_TIMEOUT_MS = 60000;
