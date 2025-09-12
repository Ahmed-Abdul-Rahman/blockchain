import fs from 'node:fs';

const folderToDelete = process.argv[2];

function removeFolder(folder) {
  if (!folder) return;
  try {
    console.log(`> Deleting '${folder}'...`);
    fs.rm(folder);
  } catch (error) {
    console.error(`Error Deleting folder ${folder}, ${error}`);
  }
}

if (fs.existsSync(folderToDelete)) {
  removeFolder(folderToDelete);
}
