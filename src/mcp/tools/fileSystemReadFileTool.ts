import fs from 'node:fs/promises';
import path from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { SuspiciousFileResult } from '../../core/security/securityCheck.js';
import { createSecretLintConfig, runSecretLint } from '../../core/security/workers/securityCheckWorker.js';
import { logger } from '../../shared/logger.js';
import { buildMcpToolErrorResponse, buildMcpToolSuccessResponse } from './mcpToolRuntime.js';

/**
 * Register file system read file tool with security checks
 */
export const registerFileSystemReadFileTool = (mcpServer: McpServer) => {
  mcpServer.tool(
    'file_system_read_file',
    'Read a file from the local file system using an absolute path. Includes built-in security validation to detect and prevent access to files containing sensitive information (API keys, passwords, secrets).',
    {
      path: z.string().describe('Absolute path to the file to read'),
    },
    {
      title: 'Read File',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async ({ path: filePath }): Promise<CallToolResult> => {
      try {
        logger.trace(`Reading file at absolute path: ${filePath}`);

        // Ensure path is absolute
        if (!path.isAbsolute(filePath)) {
          return buildMcpToolErrorResponse([`Error: Path must be absolute. Received: ${filePath}`]);
        }

        // Check if file exists
        try {
          await fs.access(filePath);
        } catch {
          return buildMcpToolErrorResponse([`Error: File not found at path: ${filePath}`]);
        }

        // Check if it's a directory
        const stats = await fs.stat(filePath);
        if (stats.isDirectory()) {
          return buildMcpToolErrorResponse([
            `Error: The specified path is a directory, not a file: ${filePath}. Use file_system_read_directory for directories.`,
          ]);
        }

        // Read file content
        const fileContent = await fs.readFile(filePath, 'utf8');

        // Perform security check using the existing worker
        const config = createSecretLintConfig();
        const securityCheckResult = await runSecretLint(filePath, fileContent, 'file', config);

        // If security check found issues, block the file
        if (securityCheckResult !== null) {
          return buildMcpToolErrorResponse([
            `Error: Security check failed. The file at ${filePath} may contain sensitive information.`,
          ]);
        }

        return buildMcpToolSuccessResponse([`Content of ${filePath}:`, fileContent]);
      } catch (error) {
        logger.error(`Error in file_system_read_file tool: ${error}`);
        return buildMcpToolErrorResponse([
          `Error reading file: ${error instanceof Error ? error.message : String(error)}`,
        ]);
      }
    },
  );
};
