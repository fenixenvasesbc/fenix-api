'use client'

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Layers3,
  Loader2,
  Pencil,
  Plus,
  Search,
  Trash2,
} from 'lucide-react'
import { clichesApi } from '@/lib/api-client'
import type { Cliche, ClicheCategory, ClichePayload } from '@/types/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ClicheProductionImport } from '@/components/cliche-production-import'
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

const PAGE_SIZE = 25
const DEFAULT_CATEGORIES: ClicheCategory[] = [
  'ENVIO',
  'COMBO',
  'HAMBURGUESA',
  'PIZZA',
  'LONCHEADO',
  'SOBRES',
  'BOLSAS',
  'VASOS',
  'TARTAS',
]

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

type ClicheForm = {
  name: string
  category: ClicheCategory
  letter: string
  year: string
}

function emptyForm(categories: ClicheCategory[]): ClicheForm {
  return {
    name: '',
    category: categories[0] ?? 'ENVIO',
    letter: '',
    year: String(new Date().getFullYear()),
  }
}

function formFromCliche(cliche: Cliche): ClicheForm {
  return {
    name: cliche.name,
    category: cliche.category,
    letter: cliche.letter,
    year: String(cliche.year),
  }
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('es-ES', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value))
}

export default function ClichesPage() {
  const [cliches, setCliches] = useState<Cliche[]>([])
  const [categories, setCategories] = useState<ClicheCategory[]>(DEFAULT_CATEGORIES)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<ClicheCategory | 'ALL'>('ALL')
  const [year, setYear] = useState('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Cliche | null>(null)
  const [form, setForm] = useState<ClicheForm>(() => emptyForm(DEFAULT_CATEGORIES))
  const [formError, setFormError] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Cliche | null>(null)

  const selectedYear = useMemo(() => {
    if (!year.trim()) return undefined
    const parsed = Number(year)
    return Number.isInteger(parsed) && parsed >= 1900 && parsed <= 9999 ? parsed : undefined
  }, [year])

  const loadCliches = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const response = await clichesApi.list({
        page,
        limit: PAGE_SIZE,
        search: search.trim(),
        category: category === 'ALL' ? '' : category,
        year: selectedYear,
      })
      setCliches(response.items)
      setTotal(response.pagination.total)
      setTotalPages(response.pagination.totalPages)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar los cliches')
    } finally {
      setIsLoading(false)
    }
  }, [category, page, search, selectedYear])

  useEffect(() => {
    clichesApi
      .categories()
      .then((values) => {
        setCategories([...new Set([...DEFAULT_CATEGORIES, ...values])])
      })
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    const timeout = window.setTimeout(loadCliches, 250)
    return () => window.clearTimeout(timeout)
  }, [loadCliches])

  function openCreate() {
    setEditing(null)
    setForm(emptyForm(categories))
    setFormError(null)
    setDialogOpen(true)
  }

  function openEdit(cliche: Cliche) {
    setEditing(cliche)
    setForm(formFromCliche(cliche))
    setFormError(null)
    setDialogOpen(true)
  }

  function buildPayload(): ClichePayload | null {
    const parsedYear = Number(form.year)
    const normalizedLetter = form.letter.trim().toUpperCase()

    if (!form.name.trim()) {
      setFormError('El nombre es obligatorio')
      return null
    }
    if (!/^[A-Z]+[0-9]+$/.test(normalizedLetter)) {
      setFormError('La letra debe tener un formato como D1 o F3')
      return null
    }
    if (!Number.isInteger(parsedYear) || parsedYear < 1900 || parsedYear > 9999) {
      setFormError('Introduce un año válido')
      return null
    }

    return {
      name: form.name.trim().toUpperCase(),
      category: form.category,
      letter: normalizedLetter,
      year: parsedYear,
    }
  }

  async function submitForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const payload = buildPayload()
    if (!payload) return

    setIsSaving(true)
    setFormError(null)
    setNotice(null)

    try {
      if (editing) {
        await clichesApi.update(editing.id, payload)
        setNotice('Cliche actualizado correctamente')
      } else {
        await clichesApi.create(payload)
        setNotice('Cliche creado correctamente')
      }
      setDialogOpen(false)
      if (page !== 1) setPage(1)
      else await loadCliches()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'No se pudo guardar el cliche')
    } finally {
      setIsSaving(false)
    }
  }

  async function removeCliche() {
    if (!pendingDelete) return

    setIsSaving(true)
    setError(null)
    setNotice(null)
    try {
      await clichesApi.remove(pendingDelete.id)
      setPendingDelete(null)
      setNotice('Cliche eliminado correctamente')
      if (cliches.length === 1 && page > 1) setPage((current) => current - 1)
      else await loadCliches()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo eliminar el cliche')
    } finally {
      setIsSaving(false)
    }
  }

  function resetFilters() {
    setSearch('')
    setCategory('ALL')
    setYear('')
    setPage(1)
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Cliches</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Inventario de planchas de fabricacion
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <ClicheProductionImport />
          <Button onClick={openCreate} className="w-full sm:w-auto">
            <Plus className="h-4 w-4" />
            Nuevo cliche
          </Button>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(240px,1fr)_220px_150px_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value)
              setPage(1)
            }}
            placeholder="Buscar por nombre o letra"
            className="pl-9"
          />
        </div>
        <Select
          value={category}
          onValueChange={(value) => {
            setCategory(value as ClicheCategory | 'ALL')
            setPage(1)
          }}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Categoria" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Todas las categorias</SelectItem>
            {categories.map((value) => (
              <SelectItem key={value} value={value}>
                {CATEGORY_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="number"
          min={1900}
          max={9999}
          value={year}
          onChange={(event) => {
            setYear(event.target.value)
            setPage(1)
          }}
          placeholder="Año"
        />
        <Button
          variant="outline"
          onClick={resetFilters}
          disabled={!search && category === 'ALL' && !year}
        >
          Limpiar
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-md border border-chart-4/30 bg-chart-4/10 px-4 py-3 text-sm text-foreground">
          {notice}
        </div>
      )}

      <div className="hidden overflow-hidden rounded-lg border border-border bg-card md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead>Categoria</TableHead>
              <TableHead>Letra</TableHead>
              <TableHead>Año</TableHead>
              <TableHead>Actualizado</TableHead>
              <TableHead className="w-24 text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="h-28 text-center">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin text-primary" />
                </TableCell>
              </TableRow>
            ) : cliches.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-28 text-center">
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <Layers3 className="h-5 w-5" />
                    <span className="text-sm">No hay cliches con estos filtros</span>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              cliches.map((cliche) => (
                <TableRow key={cliche.id}>
                  <TableCell className="font-medium">{cliche.name}</TableCell>
                  <TableCell>{CATEGORY_LABELS[cliche.category]}</TableCell>
                  <TableCell>
                    <span className="inline-flex min-w-10 justify-center rounded-md border border-border bg-muted px-2 py-1 font-mono text-sm font-semibold">
                      {cliche.letter}
                    </span>
                  </TableCell>
                  <TableCell>{cliche.year}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(cliche.updatedAt)}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Editar cliche"
                        onClick={() => openEdit(cliche)}
                      >
                        <Pencil className="h-4 w-4" />
                        <span className="sr-only">Editar cliche</span>
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Eliminar cliche"
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => setPendingDelete(cliche)}
                      >
                        <Trash2 className="h-4 w-4" />
                        <span className="sr-only">Eliminar cliche</span>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="grid gap-3 md:hidden">
        {isLoading ? (
          <div className="flex h-28 items-center justify-center rounded-lg border border-border bg-card">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        ) : cliches.length === 0 ? (
          <div className="flex h-28 flex-col items-center justify-center gap-2 rounded-lg border border-border bg-card text-muted-foreground">
            <Layers3 className="h-5 w-5" />
            <span className="text-sm">No hay cliches con estos filtros</span>
          </div>
        ) : (
          cliches.map((cliche) => (
            <article key={cliche.id} className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="break-words text-sm font-semibold text-foreground">
                    {cliche.name}
                  </h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {CATEGORY_LABELS[cliche.category]} - {cliche.year}
                  </p>
                </div>
                <span className="shrink-0 rounded-md border border-border bg-muted px-2 py-1 font-mono text-sm font-semibold">
                  {cliche.letter}
                </span>
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
                <span className="text-xs text-muted-foreground">
                  {formatDate(cliche.updatedAt)}
                </span>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Editar cliche"
                    onClick={() => openEdit(cliche)}
                  >
                    <Pencil className="h-4 w-4" />
                    <span className="sr-only">Editar cliche</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Eliminar cliche"
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => setPendingDelete(cliche)}
                  >
                    <Trash2 className="h-4 w-4" />
                    <span className="sr-only">Eliminar cliche</span>
                  </Button>
                </div>
              </div>
            </article>
          ))
        )}
      </div>

      <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          {total} {total === 1 ? 'cliche' : 'cliches'}
        </p>
        <div className="flex items-center justify-between gap-2 sm:justify-end">
          <Button
            variant="outline"
            size="icon"
            disabled={page <= 1 || isLoading}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            title="Pagina anterior"
          >
            <ChevronLeft className="h-4 w-4" />
            <span className="sr-only">Pagina anterior</span>
          </Button>
          <span className="min-w-28 text-center text-sm text-muted-foreground">
            Pagina {page} de {Math.max(totalPages, 1)}
          </span>
          <Button
            variant="outline"
            size="icon"
            disabled={page >= totalPages || isLoading}
            onClick={() => setPage((current) => current + 1)}
            title="Pagina siguiente"
          >
            <ChevronRight className="h-4 w-4" />
            <span className="sr-only">Pagina siguiente</span>
          </Button>
        </div>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar cliche' : 'Nuevo cliche'}</DialogTitle>
            <DialogDescription>
              {editing ? 'Actualiza los datos del registro.' : 'Registra un cliche de fabricacion.'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitForm} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="cliche-name">Nombre</Label>
              <Input
                id="cliche-name"
                value={form.name}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                maxLength={160}
                autoFocus
                required
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="cliche-category">Categoria</Label>
                <Select
                  value={form.category}
                  onValueChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      category: value as ClicheCategory,
                    }))
                  }
                >
                  <SelectTrigger id="cliche-category" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((value) => (
                      <SelectItem key={value} value={value}>
                        {CATEGORY_LABELS[value]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="cliche-letter">Letra</Label>
                <Input
                  id="cliche-letter"
                  value={form.letter}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      letter: event.target.value.toUpperCase(),
                    }))
                  }
                  placeholder="D1"
                  maxLength={20}
                  required
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="cliche-year">Año</Label>
              <Input
                id="cliche-year"
                type="number"
                min={1900}
                max={9999}
                value={form.year}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    year: event.target.value,
                  }))
                }
                required
              />
            </div>
            {formError && <p className="text-sm text-destructive">{formError}</p>}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
                disabled={isSaving}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={isSaving}>
                {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                {editing ? 'Guardar cambios' : 'Crear cliche'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar cliche</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminara {pendingDelete?.name}. Esta accion no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSaving}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault()
                void removeCliche()
              }}
              disabled={isSaving}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
