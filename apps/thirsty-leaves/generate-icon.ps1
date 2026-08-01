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

function Draw-Leaf($g, [double]$cx, [double]$cy, [double]$angleDeg, [double]$length, [double]$width, $colorLight, $colorDark) {
  $state = $g.Save()
  $g.TranslateTransform([single]$cx, [single]$cy)
  $g.RotateTransform([single]$angleDeg)
  $rx = 0 - ($width/2)
  $ry = 0 - $length
  $rect = New-Object System.Drawing.RectangleF([single]$rx, [single]$ry, [single]$width, [single]$length)
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddEllipse($rect)
  $brush = New-Object System.Drawing.Drawing2D.PathGradientBrush($path)
  $brush.CenterColor = $colorLight
  $brush.SurroundColors = @($colorDark)
  $g.FillPath($brush, $path)
  $veinW = [Math]::Max(2, $width*0.035)
  $veinPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(70, 20, 60, 30)), ([single]$veinW)
  $y1 = -6
  $y2 = (0 - $length) + 18
  $g.DrawLine($veinPen, [single]0, [single]$y1, [single]0, [single]$y2)
  $veinPen.Dispose(); $brush.Dispose(); $path.Dispose()
  $g.Restore($state)
}

function Draw-Droplet($g, [double]$cx, [double]$cy, [double]$size, $colorLight, $colorDark) {
  $state = $g.Save()
  $g.TranslateTransform([single]$cx, [single]$cy)
  $r = $size / 2.0

  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $circleY = 0 - ($r*0.2)
  $circleRect = New-Object System.Drawing.RectangleF ([single](0-$r)), ([single]$circleY), ([single]$size), ([single]$size)
  $path.AddEllipse($circleRect)

  $tipX = 0.0
  $tipY = 0 - ($size*1.05)
  $rightX = $r*0.85
  $rightY = 0 - ($r*0.15)
  $leftX = 0 - ($r*0.85)
  $leftY = 0 - ($r*0.15)
  $tri = @( (New-Pt $tipX $tipY), (New-Pt $rightX $rightY), (New-Pt $leftX $leftY) )
  $path.AddPolygon($tri)

  $brush = New-Object System.Drawing.Drawing2D.PathGradientBrush($path)
  $brush.CenterColor = $colorLight
  $brush.SurroundColors = @($colorDark)
  $g.FillPath($brush, $path)

  $glossBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(160, 255, 255, 255))
  $gx = 0 - ($r*0.35)
  $gy = 0 - ($r*0.05)
  $g.FillEllipse($glossBrush, [single]$gx, [single]$gy, [single]($r*0.5), [single]($r*0.7))

  $glossBrush.Dispose(); $brush.Dispose(); $path.Dispose()
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
  $leafGreen1 = [System.Drawing.Color]::FromArgb(255, 34, 165, 89)
  $skyBlue2   = [System.Drawing.Color]::FromArgb(255, 14, 165, 233)
  $p1 = New-Pt $margin $margin
  $p2 = New-Pt ($margin+$sq) ($margin+$sq)
  $bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $p1, $p2, $leafGreen1, $skyBlue2
  $g.FillPath($bgBrush, $bgPath)

  $borderW = [Math]::Max(2, $canvasSize*0.006)
  $borderPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(60, 255, 255, 255)), ([single]$borderW)
  $g.DrawPath($borderPen, $bgPath)

  $cx = $canvasSize * 0.5

  $potTopY = $canvasSize * 0.615
  $potW = $canvasSize * 0.40
  $potH = $canvasSize * 0.24
  $rimH = $canvasSize * 0.075

  $terracottaLight = [System.Drawing.Color]::FromArgb(255, 242, 201, 160)
  $terracottaDark  = [System.Drawing.Color]::FromArgb(255, 196, 110, 74)

  $topHalf = $potW * 0.5
  $botHalf = $potW * 0.36
  $potBottomY = $potTopY + $potH
  $ptA = New-Pt ($cx-$topHalf) $potTopY
  $ptB = New-Pt ($cx+$topHalf) $potTopY
  $ptC = New-Pt ($cx+$botHalf) $potBottomY
  $ptD = New-Pt ($cx-$botHalf) $potBottomY
  $potPts = @($ptA, $ptB, $ptC, $ptD)
  $potPath = New-Object System.Drawing.Drawing2D.GraphicsPath
  $potPath.AddPolygon($potPts)
  $potBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $ptA, $ptC, $terracottaLight, $terracottaDark
  $g.FillPath($potBrush, $potPath)

  $rimX = $cx - ($topHalf*1.06)
  $rimY = $potTopY - ($rimH*0.5)
  $rimW = $topHalf*2*1.06
  $rimRect = New-Object System.Drawing.RectangleF ([single]$rimX), ([single]$rimY), ([single]$rimW), ([single]$rimH)
  $rimBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rimRect, $terracottaDark, $terracottaLight, ([single]90)
  $g.FillEllipse($rimBrush, $rimRect)
  $rimShadeW = [Math]::Max(2, $canvasSize*0.004)
  $rimShadePen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(50, 90, 45, 25)), ([single]$rimShadeW)
  $g.DrawEllipse($rimShadePen, $rimRect)

  $leafPivotX = $cx
  $leafPivotY = $potTopY - ($rimH*0.15)
  $leafLight = [System.Drawing.Color]::FromArgb(255, 134, 224, 143)
  $leafDark  = [System.Drawing.Color]::FromArgb(255, 22, 138, 74)
  $leafLen = $canvasSize * 0.40
  $leafWid = $canvasSize * 0.165

  Draw-Leaf $g $leafPivotX $leafPivotY -34 ($leafLen*0.86) ($leafWid*0.82) $leafLight $leafDark
  Draw-Leaf $g $leafPivotX $leafPivotY 34 ($leafLen*0.86) ($leafWid*0.82) $leafLight $leafDark
  Draw-Leaf $g $leafPivotX $leafPivotY 0 $leafLen $leafWid $leafLight $leafDark

  $dropLight = [System.Drawing.Color]::FromArgb(255, 186, 233, 255)
  $dropDark  = [System.Drawing.Color]::FromArgb(255, 56, 158, 219)
  Draw-Droplet $g ($canvasSize*0.775) ($canvasSize*0.265) ($canvasSize*0.135) $dropLight $dropDark

  $bmp.Save($outFile, [System.Drawing.Imaging.ImageFormat]::Png)

  $borderPen.Dispose(); $bgBrush.Dispose(); $bgPath.Dispose()
  $potBrush.Dispose(); $potPath.Dispose(); $rimBrush.Dispose(); $rimShadePen.Dispose()
  $g.Dispose(); $bmp.Dispose()
}

Render-Icon 1024 (Join-Path $outDir "AppStoreIcon-1024.png") $false
Render-Icon 512 (Join-Path $outDir "icon-512.png") $true
Render-Icon 192 (Join-Path $outDir "icon-192.png") $true

Write-Host "Icons generated in $outDir"
