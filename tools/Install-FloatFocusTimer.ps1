$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
$shortcutScript = Join-Path $scriptDir 'Create-DesktopShortcut.ps1'

function Get-RequiredCommand {
    param([Parameter(Mandatory = $true)][string]$Name)

    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if (-not $command) {
        throw "$Name was not found. Install Node.js LTS from https://nodejs.org/ and run this script again."
    }

    return $command.Source
}

if (-not (Test-Path (Join-Path $projectRoot 'package.json'))) {
    throw "package.json not found. Please run this script from the FloatFocus Timer project folder."
}

$nodeCommand = Get-RequiredCommand 'node'
$npmCommand = Get-Command 'npm.cmd' -ErrorAction SilentlyContinue
if (-not $npmCommand) {
    $npmCommand = Get-Command 'npm' -ErrorAction SilentlyContinue
}
if (-not $npmCommand) {
    throw "npm was not found. Install Node.js LTS from https://nodejs.org/ and run this script again."
}
$npmPath = $npmCommand.Source

Set-Location $projectRoot

Write-Host "Using Node.js: $nodeCommand"
Write-Host "Installing FloatFocus Timer dependencies..."
& $npmPath install
if ($LASTEXITCODE -ne 0) {
    throw "npm install failed."
}

Write-Host "Creating desktop shortcut..."
& $shortcutScript
if ($LASTEXITCODE -ne 0) {
    throw "Could not create desktop shortcut."
}

Write-Host ""
Write-Host "Done. Launch FloatFocus Timer from the desktop shortcut."
