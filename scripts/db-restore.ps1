# Stellt die SlalomDesigner-Datenbank aus einem Backup wieder her (Windows).
# ACHTUNG: überschreibt die aktuelle Datenbank.
#
#   powershell -ExecutionPolicy Bypass -File scripts\db-restore.ps1 backups\slalom-...dump
#   .\scripts\db-restore.ps1 <datei> -Yes
param(
  [Parameter(Mandatory = $true)][string]$File,
  [switch]$Yes
)
$ErrorActionPreference = "Stop"

$DbService = if ($env:DB_SERVICE) { $env:DB_SERVICE } else { "db" }
$DbUser    = if ($env:POSTGRES_USER) { $env:POSTGRES_USER } else { "ksp" }
$DbName    = if ($env:POSTGRES_DB) { $env:POSTGRES_DB } else { "ksp" }

if (-not (Test-Path $File)) { Write-Error "Backup-Datei nicht gefunden: $File"; exit 1 }

function Dc { if ($env:COMPOSE_FILE) { docker compose -f $env:COMPOSE_FILE @args } else { docker compose @args } }

$cid = (Dc ps -q $DbService).Trim()
if (-not $cid) { Write-Error "DB-Service '$DbService' läuft nicht."; exit 1 }

if (-not $Yes) {
  $ans = Read-Host "Dies überschreibt die Datenbank '$DbName' mit '$File'. Fortfahren? (ja/NEIN)"
  if ($ans -ne "ja") { Write-Host "Abgebrochen."; exit 1 }
}

Write-Host "Stelle Datenbank '$DbName' wieder her …"
docker cp $File "$($cid):/tmp/restore.dump"
# --clean --if-exists entfernt vorhandene Objekte vor dem Import; Hinweise zu
# nicht vorhandenen Objekten sind unkritisch (daher kein harter Abbruch).
Dc exec -T $DbService pg_restore --clean --if-exists --no-owner -U $DbUser -d $DbName /tmp/restore.dump
Dc exec -T $DbService rm -f /tmp/restore.dump

Write-Host "Wiederherstellung abgeschlossen. App ggf. neu starten: docker compose restart app"
