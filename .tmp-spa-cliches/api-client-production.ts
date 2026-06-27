import type {
  LoginRequest,
  LoginResponse,
  LogoutRequest,
  RefreshRequest,
  RefreshResponse,
  CreateSaleRequest,
  CreateAdminRequest,
  CreateAccountRequest,
  MetricsGlobalQuery,
  MetricsAccountQuery,
  MetricsGlobalResponse,
  MetricsGlobalByAccountResponse,
  MetricsAccountResponse,
  User,
  Account,
  LeadLabel,
  LeadsResponse,
  SetLeadLabelResponse,
  ChatEvent,
  Conversation,
  ConversationsResponse,
  MessageHistoryResponse,
  SendMessageResponse,
  Cliche,
  ClicheCategory,
  ClichePayload,
  ClichesResponse,
  UpdateClichePayload,
  ProductionPlanResponse,
} from '@/types/api'

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.fenixcrm.site'

// ==========================================
// Token Refresh State (Concurrency Protection)
// ==========================================

let isRefreshing = false
let refreshPromise: Promise<boolean> | null = null

async function refreshTokens(): Promise<boolean> {
  // If already refreshing, return the existing promise
  if (isRefreshing && refreshPromise) {
    return refreshPromise
  }

  isRefreshing = true
  refreshPromise = (async () => {
    try {
      const refreshToken = localStorage.getItem('refreshToken')
      if (!refreshToken) {
        return false
      }

      const response = await request<RefreshResponse>('/auth/refresh', {
        method: 'POST',
        body: { refreshToken },
      })

      // Update tokens in localStorage
      localStorage.setItem('accessToken', response.accessToken)
      localStorage.setItem('refreshToken', response.refreshToken)

      // Update Zustand store if available (dynamic import to avoid circular deps)
      try {
        const { useAuthStore } = await import('@/stores/auth-store')
        useAuthStore.getState().setTokens(response.accessToken, response.refreshToken)
      } catch {
        // Store not available, tokens are already in localStorage
      }

      return true
    } catch {
      // Clear auth on refresh failure
      localStorage.removeItem('accessToken')
      localStorage.removeItem('refreshToken')
      try {
        const { useAuthStore } = await import('@/stores/auth-store')
        useAuthStore.getState().clearAuth()
      } catch {
        // Store not available
      }
      return false
    } finally {
      isRefreshing = false
      refreshPromise = null
    }
  })()

  return refreshPromise
}

// ==========================================
// Core HTTP Client
// ==========================================

type RequestOptions = {
  method?: string
  body?: unknown
  headers?: Record<string, string>
  params?: Record<string, string>
}

async function request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, headers = {}, params } = options
  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData

  let url = `${BASE_URL}${endpoint}`

  if (params) {
    const searchParams = new URLSearchParams()
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        searchParams.append(key, value)
      }
    })
    const queryString = searchParams.toString()
    if (queryString) {
      url += `?${queryString}`
    }
  }

  const config: RequestInit = {
    method,
    headers: {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...headers,
    },
  }

  if (body !== undefined) {
    config.body = isFormData ? body : JSON.stringify(body)
  }

  const response = await fetch(url, config)

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    const error = new Error(errorData.message || `HTTP Error ${response.status}`) as Error & {
      statusCode: number
      data: unknown
    }
    error.statusCode = response.status
    error.data = errorData
    throw error
  }

  // Handle 204 or empty responses
  const text = await response.text()
  if (!text) return {} as T

  return JSON.parse(text) as T
}

async function authenticatedRequest<T>(
  endpoint: string,
  options: RequestOptions = {},
  isRetry = false
): Promise<T> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null

  try {
    return await request<T>(endpoint, {
      ...options,
      headers: {
        ...options.headers,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    })
  } catch (err) {
    const error = err as Error & { statusCode?: number }

    // If 401 and not already a retry, attempt token refresh
    if (error.statusCode === 401 && !isRetry) {
      const refreshed = await refreshTokens()

      if (refreshed) {
        // Retry the original request with new token
        return authenticatedRequest<T>(endpoint, options, true)
      }

      // Refresh failed - redirect to login
      if (typeof window !== 'undefined') {
        window.location.href = '/'
      }
    }

    throw err
  }
}

// ==========================================
// Auth API
// ==========================================

