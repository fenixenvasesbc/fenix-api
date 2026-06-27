'use client'

import { FormEvent, useMemo, useState } from 'react'
import { FileSearch, Loader2, Printer, Upload } from 'lucide-react'
import { clichesApi } from '@/lib/api-client'
import type { ClicheCategory, ProductionPlanEntry, ProductionPlanResponse } from '@/types/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

const CATEGORY_LABELS: Record<ClicheCategory, string> = {
  ENVIO: 'Envio',
  COMBO: 'Combo',
  HAMBURGUESA: 'Hamburguesa',
  PIZZA: 'Pizza',
  LONCHEADO: 'Loncheado',
  SOBRES: 'Sobres',
  BOLSAS: 'Bolsas',
  VASOS: 'Vasos',
  TARTAS: 'Tartas',
}

type ProductionGroup = {
  machineNumber: number | null
  machineLabel: string
  days: Array<{
    date: string
    dayOfWeek: string
    entries: ProductionPlanEntry[]
  }>
}

function groupEntries(entries: ProductionPlanEntry[]): ProductionGroup[] {
  const machines = new Map<
    string,
    ProductionGroup & { dayMap: Map<string, ProductionGroup['days'][number]> }
  >()

  for (const entry of entries) {
    let machine = machines.get(entry.machineLabel)
    if (!machine) {
      machine = {
        machineNumber: entry.machineNumber,
        machineLabel: entry.machineLabel,
        days: [],
        dayMap: new Map(),
      }
      machines.set(entry.machineLabel, machine)
    }

    let day = machine.dayMap.get(entry.date)
    if (!day) {
      day = {
        date: entry.date,
        dayOfWeek: entry.dayOfWeek,
        entries: [],
      }
      machine.dayMap.set(entry.date, day)
      machine.days.push(day)
    }
    day.entries.push(entry)
  }

  return [...machines.values()].map(({ dayMap: _dayMap, ...group }) => group)
}

function machineName(group: ProductionGroup) {
  return group.machineNumber === null ? 'Sin máquina' : `Máquina ${group.machineNumber}`
}

function dayName(dayOfWeek: string, date: string) {
  const displayDay = dayOfWeek.charAt(0).toUpperCase() + dayOfWeek.slice(1)
  const displayDate = new Intl.DateTimeFormat('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`))
  return `${displayDay} ${displayDate}`
}

export function ClicheProductionImport() {
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [result, setResult] = useState<ProductionPlanResponse | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const groups = useMemo(() => groupEntries(result?.entries ?? []), [result])

  async function processPdf(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!file) {
      setError('Selecciona un archivo PDF')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('El archivo supera el límite de 10 MB')
      return
    }

    setIsLoading(true)
    setError(null)
    try {
      setResult(await clichesApi.importProductionPlan(file))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo procesar el PDF')
    } finally {
      setIsLoading(false)
    }
  }

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen)
    if (!nextOpen) setError(null)
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <FileSearch className="h-4 w-4" />
        Localizar desde PDF
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-h-[92vh] overflow-hidden sm:max-w-[min(1100px,calc(100vw-2rem))]">
          <DialogHeader className="print:hidden">
            <DialogTitle>Localizar cliches del plan</DialogTitle>
            <DialogDescription>
              Cruce de clientes del PDF con las ubicaciones registradas.
            </DialogDescription>
          </DialogHeader>

          {!result ? (
            <form onSubmit={processPdf} className="grid gap-4 print:hidden">
              <div className="grid gap-2">
                <Label htmlFor="production-pdf">Plan de fabricación</Label>
                <Input
                  id="production-pdf"
                  type="file"
                  accept=".pdf,application/pdf"
                  onChange={(event) => {
                    setFile(event.target.files?.[0] ?? null)
                    setError(null)
                  }}
                  required
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={isLoading || !file}>
                  {isLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4" />
                  )}
                  Procesar PDF
                </Button>
              </DialogFooter>
            </form>
          ) : (
            <>
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <div className="mb-3 flex flex-col gap-2 print:hidden sm:flex-row sm:justify-between">
                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span>{result.summary.totalEntries} clientes</span>
                    <span>{result.summary.matchedEntries} encontrados</span>
                    <span>{result.summary.unmatchedEntries} sin ubicación</span>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setResult(null)
                        setFile(null)
                      }}
                    >
                      Otro PDF
                    </Button>
                    <Button size="sm" onClick={() => window.print()}>
                      <Printer className="h-4 w-4" />
                      Imprimir
                    </Button>
                  </div>
                </div>

                <div className="overflow-y-auto rounded-md border border-border print:overflow-visible print:border-0">
                  <div
                    id="cliche-production-report"
                    className="bg-background p-4 text-foreground print:p-0"
                  >
                    <div className="mb-5 border-b border-border pb-3">
                      <h1 className="text-lg font-bold">Localización de cliches</h1>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {result.document.fileName} · {result.document.pageCount} páginas
                      </p>
                    </div>

                    <div className="space-y-7">
                      {groups.map((group) => (
                        <section key={group.machineLabel} className="print-group">
                          <h2 className="border-b-2 border-foreground pb-1 text-base font-bold">
                            {machineName(group)}
                          </h2>
                          <div className="space-y-5 pt-3">
                            {group.days.map((day) => (
                              <div key={day.date} className="print-day">
                                <h3 className="mb-2 text-sm font-semibold">
                                  {dayName(day.dayOfWeek, day.date)}
                                </h3>
                                <div className="overflow-x-auto print:overflow-visible">
                                  <table className="w-full min-w-[620px] border-collapse text-left text-sm print:min-w-0">
                                    <thead>
                                      <tr className="border-y border-border bg-muted/50">
                                        <th className="w-[42%] px-3 py-2 font-semibold">Cliente</th>
                                        <th className="px-3 py-2 font-semibold">
                                          Categoría, Año, Letra
                                        </th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {day.entries.map((entry) => (
                                        <tr
                                          key={`${entry.date}-${entry.clientName}`}
                                          className="border-b border-border align-top"
                                        >
                                          <td className="px-3 py-2 font-medium">
                                            {entry.clientName}
                                          </td>
                                          <td className="px-3 py-2">
                                            {entry.matches.length ? (
                                              <div className="space-y-1">
                                                {entry.matches.map((match) => (
                                                  <div key={match.id}>
                                                    {CATEGORY_LABELS[match.category]}, {match.year},{' '}
                                                    {match.letter}
                                                  </div>
                                                ))}
                                              </div>
                                            ) : (
                                              <span className="font-medium text-destructive">
                                                No encontrado
                                              </span>
                                            )}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            ))}
                          </div>
                        </section>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
              {error && <p className="text-sm text-destructive print:hidden">{error}</p>}
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
