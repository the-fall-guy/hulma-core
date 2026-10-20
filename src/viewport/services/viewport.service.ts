import {ArcRotateCamera} from '@babylonjs/core/Cameras/arcRotateCamera';
import '@babylonjs/core/Culling/ray';
import {Engine} from '@babylonjs/core/Engines/engine';
import {PointerEventTypes} from '@babylonjs/core/Events/pointerEvents';
import type {PointerInfo} from '@babylonjs/core/Events/pointerEvents';
import {SelectionOutlineLayer} from '@babylonjs/core/Layers/selectionOutlineLayer';
import {DirectionalLight} from '@babylonjs/core/Lights/directionalLight';
import {HemisphericLight} from '@babylonjs/core/Lights/hemisphericLight';
import {LoadAssetContainerAsync} from '@babylonjs/core/Loading/sceneLoader';
import type {Material} from '@babylonjs/core/Materials/material';
import {PBRMaterial} from '@babylonjs/core/Materials/PBR/pbrMaterial';
import {StandardMaterial} from '@babylonjs/core/Materials/standardMaterial';
import {HDRCubeTexture} from '@babylonjs/core/Materials/Textures/hdrCubeTexture';
import {Color3} from '@babylonjs/core/Maths/math.color';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import type {AbstractMesh} from '@babylonjs/core/Meshes/abstractMesh';
import {CreateGround} from '@babylonjs/core/Meshes/Builders/groundBuilder';
import {CreateLines} from '@babylonjs/core/Meshes/Builders/linesBuilder';
import {Mesh} from '@babylonjs/core/Meshes/mesh';
import {TransformNode} from '@babylonjs/core/Meshes/transformNode';
import {FilesInputStore} from '@babylonjs/core/Misc/filesInputStore';
import type {Node} from '@babylonjs/core/node';
import {Scene} from '@babylonjs/core/scene';
import {registerBuiltInLoaders} from '@babylonjs/loaders/dynamic';
import type {} from '@babylonjs/loaders/SPLAT/splatFileLoader.types';
import {GridMaterial} from '@babylonjs/materials/grid/gridMaterial';
import {IMeshStats} from '@core/common/interfaces/mesh-stats.interface';
import {countUniquePoints} from '@core/common/utilities/mesh-stats.utility';
import {getBoundsSize, getGroundingOffset} from '@core/math/utilities/bounds.utility';
import {
    AXIS_X_COLOR,
    AXIS_Z_COLOR,
    BLENDER_NAVIGATION_INPUT_MAP,
    CLAY_COLOR,
    EDITABLE_TAG_NAMES,
    GRID_LINE_COLOR,
    GRID_LINE_OPACITY,
    GRID_SIZE,
    NUMPAD_VIEWS,
    SELECTION_OUTLINE_COLOR,
    VIEWPORT_BACKGROUND_COLOR,
    WIREFRAME_ALPHA,
    WIREFRAME_COLOR
} from '@core/viewport/constants/viewport.constant';
import {ICameraAngles} from '@core/viewport/interfaces/camera-angles.interface';
import {IImportResult} from '@core/viewport/interfaces/import-result.interface';
import {ISceneEntry} from '@core/viewport/interfaces/scene-entry.interface';
import {ISceneObject} from '@core/viewport/interfaces/scene-object.interface';
import {TShadingMode} from '@core/viewport/interfaces/shading-mode.interface';
import {ITextureInfo} from '@core/viewport/interfaces/texture-info.interface';
import {IViewportOptions} from '@core/viewport/interfaces/viewport-options.interface';
import {groupDroppedFiles} from '@core/viewport/utilities/model-file.utility';
import {createUniqueObjectName, getObjectNameFromFileName} from '@core/viewport/utilities/object-name.utility';

