# Test public SearXNG instances for a working JSON API.
# Run in PowerShell:  powershell -ExecutionPolicy Bypass -File scripts\test-searxng.ps1
#
# A "good" instance returns HTTP 200 with a JSON body containing a "results"
# array with at least one result URL. JS anti-bot challenge pages (e.g. searx.xyz)
# are flagged as FAIL because HanCode does a plain HTTP fetch, no JavaScript.

$ErrorActionPreference = "SilentlyContinue"

$UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"

$instances = @(
  "https://searx.be/search",
  "https://search.bus-hit.me/search",
  "https://search.sapti.me/search",
  "https://searxng.nicfab.eu/search",
  "https://searx.tiekoetter.com/search",
  "https://search.ononoki.org/search",
  "https://searxng.tordenskjold.de/search",
  "https://searx.prvcy.eu/search",
  "https://searx.baczek.net/search",
  "https://searx.xyz/search",
  "https://searx.run/search",
  "https://search.chemicals-in-the-water.eu/search",
  "https://searxng.ca/search",
  "https://searx.catfluori.de/search",
  "https://searx.mistli.net/search",
  "https://search.mdosch.de/search",
  "https://searx.ebnar.xyz/search",
  "https://searxng.ch/search",
  "https://search.inetol.net/search",
  "https://searxng.site/search",
  "https://searx.work/search",
  "https://search.leptons.xyz/search",
  "https://ooglester.com/search",
  "https://searxng.online/search",
  "https://searx.ox2.fr/search",
  "https://searxng.au/search",
  "https://search.rabbit-company.com/search",
  "https://searx.semipvn.com/search",
  "https://searx.juancord.xyz/search",
  "https://searx.dresden.network/search"
)

Write-Host "Testing $($instances.Count) SearXNG instances (10s timeout each)..."
Write-Host "----------------------------------------------------------------"

$ok = 0
foreach ($url in $instances) {
  try {
    $resp = Invoke-WebRequest -Uri "$($url)?q=hello+world&format=json&language=en" `
      -Headers @{ "User-Agent" = $UA } -TimeoutSec 10 -UseBasicParsing
    $body = $resp.Content
  } catch {
    $body = ""
  }

  if ([string]::IsNullOrEmpty($body)) {
    Write-Host ("FAIL  {0,-50} (no response / timeout)" -f $url)
    continue
  }
  if ($body -match "<html") {
    Write-Host ("FAIL  {0,-50} (HTML page, likely JS anti-bot wall)" -f $url)
    continue
  }
  if ($body -match '"results"' -and $body -match '"url"') {
    $n = ([regex]::Matches($body, '"url"')).Count
    Write-Host ("OK    {0,-50} ({1} result URLs)" -f $url, $n)
    $ok++
  } else {
    Write-Host ("FAIL  {0,-50} (no JSON results)" -f $url)
  }
}

Write-Host "----------------------------------------------------------------"
Write-Host "$ok usable instance(s) found."
Write-Host ""
Write-Host "Pick one OK instance and put it in hancode.config.json:"
Write-Host '  "searxngEndpointUrl": "https://<chosen-host>/search"'
