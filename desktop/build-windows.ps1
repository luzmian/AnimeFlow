$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
foreach ($tool in @("node", "npm", "cargo", "rustc", "python")) {
 if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "Required build tool missing: $tool. See DESKTOP.md." }
}
python -m pip install -r requirements-build.txt
if ($LASTEXITCODE -ne 0) { throw "Python build dependencies failed" }
npm ci
if ($LASTEXITCODE -ne 0) { throw "npm ci failed" }
npm run desktop:build
if ($LASTEXITCODE -ne 0) { throw "Desktop build failed; no installer is claimed" }
$exe = Join-Path $PSScriptRoot "src-tauri/target/release/animeflow.exe"
if (-not (Test-Path $exe)) { throw "Missing desktop executable" }
Write-Host "Built executable: $exe"
Write-Host "Installer directory: src-tauri/target/release/bundle/nsis"
