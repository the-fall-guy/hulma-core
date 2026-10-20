# Coding Standard

This standard applies to all new code and to any code you change.
Generated files (build output, lock files) are exempt.

This is a plain TypeScript library. It has no UI, no framework and no state. The client creates its instances, keeps
them and calls them.

## Contents

1. [Formatting](#1-formatting)
2. [Naming](#2-naming)
3. [Functions: flatten the indirection](#3-functions-flatten-the-indirection)
4. [Project structure](#4-project-structure)
5. [Layers](#5-layers)
6. [Tests](#6-tests)

---

## 1. Formatting

- Indent with **4 spaces** in every hand-written file: TypeScript and JSON. Never tabs.
- Use single quotes.
- End every statement with a semicolon.
- Keep lines to 120 characters or fewer.
- In TypeScript, put a trailing comma after the last item of a multiline array or object. Never put one in imports,
  exports or parameter lists.
- No spaces inside braces: `import {Mesh} from '@core/mesh/services/mesh.service';`, `const {x, y} = vector;`.
- Always wrap arrow function parameters in parentheses: `(vertex) => vertex.x`.
- Compare with `===` and `!==`. Never `==` or `!=`.
- Declare with `const`. Use `let` only when the value is reassigned. Never `var`.
- End every file with a newline. Leave no trailing whitespace.

### Class members

- Every field and method states its access: `public`, `protected` or `private`. Constructors have none.
- Mark every override with `override`.
- Order members like this:
    1. Fields: public, then protected, then private
    2. Constructor
    3. Methods: public, then protected, then private

### Imports

Order imports in three groups: libraries, then the `@core/…` alias, then same-folder `./` imports.

### Example

```ts
import {IVector3} from '@core/math/interfaces/vector.interface';
import {addVectors} from '@core/math/utilities/vector.utility';
import {IFace} from '@core/mesh/interfaces/face.interface';

export class Mesh {
    public readonly id: string;
    public vertices: IVector3[];
    public faces: IFace[];

    constructor(id: string, vertices: IVector3[], faces: IFace[]) {
        this.id = id;
        this.vertices = vertices;
        this.faces = faces;
    }

    public translate(offset: IVector3): void {
        this.vertices = this.vertices.map((vertex) => addVectors(vertex, offset));
    }
}
```

### Editor config

The repository root holds this `.editorconfig`:

```ini
root = true

[*]
charset = utf-8
indent_style = space
indent_size = 4
max_line_length = 120
insert_final_newline = true
trim_trailing_whitespace = true

[*.ts]
quote_type = single

[*.md]
max_line_length = off
trim_trailing_whitespace = false
```

---

## 2. Naming

A name is the documentation. Reading the name should tell you what the thing is or does, without opening it.

1. **The name alone says what it does.** No need to read the body.
2. **Booleans and boolean-returning functions get predicate names:** `is…`, `has…`, `can…`, `should…`, `…Exists`.
3. **Keep assert and check honest.** `assert…` throws when the check fails. `is…` and `has…` return `true` or
   `false`.
4. **Cut filler.** `meshExists()`, not `checkIfMeshExists()`. `mesh`, not `meshData` or `meshObject`.
5. **Use full words, not abbreviations.** `config`, not `cfg`.
6. **Match the grammar to the subject.** One face exists: `faceExists()`. Several faces exist: `facesExist()`.

| Rule | Bad | Good |
|---|---|---|
| 1 | `process()`, `handle()`, `data`, `doMath()` | `moveFacesAlongNormal()`, `selectedFaces` |
| 2 | `visible`, `triangle()`, `closed` | `isVisible`, `isTriangle()`, `isClosed`, `hasNormals`, `canSubdivide`, `shouldRecalculateNormals`, `meshExists()` |
| 3 | `validateMesh()` that throws, `checkManifold()` that returns a boolean | `assertMeshValid()`, `isManifold()` |
| 4 | `checkIfMeshExists()`, `meshData`, `meshObject`, `getVertexInfo()` | `meshExists()`, `mesh`, `getVertex()` |
| 5 | `cfg`, `vec`, `mat`, `idx`, `pos`, `norm`, `utils` | `config`, `vector`, `matrix`, `index`, `position`, `normal`, `utilities` |
| 6 | `facesExists()`, `faceExist()` | `facesExist()`, `faceExists()` |

Rule 3 in code:

```ts
export function isTriangle(face: IFace): boolean {
    return face.vertexIndices.length === 3;
}

export function assertTriangle(face: IFace): void {
    if (!isTriangle(face)) {
        throw new Error('Face is not a triangle.');
    }
}
```

Rule 5 has three exceptions. These keep their short form:

- Common acronyms that read as words: `id`, `url`, `api`, `json`, `gpu`, `cpu`.
- Math and graphics notation: `x`, `y`, `z`, `w`, `uv`, `rgb`, `rgba`, `fov`.
- Names that come from a library or a browser API, and names built from them: `Float32Array`,
  `WebGL2RenderingContext`.

### Casing

| Thing | Form | Example |
|---|---|---|
| Class | PascalCase, named for what it is, with no type suffix | `Mesh`, `Scene`, `Renderer` |
| Interface | `I` + PascalCase | `IVector3`, `IFace` |
| Enum | `E` + PascalCase, with PascalCase members | `EShadingMode.Smooth` |
| Type alias | `T` + PascalCase | `TAxis` |
| Exported constant | UPPER_SNAKE_CASE | `MAX_SUBDIVISION_LEVEL` |
| Variable, property, function, method, parameter | camelCase | `selectedFaces`, `moveFacesAlongNormal()` |
| File and folder | kebab-case with a layer suffix | `mesh.service.ts`, `vector.utility.ts` |

A class drops the type suffix, because an instance of `Mesh` *is* a mesh. Its file keeps the layer suffix:
`mesh/services/mesh.service.ts`.

---

## 3. Functions: flatten the indirection

You should be able to read one function top to bottom and understand the whole logic, without jumping around.

- **Entry function:** where reading starts. That is what the client calls: a public method or an exported function.
- **Hop:** a call from one function we wrote into another function we wrote, on the way to the real work.
- **Not hops:** calls into a library or a browser API, and utilities. You can read these by name.

The rules:

1. **At most 2 hops from the entry function to the real work.** Anything deeper, pull it up.
2. **Inline any function that is called only once and just forwards to another function.** Those wrappers add
   nothing.
3. **Extract a function only when it is reused, or long enough to be its own thing.** Never just to make the code
   look tidy.
4. **Keep the main flow linear.** Use early returns instead of nesting.
5. **A hop is allowed when it crosses a real boundary.** In this library that means the GPU (WebGL or WebGPU), Web
   Workers and third-party libraries. A method whose only job is to cross one boundary may exist even if it just
   forwards.
6. **Do not add layers "for flexibility later."** Write for what the code does now:
    - no interface or abstract class with a single implementation
    - no factory that builds one thing
    - no option nobody passes

How these rules fit the [layers](#5-layers):

- A public method or an exported function holds the real work.
- It may make one more hop, either to another class's method or to one of its own private methods.
- Utilities may call other utilities. Rules 2 to 4 still apply inside them.

**Bad:** three hops of forwarding before the real work.

```ts
public moveFacesAlongNormal(faceIds: number[], distance: number): void {
    this.moveFaces(faceIds, distance);
}

private moveFaces(faceIds: number[], distance: number): void {
    for (const faceId of faceIds) {
        this.moveFace(this.faces[faceId], distance);
    }
}

private moveFace(face: IFace, distance: number): void {
    this.offsetVertices(face.vertexIndices, scaleVector(face.normal, distance));
}

private offsetVertices(vertexIndices: number[], offset: IVector3): void {
    for (const vertexIndex of vertexIndices) {
        this.vertices[vertexIndex] = addVectors(this.vertices[vertexIndex], offset);
    }
}
```

**Good:** the entry method does the work.

```ts
public moveFacesAlongNormal(faceIds: number[], distance: number): void {
    for (const faceId of faceIds) {
        const face = this.faces[faceId];
        const offset = scaleVector(face.normal, distance);
        for (const vertexIndex of face.vertexIndices) {
            this.vertices[vertexIndex] = addVectors(this.vertices[vertexIndex], offset);
        }
    }
}
```

**Bad:** nested conditions.

```ts
public scale(factor: number): void {
    if (factor !== 1) {
        if (this.vertices.length > 0) {
            this.vertices = this.vertices.map((vertex) => scaleVector(vertex, factor));
        }
    }
}
```

**Good:** early returns.

```ts
public scale(factor: number): void {
    if (factor === 1) {
        return;
    }
    if (this.vertices.length === 0) {
        return;
    }

    this.vertices = this.vertices.map((vertex) => scaleVector(vertex, factor));
}
```

---

## 4. Project structure

```
<repository>/
├── src/
│   ├── index.ts                  public API: everything the client may import
│   ├── <feature>/                for example math, geometry, mesh, scene, render
│   │   ├── services/             <name>.service.ts: classes with behavior
│   │   ├── utilities/            <name>.utility.ts: functions with no side effects
│   │   ├── interfaces/           <name>.interface.ts
│   │   ├── enums/                <name>.enum.ts
│   │   └── constants/            <name>.constant.ts
│   ├── common/                   shared by two or more features
│   │   └── services/  utilities/  interfaces/  enums/  constants/
│   └── tests/                    section 6
│       ├── services/
│       ├── utilities/
│       ├── mocks/
│       └── test-setup.ts
├── .editorconfig
├── package.json
├── tsconfig.json
└── STANDARD.md
```

| Suffix | Holds |
|---|---|
| `.service.ts` | a class with behavior |
| `.utility.ts` | utility functions |
| `.interface.ts` | interfaces and type aliases |
| `.enum.ts` | an enum |
| `.constant.ts` | constants |
| `.mock.ts` | a test mock |

- Code used by one feature lives in that feature's folder. Code used by two or more features lives in `common/`.
- There is no `helpers/` folder. A helper is either a utility or a method on a service.
- Add a new folder type only when none of the above fits.

### Path alias

There is one alias: `@core/*` points to `src/*`. Import through it, and use `./` only for a file in the same folder:

```ts
import {addVectors} from '@core/math/utilities/vector.utility';
import {createTriangleMeshMock} from '@core/tests/mocks/mesh.mock';
```

The build resolves the alias, so the published code contains none.

### Public API

- `src/index.ts` exports every class, function, interface, enum and constant the client may use. Nothing else is
  public.
- The client imports only the package name. It never reaches into `src/`.

```ts
// src/index.ts
export {Mesh} from '@core/mesh/services/mesh.service';
export {Scene} from '@core/scene/services/scene.service';
export {Renderer} from '@core/render/services/renderer.service';
export {createCube} from '@core/geometry/utilities/primitive.utility';
export type {IVector3} from '@core/math/interfaces/vector.interface';
```

---

## 5. Layers

### Services

Services hold all the logic and processes. A service is a class with behavior, such as `Scene`, `Mesh` or `Renderer`.

- The client creates the instances and keeps them. Each instance carries its own data.
- A class receives everything it needs through its constructor. There is no dependency injection.
- There is no state outside instances:
    - no module-level variables
    - no singletons
    - no static mutable fields
    - no caches shared between instances
- Services own every boundary call: the GPU, Web Workers and third-party libraries.
- A service may call another service's methods. The 2-hop rule still applies.

```ts
import {Mesh} from '@core/mesh/services/mesh.service';

export class Scene {
    public meshes: Mesh[] = [];

    public add(mesh: Mesh): Mesh {
        this.meshes = [...this.meshes, mesh];
        return mesh;
    }

    public remove(meshId: string): void {
        this.meshes = this.meshes.filter((mesh) => mesh.id !== meshId);
    }
}
```

A class that needs a boundary gets it through its constructor:

```ts
export class Renderer {
    private readonly context: WebGL2RenderingContext;

    constructor(context: WebGL2RenderingContext) {
        this.context = context;
    }
}
```

**Bad:** state outside instances.

```ts
let activeScene: Scene | null = null;

export function setActiveScene(scene: Scene): void {
    activeScene = scene;
}
```

### Utilities

- Utilities are exported functions with no side effects. They never mutate their arguments and never touch a
  boundary.
- Building and returning a new value or instance is fine. For example, `createCube()` returns a new `Mesh`.
- Use one file per topic: `utilities/<topic>.utility.ts`.

```ts
// math/utilities/vector.utility.ts
export function addVectors(first: IVector3, second: IVector3): IVector3 {
    return {x: first.x + second.x, y: first.y + second.y, z: first.z + second.z};
}

export function scaleVector(vector: IVector3, factor: number): IVector3 {
    return {x: vector.x * factor, y: vector.y * factor, z: vector.z * factor};
}
```

### Data shapes

| Kind | Where it lives | Notes |
|---|---|---|
| Interfaces and type aliases | `interfaces/<name>.interface.ts` | No `Interface` suffix on the name: `IFace`, not `IFaceInterface`. |
| Enums | `enums/<name>.enum.ts` | |
| Constants | `constants/<name>.constant.ts` | |

```ts
// math/interfaces/vector.interface.ts
export interface IVector3 {
    x: number;
    y: number;
    z: number;
}

export type TAxis = 'x' | 'y' | 'z';

// mesh/interfaces/face.interface.ts
export interface IFace {
    vertexIndices: number[];
    normal: IVector3;
}

// render/enums/shading-mode.enum.ts
export enum EShadingMode {
    Flat = 'flat',
    Smooth = 'smooth',
}

// mesh/constants/subdivision.constant.ts
export const MAX_SUBDIVISION_LEVEL = 6;
```

### What this library never has

- UI or a framework
- dependency injection
- a state store, or data-holder classes with no behavior
- state outside instances
- environment files

---

## 6. Tests

- Services and utilities get unit tests. Together they hold all the code with logic.
- Specs live under `src/tests/`, grouped by layer, never next to the source:
    - `src/tests/services/<name>.service.spec.ts`
    - `src/tests/utilities/<name>.utility.spec.ts`
- Because these folders are flat, every service and utility file name is unique across the library. Use
  `mesh-subdivision.service.ts`, not `subdivision.service.ts` in two features.
- Shared mocks live in `src/tests/mocks/<name>.mock.ts` and are imported through `@core/tests/mocks/…`.
- A mock of a class is a function that returns a fresh instance, so one test can never change another test's data.
- Test setup lives in `src/tests/test-setup.ts`.
- A service spec exercises each public method. A utility spec exercises each exported function. Mock every boundary.
- The runner is Vitest. It runs `src/tests/**/*.spec.ts`, and the build excludes `src/tests/**`.

```ts
// src/tests/mocks/mesh.mock.ts
import {Mesh} from '@core/mesh/services/mesh.service';

export function createTriangleMeshMock(): Mesh {
    return new Mesh(
        'triangle',
        [
            {x: 0, y: 0, z: 0},
            {x: 1, y: 0, z: 0},
            {x: 0, y: 1, z: 0},
        ],
        [{vertexIndices: [0, 1, 2], normal: {x: 0, y: 0, z: 1}}]
    );
}
```

```ts
// src/tests/services/mesh.service.spec.ts
import {createTriangleMeshMock} from '@core/tests/mocks/mesh.mock';

describe('Mesh', () => {
    it('moves every vertex by the offset', () => {
        const mesh = createTriangleMeshMock();

        mesh.translate({x: 1, y: 0, z: 0});

        expect(mesh.vertices).toEqual([
            {x: 1, y: 0, z: 0},
            {x: 2, y: 0, z: 0},
            {x: 1, y: 1, z: 0},
        ]);
    });
});
```
