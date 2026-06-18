!include LogicLib.nsh
!include x64.nsh

!ifndef BUILD_UNINSTALLER

!define GIT_FOR_WINDOWS_VERSION "2.54.0"
!define GIT_FOR_WINDOWS_EXE "Git-2.54.0-64-bit.exe"
!define GIT_FOR_WINDOWS_URL "https://github.com/git-for-windows/git/releases/download/v2.54.0.windows.1/Git-2.54.0-64-bit.exe"

Var GitBashPath

!macro CheckGitBashPath CANDIDATE_PATH
  ${If} ${FileExists} "${CANDIDATE_PATH}"
    StrCpy $GitBashPath "${CANDIDATE_PATH}"
    Return
  ${EndIf}
!macroend

Function DetectGitBash
  StrCpy $GitBashPath ""

  !insertmacro CheckGitBashPath "$PROGRAMFILES64\Git\bin\bash.exe"
  !insertmacro CheckGitBashPath "$PROGRAMFILES\Git\bin\bash.exe"
  !insertmacro CheckGitBashPath "$PROGRAMFILES64\Git\usr\bin\bash.exe"
  !insertmacro CheckGitBashPath "$PROGRAMFILES\Git\usr\bin\bash.exe"

  SetRegView 64
  ReadRegStr $0 HKLM "SOFTWARE\GitForWindows" "InstallPath"
  ${If} $0 != ""
  ${AndIf} ${FileExists} "$0\bin\bash.exe"
    StrCpy $GitBashPath "$0\bin\bash.exe"
    Return
  ${EndIf}

  ReadRegStr $0 HKCU "SOFTWARE\GitForWindows" "InstallPath"
  ${If} $0 != ""
  ${AndIf} ${FileExists} "$0\bin\bash.exe"
    StrCpy $GitBashPath "$0\bin\bash.exe"
    Return
  ${EndIf}
FunctionEnd

Function InstallGitForWindows
  StrCpy $0 "$TEMP\${GIT_FOR_WINDOWS_EXE}"

  DetailPrint "正在下载 Git for Windows ${GIT_FOR_WINDOWS_VERSION}..."
  nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri ''${GIT_FOR_WINDOWS_URL}'' -OutFile ''$0''"'
  Pop $1

  ${If} $1 != 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "Git for Windows 下载失败。你可以稍后在应用的「Windows 环境检测」里重新安装 Git Bash。"
    Return
  ${EndIf}

  DetailPrint "正在安装 Git for Windows ${GIT_FOR_WINDOWS_VERSION}..."
  ExecWait '"$0" /VERYSILENT /NORESTART /NOCANCEL /SP- /CLOSEAPPLICATIONS /RESTARTAPPLICATIONS' $1

  ${If} $1 != 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "Git for Windows 安装程序返回错误码 $1。你可以稍后在应用的「Windows 环境检测」里重新安装 Git Bash。"
    Return
  ${EndIf}

  Call DetectGitBash
  ${If} $GitBashPath != ""
    DetailPrint "Git Bash 已就绪：$GitBashPath"
  ${Else}
    MessageBox MB_OK|MB_ICONINFORMATION "Git for Windows 安装已完成。若应用仍提示缺少 Git Bash，请重启 Windows 后在应用内重新检测。"
  ${EndIf}
FunctionEnd

!macro customInstall
  ${IfNot} ${Silent}
    Call DetectGitBash
    ${If} $GitBashPath != ""
      DetailPrint "已检测到 Git Bash：$GitBashPath"
    ${Else}
      MessageBox MB_YESNO|MB_ICONQUESTION "Windows 上未检测到 Git Bash。foodism-gravity 运行 Agent 需要 Git Bash 或 WSL。是否现在安装 Git for Windows（包含 Git Bash）？" IDNO done
      Call InstallGitForWindows
    ${EndIf}
  ${EndIf}

  done:
!macroend

!endif # BUILD_UNINSTALLER
