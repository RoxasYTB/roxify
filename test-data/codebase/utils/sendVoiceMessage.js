import ffprobe from 'node-ffprobe';
import getDiscordToken from '../config/tokenHandler.js';
const TOKEN_BOT = getDiscordToken();

function buildTTSUrl(text, lang = 'fr') {
  const base =
    process.env.TTS_API_URL || 'http://localhost:7080/generate-audio';
  const qs = new URLSearchParams({
    lang:
      ['fr', 'en'].includes(String(lang).toLowerCase()) ?
        String(lang).toLowerCase()
      : 'fr',
    codec: 'opus',
    format: 'ogg',
    text,
  });
  return `${base}?${qs.toString()}`;
}

function buildWaveformBase64(points = 256) {
  const arr = new Uint8Array(points);
  for (let i = 0; i < points; i++) {
    const v = Math.floor(127 + 127 * Math.sin((i / points) * Math.PI * 2));
    arr[i] = Math.max(0, Math.min(255, v));
  }
  return Buffer.from(arr).toString('base64');
}

async function getAudioDuration(buffer) {
  try {
    const fs = await import('fs');
    const path = await import('path');
    const os = await import('os');

    const tempPath = path.join(os.tmpdir(), `temp_audio_${Date.now()}.ogg`);
    fs.writeFileSync(tempPath, buffer);

    const metadata = await ffprobe(tempPath);
    const duration = parseFloat(metadata.format.duration);

    fs.unlinkSync(tempPath);

    return Math.ceil(duration);
  } catch (error) {
    console.warn('Erreur lors du calcul de la durée audio:', error);

    return Math.max(1, Math.ceil(buffer.byteLength / 8000));
  }
}

async function requestUploadUrl(channelId, size, duration, token) {
  const res = await fetch(
    `https://discord.com/api/v10/channels/${channelId}/attachments`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bot ${token}`,
      },
      body: JSON.stringify({
        files: [
          {
            filename: 'voice-message.ogg',
            file_size: size,
            id: '0',
            duration_secs: duration,
          },
        ],
      }),
    },
  );
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`attachments POST ${res.status}: ${txt}`);
  }
  const json = await res.json();
  const a = json.attachments?.[0];
  if (!a?.upload_url || !a?.upload_filename) {
    throw new Error("Réponse inattendue pour l'URL d'upload.");
  }
  return { uploadUrl: a.upload_url, uploadFilename: a.upload_filename };
}

async function putFileToUploadUrl(uploadUrl, buffer) {
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'audio/ogg',
      'Content-Length': String(buffer.byteLength),
    },
    body: buffer,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`PUT upload ${res.status}: ${txt}`);
  }
}

async function postVoiceMessage(
  channelId,
  uploadFilename,
  durationSecs,
  waveformB64,
  token,
  replyToMessageId,
) {
  const res = await fetch(
    `https://discord.com/api/v10/channels/${channelId}/messages`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bot ${token}`,
      },
      body: JSON.stringify({
        flags: 8192,
        attachments: [
          {
            id: '0',
            filename: 'voice-message.ogg',
            uploaded_filename: uploadFilename,
            duration_secs: durationSecs,
            waveform: waveformB64,
          },
        ],
        message_reference:
          replyToMessageId ?
            { message_id: replyToMessageId, channel_id: channelId }
          : undefined,
        allowed_mentions: { parse: [], replied_user: false },
        fail_if_not_exists: false,
      }),
    },
  );
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`messages POST ${res.status}: ${txt}`);
  }
  return res.json();
}

function sanitizeForTTS(text) {
  try {
    let t = String(text || '').replace(/<@&?\d+>/g, '@utilisateur');
    t = t.replace(/<#[0-9]+>/g, '');
    t = t.replace(/<a?:[\w-]+:\d+>/g, '');
    t = t.replace(/https?:\/\/[\w\-._~:/?#[\]@!$&'()*+,;=%]+/g, '');

    if (t.length > 500) t = t.slice(0, 500);
    return t.trim() || '...';
  } catch {
    return '...';
  }
}

async function sendTextAsVoiceMessage(message, text, lang = 'fr') {
  const token = TOKEN_BOT;
  const safe = sanitizeForTTS(text);
  const url = buildTTSUrl(safe, lang);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TTS HTTP ${res.status}`);
  const ab = await res.arrayBuffer();
  const ogg = Buffer.from(ab);

  const durationSecs = await getAudioDuration(ogg);
  const waveform = buildWaveformBase64(256);

  const { uploadUrl, uploadFilename } = await requestUploadUrl(
    message.channel.id,
    ogg.byteLength,
    durationSecs,
    token,
  );
  await putFileToUploadUrl(uploadUrl, ogg);
  await postVoiceMessage(
    message.channel.id,
    uploadFilename,
    durationSecs,
    waveform,
    token,
    message.id,
  );
}

export { sendTextAsVoiceMessage };

