/**
 * Core interfaces for the AI Scraper Service
 * Based on requirements 1.2, 1.3, and 2.1
 */

export interface ExtractedItem {
  title: string;
  place?: string;
  description: string;
  address?: string;
  email?: string;
  phone?: string;
  website?: string;
  price?: number;
  discountPrice?: number;
  longitude?: number;
  latitude?: number;
  startDate?: string; // ISO 8601
  endDate?: string; // ISO 8601
  dates: string[]; // ISO 8601 array
  createdAt?: string; // ISO 8601
  zipcode?: number;
  images: string[]; // absolute URLs
  language: 'de' | 'en';
}

export interface RetryPolicy {
  maxAttempts: number;
  backoffStrategy: 'exponential' | 'linear' | 'fixed';
  baseDelayMs: number;
  maxDelayMs: number;
  retryableErrors: string[];
}

export interface PlanMetadata {
  domain: string;
  siteType: 'municipal' | 'news' | 'government';
  language: string;
  createdBy: 'ai' | 'human';
  lastSuccessfulRun?: Date;
  successRate: number;
  avgAccuracy: number;
  robotsTxtCompliant: boolean;
  gdprCompliant: boolean;
  cookieConsentStrategy?: 'accept-all' | 'reject-all' | 'minimal' | 'none-detected'; // NEW
  cookieConsentRequired?: boolean; // NEW
  cookieConsentLibrary?: string; // NEW: e.g., 'Cookiebot', 'OneTrust'
  cookieConsentSaveButton?: string; // NEW: CSS selector for cookie save/accept button
  cookieConsent?: { // NEW: Comprehensive cookie consent metadata
    detected: boolean;
    strategy: string;
    library: string;
    selectors: Record<string, string>;
    acceptButtonSelector?: string;
    rejectButtonSelector?: string;
    settingsButtonSelector?: string;
    bannerSelector?: string;
    modalSelector?: string;
    handledSuccessfully: boolean;
  };
  aiResponse?: {  // NEW: Store AI output for debugging
    model: string;
    prompt: string;
    response: string;
    tokensUsed: number;
    timestamp: Date;
  };
}

export interface ScrapingPlan {
  planId: string;
  version: number;
  entryUrls: string[];
  listSelector: string;
  paginationSelector?: string;
  detailSelectors: Record<string, string>;
  richContentFields?: string[]; // NEW: Fields that should extract HTML content (innerHTML) instead of text
  excludeSelectors?: string[];
  rateLimitMs: number;
  retryPolicy: RetryPolicy;
  confidenceScore: number;
  metadata: PlanMetadata;
  // NEW: Pagination information
  paginationInfo?: {
    pattern: string;
    links: string[];
    totalPages?: number;
    isPaginated: boolean;
  };
}

export interface ExecutionMetrics {
  duration: number;
  itemsExtracted: number;
  pagesProcessed: number;
  errorsEncountered: number;
  accuracyScore: number;
  tokensUsed?: number;
}

export interface ExecutionResult {
  runId: string;
  planId: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  startTime: Date;
  endTime?: Date;
  extractedData: ExtractedItem[];
  metrics: ExecutionMetrics;
  errors: Error[];
}

export interface PlanOptions {
  useLocalModel?: boolean;
  maxTokens?: number;
  confidenceThreshold?: number;
  priority?: 'cost' | 'speed' | 'accuracy' | 'balanced';
  maxCost?: number;
  retryAttempt?: number;
  planId?: string;
  cookieConsentData?: CookieConsentMetadata;
  // NEW: Pagination support
  paginationUrl?: string;
  isPaginated?: boolean;
}

export interface CookieConsentMetadata {
  detected: boolean;
  strategy?: 'accept-all' | 'reject-all' | 'minimal' | 'none-detected';
  library?: string;
  buttonSelectors?: {
    accept?: string;
    reject?: string;
    save?: string;
    close?: string;
  };
  handledAt?: Date;
}

export interface TestExecutionResult {
  success: boolean;
  extractedSamples: ExtractedItem[];
  errors: string[];
  confidence: number;
}

export interface PlanGenerationResult {
  planId: string;
  plan: ScrapingPlan;
  confidence: number;
  humanReadableDoc: string;
  testResults: TestExecutionResult;
  siblingDiscovery?: {
    originalUrls: string[];
    discoveredLinks: string[];
    discoveryResults: any[];
    totalEnhancedUrls: number;
  };
}

// Content Pattern Analysis Interfaces (Requirements 8.1, 8.2, 8.3, 8.4, 8.5)

export interface ContentPattern {
  title: string;
  description: string;
  metadata: Record<string, any>;
  domStructure: DOMStructure;
  contentSignature: string; // Unique identifier for this content type
}

export interface DOMStructure {
  tagName: string;
  className?: string;
  id?: string;
  attributes: Record<string, string>;
  textContent?: string;
  children: DOMStructure[];
  depth: number;
  path: string; // CSS selector path
}

export interface ContentMatch {
  similarity: number; // 0-1 score of how similar this element is to content examples
  domPath: string; // CSS selector path to the matching element
  extractedData: Record<string, any>; // Data extracted from this element
  containerElement: string; // Parent container holding this content
  confidence: number;
}

