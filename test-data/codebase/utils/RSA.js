import { createSign, createVerify, generateKeyPairSync } from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RSAKeysPath = path.join(__dirname, 'RSAKeys.json');
const RSAPublicKeysPath = path.join(__dirname, 'RSAPublicKeys.json');
async function generateKeys() {
  let RSAKeys = JSON.parse(fs.readFileSync(RSAKeysPath, 'utf-8'));
  let RSAPublicKeys = JSON.parse(fs.readFileSync(RSAPublicKeysPath, 'utf-8'));
  const { isPrivateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
    isPrivateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  });
  RSAKeys.public = publicKey;
  RSAKeys.isPrivate = isPrivateKey;
  RSAKeys.version += 1;
  RSAPublicKeys.push([RSAKeys.version, RSAKeys.public]);
  fs.writeFileSync(RSAKeysPath, JSON.stringify(RSAKeys));
  fs.writeFileSync(RSAPublicKeysPath, JSON.stringify(RSAPublicKeys));
  return RSAKeys;
}
async function sign(message, isPrivateKey) {
  const sign = createSign('SHA256');
  sign.update(message);
  sign.end();
  return sign.sign(isPrivateKey, 'base64');
}
async function verify(message, publicKey, signature) {
  const verify = createVerify('SHA256');
  verify.update(message);
  verify.end();
  return verify.verify(publicKey, signature, 'base64');
}
export { generateKeys, sign, verify };

