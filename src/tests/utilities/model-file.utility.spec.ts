import {
    getFileExtension,
    groupDroppedFiles,
    isLittleEndianPlyHeader
} from '@core/viewport/utilities/model-file.utility';

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

    describe('PLY headers', () => {
        function createHeader(formatLine: string | null, lineEnding = '\n'): string {
            const lines = ['ply', formatLine, 'element vertex 3', 'property float x', 'end_header', '0 0 0'];

            return lines.filter((line) => line !== null).join(lineEnding);
        }

        it('accepts binary little-endian data', () => {
            expect(isLittleEndianPlyHeader(createHeader('format binary_little_endian 1.0'))).toBe(true);
        });

        it('refuses ASCII data', () => {
            expect(isLittleEndianPlyHeader(createHeader('format ascii 1.0'))).toBe(false);
        });

        it('refuses big-endian data', () => {
            expect(isLittleEndianPlyHeader(createHeader('format binary_big_endian 1.0'))).toBe(false);
        });

        it('refuses a header with no format line', () => {
            expect(isLittleEndianPlyHeader(createHeader(null))).toBe(false);
        });

        it('reads a header whose lines end in carriage returns', () => {
            expect(isLittleEndianPlyHeader(createHeader('format binary_little_endian 1.0', '\r\n'))).toBe(true);
            expect(isLittleEndianPlyHeader(createHeader('format ascii 1.0', '\r\n'))).toBe(false);
        });

        it('reads a format line that comes after other lines of the header', () => {
            const lines = ['ply', 'comment made by hand', 'obj_info scanned', 'format binary_little_endian 1.0'];

            expect(isLittleEndianPlyHeader([...lines, 'end_header', ''].join('\n'))).toBe(true);
        });

        it('ignores a comment that names a format', () => {
            const lines = ['ply', 'comment format binary_little_endian 1.0', 'format ascii 1.0', 'end_header', ''];

            expect(isLittleEndianPlyHeader(lines.join('\n'))).toBe(false);
        });

        it('ignores whatever comes after the end of the header', () => {
            const lines = ['ply', 'format ascii 1.0', 'end_header', 'format binary_little_endian 1.0', ''];

            expect(isLittleEndianPlyHeader(lines.join('\n'))).toBe(false);
        });

        it('reads a header that the caller cut off before its end', () => {
            const lines = ['ply', 'format binary_little_endian 1.0', 'element vertex 3', 'property fl'];

            expect(isLittleEndianPlyHeader(lines.join('\n'))).toBe(true);
        });

        it('refuses what does not start with the ply magic line', () => {
            expect(isLittleEndianPlyHeader('')).toBe(false);
            expect(isLittleEndianPlyHeader('format binary_little_endian 1.0\nend_header\n')).toBe(false);
            expect(isLittleEndianPlyHeader('solid cube\nformat binary_little_endian 1.0\nend_header\n')).toBe(false);
        });
    });
});
