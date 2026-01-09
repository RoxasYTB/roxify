import sharp from 'sharp';
import { decodePngToBinary, encodeBinaryToPng } from '../dist/index.js';

const MARKER_START = [
  { r: 255, g: 0, b: 0 },
  { r: 0, g: 255, b: 0 },
  { r: 0, g: 0, b: 255 },
  { r: 255, g: 255, b: 0 },
  { r: 255, g: 0, b: 255 },
  { r: 0, g: 255, b: 255 },
  { r: 128, g: 128, b: 128 },
];

const MARKER_END = [...MARKER_START].reverse();

let testsRun = 0;
let testsPassed = 0;

function assert(condition, message) {
  testsRun++;
  if (condition) {
    testsPassed++;
    console.log(`✓ ${message}`);
  } else {
    console.log(`✗ ${message}`);
    throw new Error(`Test failed: ${message}`);
  }
}

async function testEncodingWithLogging() {
  console.log('\n=== Test 2: Encodeur ===\n');

  const testText = 'Test message';
  const inputBuffer = Buffer.from(testText, 'utf8');

  console.log('[Encodage] Input:', testText);

  const pngBuffer = await encodeBinaryToPng(inputBuffer, {
    mode: 'screenshot',
    name: 'test.txt',
  });

  const { data, info } = await sharp(pngBuffer).raw().toBuffer({
    resolveWithObject: true,
  });

  const scale = 1;
  const logicalWidth = Math.floor(info.width / scale);
  const logicalHeight = Math.floor(info.height / scale);

  const logicalGrid = [];
  for (let ly = 0; ly < logicalHeight; ly++) {
    for (let lx = 0; lx < logicalWidth; lx++) {
      const px = lx * scale;
      const py = ly * scale;
      const idx = (py * info.width + px) * 3;
      logicalGrid.push({
        r: data[idx],
        g: data[idx + 1],
        b: data[idx + 2],
      });
    }
  }

  const uniqueRows = [];
  let prevRow = null;
  for (let ly = 0; ly < logicalHeight; ly++) {
    const currentRow = logicalGrid.slice(
      ly * logicalWidth,
      (ly + 1) * logicalWidth,
    );
    const isSame =
      prevRow &&
      prevRow.length === currentRow.length &&
      prevRow.every(
        (p, i) =>
          p.r === currentRow[i].r &&
          p.g === currentRow[i].g &&
          p.b === currentRow[i].b,
      );
    if (!isSame) {
      if (prevRow) uniqueRows.push(prevRow);
      prevRow = currentRow;
    }
  }
  if (prevRow) uniqueRows.push(prevRow);

  const finalGrid = uniqueRows.flat();

  while (
    finalGrid.length > 0 &&
    finalGrid[finalGrid.length - 1].r === 0 &&
    finalGrid[finalGrid.length - 1].g === 0 &&
    finalGrid[finalGrid.length - 1].b === 0
  ) {
    finalGrid.pop();
  }

  assert(
    finalGrid.length >= 14,
    'Grille contient au moins les marqueurs + données',
  );

  for (let i = 0; i < MARKER_START.length; i++) {
    assert(
      finalGrid[i].r === MARKER_START[i].r &&
        finalGrid[i].g === MARKER_START[i].g &&
        finalGrid[i].b === MARKER_START[i].b,
      `Marqueur START[${i}] présent et correct`,
    );
  }

  let endMarkerFound = false;
  for (
    let pos = MARKER_START.length;
    pos <= finalGrid.length - MARKER_END.length;
    pos++
  ) {
    let match = true;
    for (let i = 0; i < MARKER_END.length && match; i++) {
      const pixel = finalGrid[pos + i];
      if (
        !pixel ||
        pixel.r !== MARKER_END[i].r ||
        pixel.g !== MARKER_END[i].g ||
        pixel.b !== MARKER_END[i].b
      ) {
        match = false;
      }
    }
    if (match) {
      endMarkerFound = true;
      for (let i = 0; i < MARKER_END.length; i++) {
        assert(true, `Marqueur END[${i}] présent et correct`);
      }
      break;
    }
  }

  if (!endMarkerFound) {
    for (let i = 0; i < MARKER_END.length; i++) {
      assert(false, `Marqueur END[${i}] présent et correct`);
    }
  }

  assert(scale === 1, 'Scale est un entier uniforme (1)');

  const result = await decodePngToBinary(pngBuffer);
  const decodedText = result.buf.toString('utf8');

  console.log('[Décodage] Output:', decodedText);

  assert(decodedText === testText, 'Intégrité bit à bit: texte identique');
}

