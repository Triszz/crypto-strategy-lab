# Start the backend server
$ErrorActionPreference = "Stop"
Set-Location "d:\Software-Architecture\crypto-strategy-lab\backend"
try {
    $proc = Start-Process -FilePath "npx.cmd" -ArgumentList "tsx","src/server.ts" -NoNewWindow -PassThru -RedirectStandardOutput "server_e2e.out.log" -RedirectStandardError "server_e2e.err.log"
    Write-Host "Started server with PID: $($proc.Id)"
    $proc.WaitForExit()
} catch {
    Write-Host "Error: $_"
}
