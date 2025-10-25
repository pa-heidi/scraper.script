# Web Scraper Script

A comprehensive web scraping solution with intelligent plan generation, content analysis, and automated execution capabilities.

## Project Structure

```
scraper.script/
├── docs/                    # Documentation files
├── scripts/                 # Utility scripts
├── tests/                   # Test files and debugging scripts
├── src/                     # Source code
│   ├── cli/                # Command-line interface
│   ├── interfaces/         # TypeScript interfaces
│   ├── services/           # Core services
│   └── utils/              # Utility functions
├── package.json
└── tsconfig.json
```

## Core Services

- **LLM Planner Service**: Intelligent plan generation using AI models
- **Site Analysis Service**: Website structure and content analysis
- **Playwright Executor**: Automated browser-based scraping
- **Content Pattern Analyzer**: Pattern recognition and extraction
- **Cookie Consent Handler**: Automated cookie consent management
- **Data Validator**: Data quality assurance and validation
- **Sandbox Executor**: Safe testing environment for plans

## Getting Started

1. Install dependencies:
   ```bash
   npm install
   ```

2. Configure environment variables (see `docs/SETUP-INSTRUCTIONS.md`)

3. Run the plan generator:
   ```bash
   npm run generate-plan
   ```

## Documentation

See the `docs/` directory for detailed documentation including:
- Setup instructions
- Implementation summaries
- Enhancement documentation
- Problem-solving guides

## Scripts

- `scripts/generate-plan.sh` - Generate scraping plans
- `scripts/generate-plan.bat` - Windows version

## Testing

Test files are located in the `tests/` directory for development and debugging purposes.