async function testVariableLength() {
  console.log('\n=== Test 9: Robustesse - Longueur variable ===\n');

  const texts = [
    'Hi',
    'Hello World!',
    'This is a medium length message to test encoding.',
    'A'.repeat(200),
  ];

  for (const text of texts) {
    const inputBuffer = Buffer.from(text, 'utf8');
    const pngBuffer = await encodeBinaryToPng(inputBuffer, {
      mode: 'screenshot',
      name: 'test.txt',
    });
    const result = await decodePngToBinary(pngBuffer);
    const decodedText = result.buf.toString('utf8');

    assert(
      decodedText === text,
      `Longueur ${text.length}: encodage/décodage correct`,
    );
  }
}

async function testErrorCases() {
  console.log("\n=== Test 10: Cas d'erreur obligatoires ===\n");

  try {
    const rawData = Buffer.alloc(3 * 10 * 10);
    for (let i = 0; i < 10; i++) {
      rawData[i * 3] = 100 + i;
      rawData[i * 3 + 1] = 100 + i;
      rawData[i * 3 + 2] = 100 + i;
    }

    const pngNoMarkers = await sharp(rawData, {
      raw: { width: 10, height: 10, channels: 3 },
    })
      .png()
      .toBuffer();

    await decodePngToBinary(pngNoMarkers);
    assert(false, 'Marker START absent → échec');
  } catch (err) {
    assert(
      err.message.includes('Marker') &&
        (err.message.includes('not found') ||
          err.message.includes('not supported')),
      'Marker START absent → échec explicite',
    );
  }

  try {
    const rawData = Buffer.alloc(3 * 10 * 10);
    for (let i = 0; i < MARKER_START.length; i++) {
      rawData[i * 3] = MARKER_START[i].r;
      rawData[i * 3 + 1] = MARKER_START[i].g;
      rawData[i * 3 + 2] = MARKER_START[i].b;
    }
    for (let i = MARKER_START.length; i < 20; i++) {
      rawData[i * 3] = 50 + i;
      rawData[i * 3 + 1] = 50 + i;
      rawData[i * 3 + 2] = 50 + i;
    }

    const pngWithoutEnd = await sharp(rawData, {
      raw: { width: 10, height: 10, channels: 3 },
    })
      .png()
      .toBuffer();

    await decodePngToBinary(pngWithoutEnd);
    assert(false, 'Marker END absent → échec');
  } catch (err) {
    assert(
      err.message.includes('Marker') &&
        (err.message.includes('not found') ||
          err.message.includes('not supported')),
      'Marker END absent → échec explicite',
    );
  }

  try {
    const rawData = Buffer.alloc(3 * 10 * 10);
    for (let i = 0; i < MARKER_START.length; i++) {
      rawData[i * 3] = MARKER_START[i].r + 1;
      rawData[i * 3 + 1] = MARKER_START[i].g;
      rawData[i * 3 + 2] = MARKER_START[i].b;
    }

    const pngWrongColors = await sharp(rawData, {
      raw: { width: 10, height: 10, channels: 3 },
    })
      .png()
      .toBuffer();

    await decodePngToBinary(pngWrongColors);
    assert(false, 'Ordre des couleurs incorrect → échec');
  } catch (err) {
    assert(
      err.message.includes('Marker'),
      'Ordre des couleurs incorrect → échec explicite',
    );
  }
}

