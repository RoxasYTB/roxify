# Release Notes 1.6.3

## Corrections

### Résolution du module natif sur Windows

- Simplification de la logique de recherche du module natif
- Priorité aux chemins du package installé (moduleDir/../) avant les chemins du workspace
- Correction du problème "Native module not found for win32-x64" lors de l'installation globale NPM
- Ordre de recherche optimisé :
  1. Modules avec target spécifique dans le répertoire dist (ex: `roxify_native-x86_64-pc-windows-msvc.node`)
  2. Modules génériques dans dist
  3. Modules avec target dans la racine du projet
  4. Cache de compilation Cargo
  5. node_modules

Cette version corrige spécifiquement les problèmes d'installation globale NPM sur Windows où le module cherchait dans des chemins incorrects.
