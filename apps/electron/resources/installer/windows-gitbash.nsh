!include LogicLib.nsh
!include x64.nsh

!ifndef BUILD_UNINSTALLER

!define GIT_FOR_WINDOWS_VERSION "2.54.0"
!define GIT_FOR_WINDOWS_EXE "Git-2.54.0-64-bit.exe"
!define GIT_FOR_WINDOWS_URL "https://npmmirror.com/mirrors/git-for-windows/v2.54.0.windows.1/Git-2.54.0-64-bit.exe"
!define GIT_FOR_WINDOWS_FALLBACK_URL "https://github.com/git-for-windows/git/releases/download/v2.54.0.windows.1/Git-2.54.0-64-bit.exe"

Var GitBashPath
Var ShellEnvironmentName
Var GitInstallLogPath

!macro AppendGitInstallLog MESSAGE
  ${If} $GitInstallLogPath == ""
    StrCpy $GitInstallLogPath "$TEMP\foodism-gravity-git-install.log"
  ${EndIf}

  FileOpen $2 "$GitInstallLogPath" a
  ${If} $2 != ""
    FileWrite $2 "${MESSAGE}$\r$\n"
    FileClose $2
  ${EndIf}
!macroend

Function InitGitInstallLog
  StrCpy $GitInstallLogPath "$TEMP\foodism-gravity-git-install.log"
  Delete "$GitInstallLogPath"
  !insertmacro AppendGitInstallLog "Git for Windows 安装日志"
  !insertmacro AppendGitInstallLog "主下载源：${GIT_FOR_WINDOWS_URL}"
  !insertmacro AppendGitInstallLog "备用下载源：${GIT_FOR_WINDOWS_FALLBACK_URL}"
FunctionEnd

!macro CheckGitBashPath CANDIDATE_PATH
  ${If} ${FileExists} "${CANDIDATE_PATH}"
    StrCpy $GitBashPath "${CANDIDATE_PATH}"
    StrCpy $ShellEnvironmentName "Git Bash"
    !insertmacro AppendGitInstallLog "检测到 Git Bash：${CANDIDATE_PATH}"
    Return
  ${EndIf}
!macroend

Function DetectGitBash
  !insertmacro AppendGitInstallLog "开始检测 Git Bash / WSL"
  StrCpy $GitBashPath ""
  StrCpy $ShellEnvironmentName ""

  !insertmacro CheckGitBashPath "$PROGRAMFILES64\Git\bin\bash.exe"
  !insertmacro CheckGitBashPath "$PROGRAMFILES\Git\bin\bash.exe"
  !insertmacro CheckGitBashPath "$PROGRAMFILES64\Git\usr\bin\bash.exe"
  !insertmacro CheckGitBashPath "$PROGRAMFILES\Git\usr\bin\bash.exe"

  SetRegView 64
  ReadRegStr $0 HKLM "SOFTWARE\GitForWindows" "InstallPath"
  ${If} $0 != ""
  ${AndIf} ${FileExists} "$0\bin\bash.exe"
    StrCpy $GitBashPath "$0\bin\bash.exe"
    StrCpy $ShellEnvironmentName "Git Bash"
    !insertmacro AppendGitInstallLog "检测到 Git Bash：$GitBashPath"
    Return
  ${EndIf}

  ReadRegStr $0 HKCU "SOFTWARE\GitForWindows" "InstallPath"
  ${If} $0 != ""
  ${AndIf} ${FileExists} "$0\bin\bash.exe"
    StrCpy $GitBashPath "$0\bin\bash.exe"
    StrCpy $ShellEnvironmentName "Git Bash"
    !insertmacro AppendGitInstallLog "检测到 Git Bash：$GitBashPath"
    Return
  ${EndIf}

  nsExec::ExecToStack 'powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$$cmd = Get-Command bash.exe -ErrorAction SilentlyContinue; if ($$cmd -and $$cmd.Source -match ''\\Git\\'') { Write-Output $$cmd.Source; exit 0 }; exit 1"'
  Pop $1
  Pop $0
  ${If} $1 == 0
  ${AndIf} $0 != ""
    StrCpy $GitBashPath "$0"
    StrCpy $ShellEnvironmentName "Git Bash"
    !insertmacro AppendGitInstallLog "检测到 PATH 中的 Git Bash：$GitBashPath"
    Return
  ${EndIf}

  nsExec::ExecToStack 'wsl.exe --status'
  Pop $1
  Pop $0
  ${If} $1 == 0
    StrCpy $GitBashPath "wsl.exe"
    StrCpy $ShellEnvironmentName "WSL"
    !insertmacro AppendGitInstallLog "检测到 WSL：wsl.exe --status 可用"
    Return
  ${EndIf}

  !insertmacro AppendGitInstallLog "未检测到 Git Bash 或 WSL"
