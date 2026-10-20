import type {AssetContainer} from '@babylonjs/core/assetContainer';
import type {ArcRotateCamera} from '@babylonjs/core/Cameras/arcRotateCamera';
import {PickingInfo} from '@babylonjs/core/Collisions/pickingInfo';
import * as engineModule from '@babylonjs/core/Engines/engine';
import type {IMouseEvent} from '@babylonjs/core/Events/deviceInputEvents';
import {PointerEventTypes, PointerInfo} from '@babylonjs/core/Events/pointerEvents';
import {SelectionOutlineLayer} from '@babylonjs/core/Layers/selectionOutlineLayer';
import {DirectionalLight} from '@babylonjs/core/Lights/directionalLight';
import {HemisphericLight} from '@babylonjs/core/Lights/hemisphericLight';
import {LoadAssetContainerAsync} from '@babylonjs/core/Loading/sceneLoader';
import {MultiMaterial} from '@babylonjs/core/Materials/multiMaterial';
import {PBRMaterial} from '@babylonjs/core/Materials/PBR/pbrMaterial';
import {StandardMaterial} from '@babylonjs/core/Materials/standardMaterial';
import * as hdrCubeTextureModule from '@babylonjs/core/Materials/Textures/hdrCubeTexture';
import {Texture} from '@babylonjs/core/Materials/Textures/texture';
import type {AbstractMesh} from '@babylonjs/core/Meshes/abstractMesh';
import type {LinesMesh} from '@babylonjs/core/Meshes/linesMesh';
import {Mesh} from '@babylonjs/core/Meshes/mesh';
import type {TransformNode} from '@babylonjs/core/Meshes/transformNode';
import {FilesInputStore} from '@babylonjs/core/Misc/filesInputStore';
import {GridMaterial} from '@babylonjs/materials/grid/gridMaterial';
import type {GLTFData} from '@babylonjs/serializers/glTF/2.0/glTFData';
import {GLTF2Export} from '@babylonjs/serializers/glTF/2.0/glTFSerializer';
import {IBounds} from '@core/math/interfaces/bounds.interface';
import {IVector3} from '@core/math/interfaces/vector.interface';
import {getBoundsCenter} from '@core/math/utilities/bounds.utility';
import {
    createAsciiPlyFile,
    createBigEndianPlyFile,
    createCubeGltfFile,
    createEmptyGltfFile,
    createMeshPlyFile,
    createObjFiles,
    createPointCloudPlyFile,
    createSplatPlyFile,
    createSplitGltfFiles,
    createTexturedGltfFile,
    createTransformedGltfFile,
    createTriangleGltfFile,
    createUnreadableGlbFile
} from '@core/tests/mocks/model-file.mock';
import {MODEL_EXPORT_TIMEOUT_MS, MODEL_LOAD_TIMEOUT_MS} from '@core/viewport/constants/model-file.constant';
import {AXIS_X_COLOR, AXIS_Z_COLOR, BLENDER_NAVIGATION_INPUT_MAP} from '@core/viewport/constants/viewport.constant';
import {ISceneObject} from '@core/viewport/interfaces/scene-object.interface';
import {Viewport} from '@core/viewport/services/viewport.service';

// The loader passes straight through to Babylon, unless a spec swaps in a container of its own.
vi.mock('@babylonjs/core/Loading/sceneLoader', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@babylonjs/core/Loading/sceneLoader')>();
    return {...actual, LoadAssetContainerAsync: vi.fn(actual.LoadAssetContainerAsync)};
});

