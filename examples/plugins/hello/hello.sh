#!/bin/sh
# Prints one card. Nokta passes the options as NOKTA_OPTION_<KEY>.
name=${NOKTA_OPTION_NAME:-there}
hour=$(date +%H)
if [ "$hour" -lt 12 ]; then greeting="Good morning"
elif [ "$hour" -lt 18 ]; then greeting="Good afternoon"
else greeting="Good evening"; fi

cat <<JSON
{
  "title": "$greeting, $name",
  "detail": "From a plugin in $NOKTA_PLUGIN_DIR",
  "tone": "${NOKTA_OPTION_TONE:-purple}",
  "items": [
    {"title": "Nokta", "detail": "The source", "icon": "nokta-link", "open": "https://github.com/MasRama/nokta"},
    {"title": "Writing a plugin", "detail": "docs/plugins.md", "open": "https://github.com/MasRama/nokta/blob/main/docs/plugins.md"}
  ]
}
JSON
