!include LogicLib.nsh
!include x64.nsh

!ifndef BUILD_UNINSTALLER

!define GIT_FOR_WINDOWS_VERSION "2.54.0"
!define GIT_FOR_WINDOWS_EXE "Git-2.54.0-64-bit.exe"
!define GIT_FOR_WINDOWS_URL "https://npmmirror.com/mirrors/git-for-windows/v2.54.0.windows.1/Git-2.54.0-64-bit.exe"

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
  !insertmacro AppendGitInstallLog "日志路径：$GitInstallLogPath"
  !insertmacro AppendGitInstallLog "安装包版本：${GIT_FOR_WINDOWS_VERSION}"
  !insertmacro AppendGitInstallLog "安装包文件：${GIT_FOR_WINDOWS_EXE}"
  !insertmacro AppendGitInstallLog "临时目录：$TEMP"
  !insertmacro AppendGitInstallLog "下载源：${GIT_FOR_WINDOWS_URL}"
FunctionEnd

!macro CheckGitBashPath CANDIDATE_PATH
  !insertmacro AppendGitInstallLog "检查 Git Bash 路径：${CANDIDATE_PATH}"
  ${If} ${FileExists} "${CANDIDATE_PATH}"
    StrCpy $GitBashPath "${CANDIDATE_PATH}"
    StrCpy $ShellEnvironmentName "Git Bash"
    !insertmacro AppendGitInstallLog "检测到 Git Bash：${CANDIDATE_PATH}"
    Return
  ${Else}
    !insertmacro AppendGitInstallLog "Git Bash 路径不存在：${CANDIDATE_PATH}"
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
  ${If} $0 == ""
    !insertmacro AppendGitInstallLog "HKLM GitForWindows InstallPath：未设置"
  ${Else}
    !insertmacro AppendGitInstallLog "HKLM GitForWindows InstallPath：$0"
    ${If} ${FileExists} "$0\bin\bash.exe"
      StrCpy $GitBashPath "$0\bin\bash.exe"
      StrCpy $ShellEnvironmentName "Git Bash"
      !insertmacro AppendGitInstallLog "检测到 Git Bash：$GitBashPath"
      Return
    ${Else}
      !insertmacro AppendGitInstallLog "HKLM InstallPath 下未找到 bin\bash.exe"
    ${EndIf}
  ${EndIf}

  ReadRegStr $0 HKCU "SOFTWARE\GitForWindows" "InstallPath"
  ${If} $0 == ""
    !insertmacro AppendGitInstallLog "HKCU GitForWindows InstallPath：未设置"
  ${Else}
    !insertmacro AppendGitInstallLog "HKCU GitForWindows InstallPath：$0"
    ${If} ${FileExists} "$0\bin\bash.exe"
      StrCpy $GitBashPath "$0\bin\bash.exe"
      StrCpy $ShellEnvironmentName "Git Bash"
      !insertmacro AppendGitInstallLog "检测到 Git Bash：$GitBashPath"
      Return
    ${Else}
      !insertmacro AppendGitInstallLog "HKCU InstallPath 下未找到 bin\bash.exe"
    ${EndIf}
  ${EndIf}

  nsExec::ExecToStack 'powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$$cmd = Get-Command bash.exe -ErrorAction SilentlyContinue; if ($$cmd -and $$cmd.Source -match ''\\Git\\'') { Write-Output $$cmd.Source; exit 0 }; exit 1"'
  Pop $1
  Pop $0
  !insertmacro AppendGitInstallLog "PATH 检测退出码：$1"
  !insertmacro AppendGitInstallLog "PATH 检测输出：$0"
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
  !insertmacro AppendGitInstallLog "WSL 检测退出码：$1"
  !insertmacro AppendGitInstallLog "WSL 检测输出：$0"
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
  Delete "$0"
  !insertmacro AppendGitInstallLog "开始下载 Git for Windows：${GIT_FOR_WINDOWS_URL}"
  !insertmacro AppendGitInstallLog "下载目标：$0"
  nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$$log = ''$GitInstallLogPath''; $$url = ''${GIT_FOR_WINDOWS_URL}''; $$out = ''$0''; function Write-InstallLog { param([string]$$message) Add-Content -LiteralPath $$log -Encoding UTF8 -Value $$message }; try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Write-InstallLog (''PowerShell 版本：'' + $$PSVersionTable.PSVersion.ToString()); Write-InstallLog (''操作系统：'' + [Environment]::OSVersion.VersionString); Write-InstallLog (''64 位系统：'' + [Environment]::Is64BitOperatingSystem); Write-InstallLog (''下载目标：'' + $$out); $$proxy = [System.Net.WebRequest]::DefaultWebProxy; if ($$proxy) { $$proxyUri = $$proxy.GetProxy([Uri]$$url); Write-InstallLog (''代理解析：'' + $$proxyUri.AbsoluteUri) } else { Write-InstallLog ''代理解析：未检测到'' }; $$response = Invoke-WebRequest -Uri $$url -OutFile $$out -UseBasicParsing -ErrorAction Stop; if ($$response.StatusCode) { Write-InstallLog (''HTTP 状态码：'' + $$response.StatusCode) }; if (Test-Path -LiteralPath $$out) { $$file = Get-Item -LiteralPath $$out; Write-InstallLog (''下载文件大小：'' + $$file.Length + '' bytes'') }; Write-InstallLog ''主下载源下载成功''; exit 0 } catch { Write-InstallLog (''异常类型：'' + $$_.Exception.GetType().FullName); Write-InstallLog (''异常消息：'' + $$_.Exception.Message); if ($$_.Exception.Response) { Write-InstallLog (''HTTP 响应：'' + [int]$$_.Exception.Response.StatusCode + '' '' + $$_.Exception.Response.StatusDescription) }; Write-InstallLog ''主下载源下载失败''; exit 1 }"'
  Pop $1
  !insertmacro AppendGitInstallLog "主下载源退出码：$1"

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
