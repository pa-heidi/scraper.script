# Alternative JSDOM ESM Fix Solutions

If the main ESM solution doesn't work, try these alternatives:

## Option 1: Downgrade JSDOM (Quick Fix)

```bash
npm install jsdom@22.1.0 @types/jsdom@21.1.6
```

This uses an older version that's more compatible with CommonJS.

## Option 2: Use tsx instead of ts-node

```bash
npm install --save-dev tsx
```

Update package.json scripts:
```json
{
  "scripts": {
    "generate-plan": "tsx generate-plan.ts",
    "quick-test": "tsx quick-test.ts",
    "plan:interactive": "tsx generate-plan.ts",
    "plan:test": "tsx quick-test.ts"
  }
}
```

## Option 3: Revert to CommonJS (Conservative)

1. Revert tsconfig.json:
```json
{
  "compilerOptions": {
    "module": "CommonJS"
  },
  "ts-node": {
    "compilerOptions": {
      "module": "CommonJS"
    }
  }
}
```

2. Remove "type": "module" from package.json

3. Downgrade JSDOM:
```bash
npm install jsdom@22.1.0 @types/jsdom@21.1.6
```

## Option 4: Use Happy DOM (Alternative to JSDOM)

```bash
npm uninstall jsdom @types/jsdom
npm install happy-dom @types/happy-dom
```

Update imports in your services:
```typescript
// Replace this:
import { JSDOM } from 'jsdom';

// With this:
import { Window } from 'happy-dom';

// Usage:
const window = new Window();
const document = window.document;
document.body.innerHTML = html;
```

## Option 5: Dynamic Import Wrapper

Create a wrapper file `src/utils/jsdom-wrapper.ts`:

```typescript
export async function createJSDOM(html: string) {
  const { JSDOM } = await import('jsdom');
  return new JSDOM(html);
}
```

Use in services:
```typescript
import { createJSDOM } from '../utils/jsdom-wrapper';

// Instead of: new JSDOM(html)
const dom = await createJSDOM(html);
```

## Recommended Approach

1. Try the main ESM solution first
2. If that fails, use Option 2 (tsx)
3. If you need stability, use Option 3 (CommonJS + older JSDOM)