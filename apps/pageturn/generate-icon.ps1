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

# One page of an open book: a gently curved quad (like a page falling away
# from the spine), shaded with a linear gradient from spine (darker) to
# outer edge (lighter) so the two pages read as curving toward the viewer.
function Draw-Page($g, [double]$spineX, [double]$topY, [double]$bottomY, [double]$outW, [double]$curve, [bool]$flip, $colorSpine, $colorEdge) {
  $sign = 1
  if ($flip) { $sign = -1 }

  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $p0 = New-Pt $spineX $topY
  $p1 = New-Pt ($spineX + $sign*$outW) ($topY + $curve*0.15)
  $p2 = New-Pt ($spineX + $sign*$outW) ($bottomY - $curve*0.15)
  $p3 = New-Pt $spineX $bottomY

  # Control points for a smooth outward curve on the outer edge, straight
  # down the spine edge.
  $c1 = New-Pt ($spineX + $sign*$outW*0.55) ($topY - $curve*0.05)
  $c2 = New-Pt ($spineX + $sign*$outW*1.02) ($topY + ($bottomY-$topY)*0.32)
  $c3 = New-Pt ($spineX + $sign*$outW*1.02) ($bottomY - ($bottomY-$topY)*0.32)
  $c4 = New-Pt ($spineX + $sign*$outW*0.55) ($bottomY + $curve*0.05)

  $pts = [System.Drawing.PointF[]]@($p0, $c1, $c2, $p1, $p2, $c3, $c4, $p3)
  $path.AddBezier($p0, $c1, $c2, $p1)
  $path.AddLine($p1, $p2)
  $path.AddBezier($p2, $c3, $c4, $p3)
  $path.CloseFigure()

  $rect = $path.GetBounds()
  $gp1 = New-Pt $spineX 0
  $gp2 = New-Pt ($spineX + $sign*$outW) 0
  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $gp1, $gp2, $colorSpine, $colorEdge
  $g.FillPath($brush, $path)

  $brush.Dispose(); $path.Dispose()
}

function Draw-Bookmark($g, [double]$x, [double]$topY, [double]$w, [double]$h, [double]$notch, $colorLight, $colorDark) {
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $p0 = New-Pt $x $topY
  $p1 = New-Pt ($x+$w) $topY
  $p2 = New-Pt ($x+$w) ($topY+$h)
  $p3 = New-Pt ($x+$w*0.5) ($topY+$h-$notch)
  $p4 = New-Pt $x ($topY+$h)
  $pts = @($p0, $p1, $p2, $p3, $p4)
  $path.AddPolygon($pts)

  $gp1 = New-Pt $x $topY
  $gp2 = New-Pt ($x+$w) ($topY+$h)
  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $gp1, $gp2, $colorLight, $colorDark
  $g.FillPath($brush, $path)
  $brush.Dispose(); $path.Dispose()
}

function Render-Icon([int]$canvasSize, [string]$outFile, [bool]$withMargin) {
  $bmp = New-Object System.Drawing.Bitmap $canvasSize, $canvasSize, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

  $cream = [System.Drawing.Color]::FromArgb(255, 250, 243, 232)
  $g.Clear($cream)

  $margin = 0
  if ($withMargin) { $margin = [int]($canvasSize * 0.028) }
  $sq = $canvasSize - ($margin * 2)
  $radius = $sq * 0.225

  $bgPath = New-RoundedRectPath $margin $margin $sq $sq $radius
  $burgundy1 = [System.Drawing.Color]::FromArgb(255, 74, 16, 33)
  $burgundy2 = [System.Drawing.Color]::FromArgb(255, 176, 69, 95)
  $p1 = New-Pt $margin $margin
  $p2 = New-Pt ($margin+$sq) ($margin+$sq)
  $bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $p1, $p2, $burgundy1, $burgundy2
  $g.FillPath($bgBrush, $bgPath)

  $borderW = [Math]::Max(2, $canvasSize*0.006)
  $borderPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(60, 255, 255, 255)), ([single]$borderW)
  $g.DrawPath($borderPen, $bgPath)

  $cx = $canvasSize * 0.5

  # --- Open book ---
  $spineX = $cx
  $topY = $canvasSize * 0.44
  $bottomY = $canvasSize * 0.73
  $outW = $canvasSize * 0.245
  $curve = $canvasSize * 0.05

  $pageLight = [System.Drawing.Color]::FromArgb(255, 253, 248, 240)
  $pageShade = [System.Drawing.Color]::FromArgb(255, 232, 217, 195)

  # Left page: darker near spine, lighter at outer edge.
  Draw-Page $g $spineX $topY $bottomY $outW $curve $true $pageShade $pageLight
  # Right page: mirrored.
  Draw-Page $g $spineX $topY $bottomY $outW $curve $false $pageShade $pageLight

  # Spine shadow line down the middle.
  $spinePen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(70, 60, 20, 30)), ([single]([Math]::Max(2, $canvasSize*0.006)))
  $g.DrawLine($spinePen, [single]$spineX, [single]($topY-2), [single]$spineX, [single]($bottomY+2))
  $spinePen.Dispose()

  # A few faint text lines on each page for texture.
  $linePen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(55, 120, 95, 70)), ([single]([Math]::Max(1.4, $canvasSize*0.0035)))
  for ($i = 0; $i -lt 4; $i++) {
    $ly = $topY + ($bottomY-$topY) * (0.22 + $i*0.19)
    $g.DrawLine($linePen, [single]($spineX - $outW*0.72), [single]$ly, [single]($spineX - $outW*0.18), [single]$ly)
    $g.DrawLine($linePen, [single]($spineX + $outW*0.18), [single]$ly, [single]($spineX + $outW*0.72), [single]$ly)
  }
  $linePen.Dispose()

  # Book cover/base underneath the pages (a thin rounded bar) for a sense
  # of thickness.
  $coverH = $canvasSize * 0.035
  $coverRect = New-Object System.Drawing.RectangleF ([single]($spineX - $outW*1.04)), ([single]($bottomY - $coverH*0.3)), ([single]($outW*2.08)), ([single]$coverH)
  $coverBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 90, 30, 45))
  $g.FillEllipse($coverBrush, $coverRect)
  $coverBrush.Dispose()

  # --- Bookmark ribbon, dangling from the top edge, gold accent ---
  $bmW = $canvasSize * 0.10
  $bmH = $canvasSize * 0.30
  $bmX = $cx + $canvasSize*0.145
  $bmTop = $margin + $canvasSize*0.02
  $goldLight = [System.Drawing.Color]::FromArgb(255, 232, 190, 110)
  $goldDark = [System.Drawing.Color]::FromArgb(255, 180, 130, 40)
  Draw-Bookmark $g $bmX $bmTop $bmW $bmH ($canvasSize*0.05) $goldLight $goldDark

  $bmp.Save($outFile, [System.Drawing.Imaging.ImageFormat]::Png)

  $borderPen.Dispose(); $bgBrush.Dispose(); $bgPath.Dispose()
  $g.Dispose(); $bmp.Dispose()
}

Render-Icon 1024 (Join-Path $outDir "AppStoreIcon-1024.png") $false
Render-Icon 512 (Join-Path $outDir "icon-512.png") $true
Render-Icon 192 (Join-Path $outDir "icon-192.png") $true

Write-Host "Icons generated in $outDir"
