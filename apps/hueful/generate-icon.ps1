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

# A test tube: rounded-bottom capsule, filled bottom-to-top with the given
# color bands, plus a glassy outline and a highlight streak.
function Draw-Tube($g, [double]$x, [double]$y, [double]$w, [double]$h, $bands) {
  $r = $w / 2.0
  $tubePath = New-Object System.Drawing.Drawing2D.GraphicsPath
  $tubePath.AddArc($x, ($y+$h-$w), $w, $w, 0, 180)
  $tubePath.AddLine([single]$x, [single]($y+$h-$r), [single]$x, [single]$y)
  $tubePath.AddLine([single]$x, [single]$y, [single]($x+$w), [single]$y)
  $tubePath.AddLine([single]($x+$w), [single]$y, [single]($x+$w), [single]($y+$h-$r))
  $tubePath.CloseFigure()

  $glassBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(70, 255, 255, 255))
  $g.FillPath($glassBrush, $tubePath)

  $oldClip = $g.Clip
  $g.SetClip($tubePath, [System.Drawing.Drawing2D.CombineMode]::Replace)

  $n = $bands.Count
  $bandH = ($h - $r) / $n
  for ($i = 0; $i -lt $n; $i++) {
    $by = $y + $h - $r - ($bandH * ($i + 1))
    $col = $bands[$i]
    $bandBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush (New-Pt $x $by), (New-Pt ($x+$w) ($by+$bandH)), $col[0], $col[1]
    $g.FillRectangle($bandBrush, [single]$x, [single]($by-1), [single]$w, [single]($bandH+2))
    $bandBrush.Dispose()
  }
  $g.SetClip($oldClip, [System.Drawing.Drawing2D.CombineMode]::Replace)

  $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(120, 255, 255, 255)), ([single]($w*0.06))
  $g.DrawPath($pen, $tubePath)

  $pen.Dispose(); $glassBrush.Dispose(); $tubePath.Dispose()
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
  $teal1  = [System.Drawing.Color]::FromArgb(255, 45, 212, 191)
  $indigo2 = [System.Drawing.Color]::FromArgb(255, 99, 102, 241)
  $p1 = New-Pt $margin $margin
  $p2 = New-Pt ($margin+$sq) ($margin+$sq)
  $bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $p1, $p2, $teal1, $indigo2
  $g.FillPath($bgBrush, $bgPath)

  $borderW = [Math]::Max(2, $canvasSize*0.006)
  $borderPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(60, 255, 255, 255)), ([single]$borderW)
  $g.DrawPath($borderPen, $bgPath)

  $orange = @([System.Drawing.Color]::FromArgb(255, 253, 186, 116), [System.Drawing.Color]::FromArgb(255, 234, 88, 12))
  $pink   = @([System.Drawing.Color]::FromArgb(255, 251, 168, 208), [System.Drawing.Color]::FromArgb(255, 219, 39, 119))
  $yellow = @([System.Drawing.Color]::FromArgb(255, 254, 240, 138), [System.Drawing.Color]::FromArgb(255, 202, 138, 4))
  $violet = @([System.Drawing.Color]::FromArgb(255, 216, 180, 254), [System.Drawing.Color]::FromArgb(255, 126, 34, 206))

  $tubeW = $canvasSize * 0.155
  $tubeH = $canvasSize * 0.5
  $gap = $canvasSize * 0.05
  $startX = $canvasSize * 0.5 - ($tubeW*3 + $gap*2) / 2
  $topY = $canvasSize * 0.22

  Draw-Tube $g $startX $topY $tubeW $tubeH @($orange, $pink)
  Draw-Tube $g ($startX + $tubeW + $gap) ($topY + $canvasSize*0.05) $tubeW ($tubeH - $canvasSize*0.05) @($yellow, $violet)
  Draw-Tube $g ($startX + ($tubeW + $gap)*2) $topY $tubeW $tubeH @($pink, $yellow)

  $bmp.Save($outFile, [System.Drawing.Imaging.ImageFormat]::Png)

  $borderPen.Dispose(); $bgBrush.Dispose(); $bgPath.Dispose()
  $g.Dispose(); $bmp.Dispose()
}

Render-Icon 1024 (Join-Path $outDir "AppStoreIcon-1024.png") $false
Render-Icon 512 (Join-Path $outDir "icon-512.png") $true
Render-Icon 192 (Join-Path $outDir "icon-192.png") $true

Write-Host "Icons generated in $outDir"
