// Generate a minimal Mimico icon (16x16 PNG)
// Run: node scripts/generate-icon.js

const fs = require('fs');
const path = require('path');

// Minimal PNG: 16x16 green circle on transparent background
function createMinimalPNG() {
  // We'll create a minimal valid PNG with a simple green dot
  // This is a hand-crafted minimal PNG (16x16 RGBA)
  
  const width = 32;
  const height = 32;
  
  // Create raw pixel data (RGBA)
  const pixels = Buffer.alloc(width * height * 4, 0);
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cx = x - width/2;
      const cy = y - height/2;
      const dist = Math.sqrt(cx*cx + cy*cy);
      const radius = 12;
      
      if (dist < radius) {
        const idx = (y * width + x) * 4;
        // Gradient from green center to darker edge
        const brightness = 1 - (dist / radius) * 0.3;
        pixels[idx] = Math.floor(74 * brightness);     // R
        pixels[idx + 1] = Math.floor(222 * brightness); // G
        pixels[idx + 2] = Math.floor(128 * brightness); // B
        pixels[idx + 3] = 255; // A
      }
    }
  }
  
  // Create PNG manually (uncompressed for simplicity)
  // PNG structure: signature + IHDR + IDAT + IEND
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  
  // IHDR chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);   // width
  ihdrData.writeUInt32BE(height, 4);  // height
  ihdrData[8] = 8;    // bit depth
  ihdrData[9] = 6;    // color type (RGBA)
  ihdrData[10] = 0;   // compression
  ihdrData[11] = 0;   // filter
  ihdrData[12] = 0;   // interlace
  
  const ihdr = createChunk('IHDR', ihdrData);
  
  // Raw image data with filter byte (0 = None) per row
  const rawData = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    rawData[y * (1 + width * 4)] = 0; // filter byte
    pixels.copy(rawData, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4);
  }
  
  // Deflate (zlib compress) the raw data
  const zlib = require('zlib');
  const compressed = zlib.deflateSync(rawData);
  const idat = createChunk('IDAT', compressed);
  
  // IEND chunk
  const iend = createChunk('IEND', Buffer.alloc(0));
  
  return Buffer.concat([signature, ihdr, idat, iend]);
}

function createChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  
  const typeBuffer = Buffer.from(type, 'ascii');
  const crcData = Buffer.concat([typeBuffer, data]);
  
  // CRC32
  const crc = crc32(crcData);
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc, 0);
  
  return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}

function crc32(data) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) {
      if (crc & 1) {
        crc = (crc >>> 1) ^ 0xEDB88320;
      } else {
        crc = crc >>> 1;
      }
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

const png = createMinimalPNG();
const outputPath = path.join(__dirname, '..', 'resources', 'icon.png');
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, png);
console.log('Icon created:', outputPath, `(${png.length} bytes)`);