export class Viewport {
    private readonly canvas: HTMLCanvasElement;
    private readonly options: IViewportOptions;
    private engine?: Engine;
    private babylonScene!: Scene;
    private babylonCamera!: ArcRotateCamera;
    private outlineLayer!: SelectionOutlineLayer;
    private clayMaterial!: PBRMaterial;
    private wireframeMaterial!: StandardMaterial;
    private resizeObserver?: ResizeObserver;
    private isPointerOverCanvas = false;
    private shadingMode: TShadingMode = 'textured';
    private isWireframeVisible = false;
    private objectCounter = 0;
    private selectedEntry: ISceneEntry | null = null;

    // Settles when the import that started last is done, so that the next one waits for its turn.
    private lastImport: Promise<void> = Promise.resolve();

    private readonly sceneEntries = new Map<string, ISceneEntry>();
    private readonly pickListeners: ((objectId: string | null) => void)[] = [];

    // What each model mesh was loaded with, and the wireframe overlay that sits on it once there is one.
    private readonly originalMaterials = new Map<AbstractMesh, Material | null>();
    private readonly wireframeOverlays = new Map<AbstractMesh, Mesh>();

    // Key code, with a Ctrl+ prefix while Ctrl is held, to what the key does.
    private readonly shortcuts: Partial<Record<string, () => void>> = {
        ...Object.fromEntries(
            Object.entries(NUMPAD_VIEWS).map(([key, view]): [string, () => void] => [key, () => this.jumpToView(view)])
        ),
        Home: () => this.frameSelection(),
        NumpadDecimal: () => this.frameSelection(),
    };

    private readonly trackPointerOverCanvas = (event: PointerEvent): void => {
        this.isPointerOverCanvas = event.type === 'pointerenter';
    };

    private readonly runShortcut = (event: KeyboardEvent): void => {
        if (event.altKey || event.shiftKey || event.metaKey) {
            return;
        }

        const shortcut = this.shortcuts[event.ctrlKey ? `Ctrl+${event.code}` : event.code];
        if (!shortcut) {
            return;
        }

        // Like Blender, shortcuts also work while the pointer hovers the canvas, except when typing in a field.
        const target = event.target as HTMLElement | null;
        const isTargetEditable =
            target?.isContentEditable === true || EDITABLE_TAG_NAMES.includes(target?.tagName ?? '');
        if (target !== this.canvas && (!this.isPointerOverCanvas || isTargetEditable)) {
            return;
        }

        // Cancel the key so the browser leaves it alone: Ctrl+Numpad1 would select a tab, and with NumLock off
        // Numpad1, 3 and 7 are End, PageDown and Home, which scroll.
        event.preventDefault();
        shortcut();
    };

    private readonly reportPick = (pointerInfo: PointerInfo): void => {
        // Like Blender, only a click of the primary button selects: a middle or right click leaves the selection be.
        if (pointerInfo.event.button !== 0) {
            return;
        }

        // The picked mesh sits somewhere below the root node of its object.
        const entries = [...this.sceneEntries.values()];
        let objectId: string | null = null;
        let node: Node | null = pointerInfo.pickInfo?.pickedMesh ?? null;
        while (node && objectId === null) {
            objectId = entries.find((entry) => entry.root === node)?.id ?? null;
            node = node.parent;
        }

        for (const listener of this.pickListeners) {
            listener(objectId);
        }
    };

    constructor(canvas: HTMLCanvasElement, options: IViewportOptions) {
        this.canvas = canvas;
        this.options = options;
    }

