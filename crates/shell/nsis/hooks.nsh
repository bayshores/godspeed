; Removes an old electron-builder godspeed first. The "_?=" keeps its uninstaller from copying itself
; to TEMP and returning at once, which would let it delete the shortcuts this installer makes next.
!macro NSIS_HOOK_PREINSTALL
  IfFileExists "$LOCALAPPDATA\Programs\godspeed\Uninstall godspeed.exe" 0 no_old_godspeed
    ExecWait '"$LOCALAPPDATA\Programs\godspeed\Uninstall godspeed.exe" /S _?=$LOCALAPPDATA\Programs\godspeed' $0
    Delete "$LOCALAPPDATA\Programs\godspeed\Uninstall godspeed.exe"
    RMDir /r "$LOCALAPPDATA\Programs\godspeed"
  no_old_godspeed:
!macroend
