import { exec } from 'child_process';
import fs from 'fs';
import { createRequire } from 'node:module';
import path from 'path';
import { fileURLToPath } from 'url';
import { applyEffects } from './audioEffects.js';
import { generateUniqueFileName } from './fileManager.js';
const require = createRequire(import.meta.url);
const voice = require(path.join(process.cwd(), 'voice-wrapper.cjs'));
const { AudioPlayerStatus, createAudioPlayer, createAudioResource } = voice;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let MsEdgeTTS = null;
let OUTPUT_FORMAT = null;
try {
  const msEdgeTTSModule = await import('msedge-tts');
  MsEdgeTTS =
    msEdgeTTSModule.MsEdgeTTS ||
    (msEdgeTTSModule.default && msEdgeTTSModule.default.MsEdgeTTS);
  OUTPUT_FORMAT =
    msEdgeTTSModule.OUTPUT_FORMAT ||
    (msEdgeTTSModule.default && msEdgeTTSModule.default.OUTPUT_FORMAT);
} catch {
  console.warn(
    'Module msedge-tts non disponible. Le TTSManager ne fonctionnera pas.',
  );
}

async function generateWithEdgeTTS(text, outputPath) {
  return new Promise((resolve, reject) => {
    const cmd = `edge-tts --voice fr-FR-VivienneMultilingualNeural --text "${text.replace(/"/g, '\\"')}" --write-media "${outputPath}"`;

    exec(cmd, (error, _stdout, _stderr) => {
      if (error) {
        console.log(
          '[Maexxna TTS] edge-tts CLI non disponible, tentative avec msedge-tts...',
        );
        reject(error);
      } else {
        console.log('[Maexxna TTS] Audio généré avec edge-tts CLI');
        resolve(outputPath);
      }
    });
  });
}

async function generateWithMsEdgeTTS(text, outputPath) {
  if (!MsEdgeTTS || !OUTPUT_FORMAT) {
    throw new Error("Le module msedge-tts n'est pas disponible.");
  }

  const tempDir = path.join(
    __dirname,
    '..',
    generateUniqueFileName('maexxna_audio_', '_msedge_temp'),
  );
  try {
    fs.mkdirSync(tempDir, { recursive: true });
  } catch (err) {
    console.warn(
      '[Maexxna TTS] Impossible de créer tempDir:',
      tempDir,
      err.message,
    );
    throw err;
  }

  const tts = new MsEdgeTTS();

  try {
    if (typeof tts.setMetadata === 'function') {
      await tts.setMetadata(
        'fr-FR-VivienneMultilingualNeural',
        OUTPUT_FORMAT && OUTPUT_FORMAT.WEBM_24KHZ_16BIT_MONO_OPUS ?
          OUTPUT_FORMAT.WEBM_24KHZ_16BIT_MONO_OPUS
        : OUTPUT_FORMAT,
      );
    }
  } catch (err) {
    console.warn('[Maexxna TTS] Warning setMetadata failed:', err.message);
  }

  console.log('[Maexxna TTS] Génération MSEdge dans :', tempDir);

  if (typeof tts.toFile === 'function') {
    try {
      await tts.toFile(tempDir, text);

      const files = fs.readdirSync(tempDir);
      console.log('[Maexxna TTS] Contenu du dossier temporaire:', files);

      const audioFile = files.find(
        (f) =>
          f.endsWith('.webm') ||
          f.endsWith('.mp3') ||
          f.endsWith('.wav') ||
          f.endsWith('.ogg'),
      );
      if (!audioFile) {
        throw new Error(`Aucun fichier audio trouvé dans ${tempDir}`);
      }

      const generatedPath = path.join(tempDir, audioFile);
      console.log('[Maexxna TTS] Fichier audio trouvé :', generatedPath);

      fs.copyFileSync(generatedPath, outputPath);

      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
        console.log('[Maexxna TTS] TempDir supprimé :', tempDir);
      } catch (cleanupErr) {
        console.warn(
          '[Maexxna TTS] Erreur cleanup tempDir:',
          cleanupErr.message,
        );
      }

      return outputPath;
    } catch (err) {
      console.error('[Maexxna TTS] Erreur generateWithMsEdgeTTS(toFile):', err);

      try {
        if (fs.existsSync(tempDir))
          fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {}
      throw err;
    }
  }

  if (typeof tts.toStream === 'function') {
    try {
      const stream = await tts.toStream(text);
      console.log(
        '[Maexxna TTS] toStream() retourné, écriture vers :',
        outputPath,
      );

      await new Promise((resolve, reject) => {
        const writeStream = fs.createWriteStream(outputPath);
        stream.pipe(writeStream);
        stream.on('error', (sErr) => {
          console.error('[Maexxna TTS] Erreur stream:', sErr.message);
          reject(sErr);
        });
        writeStream.on('finish', resolve);
        writeStream.on('error', (wErr) => {
          console.error('[Maexxna TTS] Erreur writeStream:', wErr.message);
          reject(wErr);
        });
      });

      return outputPath;
    } catch (err) {
      console.error(
        '[Maexxna TTS] Erreur generateWithMsEdgeTTS(toStream):',
        err.message,
      );

      try {
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
      } catch {}
      throw err;
    }
  }

  throw new Error('Le module msedge-tts ne propose ni toFile ni toStream.');
}