    public async start(): Promise<void> {
        // Renders at the device pixel ratio, capped at 2.
        const engine = new Engine(
            this.canvas,
            true,
            {preserveDrawingBuffer: false, stencil: true, limitDeviceRatio: 2},
            true
        );
        this.engine = engine;

        this.babylonScene = new Scene(engine);
        this.babylonScene.useRightHandedSystem = true;
        this.babylonScene.clearColor = Color3.FromHexString(VIEWPORT_BACKGROUND_COLOR).toColor4();

        // Starts on a three-quarter view from the front right, like Blender's default.
        this.babylonCamera = new ArcRotateCamera(
            'camera',
            Math.PI / 4,
            Math.PI / 3,
            3,
            Vector3.Zero(),
            this.babylonScene
        );
        this.babylonCamera.attachControl();
        // Babylon edits its input map in place, so every camera gets its own copy and the constant stays untouched.
        this.babylonCamera.movement.input.inputMap = structuredClone(BLENDER_NAVIGATION_INPUT_MAP);
        this.babylonCamera.wheelDeltaPercentage = 0.01;
        this.babylonCamera.lowerRadiusLimit = 0.01;
        // Blender's clip start. Babylon's default of 1 clips a model once the camera is within a unit of it.
        this.babylonCamera.minZ = 0.01;

        this.createGrid();
        this.createAxes();
        this.createLighting();
        this.createModelStyles();

        // Each loader is imported the first time a file needs it.
        registerBuiltInLoaders();
        // Dragging to orbit is no tap, so it never picks.
        this.babylonScene.onPointerObservable.add(this.reportPick, PointerEventTypes.POINTERTAP);

        engine.runRenderLoop(() => this.babylonScene.render());
        this.resizeObserver = new ResizeObserver(() => engine.resize());
        this.resizeObserver.observe(this.canvas);
        this.canvas.addEventListener('pointerenter', this.trackPointerOverCanvas);
        this.canvas.addEventListener('pointerleave', this.trackPointerOverCanvas);
        this.canvas.ownerDocument.addEventListener('keydown', this.runShortcut);
    }

    public dispose(): void {
        this.canvas.ownerDocument.removeEventListener('keydown', this.runShortcut);
        this.canvas.removeEventListener('pointerenter', this.trackPointerOverCanvas);
        this.canvas.removeEventListener('pointerleave', this.trackPointerOverCanvas);
        this.resizeObserver?.disconnect();
        this.engine?.dispose();
    }

    /**
     * Adds the model files of a drop to the scene, one object each, with the other files of the drop as their
     * resources (a .bin, an .mtl, textures). An object lands at the center of the grid with its base on it, and the
     * camera frames the last one. Files that cannot be opened are named in `failures`. A drop that arrives while
     * another is being imported waits for it.
     */
    public async importFiles(files: File[]): Promise<IImportResult> {
        const earlierImport = this.lastImport;
        let finishImport = (): void => undefined;
        this.lastImport = new Promise<void>((resolve) => {
            finishImport = resolve;
        });
        await earlierImport;

        const {modelFiles, resourceFiles, unsupportedFiles} = groupDroppedFiles(files);
        const result: IImportResult = {
            sceneObjects: [],
            failures: unsupportedFiles.map((file) => ({fileName: file.name, reason: 'unsupported-format'})),
        };

        // A model finds its .bin, .mtl and textures here, by their lowercase names.
        const storedNames = [...modelFiles, ...resourceFiles].map((file) => file.name.toLowerCase());
        for (const file of [...modelFiles, ...resourceFiles]) {
            FilesInputStore.FilesToLoad[file.name.toLowerCase()] = file;
        }

        try {
            for (const modelFile of modelFiles) {
                const sceneObject = await this.loadModelFile(modelFile);
                if (sceneObject) {
                    result.sceneObjects.push(sceneObject);
                } else {
                    result.failures.push({fileName: modelFile.name, reason: 'unreadable'});
                }
            }

            const lastObject = result.sceneObjects.at(-1);
            if (lastObject) {
                // The new objects take on the shading and the wireframe the viewport is in.
                this.setShadingMode(this.shadingMode);
                this.setWireframeVisible(this.isWireframeVisible);
                this.frameEntries([this.getEntry(lastObject.id)]);
            }
        } finally {
            for (const name of storedNames) {
                delete FilesInputStore.FilesToLoad[name];
            }
            finishImport();
        }

        return result;
    }

