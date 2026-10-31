; Nokta starts when the user logs in; Task Manager's Startup apps can turn
; that off. The uninstaller removes it.
!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Nokta" '"$INSTDIR\Nokta.exe"'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Nokta"
!macroend
