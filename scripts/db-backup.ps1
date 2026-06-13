# Sichert die SlalomDesigner-Datenbank aus dem laufenden Docker-Compose-Stack (Windows).
#
#   powershell -ExecutionPolicy Bypass -File scripts\db-backup.ps1
#   $env:COMPOSE_FILE="deploy\docker-compose.nas.yml"; .\scripts\db-backup.ps1
#
# pg_dump läuft IM Container; die Dump-Datei wird per `docker cp` binärsicher
# herauskopiert (keine PowerShell-Stream-Umkodierung).
$ErrorActionPreference = "Stop"

$DbService = if ($env:DB_SERVICE) { $env:DB_SERVICE } else { "db" }
$DbUser    = if ($env:POSTGRES_USER) { $env:POSTGRES_USER } else { "ksp" }
$DbName    = if ($env:POSTGRES_DB) { $env:POSTGRES_DB } else { "ksp" }
$OutDir    = if ($env:BACKUP_DIR) { $env:BACKUP_DIR } else { "backups" }

function Dc { if ($env:COMPOSE_FILE) { docker compose -f $env:COMPOSE_FILE @args } else { docker compose @args } }

$cid = (Dc ps -q $DbService).Trim()
if (-not $cid) { Write-Error "DB-Service '$DbService' läuft nicht (docker compose up -d zuerst)."; exit 1 }

if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir | Out-Null }
$ts  = Get-Date -Format "yyyyMMdd-HHmmss"
$out = Join-Path $OutDir "slalom-$ts.dump"

Write-Host "Sichere Datenbank '$DbName' aus Container $($cid.Substring(0,12)) …"
Dc exec -T $DbService sh -c "pg_dump -U '$DbUser' -Fc '$DbName' > /tmp/slalom.dump"
docker cp "$($cid):/tmp/slalom.dump" $out
Dc exec -T $DbService rm -f /tmp/slalom.dump

$size = "{0:N1} MB" -f ((Get-Item $out).Length / 1MB)
Write-Host "Backup gespeichert: $out  ($size)"
