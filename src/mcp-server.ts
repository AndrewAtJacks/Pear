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

// ─── Language Spec (embedded for reliable delivery regardless of CWD) ──────────

const PEAR_SPEC = `# Pear Language Specification

## Purpose

Pear exists to reduce LLM token consumption on low-level code. Every token spent on boilerplate
(return types, long keywords, verbose declarations) is a token not spent on reasoning. Pear lets
you write real, executable C-level code at ~35–50% of the token cost of idiomatic C.

**The workflow:**
1. Write code in Pear (dense, token-efficient)
2. Use \`pear_run\` to test it inline — no compiler needed
3. Use \`pear_to_c\` to inspect or ship the generated C
4. Use \`pear_compile\` when you need a native binary

**Use Pear when:** generating, reviewing, or iterating on systems code with an LLM in the loop.
**Do not use Pear when:** the code is being written once and never touched by an LLM again — just write C.

Pear is an ultra-minified low-level language that transpiles to C. Goal: maximum token density.
File extension: \`.pr\`

## Types

| Pear | C |
|------|---|
| i8 i16 i32 i64 | int8_t int16_t int32_t int64_t |
| u8 u16 u32 u64 | uint8_t uint16_t uint32_t uint64_t |
| f32 f64 | float double |
| v | void |
| c | char |
| b | bool |
| sz | size_t |
| *T | pointer to T |
| T[] | array (= *T) |

## Keywords

| Pear | C |
|------|---|
| fn | function definition |
| st | struct |
| un | union |
| en | enum |
| tp | typedef |
| if ei el | if / else if / else |
| lp | for |
| wh | while |
| dw | do...while |
| sw cs dv | switch / case / default |
| rt | return |
| bk ct | break / continue |
| gt | goto |
| sc ex in vl cn | static / extern / inline / volatile / const |
| im | #include |
| df | #define |
| nd | #ifndef guard |
| dn | #endif |
| pr | #pragma |
| so | sizeof |

## Syntax

\`\`\`pear
// Variable declaration
name:type
name:type=value
name:type[size]        // array

// Function
fn name(param:type,...)->rettype{...}
fn name(param:type,...){...}         // void return

// Control flow
if(cond){...}
if(cond){...}ei(cond){...}el{...}
lp(i:i32=0;i<n;i++){...}
wh(cond){...}
dw{...}wh(cond)
sw(expr){cs val:{...}bk dv:{...}}

// Struct / Union / Enum
st Name{field:type;...}
un Name{field:type;...}
en Name{A,B,C=10}
tp st Name{...} Name    // typedef struct
tp i32 MyInt            // typedef scalar

// Preprocessor
im<stdio.h>             // #include <stdio.h>
im"myfile.h"            // #include "myfile.h"
df NAME value           // #define NAME value
df NAME(a) (a*2)        // function-like macro
nd GUARD_H              // #ifndef GUARD_H + #define GUARD_H
dn                      // #endif
pr once                 // #pragma once

// Pointers
p:*i32=&x              // pointer declaration
*p=42                  // dereference
p->field               // arrow access

// Cast & sizeof
(i32)someFloat
(*i32)malloc(n*so(i32))
so(i32)                // sizeof(int32_t)

// Ternary
x>0?x:-x
\`\`\`

## Auto-Injected Headers

The compiler automatically prepends:
- \`#include <stdint.h>\` when integer types (i8/i16/i32/i64/u8/u16/u32/u64) are used
- \`#include <stdbool.h>\` when \`b\` (bool) is used

## Examples

### Hello World
\`\`\`pear
im<stdio.h>
fn main()->i32{printf("Hello, World!\\n");rt 0}
\`\`\`
Compiles to:
\`\`\`c
#include <stdio.h>
int main(){printf("Hello, World!\\n");return 0;}
\`\`\`

### Struct + Function
\`\`\`pear
im<math.h>
st Point{x:f64;y:f64}
fn dist(a:*Point,b:*Point)->f64{dx:f64=a->x-b->x;dy:f64=a->y-b->y;rt sqrt(dx*dx+dy*dy)}
fn main()->i32{p1:Point={1.0,2.0};p2:Point={4.0,6.0};printf("%f\\n",dist(&p1,&p2));rt 0}
\`\`\`

### Pointer Arithmetic
\`\`\`pear
im<stdio.h>
fn swap(a:*i32,b:*i32){tmp:i32=*a;*a=*b;*b=tmp}
fn sum_array(arr:*i32,n:i32)->i32{total:i32=0;lp(i:i32=0;i<n;i++){total+=arr[i]};rt total}
fn main()->i32{x:i32=10;y:i32=20;swap(&x,&y);printf("%d %d\\n",x,y);rt 0}
\`\`\`

### Dynamic Memory
\`\`\`pear
im<stdio.h>
im<stdlib.h>
fn main()->i32{
  n:i32=5
  arr:*i32=(*i32)malloc(n*so(i32))
  lp(i:i32=0;i<n;i++){arr[i]=i*i}
  lp(i:i32=0;i<n;i++){printf("%d\\n",arr[i])}
  free(arr)
  rt 0
}
\`\`\`

## MCP Tools

| Tool | Description |
|------|-------------|
| pear_spec | Get this spec (call first to learn the language) |
| pear_to_c | Compile Pear source → C source |
| c_to_pear | Minify/decompile C source → Pear |
| pear_run | Interpret and run Pear directly, returns stdout/stderr |
| pear_compile | Compile Pear → native binary via gcc/clang |

## Token Savings

Pear reduces token count ~35–50% vs idiomatic C:
- \`fn\` instead of return-type + function name pattern
- \`i32\` instead of \`int32_t\`, \`f64\` instead of \`double\`
- \`lp\` instead of \`for\`, \`rt\` instead of \`return\`
- No semicolons required at statement end (optional)
- Compact variable declarations: \`x:i32=5\` instead of \`int32_t x = 5;\`
`;

// ─── Tool Definitions ─────────────────────────────────────────────────────────

const TOOLS: Tool[] = [
  {
    name: 'pear_spec',
    description: 'Get the complete Pear language specification. Call this first before writing any Pear code — it returns all types, keywords, syntax rules, and examples needed to write valid Pear.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
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
    case 'pear_spec': {
      return { content: [{ type: 'text', text: PEAR_SPEC }] };
    }

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
