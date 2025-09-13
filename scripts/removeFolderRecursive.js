import fs from 'node:fs';

const folderToDelete = process.argv[2];

const folderPathToDelete = folderToDelete.split('/')[1];

function removeFolder(folder) {
  if (!folder) return;
  try {
    console.log(`> Deleting '${folder}'...`);
    fs.rm(folder, { recursive: true, force: true }, (err) => {
      if (err) console.error(`Failed to delete folder ${folder}:`, err);
      else console.log(`✅ Deleted ${folder}`);
    });
  } catch (error) {
    console.error(`> Error Deleting folder ${folder}, ${error}`);
  }
}

if (fs.existsSync(folderPathToDelete)) {
  removeFolder(folderPathToDelete);
}