describe('Viewport', () => {
    const startedViewports: Viewport[] = [];

    function createCanvas(): HTMLCanvasElement {
        return document.body.appendChild(document.createElement('canvas'));
    }

    async function startViewport(canvas = createCanvas()): Promise<{canvas: HTMLCanvasElement; viewport: Viewport}> {
        const viewport = new Viewport(canvas, {environmentTextureUrl: 'studio.hdr'});
        await viewport.start();
        startedViewports.push(viewport);

        return {canvas, viewport};
    }

    function stubResizeObserver() {
        const observedElements: Element[] = [];
        const disconnect = vi.fn();
        let notify = (): void => undefined;
        vi.stubGlobal(
            'ResizeObserver',
            class {
                public disconnect = disconnect;

                constructor(callback: () => void) {
                    notify = callback;
                }

                public observe(element: Element): void {
                    observedElements.push(element);
                }
            }
        );

        return {observedElements, disconnect, notify: () => notify()};
    }

    function pressKey(target: EventTarget, code: string, modifiers: KeyboardEventInit = {}): KeyboardEvent {
        const event = new KeyboardEvent('keydown', {...modifiers, code, bubbles: true, cancelable: true});
        target.dispatchEvent(event);

        return event;
    }

    function movePointer(canvas: HTMLCanvasElement, type: 'pointerenter' | 'pointerleave'): void {
        canvas.dispatchEvent(new PointerEvent(type));
    }

    function getExtents(viewport: Viewport, meshName: string): {minimum: number[]; maximum: number[]} | undefined {
        const box = viewport.scene.getMeshByName(meshName)?.getBoundingInfo().boundingBox;

        return box && {minimum: box.minimum.asArray(), maximum: box.maximum.asArray()};
    }

    // Takes the frames over from the render loop and pins them to 60 Hz, so momentum decays the way it does on screen.
    function pinFrameRate(viewport: Viewport): void {
        const engine = viewport.scene.getEngine();
        engine.stopRenderLoop();
        vi.spyOn(engine, 'getDeltaTime').mockReturnValue(1000 / 60);
    }

    function renderFrames(viewport: Viewport, count: number): void {
        for (let frame = 0; frame < count; frame++) {
            viewport.scene.render();
        }
    }

    function expectViewDirection(camera: ArcRotateCamera, expected: IVector3): void {
        // The camera position refreshes with its view matrix, which the render loop normally computes.
        camera.getViewMatrix();
        const direction = camera.position.subtract(camera.target).normalize();

        expect(Math.abs(direction.x - expected.x)).toBeLessThanOrEqual(0.01);
        expect(Math.abs(direction.y - expected.y)).toBeLessThanOrEqual(0.01);
        expect(Math.abs(direction.z - expected.z)).toBeLessThanOrEqual(0.01);
    }

    function expectPointCloseTo(actual: IVector3, expected: IVector3): void {
        expect(actual.x).toBeCloseTo(expected.x, 4);
        expect(actual.y).toBeCloseTo(expected.y, 4);
        expect(actual.z).toBeCloseTo(expected.z, 4);
    }

    async function importObjects(viewport: Viewport, files: File[]): Promise<ISceneObject[]> {
        const {sceneObjects, failures} = await viewport.importFiles(files);

        expect(failures).toEqual([]);

        return sceneObjects;
    }

    function getRoot(viewport: Viewport, name: string): TransformNode {
        const root = viewport.scene.getTransformNodeByName(name);
        if (!root) {
            throw new Error(`The scene has no object named ${name}.`);
        }

        return root;
    }

    // The meshes of an object that hold its model, not the wireframe overlays that sit on them.
    function getModelMeshes(viewport: Viewport, name: string): AbstractMesh[] {
        return getRoot(viewport, name)
            .getChildMeshes()
            .filter((mesh) => mesh.getTotalVertices() > 0 && !mesh.name.endsWith('-wireframe'));
    }

    function getOverlays(mesh: AbstractMesh): AbstractMesh[] {
        return mesh.getChildMeshes(true).filter((child) => child.name === `${mesh.name}-wireframe`);
    }

    function getWorldBounds(meshes: AbstractMesh[]): IBounds {
        for (const mesh of meshes) {
            mesh.computeWorldMatrix(true);
        }
        const {min, max} = Mesh.MinMax(meshes);

        return {minimum: min, maximum: max};
    }

    function getSelectionOutlineLayer(viewport: Viewport): SelectionOutlineLayer {
        const layer = viewport.scene.effectLayers.find((candidate) => candidate instanceof SelectionOutlineLayer);
        if (!layer) {
            throw new Error('The scene has no selection outline layer.');
        }

        return layer as SelectionOutlineLayer;
    }

    // A pointer tap as Babylon's input manager reports it, with the mesh its pick found, if any.
    function tap(viewport: Viewport, pickedMesh: AbstractMesh | null, button = 0): void {
        const pickInfo = new PickingInfo();
        pickInfo.hit = pickedMesh !== null;
        pickInfo.pickedMesh = pickedMesh;
        const pointerInfo = new PointerInfo(PointerEventTypes.POINTERTAP, {button} as IMouseEvent, pickInfo);

        viewport.scene.onPointerObservable.notifyObservers(pointerInfo, PointerEventTypes.POINTERTAP);
    }

    // What an export changes of an object and has to give back: its eye, its materials and its wireframe overlays.
    function describeObjectDisplay(viewport: Viewport, name: string) {
        const meshes = getModelMeshes(viewport, name);

        return {
            isRootEnabled: getRoot(viewport, name).isEnabled(false),
            materials: meshes.map((mesh) => mesh.material?.name),
            overlays: meshes.flatMap((mesh) => getOverlays(mesh).map((overlay) => overlay.isEnabled(false))),
        };
    }

    // The JSON of a GLB is its first chunk: after the 12 byte header come the chunk's length and type, then its bytes.
    async function readGlbJson(
        glb: Blob
    ): Promise<{materials: {name: string}[]; meshes?: unknown[]; nodes: {name?: string}[]}> {
        const bytes = new Uint8Array(await glb.arrayBuffer());
        const chunkLength = new DataView(bytes.buffer).getUint32(12, true);

        return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + chunkLength)));
    }

    // A GLB read back the way a user would: dropped as a file onto a viewport of its own.
    async function importGlb(glb: Blob): Promise<ISceneObject[]> {
        const {viewport} = await startViewport();

        return importObjects(viewport, [new File([glb], 'exported.glb')]);
    }

    // A selected cube that is hidden, in solid mode and with the wireframe on: everything an export has to undo.
    async function importCubeWithDisplayOptions() {
        const {viewport} = await startViewport();
        const [cube] = await importObjects(viewport, [createCubeGltfFile()]);
        const [originalMaterial] = describeObjectDisplay(viewport, cube.name).materials;
        viewport.setShadingMode('solid');
        viewport.setWireframeVisible(true);
        viewport.setObjectVisibility(cube.id, false);
        viewport.selectObject(cube.id);

        return {viewport, cube, originalMaterial};
    }

    // Everything an import adds to the scene, by name, to see that a failed one left nothing behind.
    function describeScene(viewport: Viewport): Record<string, string[]> {
        const {scene} = viewport;
        const names = (items: {name: string}[]): string[] => items.map((item) => item.name).sort();

        return {
            meshes: names(scene.meshes),
            transformNodes: names(scene.transformNodes),
            materials: names(scene.materials),
            textures: names(scene.textures),
            geometries: scene.geometries.map((geometry) => geometry.id).sort(),
        };
    }

    // Babylon's own loader, for a spec that hands the viewport a container it has changed or held back.
    async function importActualLoader(): Promise<typeof LoadAssetContainerAsync> {
        const sceneLoader = await vi.importActual<typeof import('@babylonjs/core/Loading/sceneLoader')>(
            '@babylonjs/core/Loading/sceneLoader'
        );

        return sceneLoader.LoadAssetContainerAsync;
    }

    // The network is a boundary: a request for a file the drop does not hold fails the way a missing file does.
    function stubFailingRequests(): string[] {
        const requestedUrls: string[] = [];
        vi.stubGlobal(
            'XMLHttpRequest',
            class {
                public readyState = 0;
                public status = 0;
                public statusText = '';
                public response = null;
                public responseText = '';
                public responseURL = '';
                public responseType = '';
                private readonly listeners: Record<string, (() => void)[]> = {};

                public open(method: string, url: string): void {
                    requestedUrls.push(url);
                }

                public addEventListener(type: string, listener: () => void): void {
                    this.listeners[type] = [...(this.listeners[type] ?? []), listener];
                }

                public removeEventListener(type: string, listener: () => void): void {
                    this.listeners[type] = (this.listeners[type] ?? []).filter((other) => other !== listener);
                }

                public send(): void {
                    setTimeout(() => {
                        this.readyState = 4;
                        this.status = 404;
                        for (const type of ['readystatechange', 'loadend']) {
                            this.listeners[type]?.forEach((listener) => listener());
                        }
                    });
                }

                public setRequestHeader(): void {}

                public getResponseHeader(): null {
                    return null;
                }

                public abort(): void {}
            }
        );

        return requestedUrls;
    }

    // A Gaussian splat sorts its splats on a Web Worker, which is a boundary.
    function stubWorker(): void {
        vi.stubGlobal(
            'Worker',
            class {
                public postMessage(): void {}

                public terminate(): void {}

                public addEventListener(): void {}

                public removeEventListener(): void {}
            }
        );
    }

    afterEach(() => {
        for (const viewport of startedViewports.splice(0)) {
            viewport.dispose();
        }
        vi.useRealTimers();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        vi.mocked(LoadAssetContainerAsync).mockReset();
        document.body.replaceChildren();
    });

    it('creates the engine at the device pixel ratio, capped at 2, with a stencil buffer and tab index 0', async () => {
        const createEngine = vi.spyOn(engineModule, 'Engine');
        const {canvas} = await startViewport();

        expect(createEngine).toHaveBeenCalledWith(
            canvas,
            true,
            {preserveDrawingBuffer: false, stencil: true, limitDeviceRatio: 2, canvasTabIndex: 0},
            true
        );
    });

    it('creates a right-handed scene on the Blender background', async () => {
        const {viewport} = await startViewport();

        expect(viewport.scene.useRightHandedSystem).toBe(true);
        expect(viewport.scene.clearColor.toHexString()).toBe('#3D3D3DFF');
    });

    it('lays a multi-scale grid floor with Blender axes', async () => {
        const {viewport} = await startViewport();
        const {scene} = viewport;

        const grid = scene.getMeshByName('grid-floor')?.material as GridMaterial | undefined;
        expect(grid).toBeInstanceOf(GridMaterial);
        expect(grid?.useMultiScale).toBe(true);
        expect(grid?.useHorizonFade).toBe(true);
        expect(grid?.linesOnly).toBe(true);
        expect(grid?.backFaceCulling).toBe(false);
        expect(grid?.opacity).toBe(0.5);
        expect(grid?.lineColor.toHexString()).toBe('#545454');
        expect(grid?.mainColor.toHexString()).toBe('#3D3D3D');
        expect(grid?.gridRatio).toBe(0.1);
        expect(grid?.majorUnitFrequency).toBe(10);

        const axisX = scene.getMeshByName('axis-x') as LinesMesh | null;
        const axisZ = scene.getMeshByName('axis-z') as LinesMesh | null;
        expect(axisX?.color.toHexString()).toBe(AXIS_X_COLOR);
        expect(axisZ?.color.toHexString()).toBe(AXIS_Z_COLOR);
    });

    it('sizes the floor and both axes at 200 units, with the axes just above the floor', async () => {
        const {viewport} = await startViewport();

        expect(getExtents(viewport, 'grid-floor')).toEqual({minimum: [-100, 0, -100], maximum: [100, 0, 100]});
        expect(getExtents(viewport, 'axis-x')).toEqual({minimum: [-100, 0.001, 0], maximum: [100, 0.001, 0]});
        expect(getExtents(viewport, 'axis-z')).toEqual({minimum: [0, 0.001, -100], maximum: [0, 0.001, 100]});
    });

    it('lights the scene with the studio environment', async () => {
        const createTexture = vi.spyOn(hdrCubeTextureModule, 'HDRCubeTexture');
        const {viewport} = await startViewport();

        expect((viewport.scene.environmentTexture as hdrCubeTextureModule.HDRCubeTexture).url).toBe('studio.hdr');
        expect(createTexture).toHaveBeenCalledWith('studio.hdr', viewport.scene, 256, false, true, false, true);
        expect(viewport.scene.environmentIntensity).toBe(0.35);
    });

    it('adds a hemispheric fill light and a directional key light', async () => {
        const {viewport} = await startViewport();
        const {lights} = viewport.scene;

        const fillLight = lights.find((light) => light instanceof HemisphericLight);
        const keyLight = lights.find((light) => light instanceof DirectionalLight) as DirectionalLight | undefined;
        expect(fillLight?.intensity).toBe(0.1);
        expect(keyLight?.intensity).toBe(1.3);
    });

    it('hangs the key light from the camera, so it shines from the upper left of every view', async () => {
        const {viewport} = await startViewport();
        const keyLight = viewport.scene.getLightByName('key-light') as DirectionalLight;

        expect(keyLight.parent).toBe(viewport.camera);
        // From the front, the view's right is +X and it looks along -Z.
        viewport.camera.alpha = Math.PI / 2;
        viewport.camera.beta = Math.PI / 2;
        keyLight.computeTransformedInformation();
        expectPointCloseTo(keyLight.transformedDirection, {x: 0.5, y: -0.5, z: -0.707107});
        // From the right, the view's right is -Z and it looks along -X.
        viewport.camera.alpha = 0;
        keyLight.computeTransformedInformation();
        expectPointCloseTo(keyLight.transformedDirection, {x: -0.707107, y: -0.5, z: -0.5});
    });

    it('orbits the origin from three units away with Blender zoom and clip settings', async () => {
        const {viewport} = await startViewport();
        const {camera} = viewport;

        expect(camera.target.asArray()).toEqual([0, 0, 0]);
        expect(camera.radius).toBe(3);
        expect(camera.lowerRadiusLimit).toBe(0.01);
        expect(camera.minZ).toBe(0.01);
        expect(camera.wheelDeltaPercentage).toBe(0.01);
    });

    it('navigates like Blender', async () => {
        const {viewport} = await startViewport();
        const {input} = viewport.camera.movement;

        expect(input.inputMap).toEqual(BLENDER_NAVIGATION_INPUT_MAP);
        expect(input.resolveInteraction('pointer', {button: 1})?.interaction).toBe('rotate');
        expect(input.resolveInteraction('pointer', {button: 1, modifiers: {shift: true}})?.interaction).toBe('pan');
        expect(input.resolveInteraction('pointer', {button: 0})?.interaction).toBe('rotate');
        expect(input.resolveInteraction('wheel')?.interaction).toBe('zoom');
        expect(input.resolveInteraction('pointer', {button: 2})).toBeNull();
    });

    it('gives every viewport its own copy of the navigation map', async () => {
        const first = await startViewport();
        const second = await startViewport();

        first.viewport.camera.movement.input.inputMap[0].interaction = 'zoom';

        expect(second.viewport.camera.movement.input.inputMap).toEqual(BLENDER_NAVIGATION_INPUT_MAP);
        expect(BLENDER_NAVIGATION_INPUT_MAP[0].interaction).toBe('pan');
    });

    it('jumps to front, right and top views from the numpad', async () => {
        const {canvas, viewport} = await startViewport();

        pressKey(canvas, 'Numpad1');
        expectViewDirection(viewport.camera, {x: 0, y: 0, z: 1});

        pressKey(canvas, 'Numpad3');
        expectViewDirection(viewport.camera, {x: 1, y: 0, z: 0});

        pressKey(canvas, 'Numpad7');
        expectViewDirection(viewport.camera, {x: 0, y: 1, z: 0});
    });

    it('jumps to back, left and bottom views with Ctrl', async () => {
        const {canvas, viewport} = await startViewport();

        pressKey(canvas, 'Numpad1', {ctrlKey: true});
        expectViewDirection(viewport.camera, {x: 0, y: 0, z: -1});

        pressKey(canvas, 'Numpad3', {ctrlKey: true});
        expectViewDirection(viewport.camera, {x: -1, y: 0, z: 0});

        pressKey(canvas, 'Numpad7', {ctrlKey: true});
        expectViewDirection(viewport.camera, {x: 0, y: -1, z: 0});
    });

    it('jumps to a numpad view pressed anywhere while the pointer is over the canvas', async () => {
        const {canvas, viewport} = await startViewport();

        movePointer(canvas, 'pointerenter');
        const event = pressKey(document.body, 'Numpad3');

        expectViewDirection(viewport.camera, {x: 1, y: 0, z: 0});
        expect(event.defaultPrevented).toBe(true);
    });

    it('ignores numpad keys pressed elsewhere while the pointer is outside the canvas', async () => {
        const {canvas, viewport} = await startViewport();
        const {alpha, beta} = viewport.camera;

        const events = [pressKey(document.body, 'Numpad3')];
        movePointer(canvas, 'pointerenter');
        movePointer(canvas, 'pointerleave');
        events.push(pressKey(document.body, 'Numpad3'));

        expect(viewport.camera.alpha).toBe(alpha);
        expect(viewport.camera.beta).toBe(beta);
        expect(events.map((event) => event.defaultPrevented)).toEqual([false, false]);
    });

    it('ignores numpad keys typed into a field, even while the pointer is over the canvas', async () => {
        const {canvas, viewport} = await startViewport();
        const {alpha, beta} = viewport.camera;
        const editableFields = [
            document.createElement('input'),
            document.createElement('textarea'),
            document.createElement('select'),
            Object.assign(document.createElement('div'), {contentEditable: 'true'}),
        ];
        document.body.append(...editableFields);
        movePointer(canvas, 'pointerenter');

        const events = editableFields.map((field) => pressKey(field, 'Numpad3'));

        expect(viewport.camera.alpha).toBe(alpha);
        expect(viewport.camera.beta).toBe(beta);
        expect(events.map((event) => event.defaultPrevented)).toEqual([false, false, false, false]);
    });

    it('cancels the numpad keys it handles, so the browser does not scroll or switch tabs', async () => {
        const {canvas} = await startViewport();

        expect(pressKey(canvas, 'Numpad1').defaultPrevented).toBe(true);
        expect(pressKey(canvas, 'Numpad1', {ctrlKey: true}).defaultPrevented).toBe(true);
        expect(pressKey(canvas, 'Numpad2').defaultPrevented).toBe(false);
        expect(pressKey(canvas, 'KeyA').defaultPrevented).toBe(false);
    });

    it('ignores numpad keys pressed with Alt, Shift or Meta', async () => {
        const {canvas, viewport} = await startViewport();
        const {alpha, beta} = viewport.camera;

        for (const modifiers of [{altKey: true}, {shiftKey: true}, {metaKey: true}, {ctrlKey: true, shiftKey: true}]) {
            expect(pressKey(canvas, 'Numpad1', modifiers).defaultPrevented, JSON.stringify(modifiers)).toBe(false);
        }

        expect(viewport.camera.alpha).toBe(alpha);
        expect(viewport.camera.beta).toBe(beta);
    });

    it('lands exactly on a numpad view even while the camera coasts from an orbit', async () => {
        const {canvas, viewport} = await startViewport();
        pinFrameRate(viewport);
        // Accumulated-pixel fields hold already-scaled per-frame values: 6 frames build the coast, 60 test the jump.
        viewport.camera.movement.rotationAccumulatedPixels.set(-0.06, -0.03, 0);
        renderFrames(viewport, 6);

        pressKey(canvas, 'Numpad1');
        renderFrames(viewport, 60);

        expectViewDirection(viewport.camera, {x: 0, y: 0, z: 1});
    });

    it('stops the pivot gliding when it jumps to a numpad view', async () => {
        const {canvas, viewport} = await startViewport();
        pinFrameRate(viewport);
        // Already-scaled per-frame values again: 6 frames build the glide, 60 test that the jump stopped it.
        viewport.camera.movement.panAccumulatedPixels.set(-0.04, 0.02, 0);
        renderFrames(viewport, 6);

        pressKey(canvas, 'Numpad1');
        const pivot = viewport.camera.target.clone();
        renderFrames(viewport, 60);

        expect(viewport.camera.target.subtract(pivot).length()).toBeLessThan(1e-6);
    });

    it('renders frames until it is disposed', async () => {
        const {viewport} = await startViewport();
        const {scene} = viewport;

        await vi.waitFor(() => expect(scene.getFrameId()).toBeGreaterThan(0));

        viewport.dispose();
        const frameId = scene.getFrameId();
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(scene.getFrameId()).toBe(frameId);
    });

    it('resizes the engine with the canvas until it is disposed', async () => {
        const resizeObserver = stubResizeObserver();
        const {canvas, viewport} = await startViewport();
        const resize = vi.spyOn(viewport.scene.getEngine(), 'resize');

        resizeObserver.notify();

        expect(resizeObserver.observedElements).toEqual([canvas]);
        expect(resize).toHaveBeenCalledTimes(1);

        viewport.dispose();

        expect(resizeObserver.disconnect).toHaveBeenCalledTimes(1);
    });

    it('removes every listener it added when it is disposed', async () => {
        const canvas = createCanvas();
        const addToCanvas = vi.spyOn(canvas, 'addEventListener');
        const removeFromCanvas = vi.spyOn(canvas, 'removeEventListener');
        const addToDocument = vi.spyOn(document, 'addEventListener');
        const removeFromDocument = vi.spyOn(document, 'removeEventListener');
        const {viewport} = await startViewport(canvas);

        viewport.dispose();

        expect(addToCanvas).toHaveBeenCalled();
        expect(addToDocument).toHaveBeenCalled();
        for (const [type, listener] of addToCanvas.mock.calls) {
            expect(removeFromCanvas).toHaveBeenCalledWith(type, listener);
        }
        for (const [type, listener] of addToDocument.mock.calls) {
            expect(removeFromDocument).toHaveBeenCalledWith(type, listener);
        }
    });

    it('disposes safely when it was never started', () => {
        const viewport = new Viewport(createCanvas(), {environmentTextureUrl: 'studio.hdr'});

        expect(() => viewport.dispose()).not.toThrow();
    });

    it('disposes what a failed start left behind', async () => {
        vi.spyOn(hdrCubeTextureModule, 'HDRCubeTexture').mockImplementationOnce(function () {
            throw new Error('texture failed');
        });
        const viewport = new Viewport(createCanvas(), {environmentTextureUrl: 'studio.hdr'});

        await expect(viewport.start()).rejects.toThrow('texture failed');
        expect(() => viewport.dispose()).not.toThrow();

        expect(viewport.scene.isDisposed).toBe(true);
    });

    it('releases the engine and keyboard on dispose', async () => {
        const {canvas, viewport} = await startViewport();
        const {alpha, beta} = viewport.camera;

        viewport.dispose();

        expect(viewport.scene.isDisposed).toBe(true);
        expect(() => pressKey(canvas, 'Numpad1')).not.toThrow();
        expect(viewport.camera.alpha).toBe(alpha);
        expect(viewport.camera.beta).toBe(beta);
    });

    it('imports a .gltf file as one object', async () => {
        const {viewport} = await startViewport();

        const result = await viewport.importFiles([createTriangleGltfFile()]);

        expect(result.failures).toEqual([]);
        expect(result.sceneObjects).toHaveLength(1);
        expect(result.sceneObjects[0]).toMatchObject({
            id: 'object-1',
            name: 'triangle',
            fileName: 'triangle.gltf',
            stats: {pointCount: 3, triangleCount: 1},
            textures: [],
        });
        const [mesh] = getModelMeshes(viewport, 'triangle') as Mesh[];
        expect(mesh.getTotalIndices()).toBe(0);
        expect(mesh.isUnIndexed).toBe(true);
    });

    it('imports a .gltf with its separate .bin', async () => {
        const {viewport} = await startViewport();

        const result = await viewport.importFiles(createSplitGltfFiles());

        expect(result.failures).toEqual([]);
        expect(result.sceneObjects.map((sceneObject) => sceneObject.name)).toEqual(['pair']);
    });

    it('loads each model file from the dropped files, with options for splat and OBJ files', async () => {
        const {viewport} = await startViewport();
        const file = createTriangleGltfFile();

        await importObjects(viewport, [file]);

        // A splat header must not retune the camera, and an .obj must have its textures loaded before it is read.
        expect(LoadAssetContainerAsync).toHaveBeenCalledWith(file, viewport.scene, {
            rootUrl: 'file:',
            pluginOptions: {splat: {disableAutoCameraLimits: true}, obj: {waitForTextures: true}},
        });
    });

    it('finds a resource file by its lowercase name', async () => {
        const {viewport} = await startViewport();

        const result = await viewport.importFiles(createSplitGltfFiles('Pair'));

        expect(result.failures).toEqual([]);
        expect(result.sceneObjects.map((sceneObject) => sceneObject.name)).toEqual(['Pair']);
    });

    it('reports a .gltf whose .bin is missing as unreadable', async () => {
        const requestedUrls = stubFailingRequests();
        const {viewport} = await startViewport();
        const before = describeScene(viewport);
        const [gltf] = createSplitGltfFiles();

        const result = await viewport.importFiles([gltf]);

        expect(result).toEqual({sceneObjects: [], failures: [{fileName: 'pair.gltf', reason: 'unreadable'}]});
        expect(requestedUrls).toEqual([expect.stringContaining('pair.bin')]);
        expect(describeScene(viewport)).toEqual(before);
    });

    it('removes the dropped files from the store afterwards', async () => {
        const {viewport} = await startViewport();

        await viewport.importFiles(createSplitGltfFiles());
        await viewport.importFiles([createUnreadableGlbFile(), createTriangleGltfFile()]);

        expect(Object.keys(FilesInputStore.FilesToLoad)).toEqual([]);
    });

    it('places the object on the grid at the center', async () => {
        const {viewport} = await startViewport();

        const [cube, triangle] = await importObjects(viewport, [createCubeGltfFile(), createTriangleGltfFile()]);

        for (const sceneObject of [cube, triangle]) {
            const bounds = getWorldBounds(getModelMeshes(viewport, sceneObject.name));
            const center = getBoundsCenter(bounds);
            expect(Math.abs(center.x), sceneObject.name).toBeLessThan(1e-6);
            expect(Math.abs(center.z), sceneObject.name).toBeLessThan(1e-6);
            expect(Math.abs(bounds.minimum.y), sceneObject.name).toBeLessThan(1e-6);
        }
        expect(cube.dimensions).toEqual({x: 1, y: 1, z: 1});
        expect(triangle.dimensions.x).toBeCloseTo(1, 6);
        expect(triangle.dimensions.y).toBeCloseTo(1, 6);
        expect(triangle.dimensions.z).toBeCloseTo(0, 6);
    });

    it('places an object whose nodes are moved and scaled on the grid too', async () => {
        const {viewport} = await startViewport();

        const [transformed] = await importObjects(viewport, [createTransformedGltfFile()]);

        const bounds = getWorldBounds(getModelMeshes(viewport, transformed.name));
        const center = getBoundsCenter(bounds);
        expect(Math.abs(center.x)).toBeLessThan(1e-6);
        expect(Math.abs(center.z)).toBeLessThan(1e-6);
        expect(Math.abs(bounds.minimum.y)).toBeLessThan(1e-6);
        expect(transformed.dimensions.x).toBeCloseTo(2, 6);
        expect(transformed.dimensions.y).toBeCloseTo(2, 6);
        expect(transformed.dimensions.z).toBeCloseTo(0, 6);
        expectPointCloseTo(viewport.camera.target, center);
    });

    it('names duplicates like Blender', async () => {
        const {viewport} = await startViewport();

        const first = await importObjects(viewport, [createTriangleGltfFile()]);
        const second = await importObjects(viewport, [createTriangleGltfFile()]);

        expect([...first, ...second].map((sceneObject) => sceneObject.name)).toEqual(['triangle', 'triangle.001']);
        expect([...first, ...second].map((sceneObject) => sceneObject.id)).toEqual(['object-1', 'object-2']);
        expect(getRoot(viewport, 'triangle.001')).toBeDefined();
    });

    it('reports unsupported files without failing the rest', async () => {
        const {viewport} = await startViewport();

        const result = await viewport.importFiles([createTriangleGltfFile(), new File([], 'scene.usdz')]);

        expect(result.sceneObjects).toHaveLength(1);
        expect(result.failures).toEqual([{fileName: 'scene.usdz', reason: 'unsupported-format'}]);
    });

    it('reports unreadable files', async () => {
        const {viewport} = await startViewport();

        const result = await viewport.importFiles([createUnreadableGlbFile()]);

        expect(result).toEqual({sceneObjects: [], failures: [{fileName: 'broken.glb', reason: 'unreadable'}]});
    });

    it('ignores resource files that no model comes with', async () => {
        const {viewport} = await startViewport();

        const result = await viewport.importFiles([new File([], 'albedo.png'), new File([], 'model.bin')]);

        expect(result).toEqual({sceneObjects: [], failures: []});
    });

    it('does not use up an object id on a file it cannot read', async () => {
        const {viewport} = await startViewport();

        const result = await viewport.importFiles([createUnreadableGlbFile(), createTriangleGltfFile()]);

        expect(result.sceneObjects.map((sceneObject) => sceneObject.id)).toEqual(['object-1']);
    });

    it('reports a .ply without faces as unreadable', async () => {
        const {viewport} = await startViewport();

        const result = await viewport.importFiles([createPointCloudPlyFile()]);

        expect(result).toEqual({sceneObjects: [], failures: [{fileName: 'points.ply', reason: 'unreadable'}]});
        expect(viewport.scene.meshes.map((mesh) => mesh.name).sort()).toEqual(['axis-x', 'axis-z', 'grid-floor']);
        expect(viewport.scene.materials.map((material) => material.name)).not.toContain('point cloud material');
    });

    it('reports a Gaussian splat .ply as unreadable', async () => {
        stubWorker();
        const {viewport} = await startViewport();

        const result = await viewport.importFiles([createSplatPlyFile()]);

        expect(result).toEqual({sceneObjects: [], failures: [{fileName: 'splat.ply', reason: 'unreadable'}]});
        expect(viewport.scene.meshes.map((mesh) => mesh.name).sort()).toEqual(['axis-x', 'axis-z', 'grid-floor']);
    });

    it('imports a binary little-endian .ply with a face as a mesh', async () => {
        const {viewport} = await startViewport();

        const [mesh] = await importObjects(viewport, [createMeshPlyFile()]);

        expect(mesh).toMatchObject({name: 'mesh', fileName: 'mesh.ply', stats: {pointCount: 3, triangleCount: 1}});
    });

    it('reports a .ply that is not little-endian binary as unreadable without loading it', async () => {
        const {viewport} = await startViewport();
        const before = describeScene(viewport);
        const unformatted = new File(['ply\nelement vertex 0\nend_header\n'], 'unformatted.ply');
        const files = [createAsciiPlyFile(), createBigEndianPlyFile(), unformatted, new File([], 'empty.ply')];

        const result = await viewport.importFiles(files);

        const failures = files.map((file) => ({fileName: file.name, reason: 'unreadable'}));
        expect(result).toEqual({sceneObjects: [], failures});
        expect(LoadAssetContainerAsync).not.toHaveBeenCalled();
        expect(describeScene(viewport)).toEqual(before);
    });

    it('reports a .ply it cannot read from disk as unreadable, and keeps the rest of the drop', async () => {
        const {viewport} = await startViewport();
        const unreadable = createMeshPlyFile('gone.ply');
        vi.spyOn(unreadable, 'slice').mockReturnValue({
            text: () => Promise.reject(new Error('The file is gone.')),
        } as unknown as Blob);

        const result = await viewport.importFiles([createTriangleGltfFile(), unreadable]);

        expect(result.failures).toEqual([{fileName: 'gone.ply', reason: 'unreadable'}]);
        expect(result.sceneObjects.map((sceneObject) => sceneObject.name)).toEqual(['triangle']);
        expect(LoadAssetContainerAsync).toHaveBeenCalledTimes(1);
    });

    it('gives up on a load that never settles, and the next import still runs', async () => {
        const {viewport} = await startViewport();
        viewport.scene.getEngine().stopRenderLoop();
        vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']});
        vi.mocked(LoadAssetContainerAsync).mockImplementationOnce(() => new Promise<never>(() => undefined));
        const settled = vi.fn();
        const stuckImport = viewport.importFiles([createTriangleGltfFile('stuck.gltf')]).then(settled);

        await vi.advanceTimersByTimeAsync(MODEL_LOAD_TIMEOUT_MS - 1);
        expect(settled).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        await stuckImport;

        const failures = [{fileName: 'stuck.gltf', reason: 'unreadable'}];
        expect(settled).toHaveBeenCalledWith({sceneObjects: [], failures});
        vi.useRealTimers();
        const next = await viewport.importFiles([createTriangleGltfFile()]);
        expect(next.failures).toEqual([]);
        expect(next.sceneObjects.map((sceneObject) => sceneObject.name)).toEqual(['triangle']);
    });

    it('throws away what a load it gave up on brings when it finishes late', async () => {
        const {viewport} = await startViewport();
        viewport.scene.getEngine().stopRenderLoop();
        const loadContainer = await importActualLoader();
        const lateContainer = await loadContainer(createCubeGltfFile(), viewport.scene, {rootUrl: 'file:'});
        const before = describeScene(viewport);
        let finishLoad: (container: AssetContainer) => void = () => undefined;
        vi.mocked(LoadAssetContainerAsync).mockImplementationOnce(
            () => new Promise<AssetContainer>((resolve) => (finishLoad = resolve))
        );
        vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']});
        const stuckImport = viewport.importFiles([createCubeGltfFile()]);
        await vi.advanceTimersByTimeAsync(MODEL_LOAD_TIMEOUT_MS);
        await stuckImport;
        vi.useRealTimers();

        finishLoad(lateContainer);

        await vi.waitFor(() => expect(lateContainer.meshes.every((mesh) => mesh.isDisposed())).toBe(true));
        expect(describeScene(viewport)).toEqual(before);
    });

    it('clears the timer of a load once it has settled', async () => {
        const {viewport} = await startViewport();
        viewport.scene.getEngine().stopRenderLoop();
        const loadContainer = await importActualLoader();
        const container = await loadContainer(createCubeGltfFile(), viewport.scene, {rootUrl: 'file:'});
        vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']});
        vi.mocked(LoadAssetContainerAsync).mockResolvedValueOnce(container);

        const result = await viewport.importFiles([createCubeGltfFile()]);

        expect(result.sceneObjects).toHaveLength(1);
        // Babylon's own zero-delay timers run first, so that only a timer with a delay left over would count.
        await vi.advanceTimersByTimeAsync(0);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('drops only the file that fails after it loaded, and keeps the rest of the drop', async () => {
        const {viewport} = await startViewport();
        const loadContainer = await importActualLoader();
        let failedContainer: AssetContainer | undefined;
        vi.mocked(LoadAssetContainerAsync).mockImplementationOnce(async (source, scene, options) => {
            failedContainer = await loadContainer(source, scene, options);
            for (const mesh of failedContainer.meshes) {
                mesh.getBoundingInfo = () => {
                    throw new Error('no bounds');
                };
            }

            return failedContainer;
        });

        const result = await viewport.importFiles([createCubeGltfFile(), createTriangleGltfFile()]);

        expect(result.failures).toEqual([{fileName: 'cube.gltf', reason: 'unreadable'}]);
        expect(result.sceneObjects.map((sceneObject) => [sceneObject.id, sceneObject.name])).toEqual([
            ['object-1', 'triangle'],
        ]);
        expect(failedContainer?.meshes.every((mesh) => mesh.isDisposed())).toBe(true);
        expect(viewport.scene.getTransformNodeByName('cube')).toBeNull();
        expect(viewport.scene.meshes.filter((mesh) => failedContainer?.meshes.includes(mesh))).toEqual([]);
        const sceneMaterials = viewport.scene.materials;
        expect(sceneMaterials.filter((material) => failedContainer?.materials.includes(material))).toEqual([]);
        expect(viewport.scene.transformNodes.map((node) => node.name)).toEqual(['triangle']);
    });

    it('does not block the next import when it is handed something that is no drop', async () => {
        const {viewport} = await startViewport();

        await expect(viewport.importFiles(undefined as unknown as File[])).rejects.toThrow();
        const next = await viewport.importFiles([createTriangleGltfFile()]);

        expect(next.sceneObjects).toHaveLength(1);
    });

    it('styles each object right after it loads, before the next file of the drop is read', async () => {
        const {viewport} = await startViewport();
        viewport.setShadingMode('solid');
        viewport.setWireframeVisible(true);
        const loadContainer = await importActualLoader();
        let firstObject: {material: string | undefined; overlays: number} | undefined;
        vi.mocked(LoadAssetContainerAsync).mockImplementationOnce((source, scene, options) =>
            loadContainer(source, scene, options)
        );
        vi.mocked(LoadAssetContainerAsync).mockImplementationOnce(async (source, scene, options) => {
            const [mesh] = getModelMeshes(viewport, 'a');
            firstObject = {material: mesh.material?.name, overlays: getOverlays(mesh).length};

            return loadContainer(source, scene, options);
        });

        await importObjects(viewport, [createTriangleGltfFile('a.gltf'), createTriangleGltfFile('b.gltf')]);

        expect(firstObject).toEqual({material: 'hulma-clay', overlays: 1});
    });

    it('imports an .obj with its .mtl and the texture it names', async () => {
        const {viewport} = await startViewport();

        const result = await viewport.importFiles(createObjFiles());

        expect(result.failures).toEqual([]);
        expect(result.sceneObjects).toHaveLength(1);
        expect(result.sceneObjects[0]).toMatchObject({
            name: 'model',
            fileName: 'model.obj',
            stats: {pointCount: 3, triangleCount: 1},
            textures: [{name: 'file:texture.png', width: 512, height: 512}],
        });
        expect(Object.keys(FilesInputStore.FilesToLoad)).toEqual([]);
    });

    it('reports a file without any mesh as unreadable', async () => {
        const {viewport} = await startViewport();

        const result = await viewport.importFiles([createEmptyGltfFile()]);

        expect(result).toEqual({sceneObjects: [], failures: [{fileName: 'empty.gltf', reason: 'unreadable'}]});
        expect(viewport.scene.meshes.map((mesh) => mesh.name).sort()).toEqual(['axis-x', 'axis-z', 'grid-floor']);
        expect(viewport.scene.transformNodes).toEqual([]);
    });

    it('imports one drop at a time', async () => {
        const {viewport} = await startViewport();
        const operations: string[] = [];
        const store = FilesInputStore.FilesToLoad;
        FilesInputStore.FilesToLoad = new Proxy(store, {
            set(target, name, file) {
                operations.push(`add ${String(name)}`);
                return Reflect.set(target, name, file);
            },
            deleteProperty(target, name) {
                operations.push(`remove ${String(name)}`);
                return Reflect.deleteProperty(target, name);
            },
        });

        try {
            const [first, second] = await Promise.all([
                viewport.importFiles(createSplitGltfFiles()),
                viewport.importFiles(createSplitGltfFiles()),
            ]);

            expect([first.failures, second.failures]).toEqual([[], []]);
            expect(first.sceneObjects.map((sceneObject) => sceneObject.name)).toEqual(['pair']);
            expect(second.sceneObjects.map((sceneObject) => sceneObject.name)).toEqual(['pair.001']);
        } finally {
            FilesInputStore.FilesToLoad = store;
        }

        const dropOperations = ['add pair.gltf', 'add pair.bin', 'remove pair.gltf', 'remove pair.bin'];
        expect(operations).toEqual([...dropOperations, ...dropOperations]);
    });

    it('lists each distinct texture of the original materials once', async () => {
        const {viewport} = await startViewport();

        const [textured] = await importObjects(viewport, [createTexturedGltfFile()]);

        expect(textured.textures).toHaveLength(2);
        expect(textured.textures[0].name).toContain('Base Color');
        for (const texture of textured.textures) {
            expect([texture.width, texture.height]).toEqual([512, 512]);
        }
    });

    it('lists the textures of every sub-material of a multi-material', async () => {
        const {viewport} = await startViewport();
        const loadContainer = await importActualLoader();
        vi.mocked(LoadAssetContainerAsync).mockImplementationOnce(async (source, scene, options) => {
            const container = await loadContainer(source, scene, options);
            const mesh = container.meshes.find((candidate) => candidate.getTotalVertices() > 0)!;
            const extra = new StandardMaterial('extra', scene);
            extra.diffuseTexture = new Texture('file:extra.png', scene);
            const multiMaterial = new MultiMaterial('multi', scene);
            multiMaterial.subMaterials = [mesh.material, null, extra];
            mesh.material = multiMaterial;

            return container;
        });

        const [textured] = await importObjects(viewport, [createTexturedGltfFile()]);

        expect(textured.textures.map((texture) => texture.name)).toEqual([
            expect.stringContaining('Base Color'),
            expect.any(String),
            'file:extra.png',
        ]);
    });

    it('lists the textures of an object imported in solid mode', async () => {
        const {viewport} = await startViewport();
        viewport.setShadingMode('solid');

        const [textured] = await importObjects(viewport, [createTexturedGltfFile()]);

        expect(getModelMeshes(viewport, textured.name)[0].material?.name).toBe('hulma-clay');
        expect(textured.textures.map((texture) => texture.name)).toEqual([
            expect.stringContaining('Base Color'),
            expect.any(String),
        ]);
    });

    it('frames the last object it imports without turning the view', async () => {
        const {viewport} = await startViewport();
        const {alpha, beta, maxZ} = viewport.camera;

        await importObjects(viewport, [createCubeGltfFile()]);

        expectPointCloseTo(viewport.camera.target, {x: 0, y: 0.5, z: 0});
        expect(viewport.camera.radius).toBeGreaterThan(1);
        expect(viewport.camera.radius).toBeLessThan(10);
        expect(viewport.camera.alpha).toBe(alpha);
        expect(viewport.camera.beta).toBe(beta);
        expect(viewport.camera.maxZ).toBe(maxZ);
    });

    it('frames the last of the objects in a drop', async () => {
        const dropped = await startViewport();
        const alone = await startViewport();

        await importObjects(dropped.viewport, [createCubeGltfFile(), createTriangleGltfFile()]);
        await importObjects(alone.viewport, [createTriangleGltfFile()]);

        expect(dropped.viewport.camera.radius).toBeCloseTo(alone.viewport.camera.radius, 6);
    });

    it('hides and shows an object', async () => {
        const {viewport} = await startViewport();
        const [triangle] = await importObjects(viewport, [createTriangleGltfFile()]);
        const root = getRoot(viewport, triangle.name);

        viewport.setObjectVisibility(triangle.id, false);
        expect(root.isEnabled()).toBe(false);

        viewport.setObjectVisibility(triangle.id, true);
        expect(root.isEnabled()).toBe(true);
    });

    it('renames with a unique name', async () => {
        const {viewport} = await startViewport();
        const files = [createTriangleGltfFile('a.gltf'), createTriangleGltfFile('b.gltf')];
        const [, b] = await importObjects(viewport, files);

        const name = viewport.renameObject(b.id, 'a');

        expect(name).toBe('a.001');
        expect(viewport.scene.getTransformNodeByName('a.001')).not.toBeNull();
        expect(viewport.scene.getTransformNodeByName('b')).toBeNull();
    });

    it('keeps the name an object is renamed to when it does not change', async () => {
        const {viewport} = await startViewport();
        const files = [createTriangleGltfFile('a.gltf'), createTriangleGltfFile('b.gltf')];
        const [a, b] = await importObjects(viewport, files);

        expect(viewport.renameObject(a.id, 'a')).toBe('a');
        expect(viewport.renameObject(b.id, 'b.001')).toBe('b.001');
        expect(viewport.renameObject(b.id, 'b.001')).toBe('b.001');
        expect(viewport.scene.getTransformNodeByName('b.001')).not.toBeNull();
    });

    it('throws for an object it does not hold', async () => {
        const {viewport} = await startViewport();

        expect(() => viewport.setObjectVisibility('object-9', false)).toThrow('object-9');
        expect(() => viewport.renameObject('object-9', 'name')).toThrow('object-9');
        expect(() => viewport.selectObject('object-9')).toThrow('object-9');
        expect(() => viewport.getObjectStats('object-9')).toThrow('object-9');
    });

    it('outlines the selected object', async () => {
        const {viewport} = await startViewport();
        const [cube, triangle] = await importObjects(viewport, [createCubeGltfFile(), createTriangleGltfFile()]);
        const layer = getSelectionOutlineLayer(viewport);
        const [cubeMesh] = getModelMeshes(viewport, cube.name);
        const [triangleMesh] = getModelMeshes(viewport, triangle.name);

        viewport.selectObject(cube.id);
        expect([layer.hasMesh(cubeMesh), layer.hasMesh(triangleMesh)]).toEqual([true, false]);

        viewport.selectObject(triangle.id);
        expect([layer.hasMesh(cubeMesh), layer.hasMesh(triangleMesh)]).toEqual([false, true]);

        viewport.selectObject(null);
        expect([layer.hasMesh(cubeMesh), layer.hasMesh(triangleMesh)]).toEqual([false, false]);
    });

    it('outlines in Blender orange, two pixels thick', async () => {
        const {viewport} = await startViewport();

        const layer = getSelectionOutlineLayer(viewport);

        expect(layer.outlineColor.toHexString()).toBe('#F0A23B');
        expect(layer.outlineThickness).toBe(2);
    });

    it('keeps the selection when it is asked to select an object it does not hold', async () => {
        const {viewport} = await startViewport();
        const [cube] = await importObjects(viewport, [createCubeGltfFile()]);
        const [cubeMesh] = getModelMeshes(viewport, cube.name);
        viewport.selectObject(cube.id);

        expect(() => viewport.selectObject('object-9')).toThrow();

        expect(getSelectionOutlineLayer(viewport).hasMesh(cubeMesh)).toBe(true);
    });

    it('reports the picked object', async () => {
        const {viewport} = await startViewport();
        const [cube, triangle] = await importObjects(viewport, [createCubeGltfFile(), createTriangleGltfFile()]);
        const listener = vi.fn();
        viewport.onObjectPicked(listener);

        tap(viewport, getModelMeshes(viewport, triangle.name)[0]);
        expect(listener).toHaveBeenLastCalledWith(triangle.id);

        tap(viewport, getModelMeshes(viewport, cube.name)[0]);
        expect(listener).toHaveBeenLastCalledWith(cube.id);

        tap(viewport, null);
        expect(listener).toHaveBeenLastCalledWith(null);

        tap(viewport, viewport.scene.getMeshByName('grid-floor'));
        expect(listener).toHaveBeenLastCalledWith(null);
        expect(listener).toHaveBeenCalledTimes(4);
    });

    it('reports a pick on any mesh below the object', async () => {
        const {viewport} = await startViewport();
        const [cube] = await importObjects(viewport, [createCubeGltfFile()]);
        const [cubeMesh] = getModelMeshes(viewport, cube.name);
        viewport.setWireframeVisible(true);
        const listener = vi.fn();
        viewport.onObjectPicked(listener);

        tap(viewport, getOverlays(cubeMesh)[0]);

        expect(listener).toHaveBeenCalledWith(cube.id);
    });

    it('tells every listener what was picked', async () => {
        const {viewport} = await startViewport();
        const [triangle] = await importObjects(viewport, [createTriangleGltfFile()]);
        const listeners = [vi.fn(), vi.fn()];
        listeners.forEach((listener) => viewport.onObjectPicked(listener));

        tap(viewport, getModelMeshes(viewport, triangle.name)[0]);

        expect(listeners[0]).toHaveBeenCalledWith(triangle.id);
        expect(listeners[1]).toHaveBeenCalledWith(triangle.id);
    });

    it('reports only taps of the primary button', async () => {
        const {viewport} = await startViewport();
        const [triangle] = await importObjects(viewport, [createTriangleGltfFile()]);
        const listener = vi.fn();
        viewport.onObjectPicked(listener);

        tap(viewport, getModelMeshes(viewport, triangle.name)[0], 1);
        tap(viewport, getModelMeshes(viewport, triangle.name)[0], 2);
        tap(viewport, null, 1);

        expect(listener).not.toHaveBeenCalled();
    });

    it('does not let the grid, the axes or the wireframe overlays be picked', async () => {
        const {viewport} = await startViewport();
        const [cube] = await importObjects(viewport, [createCubeGltfFile()]);
        viewport.setWireframeVisible(true);
        const [cubeMesh] = getModelMeshes(viewport, cube.name);

        for (const name of ['grid-floor', 'axis-x', 'axis-z']) {
            expect(viewport.scene.getMeshByName(name)?.isPickable, name).toBe(false);
        }
        expect(getOverlays(cubeMesh).map((overlay) => overlay.isPickable)).toEqual([false]);
        expect(cubeMesh.isPickable).toBe(true);
    });

    it('counts what is shown', async () => {
        const {viewport} = await startViewport();
        const [cube, triangle] = await importObjects(viewport, [createCubeGltfFile(), createTriangleGltfFile()]);

        expect(viewport.getObjectStats(cube.id)).toEqual({pointCount: 8, triangleCount: 12});
        expect(viewport.getObjectStats(triangle.id)).toEqual({pointCount: 3, triangleCount: 1});
        expect(cube.stats).toEqual({pointCount: 8, triangleCount: 12});
        expect(triangle.stats).toEqual({pointCount: 3, triangleCount: 1});
    });

    it('counts the same whether the eye is on, the shading is solid or the wireframe is on', async () => {
        const {viewport} = await startViewport();
        const [cube] = await importObjects(viewport, [createCubeGltfFile()]);
        const stats = viewport.getObjectStats(cube.id);

        viewport.setObjectVisibility(cube.id, false);
        expect(viewport.getObjectStats(cube.id)).toEqual(stats);

        viewport.setShadingMode('solid');
        expect(viewport.getObjectStats(cube.id)).toEqual(stats);

        viewport.setWireframeVisible(true);
        expect(viewport.getObjectStats(cube.id)).toEqual(stats);
    });

    it('counts only the meshes that are enabled themselves', async () => {
        const {viewport} = await startViewport();
        const [cube] = await importObjects(viewport, [createCubeGltfFile()]);
        const [cubeMesh] = getModelMeshes(viewport, cube.name);

        cubeMesh.setEnabled(false);
        expect(viewport.getObjectStats(cube.id)).toEqual({pointCount: 0, triangleCount: 0});

        cubeMesh.setEnabled(true);
        expect(viewport.getObjectStats(cube.id)).toEqual({pointCount: 8, triangleCount: 12});
    });

    it('switches to clay in solid mode and back', async () => {
        const {viewport} = await startViewport();
        const [cube, triangle] = await importObjects(viewport, [createCubeGltfFile(), createTriangleGltfFile()]);
        const meshes = [...getModelMeshes(viewport, cube.name), ...getModelMeshes(viewport, triangle.name)];
        const originalMaterials = meshes.map((mesh) => mesh.material);

        viewport.setShadingMode('solid');

        expect(meshes.map((mesh) => mesh.material?.name)).toEqual(['hulma-clay', 'hulma-clay']);
        const clay = meshes[0].material as PBRMaterial;
        expect(clay).toBeInstanceOf(PBRMaterial);
        expect(meshes[1].material).toBe(clay);
        // PBR albedo is linear, so #BDBDBD is what the clay shows only once its albedo is the linear form of it.
        expect(clay.albedoColor.toGammaSpace().toHexString()).toBe('#BDBDBD');
        expect(clay.metallic).toBe(0);
        expect(clay.roughness).toBe(0.65);

        viewport.setShadingMode('textured');

        meshes.forEach((mesh, index) => expect(mesh.material).toBe(originalMaterials[index]));
    });

    it('gives an object imported in solid mode clay at once, and its own material back in textured mode', async () => {
        const {viewport} = await startViewport();
        viewport.setShadingMode('solid');

        const [triangle] = await importObjects(viewport, [createTriangleGltfFile()]);
        const [mesh] = getModelMeshes(viewport, triangle.name);

        expect(mesh.material?.name).toBe('hulma-clay');

        viewport.setShadingMode('textured');

        expect(mesh.material).not.toBeNull();
        expect(mesh.material?.name).not.toBe('hulma-clay');
    });

    it('overlays the wireframe', async () => {
        const {viewport} = await startViewport();
        const [cube] = await importObjects(viewport, [createCubeGltfFile()]);
        const [cubeMesh] = getModelMeshes(viewport, cube.name);
        cubeMesh.position.set(2, 0, 0);
        cubeMesh.scaling.set(1, 2, 1);

        viewport.setWireframeVisible(true);

        const overlays = getOverlays(cubeMesh);
        expect(overlays).toHaveLength(1);
        const [overlay] = overlays;
        expect(overlay.isEnabled()).toBe(true);
        expect(overlay.geometry).toBe(cubeMesh.geometry);
        const material = overlay.material as StandardMaterial;
        expect(material).toBeInstanceOf(StandardMaterial);
        expect(material.wireframe).toBe(true);
        expect(material.disableLighting).toBe(true);
        expect(material.emissiveColor.toHexString()).toBe('#1A1A1A');
        expect(material.alpha).toBe(0.35);
        expect(material.zOffset).toBe(-1);
        cubeMesh.computeWorldMatrix(true);
        overlay.computeWorldMatrix(true);
        expect(Array.from(overlay.getWorldMatrix().asArray())).toEqual(Array.from(cubeMesh.getWorldMatrix().asArray()));

        viewport.setWireframeVisible(false);
        expect(overlay.isEnabled(false)).toBe(false);

        viewport.setWireframeVisible(true);
        expect(getOverlays(cubeMesh)).toEqual([overlay]);
        expect(overlay.isEnabled()).toBe(true);
    });

    it('gives an object imported while the wireframe is on its overlay at once', async () => {
        const {viewport} = await startViewport();
        viewport.setWireframeVisible(true);

        const [triangle] = await importObjects(viewport, [createTriangleGltfFile()]);
        const [mesh] = getModelMeshes(viewport, triangle.name);

        expect(getOverlays(mesh).map((overlay) => overlay.isEnabled())).toEqual([true]);
    });

    it('leaves an object imported while the wireframe is off without a visible overlay', async () => {
        const {viewport} = await startViewport();
        viewport.setWireframeVisible(true);
        viewport.setWireframeVisible(false);

        const [triangle] = await importObjects(viewport, [createTriangleGltfFile()]);
        const [mesh] = getModelMeshes(viewport, triangle.name);

        expect(getOverlays(mesh).filter((overlay) => overlay.isEnabled(false))).toEqual([]);

        viewport.setWireframeVisible(true);

        expect(getOverlays(mesh).map((overlay) => overlay.isEnabled())).toEqual([true]);
    });

    it('frames the selected object with Home and the numpad period', async () => {
        const {canvas, viewport} = await startViewport();
        const [cube, triangle] = await importObjects(viewport, [createCubeGltfFile(), createTriangleGltfFile()]);
        getRoot(viewport, cube.name).position.x += 10;
        renderFrames(viewport, 1);
        const {alpha, beta} = viewport.camera;
        const cubeCenter = getBoundsCenter(getWorldBounds(getModelMeshes(viewport, cube.name)));
        const triangleCenter = getBoundsCenter(getWorldBounds(getModelMeshes(viewport, triangle.name)));

        for (const code of ['Home', 'NumpadDecimal']) {
            viewport.selectObject(cube.id);
            const cubeEvent = pressKey(canvas, code);
            expectPointCloseTo(viewport.camera.target, cubeCenter);
            expect(cubeEvent.defaultPrevented, code).toBe(true);

            viewport.selectObject(triangle.id);
            pressKey(canvas, code);
            expectPointCloseTo(viewport.camera.target, triangleCenter);
        }
        expect(viewport.camera.alpha).toBe(alpha);
        expect(viewport.camera.beta).toBe(beta);
    });

    it('frames every visible object with Home when nothing is selected', async () => {
        const {canvas, viewport} = await startViewport();
        const [cube, triangle] = await importObjects(viewport, [createCubeGltfFile(), createTriangleGltfFile()]);
        getRoot(viewport, cube.name).position.x += 10;
        renderFrames(viewport, 1);
        const cubeMeshes = getModelMeshes(viewport, cube.name);
        const triangleMeshes = getModelMeshes(viewport, triangle.name);
        viewport.selectObject(null);

        const event = pressKey(canvas, 'Home');

        expectPointCloseTo(viewport.camera.target, getBoundsCenter(getWorldBounds([...cubeMeshes, ...triangleMeshes])));
        expect(event.defaultPrevented).toBe(true);
        const radiusOfBoth = viewport.camera.radius;

        viewport.setObjectVisibility(cube.id, false);
        pressKey(canvas, 'NumpadDecimal');

        expectPointCloseTo(viewport.camera.target, getBoundsCenter(getWorldBounds(triangleMeshes)));
        expect(viewport.camera.radius).toBeLessThan(radiusOfBoth);
    });

    it('leaves the camera alone when there is nothing visible to frame', async () => {
        const empty = await startViewport();
        const hidden = await startViewport();
        const [triangle] = await importObjects(hidden.viewport, [createTriangleGltfFile()]);
        hidden.viewport.setObjectVisibility(triangle.id, false);

        for (const {canvas, viewport} of [empty, hidden]) {
            const {alpha, beta, radius} = viewport.camera;
            const target = viewport.camera.target.clone();

            const event = pressKey(canvas, 'Home');

            expect(viewport.camera.target.equals(target)).toBe(true);
            expect(viewport.camera.alpha).toBe(alpha);
            expect(viewport.camera.beta).toBe(beta);
            expect(viewport.camera.radius).toBe(radius);
            expect(event.defaultPrevented).toBe(true);
        }
    });

    it('stops the camera gliding when it frames', async () => {
        const {canvas, viewport} = await startViewport();
        await importObjects(viewport, [createCubeGltfFile()]);
        pinFrameRate(viewport);
        // Already-scaled per-frame values, as in the numpad specs: 6 frames build up a glide, 60 test the framing.
        viewport.camera.movement.rotationAccumulatedPixels.set(-0.06, -0.03, 0);
        viewport.camera.movement.panAccumulatedPixels.set(-0.04, 0.02, 0);
        renderFrames(viewport, 6);

        pressKey(canvas, 'Home');
        const {alpha, beta} = viewport.camera;
        const pivot = viewport.camera.target.clone();
        renderFrames(viewport, 60);

        expect(Math.abs(viewport.camera.alpha - alpha)).toBeLessThan(1e-6);
        expect(Math.abs(viewport.camera.beta - beta)).toBeLessThan(1e-6);
        expect(viewport.camera.target.subtract(pivot).length()).toBeLessThan(1e-6);
    });

    it('exports an object as a GLB that imports back', async () => {
        const {viewport} = await startViewport();
        const [cube] = await importObjects(viewport, [createCubeGltfFile()]);

        const glb = await viewport.exportObjectAsGlb(cube.id);

        const [reimported] = await importGlb(glb);
        expect(reimported.stats).toEqual({pointCount: 8, triangleCount: 12});
    });

    it('exports a hidden object', async () => {
        const {viewport} = await startViewport();
        const [cube] = await importObjects(viewport, [createCubeGltfFile()]);
        viewport.setObjectVisibility(cube.id, false);

        const glb = await viewport.exportObjectAsGlb(cube.id);

        const [reimported] = await importGlb(glb);
        expect(reimported.stats.triangleCount).toBe(12);
    });

    it('exports original materials in solid mode', async () => {
        const {viewport, cube, originalMaterial} = await importCubeWithDisplayOptions();

        const {materials, nodes} = await readGlbJson(await viewport.exportObjectAsGlb(cube.id));

        expect(materials.map((material) => material.name)).toEqual([originalMaterial]);
        expect(nodes.filter((node) => node.name?.endsWith('-wireframe'))).toEqual([]);
    });

    it('exports only the requested object', async () => {
        const {viewport} = await startViewport();
        const [, cube] = await importObjects(viewport, [createTriangleGltfFile(), createCubeGltfFile()]);

        const glb = await viewport.exportObjectAsGlb(cube.id);

        const reimported = await importGlb(glb);
        expect(reimported).toHaveLength(1);
        expect(reimported[0].stats).toEqual({pointCount: 8, triangleCount: 12});
    });

    it('leaves a disabled node out of the file, and what hangs below it', async () => {
        const {viewport} = await startViewport();
        const [cube] = await importObjects(viewport, [createCubeGltfFile()]);
        const [mesh] = getModelMeshes(viewport, cube.name);
        const exportMeshes = async () => (await readGlbJson(await viewport.exportObjectAsGlb(cube.id))).meshes ?? [];

        expect(await exportMeshes()).toHaveLength(1);

        // The mesh itself, which is how Molding will switch off an original, and the loader's node above it.
        for (const node of [mesh, mesh.parent!]) {
            node.setEnabled(false);

            expect(await exportMeshes(), node.name).toEqual([]);

            node.setEnabled(true);
        }
    });

    it('exports an object where it stands on the grid, so the file keeps that pivot', async () => {
        const {viewport} = await startViewport();
        const loadContainer = await importActualLoader();

        for (const file of [createCubeGltfFile(), createTransformedGltfFile()]) {
            const [sceneObject] = await importObjects(viewport, [file]);
            const glb = await viewport.exportObjectAsGlb(sceneObject.id);

            // Loaded as it is, without the grounding an import adds, so that only the file puts the model in place.
            const container = await loadContainer(new File([glb], 'raw.glb'), viewport.scene, {rootUrl: 'file:'});
            const bounds = getWorldBounds(container.meshes.filter((mesh) => mesh.getTotalVertices() > 0));
            container.dispose();

            const center = getBoundsCenter(bounds);
            expect(Math.abs(center.x), file.name).toBeLessThan(1e-6);
            expect(Math.abs(center.z), file.name).toBeLessThan(1e-6);
            expect(Math.abs(bounds.minimum.y), file.name).toBeLessThan(1e-6);
        }
    });

    it('rejects for an object it does not hold', async () => {
        const {viewport} = await startViewport();

        await expect(viewport.exportObjectAsGlb('object-9')).rejects.toThrow('object-9');
    });

    it('puts the object back as it was after an export', async () => {
        const {viewport, cube} = await importCubeWithDisplayOptions();
        const before = describeObjectDisplay(viewport, cube.name);
        expect(before).toEqual({isRootEnabled: false, materials: ['hulma-clay'], overlays: [true]});

        await viewport.exportObjectAsGlb(cube.id);

        expect(describeObjectDisplay(viewport, cube.name)).toEqual(before);
    });

    it('puts the object back as it was when the export fails, and holds nothing up', async () => {
        const {viewport, cube, originalMaterial} = await importCubeWithDisplayOptions();
        const before = describeObjectDisplay(viewport, cube.name);
        expect(before).toEqual({isRootEnabled: false, materials: ['hulma-clay'], overlays: [true]});
        let during: ReturnType<typeof describeObjectDisplay> | undefined;
        vi.spyOn(GLTF2Export, 'GLBAsync').mockImplementationOnce(async () => {
            during = describeObjectDisplay(viewport, cube.name);
            throw new Error('The serializer failed.');
        });

        await expect(viewport.exportObjectAsGlb(cube.id)).rejects.toThrow('The serializer failed.');
        const frameId = viewport.scene.getFrameId();

        expect(during).toEqual({isRootEnabled: true, materials: [originalMaterial], overlays: [false]});
        expect(describeObjectDisplay(viewport, cube.name)).toEqual(before);
        await vi.waitFor(() => expect(viewport.scene.getFrameId()).toBeGreaterThan(frameId));
        await expect(viewport.exportObjectAsGlb(cube.id)).resolves.toBeInstanceOf(Blob);
    });

    it('resumes drawing and frees the turn even when putting the object back throws', async () => {
        const {viewport, cube} = await importCubeWithDisplayOptions();
        vi.spyOn(viewport, 'setShadingMode').mockImplementationOnce(() => {
            throw new Error('The shading could not be given back.');
        });

        await expect(viewport.exportObjectAsGlb(cube.id)).rejects.toThrow('The shading could not be given back.');
        const frameId = viewport.scene.getFrameId();

        await vi.waitFor(() => expect(viewport.scene.getFrameId()).toBeGreaterThan(frameId));
        await expect(viewport.exportObjectAsGlb(cube.id)).resolves.toBeInstanceOf(Blob);
    });

    it('gives up on an export that never settles, puts the object back and lets the next export run', async () => {
        const {viewport, cube, originalMaterial} = await importCubeWithDisplayOptions();
        const before = describeObjectDisplay(viewport, cube.name);
        expect(before).toEqual({isRootEnabled: false, materials: ['hulma-clay'], overlays: [true]});
        let finishLate: (data: GLTFData) => void = () => undefined;
        const exportGlb = vi
            .spyOn(GLTF2Export, 'GLBAsync')
            .mockImplementationOnce(() => new Promise<GLTFData>((resolve) => (finishLate = resolve)));
        vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']});
        const settled = vi.fn();
        const stuckExport = viewport.exportObjectAsGlb(cube.id).then(settled, settled);

        await vi.advanceTimersByTimeAsync(MODEL_EXPORT_TIMEOUT_MS - 1);

        expect(exportGlb).toHaveBeenCalledTimes(1);
        expect(settled).not.toHaveBeenCalled();
        expect(describeObjectDisplay(viewport, cube.name)).toEqual({
            isRootEnabled: true,
            materials: [originalMaterial],
            overlays: [false],
        });

        await vi.advanceTimersByTimeAsync(1);
        await stuckExport;

        expect(settled).toHaveBeenCalledTimes(1);
        const [error] = settled.mock.calls[0];
        expect(error).toBeInstanceOf(Error);
        expect(error.message).toContain(cube.name);
        expect(describeObjectDisplay(viewport, cube.name)).toEqual(before);

        // What the serializer produces after the timeout is dropped.
        finishLate({files: {'cube.glb': new Blob()}} as unknown as GLTFData);
        await vi.advanceTimersByTimeAsync(0);

        expect(settled).toHaveBeenCalledTimes(1);
        expect(describeObjectDisplay(viewport, cube.name)).toEqual(before);

        vi.useRealTimers();
        const frameId = viewport.scene.getFrameId();
        await vi.waitFor(() => expect(viewport.scene.getFrameId()).toBeGreaterThan(frameId));
        await expect(viewport.exportObjectAsGlb(cube.id)).resolves.toBeInstanceOf(Blob);
    });

    it('clears the timer of an export once it has settled, whether it worked or failed', async () => {
        const {viewport} = await startViewport();
        const [cube] = await importObjects(viewport, [createCubeGltfFile()]);
        viewport.scene.getEngine().stopRenderLoop();
        vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']});
        vi.spyOn(GLTF2Export, 'GLBAsync').mockRejectedValueOnce(new Error('The serializer failed.'));

        await expect(viewport.exportObjectAsGlb(cube.id)).rejects.toThrow('The serializer failed.');

        expect(vi.getTimerCount()).toBe(0);

        await expect(viewport.exportObjectAsGlb(cube.id)).resolves.toBeInstanceOf(Blob);

        expect(vi.getTimerCount()).toBe(0);
    });

    it('keeps a hidden object hidden when it is exported twice at once', async () => {
        const {viewport} = await startViewport();
        const [cube] = await importObjects(viewport, [createCubeGltfFile()]);
        viewport.setObjectVisibility(cube.id, false);

        const [first, second] = await Promise.all([
            viewport.exportObjectAsGlb(cube.id),
            viewport.exportObjectAsGlb(cube.id),
        ]);

        expect(first.size).toBeGreaterThan(0);
        expect(second.size).toBe(first.size);
        expect(getRoot(viewport, cube.name).isEnabled(false)).toBe(false);
    });

    it('exports only after the import that was asked for before it', async () => {
        const {viewport} = await startViewport();
        const [cube] = await importObjects(viewport, [createCubeGltfFile()]);
        const loadContainer = await importActualLoader();
        let releaseLoad: () => void = () => undefined;
        const loadHeldBack = new Promise<void>((resolve) => (releaseLoad = resolve));
        vi.mocked(LoadAssetContainerAsync).mockImplementationOnce(async (source, scene, options) => {
            await loadHeldBack;

            return loadContainer(source, scene, options);
        });
        const exportGlb = vi.spyOn(GLTF2Export, 'GLBAsync');

        const importing = viewport.importFiles([createTriangleGltfFile()]);
        const exporting = viewport.exportObjectAsGlb(cube.id);
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(exportGlb).not.toHaveBeenCalled();

        releaseLoad();
        const [result] = await Promise.all([importing, exporting]);

        expect(result.sceneObjects).toHaveLength(1);
        expect(exportGlb).toHaveBeenCalledTimes(1);
    });

    it('does not draw the viewport while an export runs', async () => {
        const {viewport} = await startViewport();
        const [cube] = await importObjects(viewport, [createCubeGltfFile()]);
        const {scene} = viewport;
        let finishExport: (data: GLTFData) => void = () => undefined;
        const exportGlb = vi
            .spyOn(GLTF2Export, 'GLBAsync')
            .mockImplementationOnce(() => new Promise<GLTFData>((resolve) => (finishExport = resolve)));

        const exporting = viewport.exportObjectAsGlb(cube.id);
        await vi.waitFor(() => expect(exportGlb).toHaveBeenCalled());
        const frameId = scene.getFrameId();
        await new Promise((resolve) => setTimeout(resolve, 100));

        expect(scene.getFrameId()).toBe(frameId);

        finishExport({files: {'cube.glb': new Blob()}} as unknown as GLTFData);
        await exporting;
        await vi.waitFor(() => expect(scene.getFrameId()).toBeGreaterThan(frameId));
    });
});
