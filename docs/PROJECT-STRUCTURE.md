# Project Structure

This document describes the organized structure of the Web Scraper Script project.

## Directory Organization

```
scraper.script/
├── docs/                           # Documentation
│   ├── PROJECT-STRUCTURE.md       # This file
│   ├── SETUP-INSTRUCTIONS.md      # Setup guide
│   ├── README-plan-generator.md   # Plan generator documentation
│   └── *.md                       # Various implementation docs
├── scripts/                        # Utility scripts
│   ├── generate-plan.ts           # Main plan generation script
│   ├── generate-plan.sh           # Unix shell script
│   └── generate-plan.bat          # Windows batch script
├── tests/                          # Test and debugging files
│   ├── test-*.ts                  # Various test files
│   ├── debug-*.ts                 # Debug scripts
│   ├── example-*.ts               # Example usage scripts
│   └── migrate-*.ts               # Migration scripts
├── src/                           # Source code
│   ├── cli/                       # Command-line interface
│   │   └── plan-generator.ts      # CLI entry point
│   ├── interfaces/                # TypeScript interfaces
│   │   └── core.ts                # Core type definitions
│   ├── services/                  # Core services
│   │   ├── centralized-llm.service.ts
│   │   ├── content-pattern-analyzer.service.ts
│   │   ├── cookie-consent-handler.service.ts
│   │   ├── data-validator.service.ts
│   │   ├── html-compressor.service.ts
│   │   ├── legal-compliance.service.ts
│   │   ├── llamaindex-integration.service.ts
│   │   ├── llm-planner.service.ts
│   │   ├── mcp-orchestrator.service.ts
│   │   ├── ollamaService.ts
│   │   ├── playwright-executor.service.ts
│   │   ├── sandbox-executor.service.ts
│   │   ├── sibling-link-discovery.service.ts
│   │   ├── site-analysis.service.ts
│   │   └── index.ts               # Service exports
│   └── utils/                     # Utility functions
│       └── logger.ts              # Logging utility
├── .gitignore                     # Git ignore rules
├── package.json                   # Project configuration
├── package-scripts.json           # Additional scripts
├── README.md                      # Main project documentation
└── tsconfig.json                  # TypeScript configuration
```

## File Categories

### Documentation (`docs/`)
- Implementation summaries
- Setup instructions
- Enhancement documentation
- Problem-solving guides

### Scripts (`scripts/`)
- Production utility scripts
- Shell and batch scripts for automation
- Main entry points for the application

### Tests (`tests/`)
- Development and debugging scripts
- Test files for various components
- Migration and example scripts
- Debug utilities

### Source Code (`src/`)
- **CLI**: Command-line interface components
- **Interfaces**: TypeScript type definitions
- **Services**: Core business logic services
- **Utils**: Shared utility functions

## Cleanup Actions Performed

1. **Moved documentation** from root to `docs/` folder
2. **Organized scripts** into `scripts/` folder
3. **Moved test files** to `tests/` folder
4. **Removed backup files** from services directory
5. **Cleaned up logs** directory
6. **Updated package.json** scripts to reflect new paths
7. **Created .gitignore** to exclude unnecessary files
8. **Added comprehensive README.md**

## Benefits of This Organization

- **Clear separation** of concerns
- **Easy navigation** for developers
- **Reduced clutter** in root directory
- **Better maintainability**
- **Standard project structure**
- **Excluded debug files** from version control
