$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
try {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
    switch ($request.mode) {
        'screenshot' {
            $bitmap = New-Object System.Drawing.Bitmap([int]$request.width, [int]$request.height)
            $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
            try {
                $graphics.CopyFromScreen([int]$request.x, [int]$request.y, 0, 0, $bitmap.Size)
                $bitmap.Save([string]$request.path, [System.Drawing.Imaging.ImageFormat]::Png)
                @{ image = $true; text = '' } | ConvertTo-Json -Compress
            } finally { $graphics.Dispose(); $bitmap.Dispose() }
        }
        'clipboard' {
            if ([System.Windows.Forms.Clipboard]::ContainsText()) {
                @{ image = $false; text = [System.Windows.Forms.Clipboard]::GetText() } | ConvertTo-Json -Compress
            } else {
                $image = [System.Windows.Forms.Clipboard]::GetImage()
                if ($null -eq $image) { throw 'The clipboard does not contain text or an image.' }
                try {
                    $image.Save([string]$request.path, [System.Drawing.Imaging.ImageFormat]::Png)
                    @{ image = $true; text = '' } | ConvertTo-Json -Compress
                } finally { $image.Dispose() }
            }
        }
        'copy' {
            [System.Windows.Forms.Clipboard]::SetText([string]$request.text)
            @{ image = $false; text = '' } | ConvertTo-Json -Compress
        }
        default { throw 'Unknown desktop action.' }
    }
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
