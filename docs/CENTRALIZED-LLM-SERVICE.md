# Centralized LLM Service

This document describes the centralized LLM service that provides unified access to different LLM providers (OpenAI, Ollama) across all services in the application.

## Overview

The centralized LLM service ensures that:
- All services use the same LLM models consistently
- Configuration is managed in one place
- Fallback logic is handled automatically
- Provider switching is seamless
- Token usage and costs are optimized

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                 Centralized LLM Service                     │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐    ┌─────────────────────────────────┐ │
│  │   Configuration │    │        Provider Manager        │ │
│  │   - Primary     │    │  ┌─────────────┐ ┌─────────────┐│ │
│  │   - Fallback    │    │  │   OpenAI    │ │   Ollama    ││ │
│  │   - Models      │    │  │  Service    │ │  Service    ││ │
│  │   - Limits      │    │  └─────────────┘ └─────────────┘│ │
│  └─────────────────┘    └─────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                                   │
                    ┌──────────────┼──────────────┐
                    │              │              │
        ┌─────────────────┐ ┌─────────────┐ ┌─────────────┐
        │ LLM Planner     │ │ Sibling Link│ │ Site Analysis│
        │ Service         │ │ Discovery   │ │ Service     │
        └─────────────────┘ └─────────────┘ └─────────────┘
```

## Features

### 1. Unified Interface
All services use the same interface to interact with LLMs:

```typescript
const llmService = getCentralizedLLMService();
const response = await llmService.generate({
  prompt: "Your prompt here",
  systemMessage: "System instructions",
  format: "json", // or "text"
  temperature: 0.1,
  maxTokens: 4000
});
```

### 2. Automatic Fallback
If the primary provider fails, the service automatically tries the fallback provider:

```typescript
// Configuration
{
  primaryProvider: 'openai',
  fallbackProvider: 'ollama'
}

// If OpenAI fails, automatically tries Ollama
```

### 3. Provider Detection
The service can detect which providers are available:

```typescript
const availability = await llmService.checkProviderAvailability();
// { openai: true, ollama: false }
```

### 4. Model Management
Get available models from all providers:

```typescript
const models = await llmService.getAvailableModels();
// { openai: ['gpt-4o-mini', 'gpt-4', ...], ollama: ['llama3.2:1b', ...] }
```

## Configuration

### Environment Variables

```bash
# Primary LLM provider (openai or ollama)
LLM_PRIMARY_PROVIDER=openai

# Fallback LLM provider (openai or ollama)
LLM_FALLBACK_PROVIDER=ollama

# OpenAI Configuration
OPENAI_API_KEY=your_openai_api_key
OPENAI_MODEL=gpt-4o-mini

# Ollama Configuration
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2:1b
```

### Programmatic Configuration

```typescript
const llmService = getCentralizedLLMService({
  primaryProvider: 'openai',
  fallbackProvider: 'ollama',
  openaiModel: 'gpt-4o-mini',
  ollamaModel: 'llama3.2:1b',
  maxTokens: 8000,
  temperature: 0.1
});

// Update configuration at runtime
llmService.updateConfig({
  temperature: 0.2,
  maxTokens: 4000
});
```

## Usage Examples

### Basic Text Generation

```typescript
import { getCentralizedLLMService } from './src/services/centralized-llm.service';

const llmService = getCentralizedLLMService();

const response = await llmService.generate({
  prompt: "Explain web scraping in one sentence",
  systemMessage: "You are a helpful technical assistant",
  temperature: 0.1,
  maxTokens: 100
});

console.log(response.content);
console.log(`Used: ${response.provider} (${response.model})`);
```

### JSON Generation

```typescript
const response = await llmService.generate({
  prompt: "Generate a CSS selector analysis for this HTML: <div class='items'>...",
  systemMessage: "You are a web scraping expert. Respond with valid JSON only.",
  format: "json",
  temperature: 0.1
});

const analysis = JSON.parse(response.content);
```

### Provider-Specific Requests

```typescript
// Force use of specific provider
const response = await llmService.generate({
  prompt: "Your prompt",
  provider: "ollama" // Override default provider
});
```

## Migration Guide

### From Individual LLM Services

**Before (LLM Planner Service):**
```typescript
export class LLMPlannerService {
  private openai?: OpenAI;
  private ollamaService: OllamaService;

  constructor() {
    this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    this.ollamaService = createOllamaService();
  }

