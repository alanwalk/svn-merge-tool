const fs = require('fs');
const path = require('path');

function copyDirRecursive(srcDir, destDir) {
    fs.mkdirSync(destDir, { recursive: true });
    const entries = fs.readdirSync(srcDir, { withFileTypes: true });
    for (const entry of entries) {
        const srcPath = path.join(srcDir, entry.name);
        const destPath = path.join(destDir, entry.name);
        if (entry.isDirectory()) {
            copyDirRecursive(srcPath, destPath);
            continue;
        }
        fs.copyFileSync(srcPath, destPath);
    }
}

const projectRoot = path.resolve(__dirname, '..');
const srcUiDir = path.join(projectRoot, 'src', 'ui');
const distUiDir = path.join(projectRoot, 'dist', 'ui');

if (!fs.existsSync(srcUiDir)) {
    console.error('UI source directory not found:', srcUiDir);
    process.exit(1);
}

copyDirRecursive(srcUiDir, distUiDir);
console.log('Copied UI assets to', distUiDir);
