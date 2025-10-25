/**
 * Services module exports
 */

export { LLMPlannerService } from "./llm-planner.service";
export type {
    SiteAnalysis,
    ConfidenceFactors
} from "./llm-planner.service";

export { ContentPatternAnalyzer } from "./content-pattern-analyzer.service";

export { SiteAnalysisService } from "./site-analysis.service";
export type {
    SiteAnalysisResult,
    DetectedPattern,
    PaginationInfo,
    ContentArea,
    CMSArchetype
} from "./site-analysis.service";

export { PlaywrightExecutor } from "./playwright-executor.service";
export type {
    PlaywrightExecutorConfig,
    ScrapingResult,
    ExecutionMetadata,
    TestResult,
    ValidationResult as PlaywrightValidationResult
} from "./playwright-executor.service";

export { DataValidatorService } from "./data-validator.service";
export type {
    ValidationResult,
    ValidationError,
    ValidationWarning,
    DataQualityMetrics
} from "./data-validator.service";

export { MCPOrchestratorService } from "./mcp-orchestrator.service";
export type { MCPOrchestrator } from "./mcp-orchestrator.service";

export { LegalComplianceService } from "./legal-compliance.service";

export { CentralizedLLMService, getCentralizedLLMService, resetCentralizedLLMService } from "./centralized-llm.service";
export type {
    LLMConfig,
    LLMRequest,
    LLMResponse
} from "./centralized-llm.service";

export { SandboxExecutorService } from "./sandbox-executor.service";
export type {
    SandboxConfig,
    SandboxTestResult,
    DOMHighlight,
    Screenshot,
    SandboxPerformanceMetrics,
    ResourceUsage,
    ValidationReport,
    ValidationIssue
} from "./sandbox-executor.service";

export type {
    ContentPattern,
    ContentPatternAnalysis,
    ContentMatch,
    ListContainer,
    DOMStructure,
    ContentPage,
    ContentVariation,
    PlanApproval,
    PlanLifecycleStatus,
    ExecutionRequest,
    QueueMessage,
    WorkflowState,
    WorkflowStep,
    MCPOrchestratorConfig,
    ExecutionOptions
} from "../interfaces/core";
