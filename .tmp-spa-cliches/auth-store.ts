import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { User } from '@/types/api'
import { authApi } from '@/lib/api-client'

// Helper to decode JWT and extract payload
function decodeJwtPayload(token: string): { sub?: string; role?: string } | null {
  try {
    const base64Url = token.split('.')[1]
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/')
    const payload = JSON.parse(atob(base64))
    return payload
  } catch {
    return null
  }
}

interface AuthState {
  user: User | null
  accessToken: string | null
  refreshToken: string | null
  isAuthenticated: boolean
  isLoading: boolean
  error: string | null

  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  clearError: () => void
  setLoading: (loading: boolean) => void
  setTokens: (accessToken: string, refreshToken: string) => void
  clearAuth: () => void
  refreshSession: () => Promise<boolean>
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,

      login: async (email: string, password: string) => {
        set({ isLoading: true, error: null })
        try {
          const response = await authApi.login({ email, password })
          // Store tokens also in localStorage for the API client
          localStorage.setItem('accessToken', response.accessToken)
          localStorage.setItem('refreshToken', response.refreshToken)
          
          // Build user object from response.user or from JWT payload
          const jwtPayload = decodeJwtPayload(response.accessToken)
          const userFromResponse = response.user
          
          const user: User = {
            id: userFromResponse?.id || jwtPayload?.sub || '',
            email: userFromResponse?.email || email,
            role: (userFromResponse?.role || jwtPayload?.role || 'sale') as User['role'],
            createdAt: userFromResponse?.createdAt || new Date().toISOString(),
            updatedAt: userFromResponse?.updatedAt || new Date().toISOString(),
          }
          
          set({
            user,
            accessToken: response.accessToken,
            refreshToken: response.refreshToken,
            isAuthenticated: true,
            isLoading: false,
            error: null,
          })
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Error al iniciar sesion'
          set({
            isLoading: false,
            error: message,
            isAuthenticated: false,
          })
          throw err
        }
      },

      logout: async () => {
        const { refreshToken } = get()
        try {
          if (refreshToken) {
            await authApi.logout({ refreshToken })
          }
        } catch {
          // Logout even on error
        } finally {
          localStorage.removeItem('accessToken')
          localStorage.removeItem('refreshToken')
          set({
            user: null,
            accessToken: null,
            refreshToken: null,
            isAuthenticated: false,
            error: null,
          })
        }
      },

      clearError: () => set({ error: null }),
      setLoading: (loading: boolean) => set({ isLoading: loading }),

      setTokens: (accessToken: string, refreshToken: string) => {
        localStorage.setItem('accessToken', accessToken)
        localStorage.setItem('refreshToken', refreshToken)
        set({ accessToken, refreshToken })
      },

      clearAuth: () => {
        localStorage.removeItem('accessToken')
        localStorage.removeItem('refreshToken')
        set({
          user: null,
          accessToken: null,
          refreshToken: null,
          isAuthenticated: false,
          error: null,
        })
      },

      refreshSession: async () => {
        const { refreshToken } = get()
        if (!refreshToken) {
          get().clearAuth()
          return false
        }

        try {
          const response = await authApi.refresh({ refreshToken })
          get().setTokens(response.accessToken, response.refreshToken)
          return true
        } catch {
          get().clearAuth()
          return false
        }
      },
    }),
    {
      name: 'fenix-auth',
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
)
