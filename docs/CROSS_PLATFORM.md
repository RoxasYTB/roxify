# Cross-Platform Build Instructions

## Compilation Native Multi-Plateforme

Roxify utilise Rust natif et doit être compilé pour chaque plateforme cible.

### Plateformes Supportées

- **Linux x64** : `x86_64-unknown-linux-gnu` (.so)
- **macOS x64** : `x86_64-apple-darwin` (.dylib)
- **macOS ARM64** : `aarch64-apple-darwin` (.dylib)
- **Windows x64** : `x86_64-pc-windows-msvc` (.dll)

### Build Local (plateforme courante)

```bash
npm run build:native
```

Cela compile le module natif pour votre plateforme et le copie automatiquement en `libroxify_native.node`.

### Build Multi-Plateforme

#### Option 1 : Script automatique (Linux/macOS)

```bash
node scripts/build-all-platforms.js
```

Ce script tente de compiler pour toutes les plateformes. Cela nécessite :

- Les toolchains Rust pour chaque cible
- Les linkers appropriés

#### Option 2 : GitHub Actions (Recommandé)

Le workflow `.github/workflows/build.yml` compile automatiquement pour toutes les plateformes lors d'un push de tag :

```bash
git tag v1.5.0
git push origin v1.5.0
```

Les artifacts seront disponibles dans l'onglet Actions de GitHub.

#### Option 3 : Build par plateforme

**Linux :**

```bash
npm run build:native:linux
```

**macOS x64 :**

```bash
npm run build:native:macos-x64
```

**macOS ARM64 :**

```bash
npm run build:native:macos-arm
```

**Windows :**

```bash
npm run build:native:windows
```

### Installation des Cibles Rust

Avant de compiler pour une plateforme, installez la cible :

```bash
rustup target add x86_64-unknown-linux-gnu
rustup target add x86_64-apple-darwin
rustup target add aarch64-apple-darwin
rustup target add x86_64-pc-windows-msvc
```

### Cross-Compilation Avancée

Pour compiler depuis Linux vers d'autres plateformes, utilisez `cross` :

```bash
cargo install cross
cross build --release --lib --target x86_64-apple-darwin
cross build --release --lib --target x86_64-pc-windows-gnu
```

### Distribution

Le package npm inclut uniquement `libroxify_native.node` (le binaire natif pour la plateforme courante, renommé en `.node`). Les builds précompilés pour chaque plateforme peuvent être fournis séparément comme artifacts de release (GitHub Actions) mais ne sont pas inclus dans le package npm.

Le module détecte automatiquement la plateforme au runtime et charge le binaire concerné (via `libroxify_native.node`).

### Détection Automatique

Le fichier `src/utils/native.ts` détecte automatiquement :

1. La plateforme (linux, darwin, win32)
2. L'architecture (x64, arm64)
3. Charge le binaire approprié

Si aucun binaire pré-compilé n'est trouvé, une erreur claire indique quelle plateforme est manquante.
