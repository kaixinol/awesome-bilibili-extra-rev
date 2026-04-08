# Source Code Structure

This directory contains all the automation scripts and utilities for maintaining the awesome-bilibili-extra repository.

## Directory Organization

```
src/
├── core/              # Core utilities and shared modules
│   ├── index.js       # Unified exports for all core modules
│   ├── repo-data.js   # YAML data loading, validation, and manipulation
│   ├── link-check-core.js  # Link checking logic with concurrency control
│   └── addIcon.js     # Technology stack icon badge generation
│
├── generators/        # Main maintenance and generation scripts
│   ├── maintain.js           # Primary maintenance script (README + CHANGELOG generation)
│   ├── maintain-cleanup.js   # Automated cleanup of duplicates and dead links
│   ├── check-pr.js           # PR validation (format, duplicates, links)
│   ├── check-yaml.js         # YAML syntax validation
│   ├── updateUser.js         # Generate user.js from template
│   │
│   # Legacy/unused generators (kept for reference)
│   ├── generator.js          # Old README generator (replaced by maintain.js)
│   ├── sort-format.js        # Old sorting/formatting script
│   └── commit.js             # Old changelog generator
│
├── tools/             # Standalone utility scripts
│   ├── link-checker.js         # Manual link validation with reporting
│   ├── double-link-checker.js  # Duplicate link detection
│   └── getItems.js             # Interactive tool to discover new Bilibili projects
│
├── templates/         # Template files
│   └── raw.user.js    # Template for generating user.js (Tampermonkey script)
│
└── user.js            # Generated file - DO NOT EDIT MANUALLY
                       # Auto-generated from templates/raw.user.js by updateUser.js
```

## Module Descriptions

### Core Modules (`src/core/`)

These are the foundational utilities used throughout the project:

- **`repo-data.js`**: Handles all YAML file operations including:
  - Loading and parsing YAML arrays
  - Validating item structure (required fields, types)
  - Normalizing links (GitHub, GreasyFork)
  - Tracking file locations and indices
  - Writing formatted YAML back to disk

- **`link-check-core.js`**: Efficient link validation with:
  - Concurrent HEAD requests (default: 6 workers)
  - Timeout handling (15s default)
  - Progress reporting with output synchronization
  - Status code interpretation (200-399, 429 = OK)

- **`addIcon.js`**: Converts technology tags to badge images:
  - Supports 25+ languages/platforms (Python, JS, Rust, etc.)
  - Maps aliases (e.g., "py" → "python")
  - Returns markdown image strings

- **`index.js`**: Centralized export point for cleaner imports

### Generators (`src/generators/`)

Scripts that generate or modify repository content:

#### Active Scripts (Used in CI/CD)

- **`maintain.js`**: The main maintenance orchestrator
  - Loads all YAML data from RAW_DATA/
  - Checks link validity (concurrent, 6 workers)
  - Detects changes vs. historical data
  - Generates README.md from template
  - Generates CHANGELOG.md with categorized changes
  - Saves history for next comparison

- **`maintain-cleanup.js`**: Automated quality control
  - Removes duplicate entries across all YAML files
  - Tracks failed link checks (2-strike policy)
  - Removes consistently dead links
  - Generates cleanup reports
  - Preserves first-failure items for monitoring

- **`check-pr.js`**: Pull request validation
  - Validates only changed YAML items
  - Checks format compliance
  - Detects new duplicates
  - Verifies link accessibility
  - Reports to GitHub PR summary

- **`check-yaml.js`**: Syntax validation
  - Recursively checks all .yml files
  - Reports parse errors with line numbers
  - Used in pre-commit hooks

- **`updateUser.js`**: User script generation
  - Reads templates/raw.user.js
  - Extracts all project links from YAML
  - Injects links into template
  - Outputs src/user.js (Tampermonkey script)

#### Legacy Scripts (Not Actively Used)

Kept for reference but not called by any workflow:
- `generator.js` - Superseded by maintain.js
- `sort-format.js` - Functionality merged into maintain.js
- `commit.js` - Replaced by maintain.js changelog logic

### Tools (`src/tools/`)

Standalone utilities for manual use:

- **`link-checker.js`**: Comprehensive link audit
  - Checks ALL tracked links (not just PR changes)
  - Generates detailed markdown report
  - Identifies duplicates
  - Configurable via environment variables

- **`double-link-checker.js`**: Quick duplicate scan
  - Fast detection of duplicate normalized links
  - Console table output
  - Exits with error code if duplicates found

- **`getItems.js`**: Discovery tool
  - Scrapes GitHub search results for "bili" repos
  - Filters out already-collected items
  - Opens new candidates in browser (batch mode)
  - Interactive pagination for large result sets

### Templates (`src/templates/`)

Template files for code generation:

- **`raw.user.js`**: Tampermonkey userscript template
  - Contains placeholder `__addedItem__` 
  - Populated by updateUser.js with current project list
  - Filters GitHub/GreasyFork search results to hide known projects

## Import Patterns

### Using Core Modules

**Recommended** - Use the unified core index:
```javascript
const { 
  checkItems, 
  loadTrackedItems, 
  validateItem, 
  addIcon 
} = require('../core');
```

**Alternative** - Direct module imports (for tree-shaking clarity):
```javascript
const { checkItems } = require('../core/link-check-core');
const { loadTrackedItems } = require('../core/repo-data');
const { addIcon } = require('../core/addIcon');
```

### Adding New Scripts

1. **Determine category**:
   - Content generation → `generators/`
   - Utility/helper → `tools/`
   - Shared logic → `core/`

2. **Use core imports**:
   ```javascript
   const { loadYamlArray, checkItems } = require('../core');
   ```

3. **Add to package.json** if it should be runnable:
   ```json
   "scripts": {
     "my:new-script": "node src/generators/my-script.js"
   }
   ```

4. **Update this README** if adding a new module or changing structure

## Migration Notes

### From Old Structure

The src directory was reorganized on 2026-04-07:

**Before:**
```
src/
├── maintain.js
├── check-pr.js
├── link-check-core.js
├── utils/
│   ├── repo-data.js
│   └── addIcon.js
└── ... (flat structure)
```

**After:**
```
src/
├── core/           # All utilities
├── generators/     # Main scripts
├── tools/          # Standalone tools
└── templates/      # Template files
```

**Import path changes:**
- `require('./utils/repo-data')` → `require('../core/repo-data')` or `require('../core')`
- `require('./link-check-core')` → `require('../core/link-check-core')` or `require('../core')`
- `require('./addIcon')` → `require('../core/addIcon')` or `require('../core')`

All active workflows have been updated to use new paths.

## Available NPM Scripts

See [package.json](../package.json) for full list:

```bash
pnpm run maintain              # Full maintenance (README + CHANGELOG)
pnpm run maintain:readme       # Refresh README and user.js
pnpm run maintain:cleanup      # Remove duplicates and dead links
pnpm run check:yaml            # Validate YAML syntax
pnpm run check:pr              # Validate PR changes
pnpm run tools:link-check      # Manual comprehensive link check
pnpm run tools:double-link-check  # Quick duplicate scan
pnpm run tools:get-items       # Discover new projects
```

## Best Practices

1. **Always use core/index.js** for imports unless you need specific module isolation
2. **Never manually edit** `src/user.js` - it's auto-generated
3. **Test locally** before committing: `pnpm run check:yaml && pnpm run maintain`
4. **Keep generators pure** - they should read YAML and output files, no side effects
5. **Document new tools** in this README when adding to `tools/`
6. **Use concurrent patterns** from link-check-core.js for any batch operations
