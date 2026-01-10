const fs = require('fs');
const { nativeZstdCompress } = require('./libroxify_native.node');

const data = fs.readFileSync('/home/yohan/test-compression-data/test-200mb.bin');
console.log('Input:', (data.length / 1024 / 1024).toFixed(2), 'MB');

const start = Date.now();
const compressed = nativeZstdCompress(data, 19);
const elapsed = Date.now() - start;

console.log('Output:', (compressed.length / 1024 / 1024).toFixed(2), 'MB');
console.log('Ratio:', ((compressed.length / data.length) * 100).toFixed(1) + '%');
console.log('Time:', (elapsed / 1000).toFixed(2) + 's');
