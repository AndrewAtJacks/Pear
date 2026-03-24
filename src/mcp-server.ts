#!/usr/bin/env node
// Pear Language MCP Server
// Exposes pear_to_c, c_to_pear, and pear_compile tools via MCP stdio transport

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { pearToC, cToPear, compileToBinary } from './compiler';
import { Interpreter } from './interpreter';

// ─── Tool Definitions ─────────────────────────────────────────────────────────

const TOOLS: Tool[] = [
  {
    name: 'pear_to_c',
    description: 'Compile Pear source code to C source code. Pear is an ultra-minified low-level language that transpiles to C.',
    inputSchema: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'Pear source code to compile',
        },
      },
      required: ['code'],
    },
  },
  {
    name: 'c_to_pear',
    description: 'Decompile/minify C source code to Pear source code. Best-effort transformation that replaces types, keywords, and converts declarations.',
    inputSchema: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'C source code to decompile to Pear',
        },
      },
      required: ['code'],
    },
  },
  {
    name: 'pear_run',
    description: 'Interpret and run Pear source code directly in Node.js without a C compiler. Returns the output as a string.',
    inputSchema: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'Pear source code to interpret and run',
        },
        args: {
          type: 'array',
          items: { type: 'string' },
          description: 'Command-line arguments to pass to the program',
        },
        stdin: {
          type: 'string',
          description: 'Optional stdin input for the program',
        },
      },
      required: ['code'],
    },
  },
  {
    name: 'pear_compile',
    description: 'Compile Pear source code all the way to a binary executable using gcc or clang. Writes the output binary to the specified path.',
    inputSchema: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'Pear source code to compile to binary',
        },
        output_file: {
          type: 'string',
          description: 'Output file path for the compiled binary',
        },
        compiler: {
          type: 'string',
          description: 'C compiler to use (gcc, clang, etc.). Defaults to auto-detect.',
        },
        flags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Additional compiler flags. Defaults to ["-std=c99", "-Wall", "-O2"].',
        },
      },
      required: ['code', 'output_file'],
    },
  },
];

// ─── Server Setup ─────────────────────────────────────────────────────────────

const server = new Server(
  {
    name: 'pear-lang',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List tools handler
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOLS };
});

// Call tool handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case 'pear_run': {
      const code = args?.code as string;
      const runArgs = (args?.args as string[] | undefined) ?? [];
      const stdinData = args?.stdin as string | undefined;
      if (!code) {
        return {
          content: [{ type: 'text', text: 'Error: code parameter is required' }],
          isError: true,
        };
      }
      try {
        const interp = new Interpreter({ captureOutput: true, stdin: stdinData });
        const result = interp.run(code, runArgs);
        const text = JSON.stringify({
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
        }, null, 2);
        return { content: [{ type: 'text', text }] };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Runtime error: ${err}` }],
          isError: true,
        };
      }
    }

    case 'pear_to_c': {
      const code = args?.code as string;
      if (!code) {
        return {
          content: [{ type: 'text', text: 'Error: code parameter is required' }],
          isError: true,
        };
      }
      try {
        const cCode = pearToC(code);
        return {
          content: [{ type: 'text', text: cCode }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Compilation error: ${err}` }],
          isError: true,
        };
      }
    }

    case 'c_to_pear': {
      const code = args?.code as string;
      if (!code) {
        return {
          content: [{ type: 'text', text: 'Error: code parameter is required' }],
          isError: true,
        };
      }
      try {
        const pearCode = cToPear(code);
        return {
          content: [{ type: 'text', text: pearCode }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Decompilation error: ${err}` }],
          isError: true,
        };
      }
    }

    case 'pear_compile': {
      const code = args?.code as string;
      const outputFile = args?.output_file as string;
      const compiler = args?.compiler as string | undefined;
      const flags = args?.flags as string[] | undefined;

      if (!code || !outputFile) {
        return {
          content: [{ type: 'text', text: 'Error: code and output_file parameters are required' }],
          isError: true,
        };
      }

      const result = compileToBinary(code, outputFile, {
        compiler,
        flags,
      });

      if (result.success) {
        return {
          content: [{
            type: 'text',
            text: `Successfully compiled to binary: ${outputFile}\n\nGenerated C code:\n${result.output}`,
          }],
        };
      } else {
        return {
          content: [{
            type: 'text',
            text: `Compilation failed: ${result.error}\n\nGenerated C code:\n${result.output}`,
          }],
          isError: true,
        };
      }
    }

    default:
      return {
        content: [{ type: 'text', text: `Unknown tool: ${name}` }],
        isError: true,
      };
  }
});

// ─── Start Server ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Server runs until stdin closes
}

main().catch((err) => {
  console.error('MCP server error:', err);
  process.exit(1);
});
