import fs from 'fs';
import https from 'https';
import fetch from 'node-fetch';
import path from 'path';
import { fileURLToPath } from 'url';

const API_KEY = 'ead2370b52305b4faaf6f3c1ff7f123b9b2ca8ba';

async function downloadVoiceMessage(url, outputPath) {
  try {
    const response = await fetch(url);
    if (!response.ok)
      throw new Error(`Échec du téléchargement : ${response.statusText}`);

    const fileStream = fs.createWriteStream(outputPath);
    await new Promise((resolve, reject) => {
      response.body.pipe(fileStream);
      response.body.on('error', reject);
      fileStream.on('finish', resolve);
    });

    return outputPath;
  } catch (error) {
    console.error('Erreur lors du téléchargement :', error);
    throw error;
  }
}

function saveTranscriptionToFile(text, outputPath) {
  try {
    fs.writeFileSync(outputPath, text);
    return outputPath;
  } catch (error) {
    throw error;
  }
}

function deleteFile(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch (error) {
    console.error(`Erreur lors de la suppression de ${filePath}:`, error);
  }
}

function punctuate(words) {
  if (!words || words.length === 0) return '';

  let result = '';
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const next = words[i + 1];

    result += w.word;

    if (!next) break;

    const delay = next.start - w.end;

    if (delay > 0.6) result += ', ';
    else result += ' ';
  }

  result = result.trim();
  if (!result.endsWith('.')) result += '.';
  result = result.charAt(0).toUpperCase() + result.slice(1);

  return result;
}

function autoPunctuate(text) {
  text = text.replace(/\s+/g, ' ');

  text = text.replace(/([,.!?])([^\s])/g, '$1 $2');

  text = text.replace(/\b(\w+)\s+\1\b/gi, '$1, $1');

  if (!/[.!?]$/.test(text)) {
    text += '.';
  }

  return text.trim();
}
function cleanText(text) {
  text = text.replace(/\s+/g, ' ');

  text = text.replace(/([,.!?])([^\s])/g, '$1 $2');

  text = text.replace(/\bop optimiser\b/gi, 'optimiser');

  text = text.replace(/\b(d'ailleurs|enfin bon)\b/gi, '');

  return text.trim();
}

async function transcribeWithDeepgram(audioPath) {
  const audioData = fs.readFileSync(audioPath);

  const options = {
    hostname: 'api.deepgram.com',
    path: '/v1/listen?language=fr',
    method: 'POST',
    headers: {
      Authorization: `Token ${API_KEY}`,
      'Content-Type': 'audio/ogg',
      'Content-Length': audioData.length,
    },
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const json = JSON.parse(data);

          const alt = json.results?.channels?.[0]?.alternatives?.[0];
          const words = alt?.words || [];
          const transcript = alt?.transcript?.trim() || '';

          const punctuated =
            words.length > 0 ? punctuate(words) : transcript || '';

          resolve(punctuated);
        } catch (err) {
          reject(
            new Error(
              "Erreur d'analyse de la réponse Deepgram : " + err.message,
            ),
          );
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.write(audioData);
    req.end();
  });
}

export async function processDiscordVoiceMessage(discordUrl) {
  if (!discordUrl) {
    console.error('Aucune URL Discord fournie.');
    return { success: false, message: 'Aucune URL Discord fournie.' };
  }

  const baseDir = path.dirname(fileURLToPath(import.meta.url));
  const outputDir = path.join(baseDir, 'output');
  const audioDir = path.join(outputDir, 'audio');
  const textDir = path.join(outputDir, 'text');

  [outputDir, audioDir, textDir].forEach((dir) => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });

  const timestamp = Date.now();
  const audioPath = path.join(audioDir, `voice-message-${timestamp}.ogg`);
  const textPath = path.join(textDir, `transcription-${timestamp}.txt`);

  try {
    await downloadVoiceMessage(discordUrl, audioPath);

    let transcript = await transcribeWithDeepgram(audioPath);
    transcript = cleanText(transcript);
    transcript = autoPunctuate(transcript);

    if (!transcript) {
      console.warn('⚠️ Aucun texte détecté.');
      deleteFile(audioPath);
      return { success: false, transcription: '' };
    }

    saveTranscriptionToFile(transcript, textPath);
    deleteFile(audioPath);

    return { success: true, transcription: transcript };
  } catch (error) {
    console.error('Erreur dans le pipeline :', error);
    return { success: false, message: error.message };
  }
}

