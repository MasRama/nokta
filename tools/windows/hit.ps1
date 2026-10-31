# Moves the pointer to (X, Y) on the primary monitor and checks which app's
# window takes a click there: Nokta's over the notch, another's beside it.
# CI runs it on windows-latest after Nokta starts.
param(
    [Parameter(Mandatory = $true)][int]$X,
    [Parameter(Mandatory = $true)][int]$Y,
    [Parameter(Mandatory = $true)][ValidateSet('nokta', 'other')][string]$Expect
)

Add-Type -Namespace Win32 -Name Hit -MemberDefinition @'
[StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
[DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
[DllImport("user32.dll")] public static extern System.IntPtr WindowFromPoint(POINT point);
[DllImport("user32.dll")] public static extern System.IntPtr GetAncestor(System.IntPtr hwnd, uint flags);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr hwnd, out uint pid);
[DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();
'@

function Get-ProcessName([System.IntPtr]$hwnd) {
    $processId = 0
    [Win32.Hit]::GetWindowThreadProcessId($hwnd, [ref]$processId) | Out-Null
    if ($processId) { (Get-Process -Id $processId).ProcessName } else { '(none)' }
}

[Win32.Hit]::SetCursorPos($X, $Y) | Out-Null
# The app follows the pointer about once a frame.
Start-Sleep -Milliseconds 500
$point = New-Object Win32.Hit+POINT
$point.X = $X
$point.Y = $Y
$root = [Win32.Hit]::GetAncestor([Win32.Hit]::WindowFromPoint($point), 2)
$name = Get-ProcessName $root
$front = Get-ProcessName ([Win32.Hit]::GetForegroundWindow())
Write-Output "($X, $Y) goes to $name; $front has the keyboard"
$isNokta = $name -eq 'Nokta'
if ($isNokta -ne ($Expect -eq 'nokta')) { throw "expected $Expect at ($X, $Y), got $name" }
