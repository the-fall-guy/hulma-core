import fs from 'node:fs';
import path from 'node:path';

const distFolder = path.resolve(import.meta.dirname, '../dist');
const entries = fs.readdirSync(distFolder, {recursive: true, withFileTypes: true});
const aliasPaths = [];

for (const entry of entries) {
    const isCodeFile = entry.name.endsWith('.js') || entry.name.endsWith('.d.ts');
    if (!entry.isFile() || !isCodeFile) {
        continue;
    }

    const filePath = path.join(entry.parentPath, entry.name);
    if (fs.readFileSync(filePath, 'utf8').includes('@core/')) {
        aliasPaths.push(path.relative(distFolder, filePath));
    }
}

for (const aliasPath of aliasPaths) {
    console.error(`Alias left in ${aliasPath}`);
}
if (aliasPaths.length > 0) {
    process.exit(1);
}

console.log('dist has no @core/ alias');
