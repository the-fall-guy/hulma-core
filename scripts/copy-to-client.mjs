import fs from 'node:fs';
import path from 'node:path';

const coreFolder = path.resolve(import.meta.dirname, '..');
const clientFolder = path.resolve(import.meta.dirname, '../../hulma');
const modulesFolder = path.join(clientFolder, 'node_modules');
const targetFolder = path.join(modulesFolder, 'hulma-core');

if (!fs.existsSync(modulesFolder)) {
    console.error('Cannot link: ../hulma/node_modules not found. Run "npm install" in ../hulma first.');
    process.exit(1);
}

const packagePath = path.join(coreFolder, 'package.json');
const distFolder = path.join(coreFolder, 'dist');
const targetDistFolder = path.join(targetFolder, 'dist');

// Read dist before touching the target, so a missing build fails with nothing created.
const distPaths = fs.readdirSync(distFolder, {recursive: true});
const distFiles = distPaths.filter((relativePath) => fs.statSync(path.join(distFolder, relativePath)).isFile());

// Overwrite in place and never delete the target folder first: the dev server watches these files.
fs.mkdirSync(targetFolder, {recursive: true});
fs.cpSync(packagePath, path.join(targetFolder, 'package.json'));
fs.cpSync(distFolder, targetDistFolder, {recursive: true});

for (const relativePath of fs.readdirSync(targetDistFolder, {recursive: true})) {
    if (!distPaths.includes(relativePath)) {
        fs.rmSync(path.join(targetDistFolder, relativePath), {recursive: true, force: true});
    }
}
for (const entryName of fs.readdirSync(targetFolder)) {
    if (entryName !== 'package.json' && entryName !== 'dist') {
        fs.rmSync(path.join(targetFolder, entryName), {recursive: true, force: true});
    }
}

const {version} = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const fileCount = distFiles.length + 1;

console.log(`Linked hulma-core ${version} into ../hulma/node_modules/hulma-core (${fileCount} files)`);