    /** Hides or shows an object, whatever its shading. */
    public setObjectVisibility(objectId: string, isVisible: boolean): void {
        this.getEntry(objectId).root.setEnabled(isVisible);
    }

    /** Renames an object to a name no other object has, and returns the name it got: `model` becomes `model.001`. */
    public renameObject(objectId: string, name: string): string {
        const entry = this.getEntry(objectId);
        // The object's own name does not count as taken, so committing a name it already has changes nothing.
        const otherNames = [...this.sceneEntries.values()].filter((other) => other !== entry).map((other) => other.name);

        entry.name = createUniqueObjectName(name, otherNames);
        entry.root.name = entry.name;

        return entry.name;
    }

    /** Outlines the object in orange, and makes it the one Home frames. `null` clears the selection. */
    public selectObject(objectId: string | null): void {
        // Looked up first, so that an object this viewport does not hold changes nothing.
        const entry = objectId === null ? null : this.getEntry(objectId);

        this.selectedEntry = entry;
        this.outlineLayer.clearSelection();
        if (entry) {
            this.outlineLayer.addSelection(entry.originalMeshes);
        }
    }

    /** Tells the listener which object a click of the primary button landed on, or `null` for empty space. */
    public onObjectPicked(listener: (objectId: string | null) => void): void {
        this.pickListeners.push(listener);
    }

    /** Shows every object as grey clay (`solid`) or with its own materials (`textured`). */
    public setShadingMode(mode: TShadingMode): void {
        this.shadingMode = mode;

        for (const [mesh, originalMaterial] of this.originalMaterials) {
            mesh.material = mode === 'solid' ? this.clayMaterial : originalMaterial;
        }
    }

    /** Draws the edges of every object's mesh over it, to see where the points went. */
    public setWireframeVisible(isVisible: boolean): void {
        this.isWireframeVisible = isVisible;

        for (const entry of this.sceneEntries.values()) {
            for (const mesh of entry.originalMeshes) {
                let overlay = this.wireframeOverlays.get(mesh);
                if (!overlay && isVisible && mesh instanceof Mesh) {
                    // A clone that shares the mesh's geometry. It copies the mesh's own transform, which as its child
                    // it must not apply a second time.
                    overlay = mesh.clone(`${mesh.name}-wireframe`, mesh, true);
                    overlay.position.setAll(0);
                    overlay.rotationQuaternion = null;
                    overlay.rotation.setAll(0);
                    overlay.scaling.setAll(1);
                    overlay.material = this.wireframeMaterial;
                    overlay.isPickable = false;
                    this.wireframeOverlays.set(mesh, overlay);
                }
                overlay?.setEnabled(isVisible);
            }
        }
    }

    /**
     * Counts what an object shows: its meshes that are enabled themselves, wireframe overlays left out. The eye toggle
     * does not change it, because it hides the object's root and not its meshes.
     */
    public getObjectStats(objectId: string): IMeshStats {
        const entry = this.getEntry(objectId);

        return this.countMeshStats(entry.originalMeshes.filter((mesh) => mesh.isEnabled(false)));
    }

    /** @internal For hulma-core's own services and specs, not for the client. */
    public get scene(): Scene {
        return this.babylonScene;
    }

    /** @internal For hulma-core's own services and specs, not for the client. */
    public get camera(): ArcRotateCamera {
        return this.babylonCamera;
    }

    private createGrid(): void {
        const material = new GridMaterial('grid-material', this.babylonScene);
        material.mainColor = Color3.FromHexString(VIEWPORT_BACKGROUND_COLOR);
        material.lineColor = Color3.FromHexString(GRID_LINE_COLOR);
        material.gridRatio = 0.1;
        material.majorUnitFrequency = 10;
        material.useMultiScale = true;
        material.useHorizonFade = true;
        material.linesOnly = true;
        material.opacity = GRID_LINE_OPACITY;
        // Seen from below too, like Blender's floor.
        material.backFaceCulling = false;

        const floor = CreateGround('grid-floor', {width: GRID_SIZE, height: GRID_SIZE}, this.babylonScene);
        floor.material = material;
        floor.isPickable = false;
    }

