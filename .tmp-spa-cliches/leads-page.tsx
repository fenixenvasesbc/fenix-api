'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2, Search, Tags } from 'lucide-react'
import { accountsApi, leadsApi } from '@/lib/api-client'
import { useAuthStore } from '@/stores/auth-store'
import type { Account, Lead, LeadLabel } from '@/types/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

const PAGE_SIZE = 50

const LABEL_OPTIONS: Array<{ value: LeadLabel; label: string }> = [
  { value: 'PRODUCCION', label: 'Produccion' },
  { value: 'BOCETO_EN_PROCESO', label: 'Boceto en proceso' },
  { value: 'PENDIENTE_DE_PAGO', label: 'Pendiente de pago' },
  { value: 'MUESTRAS', label: 'Muestras' },
  { value: 'REPETICIONES', label: 'Repeticiones' },
  { value: 'BOCETOS_ATRASADOS', label: 'Bocetos atrasados' },
]

function formatDate(value: string | null) {
  if (!value) return null

  return new Intl.DateTimeFormat('es-ES', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value))
}

export default function LeadsPage() {
  const { user } = useAuthStore()
  const isAdmin = user?.role?.toUpperCase() === 'ADMIN'
  const [accounts, setAccounts] = useState<Account[]>([])
  const [selectedAccountId, setSelectedAccountId] = useState('')
  const [label, setLabel] = useState<LeadLabel | 'ALL'>('ALL')
  const [labelChangedOrder, setLabelChangedOrder] = useState<'asc' | 'desc'>('desc')
  const [search, setSearch] = useState('')
  const [leads, setLeads] = useState<Lead[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [nextBefore, setNextBefore] = useState<string | null>(null)
  const [savingLeadIds, setSavingLeadIds] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)

  const selectedAccount = useMemo(
    () => accounts.find((account) => account.id === selectedAccountId),
    [accounts, selectedAccountId]
  )

  useEffect(() => {
    if (!isAdmin) return

    accountsApi
      .getAll()
      .then((data) => {
        setAccounts(data)
        setSelectedAccountId((current) => current || data[0]?.id || '')
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'No se pudieron cargar las cuentas')
      })
  }, [isAdmin])

  useEffect(() => {
    if (isAdmin && !selectedAccountId) {
      setIsLoading(false)
      return
    }

    const timeout = window.setTimeout(() => {
      setIsLoading(true)
      setError(null)

      leadsApi
        .list({
          accountId: isAdmin ? selectedAccountId : undefined,
          label: label === 'ALL' ? '' : label,
          search: search.trim(),
          limit: PAGE_SIZE,
          labelChangedOrder: label === 'ALL' ? undefined : labelChangedOrder,
        })
        .then((response) => {
          setLeads(response.data)
          setHasMore(response.pageInfo.hasMore)
          setNextBefore(response.pageInfo.nextBefore)
        })
        .catch((err) => {
          setError(err instanceof Error ? err.message : 'No se pudieron cargar los leads')
        })
        .finally(() => setIsLoading(false))
    }, 250)

    return () => window.clearTimeout(timeout)
  }, [isAdmin, selectedAccountId, label, labelChangedOrder, search])

  async function loadMore() {
    if (!nextBefore || isLoadingMore) return

    setIsLoadingMore(true)
    setError(null)

    try {
      const response = await leadsApi.list({
        accountId: isAdmin ? selectedAccountId : undefined,
        label: label === 'ALL' ? '' : label,
        search: search.trim(),
        limit: PAGE_SIZE,
        before: nextBefore,
        labelChangedOrder: label === 'ALL' ? undefined : labelChangedOrder,
      })

      setLeads((current) => {
        const existingIds = new Set(current.map((lead) => lead.id))
        return [...current, ...response.data.filter((lead) => !existingIds.has(lead.id))]
      })
      setHasMore(response.pageInfo.hasMore)
      setNextBefore(response.pageInfo.nextBefore)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar mas leads')
    } finally {
      setIsLoadingMore(false)
    }
  }

  async function changeLeadLabel(leadId: string, nextLabel: LeadLabel) {
    const previousLead = leads.find((lead) => lead.id === leadId)
    if (!previousLead || previousLead.currentLabel === nextLabel) return

    setError(null)
    setSavingLeadIds((current) => new Set(current).add(leadId))
    setLeads((current) =>
      current.map((lead) =>
        lead.id === leadId ? { ...lead, currentLabel: nextLabel } : lead
      )
    )

    try {
      const response = await leadsApi.setLabel({
        leadId,
        accountId: isAdmin ? selectedAccountId : undefined,
        label: nextLabel,
      })

      setLeads((current) => {
        if (label !== 'ALL' && label !== nextLabel) {
          return current.filter((lead) => lead.id !== leadId)
        }

        return current.map((lead) => (lead.id === leadId ? response.lead : lead))
      })
    } catch (err) {
      setLeads((current) =>
        current.map((lead) => (lead.id === leadId ? previousLead : lead))
      )
      setError(err instanceof Error ? err.message : 'No se pudo actualizar el label')
    } finally {
      setSavingLeadIds((current) => {
        const next = new Set(current)
        next.delete(leadId)
        return next
      })
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Leads</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Seguimiento comercial por cuenta, estado y proxima repeticion
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          {isAdmin && (
            <Select value={selectedAccountId} onValueChange={setSelectedAccountId}>
              <SelectTrigger className="w-full sm:w-64">
                <SelectValue placeholder="Selecciona cuenta" />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((account) => (
                  <SelectItem key={account.id} value={account.id}>
                    {account.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Select value={label} onValueChange={(value) => setLabel(value as LeadLabel | 'ALL')}>
            <SelectTrigger className="w-full sm:w-56">
              <SelectValue placeholder="Filtrar por label" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Todos los estados</SelectItem>
              {LABEL_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {label !== 'ALL' && (
            <Select
              value={labelChangedOrder}
              onValueChange={(value) => setLabelChangedOrder(value as 'asc' | 'desc')}
            >
              <SelectTrigger className="w-full sm:w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="desc">Mas recientes primero</SelectItem>
                <SelectItem value="asc">Mas antiguos primero</SelectItem>
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por nombre, telefono o email"
            className="pl-9"
          />
        </div>
        <p className="text-sm text-muted-foreground">
          {selectedAccount ? `${selectedAccount.name} · ` : ''}
          {leads.length} cargados
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <Table className="min-w-[760px]">
          <TableHeader>
            <TableRow>
              <TableHead>Lead</TableHead>
              <TableHead>Telefono</TableHead>
              <TableHead>Label</TableHead>
              <TableHead>Proxima repeticion</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={4} className="h-24 text-center text-sm text-muted-foreground">
                  Cargando leads...
                </TableCell>
              </TableRow>
            ) : leads.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="h-24 text-center">
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <Tags className="h-5 w-5" />
                    <span className="text-sm">No hay leads con estos filtros</span>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              leads.map((lead) => (
                <TableRow key={lead.id}>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium text-foreground">
                        {lead.name || lead.whatsappUsername || 'Sin nombre'}
                      </span>
                      {lead.email && (
                        <span className="text-xs text-muted-foreground">{lead.email}</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-sm">{lead.phoneE164}</TableCell>
                  <TableCell className="w-56">
                    <Select
                      value={lead.currentLabel ?? undefined}
                      onValueChange={(value) => changeLeadLabel(lead.id, value as LeadLabel)}
                      disabled={savingLeadIds.has(lead.id)}
                    >
                      <SelectTrigger
                        size="sm"
                        className="w-52 max-w-[calc(100vw-3rem)] bg-background"
                        aria-label={`Cambiar label de ${lead.name || lead.phoneE164}`}
                      >
                        <SelectValue placeholder="Sin label" />
                        {savingLeadIds.has(lead.id) && (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        )}
                      </SelectTrigger>
                      <SelectContent>
                        {LABEL_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    {lead.nextRepetitionReminderAt ? (
                      <div className="flex flex-col">
                        <span className="text-sm font-medium">
                          {formatDate(lead.nextRepetitionReminderAt)}
                        </span>
                        {lead.repetitionReminderDays && (
                          <span className="text-xs text-muted-foreground">
                            cada {lead.repetitionReminderDays} dias
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-sm text-muted-foreground">Sin programar</span>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        <Button variant="outline" onClick={() => setSearch('')} disabled={!search}>
          Limpiar busqueda
        </Button>
        {hasMore && (
          <Button onClick={loadMore} disabled={isLoadingMore}>
            {isLoadingMore ? 'Cargando...' : 'Cargar mas'}
          </Button>
        )}
      </div>
    </div>
  )
}
