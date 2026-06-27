'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useAuthStore } from '@/stores/auth-store'

const PUBLIC_PATHS = ['/']

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const { isAuthenticated } = useAuthStore()
  const [hydrated, setHydrated] = useState(false)

  // Wait for Zustand persist to hydrate from localStorage
  useEffect(() => {
    const unsub = useAuthStore.persist.onFinishHydration(() => {
      setHydrated(true)
    })
    // If already hydrated (e.g. fast load)
    if (useAuthStore.persist.hasHydrated()) {
      setHydrated(true)
    }
    return () => unsub()
  }, [])

  useEffect(() => {
    if (!hydrated) return

    const isPublic = PUBLIC_PATHS.includes(pathname)

    if (!isAuthenticated && !isPublic) {
      router.replace('/')
    }

    if (isAuthenticated && isPublic) {
      router.replace('/dashboard')
    }
  }, [isAuthenticated, pathname, router, hydrated])

  // While hydrating, show nothing to avoid flicker
  if (!hydrated) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    )
  }

  const isPublic = PUBLIC_PATHS.includes(pathname)
  if (!isAuthenticated && !isPublic) {
    return null
  }

  return <>{children}</>
}
