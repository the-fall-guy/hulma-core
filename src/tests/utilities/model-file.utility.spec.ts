import {getFileExtension, groupDroppedFiles} from '@core/viewport/utilities/model-file.utility';

describe('model file utility', () => {
    function createFiles(fileNames: string[]): File[] {
        return fileNames.map((fileName) => new File([], fileName));
    }

    it('reads the extension in lowercase, without the dot', () => {
        expect(getFileExtension('Model.GLB')).toBe('glb');
        expect(getFileExtension('mossy-stone.final.glb')).toBe('glb');
    });

    it('returns an empty extension when there is none', () => {
        expect(getFileExtension('README')).toBe('');
        expect(getFileExtension('archive.')).toBe('');
    });

    it('groups a drop into models, their resources and unsupported files', () => {
        const [modelA, binaryA, texture, unsupported, modelB, materialB] = createFiles([
            'a.glb',
            'a.bin',
            'tex.webp',
            'scene.usdz',
            'b.obj',
            'b.mtl',
        ]);

        const groups = groupDroppedFiles([modelA, binaryA, texture, unsupported, modelB, materialB]);

        expect(groups.modelFiles).toEqual([modelA, modelB]);
        expect(groups.resourceFiles).toEqual([binaryA, texture, materialB]);
        expect(groups.unsupportedFiles).toEqual([unsupported]);
    });

    it('groups files by extension whatever its case', () => {
        const [model, texture] = createFiles(['SCENE.GLTF', 'Albedo.PNG']);

        const groups = groupDroppedFiles([model, texture]);

        expect(groups.modelFiles).toEqual([model]);
        expect(groups.resourceFiles).toEqual([texture]);
        expect(groups.unsupportedFiles).toEqual([]);
    });

    it('groups every supported model format as a model', () => {
        const files = createFiles(['a.glb', 'b.gltf', 'c.obj', 'd.fbx', 'e.stl', 'f.ply']);

        expect(groupDroppedFiles(files).modelFiles).toEqual(files);
    });

    it('treats a file with no extension as unsupported', () => {
        const [file] = createFiles(['README']);

        expect(groupDroppedFiles([file]).unsupportedFiles).toEqual([file]);
    });
});
