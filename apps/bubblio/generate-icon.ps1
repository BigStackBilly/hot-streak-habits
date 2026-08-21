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

function Draw-Bubble($g, [double]$cx, [double]$cy, [double]$r, $colorLight, $colorDark) {
  $rect = New-Object System.Drawing.RectangleF ([single]($cx-$r)), ([single]($cy-$r)), ([single]($r*2)), ([single]($r*2))
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddEllipse($rect)
  $brush = New-Object System.Drawing.Drawing2D.PathGradientBrush($path)
  $brush.CenterColor = $colorLight
  $brush.SurroundColors = @($colorDark)
  $cp = New-Pt ($cx - $r*0.3) ($cy - $r*0.35)
  $brush.CenterPoint = $cp
  $g.FillEllipse($brush, $rect)

  $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(60, 20, 10, 30)), ([single]($r*0.045))
  $g.DrawEllipse($pen, $rect)

  $glossBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(190, 255, 255, 255))
  $gr = $r * 0.32
  $g.FillEllipse($glossBrush, [single]($cx - $r*0.42), [single]($cy - $r*0.5), [single]($gr*1.3), [single]($gr))

  $pen.Dispose(); $brush.Dispose(); $path.Dispose(); $glossBrush.Dispose()
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
  $pink1 = [System.Drawing.Color]::FromArgb(255, 255, 110, 199)
  $orange2 = [System.Drawing.Color]::FromArgb(255, 255, 165, 62)
  $p1 = New-Pt $margin $margin
  $p2 = New-Pt ($margin+$sq) ($margin+$sq)
  $bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $p1, $p2, $pink1, $orange2
  $g.FillPath($bgBrush, $bgPath)

  $borderW = [Math]::Max(2, $canvasSize*0.006)
  $borderPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(60, 255, 255, 255)), ([single]$borderW)
  $g.DrawPath($borderPen, $bgPath)

  $cx = $canvasSize * 0.5
  $cy = $canvasSize * 0.5

  $teal   = @([System.Drawing.Color]::FromArgb(255, 165, 243, 252), [System.Drawing.Color]::FromArgb(255, 8, 145, 178))
  $purple = @([System.Drawing.Color]::FromArgb(255, 233, 213, 255), [System.Drawing.Color]::FromArgb(255, 147, 51, 234))
  $yellow = @([System.Drawing.Color]::FromArgb(255, 254, 240, 138), [System.Drawing.Color]::FromArgb(255, 202, 138, 4))
  $lime   = @([System.Drawing.Color]::FromArgb(255, 217, 249, 157), [System.Drawing.Color]::FromArgb(255, 77, 124, 15))

  $r1 = $canvasSize * 0.145
  $r2 = $canvasSize * 0.185

  Draw-Bubble $g ($cx - $canvasSize*0.20) ($cy + $canvasSize*0.12) $r1 $lime[0] $lime[1]
  Draw-Bubble $g ($cx + $canvasSize*0.22) ($cy + $canvasSize*0.16) $r1 $yellow[0] $yellow[1]
  Draw-Bubble $g ($cx + $canvasSize*0.06) ($cy - $canvasSize*0.20) $r1 $purple[0] $purple[1]
  Draw-Bubble $g ($cx - $canvasSize*0.10) ($cy - $canvasSize*0.02) $r2 $teal[0] $teal[1]

  $bmp.Save($outFile, [System.Drawing.Imaging.ImageFormat]::Png)

  $borderPen.Dispose(); $bgBrush.Dispose(); $bgPath.Dispose()
  $g.Dispose(); $bmp.Dispose()
}

Render-Icon 1024 (Join-Path $outDir "AppStoreIcon-1024.png") $false
Render-Icon 512 (Join-Path $outDir "icon-512.png") $true
Render-Icon 192 (Join-Path $outDir "icon-192.png") $true

Write-Host "Icons generated in $outDir"
