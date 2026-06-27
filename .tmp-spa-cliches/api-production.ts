// ==========================================
// Auth Types
// ==========================================

export interface LoginRequest {
  email: string
  password: string
}

export interface LoginResponse {
  accessToken: string
  refreshToken: string
  user: User
}

export interface LogoutRequest {
  refreshToken: string
}

export interface RefreshRequest {
  refreshToken: string
}

export interface RefreshResponse {
  accessToken: string
  refreshToken: string
}

// ==========================================
// User / Sales Types
// ==========================================

export interface User {
  id: string
  email: string
  role: 'admin' | 'sale' | 'sales' | 'factory' | 'ADMIN' | 'SALE' | 'SALES' | 'FACTORY'
  createdAt: string
  updatedAt: string
}

export interface CreateSaleRequest {
  email: string
  password: string
}

export interface CreateAdminRequest {
  email: string
  password: string
}

// ==========================================
// Account Types
// ==========================================

export interface CreateAccountRequest {
  name: string
  wabaId: string
  phoneE164: string
  assignToUserId: string
}

export interface Account {
  id: string
  name: string
  wabaId: string
  phoneE164: string
  userId: string
  createdAt: string
  updatedAt?: string
  user?: User | null
}

// ==========================================
// Manufacturing Cliches
// ==========================================

export type ClicheCategory =
  | 'ENVIO'
  | 'COMBO'
  | 'HAMBURGUESA'
  | 'PIZZA'
  | 'LONCHEADO'
  | 'SOBRES'
  | 'BOLSAS'
  | 'VASOS'
  | 'TARTAS'

export interface Cliche {
  id: string
  name: string
  category: ClicheCategory
  letter: string
  year: number
  createdAt: string
  updatedAt: string
}

export interface ClichePayload {
  name: string
  category: ClicheCategory
  letter: string
  year: number
}

export type UpdateClichePayload = Partial<ClichePayload>

