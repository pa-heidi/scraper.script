# Setup Instructions - Website Scraping Plan Generator

## Problem Fixed

The error you encountered was due to TypeScript module resolution issues. The problem has been resolved by:

1. ✅ **Created proper `tsconfig.json`** with CommonJS module configuration
2. ✅ **Updated package.json scripts** with correct ts-node configuration
3. ✅ **Configured ts-node** to work with TypeScript imports properly

## Quick Start (Fixed)

Now you can run the plan generator using any of these methods:

### Method 1: Using npm scripts (Recommended)
```bash
npm run generate-plan
```

### Method 2: Using ts-node directly
```bash
npx ts-node generate-plan.ts
```

### Method 3: Using shell scripts
```bash
# Linux/Mac
./scripts/generate-plan.sh

# Windows
scripts\generate-plan.bat
```

## What Was Fixed

### 1. Created `tsconfig.json`
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "CommonJS",  // Changed from ESNext to CommonJS
    "moduleResolution": "node",
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    // ... other settings
  },
  "ts-node": {
    "compilerOptions": {
      "module": "CommonJS"  // Ensures ts-node uses CommonJS
    }
  }
}
```

### 2. Updated `package.json` scripts
```json
{
  "scripts": {
    "generate-plan": "ts-node generate-plan.ts",
    "quick-test": "ts-node quick-test.ts",
    "plan:interactive": "ts-node generate-plan.ts",
    "plan:test": "ts-node quick-test.ts"
  }
}
```

### 3. Updated shell scripts to use npm
- Changed from `npx ts-node generate-plan.ts` to `npm run generate-plan`

## Test the Fix

Run this simple test to verify everything works:

```bash
# Test import resolution
npx ts-node test-import.ts

# Test the actual CLI
npm run generate-plan
```

## Environment Setup

Make sure you have the required environment variables:

```bash
# Copy the example environment file
cp .env.example .env

# Edit .env with your configuration
# Required: REDIS_HOST, REDIS_PORT
# Optional: OPENAI_API_KEY, LOCAL_MODEL_ENDPOINT
```

## Minimum Requirements

- Node.js >= 18.0.0
- TypeScript and ts-node installed
- Redis server running (for plan storage)

## If You Still Get Errors

1. **Clear node_modules and reinstall:**
   ```bash
   rm -rf node_modules package-lock.json
   npm install
   ```

2. **Verify TypeScript installation:**
   ```bash
   npx tsc --version
   npx ts-node --version
   ```

3. **Check Redis connection:**
   ```bash
   # Make sure Redis is running
   redis-cli ping
   # Should return: PONG
   ```

4. **Run with debug logging:**
   ```bash
   LOG_LEVEL=debug npm run generate-plan
   ```

## Success! 🎉

The module import error has been resolved. You can now use the interactive plan generator to create website scraping plans with AI assistance.