    private createAxes(): void {
        const halfSize = GRID_SIZE / 2;
        const elevation = 0.001;

        const axisX = CreateLines(
            'axis-x',
            {points: [new Vector3(-halfSize, elevation, 0), new Vector3(halfSize, elevation, 0)]},
            this.babylonScene
        );
        axisX.color = Color3.FromHexString(AXIS_X_COLOR);
        axisX.isPickable = false;

        const axisZ = CreateLines(
            'axis-z',
            {points: [new Vector3(0, elevation, -halfSize), new Vector3(0, elevation, halfSize)]},
            this.babylonScene
        );
        axisZ.color = Color3.FromHexString(AXIS_Z_COLOR);
        axisZ.isPickable = false;
    }

    private createLighting(): void {
        // A 256 px cube with mipmaps and spherical harmonics, in linear space, prefiltered on load for image-based
        // light. There is no skybox: it only lights the scene.
        this.babylonScene.environmentTexture = new HDRCubeTexture(
            this.options.environmentTextureUrl,
            this.babylonScene,
            256,
            false,
            true,
            false,
            true
        );

        const fillLight = new HemisphericLight('fill-light', Vector3.Up(), this.babylonScene);
        fillLight.intensity = 0.4;

        const keyLight = new DirectionalLight('key-light', new Vector3(-0.5, -1, -0.4), this.babylonScene);
        keyLight.intensity = 0.8;
    }

    private createModelStyles(): void {
        this.outlineLayer = new SelectionOutlineLayer('selection-outline', this.babylonScene);
        this.outlineLayer.outlineColor = Color3.FromHexString(SELECTION_OUTLINE_COLOR);
        this.outlineLayer.outlineThickness = 2;

        // One grey clay for every object in solid mode.
        this.clayMaterial = new PBRMaterial('hulma-clay', this.babylonScene);
        this.clayMaterial.albedoColor = Color3.FromHexString(CLAY_COLOR);
        this.clayMaterial.metallic = 0;
        this.clayMaterial.roughness = 0.65;

        // Unlit, so that the lines keep their color on every side of a model. The offset pulls them toward the camera.
        this.wireframeMaterial = new StandardMaterial('hulma-wireframe', this.babylonScene);
        this.wireframeMaterial.wireframe = true;
        this.wireframeMaterial.disableLighting = true;
        this.wireframeMaterial.emissiveColor = Color3.FromHexString(WIREFRAME_COLOR);
        this.wireframeMaterial.alpha = WIREFRAME_ALPHA;
        this.wireframeMaterial.zOffset = -1;
    }

