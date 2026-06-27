'use client'

import { usePathname, useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'
import { useSocketStore } from '@/stores/socket-store'
import {
  Flame,
  LayoutDashboard,
  Users,
  MessageSquare,
  Settings,
  LogOut,
  Bell,
  Wifi,
  WifiOff,
  Receipt,
  Tags,
  Layers3,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/dashboard/sales', label: 'Vendedores', icon: Users },
  { href: '/dashboard/leads', label: 'Leads', icon: Tags },
  { href: '/dashboard/messages', label: 'Mensajes', icon: MessageSquare },
  { href: '/dashboard/cliches', label: 'Cliches', icon: Layers3 },
  { href: '/dashboard/settings', label: 'Configuracion', icon: Settings },
]

const ADMIN_NAV_ITEMS = [{ href: '/facturacion', label: 'Facturacion', icon: Receipt }]

const SALE_NAV_PATHS = new Set(['/dashboard/leads', '/dashboard/messages'])
const FACTORY_NAV_PATHS = new Set(['/dashboard/cliches'])

export function DashboardSidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const { user, logout } = useAuthStore()
  const { status: socketStatus, unreadCount } = useSocketStore()
  const isAdmin = user?.role?.toUpperCase() === 'ADMIN'
  const isFactory = user?.role?.toUpperCase() === 'FACTORY'
  const visibleNavItems = isAdmin
    ? NAV_ITEMS
    : NAV_ITEMS.filter((item) => (isFactory ? FACTORY_NAV_PATHS : SALE_NAV_PATHS).has(item.href))

  async function handleLogout() {
    await logout()
    router.push('/')
  }

  return (
    <TooltipProvider delayDuration={0}>
      <aside className="flex h-screen w-16 flex-col items-center border-r border-sidebar-border bg-sidebar py-4 lg:w-56 lg:items-stretch lg:px-3">
        {/* Logo */}
        <div className="flex items-center justify-center gap-2 pb-6 lg:justify-start lg:px-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
            <Flame className="h-5 w-5 text-primary" />
          </div>
          <span className="hidden text-sm font-bold tracking-tight text-sidebar-foreground lg:block">
            Fenix CRM
          </span>
        </div>

        {/* Navigation */}
        <nav className="flex flex-1 flex-col items-center gap-1 lg:items-stretch">
          {visibleNavItems.map((item) => {
            const isActive =
              item.href === '/dashboard' ? pathname === item.href : pathname.startsWith(item.href)
            return (
              <Tooltip key={item.href}>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => router.push(item.href)}
                    className={cn(
                      'flex h-10 w-10 items-center justify-center rounded-lg transition-colors lg:w-full lg:justify-start lg:gap-3 lg:px-3',
                      isActive
                        ? 'bg-sidebar-accent text-sidebar-primary'
                        : 'text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground'
                    )}
                  >
                    <item.icon className="h-5 w-5 shrink-0" />
                    <span className="hidden text-sm font-medium lg:block">{item.label}</span>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" className="lg:hidden">
                  {item.label}
                </TooltipContent>
              </Tooltip>
            )
          })}

          {/* Admin-only items */}
          {isAdmin && (
            <>
              <div className="my-2 h-px w-8 bg-sidebar-border lg:w-full" />
              {ADMIN_NAV_ITEMS.map((item) => {
                const isActive = pathname.startsWith(item.href)
                return (
                  <Tooltip key={item.href}>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => router.push(item.href)}
                        className={cn(
                          'flex h-10 w-10 items-center justify-center rounded-lg transition-colors lg:w-full lg:justify-start lg:gap-3 lg:px-3',
                          isActive
                            ? 'bg-sidebar-accent text-sidebar-primary'
                            : 'text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground'
                        )}
                      >
                        <item.icon className="h-5 w-5 shrink-0" />
                        <span className="hidden text-sm font-medium lg:block">{item.label}</span>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="right" className="lg:hidden">
                      {item.label}
                    </TooltipContent>
                  </Tooltip>
                )
              })}
            </>
          )}
        </nav>

        {/* Bottom section */}
        <div className="flex flex-col items-center gap-2 pt-4 border-t border-sidebar-border lg:items-stretch">
          {/* Socket status */}
          <div className="flex items-center justify-center lg:justify-start lg:px-2 lg:gap-2">
            {socketStatus === 'connected' ? (
              <Wifi className="h-4 w-4 text-chart-4" />
            ) : (
              <WifiOff className="h-4 w-4 text-muted-foreground" />
            )}
            <span className="hidden text-xs text-muted-foreground lg:block">
              {socketStatus === 'connected' ? 'Conectado' : 'Desconectado'}
            </span>
          </div>

          {/* Notifications */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button className="relative flex h-10 w-10 items-center justify-center rounded-lg text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors lg:w-full lg:justify-start lg:gap-3 lg:px-3">
                <Bell className="h-5 w-5 shrink-0" />
                {unreadCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground lg:relative lg:top-0 lg:right-0 lg:ml-auto">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
                <span className="hidden text-sm font-medium lg:block">Notificaciones</span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" className="lg:hidden">
              Notificaciones
            </TooltipContent>
          </Tooltip>

          {/* User + Logout */}
          <div className="flex flex-col items-center gap-2 lg:flex-row lg:items-center lg:gap-2 lg:px-2 lg:py-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/20 text-xs font-bold text-primary shrink-0">
              {user?.email?.charAt(0).toUpperCase() || 'U'}
            </div>
            <div className="hidden flex-1 overflow-hidden lg:block">
              <p className="truncate text-xs font-medium text-sidebar-foreground">
                {user?.email || 'Usuario'}
              </p>
              <p className="text-[10px] text-muted-foreground capitalize">
                {user?.role || 'admin'}
              </p>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleLogout}
                  className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                >
                  <LogOut className="h-4 w-4" />
                  <span className="sr-only">Cerrar sesion</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">Cerrar sesion</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </aside>
    </TooltipProvider>
  )
}