export const authApi = {
  login(data: LoginRequest): Promise<LoginResponse> {
    return request<LoginResponse>('/auth/login', {
      method: 'POST',
      body: data,
    })
  },

  logout(data: LogoutRequest): Promise<void> {
    return request<void>('/auth/logout', {
      method: 'POST',
      body: data,
    })
  },

  refresh(data: RefreshRequest): Promise<RefreshResponse> {
    return request<RefreshResponse>('/auth/refresh', {
      method: 'POST',
      body: data,
    })
  },

  createAdmin(data: CreateAdminRequest): Promise<User> {
    return authenticatedRequest<User>('/auth/admins', {
      method: 'POST',
      body: data,
    })
  },

  createSale(data: CreateSaleRequest): Promise<User> {
    return authenticatedRequest<User>('/auth/sales', {
      method: 'POST',
      body: data,
    })
  },
}

// ==========================================
// Users / Sales API
// ==========================================

export const usersApi = {
  getSales(): Promise<User[]> {
    return authenticatedRequest<User[]>('/users/sales')
  },
}

// ==========================================
// Accounts API
// ==========================================

export const accountsApi = {
  create(data: CreateAccountRequest): Promise<Account> {
    return authenticatedRequest<Account>('/accounts/create', {
      method: 'POST',
      body: data,
    })
  },

  getAll(): Promise<Account[]> {
    return authenticatedRequest<Account[]>('/accounts')
  },
}

export const leadsApi = {
  list(
    query: {
      accountId?: string
      label?: LeadLabel | ''
      search?: string
      limit?: number
      before?: string
      labelChangedOrder?: 'asc' | 'desc'
    } = {}
  ): Promise<LeadsResponse> {
    const params: Record<string, string> = {}

    if (query.accountId) params.accountId = query.accountId
    if (query.label) params.label = query.label
    if (query.search) params.search = query.search
    if (query.limit) params.limit = String(query.limit)
    if (query.before) params.before = query.before
    if (query.labelChangedOrder) params.labelChangedOrder = query.labelChangedOrder

    return authenticatedRequest<LeadsResponse>('/leads', { params })
  },

  setLabel(input: {
    leadId: string
    accountId?: string
    label: LeadLabel
    reminderDays?: number
  }): Promise<SetLeadLabelResponse> {
    const params: Record<string, string> = {}
    if (input.accountId) params.accountId = input.accountId

    return authenticatedRequest<SetLeadLabelResponse>(`/leads/${input.leadId}/label`, {
      method: 'PATCH',
      params,
      body: {
        label: input.label,
        ...(input.reminderDays ? { reminderDays: input.reminderDays } : {}),
      },
    })
  },
}

export const clichesApi = {
  list(
    query: {
      page?: number
      limit?: number
      search?: string
      category?: ClicheCategory | ''
      year?: number
    } = {}
  ): Promise<ClichesResponse> {
    const params: Record<string, string> = {}
    if (query.page) params.page = String(query.page)
    if (query.limit) params.limit = String(query.limit)
    if (query.search) params.search = query.search
    if (query.category) params.category = query.category
    if (query.year) params.year = String(query.year)

    return authenticatedRequest<ClichesResponse>('/cliches', { params })
  },

  categories(): Promise<ClicheCategory[]> {
    return authenticatedRequest<ClicheCategory[]>('/cliches/categories')
  },

  create(data: ClichePayload): Promise<Cliche> {
    return authenticatedRequest<Cliche>('/cliches', {
      method: 'POST',
      body: data,
    })
  },

  update(id: string, data: UpdateClichePayload): Promise<Cliche> {
    return authenticatedRequest<Cliche>(`/cliches/${id}`, {
      method: 'PATCH',
      body: data,
    })
  },

  remove(id: string): Promise<{ id: string; deleted: true }> {
    return authenticatedRequest<{ id: string; deleted: true }>(`/cliches/${id}`, {
      method: 'DELETE',
    })
  },

  importProductionPlan(file: File): Promise<ProductionPlanResponse> {
    const body = new FormData()
    body.append('file', file)
    return authenticatedRequest<ProductionPlanResponse>('/cliches/production-plan', {
      method: 'POST',
      body,
    })
  },
}

export const conversationsApi = {
  list(
    query: {
      accountId?: string
      limit?: number
      before?: string
      search?: string
      onlyOpen?: boolean
      onlyPending?: boolean
      label?: LeadLabel | ''
    } = {}
  ): Promise<ConversationsResponse> {
    const params: Record<string, string> = {}
    if (query.accountId) params.accountId = query.accountId
    if (query.limit) params.limit = String(query.limit)
    if (query.before) params.before = query.before
    if (query.search) params.search = query.search
    if (query.onlyOpen !== undefined) params.onlyOpen = String(query.onlyOpen)
    if (query.onlyPending !== undefined) params.onlyPending = String(query.onlyPending)
    if (query.label) params.label = query.label

    return authenticatedRequest<ConversationsResponse>('/conversations', {
      params,
    })
  },

  get(leadId: string, accountId?: string): Promise<{ data: Conversation }> {
    return authenticatedRequest<{ data: Conversation }>(`/conversations/${leadId}`, {
      params: accountId ? { accountId } : undefined,
    })
  },

  markAsRead(leadId: string, accountId?: string) {
    return authenticatedRequest<{ data: unknown }>(`/conversations/${leadId}/read`, {
      method: 'POST',
      params: accountId ? { accountId } : undefined,
    })
  },
}

