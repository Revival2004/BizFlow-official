const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const outputDir = path.resolve(projectRoot, process.argv[2] || 'dist');
const publicDir = path.resolve(projectRoot, 'public');

const copyIfPresent = (filename) => {
  const source = path.join(publicDir, filename);
  const destination = path.join(outputDir, filename);

  if (!fs.existsSync(source)) {
    return;
  }

  fs.copyFileSync(source, destination);
};

fs.mkdirSync(outputDir, { recursive: true });

copyIfPresent('404.html');
copyIfPresent('_redirects');