export interface ClichesResponse {
  items: Cliche[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}

export interface ProductionPlanClicheMatch {
  id: string
  name: string
  category: ClicheCategory
  year: number
  letter: string
}

export interface ProductionPlanEntry {
  machineNumber: number | null
  machineLabel: string
  date: string
  dayOfWeek: string
  clientName: string
  matches: ProductionPlanClicheMatch[]
}

export interface ProductionPlanResponse {
  document: {
    fileName: string
    pageCount: number
  }
  summary: {
    totalEntries: number
    matchedEntries: number
    unmatchedEntries: number
  }
  entries: ProductionPlanEntry[]
}

export type LeadLabel =
  | 'PRODUCCION'
  | 'BOCETO_EN_PROCESO'
  | 'PENDIENTE_DE_PAGO'
  | 'MUESTRAS'
  | 'REPETICIONES'
  | 'BOCETOS_ATRASADOS'

export interface Lead {
  id: string
  accountId: string | null
  name: string | null
  phoneE164: string
  email: string | null
  status: string
  currentLabel: LeadLabel | null
  currentLabelChangedAt: string | null
  repetitionReminderDays: number | null
  nextRepetitionReminderAt: string | null
  preferredLanguage?: string | null
  whatsappUsername?: string | null
  lastInboundAt: string | null
  lastOutboundAt: string | null
  lastMessageAt: string | null
  createdAt: string
  updatedAt: string
}

export interface LeadsResponse {
  accountId: string
  data: Lead[]
  pageInfo: {
    hasMore: boolean
    nextBefore: string | null
  }
}

export interface SetLeadLabelResponse {
  lead: Lead
  labelHistoryId: string
  repetitionReminderId: string | null
  nextRepetitionReminderAt: string | null
  repetitionReminderDays: number | null
}

export type ConversationStatus = 'OPEN' | 'CLOSED'
export type MessageDirection = 'INBOUND' | 'OUTBOUND'
export type MessageType = 'TEXT' | 'IMAGE' | 'AUDIO' | 'VIDEO' | 'DOCUMENT' | 'TEMPLATE' | 'UNKNOWN'

export type MessageStatus = 'UNKNOWN' | 'ACCEPTED' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED'

export interface ChatMessage {
  id: string
  accountId: string
  leadId: string
  direction: MessageDirection
  type: MessageType
  status: MessageStatus
  textBody: string | null
  mediaUrl: string | null
  caption: string | null
  mimeType: string | null
  fileName: string | null
  templateName: string | null
  providerCreateTime: string | null
  providerSendTime: string | null
  deletedAt: string | null
  deletedByProviderEventId: string | null
  createdAt: string
  updatedAt: string
}

export interface Conversation {
  id: string
  accountId: string
  leadId: string
  channel: 'WHATSAPP'
  status: ConversationStatus
  lastMessageAt: string | null
  lastInboundAt: string | null
  lastOutboundAt: string | null
  customerWindowExpiresAt: string | null
  isCustomerWindowOpen: boolean
  requiresAttention: boolean
  unreadCount: number
  closedAt: string | null
  createdAt: string
  updatedAt: string
  lead: Lead
  lastMessage: ChatMessage | null
}

export interface ConversationsResponse {
  data: Conversation[]
  pageInfo: {
    hasMore: boolean
    nextBefore: string | null
  }
}

export interface ConversationState {
  id: string | null
  status: ConversationStatus
  customerWindowExpiresAt: string | null
  isCustomerWindowOpen: boolean
  canSendFreeform: boolean
  requiresAttention: boolean
  unreadCount: number
  closedAt: string | null
}

export interface MessageHistoryResponse {
  lead: Lead
  conversation: ConversationState
  messages: ChatMessage[]
  pageInfo: {
    hasMore: boolean
    nextBefore: string | null
  }
}

export interface SendMessageResponse {
  success: boolean
  messageId: string
  externalId: string | null
  status: MessageStatus
  type?: MessageType
  idempotentReplay: boolean
}

export interface ChatEvent {
  id: string
  type:
    | 'message.created'
    | 'message.deleted'
    | 'message.status.updated'
    | 'conversation.updated'
    | 'conversation.read'
    | 'conversation.closed'
    | 'conversation.reopened'
  accountId: string
  leadId: string | null
  conversationId: string | null
  messageId: string | null
  createdAt: string
  payload: Record<string, unknown>
}

// ==========================================
// Dashboard / Metrics Types
// ==========================================

export type MetricsScope = 'GLOBAL' | 'GLOBAL_BY_ACCOUNT' | 'ACCOUNT'
export type DateMode = 'INCLUSIVE'

// Query for global metrics
export interface MetricsGlobalQuery {
  from: string
  to: string
  groupByAccount?: boolean
}

// Query for account-specific metrics
export interface MetricsAccountQuery {
  accountId: string
  from: string
  to: string
}

// Template data point (flat structure for GLOBAL and ACCOUNT scope)
export interface TemplateMetric {
  templateName: string
  sentFirst: number
  responded: number
  notResponded: number
  responseRate: number
  // Only present in ACCOUNT scope
  accountId?: string
  accountName?: string
}

// Account data with nested templates (for GLOBAL_BY_ACCOUNT scope)
export interface AccountMetric {
  accountId: string
  accountName: string
  totals: {
    sentFirst: number
    responded: number
    notResponded: number
    responseRate: number
  }
  templates: TemplateMetric[]
}

// Base response fields
interface MetricsResponseBase {
  from: string
  to: string
  dateMode: DateMode
  scope: MetricsScope
  appliedAccountId: string | null
  groupedBy: string[]
}

// Response for GLOBAL scope (no groupByAccount)
export interface MetricsGlobalResponse extends MetricsResponseBase {
  scope: 'GLOBAL'
  data: TemplateMetric[]
}

// Response for GLOBAL_BY_ACCOUNT scope
export interface MetricsGlobalByAccountResponse extends MetricsResponseBase {
  scope: 'GLOBAL_BY_ACCOUNT'
  data: AccountMetric[]
}

// Response for ACCOUNT scope (specific account)
export interface MetricsAccountResponse extends MetricsResponseBase {
  scope: 'ACCOUNT'
  data: TemplateMetric[]
}

// Union type for all responses
export type MetricsResponse =
  | MetricsGlobalResponse
  | MetricsGlobalByAccountResponse
  | MetricsAccountResponse

// For display in UI - unified template view
export interface MetricByTemplate {
  templateName: string
  sentFirst: number
  responded: number
  notResponded: number
  responseRate: number
}

// For display in UI - account view
export interface MetricByAccount {
  accountId: string
  accountName: string
  sentFirst: number
  responded: number
  notResponded: number
  responseRate: number
  templates: MetricByTemplate[]
}

// ==========================================
// Socket Event Types
// ==========================================

export interface SocketMessage {
  id: string
  type: 'inbound' | 'outbound'
  from: string
  to: string
  content?: string
  mediaType?: string
  mediaUrl?: string
  timestamp: string
}

export interface SocketNotification {
  id: string
  type: string
  message: string
  timestamp: string
}

// ==========================================
// API Error
// ==========================================

export interface ApiError {
  statusCode: number
  message: string
  error?: string
}
