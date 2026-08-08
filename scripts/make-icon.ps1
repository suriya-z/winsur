Add-Type -AssemblyName System.Drawing
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$srcPath = Join-Path $root "assets\icons\128x128.png"
$outDir = Join-Path $root "build"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$outPng = Join-Path $outDir "icon.png"

$src = [System.Drawing.Image]::FromFile($srcPath)
$bmp = New-Object System.Drawing.Bitmap 256, 256
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.Clear([System.Drawing.Color]::FromArgb(255, 10, 10, 10))
$g.DrawImage($src, 0, 0, 256, 256)
$g.Dispose()
$bmp.Save($outPng, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
$src.Dispose()
Write-Host "Wrote $outPng"
