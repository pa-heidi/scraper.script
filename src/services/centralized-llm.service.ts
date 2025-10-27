/**
 * Centralized LLM Service
 * Provides unified access to different LLM providers (OpenAI, Ollama) for all services
 * Ensures consistent model usage across the application
 */

import OpenAI from 'openai';
import { OllamaService, createOllamaService } from './ollamaService';
import { logger } from '../utils/logger';
import { getLLMTracker } from './llm-tracker.service';

export interface LLMConfig {
  primaryProvider: 'openai' | 'ollama' | 'openrouter';
  fallbackProvider?: 'openai' | 'ollama' | 'openrouter';
  openaiModel?: string;
  ollamaModel?: string;
  openrouterModel?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface LLMRequest {
  prompt: string;
  systemMessage?: string;
  maxTokens?: number;
  temperature?: number;
  format?: 'json' | 'text';
  provider?: 'openai' | 'ollama' | 'openrouter'; // Override for specific requests
  // Tracking information
  service?: string; // e.g., 'cookie-consent', 'sibling-detection', 'pagination-detection'
  method?: string; // e.g., 'detectCookieDialog', 'findSiblingLinks', 'analyzePagination'
  context?: {
    url?: string;
    domain?: string;
    step?: string;
    metadata?: Record<string, any>;
  };
}

export interface LLMResponse {
  content: string;
  provider: 'openai' | 'ollama' | 'openrouter';
  model: string;
  tokensUsed?: number;
  finishReason?: string;
  confidence?: number;
}

export class CentralizedLLMService {
  private openai?: OpenAI;
  private openrouter?: OpenAI;
  private ollama: OllamaService;
  private config: LLMConfig;

  constructor(config?: Partial<LLMConfig>) {
    this.config = {
      primaryProvider: 'openai',
      fallbackProvider: 'ollama',
      openaiModel: 'gpt-4o-mini',
      ollamaModel: process.env.OLLAMA_MODEL || 'llama3.2:1b',
      openrouterModel: process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini',
      maxTokens: 8000,
      temperature: 0.1,
      ...config,
    };

    // Initialize OpenAI if API key is available
    if (process.env.OPENAI_API_KEY) {
      this.openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      });
    }

    // Initialize OpenRouter if API key is available
    if (process.env.OPENROUTER_API_KEY) {
      this.openrouter = new OpenAI({
        apiKey: process.env.OPENROUTER_API_KEY,
        baseURL: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
      });
    }

    // Initialize Ollama service
    this.ollama = createOllamaService({
      model: this.config.ollamaModel,
      baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
      timeout: 300000,
    });

