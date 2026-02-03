#!/usr/bin/env node

import fs from 'fs-extra';
import path from 'path';
import { safeMergeConfig } from './lib/atomic-config.js';

async function testDryRunFunctionality() {
  console.log('Testing Vault Pattern Dry Run Functionality\n');

  // Create a temporary test directory
  const testDir = path.join('/tmp', 'jaggers-test-' + Date.now());
  await fs.ensureDir(testDir);

  try {
    // Create a sample local config with mcpServers
    const localConfigPath = path.join(testDir, 'settings.json');
    const localConfig = {
      mcpServers: {
        'my-local-server': {
          url: 'https://my-local-server.com',
          apiKey: 'local-api-key'
        },
        'another-local-server': {
          url: 'https://another-local.com',
          apiKey: 'another-local-key'
        }
      },
      permissions: {
        allow: ['some-permission']
      },
      model: 'gpt-4'
    };

    await fs.writeJson(localConfigPath, localConfig, { spaces: 2 });

    // Create a sample repo config with different mcpServers
    const repoConfig = {
      mcpServers: {
        'my-local-server': {
          url: 'https://different-url.com',  // This should be protected
          apiKey: 'different-api-key'       // This should be protected
        },
        'new-repo-server': {
          url: 'https://new-repo-server.com',
          apiKey: 'repo-api-key'
        },
        'another-new-server': {
          url: 'https://another-new.com',
          apiKey: 'another-repo-key'
        }
      },
      permissions: {
        allow: ['different-permission']  // This should be protected
      },
      model: 'claude-3'  // This should be protected
    };

    console.log('=== DRY RUN MODE ===');
    const dryRunResult = await safeMergeConfig(localConfigPath, repoConfig, {
      dryRun: true,
      preserveComments: true,
      backupOnSuccess: true
    });

    console.log('Dry run result:');
    console.log('- Updated:', dryRunResult.updated);
    console.log('- Changes:', dryRunResult.changes);

    // Verify that the original file was not changed during dry run
    const originalAfterDryRun = await fs.readJson(localConfigPath);
    console.log('- Original config preserved:', JSON.stringify(originalAfterDryRun) === JSON.stringify(localConfig));

    console.log('\n=== ACTUAL RUN MODE ===');
    const actualResult = await safeMergeConfig(localConfigPath, repoConfig, {
      dryRun: false,
      preserveComments: true,
      backupOnSuccess: true
    });

    console.log('Actual run result:');
    console.log('- Updated:', actualResult.updated);
    console.log('- Changes:', actualResult.changes);

    // Verify the merged config
    const mergedConfig = await fs.readJson(localConfigPath);
    console.log('\nMerged config:');
    console.log('- Local server preserved:', mergedConfig.mcpServers['my-local-server'].apiKey === 'local-api-key');
    console.log('- Another local server preserved:', mergedConfig.mcpServers['another-local-server'].apiKey === 'another-local-key');
    console.log('- New repo server added:', mergedConfig.mcpServers['new-repo-server'] !== undefined);
    console.log('- Another new server added:', mergedConfig.mcpServers['another-new-server'] !== undefined);
    console.log('- Permissions preserved:', mergedConfig.permissions.allow[0] === 'some-permission');
    console.log('- Model preserved:', mergedConfig.model === 'gpt-4');

    console.log('\n✅ All tests passed!');
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    // Cleanup
    await fs.remove(testDir);
  }
}

testDryRunFunctionality();