/**
 * LoginView - 应用登录页
 *
 * 使用 mock 接口登录，账号 admin / foodism123。
 */

import * as React from 'react'
import { ArrowRight, Loader2, LockKeyhole, UserRound } from 'lucide-react'
import { useSetAtom } from 'jotai'
import { toast } from 'sonner'
import { authSessionAtom } from '@/atoms/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import foodismLogo from '@/assets/models/foodism.png'

export function LoginView(): React.ReactElement {
  const setAuthSession = useSetAtom(authSessionAtom)
  const [username, setUsername] = React.useState('admin')
  const [password, setPassword] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = React.useState(false)

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    setError(null)
    setIsSubmitting(true)

    try {
      const session = await window.electronAPI.login({ username, password })
      setAuthSession(session)
      toast.success('登录成功')
    } catch (loginError) {
      const message = loginError instanceof Error ? loginError.message : '登录失败'
      setError(message)
    } finally {
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
          </section>

          <section className="flex min-h-[560px] items-center bg-dialog p-6 sm:p-10">
            <form onSubmit={handleSubmit} className="mx-auto flex w-full max-w-sm flex-col gap-7">
              <div>
                <div className="mb-5 inline-flex h-10 w-10 items-center justify-center rounded-[8px] bg-[#16a34a] text-white shadow-md md:hidden">
                  <LockKeyhole size={20} />
                </div>
                <h2 className="text-2xl font-semibold tracking-normal">登录万店引力</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  使用分配的账号继续进入桌面端。
                </p>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="login-username">账号</Label>
                  <div className="relative">
                    <UserRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="login-username"
                      value={username}
                      onChange={(event) => setUsername(event.target.value)}
                      autoComplete="username"
                      className="h-11 pl-9"
                      disabled={isSubmitting}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="login-password">密码</Label>
                  <div className="relative">
                    <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="login-password"
                      type="password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      autoComplete="current-password"
                      className="h-11 pl-9"
                      disabled={isSubmitting}
                      autoFocus
                    />
                  </div>
                </div>

                {error && (
                  <div className="rounded-[8px] bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {error}
                  </div>
                )}
              </div>

              <Button
                type="submit"
                size="lg"
                className="h-11 w-full bg-[#16a34a] text-white shadow-[0_10px_24px_rgba(22,163,74,0.22)] hover:bg-[#15803d]"
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="animate-spin" />
                    正在登录
                  </>
                ) : (
                  <>
                    登录
                    <ArrowRight />
                  </>
                )}
              </Button>
            </form>
          </section>
        </div>
      </div>
    </div>
  )
}
