import { join } from 'path';
import sharp from 'sharp';

export async function cropAndReconstitute(
  input: Buffer,
  debugDir?: string,
): Promise<Buffer> {
  async function loadRaw(
    imgInput: Buffer,
  ): Promise<{ data: Buffer; info: sharp.OutputInfo }> {
    const { data, info } = await sharp(imgInput)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return { data, info };
  }

  function idxFor(x: number, y: number, width: number): number {
    return (y * width + x) * 4;
  }

  function eqRGB(
    a: [number, number, number, number],
    b: [number, number, number, number],
  ): boolean {
    return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
  }

  const { info } = await loadRaw(input);

  const doubledBuffer = await sharp(input)
    .resize({
      width: info.width * 2,
      height: info.height * 2,
      kernel: 'nearest',
    })
    .png()
    .toBuffer();

  if (debugDir) {
    await sharp(doubledBuffer).toFile(join(debugDir, 'doubled.png'));
  }

  const { data: doubledData, info: doubledInfo } = await loadRaw(doubledBuffer);
  const w = doubledInfo.width,
    h = doubledInfo.height;

  const at = (x: number, y: number): [number, number, number, number] => {
    const i = idxFor(x, y, w);
    return [
      doubledData[i],
      doubledData[i + 1],
      doubledData[i + 2],
      doubledData[i + 3],
    ];
  };

  const findPattern = (
    startX: number,
    startY: number,
    dirX: number,
    dirY: number,
    pattern: [[number, number, number], [number, number, number]],
  ): { x: number; y: number } | null => {
    for (let y = startY; y >= 0 && y < h; y += dirY) {
      for (let x = startX; x >= 0 && x < w; x += dirX) {
        const p = at(x, y);
        if (p[0] !== 255 || p[1] !== 0 || p[2] !== 0) continue;
        let nx = x + dirX;
        while (nx >= 0 && nx < w && eqRGB(at(nx, y), p)) nx += dirX;
        if (nx < 0 || nx >= w) continue;
        const a = at(nx, y);
        let nx2 = nx + dirX;
        while (nx2 >= 0 && nx2 < w && eqRGB(at(nx2, y), a)) nx2 += dirX;
        if (nx2 < 0 || nx2 >= w) continue;
        const b = at(nx2, y);
        if (
          a[0] === pattern[0][0] &&
          a[1] === pattern[0][1] &&
          a[2] === pattern[0][2] &&
          b[0] === pattern[1][0] &&
          b[1] === pattern[1][1] &&
          b[2] === pattern[1][2]
        ) {
          return { x, y };
        }
      }
    }
    return null;
  };
  const startPoint = findPattern(0, 0, 1, 1, [
    [0, 255, 0],
    [0, 0, 255],
  ]);
  const endPoint = findPattern(w - 1, h - 1, -1, -1, [
    [0, 255, 0],
    [0, 0, 255],
  ]);
  if (!startPoint || !endPoint) throw new Error('Patterns not found');

  const sx1 = Math.min(startPoint.x, endPoint.x),
    sy1 = Math.min(startPoint.y, endPoint.y);
  const sx2 = Math.max(startPoint.x, endPoint.x),
    sy2 = Math.max(startPoint.y, endPoint.y);
  const cropW = sx2 - sx1 + 1,
    cropH = sy2 - sy1 + 1;
  if (cropW <= 0 || cropH <= 0) throw new Error('Invalid crop dimensions');

  const cropped = await sharp(doubledBuffer)
    .extract({ left: sx1, top: sy1, width: cropW, height: cropH })
    .png()
    .toBuffer();
  const { data: cdata, info: cinfo } = await loadRaw(cropped);
  const cw = cinfo.width,
    ch = cinfo.height;

  const newWidth = cw,
    newHeight = ch + 1;
  const out = Buffer.alloc(newWidth * newHeight * 4, 0);
  for (let i = 0; i < out.length; i += 4) out[i + 3] = 255;
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const srcI = (y * cw + x) * 4;
      const dstI = (y * newWidth + x) * 4;
      out[dstI] = cdata[srcI];
      out[dstI + 1] = cdata[srcI + 1];
      out[dstI + 2] = cdata[srcI + 2];
      out[dstI + 3] = cdata[srcI + 3];
    }
  }
  for (let x = 0; x < newWidth; x++) {
    const i = ((ch - 1) * newWidth + x) * 4;
    out[i] = out[i + 1] = out[i + 2] = 0;
    out[i + 3] = 255;
    const j = (ch * newWidth + x) * 4;
    out[j] = out[j + 1] = out[j + 2] = 0;
    out[j + 3] = 255;
  }
  if (newWidth >= 3) {
    const bgrStart = newWidth - 3;
    const bgr = [
      [0, 0, 255],
      [0, 255, 0],
      [255, 0, 0],
    ];
    for (let k = 0; k < 3; k++) {
      const i = (ch * newWidth + bgrStart + k) * 4;
      out[i] = bgr[k][0];
      out[i + 1] = bgr[k][1];
      out[i + 2] = bgr[k][2];
      out[i + 3] = 255;
    }
  }

  const getPixel = (x: number, y: number): [number, number, number, number] => {
    const i = (y * newWidth + x) * 4;
    return [out[i], out[i + 1], out[i + 2], out[i + 3]];
  };

  const compressedLines: Array<Array<[number, number, number, number]>> = [];
  for (let y = 0; y < newHeight; y++) {
    const line: Array<[number, number, number, number]> = [];
    for (let x = 0; x < newWidth; x++) line.push(getPixel(x, y));
    const isAllBlack = line.every(
      (p) => p[0] === 0 && p[1] === 0 && p[2] === 0 && p[3] === 255,
    );
    if (
      !isAllBlack &&
      (compressedLines.length === 0 ||
        !line.every((p, i) =>
          p.every(
            (v, j) => v === compressedLines[compressedLines.length - 1][i][j],
          ),
        ))
    ) {
      compressedLines.push(line);
    }
  }

  if (compressedLines.length === 0) {
    return sharp({
      create: {
        width: 1,
        height: 1,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
  }

  let finalWidth = newWidth,
    finalHeight = compressedLines.length;
  let finalOut = Buffer.alloc(finalWidth * finalHeight * 4, 0);
  for (let i = 0; i < finalOut.length; i += 4) finalOut[i + 3] = 255;
  for (let y = 0; y < finalHeight; y++) {
    for (let x = 0; x < finalWidth; x++) {
      const i = (y * finalWidth + x) * 4;
      finalOut[i] = compressedLines[y][x][0];
      finalOut[i + 1] = compressedLines[y][x][1];
      finalOut[i + 2] = compressedLines[y][x][2];
      finalOut[i + 3] = compressedLines[y][x][3] || 255;
    }
  }

  if (finalHeight >= 1 && finalWidth >= 3) {
    const lastY = finalHeight - 1;
    for (let k = 0; k < 3; k++) {
      const i = (lastY * finalWidth + finalWidth - 3 + k) * 4;
      finalOut[i] = finalOut[i + 1] = finalOut[i + 2] = 0;
      finalOut[i + 3] = 255;
    }
  }

  if (finalWidth >= 2) {
    const kept: number[] = [];
    for (let x = 0; x < finalWidth; x++) {
      if (kept.length === 0) {
        kept.push(x);
        continue;
      }
      const prevX = kept[kept.length - 1];
      let same = true;
      for (let y = 0; y < finalHeight; y++) {
        const ia = (y * finalWidth + prevX) * 4,
          ib = (y * finalWidth + x) * 4;
        if (
          finalOut[ia] !== finalOut[ib] ||
          finalOut[ia + 1] !== finalOut[ib + 1] ||
          finalOut[ia + 2] !== finalOut[ib + 2] ||
          finalOut[ia + 3] !== finalOut[ib + 3]
        ) {
          same = false;
          break;
        }
      }
      if (!same) kept.push(x);
    }
    if (kept.length !== finalWidth) {
      const newFinalWidth = kept.length;
      const newOut = Buffer.alloc(newFinalWidth * finalHeight * 4, 0);
      for (let i = 0; i < newOut.length; i += 4) newOut[i + 3] = 255;
      for (let nx = 0; nx < kept.length; nx++) {
        const sx = kept[nx];
        for (let y = 0; y < finalHeight; y++) {
          const srcI = (y * finalWidth + sx) * 4,
            dstI = (y * newFinalWidth + nx) * 4;
          newOut[dstI] = finalOut[srcI];
          newOut[dstI + 1] = finalOut[srcI + 1];
          newOut[dstI + 2] = finalOut[srcI + 2];
          newOut[dstI + 3] = finalOut[srcI + 3];
        }
      }
      finalOut = newOut;
      finalWidth = newFinalWidth;
    }
  }

  if (finalHeight >= 2 && finalWidth >= 3) {
    const secondLastY = finalHeight - 2;
    const bgrSeq = [
      [0, 0, 255],
      [0, 255, 0],
      [255, 0, 0],
    ];
    let hasBGR = true;
    for (let k = 0; k < 3; k++) {
      const i = (secondLastY * finalWidth + finalWidth - 3 + k) * 4;
      if (
        finalOut[i] !== bgrSeq[k][0] ||
        finalOut[i + 1] !== bgrSeq[k][1] ||
        finalOut[i + 2] !== bgrSeq[k][2]
      ) {
        hasBGR = false;
        break;
      }
    }
    if (hasBGR) {
      for (let k = 0; k < 3; k++) {
        const i = (secondLastY * finalWidth + finalWidth - 3 + k) * 4;
        finalOut[i] = finalOut[i + 1] = finalOut[i + 2] = 0;
        finalOut[i + 3] = 255;
      }
    }
  }

  if (finalHeight >= 1 && finalWidth >= 1) {
    const lastYFinal = finalHeight - 1;
    const bgrSeq = [
      [0, 0, 255],
      [0, 255, 0],
      [255, 0, 0],
    ];
    for (let k = 0; k < 3; k++) {
      const sx = finalWidth - 3 + k;
      if (sx >= 0) {
        const i = (lastYFinal * finalWidth + sx) * 4;
        finalOut[i] = bgrSeq[k][0];
        finalOut[i + 1] = bgrSeq[k][1];
        finalOut[i + 2] = bgrSeq[k][2];
        finalOut[i + 3] = 255;
      }
    }
  }

  return sharp(finalOut, {
    raw: { width: finalWidth, height: finalHeight, channels: 4 },
  })
    .png()
    .toBuffer();
}

