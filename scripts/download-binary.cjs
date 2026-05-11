const https = require('https');
const { createWriteStream, existsSync, mkdirSync, chmodSync, unlinkSync } = require('fs');
const { join } = require('path');
const { platform, arch } = require('os');

const GITHUB_REPO = 'RoxasYTB/roxify';
const DIST_DIR = join(__dirname, '..', 'dist');
const root = join(__dirname, '..');

function getPlatformBinary() {
    const os = platform();
    const cpu = arch();

    const map = {
        linux: { x64: 'roxify_native', arm64: 'roxify_native' },
        win32: { x64: 'roxify_native.exe', arm64: 'roxify_native.exe' },
        darwin: { x64: 'rox-macos-universal', arm64: 'rox-macos-universal' },
    };

    return (map[os] && map[os][cpu]) || null;
}

function getReleaseAssetName(version) {
    const os = platform();
    const cpu = arch();

    // Map platform/arch to release asset names as uploaded by GitHub Actions
    const map = {
        linux: {
            x64: `roxify_native-x86_64-unknown-linux-gnu`,
            arm64: `roxify_native-aarch64-unknown-linux-gnu`
        },
        win32: {
            x64: `roxify_native-x86_64-pc-windows-msvc.exe`,
            arm64: `roxify_native-aarch64-pc-windows-msvc.exe`
        },
        darwin: {
            x64: `rox-macos-universal`,
            arm64: `rox-macos-universal`
        },
    };

    return (map[os] && map[os][cpu]) || null;
}

function getNativeLibAssetName(version) {
    const os = platform();
    const cpu = arch();

    const triples = {
        linux: { x64: 'x86_64-unknown-linux-gnu', arm64: 'aarch64-unknown-linux-gnu' },
        win32: { x64: 'x86_64-pc-windows-msvc', arm64: 'aarch64-pc-windows-msvc' },
        darwin: { x64: 'x86_64-apple-darwin', arm64: 'aarch64-apple-darwin' },
    };

    const triple = triples[os] && triples[os][cpu];
    if (!triple) return null;

    return `roxify_native-${triple}.node`;
}

function downloadFile(url, dest, maxRedirects = 5) {
    return new Promise((resolve, reject) => {
        if (maxRedirects <= 0) {
            reject(new Error('Too many redirects'));
            return;
        }

        const file = createWriteStream(dest);
        const request = https.get(url, { timeout: 60000 }, (response) => {
            // Handle redirects
            if (response.statusCode === 302 || response.statusCode === 301) {
                const location = response.headers.location;
                if (location) {
                    file.close();
                    // Clean up partial file
                    try { unlinkSync(dest); } catch { }
                    downloadFile(location, dest, maxRedirects - 1).then(resolve).catch(reject);
                    return;
                }
            }

            if (response.statusCode !== 200) {
                file.close();
                try { unlinkSync(dest); } catch { }
                reject(new Error(`HTTP ${response.statusCode} for ${url}`));
                return;
            }

            let downloaded = 0;
            response.on('data', (chunk) => {
                downloaded += chunk.length;
            });

            response.pipe(file);

            file.on('finish', () => {
                file.close();
                console.log(`roxify: Downloaded ${(downloaded / 1024 / 1024).toFixed(2)} MB`);
                resolve();
            });
        });

        request.on('error', (err) => {
            file.close();
            try { unlinkSync(dest); } catch { }
            reject(err);
        });

        request.on('timeout', () => {
            request.destroy();
            file.close();
            try { unlinkSync(dest); } catch { }
            reject(new Error('Request timeout'));
        });
    });
}

async function getLatestReleaseVersion() {
    const url = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;

    return new Promise((resolve, reject) => {
        https.get(url, {
            headers: {
                'User-Agent': 'roxify-install',
                'Accept': 'application/vnd.github.v3+json'
            },
            timeout: 10000
        }, (response) => {
            if (response.statusCode !== 200) {
                reject(new Error(`GitHub API HTTP ${response.statusCode}`));
                return;
            }

            let data = '';
            response.on('data', chunk => data += chunk);
            response.on('end', () => {
                try {
                    const release = JSON.parse(data);
                    const version = release.tag_name.replace(/^v/, '');
                    resolve(version);
                } catch (e) {
                    reject(new Error('Failed to parse GitHub API response'));
                }
            });
        }).on('error', reject).on('timeout', function () { this.destroy(); reject(new Error('API timeout')); });
    });
}

async function downloadBinary() {
    let version;
    try {
        version = require('../package.json').version;
    } catch (e) {
        version = '1.14.2';
    }

    // Try to get latest release version from GitHub
    try {
        const latestVersion = await getLatestReleaseVersion();
        if (latestVersion && latestVersion !== version) {
            console.log(`roxify: Latest release is v${latestVersion} (package is v${version})`);
            version = latestVersion;
        }
    } catch (e) {
        console.log(`roxify: Using package version v${version} (could not check latest: ${e.message})`);
    }

    const binaryName = getPlatformBinary();
    const assetName = getReleaseAssetName(version);

    if (!binaryName || !assetName) {
        console.log(`roxify: Unsupported platform ${platform()}/${arch()}`);
        return false;
    }

    if (!existsSync(DIST_DIR)) {
        mkdirSync(DIST_DIR, { recursive: true });
    }

    const destPath = join(DIST_DIR, binaryName);

    // Check if already exists
    if (existsSync(destPath)) {
        console.log(`roxify: CLI binary already exists at ${destPath}`);
        return true;
    }

    const url = `https://github.com/${GITHUB_REPO}/releases/download/v${version}/${assetName}`;

    console.log(`roxify: Downloading ${assetName} from GitHub...`);
    console.log(`roxify: URL: ${url}`);

    try {
        await downloadFile(url, destPath);

        if (platform() !== 'win32') {
            try { chmodSync(destPath, 0o755); } catch { }
        }

        console.log(`roxify: CLI binary ready at ${destPath}`);
        return true;
    } catch (e) {
        console.log(`roxify: Download failed: ${e.message}`);
        // Clean up partial download
        try { unlinkSync(destPath); } catch { }
        return false;
    }
}

async function downloadNativeLib() {
    let version;
    try {
        version = require('../package.json').version;
    } catch (e) {
        version = '1.14.2';
    }

    // Try to get latest release version from GitHub
    try {
        const latestVersion = await getLatestReleaseVersion();
        if (latestVersion && latestVersion !== version) {
            version = latestVersion;
        }
    } catch (e) {
        // Use package version
    }

    const assetName = getNativeLibAssetName(version);

    if (!assetName) {
        console.log(`roxify: Unsupported platform for native lib ${platform()}/${arch()}`);
        return false;
    }

    const destPath = join(root, assetName);

    // Check if already exists
    if (existsSync(destPath)) {
        console.log(`roxify: Native lib already exists at ${destPath}`);
        return true;
    }

    const url = `https://github.com/${GITHUB_REPO}/releases/download/v${version}/${assetName}`;

    console.log(`roxify: Downloading native lib ${assetName}...`);

    try {
        await downloadFile(url, destPath);
        console.log(`roxify: Native lib ready at ${destPath}`);
        return true;
    } catch (e) {
        console.log(`roxify: Native lib download failed: ${e.message}`);
        try { unlinkSync(destPath); } catch { }
        return false;
    }
}

module.exports = { downloadBinary, downloadNativeLib, getPlatformBinary, getLatestReleaseVersion };
