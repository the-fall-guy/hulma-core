import type {AbstractMesh} from '@babylonjs/core/Meshes/abstractMesh';
import type {TransformNode} from '@babylonjs/core/Meshes/transformNode';

/** What the viewport keeps for each object it holds. Internal: index.ts does not export it. */
export interface ISceneEntry {
    id: string;
    name: string;
    fileName: string;
    root: TransformNode;
    originalMeshes: AbstractMesh[];
}
