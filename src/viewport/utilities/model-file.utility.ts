import {RESOURCE_FILE_EXTENSIONS, SUPPORTED_MODEL_EXTENSIONS} from '@core/viewport/constants/model-file.constant';

export function getFileExtension(fileName: string): string {
    const dotIndex = fileName.lastIndexOf('.');
    if (dotIndex === -1) {
        return '';
    }

    return fileName.slice(dotIndex + 1).toLowerCase();
}

export function groupDroppedFiles(files: File[]): {modelFiles: File[]; resourceFiles: File[]; unsupportedFiles: File[]} {
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
