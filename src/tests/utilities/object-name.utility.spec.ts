import {createUniqueObjectName, getObjectNameFromFileName} from '@core/viewport/utilities/object-name.utility';

describe('object name utility', () => {
    it('keeps a name nobody uses', () => {
        expect(createUniqueObjectName('model', [])).toBe('model');
        expect(createUniqueObjectName('model', ['other'])).toBe('model');
    });

    it('adds .001 to a name that is taken', () => {
        expect(createUniqueObjectName('model', ['model'])).toBe('model.001');
    });

    it('counts up past the suffixes that are taken', () => {
        expect(createUniqueObjectName('model', ['model', 'model.001'])).toBe('model.002');
    });

    it('continues from the suffix of a name that is taken', () => {
        expect(createUniqueObjectName('model.001', ['model', 'model.001'])).toBe('model.002');
        expect(createUniqueObjectName('model.005', ['model.005'])).toBe('model.006');
    });

    it('fills the first free number', () => {
        expect(createUniqueObjectName('model', ['model', 'model.002'])).toBe('model.001');
    });

    it('keeps a suffixed name that is free', () => {
        expect(createUniqueObjectName('model.007', ['model'])).toBe('model.007');
    });

    it('treats only digits after the last dot as a suffix', () => {
        expect(createUniqueObjectName('mossy.stone', ['mossy.stone'])).toBe('mossy.stone.001');
    });

    it('uses the file name without its last extension as the object name', () => {
        expect(getObjectNameFromFileName('model.glb')).toBe('model');
        expect(getObjectNameFromFileName('mossy-stone.final.glb')).toBe('mossy-stone.final');
    });

    it('keeps a file name that has no extension', () => {
        expect(getObjectNameFromFileName('model')).toBe('model');
        expect(getObjectNameFromFileName('.hidden')).toBe('.hidden');
    });
});
