/**
 * API Service
 * Handles all HTTP requests to the backend
 */

const API_BASE = '/api';

export interface PlanSummary {
  id: string;
  filename: string;
  domain: string;
  url: string;
  confidence: number;
  createdAt: string;
  hasTrackingData: boolean;
}

export interface PlanDetail extends PlanSummary {
  content: string;
  jsonPlan: any;
  trackingData: any;
}

export interface ResultSummary {
  id: string;
  filename: string;
  planId: string;
  status: string;
  itemsExtracted: number;
  pagesProcessed: number;
  duration: number;
  timestamp: string;
}

export interface ResultDetail extends ResultSummary {
  runId: string;
  startTime: string;
  endTime: string;
  extractedData: any[];
  metrics: {
    duration: number;
    itemsExtracted: number;
    pagesProcessed: number;
    errorsEncountered: number;
    accuracyScore: number;
  };
  errors: string[];
}

export interface TaskState {
  id: string;
  type: 'generate' | 'execute';
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: number;
  logs: string[];
  input: {
    url?: string;
    contentUrls?: string[];
    planId?: string;
    options?: any;
  };
  output?: {
    planId?: string;
    planFile?: string;
    resultFile?: string;
    itemsExtracted?: number;
    pagesProcessed?: number;
  };
  error?: string;
  startedAt: string;
  completedAt?: string;
}

export interface GenerateTaskInput {
  url: string;
  contentUrls?: string[];
  options?: {
    useLocalModel?: boolean;
    priority?: 'cost' | 'speed' | 'accuracy' | 'balanced';
    confidenceThreshold?: number;
    maxTokens?: number;
    maxCost?: number;
    isPaginated?: boolean;
    paginationUrl?: string;
    saveLlmTracking?: boolean;
    detailedReport?: boolean;
  };
}

export interface ExecuteTaskInput {
  planId: string;
  options?: {
    maxPages?: number;
    maxItems?: number;
    maxItemsPerPage?: number;
    timeout?: number;
    testMode?: boolean;
    retryFailedItems?: boolean;
    validateResults?: boolean;
  };
}

async function fetchJSON<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${url}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
}

// Plans API
export const plansApi = {
  list: () => fetchJSON<PlanSummary[]>('/plans'),
  get: (id: string) => fetchJSON<PlanDetail>(`/plans/${encodeURIComponent(id)}`),
  getRaw: async (id: string): Promise<string> => {
    const response = await fetch(`${API_BASE}/plans/${encodeURIComponent(id)}/raw`);
    if (!response.ok) throw new Error('Failed to fetch plan');
    return response.text();
  },
};

// Results API
export const resultsApi = {
  list: () => fetchJSON<ResultSummary[]>('/results'),
  get: (id: string) => fetchJSON<ResultDetail>(`/results/${encodeURIComponent(id)}`),
  getByPlan: (planId: string) => fetchJSON<ResultDetail[]>(`/results/by-plan/${encodeURIComponent(planId)}`),
};

// Tasks API
export const tasksApi = {
  list: () => fetchJSON<TaskState[]>('/tasks'),
  get: (id: string) => fetchJSON<TaskState>(`/tasks/${encodeURIComponent(id)}`),
  generate: (input: GenerateTaskInput) =>
    fetchJSON<TaskState>('/tasks/generate', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  execute: (input: ExecuteTaskInput) =>
    fetchJSON<TaskState>('/tasks/execute', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  cancel: (id: string) =>
    fetchJSON<{ message: string }>(`/tasks/${encodeURIComponent(id)}/cancel`, {
      method: 'POST',
    }),
  delete: (id: string) =>
    fetchJSON<{ message: string }>(`/tasks/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
};

// Health API
export const healthApi = {
  check: () => fetchJSON<{ status: string; timestamp: string }>('/health'),
};
