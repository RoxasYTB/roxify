import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';

const applyEffects = (inputPath, outputPath) => {
  return new Promise((resolve, reject) => {
    try {
      const ext = path.extname(outputPath) || '.webm';
      const base = path.basename(outputPath, ext);
      const dir = path.dirname(outputPath);
      const tmpOutput = path.join(dir, `${base}.tmp${ext}`);

      console.log(
        '[Maexxna TTS] applyEffects: input=',
        inputPath,
        ' tmpOutput=',
        tmpOutput,
        ' output=',
        outputPath,
      );

      if (fs.existsSync(tmpOutput)) {
        try {
          fs.unlinkSync(tmpOutput);
        } catch {}
      }

      const safeCmd = `ffmpeg -y -i "${inputPath}" -af "aecho=0.7:0.8:25:0.6, afftdn, alimiter=limit=0.5, highpass=f=500" "${tmpOutput}"`;

      exec(safeCmd, (error, _stdout, _stderr) => {
        if (error) {
          console.error(
            '[Maexxna TTS] applyEffects ffmpeg error:',
            error.message,
          );
          try {
            if (fs.existsSync(tmpOutput)) fs.unlinkSync(tmpOutput);
          } catch {}
          return reject(error);
        }

        try {
          if (fs.existsSync(outputPath)) {
            try {
              fs.unlinkSync(outputPath);
            } catch {}
          }
          fs.renameSync(tmpOutput, outputPath);
          console.log(
            '[Maexxna TTS] applyEffects: transformation terminée ->',
            outputPath,
          );
          resolve();
        } catch (e) {
          try {
            if (fs.existsSync(tmpOutput)) fs.unlinkSync(tmpOutput);
          } catch {}
          reject(e);
        }
      });
    } catch (err) {
      reject(err);
    }
  });
};

export { applyEffects };

