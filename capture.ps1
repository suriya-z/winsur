Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$graphics = [System.Drawing.Graphics]::FromImage($bmp)
$graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)

$topCenterRect = New-Object System.Drawing.Rectangle 300, 0, 700, 200
$cropped = $bmp.Clone($topCenterRect, $bmp.PixelFormat)
$cropped.Save("C:\Users\acer\Winsur\screen_top.png", [System.Drawing.Imaging.ImageFormat]::Png)

$graphics.Dispose()
$bmp.Dispose()
$cropped.Dispose()
Write-Host "Screenshot saved"
