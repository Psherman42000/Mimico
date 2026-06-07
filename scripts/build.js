/**
 * Build script for Mimico - handles winCodeSign symlink issue on Windows
 */

const { build } = require('electron-builder');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

async function main() {
  console.log('🔨 Building Mimico...');

  // Pre-extract winCodeSign cache if needed
  const cacheDir = path.join(
    process.env.LOCALAPPDATA || path.join(require('os').homedir(), 'AppData', 'Local'),
    'electron-builder', 'Cache', 'winCodeSign'
  );

  // Ensure cache directory exists
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }

  // Find any .7z files that haven't been extracted yet
  const files = fs.readdirSync(cacheDir);
  for (const file of files) {
    if (file.endsWith('.7z')) {
      const dirName = file.replace('.7z', '');
      const extractDir = path.join(cacheDir, dirName);
      
      // Only extract if the directory doesn't exist or is empty
      if (!fs.existsSync(extractDir) || fs.readdirSync(extractDir).length === 0) {
        console.log(`📦 Extracting ${file}...`);
        try {
          const sevenZip = path.join(process.cwd(), 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe');
          execSync(`"${sevenZip}" x -bd "${path.join(cacheDir, file)}" -o"${extractDir}" -y`, {
            stdio: 'inherit',
            timeout: 60000,
          });
        } catch (e) {
          // Expected: symlink errors for darwin files (exit code 2)
          console.log('  ⚠️  Symlink errors (ignored) - continuing...');
        }
      }
    }
  }

  // Now run electron-builder
  console.log('🚀 Running electron-builder...');
  
  try {
    await build({
      win: ['portable'],
      x64: true,
      publish: 'never',
      config: {
        win: {
          icon: 'assets/icon.ico',
        },
      },
    });
    console.log('✅ Build complete!');
  } catch (err) {
    console.error('❌ Build failed:', err.message);
    process.exit(1);
  }
}

main();
