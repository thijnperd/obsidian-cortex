; Cortex, per-user install. No admin, no service: a Start Menu entry, an
; uninstaller, an optional login entry, and App Paths so `cortex` resolves.
;
; CI passes the version: ISCC.exe /DAppVersion=0.3.0 installer\cortex.iss

#ifndef AppVersion
  #define AppVersion "0.3.0"
#endif

[Setup]
AppId={{8C0B6B7E-6F0B-4C2E-9A0E-6E4E2C7A1B31}
AppName=Cortex
AppVersion={#AppVersion}
AppPublisher=Cortex
DefaultDirName={localappdata}\Programs\Cortex
DefaultGroupName=Cortex
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=..\dist
OutputBaseFilename=CortexSetup-{#AppVersion}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\cortex.exe
; The binary is unsigned, so the installer is too. The docs say so.

[Files]
Source: "..\target\release\cortex.exe"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{userprograms}\Cortex"; Filename: "{app}\cortex.exe"; Parameters: "app"
Name: "{userdesktop}\Cortex"; Filename: "{app}\cortex.exe"; Parameters: "app"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; Flags: unchecked
Name: "autostart"; Description: "Start Cortex when I sign in"; Flags: unchecked

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "Cortex"; ValueData: """{app}\cortex.exe"" app"; Flags: uninsdeletevalue; Tasks: autostart
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\App Paths\cortex.exe"; ValueType: string; ValueName: ""; ValueData: "{app}\cortex.exe"; Flags: uninsdeletekey

[Run]
Filename: "{app}\cortex.exe"; Parameters: "app"; Description: "Start Cortex"; Flags: nowait postinstall skipifsilent
