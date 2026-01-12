# Reconversion PNG Universelle

## Problème Résolu

**Avant v1.4.0** :

- Les fichiers optimisés en JXL/WebP gardaient l'extension `.png`
- Mais contenaient du JXL/WebP brut → **non visualisables** dans les navigateurs
- Impossible de prendre des captures d'écran

**Après v1.4.0** :

- Tous les fichiers générés sont de **vrais PNG**
- Optimisation JXL/WebP appliquée en interne puis **reconvertie en PNG**
- **100% compatible** : navigateurs, visualisateurs, captures d'écran

## Pipeline d'Optimisation

```
Input Data
    ↓
[1] Encode to PNG pixels
    ↓
[2] Optimize (WebP/JXL) ← Compression interne
    ↓
[3] Reconvert to PNG    ← Universal compatibility
    ↓
Output PNG file (viewable everywhere)
```

## Exemples

### Encodage avec JXL (optimisé puis reconverti)

```bash
$ npx rox encode data.json --output-format jxl

# Fichier généré : output.png
$ file output.png
output.png: PNG image data, 5 x 5, 8-bit/color RGB

$ firefox output.png  # ✅ S'ouvre directement !
```

### Auto-optimisation (détection automatique)

```bash
$ npx rox encode large-data.json

# Roxify choisit automatiquement JXL si optimal
# Puis reconvertit en PNG pour compatibilité
# Résultat : PNG visualisable avec compression optimale
```

### Capture d'écran supportée

```bash
# 1. Générer un fichier optimisé
$ npx rox encode secret.txt -o data.png --output-format jxl

# 2. Ouvrir dans un navigateur
$ firefox data.png

# 3. Prendre une capture d'écran (Ctrl+Shift+S)
# 4. Décoder la capture
$ npx rox decode screenshot.png

# ✅ Fonctionne ! Le PNG est un vrai PNG
```

## Marqueurs de Format

Pour traçabilité, un marqueur est inséré après le pixel de compression :

| Couleur RGB   | Format     |
| ------------- | ---------- |
| (0, 255, 255) | PNG natif  |
| (255, 0, 255) | WebP → PNG |
| (255, 255, 0) | JXL → PNG  |

_Note: Ces marqueurs sont à usage interne, non visibles à l'utilisateur._

## Compatibilité

### Décodage

- **Fichiers v1.4.0+** : PNG direct, décodage standard
- **Fichiers v1.3.x** : Auto-détection JXL/WebP → conversion automatique (legacy)

### Outils Requis

Pour l'optimisation et la reconversion :

```bash
# Debian/Ubuntu
sudo apt install webp libjxl-tools

# macOS
brew install webp jpeg-xl

# Vérification
which cwebp dwebp cjxl djxl
```

## Performance

| Étape             | Temps      |
| ----------------- | ---------- |
| Prédiction format | ~15ms      |
| Encoding PNG      | <100ms     |
| Optimization JXL  | ~50ms      |
| Reconversion PNG  | ~20ms      |
| **Total**         | **<200ms** |

_Temps pour fichier de 100KB typique_

## Questions Fréquentes

### Pourquoi reconvertir en PNG au lieu de garder JXL/WebP ?

1. **Compatibilité universelle** : tous les navigateurs supportent PNG
2. **Captures d'écran** : l'image doit être visualisable pour être capturée
3. **Transparence utilisateur** : l'extension `.png` garantit l'ouverture

### Y a-t-il une perte de qualité ?

**Non, aucune perte** :

- Optimisation JXL/WebP : **lossless** uniquement
- Reconversion PNG : **lossless** également
- Roundtrip garanti : `data → encode → decode → data` (identique)

### Peut-on désactiver la reconversion ?

Non, c'est une caractéristique fondamentale de v1.4.0 pour garantir la compatibilité. Si vous avez besoin de JXL/WebP brut, utilisez directement `cjxl`/`cwebp`.

### Les anciens fichiers (v1.3.x) fonctionnent-ils toujours ?

Oui, le décodeur détecte automatiquement :

- JXL brut (magic bytes `0xFF 0x0A`) → conversion PNG
- WebP brut (magic bytes `RIFF...WEBP`) → conversion PNG
- PNG → décodage standard

## Tests

Validation complète de tous les formats :

```bash
$ node test/test-final-complete.js

=== TEST FORMAT: PNG ===
✓ Encodage avec marqueurs obligatoires
✓ Décodage sans approximation
🎉 FORMAT PNG : TOUS LES TESTS SONT PASSÉS

=== TEST FORMAT: WEBP ===
✓ Optimisation WebP + reconversion PNG
✓ Intégrité parfaite des données
🎉 FORMAT WEBP : TOUS LES TESTS SONT PASSÉS

=== TEST FORMAT: JXL ===
✓ Optimisation JXL + reconversion PNG
✓ Intégrité parfaite des données
🎉 FORMAT JXL : TOUS LES TESTS SONT PASSÉS

🎉 TOUS LES FORMATS VALIDÉS 🎉
```
