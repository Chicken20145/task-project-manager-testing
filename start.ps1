$ErrorActionPreference = 'Stop'
$editionRoot = $PSScriptRoot
$editionPython = Join-Path $editionRoot '.venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $editionPython)) {
    $editionPython = Join-Path (Split-Path (Split-Path $editionRoot -Parent) -Parent) '.venv/Scripts/python.exe'
}
if (-not (Test-Path -LiteralPath $editionPython)) { throw 'Create a local .venv or run python scripts/run_local.py with dependencies installed.' }
& $editionPython (Join-Path $editionRoot 'scripts/run_local.py')
exit $LASTEXITCODE
