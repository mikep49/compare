; Included by electron-builder's NSIS installer (see "nsis" in package.json).
; Adds Compare to Explorer's "Send to" menu: select one or two files, then
; Send to > Compare.

!macro customInstall
  CreateShortCut "$SENDTO\Compare.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
!macroend

!macro customUnInstall
  Delete "$SENDTO\Compare.lnk"
!macroend
