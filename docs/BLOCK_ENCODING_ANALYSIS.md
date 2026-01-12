# Analyse : Compression par blocs 2×2

## Résultats des tests

**Données test:** 5700 octets de texte répétitif

### Mode Standard (RGB direct)

- Zstd niveau 19 : 5700 → ~150 octets
- PNG final : **211 octets**
- Dimensions : 7×7 pixels RGB

### Mode Blocs 2×2 (patterns visuels)

- Zstd niveau 19 : 5700 → ~150 octets
- Blocs 2×2 : 150 octets → 600 pixels (grille 24×24)
- PNG final : **473 octets**
- Dimensions : 24×24 pixels RGB

**Différence : +124% (augmentation)**

## Diagnostic

Le pipeline **actuel est déjà optimal** :

1. **Zstd niveau 19** compresse extrêmement bien (97% de réduction)
2. Le PNG stocke du **bruit quasi-aléatoire** post-compression
3. Les patterns 2×2 créent 4× plus de pixels
4. La meilleure compression PNG ne compense pas ce sur-échantillonnage

## Opportunités d'optimisation réelles

### ✅ Ce qui marche déjà

- Compression Zstd niveau 19 (excellent)
- Encodage compact RGB (minimal)
- Pipeline TypeScript optimisé

### 🔧 Pistes pour aller plus loin

1. **Pré-traitement avant Zstd**

   - Delta encoding (déjà implémenté optionnellement)
   - BWT transform (Burrows-Wheeler)
   - Context mixing

2. **Compression adaptative**

   - Détecter type de données (texte, binaire, JSON)
   - Ajuster paramètres Zstd dynamiquement
   - Utiliser dictionnaires Zstd pour données similaires

3. **Optimisation PNG finale**

   - WebP lossless au lieu de PNG (10-30% plus petit)
   - AVIF lossless (encore mieux)
   - PNG avec filtres adaptatifs activés (déjà fait)

4. **Pour robustesse screenshot**
   - Error correction codes (Reed-Solomon)
   - Modulation basse-fréquence (DCT/FFT)
   - QR-code like encoding

## Recommandation

**Ne pas activer useBlockEncoding par défaut** — le mode actuel est plus efficace.

Pour améliorer compression finale :

- Tester WebP lossless : `sharp().webp({ lossless: true })`
- Ajouter ECC pour robustesse screenshot
- Expérimenter avec pré-filtres spécialisés (delta, BWT)

## Code actuel

Le système supporte désormais :

- `useBlockEncoding: false` (défaut) → optimal pour taille
- `useBlockEncoding: true` → blocs 2×2 pour robustesse screenshot potentielle

L'option reste disponible pour expérimentation mais n'est pas recommandée pour usage production.
