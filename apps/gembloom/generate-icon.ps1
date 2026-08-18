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

function Draw-Gem($g, [double]$cx, [double]$cy, [double]$size, $colorLight, $colorDark) {
  $state = $g.Save()
  $g.TranslateTransform([single]$cx, [single]$cy)
  $half = $size / 2.0

  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $pts = @(
    (New-Pt 0 (0-$half)),
    (New-Pt $half 0),
    (New-Pt 0 $half),
    (New-Pt (0-$half) 0)
  )
  $path.AddPolygon($pts)

  $brush = New-Object System.Drawing.Drawing2D.PathGradientBrush($path)
  $brush.CenterColor = $colorLight
  $brush.SurroundColors = @($colorDark)
  $cp = New-Pt (0 - $half*0.18) (0 - $half*0.28)
  $brush.CenterPoint = $cp
  $g.FillPath($brush, $path)

  $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(70, 20, 15, 40)), ([single]($size*0.035))
  $g.DrawPath($pen, $path)

  # facet shine line
  $glossPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(140, 255, 255, 255)), ([single]($size*0.05))
  $glossPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $glossPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $g.DrawLine($glossPen, [single](0-$half*0.32), [single](0-$half*0.45), [single](0-$half*0.05), [single](0-$half*0.05))

  $pen.Dispose(); $glossPen.Dispose(); $brush.Dispose(); $path.Dispose()
  $g.Restore($state)
}

function Render-Icon([int]$canvasSize, [string]$outFile, [bool]$withMargin) {
  $bmp = New-Object System.Drawing.Bitmap $canvasSize, $canvasSize, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

  $cream = [System.Drawing.Color]::FromArgb(255, 253, 246, 236)
  $g.Clear($cream)

  $margin = 0
  if ($withMargin) { $margin = [int]($canvasSize * 0.028) }
  $sq = $canvasSize - ($margin * 2)
  $radius = $sq * 0.225

  $bgPath = New-RoundedRectPath $margin $margin $sq $sq $radius
  $purple1 = [System.Drawing.Color]::FromArgb(255, 168, 85, 247)
  $pink2   = [System.Drawing.Color]::FromArgb(255, 236, 72, 153)
  $p1 = New-Pt $margin $margin
  $p2 = New-Pt ($margin+$sq) ($margin+$sq)
  $bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $p1, $p2, $purple1, $pink2
  $g.FillPath($bgBrush, $bgPath)

  $borderW = [Math]::Max(2, $canvasSize*0.006)
  $borderPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(60, 255, 255, 255)), ([single]$borderW)
  $g.DrawPath($borderPen, $bgPath)

  $cx = $canvasSize * 0.5
  $cy = $canvasSize * 0.5

  $ruby   = @([System.Drawing.Color]::FromArgb(255, 252, 165, 165), [System.Drawing.Color]::FromArgb(255, 185, 28, 28))
  $emerald = @([System.Drawing.Color]::FromArgb(255, 167, 243, 208), [System.Drawing.Color]::FromArgb(255, 4, 120, 87))
  $topaz  = @([System.Drawing.Color]::FromArgb(255, 253, 224, 71), [System.Drawing.Color]::FromArgb(255, 180, 83, 9))

  $bigSize = $canvasSize * 0.40
  $smallSize = $canvasSize * 0.30

  Draw-Gem $g ($cx - $canvasSize*0.16) ($cy + $canvasSize*0.16) $smallSize $emerald[0] $emerald[1]
  Draw-Gem $g ($cx + $canvasSize*0.19) ($cy + $canvasSize*0.10) $smallSize $topaz[0] $topaz[1]
  Draw-Gem $g $cx ($cy - $canvasSize*0.09) $bigSize $ruby[0] $ruby[1]

  $bmp.Save($outFile, [System.Drawing.Imaging.ImageFormat]::Png)

  $borderPen.Dispose(); $bgBrush.Dispose(); $bgPath.Dispose()
  $g.Dispose(); $bmp.Dispose()
}

Render-Icon 1024 (Join-Path $outDir "AppStoreIcon-1024.png") $false
Render-Icon 512 (Join-Path $outDir "icon-512.png") $true
Render-Icon 192 (Join-Path $outDir "icon-192.png") $true

Write-Host "Icons generated in $outDir"
