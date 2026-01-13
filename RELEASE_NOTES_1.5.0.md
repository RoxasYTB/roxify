# Release Notes v1.5.0

## 🎯 Migration Complète vers Rust Natif + Support Multi-Plateforme

Cette release finalise la migration de toutes les dépendances npm vers du code Rust natif, avec support complet de **Linux, macOS (x64/ARM64) et Windows**.

## ✅ Changements Majeurs

### Dépendances Supprimées (5 → 0)

Toutes les dépendances runtime ont été **complètement éliminées** :

- ❌ `@mongodb-js/zstd` → ✅ Rust zstd natif (0.11)
- ❌ `cli-progress` → ✅ Stub TypeScript minimal
- ❌ `png-chunks-encode/extract` → ✅ Rust PNG utils natif
- ❌ `sharp` → ✅ Rust image crate (0.25)
- ❌ `commander` → ✅ CLI natif intégré

### Support Multi-Plateforme

Module natif compilé pour **4 plateformes** :

- 🐧 **Linux x64** (`x86_64-unknown-linux-gnu`)
- 🍎 **macOS x64** (`x86_64-apple-darwin`)
- 🍎 **macOS ARM64** (`aarch64-apple-darwin`) - Apple Silicon
- 🪟 **Windows x64** (`x86_64-pc-windows-msvc`)

Détection automatique de la plateforme au runtime avec fallback intelligent.

### Réduction Drastique

- **node_modules** : 200 MB → **26 MB** (-87%)
- **Packages npm** : 50+ → **2** (TypeScript + @types/node en dev uniquement)
- **Temps d'installation** : ~30s → **2s**
- **0 dépendance runtime**

### Performance

- Compression zstd **native** (niveau 1-22)
- Encodage/décodage PNG **100% natif**
- Pas de dépendances externes à charger
- CLI Rust standalone (2.6 MB) disponible

## 🔧 Corrections

### API Programmatique

- Correction du blocage dans `parallelZstdCompress` (workers async → séquentiel)
- Gestion correcte des buffers vides (fix panic Rust)
- Désactivation du block encoding par défaut (meilleure compatibilité)
- Suppression de l'optimisation PNG automatique (gain performance)
- Suppression des fallbacks LZMA (inutiles sans dépendance)

### Stabilité

- ✅ 5/5 tests API passent
- ✅ Round-trip CLI validé
- ✅ Support fichiers vides
- ✅ Gestion erreurs améliorée

## 📦 Distribution

### Binaires natifs multi-plateforme

```
libroxify_native.node                          # Copie plateforme courante
libroxify_native-x86_64-unknown-linux-gnu.so   # Linux x64
libroxify_native-x86_64-apple-darwin.dylib     # macOS x64
libroxify_native-aarch64-apple-darwin.dylib    # macOS ARM64
libroxify_native-x86_64-pc-windows-msvc.dll    # Windows x64
```

Le bon binaire est automatiquement sélectionné selon votre plateforme.

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
- Support fichiers jusqu'à 50 MB

## 🔄 Migration depuis v1.4.x

**Aucun changement breaking dans l'API publique.**

Changements internes :

- Fallbacks LZMA supprimés (zstd uniquement)
- Optimisation PNG désactivée par défaut
- Détection automatique binaire natif

## ⚙️ Exigences

- **Node.js** >= 18.0.0
- **Système** : Linux (x64), macOS (x64/ARM64), ou Windows (x64)

## 🔨 Build Multi-Plateforme

### Via GitHub Actions (Recommandé)

```bash
git tag v1.5.0
git push origin v1.5.0
```

### Local

```bash
npm run build:native        # Plateforme courante
node scripts/build-all-platforms.js  # Toutes les plateformes
```

Voir [docs/CROSS_PLATFORM.md](docs/CROSS_PLATFORM.md) pour plus de détails.

## 📝 Stack Technique

- **N-API** : Interface native Node.js stable
- **zstd 0.11** : Compression ultra-rapide
- **image 0.25** : Manipulation PNG native
- **TypeScript 5.6** : Code type-safe
- **GitHub Actions** : Build automatique multi-plateforme

## 🎉 Conclusion

Cette release marque la transition complète vers une architecture **100% native sans dépendances npm runtime**. Le module est maintenant :

- ✅ Ultra-léger (26 MB node_modules)
- ✅ Ultra-rapide (code natif Rust)
- ✅ Multi-plateforme (Linux/macOS/Windows)
- ✅ Prêt pour production

---

**Prêt pour `npm publish`** 🚀
