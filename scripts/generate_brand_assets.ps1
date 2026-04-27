Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$assetsDir = Join-Path $projectRoot 'assets'

$blue = [System.Drawing.Color]::FromArgb(37, 99, 235)
$blueDark = [System.Drawing.Color]::FromArgb(30, 64, 175)
$blueLight = [System.Drawing.Color]::FromArgb(147, 197, 253)
$white = [System.Drawing.Color]::FromArgb(255, 255, 255)
$dark = [System.Drawing.Color]::FromArgb(11, 17, 32)
$transparent = [System.Drawing.Color]::Transparent

function New-Bitmap([int]$width, [int]$height) {
    $bitmap = New-Object System.Drawing.Bitmap($width, $height)
    $bitmap.SetResolution(144, 144)
    return $bitmap
}

function New-Graphics($bitmap) {
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    return $graphics
}

function New-RoundedRectPath([float]$x, [float]$y, [float]$width, [float]$height, [float]$radius) {
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $diameter = $radius * 2
    $path.AddArc($x, $y, $diameter, $diameter, 180, 90)
    $path.AddArc($x + $width - $diameter, $y, $diameter, $diameter, 270, 90)
    $path.AddArc($x + $width - $diameter, $y + $height - $diameter, $diameter, $diameter, 0, 90)
    $path.AddArc($x, $y + $height - $diameter, $diameter, $diameter, 90, 90)
    $path.CloseFigure()
    return $path
}

function Draw-Trolley($graphics, [float]$scale, [float]$offsetX, [float]$offsetY, $strokeColor, $fillColor, [switch]$transparentFill) {
    $strokeWidth = 34 * $scale
    $pen = [System.Drawing.Pen]::new($strokeColor, [single]$strokeWidth)
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round

    $basketPath = New-Object System.Drawing.Drawing2D.GraphicsPath
    $basketPath.AddLine($offsetX + (280 * $scale), $offsetY + (300 * $scale), $offsetX + (690 * $scale), $offsetY + (300 * $scale))
    $basketPath.AddLine($offsetX + (690 * $scale), $offsetY + (300 * $scale), $offsetX + (640 * $scale), $offsetY + (500 * $scale))
    $basketPath.AddLine($offsetX + (640 * $scale), $offsetY + (500 * $scale), $offsetX + (360 * $scale), $offsetY + (500 * $scale))
    $basketPath.AddLine($offsetX + (360 * $scale), $offsetY + (500 * $scale), $offsetX + (280 * $scale), $offsetY + (300 * $scale))
    $basketPath.CloseFigure()

    if (-not $transparentFill) {
        $basketBrush = New-Object System.Drawing.SolidBrush($fillColor)
        $graphics.FillPath($basketBrush, $basketPath)
        $basketBrush.Dispose()
    }

    $graphics.DrawPath($pen, $basketPath)
    $graphics.DrawLine($pen, $offsetX + (190 * $scale), $offsetY + (210 * $scale), $offsetX + (285 * $scale), $offsetY + (300 * $scale))
    $graphics.DrawLine($pen, $offsetX + (360 * $scale), $offsetY + (500 * $scale), $offsetX + (735 * $scale), $offsetY + (500 * $scale))
    $graphics.DrawLine($pen, $offsetX + (720 * $scale), $offsetY + (500 * $scale), $offsetX + (770 * $scale), $offsetY + (410 * $scale))

    foreach ($x in 380, 460, 540, 620) {
        $innerColor = [System.Drawing.Color]::FromArgb(190, $strokeColor.R, $strokeColor.G, $strokeColor.B)
        $innerPen = [System.Drawing.Pen]::new($innerColor, [single](16 * $scale))
        $innerPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
        $innerPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
        $graphics.DrawLine($innerPen, $offsetX + ($x * $scale), $offsetY + (320 * $scale), $offsetX + (($x - 30) * $scale), $offsetY + (480 * $scale))
        $innerPen.Dispose()
    }

    foreach ($y in 360, 410, 460) {
        $graphics.DrawLine($pen, $offsetX + (320 * $scale), $offsetY + ($y * $scale), $offsetX + (670 * $scale), $offsetY + ($y * $scale))
    }

    $wheelBrush = New-Object System.Drawing.SolidBrush($strokeColor)
    $wheelDiameter = 92 * $scale
    $graphics.FillEllipse($wheelBrush, $offsetX + (360 * $scale), $offsetY + (560 * $scale), $wheelDiameter, $wheelDiameter)
    $graphics.FillEllipse($wheelBrush, $offsetX + (590 * $scale), $offsetY + (560 * $scale), $wheelDiameter, $wheelDiameter)

    $wheelInnerBrush = New-Object System.Drawing.SolidBrush($white)
    $graphics.FillEllipse($wheelInnerBrush, $offsetX + (388 * $scale), $offsetY + (588 * $scale), 36 * $scale, 36 * $scale)
    $graphics.FillEllipse($wheelInnerBrush, $offsetX + (618 * $scale), $offsetY + (588 * $scale), 36 * $scale, 36 * $scale)

    $pen.Dispose()
    $basketPath.Dispose()
    $wheelBrush.Dispose()
    $wheelInnerBrush.Dispose()
}

