import fs from 'fs';
import { decodePngToBinary, encodeBinaryToPng } from '../dist/index.js';

async function testMarkerSystem() {
  console.log('=== Test du système de marqueurs obligatoires ===\n');

  const testText = 'Hello, this is a test message with markers!';
  const inputBuffer = Buffer.from(testText, 'utf8');

  console.log('[Encodage]');
  console.log("Texte d'entrée:", testText);
  console.log('Longueur:', inputBuffer.length, 'octets\n');

  const pngBuffer = await encodeBinaryToPng(inputBuffer, {
    mode: 'screenshot',
    name: 'test.txt',
    compression: 'br',
    brQuality: 1,
  });

  console.log('PNG généré:', pngBuffer.length, 'octets');

  fs.writeFileSync('test-with-markers.png', pngBuffer);
  console.log('Image sauvegardée: test-with-markers.png\n');

  console.log('[Décodage]');
  const result = await decodePngToBinary(pngBuffer);

  const decodedText = result.buf.toString('utf8');
  console.log('Texte décodé:', decodedText);
  console.log('Nom du fichier:', result.meta?.name);

  if (decodedText === testText) {
    console.log("\n✓ Test réussi: le texte décodé est identique à l'entrée");
  } else {
    console.log('\n✗ Test échoué: le texte ne correspond pas');
    console.log('Attendu:', testText);
    console.log('Obtenu:', decodedText);
    process.exit(1);
  }

  console.log('\n=== Test de refus sans marqueurs ===\n');

  try {
    const oldPngBuffer = fs.readFileSync('test-old-format.png');
    await decodePngToBinary(oldPngBuffer);
    console.log(
      "✗ Erreur: l'ancien format a été accepté alors qu'il devrait être rejeté",
    );
    process.exit(1);
  } catch (err) {
    if (
      err.message.includes('Marker') &&
      (err.message.includes('not found') ||
        err.message.includes('not supported'))
    ) {
      console.log('✓ Ancien format correctement rejeté:', err.message);
    } else {
      console.log('✗ Erreur inattendue:', err.message);
      process.exit(1);
    }
  }

  console.log('\n=== Tous les tests sont passés ===');
}

testMarkerSystem().catch((err) => {
  console.error('Erreur:', err);
  process.exit(1);
});

