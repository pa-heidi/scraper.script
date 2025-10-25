# Website Scraping Plan Generator

An interactive command-line tool for generating intelligent website scraping plans using AI.

## Features

- 🤖 **AI-Powered Plan Generation**: Uses LLM to analyze websites and generate optimal scraping strategies
- 🔍 **Content URL Analysis**: Analyzes specific content pages to improve plan accuracy
- 🔗 **Sibling Link Discovery**: Automatically discovers related pages for comprehensive scraping
- 🧪 **Plan Testing**: Test generated plans with sample data extraction
- ⚙️ **Configurable Options**: Customize model selection, priorities, and constraints
- 📊 **Detailed Results**: Get comprehensive plan documentation and test results

## Prerequisites

- Node.js (v16 or higher)
- TypeScript (`npm install -g typescript ts-node`)
- Redis server (for plan storage and orchestration)

## Environment Setup

Create a `.env` file in the project root:

```env
# AI Model Configuration
OPENAI_API_KEY=your_openai_api_key_here
LOCAL_MODEL_ENDPOINT=http://localhost:11434  # For Ollama or local models

# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your_redis_password  # Optional
REDIS_DB=0

# Service Configuration
NODE_ENV=development
LOG_LEVEL=info
MAX_CONCURRENT_EXECUTIONS=5
EXECUTION_TIMEOUT=300000
RETRY_ATTEMPTS=3
```

## Quick Start

### Option 1: Direct Execution
```bash
# Make script executable (Linux/Mac)
chmod +x scripts/generate-plan.sh
./scripts/generate-plan.sh

# Windows
scripts\generate-plan.bat
```

### Option 2: Using npm scripts
```bash
npm run generate-plan
npm run quick-test
```

### Option 3: Using ts-node directly
```bash
npx ts-node generate-plan.ts
npx ts-node quick-test.ts
```

## Usage Guide

### 1. Basic Plan Generation

The CLI will guide you through the process:

1. **Enter Website URL**: Provide the main website URL to scrape
2. **Content URLs** (Optional): Add specific content page URLs for better analysis
3. **Configuration Options**:
   - Model preference (OpenAI vs Local)
   - Priority (Cost, Speed, Accuracy, Balanced)
   - Confidence threshold
   - Maximum cost per request
   - Pagination settings

### 2. Example Session

```
🚀 Website Scraping Plan Generator
===================================

Initializing services...
✅ Services initialized successfully

Enter the website URL to scrape: https://example-events.com

📋 Optional Configuration:
Do you have specific content page URLs to analyze? (y/n): y

Enter content URLs (one per line, press Enter twice to finish):
Content URL: https://example-events.com/event/summer-festival
✅ Added: https://example-events.com/event/summer-festival
Content URL: https://example-events.com/event/tech-conference
✅ Added: https://example-events.com/event/tech-conference
Content URL:

Use local AI model instead of OpenAI? (y/n): n

Select priority:
1. Cost (cheapest)
2. Speed (fastest)
3. Accuracy (most accurate)
4. Balanced (default)
Enter choice (1-4) [4]: 3

Minimum confidence threshold (0.0-1.0) [0.7]: 0.8
Maximum cost per request in USD [no limit]: 0.05
Does the site have pagination? (y/n): y
Example pagination URL (optional): https://example-events.com/events?page=2

🔄 Generating scraping plan...
```

### 3. Plan Output

The generator provides comprehensive results:

- **Plan Details**: Selectors, URLs, configuration
- **Confidence Score**: AI confidence in the plan
- **Sibling Discovery**: Additional URLs found
- **Test Results**: Sample data extraction
- **Human Documentation**: Readable plan explanation

### 4. Plan Testing

After generation, you can test the plan:

```
Would you like to test this plan? (y/n): y

🧪 Testing the plan...

📊 Test Results:
================
Status: completed
Items Extracted: 5
Pages Processed: 1
Duration: 3247ms
Accuracy Score: 92.5%

Sample Extracted Data:
---------------------

Item 1:
  Title: Summer Music Festival 2024
  Description: Join us for an amazing outdoor music festival featuring top artists...
  Website: https://example-events.com/event/summer-festival
  Images: 3 found
```

## Configuration Options

### Model Selection
- **OpenAI Models**: GPT-4, GPT-3.5 (requires API key)
- **Local Models**: Ollama, LLaMA (requires local setup)

### Priority Modes
- **Cost**: Minimize API costs, use cheaper models
- **Speed**: Fastest response times
- **Accuracy**: Highest quality results
- **Balanced**: Optimal cost/speed/accuracy trade-off

### Advanced Options
- **Confidence Threshold**: Minimum acceptable plan confidence (0.0-1.0)
- **Max Cost**: Maximum cost per API request in USD
- **Pagination**: Enable pagination detection and handling
- **Content URLs**: Specific pages to analyze for better accuracy

## Output Files

Generated plans are stored in Redis with the following structure:

- **Plan Data**: `plan:{planId}:{version}`
- **Plan Status**: `plan_status:{planId}`
- **Execution Results**: `execution:{runId}`
- **Metrics**: `plan_metrics:{planId}`

## Troubleshooting

### Common Issues

1. **Redis Connection Failed**
   ```
   Error: Redis client error: connect ECONNREFUSED
   ```
   - Ensure Redis server is running
   - Check Redis configuration in `.env`

2. **OpenAI API Error**
   ```
   Error: OpenAI API key not found
   ```
   - Set `OPENAI_API_KEY` in `.env`
   - Verify API key is valid and has credits

3. **Local Model Not Available**
   ```
   Error: Local model endpoint not responding
   ```
   - Start Ollama or your local model server
   - Check `LOCAL_MODEL_ENDPOINT` configuration

4. **Invalid URL Format**
   ```
   Error: Invalid URL format
   ```
   - Ensure URLs start with `http://` or `https://`
   - Check for typos in the URL

### Debug Mode

Enable debug logging:
```bash
export LOG_LEVEL=debug
npx ts-node generate-plan.ts
```

## API Integration

You can also use the plan generator programmatically:

```typescript
import { MCPOrchestratorService } from './src/services/mcp-orchestrator.service';

const orchestrator = new MCPOrchestratorService();
await orchestrator.initialize();

const result = await orchestrator.generatePlan(
  'https://example.com',
  ['https://example.com/page1', 'https://example.com/page2'],
  {
    priority: 'accuracy',
    confidenceThreshold: 0.8,
    useLocalModel: false
  }
);

console.log('Generated plan:', result);
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

MIT License - see LICENSE file for details.