<#
.SYNOPSIS
  BadgerAI CLI launcher.

.DESCRIPTION
  Manages the Python RAG service and wraps the Rust CLI (plshelp.exe).

  Commands:
    start       Start the RAG service in the background
    stop        Stop the RAG service
    status      Show service health
    ui          Start the Vite dev server and open the frontend
    build       Build the React frontend for production
    <any>       Pass-through to plshelp.exe (index, query, show, …)

.EXAMPLE
  .\badgerai.ps1 start
  .\badgerai.ps1 ui
  .\badgerai.ps1 build
  .\badgerai.ps1 query "how do I use async functions?"
#>

$ErrorActionPreference = "Stop"

$ScriptDir   = $PSScriptRoot
$PythonExe   = "C:\Users\harih\anaconda3\envs\badgerai\python.exe"
$RustBin     = Join-Path $ScriptDir "target\release\plshelp.exe"
$StartScript = Join-Path $ScriptDir "rag_service\start.py"
$FrontendDir = Join-Path $ScriptDir "frontend"
$PidFile     = Join-Path $env:TEMP "badgerai_service.pid"
$LogFile     = Join-Path $env:TEMP "badgerai_service.log"
$ServiceUrl  = "http://127.0.0.1:8765"

function Test-ServiceRunning {
    try {
        $null = Invoke-RestMethod -Uri "$ServiceUrl/v1/health" -TimeoutSec 2 -ErrorAction Stop
        return $true
    } catch {
        return $false
    }
}

function Start-Service {
    if (Test-ServiceRunning) {
        Write-Host "RAG service is already running at $ServiceUrl" -ForegroundColor Green
        return
    }
    Write-Host "Starting RAG service (this loads ~8 GB of models — first start takes a minute)…" -ForegroundColor Cyan
    $proc = Start-Process -FilePath $PythonExe `
        -ArgumentList $StartScript `
        -WorkingDirectory $ScriptDir `
        -RedirectStandardOutput $LogFile `
        -RedirectStandardError $LogFile `
        -WindowStyle Hidden `
        -PassThru
    $proc.Id | Out-File -FilePath $PidFile -Encoding ascii
    Write-Host "Service PID $($proc.Id) — waiting for health check…" -ForegroundColor Yellow
    $tries = 0
    while (-not (Test-ServiceRunning) -and $tries -lt 60) {
        Start-Sleep -Seconds 2
        $tries++
    }
    if (Test-ServiceRunning) {
        Write-Host "RAG service ready at $ServiceUrl" -ForegroundColor Green
    } else {
        Write-Host "Service did not start in time. Check logs: $LogFile" -ForegroundColor Red
    }
}

function Stop-Service {
    if (Test-Path $PidFile) {
        $procId = [int](Get-Content $PidFile -Raw)
        try {
            Stop-Process -Id $procId -Force -ErrorAction Stop
            Write-Host "Stopped service (PID $procId)." -ForegroundColor Yellow
        } catch {
            Write-Host "Process $procId not found (already stopped?)." -ForegroundColor Yellow
        }
        Remove-Item $PidFile -Force
    } else {
        Write-Host "No PID file found — service may not be running." -ForegroundColor Yellow
    }
}

function Show-Status {
    if (Test-ServiceRunning) {
        $data = Invoke-RestMethod -Uri "$ServiceUrl/v1/health"
        Write-Host "Service:  ONLINE" -ForegroundColor Green
        $device = if ($data.cuda_device) { $data.cuda_device } else { "CPU" }
        Write-Host "Device:   $device"
        Write-Host "URL:      $ServiceUrl"
    } else {
        Write-Host "Service:  OFFLINE" -ForegroundColor Red
        Write-Host "Run:  .\badgerai.ps1 start" -ForegroundColor Yellow
    }
}

function Open-UI {
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) {
        Write-Host "Node.js not found. Install it with: winget install OpenJS.NodeJS.LTS" -ForegroundColor Red
        return
    }
    Write-Host "Starting Vite dev server at http://localhost:5173 …" -ForegroundColor Cyan
    Start-Process -FilePath $node.Source `
        -ArgumentList (Join-Path $FrontendDir "node_modules\.bin\vite") `
        -WorkingDirectory $FrontendDir `
        -WindowStyle Normal
    Start-Sleep -Seconds 2
    Start-Process "http://localhost:5173"
}

function Invoke-UIBuild {
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) {
        Write-Host "Node.js not found. Install it with: winget install OpenJS.NodeJS.LTS" -ForegroundColor Red
        return
    }
    Write-Host "Building React frontend…" -ForegroundColor Cyan
    & $node.Source (Join-Path $FrontendDir "node_modules\.bin\vite") build `
        --config (Join-Path $FrontendDir "vite.config.js")
    Write-Host "Built to frontend/dist/" -ForegroundColor Green
}

# ── Dispatch ──────────────────────────────────────────────────────────────────
$cmd = $args[0]
switch ($cmd) {
    "start"  { Start-Service }
    "stop"   { Stop-Service }
    "status" { Show-Status }
    "ui"     { Open-UI }
    "build"  { Invoke-UIBuild }
    default  {
        if (-not (Test-Path $RustBin)) {
            Write-Host "Rust binary not found. Build it with:" -ForegroundColor Red
            Write-Host "  cargo build --release" -ForegroundColor Yellow
            exit 1
        }
        & $RustBin @args
    }
}
