import type {ArcRotateCamera} from '@babylonjs/core/Cameras/arcRotateCamera';
import {PickingInfo} from '@babylonjs/core/Collisions/pickingInfo';
import * as engineModule from '@babylonjs/core/Engines/engine';
import type {IMouseEvent} from '@babylonjs/core/Events/deviceInputEvents';
import {PointerEventTypes, PointerInfo} from '@babylonjs/core/Events/pointerEvents';
import {SelectionOutlineLayer} from '@babylonjs/core/Layers/selectionOutlineLayer';
import {DirectionalLight} from '@babylonjs/core/Lights/directionalLight';
import {HemisphericLight} from '@babylonjs/core/Lights/hemisphericLight';
import {PBRMaterial} from '@babylonjs/core/Materials/PBR/pbrMaterial';
import {StandardMaterial} from '@babylonjs/core/Materials/standardMaterial';
import * as hdrCubeTextureModule from '@babylonjs/core/Materials/Textures/hdrCubeTexture';
import type {AbstractMesh} from '@babylonjs/core/Meshes/abstractMesh';
import type {LinesMesh} from '@babylonjs/core/Meshes/linesMesh';
import {Mesh} from '@babylonjs/core/Meshes/mesh';
import type {TransformNode} from '@babylonjs/core/Meshes/transformNode';
import {FilesInputStore} from '@babylonjs/core/Misc/filesInputStore';
import {GridMaterial} from '@babylonjs/materials/grid/gridMaterial';
import {IBounds} from '@core/math/interfaces/bounds.interface';
import {IVector3} from '@core/math/interfaces/vector.interface';
import {getBoundsCenter} from '@core/math/utilities/bounds.utility';
import {
    createCubeGltfFile,
    createEmptyGltfFile,
    createPointCloudPlyFile,
    createSplatPlyFile,
    createSplitGltfFiles,
    createTexturedGltfFile,
    createTransformedGltfFile,
    createTriangleGltfFile,
    createUnreadableGlbFile
} from '@core/tests/mocks/model-file.mock';
import {AXIS_X_COLOR, AXIS_Z_COLOR, BLENDER_NAVIGATION_INPUT_MAP} from '@core/viewport/constants/viewport.constant';
import {ISceneObject} from '@core/viewport/interfaces/scene-object.interface';
import {Viewport} from '@core/viewport/services/viewport.service';

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
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        document.body.replaceChildren();
    });

    it('creates the engine at the device pixel ratio, capped at 2, with a stencil buffer', async () => {
        const createEngine = vi.spyOn(engineModule, 'Engine');
        const {canvas} = await startViewport();

        expect(createEngine).toHaveBeenCalledWith(
            canvas,
            true,
            {preserveDrawingBuffer: false, stencil: true, limitDeviceRatio: 2},
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
    });

    it('adds a hemispheric fill light and a directional key light', async () => {
        const {viewport} = await startViewport();
        const {lights} = viewport.scene;

        const fillLight = lights.find((light) => light instanceof HemisphericLight);
        const keyLight = lights.find((light) => light instanceof DirectionalLight) as DirectionalLight | undefined;
        expect(fillLight?.intensity).toBe(0.4);
        expect(keyLight?.intensity).toBe(0.8);
        expect(keyLight?.direction.asArray()).toEqual([-0.5, -1, -0.4]);
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

    it('finds a resource file by its lowercase name', async () => {
        const {viewport} = await startViewport();

        const result = await viewport.importFiles(createSplitGltfFiles('Pair'));

        expect(result.failures).toEqual([]);
        expect(result.sceneObjects.map((sceneObject) => sceneObject.name)).toEqual(['Pair']);
    });

    it('reports a .gltf whose .bin is missing as unreadable', async () => {
        const requestedUrls = stubFailingRequests();
        const {viewport} = await startViewport();
        const [gltf] = createSplitGltfFiles();

        const result = await viewport.importFiles([gltf]);

        expect(result).toEqual({sceneObjects: [], failures: [{fileName: 'pair.gltf', reason: 'unreadable'}]});
        expect(requestedUrls).toEqual([expect.stringContaining('pair.bin')]);
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
        expect(clay.albedoColor.toHexString()).toBe('#BDBDBD');
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
});
