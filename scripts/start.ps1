# One-shot: free ports then start Winsur
Set-Location $PSScriptRoot\..
& "$PSScriptRoot\free-ports.ps1"
Start-Sleep -Seconds 1
npm start