export const messagesApi = {
  history(query: {
    leadId: string
    accountId?: string
    limit?: number
    before?: string
  }): Promise<MessageHistoryResponse> {
    const params: Record<string, string> = {}
    if (query.accountId) params.accountId = query.accountId
    if (query.limit) params.limit = String(query.limit)
    if (query.before) params.before = query.before

    return authenticatedRequest<MessageHistoryResponse>(`/message/lead/${query.leadId}`, {
      params,
    })
  },

  sendText(input: {
    accountId?: string
    leadId: string
    clientRequestId: string
    text: string
  }): Promise<SendMessageResponse> {
    return authenticatedRequest<SendMessageResponse>('/outbound/text', {
      method: 'POST',
      body: input,
    })
  },
}

function parseSseFrame(frame: string): { event: string; data: unknown } | null {
  let event = 'message'
  const dataLines: string[] = []

  for (const line of frame.split(/\r?\n/)) {
    if (line.startsWith('event:')) event = line.slice(6).trim()
    if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
  }

  if (dataLines.length === 0) return null

  const rawData = dataLines.join('\n')
  try {
    return { event, data: JSON.parse(rawData) }
  } catch {
    return { event, data: rawData }
  }
}

function findSseBoundary(buffer: string) {
  const match = /\r?\n\r?\n/.exec(buffer)
  if (!match || match.index === undefined) return null

  return {
    index: match.index,
    length: match[0].length,
  }
}

export const chatEventsApi = {
  async subscribe(input: {
    accountId?: string
    signal: AbortSignal
    onEvent: (event: ChatEvent) => void
    onConnected?: () => void
  }): Promise<void> {
    const params = new URLSearchParams()
    if (input.accountId) params.set('accountId', input.accountId)
    const query = params.toString()
    const endpoint = `${BASE_URL}/chat/events${query ? `?${query}` : ''}`

    let token = localStorage.getItem('accessToken')
    let response = await fetch(endpoint, {
      headers: {
        Accept: 'text/event-stream',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: input.signal,
    })

    if (response.status === 401 && (await refreshTokens())) {
      token = localStorage.getItem('accessToken')
      response = await fetch(endpoint, {
        headers: {
          Accept: 'text/event-stream',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        signal: input.signal,
      })
    }

    if (!response.ok || !response.body) {
      throw new Error(`No se pudo abrir el stream de chat (${response.status})`)
    }

    input.onConnected?.()
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (!input.signal.aborted) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      let boundary = findSseBoundary(buffer)

      while (boundary) {
        const frame = parseSseFrame(buffer.slice(0, boundary.index))
        buffer = buffer.slice(boundary.index + boundary.length)
        boundary = findSseBoundary(buffer)

        if (frame && frame.event !== 'heartbeat') {
          input.onEvent(frame.data as ChatEvent)
        }
      }
    }
  },
}

// ==========================================
// Dashboard API
// ==========================================

export const dashboardApi = {
  // Global metrics (all accounts aggregated by template)
  getGlobalMetrics(query: MetricsGlobalQuery): Promise<MetricsGlobalResponse> {
    const params: Record<string, string> = {
      from: query.from,
      to: query.to,
    }
    return authenticatedRequest<MetricsGlobalResponse>(
      '/dashboard/metrics/first-message-responses',
      { params }
    )
  },

  // Global metrics grouped by account
  getGlobalMetricsByAccount(query: MetricsGlobalQuery): Promise<MetricsGlobalByAccountResponse> {
    const params: Record<string, string> = {
      from: query.from,
      to: query.to,
      groupByAccount: 'true',
    }
    return authenticatedRequest<MetricsGlobalByAccountResponse>(
      '/dashboard/metrics/first-message-responses',
      { params }
    )
  },

  // Metrics for a specific account
  getAccountMetrics(query: MetricsAccountQuery): Promise<MetricsAccountResponse> {
    return authenticatedRequest<MetricsAccountResponse>(
      '/dashboard/metrics/account/first-message-responses',
      {
        method: 'POST',
        body: query,
      }
    )
  },
}

// ==========================================
// Ping
// ==========================================

export const pingApi = {
  check(): Promise<unknown> {
    return request<unknown>('/')
  },
}
