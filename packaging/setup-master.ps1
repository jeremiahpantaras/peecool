<#
 Pickle Scoring — Master PC setup (Windows 11). Run in PowerShell AS ADMINISTRATOR. Safe to run again.
 Applies the hardening from docs/planning/DEPLOYMENT_AND_OFFLINE.md §2–§4 and prints a checklist.
 NOT YET RUN ON A REAL WINDOWS 11 MACHINE — verify with the roadmap Phase 13 acceptance tests.
#>
param(
  [int]$Port = 8080,
  [string]$DataDir = "$env:ProgramData\PickleScoring",
  [switch]$DefenderExclusion,
  [string]$StaticIp,            # e.g. 192.168.10.10  (omit when you use a router DHCP reservation)
  [int]$PrefixLength = 24,
  [string]$Gateway
)
$ErrorActionPreference = 'Stop'
$results = @()
function Step($name, [scriptblock]$body) {
  try { & $body; $script:results += [pscustomobject]@{ Step = $name; Result = 'OK' } }
  catch { $script:results += [pscustomobject]@{ Step = $name; Result = "FAILED: $($_.Exception.Message)" } }
}

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Error 'Please run this script as Administrator.'; exit 1
}

# --- Power: the PC must never sleep or hibernate while courts are in use -------------------------
Step 'Power plan: never sleep / hibernate on AC'      { powercfg /change standby-timeout-ac 0; powercfg /change hibernate-timeout-ac 0; powercfg /change disk-timeout-ac 0; powercfg /change monitor-timeout-ac 15 }
Step 'Hibernation off'                                { powercfg /hibernate off }
Step 'Fast Startup off (clean boots, service starts)' { New-Item -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Power' -Force | Out-Null; Set-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Power' -Name HiberbootEnabled -Value 0 -Type DWord }
Step 'Ethernet adapter may not power down'            { Get-NetAdapter -Physical | Where-Object Status -eq 'Up' | ForEach-Object { Disable-NetAdapterPowerManagement -Name $_.Name -NoRestart -ErrorAction SilentlyContinue } }

# --- Network ---------------------------------------------------------------------------------------
if ($StaticIp) {
  Step "Static IP $StaticIp"                          {
    $nic = Get-NetAdapter -Physical | Where-Object Status -eq 'Up' | Select-Object -First 1
    Remove-NetIPAddress -InterfaceIndex $nic.ifIndex -Confirm:$false -ErrorAction SilentlyContinue
    New-NetIPAddress -InterfaceIndex $nic.ifIndex -IPAddress $StaticIp -PrefixLength $PrefixLength -DefaultGateway $Gateway | Out-Null }
}
Step 'Network profile = Private (best effort)'        { Get-NetConnectionProfile | Where-Object { $_.IPv4Connectivity -ne 'Disconnected' } | Set-NetConnectionProfile -NetworkCategory Private -ErrorAction SilentlyContinue }
# Scoped to the local subnet and independent of the Windows profile (an internet-less LAN is often labelled Public)
Step "Firewall: allow TCP $Port from the local subnet only" {
  Get-NetFirewallRule -DisplayName 'Pickle Scoring*' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  New-NetFirewallRule -DisplayName 'Pickle Scoring (LAN)' -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port -RemoteAddress LocalSubnet -Profile Any | Out-Null }

# --- Data folder permissions for the LocalService account -----------------------------------------
Step "Data folder $DataDir"                           {
  New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
  icacls $DataDir /grant '*S-1-5-19:(OI)(CI)M' | Out-Null }   # NT AUTHORITY\LocalService = S-1-5-19

if ($DefenderExclusion) { Step 'Defender: exclude the data folder' { Add-MpPreference -ExclusionPath $DataDir } }

# --- Report ---------------------------------------------------------------------------------------
$results | Format-Table -AutoSize
$ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '169.*' -and $_.IPAddress -ne '127.0.0.1' }).IPAddress
Write-Host "`nApp address for every device: http://$($ip | Select-Object -First 1):$Port"
Write-Host @'

MANUAL CHECKLIST (cannot be scripted safely):
  [ ] BIOS/UEFI: "Restore on AC power loss" = Power On
  [ ] Windows Update: set Active Hours to cover opening hours; avoid automatic restarts while courts are in use
  [ ] UPS: USB-connected, Windows battery action "Shut down" at 10 %, test by pulling the plug
  [ ] Router: DHCP reservation for this PC (or the static address above) outside the DHCP pool
  [ ] Staff Wi-Fi: WPA2/WPA3 with a strong passphrase, separate from guest Wi-Fi
'@
if ($results.Result -match 'FAILED') { exit 2 }
