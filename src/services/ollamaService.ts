export interface OllamaConfig {
  baseUrl: string;
  model: string;
  timeout?: number;
}

export interface OllamaResponse {
  model: string;
  created_at: string;
  response: string;
  done: boolean;
  context?: number[];
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

export interface OllamaChatResponse {
  model: string;
  created_at: string;
  message: {
    role: string;
    content: string;
  };
  done: boolean;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

export class OllamaService {
  private config: OllamaConfig;

  constructor(config: OllamaConfig) {
    this.config = {
      timeout: 30000,
      ...config,
    };
  }

  private async makeRequest(endpoint: string, data?: any): Promise<any> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const response = await fetch(`${this.config.baseUrl}${endpoint}`, {
        method: data ? 'POST' : 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        body: data ? JSON.stringify(data) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error: unknown) {
      clearTimeout(timeoutId);
      if (error instanceof Error) {
        throw new Error(`Ollama API error: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Generate a response from Ollama
   */
  async generate(
    prompt: string,
    options?: {
      model?: string; // NEW: Allow model override per request
      stream?: boolean;
      context?: number[];
      temperature?: number;
      top_p?: number;
      top_k?: number;
      format?: string; // e.g., 'json' to request structured output
    }
  ): Promise<OllamaResponse> {
    const data = {
      model: options?.model || this.config.model,
      prompt,
      stream: false,
      ...options,
    };

    return await this.makeRequest('/api/generate', data);
  }

  /**
   * Chat with Ollama using conversation format
   */
  async chat(
    messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
    options?: {
      temperature?: number;
      top_p?: number;
      top_k?: number;
    }
  ): Promise<OllamaChatResponse> {
    const data = {
      model: this.config.model,
      messages,
      stream: false,
      ...options,
    };

    return await this.makeRequest('/api/chat', data);
  }

  /**
   * List available models
   */
  async listModels(): Promise<{
    models: Array<{ name: string; size: number; digest: string; modified_at: string }>;
  }> {
    return await this.makeRequest('/api/tags');
  }

  /**
   * Check if Ollama is available
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.makeRequest('/api/tags');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get model information
   */
  async showModel(model?: string): Promise<any> {
    const data = {
      name: model || this.config.model,
    };

    return await this.makeRequest('/api/show', data);
  }
}

// Factory function to create Ollama service instances
export function createOllamaService(options?: {
  baseUrl?: string;
  model?: string;
  timeout?: number;
}): OllamaService {
  const config: OllamaConfig = {
    baseUrl: options?.baseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
    model: options?.model || process.env.OLLAMA_MODEL || 'llama3.2:1b',
    timeout: options?.timeout || 30000,
  };

  return new OllamaService(config);
}