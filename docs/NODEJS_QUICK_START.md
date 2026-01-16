# Utilisation rapide (Node.js) ✅

Exemples minimaux pour tester rapidement les API publiques de `roxify` (copier/coller et exécuter).

> Import (ESM)

```js
import { encodeBinaryToPng, decodePngToBinary } from 'roxify';
import fs from 'fs';

async function encode() {
  const buf = Buffer.from('hello world', 'utf8');
  const png = await encodeBinaryToPng(buf, {
    mode: 'screenshot',
    name: 'hello.txt',
    compressionLevel: 19,
    outputFormat: 'png',
  });
  fs.writeFileSync('out.png', png);
  console.log('Saved out.png');
}

async function decode() {
  const png = fs.readFileSync('out.png');
  const res = await decodePngToBinary(png);
  console.log('name:', res.meta?.name);
  console.log('content:', res.buf.toString('utf8'));
}

(async () => {
  await encode();
  await decode();
})();
```

---

## Extra: obtenir la liste de fichiers sans décompresser

```js
import { listFilesInPng } from 'roxify';
import fs from 'fs';

const png = fs.readFileSync('out.png');
const list = await listFilesInPng(png, { includeSizes: true });
console.log(list);
```

---

## Vérifier si un PNG exige une passphrase

```js
import { hasPassphraseInPng } from 'roxify';
import fs from 'fs';

const png = fs.readFileSync('out.png');
const needPass = await hasPassphraseInPng(png);
console.log('needs passphrase?', needPass);
```

---

## Utilisation avancée (reconstitution d'image insérée)

```js
import { cropAndReconstitute } from 'roxify';
import fs from 'fs';

const png = fs.readFileSync('composite.png');
const reconPng = await cropAndReconstitute(png, /* debugDir? */ undefined);
fs.writeFileSync('reconstructed.png', reconPng);
```

---

Ces exemples visent l'essentiel pour démarrer ; ils fonctionnent en environnement Node.js ESM (Node >= 18). Si tu veux, j'ajoute des exemples TypeScript (`.ts`) et une section pour l'utilisation CLI (`npx rox encode` / `npx rox decode`).
