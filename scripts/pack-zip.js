import fs from 'fs';
import path from 'path';

import JSZip from 'jszip';

const sourceDir = path.resolve('dist_chrome');
const zipPath = path.resolve('deepseek_voyager.zip');

async function pack() {
  const zip = new JSZip();

  function addFilesRecursively(dir, zipNode) {
    const items = fs.readdirSync(dir);
    for (const item of items) {
      const fullPath = path.join(dir, item);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        const folder = zipNode.folder(item);
        addFilesRecursively(fullPath, folder);
      } else {
        const content = fs.readFileSync(fullPath);
        zipNode.file(item, content);
      }
    }
  }

  console.log(`[Pack] Packing files from ${sourceDir}...`);
  addFilesRecursively(sourceDir, zip);

  console.log(`[Pack] Generating zip archive...`);
  const content = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  });

  fs.writeFileSync(zipPath, content);
  console.log(`[Pack] Zip file successfully created at ${zipPath}`);
}

pack().catch((err) => {
  console.error('[Pack] Failed to create zip:', err);
  process.exit(1);
});
