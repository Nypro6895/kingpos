# NSIS 3.0 resolves relative includes in the working directory first.
# Keep the original templates available while selecting our upgrade helper.
!addincludedir "${PROJECT_DIR}\node_modules\app-builder-lib\templates\nsis"
!cd "${BUILD_RESOURCES_DIR}\installer"

!macro customCheckAppRunning
  # Native enumeration avoids PowerShell profiles and the WMI service.
  ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
  ${While} $R0 == 0
    ${If} ${Silent}
      SetErrorLevel 2
      Quit
    ${EndIf}
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "Please close ${PRODUCT_NAME}, then choose Retry to continue installation." /SD IDCANCEL IDRETRY +3
    SetErrorLevel 2
    Quit
    ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
  ${EndWhile}
  # 603 means no match. Fail closed if enumeration itself failed.
  ${If} $R0 != 603
    SetErrorLevel 2
    Quit
  ${EndIf}
!macroend
