const fs = require('fs');
const path = require('path');

async function copyDir(src, dest) {
  await fs.promises.mkdir(dest, { recursive: true });
  const entries = await fs.promises.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else if (entry.isSymbolicLink()) {
      const link = await fs.promises.readlink(srcPath);
      try {
        await fs.promises.symlink(link, destPath);
      } catch (err) {
        await fs.promises.copyFile(srcPath, destPath);
      }
    } else {
      await fs.promises.copyFile(srcPath, destPath);
    }
  }
}

async function main() {
  try {
    const root = process.cwd();
    const dist = path.join(root, 'dist');
    const assetsSrc = path.join(root, 'assets');
    const assetsDest = path.join(dist, 'assets');
    const publicSrc = path.join(root, 'public');

    await fs.promises.mkdir(dist, { recursive: true });

    if (fs.existsSync(assetsSrc)) {
      console.log('Copying assets ->', assetsDest);
      await copyDir(assetsSrc, assetsDest);
    } else {
      console.warn('No assets/ directory to copy');
    }

    if (fs.existsSync(publicSrc)) {
      console.log('Copying public/* ->', dist);
      const entries = await fs.promises.readdir(publicSrc);
      for (const name of entries) {
        const srcPath = path.join(publicSrc, name);
        const destPath = path.join(dist, name);
        const stat = await fs.promises.stat(srcPath);
        if (stat.isDirectory()) {
          await copyDir(srcPath, destPath);
        } else {
          await fs.promises.copyFile(srcPath, destPath);
        }
      }
    } else {
      console.warn('No public/ directory to copy');
    }

    console.log('Static files copied to', dist);
  } catch (err) {
    console.error('Failed to copy static files:', err);
    process.exit(1);
  }
}

main();
