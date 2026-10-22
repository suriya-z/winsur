Add-Type -AssemblyName System.Drawing
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$assetsDir = Join-Path $root "assets\icons"
$buildDir = Join-Path $root "build"
New-Item -ItemType Directory -Force -Path $assetsDir | Out-Null
New-Item -ItemType Directory -Force -Path $buildDir | Out-Null

function Make-WinsurBitmap([int]$size) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)

    $pad = [float]([Math]::Max(1.0, $size * 0.06))
    $rectSize = [float]($size - $pad * 2)
    $radius = [float]($size * 0.24)

    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $radius * 2
    $path.AddArc($pad, $pad, $d, $d, 180, 90)
    $path.AddArc($pad + $rectSize - $d, $pad, $d, $d, 270, 90)
    $path.AddArc($pad + $rectSize - $d, $pad + $rectSize - $d, $d, $d, 0, 90)
    $path.AddArc($pad, $pad + $rectSize - $d, $d, $d, 90, 90)
    $path.CloseFigure()

    $bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        (New-Object System.Drawing.PointF(0, 0)),
        (New-Object System.Drawing.PointF($size, $size)),
        [System.Drawing.Color]::FromArgb(255, 20, 20, 24),
        [System.Drawing.Color]::FromArgb(255, 10, 10, 12)
    )
    $g.FillPath($bgBrush, $path)

    $borderPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(110, 148, 163, 184), [Math]::Max(1.0, $size * 0.04))
    $g.DrawPath($borderPen, $path)

    $penW = [float]([Math]::Max(1.6, $size * 0.095))
    $wPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 74, 222, 128), $penW)
    $wPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $wPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $wPen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round

    $pts = @(
        (New-Object System.Drawing.PointF(($size * 0.23), ($size * 0.34))),
        (New-Object System.Drawing.PointF(($size * 0.36), ($size * 0.68))),
        (New-Object System.Drawing.PointF(($size * 0.50), ($size * 0.44))),
        (New-Object System.Drawing.PointF(($size * 0.64), ($size * 0.68))),
        (New-Object System.Drawing.PointF(($size * 0.77), ($size * 0.34)))
    )
    $g.DrawLines($wPen, $pts)

    $wPen.Dispose()
    $borderPen.Dispose()
    $bgBrush.Dispose()
    $path.Dispose()
    $g.Dispose()
    return $bmp
}

foreach ($entry in @(
    @{ Name = "32x32.png"; Size = 32 },
    @{ Name = "128x128.png"; Size = 128 },
    @{ Name = "128x128@2x.png"; Size = 256 },
    @{ Name = "icon.png"; Size = 256 }
)) {
    $b = Make-WinsurBitmap $entry.Size
    $p = Join-Path $assetsDir $entry.Name
    $b.Save($p, [System.Drawing.Imaging.ImageFormat]::Png)
    $b.Dispose()
}

$bBuild = Make-WinsurBitmap 256
$outPng = Join-Path $buildDir "icon.png"
$bBuild.Save($outPng, [System.Drawing.Imaging.ImageFormat]::Png)
$bBuild.Dispose()

$icoSizes = @(16, 32, 48, 256)
$pngBlobs = @()
foreach ($sz in $icoSizes) {
    $b = Make-WinsurBitmap $sz
    $ms = New-Object System.IO.MemoryStream
    $b.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $pngBlobs += ,($ms.ToArray())
    $ms.Dispose()
    $b.Dispose()
}

foreach ($icoPath in @((Join-Path $assetsDir "icon.ico"), (Join-Path $buildDir "icon.ico"))) {
    $fs = [System.IO.File]::Open($icoPath, [System.IO.FileMode]::Create)
    $bw = New-Object System.IO.BinaryWriter($fs)
    $bw.Write([uint16]0)
    $bw.Write([uint16]1)
    $bw.Write([uint16]$icoSizes.Count)
    $offset = 6 + (16 * $icoSizes.Count)
    for ($i = 0; $i -lt $icoSizes.Count; $i++) {
        $sz = $icoSizes[$i]
        $blob = $pngBlobs[$i]
        $wByte = if ($sz -ge 256) { [byte]0 } else { [byte]$sz }
        $bw.Write($wByte)
        $bw.Write($wByte)
        $bw.Write([byte]0)
        $bw.Write([byte]0)
        $bw.Write([uint16]1)
        $bw.Write([uint16]32)
        $bw.Write([uint32]$blob.Length)
        $bw.Write([uint32]$offset)
        $offset += $blob.Length
    }
    for ($i = 0; $i -lt $icoSizes.Count; $i++) {
        $bw.Write($pngBlobs[$i])
    }
    $bw.Flush()
    $bw.Close()
    $fs.Close()
}
Write-Host "Wrote $outPng and icons"
