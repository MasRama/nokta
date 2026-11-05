#!/bin/sh
# Asks the site for its headers and prints how it went. The last state is
# kept in the plugin's data folder, so an alert comes only when it changes.
url=${NOKTA_OPTION_URL:-https://example.com}
state="${NOKTA_PLUGIN_DATA:-.}/state"
before=$(cat "$state" 2>/dev/null)
code=$(curl -s -o /dev/null -m 10 -w '%{http_code}' "$url")
host=$(printf '%s' "$url" | sed -E 's#^[a-z]+://##; s#/.*##')
now=$(date +%s)

if [ "$code" -ge 200 ] 2>/dev/null && [ "$code" -lt 400 ]; then
  echo up > "$state"
  alert=""
  [ "$before" = down ] && alert=$(printf ',"alert":{"id":"up-%s","title":"%s is back up","detail":"Answered %s"}' "$now" "$host" "$code")
  printf '{"title":"%s is up","detail":"Answered %s","tone":"green","actions":[{"label":"Open","open":"%s"},{"label":"Check","run":"check"}]%s}\n' \
    "$host" "$code" "$url" "$alert"
else
  echo down > "$state"
  alert=""
  [ "$before" != down ] && alert=$(printf ',"alert":{"id":"down-%s","title":"%s is down","detail":"No answer","important":true}' "$now" "$host")
  badge=""
  [ "${NOKTA_OPTION_BADGE:-true}" = "true" ] && badge="down"
  printf '{"title":"%s is down","detail":"No answer (%s)","tone":"red","badge":"%s","actions":[{"label":"Check","run":"check"}]%s}\n' \
    "$host" "${code:-000}" "$badge" "$alert"
fi
