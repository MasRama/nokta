# Prints one card. Nokta passes the options as NOKTA_OPTION_<KEY>.
$name = if ($env:NOKTA_OPTION_NAME) { $env:NOKTA_OPTION_NAME } else { 'there' }
$hour = (Get-Date).Hour
$greeting = if ($hour -lt 12) { 'Good morning' } elseif ($hour -lt 18) { 'Good afternoon' } else { 'Good evening' }
$tone = if ($env:NOKTA_OPTION_TONE) { $env:NOKTA_OPTION_TONE } else { 'purple' }
@{
    title = "$greeting, $name"
    detail = "From a plugin in $env:NOKTA_PLUGIN_DIR"
    tone = $tone
    items = @(
        @{ title = 'Nokta'; detail = 'The source'; icon = 'nokta-link'; open = 'https://github.com/MasRama/nokta' },
        @{ title = 'Writing a plugin'; detail = 'docs/plugins.md'; open = 'https://github.com/MasRama/nokta/blob/main/docs/plugins.md' }
    )
} | ConvertTo-Json -Compress -Depth 4
