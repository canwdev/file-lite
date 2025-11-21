const sharp = require('sharp');
const toIco = require('to-ico');
const fs = require('fs');
const path = require('path');

const svgPath = path.join(__dirname, '../../frontend/public/favicon.svg');
const icoPath = path.join(__dirname, '../icon.ico');

const sizes = [16, 32, 48, 64, 128, 256];

async function generateIcon() {
    try {
        console.log(`Reading SVG from ${svgPath}...`);
        const svgBuffer = fs.readFileSync(svgPath);

        console.log('Generating PNG buffers...');
        const pngBuffers = await Promise.all(
            sizes.map(size =>
                sharp(svgBuffer)
                    .resize(size, size)
                    .png()
                    .toBuffer()
            )
        );

        console.log('Converting to ICO...');
        const icoBuffer = await toIco(pngBuffers);

        console.log(`Writing ICO to ${icoPath}...`);
        fs.writeFileSync(icoPath, icoBuffer);

        console.log('Done!');
    } catch (error) {
        console.error('Error generating icon:', error);
        process.exit(1);
    }
}

generateIcon();
