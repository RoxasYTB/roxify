import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const generateUniqueFileName = (prefix, extension) =>
  `${prefix}_${Date.now()}_${Math.floor(Math.random() * 10000)}${extension}`;

function cleanupAudioFiles() {
  try {
    const directory = path.join(__dirname, '..');
    const ageLimit = 60 * 1000;
    const now = Date.now();

    fs.readdir(directory, (err, files) => {
      if (err) {
        console.error('Erreur lors de la lecture du répertoire:', err);
        return;
      }

      const batchSize = 10;
      for (let i = 0; i < files.length; i += batchSize) {
        const batch = files.slice(i, i + batchSize);

        setTimeout(() => {
          batch.forEach((file) => {
            try {
              const filePath = path.join(directory, file);
              fs.stat(filePath, (err, stats) => {
                if (err) {
                  console.error('Erreur lors de la lecture du fichier:', err);
                  return;
                }

                if (
                  (path.extname(file) === '.webm' ||
                    path.extname(file) === '.mp3') &&
                  file !== 'boup.mp3' &&
                  now - stats.mtimeMs > ageLimit
                ) {
                  fs.unlink(filePath, (err) => {
                    if (err && err.code !== 'ENOENT') {
                      console.error(
                        'Erreur lors de la suppression du fichier:',
                        err,
                      );
                    }
                  });
                }
                if (
                  stats.isDirectory() &&
                  (file.startsWith('maexxna_temp_') ||
                    file.startsWith('maexxna_file_temp_') ||
                    file.startsWith('temp_dir_') ||
                    file.startsWith('audio_')) &&
                  now - stats.mtimeMs > ageLimit
                ) {
                  cleanupDirectory(filePath);
                }
              });
            } catch (fileError) {
              console.error('Erreur lors du traitement du fichier:', fileError);
            }
          });
        }, i * 100);
      }
    });
  } catch (error) {
    console.error(
      'Erreur générale lors du nettoyage des fichiers audio:',
      error,
    );
  }
}

function cleanupDirectory(dirPath) {
  try {
    if (fs.existsSync(dirPath)) {
      const files = fs.readdirSync(dirPath);
      files.forEach((file) => {
        const filePath = path.join(dirPath, file);
        if (fs.statSync(filePath).isDirectory()) {
          cleanupDirectory(filePath);
        } else {
          fs.unlinkSync(filePath);
        }
      });
      fs.rmdirSync(dirPath);
    }
  } catch (error) {
    console.warn('Erreur lors du nettoyage du dossier:', error.message);
  }
}

function emergencyCleanup() {
  try {
    const directory = path.join(__dirname, '..');
    const emergencyAgeLimit = 30 * 1000;
    const now = Date.now();

    fs.readdir(directory, (err, files) => {
      if (err) return;

      files.forEach((file) => {
        const filePath = path.join(directory, file);
        fs.stat(filePath, (err, stats) => {
          if (err) return;

          if (
            (path.extname(file) === '.webm' || path.extname(file) === '.mp3') &&
            file !== 'boup.mp3' &&
            now - stats.mtimeMs > emergencyAgeLimit
          ) {
            fs.unlink(filePath, () => {});
          }
          if (
            stats.isDirectory() &&
            (file.startsWith('maexxna_temp_') ||
              file.startsWith('maexxna_file_temp_') ||
              file.startsWith('temp_dir_') ||
              file.startsWith('audio_')) &&
            now - stats.mtimeMs > emergencyAgeLimit
          ) {
            cleanupDirectory(filePath);
          }
        });
      });
    });
  } catch {}
}

async function cleanupRootAudioOutFiles() {
  try {
    const directory = process.cwd();
    const ageLimit = 2 * 60 * 1000;
    const now = Date.now();

    const files = await fsPromises.readdir(directory);
    const audioFiles = files.filter((file) =>
      /^(?:audio_out_).*\.mp3$/.test(file),
    );

    const batchSize = 10;
    for (let i = 0; i < audioFiles.length; i += batchSize) {
      const batch = audioFiles.slice(i, i + batchSize);
      await Promise.all(
        batch.map(async (file) => {
          try {
            const filePath = path.join(directory, file);
            const stats = await fsPromises.stat(filePath);
            if (stats.isFile() && now - stats.mtimeMs > ageLimit) {
              await fsPromises.unlink(filePath);
            }
          } catch (err) {
            if (err.code && err.code !== 'ENOENT') {
              console.error(
                'Erreur lors du nettoyage des audio_out_*.mp3:',
                err.message || err,
              );
            }
          }
        }),
      );

      await new Promise((r) => setTimeout(r, 50));
    }
  } catch (error) {
    console.error('Erreur lors du nettoyage des fichiers audio root:', error);
  }
}

export {
  cleanupAudioFiles,
  cleanupDirectory,
  cleanupRootAudioOutFiles,
  emergencyCleanup,
  generateUniqueFileName,
};