function Save-IconAsset() {
    $bitmap = New-Bitmap 1024 1024
    $graphics = New-Graphics $bitmap
    $graphics.Clear($white)

    $shadowPath = New-RoundedRectPath 118 118 788 788 200
    $shadowBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(18, 30, 64, 175))
    $graphics.FillPath($shadowBrush, $shadowPath)

    $cardPath = New-RoundedRectPath 108 92 808 808 210
    $cardBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        (New-Object System.Drawing.Point(0, 0)),
        (New-Object System.Drawing.Point(1024, 1024)),
        [System.Drawing.Color]::FromArgb(245, 249, 255),
        [System.Drawing.Color]::FromArgb(228, 239, 255)
    )
    $graphics.FillPath($cardBrush, $cardPath)

    Draw-Trolley $graphics 1 52 40 $blue $blueLight

    $bitmap.Save((Join-Path $assetsDir 'icon.png'), [System.Drawing.Imaging.ImageFormat]::Png)

    $shadowBrush.Dispose()
    $shadowPath.Dispose()
    $cardBrush.Dispose()
    $cardPath.Dispose()
    $graphics.Dispose()
    $bitmap.Dispose()
}

function Save-AdaptiveIconAsset() {
    $bitmap = New-Bitmap 1024 1024
    $graphics = New-Graphics $bitmap
    $graphics.Clear($transparent)

    Draw-Trolley $graphics 0.95 85 95 $blue $blueLight -transparentFill

    $bitmap.Save((Join-Path $assetsDir 'adaptive-icon.png'), [System.Drawing.Imaging.ImageFormat]::Png)
    $graphics.Dispose()
    $bitmap.Dispose()
}

function Save-FaviconAsset() {
    $bitmap = New-Bitmap 256 256
    $graphics = New-Graphics $bitmap
    $graphics.Clear($white)

    $cardPath = New-RoundedRectPath 14 14 228 228 54
    $cardBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(241, 247, 255))
    $graphics.FillPath($cardBrush, $cardPath)

    Draw-Trolley $graphics 0.22 8 10 $blue $blueLight

    $bitmap.Save((Join-Path $assetsDir 'favicon.png'), [System.Drawing.Imaging.ImageFormat]::Png)
    $cardBrush.Dispose()
    $cardPath.Dispose()
    $graphics.Dispose()
    $bitmap.Dispose()
}

function Save-SplashAsset() {
    $bitmap = New-Bitmap 1400 1400
    $graphics = New-Graphics $bitmap
    $graphics.Clear($transparent)

    $shadowBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(70, 59, 130, 246))
    $shadowFont = New-Object System.Drawing.Font('Segoe UI', 170, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $mainFont = New-Object System.Drawing.Font('Segoe UI', 170, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $bMeasure = $graphics.MeasureString('B', $mainFont)
    $flowMeasure = $graphics.MeasureString('Flow', $mainFont)
    $totalWidth = $bMeasure.Width + $flowMeasure.Width - 20
    $startX = (1400 - $totalWidth) / 2
    $startY = 540

    $graphics.DrawString('B', $shadowFont, $shadowBrush, $startX + 12, $startY + 12)
    $graphics.DrawString('Flow', $shadowFont, $shadowBrush, $startX + $bMeasure.Width - 8 + 12, $startY + 12)

    $blueBrush = New-Object System.Drawing.SolidBrush($blue)
    $whiteBrush = New-Object System.Drawing.SolidBrush($white)

    $graphics.DrawString('B', $mainFont, $blueBrush, $startX, $startY)
    $graphics.DrawString('Flow', $mainFont, $whiteBrush, $startX + $bMeasure.Width - 8, $startY)

    $lineBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(180, 96, 165, 250))
    $graphics.FillRectangle($lineBrush, [single]($startX + 55), [single]($startY + $flowMeasure.Height + 12), 430, 12)

    $bitmap.Save((Join-Path $assetsDir 'splash-icon.png'), [System.Drawing.Imaging.ImageFormat]::Png)

    $shadowBrush.Dispose()
    $shadowFont.Dispose()
    $mainFont.Dispose()
    $blueBrush.Dispose()
    $whiteBrush.Dispose()
    $lineBrush.Dispose()
    $graphics.Dispose()
    $bitmap.Dispose()
}

Save-IconAsset
Save-AdaptiveIconAsset
Save-FaviconAsset
Save-SplashAsset
