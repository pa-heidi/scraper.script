#!/bin/bash

# Website Scraping Plan Generator
# Shell script to run the plan generator

echo "🚀 Starting Website Scraping Plan Generator..."
echo "=============================================="

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js first."
    exit 1
fi

# Check if ts-node is available
if ! command -v npx &> /dev/null; then
    echo "❌ npx is not available. Please install npm first."
    exit 1
fi

# Set environment variables for development
export NODE_ENV=development
export LOG_LEVEL=info

# Run the plan generator
npm run generate-plan

echo "✅ Plan generator finished."