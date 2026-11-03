; Inno Setup 6 script — builds PickleScoringSetup-<version>.exe from ./stage (see packaging/stage.mjs).
; NOT YET BUILT OR RUN ON WINDOWS. Unsigned installers trigger a one-time SmartScreen "Run anyway" prompt (OPEN_QUESTIONS Q31).
#define AppName "Pickle Scoring"
#define AppVersion "1.0.0"

[Setup]
AppId={{7B6E1C9A-5D0F-4C9B-9E57-3C7D2A9B1F10}
AppName={#AppName}
AppVersion={#AppVersion}
DefaultDirName={autopf}\PickleScoring
DefaultGroupName={#AppName}
OutputDir=..\dist-installer
OutputBaseFilename=PickleScoringSetup-{#AppVersion}
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=admin
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayName={#AppName}
MinVersion=10.0.22000

[Files]
Source: "stage\runtime\*"; DestDir: "{app}\runtime"; Flags: recursesubdirs ignoreversion
Source: "stage\app\*"; DestDir: "{app}\app"; Flags: recursesubdirs ignoreversion
Source: "stage\PickleScoringService.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "PickleScoring.xml"; DestDir: "{app}"; DestName: "PickleScoringService.xml"; Flags: ignoreversion
Source: "stage\pickle-scoring.cmd"; DestDir: "{app}"; Flags: ignoreversion
Source: "setup-master.ps1"; DestDir: "{app}"; Flags: ignoreversion

[Dirs]
Name: "{commonappdata}\PickleScoring"; Permissions: users-modify

[Icons]
Name: "{group}\Pickle Scoring"; Filename: "http://localhost:8080"
Name: "{commondesktop}\Pickle Scoring"; Filename: "http://localhost:8080"
Name: "{group}\Pickle Scoring Tools"; Filename: "{cmd}"; Parameters: "/k ""cd /d {app} && pickle-scoring.cmd"""; WorkingDir: "{app}"

[Run]
; 1. firewall, power settings, data-folder permissions
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\setup-master.ps1"""; StatusMsg: "Configuring Windows for the Master PC…"; Flags: runhidden waituntilterminated
; 2. register and start the Windows service
Filename: "{app}\PickleScoringService.exe"; Parameters: "install"; Flags: runhidden waituntilterminated
Filename: "{app}\PickleScoringService.exe"; Parameters: "start"; Flags: runhidden waituntilterminated
Filename: "http://localhost:8080"; Description: "Open Pickle Scoring and complete first-run setup"; Flags: postinstall shellexec skipifsilent

[UninstallRun]
Filename: "{app}\PickleScoringService.exe"; Parameters: "stop"; Flags: runhidden waituntilterminated; RunOnceId: "StopSvc"
Filename: "{app}\PickleScoringService.exe"; Parameters: "uninstall"; Flags: runhidden waituntilterminated; RunOnceId: "RemoveSvc"
; The data folder (C:\ProgramData\PickleScoring) is deliberately NOT removed.