    logger.info('Centralized LLM Service initialized', {
      primaryProvider: this.config.primaryProvider,
      fallbackProvider: this.config.fallbackProvider,
      openaiAvailable: !!this.openai,
      openaiModel: this.config.openaiModel,
      openrouterAvailable: !!this.openrouter,
      openrouterModel: this.config.openrouterModel,
      ollamaModel: this.config.ollamaModel,
    });
  }

  /**
   * Generate response using the configured LLM providers
   */
  async generate(request: LLMRequest): Promise<LLMResponse> {
    const provider: 'openai' | 'ollama' | 'openrouter' = request.provider || this.config.primaryProvider;
    const tracker = getLLMTracker();

    // Track the request
    const model = provider === 'openai' ? this.config.openaiModel! :
                  provider === 'openrouter' ? this.config.openrouterModel! :
                  this.config.ollamaModel!;

    const requestId = tracker.trackRequest({
      service: request.service || 'unknown',
      method: request.method || 'generate',
      provider,
      model,
      prompt: request.prompt,
      systemMessage: request.systemMessage,
      maxTokens: request.maxTokens || this.config.maxTokens,
      temperature: request.temperature || this.config.temperature,
      format: request.format
    });

    // Add context if provided
    if (request.context) {
      tracker.addContext(requestId, request.context);
    }

    logger.debug('LLM request initiated', {
      requestId,
      provider,
      promptLength: request.prompt.length,
      format: request.format,
      temperature: request.temperature || this.config.temperature,
      service: request.service,
      method: request.method
    });

    const startTime = Date.now();

    try {
      let response: LLMResponse;

      if (provider === 'openai') {
        response = await this.generateWithOpenAI(request);
      } else if (provider === 'openrouter') {
        response = await this.generateWithOpenRouter(request);
      } else {
        response = await this.generateWithOllama(request);
      }

      // Track successful response
      tracker.trackResponse(requestId, {
        content: response.content,
        tokensUsed: response.tokensUsed,
        finishReason: response.finishReason,
        confidence: response.confidence,
        duration: Date.now() - startTime,
        success: true
      });

      logger.debug('LLM response received', {
        requestId,
        provider: response.provider,
        model: response.model,
        tokensUsed: response.tokensUsed,
        duration: Date.now() - startTime
      });

      return response;

    } catch (error) {
      // Track failed response
      tracker.trackResponse(requestId, {
        content: '',
        duration: Date.now() - startTime,
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });

      logger.warn(`Primary provider ${provider} failed, trying fallback`, {
        requestId,
        error
      });

      // Try fallback provider if configured
      if (this.config.fallbackProvider && this.config.fallbackProvider !== provider) {
        try {
          let fallbackResponse: LLMResponse;

          if (this.config.fallbackProvider === 'openai') {
            fallbackResponse = await this.generateWithOpenAI(request);
          } else if (this.config.fallbackProvider === 'openrouter') {
            fallbackResponse = await this.generateWithOpenRouter(request);
          } else {
            fallbackResponse = await this.generateWithOllama(request);
          }

          // Track successful fallback response
          tracker.trackResponse(requestId, {
            content: fallbackResponse.content,
            tokensUsed: fallbackResponse.tokensUsed,
            finishReason: fallbackResponse.finishReason,
            confidence: fallbackResponse.confidence,
            duration: Date.now() - startTime,
            success: true
          });

          logger.debug('LLM fallback response received', {
            requestId,
            provider: fallbackResponse.provider,
            model: fallbackResponse.model,
            tokensUsed: fallbackResponse.tokensUsed,
            duration: Date.now() - startTime
          });

          return fallbackResponse;

        } catch (fallbackError) {
          // Track failed fallback response
          tracker.trackResponse(requestId, {
            content: '',
            duration: Date.now() - startTime,
            success: false,
            error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
          });

          logger.error('Both primary and fallback providers failed', {
            requestId,
            primaryError: error,
            fallbackError
          });
          throw fallbackError;
        }
      }

      throw error;
    }
  }

  /**
   * Generate response using OpenAI
   */
  private async generateWithOpenAI(request: LLMRequest): Promise<LLMResponse> {
    if (!this.openai) {
      throw new Error('OpenAI client not initialized. Please provide OPENAI_API_KEY environment variable.');
    }

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

    if (request.systemMessage) {
      messages.push({
        role: 'system',
        content: request.systemMessage,
      });
    }

    messages.push({
      role: 'user',
      content: request.prompt,
    });

    const requestParams: OpenAI.Chat.Completions.ChatCompletionCreateParams = {
      model: this.config.openaiModel!,
      messages,
      max_tokens: request.maxTokens || this.config.maxTokens,
      temperature: request.temperature || this.config.temperature,
    };

    // Add JSON format if requested and model supports it
    if (request.format === 'json' && this.modelSupportsJsonFormat(this.config.openaiModel!)) {
      requestParams.response_format = { type: 'json_object' };
    }

    logger.debug('Making OpenAI API call', {
      model: this.config.openaiModel,
      messagesCount: messages.length,
      maxTokens: requestParams.max_tokens,
      jsonFormat: !!requestParams.response_format,
    });

    const response = await this.openai.chat.completions.create(requestParams);
    const content = response.choices[0]?.message?.content;

    if (!content) {
      throw new Error(`Empty response from OpenAI model ${this.config.openaiModel}`);
    }

    logger.debug('OpenAI response received', {
      model: this.config.openaiModel,
      tokensUsed: response.usage?.total_tokens,
      finishReason: response.choices[0]?.finish_reason,
    });

    return {
      content,
      provider: 'openai',
      model: this.config.openaiModel!,
      tokensUsed: response.usage?.total_tokens,
      finishReason: response.choices[0]?.finish_reason || undefined,
    };
  }

  /**
   * Generate response using OpenRouter
   */
  private async generateWithOpenRouter(request: LLMRequest): Promise<LLMResponse> {
    if (!this.openrouter) {
      throw new Error('OpenRouter client not initialized. Please provide OPENROUTER_API_KEY environment variable.');
    }

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

    if (request.systemMessage) {
      messages.push({
        role: 'system',
        content: request.systemMessage,
      });
    }

    messages.push({
      role: 'user',
      content: request.prompt,
    });

    const requestParams: OpenAI.Chat.Completions.ChatCompletionCreateParams = {
      model: this.config.openrouterModel!,
      messages,
      max_tokens: request.maxTokens || this.config.maxTokens,
      temperature: request.temperature || this.config.temperature,
    };

    // Add JSON format if requested and model supports it
    if (request.format === 'json') {
      requestParams.response_format = { type: 'json_object' };
    }

    logger.debug('Making OpenRouter API call', {
      model: this.config.openrouterModel,
      messagesCount: messages.length,
      maxTokens: requestParams.max_tokens,
      jsonFormat: !!requestParams.response_format,
    });

    const response = await this.openrouter.chat.completions.create(requestParams);
    const content = response.choices[0]?.message?.content;

    if (!content) {
      throw new Error(`Empty response from OpenRouter model ${this.config.openrouterModel}`);
    }

    logger.debug('OpenRouter response received', {
      model: this.config.openrouterModel,
      tokensUsed: response.usage?.total_tokens,
      finishReason: response.choices[0]?.finish_reason,
    });

    return {
      content,
      provider: 'openrouter',
      model: this.config.openrouterModel!,
      tokensUsed: response.usage?.total_tokens,
      finishReason: response.choices[0]?.finish_reason || undefined,
    };
  }

  /**
   * Generate response using Ollama
   */
  private async generateWithOllama(request: LLMRequest): Promise<LLMResponse> {
    let prompt = request.prompt;

    // Prepend system message if provided
    if (request.systemMessage) {
      prompt = `${request.systemMessage}\n\n${request.prompt}`;
    }

    // Add JSON format instruction if requested
    if (request.format === 'json') {
      prompt += '\n\nPlease respond with valid JSON format only.';
    }

    logger.debug('Making Ollama API call', {
      model: this.config.ollamaModel,
      promptLength: prompt.length,
      temperature: request.temperature || this.config.temperature,
    });

    const response = await this.ollama.generate(prompt, {
      temperature: request.temperature || this.config.temperature,
      format: request.format === 'json' ? 'json' : undefined,
    });

    logger.debug('Ollama response received', {
      model: this.config.ollamaModel,
      responseLength: response.response.length,
      totalDuration: response.total_duration,
    });

    return {
      content: response.response,
      provider: 'ollama',
      model: this.config.ollamaModel!,
      tokensUsed: response.eval_count,
    };
  }

  /**
   * Check if a model supports JSON response format
   */
  private modelSupportsJsonFormat(model: string): boolean {
    const jsonSupportedModels = [
      'gpt-4o',
      'gpt-4o-mini',
      'gpt-4-turbo',
      'gpt-4-turbo-preview',
      'gpt-3.5-turbo',
    ];

    return jsonSupportedModels.some(supportedModel =>
      model.toLowerCase().includes(supportedModel.toLowerCase())
    );
  }

  /**
   * Get current configuration
   */
  getConfig(): LLMConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<LLMConfig>): void {
    this.config = { ...this.config, ...newConfig };

    logger.info('LLM configuration updated', {
      primaryProvider: this.config.primaryProvider,
      fallbackProvider: this.config.fallbackProvider,
      openaiModel: this.config.openaiModel,
      ollamaModel: this.config.ollamaModel,
      openrouterModel: this.config.openrouterModel,
    });
  }

  /**
   * Check availability of providers
   */
  async checkProviderAvailability(): Promise<{
    openai: boolean;
    ollama: boolean;
    openrouter: boolean;
  }> {
    const results = {
      openai: false,
      ollama: false,
      openrouter: false,
    };

    // Check OpenAI
    if (this.openai) {
      try {
        await this.openai.models.list();
        results.openai = true;
      } catch (error) {
        logger.debug('OpenAI not available', { error });
      }
    }

    // Check OpenRouter
    if (this.openrouter) {
      try {
        await this.openrouter.models.list();
        results.openrouter = true;
      } catch (error) {
        logger.debug('OpenRouter not available', { error });
      }
    }

    // Check Ollama
    try {
      results.ollama = await this.ollama.healthCheck();
    } catch (error) {
      logger.debug('Ollama not available', { error });
    }

    return results;
  }

  /**
   * Get available models from providers
   */
  async getAvailableModels(): Promise<{
    openai: string[];
    ollama: string[];
    openrouter: string[];
  }> {
    const models = {
      openai: [] as string[],
      ollama: [] as string[],
      openrouter: [] as string[],
    };

    // Get OpenAI models
    if (this.openai) {
      try {
        const response = await this.openai.models.list();
        models.openai = response.data.map(model => model.id);
      } catch (error) {
        logger.debug('Failed to get OpenAI models', { error });
      }
    }

    // Get OpenRouter models
    if (this.openrouter) {
      try {
        const response = await this.openrouter.models.list();
        models.openrouter = response.data.map(model => model.id);
      } catch (error) {
        logger.debug('Failed to get OpenRouter models', { error });
      }
    }

    // Get Ollama models
    try {
      const response = await this.ollama.listModels();
      models.ollama = response.models.map(model => model.name);
    } catch (error) {
      logger.debug('Failed to get Ollama models', { error });
    }

    return models;
  }
}

// Singleton instance
let centralizedLLMService: CentralizedLLMService | null = null;

/**
 * Get or create the centralized LLM service instance
 */
export function getCentralizedLLMService(config?: Partial<LLMConfig>): CentralizedLLMService {
  if (!centralizedLLMService) {
    centralizedLLMService = new CentralizedLLMService(config);
  } else if (config) {
    centralizedLLMService.updateConfig(config);
  }

  return centralizedLLMService;
}

/**
 * Reset the singleton instance (useful for testing)
 */
export function resetCentralizedLLMService(): void {
  centralizedLLMService = null;
}