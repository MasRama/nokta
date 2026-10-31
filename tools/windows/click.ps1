# Clicks with the left button at (X, Y) on the primary monitor, as a mouse
# would. CI runs it on windows-latest, as on the tour's Skip.
param(
    [Parameter(Mandatory = $true)][int]$X,
    [Parameter(Mandatory = $true)][int]$Y
)

Add-Type -Namespace Win32 -Name Click -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
[DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, System.UIntPtr extra);
'@

$LEFTDOWN = 0x2
$LEFTUP = 0x4
[Win32.Click]::SetCursorPos($X, $Y) | Out-Null
# The app follows the pointer about once a frame, and takes clicks only where the notch is.
Start-Sleep -Milliseconds 500
[Win32.Click]::mouse_event($LEFTDOWN, 0, 0, 0, [System.UIntPtr]::Zero)
Start-Sleep -Milliseconds 50
[Win32.Click]::mouse_event($LEFTUP, 0, 0, 0, [System.UIntPtr]::Zero)
Write-Output "clicked ($X, $Y)"
