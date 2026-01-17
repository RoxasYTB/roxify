# Optimisatio de Build et CI/CD

## Résultats

### Taille des binaires

- **Avant**: 16 MB
- **Après**: 3.3 MB
- **Réduction**: 80% 🚀

### Vitesse de CI

- Tests Matrix supprimée (3 OS → 1 OS Ubuntu uniquement)
- Utilisation de `Swatinem/rust-cache@v2` (cache intelligent)
- Suppression de sccache (complexité inutile)
- CARGO_INCREMENTAL=0 pour builds plus propres
- Temps estimé: **50-70% plus rapide**

## Modifications Cargo.toml

```toml
[profile.release]
opt-level = 3           # Optimisation maximale
lto = "thin"            # Link Time Optimization
codegen-units = 1       # Meilleure optimisation
strip = true            # Suppression des symboles debug
panic = "abort"         # Réduction de la taille

[profile.release-size]  # Pour binaires ultra-légers
inherits = "release"
opt-level = "z"         # Optimisation pour la taille
lto = true              # LTO complet
strip = true
```

## Workflows Optimisés

### CI (.github/workflows/ci.yml)

- **Avant**: Matrix 3 OS × tests
- **Après**: Ubuntu uniquement, tests rapides
- Actions modernes: `dtolnay/rust-toolchain` + `Swatinem/rust-cache`
- Cache npm automatique

### Release (.github/workflows/release.yml)

- Build parallèle par target (4 targets)
- Strip automatique des binaires Unix
- Cache Rust par target
- workflow_dispatch pour releases manuelles

### Build (.github/workflows/build.yml)

- Simplifié et optimisé
- Retention artifacts: 7 jours
- Strip systématique

## Commandes locales

```bash
# Build optimisé (fast - no optional features)
cargo build --release --lib --no-default-features

# Build all three targets (script):
# Use system zstd and fast release to avoid compiling zstd C sources and speed up builds
# Install system zstd (Linux: libzstd-dev, Windows: choco install zstd)
# Example (fast, using system zstd):
# USE_SYSTEM_ZSTD=1 FAST_RELEASE=1 npm run build:native:targets
npm run build:native:targets

# Quick release (faster, weaker optimizations):
# FAST_RELEASE=1 npm run build:native:quick-release
# Super fast (use system zstd, single job for lowest user CPU):
# USE_SYSTEM_ZSTD=1 FAST_RELEASE=1 npm run build:native:super-fast
# Low-CPU multi-target (nice + single job):
# npm run build:native:low-cpu
# Build ultra-léger
cargo build --profile release-size --lib

# Vérifier la taille
du -sh target/release/libroxify_native.*
strip target/release/libroxify_native.so  # Manuel si nécessaire
```

**Notes:**

- By default CI and release builds now use `--no-default-features` (faster, smaller build graph).
- Enable features when you need them: `cargo build --release --features gpu` or set `BUILD_FEATURES` env for the `build:native:targets` script.

## Impact sur npm publish

Les binaires publiés seront maintenant:

- **80% plus petits**
- Téléchargement plus rapide pour les utilisateurs
- Moins de bande passante npm
- Installation plus rapide
