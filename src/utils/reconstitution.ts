import { native } from './native.js';

export async function cropAndReconstitute(
  input: Buffer,
  debugDir?: string,
): Promise<Buffer> {
  return Buffer.from(native.cropAndReconstitute(input));
}