export interface ListContainer {
  selector: string; // CSS selector for the container holding list items
  itemCount: number; // Number of similar items found in this container
  confidence: number; // 0-1 confidence that this is the correct list container
  sampleItems: string[]; // Sample selectors for items in this container
  excludeSelectors: string[]; // Selectors to exclude (nav, header, footer)
}

export interface ContentPatternAnalysis {
  contentSelectors: string[];
  excludeSelectors: string[];
  commonContentContainer: string;
  contentVariations: ContentVariation[];
  confidence: number;
  listContainers: ListContainer[];
  patterns: ContentPattern[];
}

export interface ContentVariation {
  pageType: string;
  selectors: Record<string, string>;
  examples: string[];
}

export interface ContentPage {
  url: string;
  html: string;
  domStructure: DOMStructure;
  extractedContent: Record<string, any>;
}

// MCP Orchestrator Interfaces (Requirements 1.1, 2.1, 2.4, 4.1, 6.1, 8.1)

export interface PlanApproval {
  approved: boolean;
  reviewerId: string;
  comments?: string;
  modifications?: Partial<ScrapingPlan>;
  timestamp: Date;
}

export interface PlanLifecycleStatus {
  planId: string;
  status: 'draft' | 'pending_review' | 'approved' | 'rejected' | 'deprecated' | 'executing' | 'failed';
  currentVersion: number;
  createdAt: Date;
  updatedAt: Date;
  lastExecutionId?: string;
  approvals: PlanApproval[];
  executionHistory: string[];
}

export interface ExecutionRequest {
  planId: string;
  runId: string;
  priority: 'low' | 'normal' | 'high';
  scheduledAt?: Date;
  options?: ExecutionOptions;
}

export interface ExecutionOptions {
  maxPages?: number; // Default: 2 for testing
  timeout?: number;
  retryFailedItems?: boolean;
  validateResults?: boolean;
  maxItems?: number;
  testMode?: boolean;
  maxItemsPerPage?: number; // Default: 2 for testing
}

export interface QueueMessage {
  id: string;
  type: 'plan_generation' | 'plan_execution' | 'plan_validation' | 'plan_retraining';
  payload: any;
  priority: number;
  createdAt: Date;
  attempts: number;
  maxAttempts: number;
  nextRetryAt?: Date;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
}

export interface WorkflowState {
  workflowId: string;
  type: 'plan_lifecycle' | 'execution_workflow';
  currentStep: string;
  steps: WorkflowStep[];
  context: Record<string, any>;
  status: 'running' | 'completed' | 'failed' | 'paused';
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

export interface WorkflowStep {
  stepId: string;
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
  result?: any;
}

export interface MCPOrchestratorConfig {
  redis: {
    host: string;
    port: number;
    password?: string;
    db: number;
  };
  queues: {
    planGeneration: string;
    planExecution: string;
    planValidation: string;
  };
  workers: {
    maxConcurrentExecutions: number;
    executionTimeout: number;
    retryAttempts: number;
  };
  monitoring: {
    metricsInterval: number;
    healthCheckInterval: number;
  };
}

// Legal Compliance Interfaces (Requirements 3.1, 3.2, 3.3, 3.4)

export interface RobotsTxtRule {
  userAgent: string;
  disallowedPaths: string[];
  allowedPaths: string[];
  crawlDelay?: number;
  sitemapUrls: string[];
}

export interface RobotsTxtCache {
  domain: string;
  robotsTxt: string;
  rules: RobotsTxtRule[];
  lastFetched: Date;
  expiresAt: Date;
  isValid: boolean;
  fetchError?: string;
}

export interface LegalMetadata {
  domain: string;
  sourceType: 'municipal' | 'news' | 'government' | 'commercial';
  jurisdiction: string; // e.g., 'DE', 'EU', 'US'
  robotsTxtCompliant: boolean;
  gdprCompliant: boolean;
  dataProcessingBasis: 'legitimate_interest' | 'public_task' | 'consent';
  retentionPeriod: number; // days
  anonymizationApplied: boolean;
  collectedAt: Date;
  lastUpdated: Date;
}

export interface GDPRAnonymizationConfig {
  anonymizeEmails: boolean;
  anonymizePhones: boolean;
  anonymizeAddresses: boolean;
  anonymizeNames: boolean;
  hashSalt: string;
  preserveFormat: boolean;
}

export interface DataDeletionRequest {
  requestId: string;
  domain?: string;
  email?: string;
  phoneNumber?: string;
  dateRange?: {
    start: Date;
    end: Date;
  };
  requestedAt: Date;
  processedAt?: Date;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  deletedRecords: number;
  errors?: string[];
}

export interface ComplianceCheckResult {
  domain: string;
  robotsTxtCompliant: boolean;
  robotsTxtUrl?: string;
  robotsTxtRules?: RobotsTxtRule[];
  gdprApplicable: boolean;
  recommendedActions: string[];
  warnings: string[];
  lastChecked: Date;
}
