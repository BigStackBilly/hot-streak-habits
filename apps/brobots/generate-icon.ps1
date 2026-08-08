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
  $blue1 = [System.Drawing.Color]::FromArgb(255, 59, 130, 246)
  $purple2 = [System.Drawing.Color]::FromArgb(255, 139, 92, 246)
  $p1 = New-Pt $margin $margin
  $p2 = New-Pt ($margin+$sq) ($margin+$sq)
  $bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $p1, $p2, $blue1, $purple2
  $g.FillPath($bgBrush, $bgPath)

  $borderW = [Math]::Max(2, $canvasSize*0.006)
  $borderPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(60, 255, 255, 255)), ([single]$borderW)
  $g.DrawPath($borderPen, $bgPath)

  $cx = $canvasSize * 0.5
  $cy = $canvasSize * 0.56

  # antenna
  $antTopY = $canvasSize * 0.145
  $antBaseY = $canvasSize * 0.26
  $antPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 253, 246, 236)), ([single]($canvasSize*0.022))
  $antPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $antPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $g.DrawLine($antPen, [single]$cx, [single]$antBaseY, [single]$cx, [single]$antTopY)
  $ballBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 251, 191, 36))
  $ballR = $canvasSize * 0.052
  $g.FillEllipse($ballBrush, [single]($cx-$ballR), [single]($antTopY-$ballR), [single]($ballR*2), [single]($ballR*2))

  # head
  $headW = $canvasSize * 0.62
  $headH = $canvasSize * 0.52
  $headX = $cx - $headW/2
  $headY = $cy - $headH/2
  $headPath = New-RoundedRectPath $headX $headY $headW $headH ($headW*0.26)
  $headLight = [System.Drawing.Color]::FromArgb(255, 246, 249, 252)
  $headDark = [System.Drawing.Color]::FromArgb(255, 196, 206, 222)
  $headBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush (New-Pt $headX $headY), (New-Pt ($headX+$headW) ($headY+$headH)), $headLight, $headDark
  $g.FillPath($headBrush, $headPath)
  $headPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(80, 60, 70, 100)), ([single]($canvasSize*0.008))
  $g.DrawPath($headPen, $headPath)

  # eyes (glowing cyan)
  $eyeR = $canvasSize * 0.082
  $eyeOffsetX = $canvasSize * 0.145
  $eyeY = $cy - $eyeR*0.15
  $eyeGlow = [System.Drawing.Color]::FromArgb(255, 34, 211, 238)
  $eyeDark = [System.Drawing.Color]::FromArgb(255, 8, 118, 138)
  foreach ($sign in @(-1, 1)) {
    $ex = $cx + ($sign * $eyeOffsetX)
    $eyeRect = New-Object System.Drawing.RectangleF ([single]($ex-$eyeR)), ([single]($eyeY-$eyeR)), ([single]($eyeR*2)), ([single]($eyeR*2))
    $eyePath = New-Object System.Drawing.Drawing2D.GraphicsPath
    $eyePath.AddEllipse($eyeRect)
    $eyeBrush = New-Object System.Drawing.Drawing2D.PathGradientBrush($eyePath)
    $eyeBrush.CenterColor = $eyeGlow
    $eyeBrush.SurroundColors = @($eyeDark)
    $g.FillEllipse($eyeBrush, $eyeRect)
    $eyeBrush.Dispose(); $eyePath.Dispose()
  }

  # mouth grille
  $mouthY = $cy + $canvasSize*0.135
  $mouthW = $canvasSize * 0.22
  $mouthPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(140, 60, 70, 100)), ([single]($canvasSize*0.016))
  $mouthPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $mouthPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  for ($i = -1; $i -le 1; $i++) {
    $lx = $cx + ($i * $mouthW / 3)
    $g.DrawLine($mouthPen, [single]$lx, [single]($mouthY-$canvasSize*0.03), [single]$lx, [single]($mouthY+$canvasSize*0.03))
  }

  $bmp.Save($outFile, [System.Drawing.Imaging.ImageFormat]::Png)

  $borderPen.Dispose(); $bgBrush.Dispose(); $bgPath.Dispose()
  $headBrush.Dispose(); $headPath.Dispose(); $headPen.Dispose()
  $antPen.Dispose(); $ballBrush.Dispose(); $mouthPen.Dispose()
  $g.Dispose(); $bmp.Dispose()
}

Render-Icon 1024 (Join-Path $outDir "AppStoreIcon-1024.png") $false
Render-Icon 512 (Join-Path $outDir "icon-512.png") $true
Render-Icon 192 (Join-Path $outDir "icon-192.png") $true

Write-Host "Icons generated in $outDir"
