#!/usr/bin/env node
// Claude Code Statusline - GSD Edition with Starship integration
// Shows: model | current task | directory | git | venv | context usage

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

// Read JSON from stdin
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    const model = data.model?.display_name || 'Claude';
    const dir = data.workspace?.current_dir || process.cwd();
    const session = data.session_id || '';
    const remaining = data.context_window?.remaining_percentage;

    // Context window display (shows USED percentage)
    let ctx = '';
    if (remaining != null) {
      const rem = Math.round(remaining);
      const used = 100 - rem;

      // Build progress bar (10 segments)
      const filled = Math.floor(used / 10);
      const bar = '█'.repeat(filled) + '░'.repeat(10 - filled);

      // Color based on usage
      if (used < 50) {
        ctx = ` \x1b[32m${bar} ${used}%\x1b[0m`;
      } else if (used < 65) {
        ctx = ` \x1b[33m${bar} ${used}%\x1b[0m`;
      } else if (used < 80) {
        ctx = ` \x1b[38;5;208m${bar} ${used}%\x1b[0m`;
      } else {
        ctx = ` \x1b[5;31m💀 ${bar} ${used}%\x1b[0m`;
      }
    }

    // Current task from todos
    let task = '';
    const homeDir = os.homedir();
    const todosDir = path.join(homeDir, '.claude', 'todos');
    if (session && fs.existsSync(todosDir)) {
      const files = fs.readdirSync(todosDir)
        .filter(f => f.startsWith(session) && f.includes('-agent-') && f.endsWith('.json'))
        .map(f => ({ name: f, mtime: fs.statSync(path.join(todosDir, f)).mtime }))
        .sort((a, b) => b.mtime - a.mtime);

      if (files.length > 0) {
        try {
          const todos = JSON.parse(fs.readFileSync(path.join(todosDir, files[0].name), 'utf8'));
          const inProgress = todos.find(t => t.status === 'in_progress');
          if (inProgress) task = inProgress.activeForm || '';
        } catch (e) {}
      }
    }

    // GSD update available?
    let gsdUpdate = '';
    const cacheFile = path.join(homeDir, '.claude', 'cache', 'gsd-update-check.json');
    if (fs.existsSync(cacheFile)) {
      try {
        const cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
        if (cache.update_available) {
          gsdUpdate = '\x1b[33m⬆ /gsd:update\x1b[0m │ ';
        }
      } catch (e) {}
    }

    // Git info (from Starship config)
    let gitInfo = '';
    try {
      const branch = execSync('git rev-parse --abbrev-ref HEAD 2>/dev/null', { cwd: dir, encoding: 'utf8' }).trim();
      if (branch && branch !== 'HEAD') {
        gitInfo = `\x1b[38;5;109m\uf1d3 \ue0a0 ${branch}\x1b[0m`;

        // Git status
        try {
          const status = execSync('git status --porcelain 2>/dev/null', { cwd: dir, encoding: 'utf8' });
          if (status.trim()) {
            const lines = status.trim().split('\n');
            const staged = lines.filter(l => l.startsWith('M ').match(/^M/)).length;
            const modified = lines.filter(l => l.match(/^M./)).length;
            const untracked = lines.filter(l => l.match(/^\?\?/)).length;
            const stashed = execSync('git stash list 2>/dev/null', { cwd: dir, encoding: 'utf8' }).trim().split('\n').length;

            const statusIcons = [];
            if (staged > 0) statusIcons.push(`\uf00c${staged}`);
            if (modified > 0) statusIcons.push(`\uf040${modified}`);
            if (untracked > 0) statusIcons.push(`\uf059${untracked}`);
            if (stashed > 0) statusIcons.push(`\uf448${stashed}`);

            if (statusIcons.length > 0) {
              gitInfo += ` \x1b[38;5;109m${statusIcons.join(' ')}\x1b[0m`;
            }
          }
        } catch (e) {}
      }
    } catch (e) {}

    // Python virtual environment (from Starship config)
    let venvInfo = '';
    const venvPath = process.env.VIRTUAL_ENV || process.env.CONDA_PREFIX;
    if (venvPath) {
      const venvName = path.basename(venvPath);
      venvInfo = ` \x1b[38;5;215m\ue73c ${venvName}\x1b[0m`;
    }

    // Output
    const dirname = path.basename(dir);
    let parts = [`\x1b[2m${model}\x1b[0m`];

    if (task) {
      parts.push(`\x1b[1m${task}\x1b[0m`);
    }

    parts.push(`\x1b[2m${dirname}\x1b[0m`);

    if (gitInfo) {
      parts.push(gitInfo);
    }

    if (venvInfo) {
      parts.push(venvInfo);
    }

    process.stdout.write(`${gsdUpdate}${parts.join(' ')}${ctx}`);
  } catch (e) {
    // Silent fail - don't break statusline on parse errors
  }
});
