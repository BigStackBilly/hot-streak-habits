Add-Type -AssemblyName System.Drawing

$outDir = $PSScriptRoot

function New-Pt([double]$x, [double]$y) {
  return New-Object -TypeName System.Drawing.PointF -ArgumentList $x, $y
}

function New-RoundedRectPath([double]$x, [double]$y, [double]$w, [double]$h, [double]$r) {
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $path.AddArc($x, $y, $d, $d, 180, 90)
  $path.AddArc(($x+$w-$d), $y, $d, $d, 270, 90)
  $path.AddArc(($x+$w-$d), ($y+$h-$d), $d, $d, 0, 90)
  $path.AddArc($x, ($y+$h-$d), $d, $d, 90, 90)
  $path.CloseFigure()
  return $path
}

# A horizontal capsule (fully rounded rectangle) used for the barbell shaft.
function New-CapsulePath([double]$x1, [double]$y, [double]$x2, [double]$thickness) {
  $r = $thickness / 2.0
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddArc(($x1 - $r), ($y - $r), ($thickness), ($thickness), 90, 180)
  $path.AddArc(($x2 - $r), ($y - $r), ($thickness), ($thickness), 270, 180)
  $path.CloseFigure()
  return $path
}

function Draw-Plate($g, [double]$cx, [double]$cy, [double]$outerR, [double]$holeR, $colorLight, $colorDark, $holeColor, $rimColor) {
  $rect = New-Object System.Drawing.RectangleF ([single]($cx-$outerR)), ([single]($cy-$outerR)), ([single]($outerR*2)), ([single]($outerR*2))
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddEllipse($rect)
  $brush = New-Object System.Drawing.Drawing2D.PathGradientBrush($path)
  $brush.CenterColor = $colorLight
  $brush.SurroundColors = @($colorDark)
  $g.FillPath($brush, $path)

  $rimW = [Math]::Max(2, $outerR*0.045)
  $rimPen = New-Object System.Drawing.Pen ($rimColor), ([single]$rimW)
  $g.DrawEllipse($rimPen, $rect)

  $holeBrush = New-Object System.Drawing.SolidBrush ($holeColor)
  $g.FillEllipse($holeBrush, [single]($cx-$holeR), [single]($cy-$holeR), [single]($holeR*2), [single]($holeR*2))

  # Small gloss highlight, upper-left of the plate.
  $glossBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(70, 255, 255, 255))
  $gr = $outerR * 0.34
  $gx = $cx - $outerR*0.42
  $gy = $cy - $outerR*0.52
  $g.FillEllipse($glossBrush, [single]($gx-$gr*0.5), [single]($gy-$gr*0.7), [single]($gr*1.4), [single]($gr*1.0))

  $glossBrush.Dispose(); $holeBrush.Dispose(); $rimPen.Dispose(); $brush.Dispose(); $path.Dispose()
}

function Render-Icon([int]$canvasSize, [string]$outFile, [bool]$withMargin) {
  $bmp = New-Object System.Drawing.Bitmap $canvasSize, $canvasSize, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

  $charcoalBg = [System.Drawing.Color]::FromArgb(255, 18, 19, 22)
  $g.Clear($charcoalBg)

  $margin = 0
  if ($withMargin) { $margin = [int]($canvasSize * 0.028) }
  $sq = $canvasSize - ($margin * 2)
  $radius = $sq * 0.225

  $bgPath = New-RoundedRectPath $margin $margin $sq $sq $radius
  $charcoal1 = [System.Drawing.Color]::FromArgb(255, 35, 38, 48)
  $charcoal2 = [System.Drawing.Color]::FromArgb(255, 16, 17, 20)
  $p1 = New-Pt $margin $margin
  $p2 = New-Pt ($margin+$sq) ($margin+$sq)
  $bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $p1, $p2, $charcoal1, $charcoal2
  $g.FillPath($bgBrush, $bgPath)

  $borderW = [Math]::Max(2, $canvasSize*0.006)
  $borderPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(50, 255, 138, 61)), ([single]$borderW)
  $g.DrawPath($borderPen, $bgPath)

  $cx = $canvasSize * 0.5
  $cy = $canvasSize * 0.5

  # --- Barbell shaft: light steel capsule running behind the plates ---
  $plateOffset = $canvasSize * 0.27
  $barThickness = $canvasSize * 0.075
  $barPath = New-CapsulePath ($cx - $plateOffset) $cy ($cx + $plateOffset) $barThickness
  $steelLight = [System.Drawing.Color]::FromArgb(255, 214, 219, 226)
  $steelDark  = [System.Drawing.Color]::FromArgb(255, 148, 155, 166)
  $barBrushP1 = New-Pt $cx ($cy - $barThickness/2)
  $barBrushP2 = New-Pt $cx ($cy + $barThickness/2)
  $barBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $barBrushP1, $barBrushP2, $steelLight, $steelDark
  $g.FillPath($barBrush, $barPath)

  # End sleeves just inside each plate — slightly thicker collar segments.
  $sleeveThickness = $barThickness * 1.35
  $sleeveLen = $canvasSize * 0.05
  foreach ($side in @(-1, 1)) {
    $sx = $cx + ($side * $plateOffset) - ($side * $sleeveLen * 0.5)
    $sleeveRect = New-Object System.Drawing.RectangleF ([single]($sx - $sleeveLen/2)), ([single]($cy - $sleeveThickness/2)), ([single]$sleeveLen), ([single]$sleeveThickness)
    $sleeveBrush = New-Object System.Drawing.SolidBrush ($steelDark)
    $g.FillRectangle($sleeveBrush, $sleeveRect)
    $sleeveBrush.Dispose()
  }

  $barBrush.Dispose(); $barPath.Dispose()

  # --- Plates: hot-orange "iron" gradient, one per end ---
  $outerR = $canvasSize * 0.185
  $holeR = $canvasSize * 0.058
  $ironLight = [System.Drawing.Color]::FromArgb(255, 255, 138, 61)
  $ironDark  = [System.Drawing.Color]::FromArgb(255, 224, 74, 15)
  $holeColor = [System.Drawing.Color]::FromArgb(255, 18, 19, 22)
  $rimColor  = [System.Drawing.Color]::FromArgb(255, 120, 40, 8)

  Draw-Plate $g ($cx - $plateOffset) $cy $outerR $holeR $ironLight $ironDark $holeColor $rimColor
  Draw-Plate $g ($cx + $plateOffset) $cy $outerR $holeR $ironLight $ironDark $holeColor $rimColor

  $bmp.Save($outFile, [System.Drawing.Imaging.ImageFormat]::Png)

  $borderPen.Dispose(); $bgBrush.Dispose(); $bgPath.Dispose()
  $g.Dispose(); $bmp.Dispose()
}

Render-Icon 1024 (Join-Path $outDir "AppStoreIcon-1024.png") $false
Render-Icon 512 (Join-Path $outDir "icon-512.png") $true
Render-Icon 192 (Join-Path $outDir "icon-192.png") $true

Write-Host "Icons generated in $outDir"