  async generatePlan() {
    try {
      // Try OpenAI first
      const response = await this.openai.chat.completions.create({...});
    } catch (error) {
      // Fallback to Ollama
      const response = await this.ollamaService.generate(...);
    }
  }
}
```

**After (Centralized):**
```typescript
import { getCentralizedLLMService } from './centralized-llm.service';

export class LLMPlannerService {
  private llmService = getCentralizedLLMService();

  constructor() {
    // Configure for planning tasks
    this.llmService.updateConfig({
      primaryProvider: 'openai',
      fallbackProvider: 'ollama',
      maxTokens: 8000,
      temperature: 0.1
    });
  }

  async generatePlan() {
    const response = await this.llmService.generate({
      prompt: "Generate scraping plan...",
      systemMessage: "You are a web scraping expert",
      format: "json"
    });
    // Automatic fallback handled internally
  }
}
```

### Migration Steps

1. **Run the migration script:**
   ```bash
   npx ts-node migrate-to-centralized-llm.ts
   ```

2. **Update environment variables:**
   ```bash
   # Add new variables
   LLM_PRIMARY_PROVIDER=openai
   LLM_FALLBACK_PROVIDER=ollama
   ```

3. **Test the migration:**
   ```bash
   npx ts-node test-centralized-llm.ts
   ```

4. **Update service imports:**
   ```typescript
   // Old
   import { OpenAI } from 'openai';
   import { createOllamaService } from './ollamaService';

   // New
   import { getCentralizedLLMService } from './centralized-llm.service';
   ```

## Benefits

### 1. Consistency
- All services use the same models
- Consistent response formats
- Unified error handling

### 2. Cost Optimization
- Centralized token tracking
- Model selection based on task complexity
- Automatic provider switching for cost efficiency

### 3. Maintainability
- Single point of configuration
- Easier to update models
- Simplified testing and debugging

### 4. Reliability
- Automatic fallback handling
- Provider health monitoring
- Graceful degradation

## Testing

### Run Tests
```bash
# Test the centralized service
npx ts-node test-centralized-llm.ts

# Test individual services after migration
npm test
```

### Test Coverage
- Provider availability detection
- Model listing and validation
- Basic text generation
- JSON format generation
- Fallback mechanism
- Configuration management

## Troubleshooting

### Common Issues

1. **No providers available**
   - Check OpenAI API key: `echo $OPENAI_API_KEY`
   - Check Ollama service: `curl http://localhost:11434/api/tags`

2. **JSON parsing errors**
   - Ensure model supports JSON format
   - Check system message includes JSON instruction
   - Validate response before parsing

3. **Token limit exceeded**
   - Reduce `maxTokens` in configuration
   - Compress input prompts
   - Use smaller models for simple tasks

4. **Fallback not working**
   - Verify fallback provider is configured
   - Check provider availability
   - Review error logs for specific failures

### Debug Mode
```typescript
// Enable debug logging
process.env.LOG_LEVEL = 'debug';

const llmService = getCentralizedLLMService();
// Detailed logs will show provider selection and fallback attempts
```

## Future Enhancements

- [ ] Token usage analytics and reporting
- [ ] Cost tracking per service
- [ ] Model performance benchmarking
- [ ] Automatic model selection based on task type
- [ ] Request caching for repeated prompts
- [ ] Rate limiting and queue management
- [ ] Support for additional providers (Anthropic, etc.)

## API Reference

### CentralizedLLMService

#### Methods

- `generate(request: LLMRequest): Promise<LLMResponse>`
- `getConfig(): LLMConfig`
- `updateConfig(config: Partial<LLMConfig>): void`
- `checkProviderAvailability(): Promise<{openai: boolean, ollama: boolean}>`
- `getAvailableModels(): Promise<{openai: string[], ollama: string[]}>`

#### Types

```typescript
interface LLMRequest {
  prompt: string;
  systemMessage?: string;
  maxTokens?: number;
  temperature?: number;
  format?: 'json' | 'text';
  provider?: 'openai' | 'ollama';
}

interface LLMResponse {
  content: string;
  provider: 'openai' | 'ollama';
  model: string;
  tokensUsed?: number;
  finishReason?: string;
}

interface LLMConfig {
  primaryProvider: 'openai' | 'ollama';
  fallbackProvider?: 'openai' | 'ollama';
  openaiModel?: string;
  ollamaModel?: string;
  maxTokens?: number;
  temperature?: number;
}
```