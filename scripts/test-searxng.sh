#!/usr/bin/env bash
# Test public SearXNG instances for a working JSON API.
# Run on YOUR machine (not the agent sandbox):  bash scripts/test-searxng.sh
#
# A "good" instance returns HTTP 200 with a JSON body containing a "results"
# array that has at least one result URL. Instances behind JS anti-bot walls
# (e.g. searx.xyz) are detected and flagged as FAIL because HanCode does a
# plain HTTP fetch with no JavaScript execution.

UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"

INSTANCES=(
  "https://searx.be/search"
  "https://search.bus-hit.me/search"
  "https://search.sapti.me/search"
  "https://searxng.nicfab.eu/search"
  "https://searx.tiekoetter.com/search"
  "https://search.ononoki.org/search"
  "https://searxng.tordenskjold.de/search"
  "https://searx.prvcy.eu/search"
  "https://searx.baczek.net/search"
  "https://searx.xyz/search"
  "https://searx.run/search"
  "https://search.chemicals-in-the-water.eu/search"
  "https://searxng.ca/search"
  "https://searx.catfluori.de/search"
  "https://searx.mistli.net/search"
  "https://search.mdosch.de/search"
  "https://searx.ebnar.xyz/search"
  "https://searxng.ch/search"
  "https://search.inetol.net/search"
  "https://searxng.site/search"
  "https://searx.work/search"
  "https://search.leptons.xyz/search"
  "https://ooglester.com/search"
  "https://searxng.online/search"
  "https://searx.ox2.fr/search"
  "https://searxng.au/search"
  "https://search.rabbit-company.com/search"
  "https://searx.semipvn.com/search"
  "https://searx.juancord.xyz/search"
  "https://searx.dresden.network/search"
)

echo "Testing ${#INSTANCES[@]} SearXNG instances (10s timeout each)..."
echo "----------------------------------------------------------------"

ok=0
for url in "${INSTANCES[@]}"; do
  body=$(curl -s -m 10 -L -A "$UA" "${url}?q=hello+world&format=json&language=en" 2>/dev/null)

  # Empty / unreachable
  if [ -z "$body" ]; then
    printf "FAIL  %-50s (no response / timeout)\n" "$url"
    continue
  fi

  # JS anti-bot challenge pages return HTML, not JSON
  if echo "$body" | grep -qi "<html"; then
    printf "FAIL  %-50s (HTML page, likely JS anti-bot wall)\n" "$url"
    continue
  fi

  # Must be JSON with a results array containing real URLs
  if echo "$body" | grep -q '"results"' && echo "$body" | grep -q '"url"'; then
    n=$(echo "$body" | grep -o '"url"' | wc -l | tr -d ' ')
    printf "OK    %-50s (%s result URLs)\n" "$url" "$n"
    ok=$((ok + 1))
  else
    printf "FAIL  %-50s (no JSON results)\n" "$url"
  fi
done

echo "----------------------------------------------------------------"
echo "$ok usable instance(s) found."
echo
echo "Pick one OK instance and put it in hancode.config.json:"
echo '  "searxngEndpointUrl": "https://<chosen-host>/search"'
