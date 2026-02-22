#!/bin/bash

# Fichier ou dossier cible
TARGET=$1
if [ -z "$TARGET" ]; then
    echo "Usage: ./bench.sh <fichier_ou_dossier>"
    exit 1
fi

# Préparation d'une archive tar si c'est un dossier (pour un test équitable)
TEST_FILE="bench_data.tar"
if [ -d "$TARGET" ]; then
    tar -cf $TEST_FILE "$TARGET"
else
    cp "$TARGET" $TEST_FILE
fi

ORIGINAL_SIZE=$(stat -c%s "$TEST_FILE")
echo "📊 Fichier de test : $TEST_FILE ($ORIGINAL_SIZE octets)"
echo "--------------------------------------------------------"

# 1. Test GZIP (Standard de l'industrie)
echo "🚀 Test GZIP (Niveau 9)..."
/usr/bin/time -f "Temps: %e s" gzip -k -9 -f $TEST_FILE
GZIP_SIZE=$(stat -c%s "${TEST_FILE}.gz")
echo "Taille: $GZIP_SIZE octets"

# 2. Test 7Z / LZMA2 (Le champion du ratio)
echo -e "\n🚀 Test 7ZIP (LZMA2 - Niveau 9)..."
/usr/bin/time -f "Temps: %e s" 7z a -t7z -m0=lzma2 -mx=9 "${TEST_FILE}.7z" $TEST_FILE > /dev/null
Z7_SIZE=$(stat -c%s "${TEST_FILE}.7z")
echo "Taille: $Z7_SIZE octets"

# 3. Test RoxCompressor (Notre monstre)
echo -e "\n🚀 Test ROX (Zstd Niveau 19+LDM - Mode Compact)..."
/usr/bin/time -f "Temps: %e s" npx rox encode $TEST_FILE output.png -q 11 -m compact > /dev/null
ROX_SIZE=$(stat -c%s "output.png")
echo "Taille: $ROX_SIZE octets"

echo -e "\n🏁 --- RÉSUMÉ DES TAILLES --- 🏁"
echo "Original : $ORIGINAL_SIZE"
echo "Gzip     : $GZIP_SIZE"
echo "7Zip     : $Z7_SIZE"
echo "Rox      : $ROX_SIZE"

# Nettoyage
rm -f $TEST_FILE "${TEST_FILE}.gz" "${TEST_FILE}.7z" "output.png"
