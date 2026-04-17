#!/usr/bin/env node

import { Command } from 'commander';
import { startCommand } from './commands/start.js';
import { stopCommand } from './commands/stop.js';
import { statusCommand } from './commands/status.js';

const program = new Command();

program
  .name('ducky')
  .description('AI Usage Tracker CLI — passively monitors AI tool usage in your dev environment')
  .version('1.0.0');

program
  .command('start')
  .description('Begin tracking AI usage in the current project directory')
  .action(startCommand);

program
  .command('stop')
  .description('Stop tracking and generate ducky-report.json in the project root')
  .action(stopCommand);

program
  .command('status')
  .description('Show current tracking session status')
  .action(statusCommand);

program.parse();
