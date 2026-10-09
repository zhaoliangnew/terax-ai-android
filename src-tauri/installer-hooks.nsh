; "Open in Terax" shell verbs for folders, folder backgrounds, and drives.
; HKCU matches installer currentUser scope. %V = clicked path.
; NoWorkingDirectory keeps Explorer from overriding %V (System32 on Drive).

!macro NSIS_HOOK_POSTINSTALL
  ; llvm-mingw links libunwind dynamically; Windows must find it beside terax.exe.
  IfFileExists "$INSTDIR\resources\libunwind.dll" 0 +3
    CopyFiles /SILENT "$INSTDIR\resources\libunwind.dll" "$INSTDIR"
    SetFileAttributes "$INSTDIR\libunwind.dll" NORMAL

  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenInTerax" "" "Open in Terax"
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenInTerax" "Icon" '"$INSTDIR\terax.exe",0'
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenInTerax" "NoWorkingDirectory" ""
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenInTerax\command" "" '"$INSTDIR\terax.exe" "%V"'

  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenInTerax" "" "Open in Terax"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenInTerax" "Icon" '"$INSTDIR\terax.exe",0'
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenInTerax" "NoWorkingDirectory" ""
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenInTerax\command" "" '"$INSTDIR\terax.exe" "%V"'

  WriteRegStr HKCU "Software\Classes\Drive\shell\OpenInTerax" "" "Open in Terax"
  WriteRegStr HKCU "Software\Classes\Drive\shell\OpenInTerax" "Icon" '"$INSTDIR\terax.exe",0'
  WriteRegStr HKCU "Software\Classes\Drive\shell\OpenInTerax" "NoWorkingDirectory" ""
  WriteRegStr HKCU "Software\Classes\Drive\shell\OpenInTerax\command" "" '"$INSTDIR\terax.exe" "%V"'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  Delete "$INSTDIR\libunwind.dll"
  DeleteRegKey HKCU "Software\Classes\Directory\shell\OpenInTerax"
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\OpenInTerax"
  DeleteRegKey HKCU "Software\Classes\Drive\shell\OpenInTerax"
!macroend
