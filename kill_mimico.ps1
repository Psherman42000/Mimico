Get-Process -Name "Mimico" -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 3
$remaining = Get-Process -Name "Mimico" -ErrorAction SilentlyContinue
if ($remaining) {
    Write-Host "Still running:"
    $remaining | Format-Table Id, ProcessName
} else {
    Write-Host "All Mimico processes killed successfully"
}
