/**
 * LoginView - 应用登录页
 */

import * as React from 'react'
import { CheckCircle2, Loader2, LockKeyhole, QrCode, RefreshCw, ScanLine, ShieldCheck } from 'lucide-react'
import { useSetAtom } from 'jotai'
import { toast } from 'sonner'
import { authSessionAtom } from '@/atoms/auth'
import { Button } from '@/components/ui/button'
import foodismLogo from '@/assets/models/foodism.png'

export function LoginView(): React.ReactElement {
  const setAuthSession = useSetAtom(authSessionAtom)
  const [error, setError] = React.useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [authorizeUrl, setAuthorizeUrl] = React.useState<string | null>(null)

  React.useEffect(() => {
    const cleanupCompleted = window.electronAPI.onAuthSsoCompleted?.((session) => {
      setAuthSession(session)
      setIsSubmitting(false)
      setAuthorizeUrl(null)
      setError(null)
      toast.success('登录成功')
    })
    const cleanupError = window.electronAPI.onAuthSsoError?.((message) => {
      setIsSubmitting(false)
      setAuthorizeUrl(null)
      setError(message)
    })

    return () => {
      cleanupCompleted?.()
      cleanupError?.()
    }
  }, [setAuthSession])

  const handleSsoLogin = async (): Promise<void> => {
    setError(null)
    setIsSubmitting(true)

    try {
      const result = await window.electronAPI.startSsoLogin()
      setAuthorizeUrl(result.authorizeUrl)
    } catch (loginError) {
      const message = loginError instanceof Error ? loginError.message : '登录失败'
      setError(message)
      setIsSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen w-screen overflow-hidden bg-[radial-gradient(circle_at_20%_18%,rgba(22,163,74,0.16),transparent_28%),radial-gradient(circle_at_82%_12%,rgba(5,150,105,0.12),transparent_24%),linear-gradient(135deg,hsl(var(--background)),hsl(var(--muted)))] text-foreground">
      <div className="relative flex min-h-screen items-center justify-center px-6 py-10">
        <div className="absolute inset-x-0 top-0 h-10 titlebar-drag-region" />
        <div className="grid w-full max-w-5xl grid-cols-1 overflow-hidden rounded-[8px] bg-card/82 shadow-xl ring-1 ring-border/50 backdrop-blur-xl md:grid-cols-[1.05fr_0.95fr]">
          <section className="relative hidden min-h-[560px] flex-col justify-between overflow-hidden bg-[#03140f] p-10 text-white md:flex">
            <div className="absolute inset-0 bg-[linear-gradient(150deg,rgba(255,255,255,0.12),transparent_38%),radial-gradient(circle_at_72%_28%,rgba(34,197,94,0.42),transparent_32%),radial-gradient(circle_at_18%_82%,rgba(16,185,129,0.3),transparent_30%)]" />
            <div className="absolute inset-0 opacity-[0.18] [background-image:linear-gradient(rgba(187,247,208,0.24)_1px,transparent_1px),linear-gradient(90deg,rgba(187,247,208,0.24)_1px,transparent_1px)] [background-size:44px_44px]" />
            <div className="relative">
              <div className="mb-8 inline-flex h-14 w-14 items-center justify-center rounded-[12px] bg-white shadow-lg">
                <img src={foodismLogo} alt="万店引力" className="h-10 w-10 object-contain" draggable={false} />
              </div>
              <h1 className="max-w-sm text-4xl font-semibold leading-tight tracking-normal">万店引力工作台</h1>
              <p className="mt-4 max-w-sm text-sm leading-6 text-white/68">
                登录后进入本地优先的 AI Agent 工作流，配置、会话与工作区继续保存在你的设备上。
              </p>
            </div>
            <div className="relative grid gap-3 text-sm text-white/78">
              <div className="flex items-center gap-3">
                <CheckCircle2 size={17} className="text-emerald-200" />
                <span>企业身份验证后自动回到桌面端</span>
              </div>
              <div className="flex items-center gap-3">
                <CheckCircle2 size={17} className="text-emerald-200" />
                <span>本地配置与会话仍保存在当前设备</span>
              </div>
            </div>
          </section>

          <section className="flex min-h-[560px] items-center bg-dialog p-6 sm:p-10">
            <div className="mx-auto flex w-full max-w-sm flex-col gap-7">
              <div>
                <div className="mb-5 inline-flex h-10 w-10 items-center justify-center rounded-[8px] bg-[#16a34a] text-white shadow-md md:hidden">
                  <LockKeyhole size={20} />
                </div>
                <h2 className="text-2xl font-semibold tracking-normal">登录万店引力</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  使用钉钉完成企业身份验证，授权成功后会自动进入工作台。
                </p>
              </div>

              <div className="space-y-4">
                <div className="rounded-[8px] bg-muted/55 p-4">
                  <div className="grid gap-3">
                    <LoginStep index={1} icon={<ScanLine size={17} />} title="打开授权窗口" description="点击下方按钮，在新窗口中打开 Gravity SSO。" />
                    <LoginStep index={2} icon={<QrCode size={17} />} title="钉钉扫码确认" description="使用钉钉扫码，并在手机上确认身份。" />
                    <LoginStep index={3} icon={<ShieldCheck size={17} />} title="自动进入工作台" description="验证成功后窗口会关闭，桌面端会自动登录。" />
                  </div>
                </div>

                {error && (
                  <div className="rounded-[8px] bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {error}
                  </div>
                )}

                {authorizeUrl && isSubmitting && (
                  <div className="rounded-[8px] bg-[#16a34a]/10 p-4 text-sm text-[#166534]">
                    <div className="flex items-center gap-2 font-medium">
                      <Loader2 size={16} className="animate-spin" />
                      正在等待钉钉确认
                    </div>
                    <p className="mt-2 text-xs leading-5 text-[#166534]/78">
                      授权窗口已打开。如果窗口被遮挡，可以重新唤起；不想继续时直接关闭授权窗口即可。
                    </p>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="mt-3 h-8 px-2 text-[#15803d] hover:bg-[#16a34a]/12 hover:text-[#166534]"
                      onClick={handleSsoLogin}
                    >
                      <RefreshCw size={14} />
                      重新打开授权窗口
                    </Button>
                  </div>
                )}
              </div>

              <Button
                type="button"
                size="lg"
                className="h-11 w-full bg-[#16a34a] text-white shadow-[0_10px_24px_rgba(22,163,74,0.22)] hover:bg-[#15803d]"
                onClick={handleSsoLogin}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="animate-spin" />
                    等待钉钉确认
                  </>
                ) : (
                  <>
                    打开钉钉 SSO
                    <ScanLine />
                  </>
                )}
              </Button>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

interface LoginStepProps {
  index: number
  icon: React.ReactNode
  title: string
  description: string
}

function LoginStep({ index, icon, title, description }: LoginStepProps): React.ReactElement {
  return (
    <div className="flex gap-3">
      <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-[#16a34a]/10 text-[#15803d]">
        {icon}
        <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-dialog px-1 text-[10px] font-semibold leading-none text-muted-foreground ring-1 ring-border">
          {index}
        </span>
      </div>
      <div>
        <div className="text-sm font-medium text-foreground">{title}</div>
        <div className="mt-0.5 text-xs leading-5 text-muted-foreground">{description}</div>
      </div>
    </div>
  )
}