async function ttsResponse(connection, text) {
  let tempFilePath = null;
  let effectsFilePath = null;

  try {
    console.log('[Maexxna TTS] Initialisation...');

    tempFilePath = path.join(
      __dirname,
      '..',
      generateUniqueFileName('maexxna_audio', '.webm'),
    );

    effectsFilePath = tempFilePath;

    console.log('[Maexxna TTS] Génération audio...');

    try {
      await generateWithEdgeTTS(text, tempFilePath);
    } catch {
      console.log('[Maexxna TTS] Fallback vers msedge-tts module...');
      if (!MsEdgeTTS || !OUTPUT_FORMAT) {
        throw new Error('Aucun module TTS Maexxna disponible');
      }
      await generateWithMsEdgeTTS(text, tempFilePath);
    }

    console.log('[Maexxna TTS] Audio généré, vérification...');

    if (!fs.existsSync(tempFilePath)) {
      throw new Error(`Le fichier audio n'a pas été généré: ${tempFilePath}`);
    }

    const stats = fs.statSync(tempFilePath);
    if (stats.size === 0) {
      throw new Error(`Le fichier audio est vide: ${tempFilePath}`);
    }

    console.log(
      `[Maexxna TTS] Fichier audio valide (${stats.size} bytes), application des effets...`,
    );

    console.log(
      '[Maexxna TTS] Application des effets (in-place) sur :',
      tempFilePath,
    );
    await applyEffects(tempFilePath, effectsFilePath);

    if (!fs.existsSync(effectsFilePath)) {
      throw new Error(
        `Le fichier après effets est introuvable: ${effectsFilePath}`,
      );
    }
    const statsAfter = fs.statSync(effectsFilePath);
    if (statsAfter.size === 0) {
      throw new Error(`Le fichier après effets est vide: ${effectsFilePath}`);
    }
    console.log('[Maexxna TTS] Effets appliqués, lecture...');

    const player = createAudioPlayer();
    const resource = createAudioResource(effectsFilePath);
    connection.subscribe(player);
    player.play(resource);

    player.on(AudioPlayerStatus.Idle, () => {
      player.stop();
      cleanupFiles(tempFilePath, effectsFilePath);
    });

    player.on('error', (error) => {
      console.error('[Maexxna TTS] Erreur de lecture:', error);
      cleanupFiles(tempFilePath, effectsFilePath);
    });

    console.log('[Maexxna TTS] Lecture démarrée');
  } catch (error) {
    console.error('[Maexxna TTS] Erreur lors de la génération TTS:', error);
    cleanupFiles(tempFilePath, effectsFilePath);
    throw error;
  }
}

async function generateMaexxnaFile(text, outputPath) {
  let tempFilePath = null;
  let effectsFilePath = null;

  try {
    console.log('[Maexxna File] Initialisation...');

    tempFilePath = path.join(
      __dirname,
      '..',
      generateUniqueFileName('maexxna_file', '.webm'),
    );

    effectsFilePath = tempFilePath;

    console.log('[Maexxna File] Génération audio...');

    try {
      await generateWithEdgeTTS(text, tempFilePath);
    } catch {
      console.log('[Maexxna File] Fallback vers msedge-tts module...');
      if (!MsEdgeTTS || !OUTPUT_FORMAT) {
        throw new Error('Aucun module TTS Maexxna disponible');
      }
      await generateWithMsEdgeTTS(text, tempFilePath);
    }

    console.log('[Maexxna File] Audio généré, vérification...');

    if (!fs.existsSync(tempFilePath)) {
      throw new Error(`Le fichier audio n'a pas été généré: ${tempFilePath}`);
    }

    const stats = fs.statSync(tempFilePath);
    if (stats.size === 0) {
      throw new Error(`Le fichier audio est vide: ${tempFilePath}`);
    }

    console.log(
      `[Maexxna File] Fichier audio valide (${stats.size} bytes), application des effets...`,
    );

    await applyEffects(tempFilePath, effectsFilePath);
    console.log('[Maexxna File] Effets appliqués, conversion en MP3...');

    await new Promise((resolve, reject) => {
      const convertCommand = `ffmpeg -i "${effectsFilePath}" "${outputPath}" -y`;
      exec(convertCommand, (error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });

    console.log('[Maexxna File] Fichier MP3 généré avec succès');

    cleanupFiles(tempFilePath, effectsFilePath);

    return outputPath;
  } catch (error) {
    console.error('[Maexxna File] Erreur lors de la génération TTS:', error);
    cleanupFiles(tempFilePath, effectsFilePath);
    throw error;
  }
}

function cleanupFiles(tempFilePath, effectsFilePath) {
  try {
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      try {
        fs.unlinkSync(tempFilePath);
        console.log('[Maexxna TTS] Fichier supprimé :', tempFilePath);
      } catch (e) {
        console.warn(
          '[Maexxna TTS] Impossible de supprimer tempFilePath:',
          tempFilePath,
          e.message,
        );
      }
    }
  } catch (e) {
    console.warn(
      '[Maexxna TTS] Erreur lors de la vérification de tempFilePath:',
      e.message,
    );
  }

  try {
    if (
      effectsFilePath &&
      effectsFilePath !== tempFilePath &&
      fs.existsSync(effectsFilePath)
    ) {
      try {
        fs.unlinkSync(effectsFilePath);
        console.log('[Maexxna TTS] Fichier effets supprimé :', effectsFilePath);
      } catch (e) {
        console.warn(
          '[Maexxna TTS] Impossible de supprimer effectsFilePath:',
          effectsFilePath,
          e.message,
        );
      }
    }
  } catch (e) {
    console.warn(
      '[Maexxna TTS] Erreur lors de la vérification de effectsFilePath:',
      e.message,
    );
  }

  if (tempFilePath) {
    const tempDir = tempFilePath.replace('.webm', '_msedge_temp');
    if (fs.existsSync(tempDir)) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
        console.log(
          '[Maexxna TTS] Dossier temporaire msedge-tts nettoyé :',
          tempDir,
        );
      } catch (error) {
        console.warn(
          '[Maexxna TTS] Erreur lors du nettoyage du dossier temporaire:',
          error.message,
        );
      }
    }
  }
}