    // Resolves to null when the file holds no model: a damaged file, a missing .bin, or nothing made of triangles.
    private async loadModelFile(file: File): Promise<ISceneObject | null> {
        const container = await LoadAssetContainerAsync(file, this.babylonScene, {
            rootUrl: 'file:',
            // A splat file must not retune our camera's limits.
            pluginOptions: {splat: {disableAutoCameraLimits: true}},
        }).catch(() => null);
        if (!container) {
            return null;
        }

        // A model is made of triangles. A point cloud has none, and a Gaussian splat is drawn as splats, not as a mesh.
        const meshes = container.meshes.filter(
            (mesh) => mesh.getTotalVertices() > 0 && !mesh.getClassName().startsWith('GaussianSplatting')
        );
        const stats = this.countMeshStats(meshes);
        if (stats.triangleCount === 0) {
            container.dispose();
            return null;
        }

        container.addAllToScene();
        const name = createUniqueObjectName(
            getObjectNameFromFileName(file.name),
            [...this.sceneEntries.values()].map((entry) => entry.name)
        );
        const root = new TransformNode(name, this.babylonScene);
        for (const node of container.rootNodes) {
            node.parent = root;
        }

        // The model sits centered on x and z, with its base on the grid. The meshes' world bounds are read from fresh
        // world matrices, and are refreshed again after the move. A forced update brings the parents up to date too.
        const refreshWorldBounds = (): void => {
            for (const mesh of meshes) {
                mesh.computeWorldMatrix(true);
            }
        };
        refreshWorldBounds();
        const {min, max} = Mesh.MinMax(meshes);
        const bounds = {minimum: min, maximum: max};
        const offset = getGroundingOffset(bounds);
        root.position.set(offset.x, offset.y, offset.z);
        refreshWorldBounds();

        const id = `object-${++this.objectCounter}`;
        this.sceneEntries.set(id, {id, name, fileName: file.name, root, originalMeshes: meshes});
        for (const mesh of meshes) {
            this.originalMaterials.set(mesh, mesh.material);
        }

        // Each texture once, even where several slots or materials share it. A multi-material lists its
        // sub-materials' textures too. The original materials are the source, whatever the shading is right now.
        const textures = new Map<object, ITextureInfo>();
        for (const mesh of meshes) {
            for (const texture of this.originalMaterials.get(mesh)?.getActiveTextures() ?? []) {
                const textureKey = texture.getInternalTexture() ?? texture;
                if (!textures.has(textureKey)) {
                    const {width, height} = texture.getSize();
                    textures.set(textureKey, {name: texture.name, width, height});
                }
            }
        }

        return {
            id,
            name,
            fileName: file.name,
            dimensions: getBoundsSize(bounds),
            stats,
            textures: [...textures.values()],
        };
    }

    private countMeshStats(meshes: AbstractMesh[]): IMeshStats {
        let pointCount = 0;
        let triangleCount = 0;

        for (const mesh of meshes) {
            pointCount += countUniquePoints(mesh.getVerticesData('position') ?? []);

            const indexCount = mesh.getTotalIndices();
            if (indexCount > 0) {
                triangleCount += Math.floor(indexCount / 3);
            } else if (mesh instanceof Mesh && mesh.isUnIndexed) {
                // Without indices, only a mesh marked unindexed is drawn as triangles: three vertices to each.
                triangleCount += Math.floor(mesh.getTotalVertices() / 3);
            }
        }

        return {pointCount, triangleCount};
    }

    private getEntry(objectId: string): ISceneEntry {
        const entry = this.sceneEntries.get(objectId);
        if (!entry) {
            throw new Error(`The viewport holds no object with the id ${objectId}.`);
        }

        return entry;
    }

    private frameSelection(): void {
        // Like Blender's Home, with nothing selected it frames everything that is shown.
        const entries = this.selectedEntry
            ? [this.selectedEntry]
            : [...this.sceneEntries.values()].filter((entry) => entry.root.isEnabled());

        this.frameEntries(entries);
    }

    private frameEntries(entries: ISceneEntry[]): void {
        const meshes = entries.flatMap((entry) => entry.originalMeshes);
        if (meshes.length === 0) {
            return;
        }

        // Instant: the radius and the target are set directly, and the view direction stays as it is.
        this.babylonCamera.zoomOn(meshes, true);
        // Like a jump to a numpad view, framing must not leave momentum to carry the camera off the objects.
        this.babylonCamera.movement.resetRotationVelocity();
        this.babylonCamera.movement.resetPanVelocity();
    }

    private jumpToView(view: ICameraAngles): void {
        this.babylonCamera.alpha = view.alpha;
        this.babylonCamera.beta = view.beta;
        // Babylon keeps orbit and pan momentum in the movement system and applies it every frame, which would carry
        // the view off the axis. A pan glide is in screen space, so in the new view it would slide the pivot along a
        // different world axis. Zoom momentum only changes the distance, so it is left to finish.
        this.babylonCamera.movement.resetRotationVelocity();
        this.babylonCamera.movement.resetPanVelocity();
    }
}
