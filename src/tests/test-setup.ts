import {Logger} from '@babylonjs/core/Misc/logger';

// NullEngine prints its version banner through Logger.Log. Keep warnings and errors.
Logger.LogLevels = Logger.WarningLogLevel | Logger.ErrorLogLevel;

vi.mock('@babylonjs/core/Engines/engine', async () => {
    const {NullEngine} = await import('@babylonjs/core/Engines/nullEngine');
    return {
        Engine: class extends NullEngine {
            constructor() {
                super();
            }
        },
    };
});

vi.mock('@babylonjs/core/Materials/Textures/hdrCubeTexture', async () => {
    const {BaseTexture} = await import('@babylonjs/core/Materials/Textures/baseTexture');
    return {
        HDRCubeTexture: class extends BaseTexture {
            public readonly url: string;

            constructor(url: string, scene: unknown) {
                super(scene as never);
                this.url = url;
            }
        },
    };
});
