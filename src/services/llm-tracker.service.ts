/**
 * LLM Request/Response Tracking System
 * Tracks all LLM interactions throughout the project for evaluation and debugging
 */

export interface LLMRequest {
  id: string;
  timestamp: Date;
  service: string; // e.g., 'cookie-consent', 'sibling-detection', 'pagination-detection', 'content-analysis'
  method: string; // e.g., 'detectCookieDialog', 'findSiblingLinks', 'analyzePagination'
  provider: 'openai' | 'ollama';
  model: string;
  prompt: string;
  systemMessage?: string;
  maxTokens?: number;
  temperature?: number;
  format?: 'json' | 'text';
}

export interface LLMResponse {
  id: string;
  requestId: string;
  timestamp: Date;
  content: string;
  tokensUsed?: number;
  finishReason?: string;
  confidence?: number;
  duration: number; // milliseconds
  success: boolean;
  error?: string;
}

export interface LLMInteraction {
  request: LLMRequest;
  response: LLMResponse;
  context?: {
    url?: string;
    domain?: string;
    step?: string;
    metadata?: Record<string, any>;
  };
}

export interface LLMTrackingData {
  sessionId: string;
  startTime: Date;
  endTime?: Date;
  interactions: LLMInteraction[];
  summary: {
    totalRequests: number;
    totalTokens: number;
    totalDuration: number;
    successRate: number;
    providerBreakdown: Record<string, number>;
    serviceBreakdown: Record<string, number>;
  };
}

export class LLMTracker {
  private interactions: LLMInteraction[] = [];
  private sessionId: string;
  private startTime: Date;

  constructor(sessionId?: string) {
    this.sessionId = sessionId || `session-${Date.now()}`;
    this.startTime = new Date();
  }

