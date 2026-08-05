Add-Type -AssemblyName System.Drawing

$outDir = $PSScriptRoot

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

function Render-Icon([int]$canvasSize, [string]$outFile, [bool]$withMargin) {
  $bmp = New-Object System.Drawing.Bitmap $canvasSize, $canvasSize, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)

  $margin = 0
  if ($withMargin) { $margin = [int]($canvasSize * 0.028) }
  $sq = $canvasSize - ($margin * 2)
  $radius = $sq * 0.225

  # Background: deep focused charcoal -> energetic coral, diagonal.
  $bgPath = New-RoundedRectPath $margin $margin $sq $sq $radius
  $charcoal = [System.Drawing.Color]::FromArgb(255, 20, 22, 31)
  $coral    = [System.Drawing.Color]::FromArgb(255, 255, 107, 74)
  $p1 = New-Object System.Drawing.Point $margin, $margin
  $p2 = New-Object System.Drawing.Point ($margin+$sq), ($margin+$sq)
  $bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $p1, $p2, $charcoal, $coral
  $g.FillPath($bgBrush, $bgPath)

  $borderW = [Math]::Max(2, $canvasSize*0.006)
  $borderPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(50, 255, 255, 255)), ([single]$borderW)
  $g.DrawPath($borderPen, $bgPath)

  $cx = $canvasSize * 0.5
  $cy = $canvasSize * 0.5
  $outerR = $canvasSize * 0.335
  $thickness = $canvasSize * 0.072

  # Dim full track ring.
  $trackPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(60, 255, 255, 255)), ([single]$thickness)
  $trackPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $trackPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $ringRect = New-Object System.Drawing.RectangleF ([single]($cx-$outerR)), ([single]($cy-$outerR)), ([single]($outerR*2)), ([single]($outerR*2))
  $g.DrawEllipse($trackPen, $ringRect)

  # Progress arc (~75%), amber -> coral gradient, starting at 12 o'clock.
  $amber = [System.Drawing.Color]::FromArgb(255, 255, 209, 102)
  $progRect = New-Object System.Drawing.RectangleF ([single]($cx-$outerR)), ([single]($cy-$outerR)), ([single]($outerR*2)), ([single]($outerR*2))
  $progBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $progRect, $amber, $coral, ([single]45)
  $progPen = New-Object System.Drawing.Pen $progBrush, ([single]$thickness)
  $progPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $progPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $g.DrawArc($progPen, $ringRect, -90, 270)

  # Play triangle in the center, optically shifted right.
  $triSize = $canvasSize * 0.185
  $offsetX = $canvasSize * 0.02
  $p1t = New-Object System.Drawing.PointF ([single]($cx - $triSize*0.42 + $offsetX)), ([single]($cy - $triSize*0.58))
  $p2t = New-Object System.Drawing.PointF ([single]($cx - $triSize*0.42 + $offsetX)), ([single]($cy + $triSize*0.58))
  $p3t = New-Object System.Drawing.PointF ([single]($cx + $triSize*0.68 + $offsetX)), ([single]($cy))
  $tri = @($p1t, $p2t, $p3t)
  $triBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 255, 248, 240))
  $g.FillPolygon($triBrush, $tri)

  $bmp.Save($outFile, [System.Drawing.Imaging.ImageFormat]::Png)

  $borderPen.Dispose(); $bgBrush.Dispose(); $bgPath.Dispose()
  $trackPen.Dispose(); $progPen.Dispose(); $progBrush.Dispose(); $triBrush.Dispose()
  $g.Dispose(); $bmp.Dispose()
}

Render-Icon 512 (Join-Path $outDir "icon-512.png") $true
Render-Icon 192 (Join-Path $outDir "icon-192.png") $true

Write-Host "Icons generated in $outDir"
