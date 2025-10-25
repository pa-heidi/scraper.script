@echo off
REM Website Scraping Plan Generator
REM Batch script to run the plan generator on Windows

echo 🚀 Starting Website Scraping Plan Generator...
echo ==============================================

REM Check if Node.js is installed
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Node.js is not installed. Please install Node.js first.
    pause
    exit /b 1
)

REM Set environment variables for development
set NODE_ENV=development
set LOG_LEVEL=info

REM Run the plan generator
npm run generate-plan

echo ✅ Plan generator finished.
pause