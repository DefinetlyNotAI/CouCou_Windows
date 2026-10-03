$ErrorActionPreference='Stop'
$r=[Console]::In.ReadToEnd() | ConvertFrom-Json
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$icon=New-Object System.Windows.Forms.NotifyIcon
try {
  $icon.Icon=[System.Drawing.SystemIcons]::Information
  $icon.Visible=$true
  $icon.ShowBalloonTip(5000,[string]$r.title,[string]$r.text,[System.Windows.Forms.ToolTipIcon]::Info)
  Start-Sleep -Seconds 6
} finally { $icon.Dispose() }
