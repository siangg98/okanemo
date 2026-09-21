$ErrorActionPreference = 'Stop'

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$backupPath = Join-Path $projectRoot 'backups'

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw 'Docker CLI was not found. Start Docker Desktop and open a new PowerShell window.'
}

Push-Location $projectRoot
try {
  New-Item -ItemType Directory -Path $backupPath -Force | Out-Null

  # Preserve whichever named volume currently backs /data. This handles both
  # the original Compose container and subsequent standalone runs.
  $composeId = @(
    & docker ps -aq `
      --filter 'label=com.docker.compose.project=okanemo' `
      --filter 'label=com.docker.compose.service=okanemo'
  ) | Select-Object -First 1

  $standaloneId = @(& docker ps -aq --filter 'name=^/okanemo$') | Select-Object -First 1
  $sourceId = if ($composeId) { $composeId } else { $standaloneId }
  $dataVolume = ''
  if ($sourceId) {
    $dataVolume = (& docker inspect $sourceId --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}').Trim()
  }
  if (-not $dataVolume) {
    $dataVolume = 'okanemo-data'
    & docker volume create $dataVolume | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not create the Okanemo data volume.' }
  }

  & docker build --tag 'okanemo:local' $projectRoot
  if ($LASTEXITCODE -ne 0) { throw 'The Okanemo image build failed.' }

  if ($composeId) {
    & docker compose down
    if ($LASTEXITCODE -ne 0) { throw 'Could not stop the existing Compose app.' }
  }
  if ($standaloneId) {
    & docker rm --force okanemo | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not replace the existing Okanemo container.' }
  }

  & docker run `
    --detach `
    --name okanemo `
    --restart unless-stopped `
    --publish '127.0.0.1:8888:8080' `
    --mount "type=volume,source=$dataVolume,target=/data" `
    --mount "type=bind,source=$backupPath,target=/backups" `
    'okanemo:local'
  if ($LASTEXITCODE -ne 0) { throw 'Could not start the Okanemo container.' }

  Write-Host "Okanemo is running at http://127.0.0.1:8888 using volume $dataVolume"
} finally {
  Pop-Location
}
