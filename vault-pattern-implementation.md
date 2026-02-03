# Vault Pattern Implementation for Safe Configuration Management

This document describes the robust implementation of the Vault pattern for safe configuration management in the Jaggers Agent Tools CLI. The implementation ensures that configuration files are never corrupted during updates, even in the event of crashes or power failures.

## Key Features

### 1. Atomic File Operations
- Uses temporary files with unique names during writes
- Leverages OS-level atomic `rename()` operations to replace original files
- Automatic cleanup of temporary files on failure
- Verification of file integrity after write operations

### 2. Protected Key Preservation
- Predefined set of protected configuration keys that are never overwritten
- Preserves user-customized settings during configuration updates
- Maintains user permissions, hooks, model preferences, plugin settings, and API keys

### 3. Backup Creation
- Optional automatic backup creation before successful updates
- Preserves history of configuration changes
- Easy rollback capability

### 4. Dry Run Mode
- Preview sync operations without making actual changes
- Shows which protected keys would be preserved
- Reports new non-conflicting configurations that would be added

### 5. Enhanced Messaging
- Clear indication when protected keys like mcpServers are preserved
- Notification of new non-conflicting servers added from repository
- Visual distinction between actual and dry-run operations

### 6. Error Handling
- Comprehensive error handling for file system operations
- Graceful degradation when operations fail
- Temporary file cleanup on all error conditions

## Protected Keys

The following configuration keys are protected and will not be overwritten during sync operations:

- `permissions.allow` - User-defined permissions
- `hooks.UserPromptSubmit` - User-defined hooks
- `hooks.SessionStart` - User-defined hooks
- `hooks.PreToolUse` - User-defined hooks
- `enabledPlugins` - User-enabled/disabled plugins
- `model` - User's preferred model
- `skillSuggestions.enabled` - User preferences

## Usage

### Reading Configuration Safely
```javascript
import { safeReadConfig } from './lib/atomic-config.js';

const config = await safeReadConfig('/path/to/settings.json');
```

### Merging Configuration Safely
```javascript
import { safeMergeConfig } from './lib/atomic-config.js';

const repoConfig = { /* configuration from repository */ };
const mergeResult = await safeMergeConfig(
  '/path/to/local/settings.json',
  repoConfig,
  {
    backupOnSuccess: true,    // Create backup on successful update
    preserveComments: true,   // Preserve JSON comments if present
    dryRun: false             // Perform actual write (set to true for dry run)
  }
);

console.log(`Configuration was updated: ${mergeResult.updated}`);
console.log(`Changes made:`, mergeResult.changes);
```

### Atomic File Writing
```javascript
import { atomicWrite } from './lib/atomic-config.js';

await atomicWrite('/path/to/file.json', data, {
  preserveComments: true,     // Use comment-json for serialization
  backupOnSuccess: true       // Create backup of original file
});
```

## Implementation Details

### Atomic Write Process
1. Generate unique temporary filename using timestamp and random string
2. Write data to temporary file
3. Verify file was written correctly (non-zero size)
4. Optionally create backup of original file
5. Atomically rename temporary file to target filename
6. On failure, clean up temporary file

### Safe Merge Process
1. Read current local configuration
2. Extract values for protected keys from local config
3. Perform merge of repository config with local config (preserving non-protected values)
4. Restore protected values from step 2
5. Compare original and merged configs
6. If different, atomically write merged config to file

### Protected Key Logic
- A key is considered protected if it matches any entry in the protected keys list
- Protected keys are only preserved if they exist in the original configuration
- If a protected key doesn't exist in the original config, it's safe to add from the repository

## Testing

The implementation includes comprehensive tests to verify:
- Safe reading of configuration files
- Atomic write operations
- Proper preservation of protected keys
- Backup creation functionality
- Behavior with empty configurations
- Error handling and cleanup

Run tests with:
```bash
node lib/atomic-config.test.js
```

## Integration with Existing Code

The safe configuration handling can be integrated into the existing sync process by replacing direct file operations with the safe methods. The `sync-safe.js` file provides an example implementation showing how to integrate the atomic config operations with the existing sync logic.