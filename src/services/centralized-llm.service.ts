/**
 * Centralized LLM Service
 * Provides unified access to different LLM providers (OpenAI, Ollama) for all services
 * Ensures consistent model usage across the application
 */

import OpenAI from 'openai';
import { OllamaService, createOllamaService } from './ollamaService';
import { logger } from '../utils/logger';

export interface LLMConfig {
  primaryProvider: 'openai' | 'ollama';
  fallbackProvider?: 'openai' | 'ollama';
  openaiModel?: string;
  ollamaModel?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface LLMRequest {
  prompt: string;
  systemMessage?: string;
  maxTokens?: number;
  temperature?: number;
  format?: 'json' | 'text';
  provider?: 'openai' | 'ollama'; // Override for specific requests
}

export interface LLMResponse {
  content: string;
  provider: 'openai' | 'ollama';
  model: string;
  tokensUsed?: number;
  finishReason?: string;
  confidence?: number;
}

export class CentralizedLLMService {
  private openai?: OpenAI;
  private ollama: OllamaService;
  private config: LLMConfig;

  constructor(config?: Partial<LLMConfig>) {
    this.config = {
      primaryProvider: 'openai',
      fallbackProvider: 'ollama',
      openaiModel: 'gpt-4o-mini',
      ollamaModel: process.env.OLLAMA_MODEL || 'llama3.2:1b',
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
      ollamaModel: this.config.ollamaModel,
    });
  }

  /**
   * Generate response using the configured LLM providers
   */
  async generate(request: LLMRequest): Promise<LLMResponse> {
    const provider = request.provider || this.config.primaryProvider;

    logger.debug('LLM request initiated', {
      provider,
      promptLength: request.prompt.length,
      format: request.format,
      temperature: request.temperature || this.config.temperature,
    });

    try {
      if (provider === 'openai') {
        return await this.generateWithOpenAI(request);
      } else {
        return await this.generateWithOllama(request);
      }
    } catch (error) {
      logger.warn(`Primary provider ${provider} failed, trying fallback`, { error });

      // Try fallback provider if configured
      if (this.config.fallbackProvider && this.config.fallbackProvider !== provider) {
        try {
          if (this.config.fallbackProvider === 'openai') {
            return await this.generateWithOpenAI(request);
          } else {
            return await this.generateWithOllama(request);
          }
        } catch (fallbackError) {
          logger.error('Both primary and fallback providers failed', {
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
    });
  }

  /**
   * Check availability of providers
   */
  async checkProviderAvailability(): Promise<{
    openai: boolean;
    ollama: boolean;
  }> {
    const results = {
      openai: false,
      ollama: false,
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
  }> {
    const models = {
      openai: [] as string[],
      ollama: [] as string[],
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