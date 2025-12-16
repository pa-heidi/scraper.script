/**
 * Shared types for the Express API server
 */

export interface TaskState {
  id: string;
  type: 'generate' | 'execute';
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: number;
  logs: string[];
  input: TaskInput;
  output?: TaskOutput;
  error?: string;
  startedAt: string;
  completedAt?: string;
}

export interface TaskInput {
  url?: string;
  contentUrls?: string[];
  planId?: string;
  options?: {
    // Generate options
    useLocalModel?: boolean;
    priority?: 'cost' | 'speed' | 'accuracy' | 'balanced';
    confidenceThreshold?: number;
    maxTokens?: number;
    maxCost?: number;
    isPaginated?: boolean;
    paginationUrl?: string;
    saveLlmTracking?: boolean;
    detailedReport?: boolean;
    // Execute options
    maxPages?: number;
    maxItems?: number;
    maxItemsPerPage?: number;
    timeout?: number;
    testMode?: boolean;
    retryFailedItems?: boolean;
    validateResults?: boolean;
  };
}

export interface TaskOutput {
  planId?: string;
  planFile?: string;
  resultFile?: string;
  itemsExtracted?: number;
  pagesProcessed?: number;
}

export interface PlanSummary {
  id: string;
  filename: string;
  domain: string;
  url: string;
  confidence: number;
  createdAt: string;
  hasTrackingData: boolean;
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

export interface SSEMessage {
  type: 'status' | 'progress' | 'log' | 'complete' | 'error';
  data: any;
  timestamp: string;
}
