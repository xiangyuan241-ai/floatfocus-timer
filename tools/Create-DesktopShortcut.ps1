$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
$assetsDir = Join-Path $projectRoot 'assets'
$iconPath = Join-Path $assetsDir 'FloatFocusTimer.ico'
$launcherPath = Join-Path $scriptDir 'Start-FloatFocusTimer.vbs'
$desktopDir = [Environment]::GetFolderPath('DesktopDirectory')
$shortcutPath = Join-Path $desktopDir 'FloatFocus Timer.lnk'

function New-FloatFocusIcon {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    Add-Type -AssemblyName System.Drawing

    if (-not (Test-Path $assetsDir)) {
        New-Item -ItemType Directory -Path $assetsDir | Out-Null
    }

    $size = 256
    $bitmap = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.Clear([System.Drawing.Color]::Transparent)

    $outerRect = New-Object System.Drawing.RectangleF 14, 14, 228, 228
    $clockRect = New-Object System.Drawing.RectangleF 46, 46, 164, 164

    $bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        $outerRect,
        [System.Drawing.Color]::FromArgb(255, 19, 24, 32),
        [System.Drawing.Color]::FromArgb(255, 40, 59, 69),
        315
    )
    $graphics.FillEllipse($bgBrush, $outerRect)

    $rimPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 98, 226, 198)), 12
    $rimPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $rimPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $graphics.DrawEllipse($rimPen, $clockRect)

    $progressPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 255, 173, 91)), 18
    $progressPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $progressPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $graphics.DrawArc($progressPen, $clockRect, -90, 120)

    $handPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 246, 250, 252)), 12
    $handPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $handPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $graphics.DrawLine($handPen, 128, 128, 128, 76)
    $graphics.DrawLine($handPen, 128, 128, 168, 144)

    $centerBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 246, 250, 252))
    $graphics.FillEllipse($centerBrush, 116, 116, 24, 24)

    $focusBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 98, 226, 198))
    $graphics.FillEllipse($focusBrush, 184, 54, 20, 20)

    $pngStream = New-Object System.IO.MemoryStream
    $bitmap.Save($pngStream, [System.Drawing.Imaging.ImageFormat]::Png)
    $pngBytes = $pngStream.ToArray()

    $fileStream = [System.IO.File]::Open($Path, [System.IO.FileMode]::Create)
    $writer = New-Object System.IO.BinaryWriter $fileStream

    $writer.Write([UInt16]0)
    $writer.Write([UInt16]1)
    $writer.Write([UInt16]1)
    $writer.Write([Byte]0)
    $writer.Write([Byte]0)
    $writer.Write([Byte]0)
    $writer.Write([Byte]0)
    $writer.Write([UInt16]1)
    $writer.Write([UInt16]32)
    $writer.Write([UInt32]$pngBytes.Length)
    $writer.Write([UInt32]22)
    $writer.Write($pngBytes)

    $writer.Dispose()
    $fileStream.Dispose()
    $pngStream.Dispose()
    $focusBrush.Dispose()
    $centerBrush.Dispose()
    $handPen.Dispose()
    $progressPen.Dispose()
    $rimPen.Dispose()
    $bgBrush.Dispose()
    $graphics.Dispose()
    $bitmap.Dispose()
}

if (-not (Test-Path $launcherPath)) {
    throw "Launcher not found: $launcherPath"
}

try {
    New-FloatFocusIcon -Path $iconPath
} catch {
    Write-Warning "Could not generate custom icon. The shortcut will use Electron's default icon. $($_.Exception.Message)"
    $iconPath = Join-Path $projectRoot 'node_modules\electron\dist\electron.exe'
}

$wscriptPath = Join-Path $env:WINDIR 'System32\wscript.exe'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $wscriptPath
$shortcut.Arguments = '"' + $launcherPath + '"'
$shortcut.WorkingDirectory = $projectRoot
$shortcut.Description = 'Launch FloatFocus Timer'

if (Test-Path $iconPath) {
    $shortcut.IconLocation = $iconPath
}

$shortcut.Save()

Write-Host "Created desktop shortcut: $shortcutPath"