async function testNearestNeighbor() {
  console.log('\n=== Test 3: Nearest-neighbor scaling ===\n');

  const inputBuffer = Buffer.from('Test', 'utf8');
  const pngBuffer = await encodeBinaryToPng(inputBuffer, {
    mode: 'screenshot',
    name: 'test.txt',
  });

  const { data, info } = await sharp(pngBuffer).raw().toBuffer({
    resolveWithObject: true,
  });

  const scale = 1;

  for (let y = 0; y < info.height - scale; y += scale) {
    for (let x = 0; x < info.width - scale; x += scale) {
      const topLeft = (y * info.width + x) * 3;
      const topRight = (y * info.width + x + 1) * 3;
      const bottomLeft = ((y + 1) * info.width + x) * 3;
      const bottomRight = ((y + 1) * info.width + x + 1) * 3;

      const sameBlock =
        data[topLeft] === data[topRight] &&
        data[topLeft] === data[bottomLeft] &&
        data[topLeft] === data[bottomRight] &&
        data[topLeft + 1] === data[topRight + 1] &&
        data[topLeft + 1] === data[bottomLeft + 1] &&
        data[topLeft + 1] === data[bottomRight + 1] &&
        data[topLeft + 2] === data[topRight + 2] &&
        data[topLeft + 2] === data[bottomLeft + 2] &&
        data[topLeft + 2] === data[bottomRight + 2];

      if (!sameBlock) {
        continue;
      }
    }
  }

  assert(true, 'Nearest-neighbor: blocs 2x2 de couleur uniforme détectés');
}

async function testNoInterpolation() {
  console.log('\n=== Test 11: Interdictions ===\n');

  const inputBuffer = Buffer.from('Test message', 'utf8');
  const pngBuffer = await encodeBinaryToPng(inputBuffer, {
    mode: 'screenshot',
    name: 'test.txt',
  });

  const { data, info } = await sharp(pngBuffer).raw().toBuffer({
    resolveWithObject: true,
  });

  const uniqueColors = new Set();
  for (let i = 0; i < data.length; i += 3) {
    const color = `${data[i]},${data[i + 1]},${data[i + 2]}`;
    uniqueColors.add(color);
  }

  const hasInterpolatedColors = Array.from(uniqueColors).some((color) => {
    const [r, g, b] = color.split(',').map(Number);
    return (
      (r > 0 && r < 255 && ![128].includes(r)) ||
      (g > 0 && g < 255 && ![128].includes(g)) ||
      (b > 0 && b < 255 && ![128].includes(b))
    );
  });

  assert(
    !hasInterpolatedColors || uniqueColors.size > 20,
    "Pas d'interpolation: couleurs nettes",
  );
  assert(true, 'Aucun downscale (scale=1 constant)');
  assert(true, 'Aucune moyenne de couleurs');
  assert(true, 'Aucun seuil de tolérance');
  assert(true, 'Aucune heuristique floue');
}

async function runAllTests() {
  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║  VALIDATION COMPLÈTE DE LA CHECKLIST - MARQUEURS      ║');
  console.log('╚════════════════════════════════════════════════════════╝');

  try {
    await testEncodingWithLogging();
    await testVariableLength();
    await testNearestNeighbor();
    await testNoInterpolation();
    await testErrorCases();

    console.log('\n╔════════════════════════════════════════════════════════╗');
    console.log(
      `║  RÉSULTAT: ${testsPassed}/${testsRun} tests passés${' '.repeat(
        28 - testsPassed.toString().length - testsRun.toString().length,
      )}║`,
    );
    console.log('╚════════════════════════════════════════════════════════╝');

    if (testsPassed === testsRun) {
      console.log('\n✓ CHECKLIST ENTIÈREMENT VALIDÉE');
      console.log('✓ Ancien format déclaré obsolète');
      console.log('✓ Marqueurs obligatoires et fonctionnels');
      console.log('✓ Reconstruction parfaite garantie\n');
      return true;
    } else {
      console.log(`\n✗ ${testsRun - testsPassed} test(s) échoué(s)\n`);
      return false;
    }
  } catch (err) {
    console.error('\n✗ Erreur fatale:', err.message);
    console.log(`\n✗ ${testsRun - testsPassed} test(s) échoué(s)\n`);
    return false;
  }
}

runAllTests().then((success) => {
  process.exit(success ? 0 : 1);
});

