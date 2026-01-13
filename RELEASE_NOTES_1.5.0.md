# Release Notes v1.5.0

## 🎯 Migration Complète vers Rust Natif

Cette release finalise la migration de toutes les dépendances npm vers du code Rust natif, résultant en un module **ultra-léger** et **performant**.

## ✅ Changements Majeurs

### Dépendances Supprimées (5 → 0)
Toutes les dépendances runtime ont été **complètement éliminées** :

- ❌ `@mongodb-js/zstd` → ✅ Rust zstd natif (0.11)
- ❌ `cli-progress` → ✅ Stub TypeScript minimal
- ❌ `png-chunks-encode/extract` → ✅ Rust PNG utils
- ❌ `sharp` → ✅ Rust image crate (0.25)
- ❌ `commander` → ✅ CLI natif intégré

### Réduction Drastique
- **node_modules** : 200 MB → **26 MB** (-87%)
- **Packages** : 50+ → **2** (TypeScript + @types/node)
- **Temps d'installation** : ~30s → **2s**

### Performance
- Compression zstd **native** (niveau 1-22)
- Encodage/décodage PNG **natif**
- Pas de dépendances externes à charger
- CLI Rust standalone (2.6 MB) disponible

## 🔧 Corrections

### API Programmatique
- Correction du blocage dans `parallelZstdCompress` (workers async remplacés par traitement séquentiel simple)
- Gestion correcte des buffers vides
- Désactivation du block encoding par défaut (meilleure compatibilité)
- Suppression de l'optimisation PNG automatique (gain de performance)

### Stabilité
- Tous les tests API passent (5/5)
- Round-trip CLI validé
- Support des fichiers vides

## 📦 Fichiers Générés

```
dist/               # Code TypeScript compilé
  ├── cli.js        # 27 KB
  ├── index.js      # 532 B
  └── ...

libroxify_native.node  # 16 MB (N-API pour Node.js)
target/release/roxify_native  # 2.6 MB (CLI standalone)
```

## 🚀 Utilisation

### Installation
```bash
npm install roxify
```

### API Node.js
```js
import { encodeBinaryToPng, decodePngToBinary } from 'roxify';

const input = Buffer.from('Hello World');
const encoded = await encodeBinaryToPng(input, { compressionLevel: 3 });
const result = await decodePngToBinary(encoded);
console.log(result.buf.toString()); // "Hello World"
```

### CLI
```bash
npx roxify encode ./data output.png
npx roxify decode output.png ./restored
```

## 📊 Benchmarks

- Compression ratio : ~18-46% selon les données
- Vitesse encodage : ~5 MB/s
- Vitesse décodage : ~3 MB/s
- Support fichiers jusqu'à 50 MB (optimisé)

## 🔄 Migration depuis v1.4.x

Aucun changement breaking dans l'API. Le code existant fonctionne sans modification.

## ⚙️ Exigences

- Node.js >= 18.0.0
- Système avec support Rust natif (Linux, macOS, Windows)

## 📝 Notes Techniques

Le module utilise désormais :
- **napi-rs** pour l'intégration N-API
- **zstd 0.11** pour compression
- **image 0.25** pour manipulation PNG
- **TypeScript 5.6** pour le code JS

Pas de dépendances runtime = installation instantanée, bundle minimal, déploiement simplifié.