export { generateMaexxnaFile, ttsResponse };

async function generateWithPiper(text, outputPath, options = {}) {
  const piperCmd =
    process.env.VOICE_PIPER_PATH || process.env.PIPER_PATH || 'piper';
  const modelName = options.modelName || null;
  const language = options.language || 'fr';
  let model, config;
  if (modelName === 'fortune') {
    model = 'fortune.onnx';
    config = 'fortune.onnx.json';
  } else if (modelName === 'emma') {
    model = 'emma.onnx';
    config = 'emma.onnx.json';
  } else {
    model = language === 'en' ? 'glados-en.onnx' : 'glados-fr.onnx';
    config = language === 'en' ? 'glados-en.onnx.json' : 'glados-fr.onnx.json';
  }

  let safeText = text
    .toLowerCase()
    .replace(/"/g, '"')
    .replaceAll('désire', 'veux')
    .replaceAll('ღ🌸~͓̽ǤŁa̠̠ĐØS~🌸ღ', 'gladosse')
    .replaceAll('glados', 'gladosse')
    .replaceAll('oxas', 'oxasse')
    .replace(/^(ca)(?![a-zàâäéèêëïîôöùûüçœæ])/iu, 'ça')
    .replace(/\bca\b/giu, 'ça')
    .replaceAll('bot', 'botte')
    .replaceAll('aperture science', 'apèreture saïhènsse')
    .replaceAll('refresh4ever', 'riz fraîche faux rêveur')
    .replaceAll('yame', 'yamé')
    .replace(/[\.\!?;:…‽]+/g, ',')
    .replace(',', ';,')
    .replaceAll('.', ' ')
    .replaceAll('_', '')
    .replaceAll(' ღ~~͓̽ǥłaa̠̠đøs~ღ', 'et moi')
    .replaceAll('karl', 'carrleu')
    .replaceAll('copilot', 'copilotte')
    .replaceAll('wiltark', 'weele taahrkk')
    .replaceAll('mer0de', 'meuraude');

  const modelsDir = path.join(__dirname, 'models');
  const utilsVoiceDir = path.join(process.cwd(), 'utils', 'voice', 'models');
  const candidateModelPaths = [
    path.join(modelsDir, model),
    path.join(utilsVoiceDir, model),
    path.join(process.cwd(), model),
    path.join(process.cwd(), '..', 'Glados-Voice', model),
    path.join(process.cwd(), '..', '..', 'Glados-Voice', model),
  ];
  const candidateConfigPaths = [
    path.join(modelsDir, config),
    path.join(utilsVoiceDir, config),
    path.join(process.cwd(), config),
    path.join(process.cwd(), '..', 'Glados-Voice', config),
    path.join(process.cwd(), '..', '..', 'Glados-Voice', config),
  ];

  const findExisting = (paths) => paths.find((p) => fs.existsSync(p));
  const modelPath = findExisting(candidateModelPaths);
  const configPath = findExisting(candidateConfigPaths);
  if (!modelPath || !configPath) {
    console.warn(
      '[PIPER TTS] Model or config not found, tried:',
      candidateModelPaths,
      candidateConfigPaths,
    );
    throw new Error('Piper model or config file not found');
  }

  const cmd = `echo "${safeText}" | ${piperCmd} --model "${modelPath}" --config "${configPath}" --output_file "${outputPath}"`;
  try {
    await new Promise((resolve, reject) => {
      const child = exec(cmd, (error) => {
        if (error) return reject(error);
        resolve(outputPath);
      });
      child.stdout?.on('data', () => {});
      child.stderr?.on('data', () => {});
    });

    return outputPath;
  } catch (error) {
    console.error(
      '[PIPER TTS] Erreur lors de la génération Piper TTS:',
      error.message,
    );
    throw error;
  }
}

export { generateWithPiper };

