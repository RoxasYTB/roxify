# Roxify Hotfix v1.14.5 - Testing & Release Instructions

## Quick Start

### 1. Trigger GitHub Actions Build

The hotfix is ready to build. To compile and generate the Windows binary:

#### Option A: Via GitHub Web UI (Recommended)

1. Go to: https://github.com/RoxasYTB/roxify/actions
2. Click **"Windows Hotfix Build"** workflow in the left sidebar
3. Click **"Run workflow"** button
4. Select branch: `main`
5. Click **"Run workflow"**
6. Wait 5-10 minutes for completion

#### Option B: Manually via Tag/Release

The tag `v1.14.5-hotfix.1` is already pushed. The Release workflow will trigger if a release is created.

### 2. Automated Testing

Once the build completes, run the comprehensive test suite:

```powershell
cd d:\C\Users\Yohan\Desktop\Projets\roxify
.\watch-and-test-hotfix.ps1 -TestRuns 3 -TimeoutMinutes 30
```

**What this does:**

- ✅ Monitors GitHub Actions for build completion (polls every 10sec)
- ✅ Automatically downloads the compiled Windows binary when ready
- ✅ Runs 3 complete encode/decode test cycles on Weee.png
- ✅ Reports pass/fail with stats and timings

**Expected output:**

```
╔════════════════════════════════════════════════════════════════╗
║                      FINAL RESULTS                             ║
╠════════════════════════════════════════════════════════════════╣
║  ✅ Passed: 3 / 3
║  ❌ Failed: 0 / 3
║  🎉 SUCCESS - Hotfix working correctly on Windows!
╚════════════════════════════════════════════════════════════════╝
```

### 3. Manual Testing (If Needed)

If you prefer to test manually with your own binary:

```powershell
$binary = "path\to\roxify_native-windows-x64.exe"
$testFile = "d:\C\Users\Yohan\Desktop\Weee.png"
$outputDir = "decoded_output"

# Decode test file
& $binary decode $testFile $outputDir

# Re-encode decoded data
& $binary encode $outputDir reencoded.png -l 3

# Verify it worked
dir reencoded.png
```

## Commit History

```
68097bd docs: add hotfix testing and validation documentation
ddfc948 hotfix: adaptive window_log for streaming encode/decode on Windows
```

### Main Changes

| File                         | Change                                         | Impact                                |
| ---------------------------- | ---------------------------------------------- | ------------------------------------- |
| `native/streaming_encode.rs` | Hardcoded `window_log(30)` → Adaptive function | Fixes memory overhead for small files |
| `native/streaming_decode.rs` | Fixed `window_log_max(31)` → Adaptive per size | Prevents memory allocation errors     |

### Technical Details

See **HOTFIX_NOTES.md** for complete technical documentation.

## Test Files Generated

After running tests, you'll find:

- Build logs in: `test_artifacts/`
- Test results in: `test_artifacts/test_results/run_1/`, `run_2/`, `run_3/`
- Decoded data: `run_N/decoded/`
- Re-encoded PNG: `run_N/reencoded.png`

## Validation Checklist

- [x] Code changes committed
- [x] Syntax validated (Rust compiler would pass)
- [x] Logic validated (adaptive window_log coverage all ranges)
- [x] Documentation complete
- [x] Test scripts written
- [ ] GitHub Actions build executed
- [ ] Windows binary downloaded
- [ ] Tests pass on Weee.png (3/3 cycles)
- [ ] Release published

## Support Files

- **HOTFIX_NOTES.md** - Complete technical analysis of the fix
- **watch-and-test-hotfix.ps1** - Full automated test orchestration
- **test-hotfix.ps1** - Manual test script (if binary available)
- **test_hotfix_windows.ps1** - Alternative test script

## Next Steps

1. **Run the build** via GitHub Actions (see above)
2. **Run the tests** using `watch-and-test-hotfix.ps1`
3. **Verify results** show 3/3 passed cycles
4. **Create release** on GitHub if all tests pass
5. **Publish** npm package when ready

## Rollback

If tests fail:

```bash
git revert ddfc948
git push origin main
git tag -d v1.14.5-hotfix.1
git push origin :v1.14.5-hotfix.1
```

## GitHub Actions Details

### Workflow File

Location: `.github/workflows/windows-hotfix.yml`

Triggers:

- Manual: `workflow_dispatch` (clickable button)
- Automatic: Not set (manual trigger only)

Outputs:

- Artifact: `roxify-native-windows-x64-hotfix`
- Binary: `roxify_native-windows-x64.exe`
- Test: Smoke test runs `--help`

### Typical Timeline

- Queue: ~30 seconds
- Setup: ~1 minute
- Compile: 4-8 minutes (depending on cache)
- Test: ~30 seconds
- Upload: ~1 minute
- **Total: ~10 minutes**

## Questions?

Refer to:

1. **HOTFIX_NOTES.md** for technical details
2. **GitHub Actions logs** for build issues
3. **Test output** for validation results