FunctionEnd

Function InstallGitForWindows
  StrCpy $0 "$TEMP\${GIT_FOR_WINDOWS_EXE}"
  ${If} $GitInstallLogPath == ""
    Call InitGitInstallLog
  ${EndIf}

  Call DetectGitBash
  ${If} $GitBashPath != ""
    DetailPrint "$ShellEnvironmentName 已就绪：$GitBashPath"
    Return
  ${EndIf}

  DetailPrint "Git for Windows 安装日志：$GitInstallLogPath"
  DetailPrint "正在下载 Git for Windows ${GIT_FOR_WINDOWS_VERSION}..."
  !insertmacro AppendGitInstallLog "开始下载 Git for Windows：${GIT_FOR_WINDOWS_URL}"
  nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri ''${GIT_FOR_WINDOWS_URL}'' -OutFile ''$0'' -UseBasicParsing -ErrorAction Stop; Add-Content -LiteralPath ''$GitInstallLogPath'' -Encoding UTF8 -Value ''主下载源下载成功''; exit 0 } catch { Add-Content -LiteralPath ''$GitInstallLogPath'' -Encoding UTF8 -Value (''主下载源下载失败：'' + $$_.Exception.Message); exit 1 }"'
  Pop $1
  !insertmacro AppendGitInstallLog "主下载源退出码：$1"

  ${If} $1 != 0
    DetailPrint "主下载源失败，尝试 GitHub 官方下载源..."
    !insertmacro AppendGitInstallLog "开始下载 Git for Windows：${GIT_FOR_WINDOWS_FALLBACK_URL}"
    nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri ''${GIT_FOR_WINDOWS_FALLBACK_URL}'' -OutFile ''$0'' -UseBasicParsing -ErrorAction Stop; Add-Content -LiteralPath ''$GitInstallLogPath'' -Encoding UTF8 -Value ''备用下载源下载成功''; exit 0 } catch { Add-Content -LiteralPath ''$GitInstallLogPath'' -Encoding UTF8 -Value (''备用下载源下载失败：'' + $$_.Exception.Message); exit 1 }"'
    Pop $1
    !insertmacro AppendGitInstallLog "备用下载源退出码：$1"
  ${EndIf}

  ${If} $1 != 0
    Call DetectGitBash
    ${If} $GitBashPath != ""
      DetailPrint "$ShellEnvironmentName 已就绪：$GitBashPath"
    ${Else}
      !insertmacro AppendGitInstallLog "下载失败，安装器未能自动安装 Git for Windows"
      MessageBox MB_OK|MB_ICONEXCLAMATION "安装器未检测到 Git Bash 或 WSL，且 Git for Windows 下载失败。日志文件：$GitInstallLogPath$\r$\n你可以稍后在应用的「Windows 环境检测」里重新安装 Git Bash。"
    ${EndIf}
    Return
  ${EndIf}

  DetailPrint "正在安装 Git for Windows ${GIT_FOR_WINDOWS_VERSION}..."
  !insertmacro AppendGitInstallLog "开始运行 Git for Windows 安装程序：$0"
  ExecWait '"$0" /VERYSILENT /NORESTART /NOCANCEL /SP- /CLOSEAPPLICATIONS /RESTARTAPPLICATIONS' $1
  !insertmacro AppendGitInstallLog "Git for Windows 安装程序退出码：$1"

  ${If} $1 != 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "Git for Windows 安装程序返回错误码 $1。日志文件：$GitInstallLogPath$\r$\n你可以稍后在应用的「Windows 环境检测」里重新安装 Git Bash。"
    Return
  ${EndIf}

  Call DetectGitBash
  ${If} $GitBashPath != ""
    DetailPrint "$ShellEnvironmentName 已就绪：$GitBashPath"
  ${Else}
    MessageBox MB_OK|MB_ICONINFORMATION "Git for Windows 安装已完成。若应用仍提示缺少 Git Bash，请重启 Windows 后在应用内重新检测。"
  ${EndIf}
FunctionEnd

!macro customInstall
  ${IfNot} ${Silent}
    Call InitGitInstallLog
    Call DetectGitBash
    ${If} $GitBashPath != ""
      DetailPrint "已检测到 $ShellEnvironmentName：$GitBashPath"
    ${Else}
      MessageBox MB_YESNO|MB_ICONQUESTION "Windows 上未检测到 Git Bash 或 WSL。万店引力运行 Agent 需要 Git Bash 或 WSL。是否现在安装 Git for Windows（包含 Git Bash）？" IDNO done
      Call InstallGitForWindows
    ${EndIf}
  ${EndIf}

  done:
!macroend

!endif # BUILD_UNINSTALLER
