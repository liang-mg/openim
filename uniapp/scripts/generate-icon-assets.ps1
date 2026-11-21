param(
  [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$fontPath = Join-Path $ProjectRoot "src/static/fonts/uniicons.ttf"
$outputRoot = Join-Path $ProjectRoot "src/static/icons"

if (-not (Test-Path -LiteralPath $fontPath)) {
  throw "Icon font not found: $fontPath"
}

$icons = [ordered]@{
  camera = 0xe65a
  document = 0xe67f
  clock = 0xe6b2
  calendar = 0xe6a0
  video = 0xe68c
  check = 0xe62b
  "check-square" = 0xe62b
  user = 0xe699
  users = 0xe6a7
  settings = 0xe653
  logout = 0xe6ba
  shield = 0xe6ab
  bell = 0xe6a6
  "chevron-right" = 0xe6b5
  "chevron-left" = 0xe6b7
  plus = 0xe676
  search = 0xe654
  warning = 0xe669
  image = 0xe670
  download = 0xe68d
  trash = 0xe687
  edit = 0xe67f
  send = 0xe672
  close = 0xe66c
  more = 0xe64d
  message = 0xe697
  list = 0xe644
  chart = 0xe627
  refresh = 0xe657
  filter = 0xe6aa
  location = 0xe6ae
  paperclip = 0xe652
}

$colors = [ordered]@{
  brand = "#0B5FD8"
  white = "#FFFFFF"
  ink = "#1F2329"
  muted = "#8A9099"
  ok = "#12A870"
  warn = "#D97706"
  danger = "#E34D59"
}

$fontCollection = New-Object System.Drawing.Text.PrivateFontCollection
$fontCollection.AddFontFile($fontPath)
$fontFamily = $fontCollection.Families[0]
$canvasSize = 96
$fontSize = 66

foreach ($variant in $colors.GetEnumerator()) {
  $variantDir = Join-Path $outputRoot $variant.Key
  New-Item -ItemType Directory -Force -Path $variantDir | Out-Null
  $brushColor = [System.Drawing.ColorTranslator]::FromHtml($variant.Value)

  foreach ($icon in $icons.GetEnumerator()) {
    $bitmap = New-Object System.Drawing.Bitmap($canvasSize, $canvasSize, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $font = New-Object System.Drawing.Font($fontFamily, $fontSize, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
    $brush = New-Object System.Drawing.SolidBrush($brushColor)
    $format = New-Object System.Drawing.StringFormat

    try {
      $graphics.Clear([System.Drawing.Color]::Transparent)
      $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
      $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
      $format.Alignment = [System.Drawing.StringAlignment]::Center
      $format.LineAlignment = [System.Drawing.StringAlignment]::Center
      $glyph = [char]$icon.Value
      $rect = New-Object System.Drawing.RectangleF(0, 0, $canvasSize, $canvasSize)
      if ($icon.Key -in @("clock", "document", "check-square")) {
        $pen = New-Object System.Drawing.Pen($brushColor, 6)
        try {
          $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
          $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
          $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
          switch ($icon.Key) {
            "clock" {
              $graphics.DrawEllipse($pen, 14, 14, 68, 68)
              $graphics.DrawLine($pen, 48, 48, 48, 29)
              $graphics.DrawLine($pen, 48, 48, 64, 58)
            }
            "document" {
              $graphics.DrawLine($pen, 24, 12, 59, 12)
              $graphics.DrawLine($pen, 59, 12, 75, 28)
              $graphics.DrawLine($pen, 75, 28, 75, 84)
              $graphics.DrawLine($pen, 75, 84, 24, 84)
              $graphics.DrawLine($pen, 24, 84, 24, 12)
              $graphics.DrawLine($pen, 59, 12, 59, 29)
              $graphics.DrawLine($pen, 59, 29, 75, 29)
              $graphics.DrawLine($pen, 36, 47, 64, 47)
              $graphics.DrawLine($pen, 36, 62, 64, 62)
            }
            "check-square" {
              $graphics.DrawRectangle($pen, 14, 14, 68, 68)
              $graphics.DrawLine($pen, 30, 49, 43, 62)
              $graphics.DrawLine($pen, 43, 62, 68, 35)
            }
          }
        }
        finally {
          $pen.Dispose()
        }
      }
      else {
        $graphics.DrawString([string]$glyph, $font, $brush, $rect, $format)
      }
      $target = Join-Path $variantDir ($icon.Key + ".png")
      $bitmap.Save($target, [System.Drawing.Imaging.ImageFormat]::Png)
    }
    finally {
      $format.Dispose()
      $brush.Dispose()
      $font.Dispose()
      $graphics.Dispose()
      $bitmap.Dispose()
    }
  }
}

$fontCollection.Dispose()

# Android 桌面图标必须与 PC 客户端使用同一源文件。只做高质量缩放，不改颜色、
# 圆角或文字，避免移动端和桌面端再次出现两套品牌资源。
$launcherSource = [System.IO.Path]::GetFullPath((Join-Path $ProjectRoot "../frontend/public/icons/icon.png"))
$launcherRoots = @(
  (Join-Path $ProjectRoot "src/static/brand/app-icons"),
  (Join-Path $ProjectRoot "static/brand/app-icons")
)
$launcherSizes = [ordered]@{
  hdpi = 72
  xhdpi = 96
  xxhdpi = 144
  xxxhdpi = 192
}

if (-not (Test-Path -LiteralPath $launcherSource)) {
  throw "PC launcher icon not found: $launcherSource"
}

New-Item -ItemType Directory -Force -Path $launcherRoots | Out-Null
$sourceImage = [System.Drawing.Image]::FromFile($launcherSource)
try {
  foreach ($launcher in $launcherSizes.GetEnumerator()) {
    $size = [int]$launcher.Value
    $bitmap = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.Clear([System.Drawing.Color]::Transparent)
      $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
      $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
      $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
      $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $graphics.DrawImage($sourceImage, 0, 0, $size, $size)
      foreach ($launcherRoot in $launcherRoots) {
        $target = Join-Path $launcherRoot ($launcher.Key + ".png")
        $bitmap.Save($target, [System.Drawing.Imaging.ImageFormat]::Png)
      }
    }
    finally {
      $graphics.Dispose()
      $bitmap.Dispose()
    }
  }
}
finally {
  $sourceImage.Dispose()
}

Write-Output "ICON_ASSETS_OK icons=$($icons.Count) variants=$($colors.Count) launchers=$($launcherSizes.Count) output=$outputRoot"
