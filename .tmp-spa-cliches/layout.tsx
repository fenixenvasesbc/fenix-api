'use client'

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { AuthGuard } from '@/components/auth-guard'
import { DashboardSidebar } from '@/components/dashboard/sidebar'
import { useAuthStore } from '@/stores/auth-store'

const SALE_ALLOWED_PATHS = ['/dashboard/leads', '/dashboard/messages']
const FACTORY_ALLOWED_PATHS = ['/dashboard/cliches']

function DashboardAccess({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const user = useAuthStore((state) => state.user)
  const isAdmin = user?.role?.toUpperCase() === 'ADMIN'
  const isFactory = user?.role?.toUpperCase() === 'FACTORY'
  const allowedPaths = isFactory ? FACTORY_ALLOWED_PATHS : SALE_ALLOWED_PATHS
  const hasAccess =
    isAdmin || allowedPaths.some((path) => pathname === path || pathname.startsWith(`${path}/`))

  useEffect(() => {
    if (user && !hasAccess) {
      router.replace(isFactory ? '/dashboard/cliches' : '/dashboard/messages')
    }
  }, [hasAccess, isFactory, router, user])

  if (!user || !hasAccess) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    )
  }

  return <>{children}</>
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <DashboardAccess>
        <div className="flex h-screen overflow-hidden bg-background">
          <DashboardSidebar />
          <main className="flex-1 overflow-y-auto">
            <div className="p-6 lg:p-8">{children}</div>
          </main>
        </div>
      </DashboardAccess>
    </AuthGuard>
  )
}
