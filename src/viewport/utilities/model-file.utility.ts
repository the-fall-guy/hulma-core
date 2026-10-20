import {RESOURCE_FILE_EXTENSIONS, SUPPORTED_MODEL_EXTENSIONS} from '@core/viewport/constants/model-file.constant';

export function getFileExtension(fileName: string): string {
    const dotIndex = fileName.lastIndexOf('.');
    if (dotIndex === -1) {
        return '';
    }

    return fileName.slice(dotIndex + 1).toLowerCase();
}

export function groupDroppedFiles(
    files: File[]
): {modelFiles: File[]; resourceFiles: File[]; unsupportedFiles: File[]} {
    const modelFiles: File[] = [];
    const resourceFiles: File[] = [];
    const unsupportedFiles: File[] = [];

    for (const file of files) {
        const extension = getFileExtension(file.name);
        if (SUPPORTED_MODEL_EXTENSIONS.includes(extension)) {
            modelFiles.push(file);
            continue;
        }
        if (RESOURCE_FILE_EXTENSIONS.includes(extension)) {
            resourceFiles.push(file);
            continue;
        }
        unsupportedFiles.push(file);
    }

    return {modelFiles, resourceFiles, unsupportedFiles};
}

/**
 * Tells whether the start of a PLY file declares binary little-endian data. Babylon's PLY reader never looks at the
 * format line and decodes every file as little-endian binary, so an ASCII or big-endian file hangs or misparses.
 * Only the lines before `end_header` count, and a header the caller cut off early is read as far as it goes.
 */
export function isLittleEndianPlyHeader(header: string): boolean {
    const lines = header.split(/\r?\n/).map((line) => line.trim());
    if (lines[0] !== 'ply') {
        return false;
    }

    const endIndex = lines.indexOf('end_header');
    const headerLines = endIndex === -1 ? lines : lines.slice(0, endIndex);

    return headerLines.some((line) => /^format\s+binary_little_endian(\s|$)/.test(line));
}
