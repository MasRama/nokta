; Nokta starts when the user logs in; Task Manager's Startup apps can turn
; that off. The `nokta` command, in bin\ so it does not shadow Nokta.exe,
; goes on the user's Path for new terminals. The uninstaller removes both.

; Adds (+) or removes (-) $INSTDIR\bin on HKCU\Environment's Path, keeping
; the other folders and their %VARIABLES% as they are, then tells running
; programs the environment changed.
!macro NOKTA_USER_PATH change
  nsExec::Exec `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$$bin = '$INSTDIR\bin'; $$key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $$true); $$dirs = @(($$key.GetValue('Path', '', 'DoNotExpandEnvironmentNames')) -split ';' | Where-Object { $$_ -and $$_ -ne $$bin }); if ('${change}' -eq '+') { $$dirs += $$bin }; $$key.SetValue('Path', ($$dirs -join ';'), 'ExpandString')"`
  Pop $0
  ; HWND_BROADCAST, WM_SETTINGCHANGE
  SendMessage 0xFFFF 0x1A 0 "STR:Environment" /TIMEOUT=5000
!macroend

!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Nokta" '"$INSTDIR\Nokta.exe"'
  !insertmacro NOKTA_USER_PATH "+"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Nokta"
  !insertmacro NOKTA_USER_PATH "-"
!macroend
