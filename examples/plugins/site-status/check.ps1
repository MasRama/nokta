# Asks the site for its headers and prints how it went. The last state is
# kept in the plugin's data folder, so an alert comes only when it changes.
$url = if ($env:NOKTA_OPTION_URL) { $env:NOKTA_OPTION_URL } else { 'https://example.com' }
$state = Join-Path $(if ($env:NOKTA_PLUGIN_DATA) { $env:NOKTA_PLUGIN_DATA } else { '.' }) 'state'
$before = if (Test-Path $state) { (Get-Content $state -Raw).Trim() } else { '' }
$hostName = ([Uri]$url).Host
$now = [DateTimeOffset]::Now.ToUnixTimeSeconds()
try {
    $code = (Invoke-WebRequest -Uri $url -Method Head -TimeoutSec 10 -UseBasicParsing).StatusCode
    Set-Content $state 'up'
    $card = @{
        title = "$hostName is up"; detail = "Answered $code"; tone = 'green'
        actions = @(@{ label = 'Open'; open = $url }, @{ label = 'Check'; run = 'check' })
    }
    if ($before -eq 'down') { $card.alert = @{ id = "up-$now"; title = "$hostName is back up"; detail = "Answered $code" } }
} catch {
    Set-Content $state 'down'
    $badge = if ($env:NOKTA_OPTION_BADGE -ne 'false') { 'down' } else { '' }
    $card = @{
        title = "$hostName is down"; detail = 'No answer'; tone = 'red'; badge = $badge
        actions = @(@{ label = 'Check'; run = 'check' })
    }
    if ($before -ne 'down') { $card.alert = @{ id = "down-$now"; title = "$hostName is down"; detail = 'No answer'; important = $true } }
}
$card | ConvertTo-Json -Compress -Depth 4