  /**
   * Track an LLM request
   */
  trackRequest(request: Omit<LLMRequest, 'id' | 'timestamp'>): string {
    const requestId = `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const fullRequest: LLMRequest = {
      ...request,
      id: requestId,
      timestamp: new Date()
    };

    // Create interaction entry
    const interaction: LLMInteraction = {
      request: fullRequest,
      response: {
        id: `resp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        requestId,
        timestamp: new Date(),
        content: '',
        duration: 0,
        success: false
      }
    };

    this.interactions.push(interaction);
    return requestId;
  }

  /**
   * Track an LLM response
   */
  trackResponse(requestId: string, response: Omit<LLMResponse, 'id' | 'requestId' | 'timestamp'>): void {
    const interaction = this.interactions.find(i => i.request.id === requestId);
    if (interaction) {
      interaction.response = {
        ...response,
        id: `resp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        requestId,
        timestamp: new Date()
      };
    }
  }

  /**
   * Add context to an interaction
   */
  addContext(requestId: string, context: LLMInteraction['context']): void {
    const interaction = this.interactions.find(i => i.request.id === requestId);
    if (interaction) {
      interaction.context = { ...interaction.context, ...context };
    }
  }

  /**
   * Get tracking data
   */
  getTrackingData(): LLMTrackingData {
    const endTime = new Date();
    const totalDuration = endTime.getTime() - this.startTime.getTime();

    const successfulRequests = this.interactions.filter(i => i.response.success).length;
    const totalTokens = this.interactions.reduce((sum, i) => sum + (i.response.tokensUsed || 0), 0);
    const totalRequestDuration = this.interactions.reduce((sum, i) => sum + i.response.duration, 0);

    // Provider breakdown
    const providerBreakdown: Record<string, number> = {};
    this.interactions.forEach(i => {
      providerBreakdown[i.request.provider] = (providerBreakdown[i.request.provider] || 0) + 1;
    });

    // Service breakdown
    const serviceBreakdown: Record<string, number> = {};
    this.interactions.forEach(i => {
      serviceBreakdown[i.request.service] = (serviceBreakdown[i.request.service] || 0) + 1;
    });

    return {
      sessionId: this.sessionId,
      startTime: this.startTime,
      endTime,
      interactions: [...this.interactions],
      summary: {
        totalRequests: this.interactions.length,
        totalTokens,
        totalDuration: totalRequestDuration,
        successRate: this.interactions.length > 0 ? (successfulRequests / this.interactions.length) * 100 : 0,
        providerBreakdown,
        serviceBreakdown
      }
    };
  }

  /**
   * Generate markdown report
   */
  generateMarkdownReport(): string {
    const data = this.getTrackingData();

    let markdown = `# LLM Interaction Report\n\n`;
    markdown += `**Session ID:** ${data.sessionId}\n`;
    markdown += `**Start Time:** ${data.startTime.toISOString()}\n`;
    markdown += `**End Time:** ${data.endTime?.toISOString()}\n`;
    markdown += `**Total Duration:** ${data.summary.totalDuration}ms\n\n`;

    markdown += `## Summary\n\n`;
    markdown += `- **Total Requests:** ${data.summary.totalRequests}\n`;
    markdown += `- **Total Tokens:** ${data.summary.totalTokens}\n`;
    markdown += `- **Success Rate:** ${data.summary.successRate.toFixed(2)}%\n\n`;

    markdown += `### Provider Breakdown\n\n`;
    Object.entries(data.summary.providerBreakdown).forEach(([provider, count]) => {
      markdown += `- **${provider}:** ${count} requests\n`;
    });
    markdown += `\n`;

    markdown += `### Service Breakdown\n\n`;
    Object.entries(data.summary.serviceBreakdown).forEach(([service, count]) => {
      markdown += `- **${service}:** ${count} requests\n`;
    });
    markdown += `\n`;

    markdown += `## Detailed Interactions\n\n`;
    data.interactions.forEach((interaction, index) => {
      markdown += `### Interaction ${index + 1}: ${interaction.request.service}.${interaction.request.method}\n\n`;
      markdown += `**Request ID:** ${interaction.request.id}\n`;
      markdown += `**Provider:** ${interaction.request.provider}\n`;
      markdown += `**Model:** ${interaction.request.model}\n`;
      markdown += `**Duration:** ${interaction.response.duration}ms\n`;
      markdown += `**Success:** ${interaction.response.success ? '✅' : '❌'}\n`;
      markdown += `**Tokens Used:** ${interaction.response.tokensUsed || 'N/A'}\n\n`;

      if (interaction.context?.url) {
        markdown += `**URL:** ${interaction.context.url}\n`;
      }
      if (interaction.context?.domain) {
        markdown += `**Domain:** ${interaction.context.domain}\n`;
      }
      if (interaction.context?.step) {
        markdown += `**Step:** ${interaction.context.step}\n`;
      }
      markdown += `\n`;

      markdown += `#### System Message\n\`\`\`\n${interaction.request.systemMessage || 'None'}\n\`\`\`\n\n`;

      markdown += `#### Prompt\n\`\`\`\n${interaction.request.prompt}\n\`\`\`\n\n`;

      markdown += `#### Response\n\`\`\`\n${interaction.response.content}\n\`\`\`\n\n`;

      if (interaction.response.error) {
        markdown += `#### Error\n\`\`\`\n${interaction.response.error}\n\`\`\`\n\n`;
      }

      markdown += `---\n\n`;
    });

    return markdown;
  }

  /**
   * Export as JSON
   */
  exportAsJSON(): string {
    return JSON.stringify(this.getTrackingData(), null, 2);
  }
}

// Global tracker instance
let globalTracker: LLMTracker | null = null;

/**
 * Get or create the global LLM tracker
 */
export function getLLMTracker(sessionId?: string): LLMTracker {
  if (!globalTracker) {
    globalTracker = new LLMTracker(sessionId);
  }
  return globalTracker;
}

/**
 * Reset the global tracker
 */
export function resetLLMTracker(sessionId?: string): void {
  globalTracker = new LLMTracker(sessionId);
}
