export function getObjectNameFromFileName(fileName: string): string {
    const dotIndex = fileName.lastIndexOf('.');

    // A dot at the very start belongs to a hidden file's name, not to an extension.
    return dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
}

export function createUniqueObjectName(name: string, existingNames: string[]): string {
    if (!existingNames.includes(name)) {
        return name;
    }

    // Blender counts on from the number a name already ends with, so model.001 becomes model.002.
    const numbered = /^(.*)\.(\d{1,9})$/.exec(name);
    const baseName = numbered ? numbered[1] : name;
    let number = numbered ? Number(numbered[2]) : 0;
    let candidate: string;
    do {
        number++;
        candidate = `${baseName}.${String(number).padStart(3, '0')}`;
    } while (existingNames.includes(candidate));

    return candidate;
}
