# Original Momo face, drawn at 4x resolution for crisp small toolbar icons.
Add-Type -AssemblyName System.Drawing
$assetRoot = $PSScriptRoot
foreach ($size in @(16, 32, 48, 128)) {
  $canvas = New-Object System.Drawing.Bitmap ($size * 4), ($size * 4)
  $g = [System.Drawing.Graphics]::FromImage($canvas)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.ScaleTransform(($size * 4 / 128), ($size * 4 / 128))
  $white = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml('#F3F1ED'))
  $coral = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml('#ED857C'))
  $ink = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml('#191919'))
  $outline = New-Object System.Drawing.Pen ([System.Drawing.ColorTranslator]::FromHtml('#191919')), 4
  $shape = New-Object System.Drawing.Drawing2D.GraphicsPath
  $shape.AddBezier(16, 55, 10, 8, 20, 2, 46, 30)
  $shape.AddBezier(46, 30, 57, 25, 72, 25, 82, 30)
  $shape.AddBezier(82, 30, 108, 2, 118, 8, 112, 55)
  $shape.AddBezier(112, 55, 140, 115, 76, 126, 64, 120)
  $shape.AddBezier(64, 120, 9, 128, -5, 81, 16, 55)
  $shape.CloseFigure()
  $g.FillPath($white, $shape)
  $g.DrawPath($outline, $shape)
  $g.FillPolygon($coral, [System.Drawing.PointF[]]@((New-Object System.Drawing.PointF 23,23), (New-Object System.Drawing.PointF 25,48), (New-Object System.Drawing.PointF 42,38)))
  $g.FillPolygon($coral, [System.Drawing.PointF[]]@((New-Object System.Drawing.PointF 105,23), (New-Object System.Drawing.PointF 103,48), (New-Object System.Drawing.PointF 86,38)))
  $g.FillEllipse($coral, 20, 82, 19, 10)
  $g.FillEllipse($coral, 89, 82, 19, 10)
  $g.FillEllipse($ink, 37, 60, 13, 22)
  $g.FillEllipse($ink, 78, 60, 13, 22)
  $g.FillEllipse($white, 40, 63, 5, 6)
  $g.FillEllipse($white, 81, 63, 5, 6)
  $g.FillEllipse($coral, 59, 84, 10, 7)
  $g.DrawArc($outline, 51, 86, 14, 15, 0, 150)
  $g.DrawArc($outline, 64, 86, 14, 15, 30, 150)
  $output = New-Object System.Drawing.Bitmap $size, $size
  $outGraphics = [System.Drawing.Graphics]::FromImage($output)
  $outGraphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $outGraphics.DrawImage($canvas, 0, 0, $size, $size)
  $output.Save((Join-Path $assetRoot "icon$size.png"), [System.Drawing.Imaging.ImageFormat]::Png)
  $outGraphics.Dispose()
  $output.Dispose()
  $shape.Dispose()
  $outline.Dispose()
  $white.Dispose()
  $coral.Dispose()
  $ink.Dispose()
  $g.Dispose()
  $canvas.Dispose()
}
