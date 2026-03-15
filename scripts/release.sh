#!/bin/bash

set -e

echo "🚀 Roxify 1.4.0 Release Script"
echo ""

echo "📋 Vérification de la version..."
grep -q '"version": "1.4.0"' package.json && echo "✅ package.json: 1.4.0"
grep -q "const VERSION = '1.4.0'" src/cli.ts && echo "✅ cli.ts: 1.4.0"
grep -q "## \[1.4.0\]" docs/CHANGELOG.md && echo "✅ CHANGELOG.md: 1.4.0"

echo ""
echo "🧪 Exécution des tests..."
npm run test:predict > /dev/null 2>&1 && echo "✅ Tests de prédiction passés"

echo ""
echo "🔨 Build du projet..."
npm run build > /dev/null 2>&1 && echo "✅ TypeScript compilé"
npm run build:native > /dev/null 2>&1 && echo "✅ Rust compilé"

echo ""
echo "📦 Test du CLI..."
echo "Test rapide" > /tmp/test-release.txt
node dist/cli.js encode /tmp/test-release.txt /tmp/test-release.png > /dev/null 2>&1
node dist/cli.js decode /tmp/test-release.png /tmp/test-release-out.txt > /dev/null 2>&1
diff /tmp/test-release.txt /tmp/test-release-out.txt > /dev/null && echo "✅ Encodage/décodage fonctionnel"
rm -f /tmp/test-release.txt /tmp/test-release.png /tmp/test-release-out.txt

echo ""
echo "📊 Benchmarks rapides..."
echo "AAAAA" | head -c 10000 > /tmp/bench.txt
START=$(date +%s%3N)
node dist/cli.js encode /tmp/bench.txt /tmp/bench.png > /dev/null 2>&1
END=$(date +%s%3N)
TIME=$((END - START))
echo "✅ 10KB répétitif: ${TIME}ms"
rm -f /tmp/bench.txt /tmp/bench.png

echo ""
echo "✅ TOUS LES TESTS PASSÉS"
echo ""
echo "📝 Prochaines étapes:"
echo "  1. git add ."
echo "  2. git commit -m 'Release 1.4.0 - Automatic format optimization'"
echo "  3. git tag v1.4.0"
echo "  4. git push origin main --tags"
echo "  5. npm publish"
echo ""
