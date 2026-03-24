# Roxify — Benchmarks

> **Machine :** Intel Core i7-6700K @ 4.00 GHz — Linux x86_64
> **Build :** `--release` (opt-level 3, LTO thin, codegen-units 1, strip, panic abort, mimalloc)
> **Compression :** Zstd (multithread, long-distance matching, window-log 27)

---

## Single file

| Scénario                             | Input | Output |   Ratio |    Encode | Decode |
| ------------------------------------ | ----: | -----: | ------: | --------: | -----: |
| Random 10 MB (lvl 3, incompressible) | 10 MB |  11 MB | 100.1 % |     76 ms |  22 ms |
| Text 10 MB (lvl 19, très redondant)  | 10 MB | 1.2 KB |   ≈ 0 % |     64 ms |  12 ms |
| JSON 15 MB (lvl 19, structured)      | 15 MB | 3.9 MB |  27.2 % | 10 767 ms |  34 ms |

## Répertoire → TAR → PNG (archive solide)

| Scénario                    |  Input | Output |   Ratio |   Encode | Decode |
| --------------------------- | -----: | -----: | ------: | -------: | -----: |
| 50 fichiers texte (884 KB)  | 884 KB | 4.7 KB |   0.5 % |    37 ms |   5 ms |
| 35 fichiers mixtes (2.7 MB) | 2.7 MB | 2.7 MB |  99.4 % |   349 ms |   9 ms |
| 500 petits fichiers (42 KB) |  42 KB |  59 KB | 137.2 % | 2 216 ms |  11 ms |

## Avec chiffrement AES-256-GCM (PBKDF2, 1M itérations)

| Scénario                  |  Input | Output |   Ratio |    Encode | Decode |
| ------------------------- | -----: | -----: | ------: | --------: | -----: |
| Text 10 MB (lvl 19)       |  10 MB | 1.4 KB |   ≈ 0 % |    503 ms | 457 ms |
| JSON 15 MB (lvl 19)       |  15 MB | 3.9 MB |  27.2 % | 11 458 ms | 502 ms |
| 50 fichiers texte (TAR)   | 884 KB | 4.8 KB |   0.5 % |    501 ms | 452 ms |
| 500 petits fichiers (TAR) |  42 KB |  59 KB | 137.2 % |  2 721 ms | 459 ms |

---

## Observations

- **Données incompressibles :** le ratio est ≈ 100 % — overhead minimal (en-tête PNG + markers Roxify).
- **Texte ultra-redondant :** le ratio tombe à quasi 0 % grâce à Zstd level 19.
- **Overhead du chiffrement :** ~450 ms fixes (PBKDF2 1M itérations), indépendant de la taille des données.
- **Décodage :** toujours < 35 ms sans chiffrement (dominé par le parsing PNG + Zstd décompression).
- **TAR / petits fichiers :** overhead des headers TAR visible quand le contenu total est très petit (42 KB → 59 KB = +40 %).
- **JSON 15 MB / lvl 19 :** l'encodage est lent (≈11s) car Zstd level 19 est intensif ; utiliser level 3 pour un encodage rapide avec un ratio légèrement inférieur.

## Intégrité

Tous les scénarios ci-dessus ont été validés par roundtrip complet (encode → decode) avec vérification MD5 :

- **Fichier unique** : checksum identique avant/après
- **Répertoire (TAR)** : tous les fichiers extraits avec checksums identiques
- **Chiffré (AES)** : roundtrip OK avec la bonne passphrase
- **Mauvaise passphrase** : correctement rejetée (`aead::Error`)

## Pipeline

```
Fichier/Répertoire → [TAR] → Zstd compress → [AES-256-GCM] → pixels RGB + markers → PNG
PNG → pixels → markers → [AES decrypt] → Zstd decompress → [TAR unpack] → Fichier(s)
```

La reconstitution depuis screenshot (crop, scale, fond ajouté) fonctionne via le fallback `crop_and_reconstitute` qui détecte les markers visuels dans l'image déformée.
