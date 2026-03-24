#!/usr/bin/env node
// Pear Language Compiler - Main CLI
// Usage:
//   pearc <file.pr>              → print C output
//   pearc <file.pr> -o <out.c>  → write C to file
//   pearc <file.pr> --binary -o <out>  → compile to binary via gcc/clang
//   pearc --decompile <file.c>  → decompile C to Pear
//   pearc --decompile <file.c> -o <out.pr>

import * as fs from 'fs';
import * as path from 'path';
import * as child_process from 'child_process';
import { parse } from './parser';
import { generate } from './codegen';
import { decompile } from './decompiler';
import { interpret, Interpreter } from './interpreter';

export function pearToC(source: string): string {
  const ast = parse(source);
  return generate(ast);
}

export function cToPear(cSource: string): string {
  return decompile(cSource);
}

export function compileToC(source: string): { c: string; error?: string } {
  try {
    const c = pearToC(source);
    return { c };
  } catch (err) {
    return { c: '', error: String(err) };
  }
}

export function compileToBinary(
  pearSource: string,
  outputFile: string,
  options: { compiler?: string; flags?: string[] } = {}
): { success: boolean; output: string; error?: string } {
  // Step 1: Pear → C
  let cSource: string;
  try {
    cSource = pearToC(pearSource);
  } catch (err) {
    return { success: false, output: '', error: `Pear parse error: ${err}` };
  }

  // Step 2: Write C to temp file (use OS temp dir for cross-platform compat)
  const os = require('os');
  const tmpC = path.join(os.tmpdir(), `pear_${Date.now()}.tmp.c`);
  try {
    fs.writeFileSync(tmpC, cSource, 'utf8');
  } catch (err) {
    return { success: false, output: '', error: `Failed to write temp file: ${err}` };
  }

  // Step 3: Find and invoke compiler
  const compiler = options.compiler ?? findCompiler();
  if (!compiler) {
    fs.unlinkSync(tmpC);
    return {
      success: false,
      output: cSource,
      error: 'No C compiler found. Options:\n' +
        '  - Install MinGW/MSYS2 and add gcc to PATH\n' +
        '  - Run from a VS Developer Command Prompt (cl.exe)\n' +
        '  - Use: npm run compile -- file.pr > out.c  then compile out.c manually'
    };
  }

  // MSVC sentinel: "msvc:<clPath>:<vcvarsPath>"
  if (compiler.startsWith('msvc\x00')) {
    const [, clPath, vcvarsPath] = compiler.split('\x00');
    // Convert Unix-style paths to Windows paths for cmd.exe
    const toWin = (p: string) => p.replace(/\//g, '\\');
    const winTmpC = toWin(tmpC);
    const winOut = toWin(outputFile.endsWith('.exe') ? outputFile : outputFile + '.exe');
    const winCl = toWin(clPath);
    const winVcvars = toWin(vcvarsPath);

    // cmd /c requires outer quotes when inner command path is quoted
    const shellCmd = `call "${winVcvars}" x64 && "${winCl}" /nologo /W3 /O2 "${winTmpC}" /Fe:"${winOut}"`;
    try {
      const result = child_process.spawnSync(shellCmd, [], {
        shell: true,
        encoding: 'utf8', timeout: 60000,
      });
      fs.unlinkSync(tmpC);
      // cl.exe also leaves a .obj file in cwd
      try { fs.unlinkSync(tmpC.replace(/\.c$/, '.obj')); } catch { /* ok */ }
      if (result.status === 0) {
        return { success: true, output: cSource };
      }
      return { success: false, output: cSource, error: result.stderr || result.stdout || `cl.exe exited ${result.status}` };
    } catch (err) {
      try { fs.unlinkSync(tmpC); } catch { /* ok */ }
      return { success: false, output: cSource, error: `MSVC execution failed: ${err}` };
    }
  }

  const flags = options.flags ?? ['-std=c99', '-Wall', '-O2'];
  const args = [...flags, tmpC, '-o', outputFile];

  try {
    const result = child_process.spawnSync(compiler, args, {
      encoding: 'utf8',
      timeout: 30000,
    });

    fs.unlinkSync(tmpC);

    if (result.status === 0) {
      return { success: true, output: cSource };
    } else {
      return {
        success: false,
        output: cSource,
        error: (result.stderr || result.stdout || `Compiler exited with code ${result.status}`),
      };
    }
  } catch (err) {
    try { fs.unlinkSync(tmpC); } catch { /* ignore */ }
    return { success: false, output: cSource, error: `Compiler execution failed: ${err}` };
  }
}

function findCompiler(): string | null {
  // Try common Unix compilers first
  for (const cc of ['gcc', 'clang', 'cc']) {
    try {
      const result = child_process.spawnSync(cc, ['--version'], { encoding: 'utf8', timeout: 5000 });
      if (result.status === 0) return cc;
    } catch { /* not found */ }
  }

  // On Windows, try to find MSVC cl.exe via vswhere
  if (process.platform === 'win32') {
    // Try tcc (Tiny C Compiler) — lightweight, no env setup needed
    try {
      const tcc = child_process.spawnSync('tcc', ['-v'], { encoding: 'utf8', timeout: 5000 });
      if (tcc.status === 0) return 'tcc';
    } catch { /* not found */ }

    // Try MSVC via vswhere — returns 'msvc:<clPath>:<vcvarsPath>' sentinel
    const vswhere = 'C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe';
    try {
      const clResult = child_process.spawnSync(vswhere, [
        '-latest', '-products', '*', '-find', '**\\HostX64\\x64\\cl.exe'
      ], { encoding: 'utf8', timeout: 10000 });

      const vcvarsResult = child_process.spawnSync(vswhere, [
        '-latest', '-products', '*', '-find', '**\\vcvarsall.bat'
      ], { encoding: 'utf8', timeout: 10000 });

      if (clResult.status === 0 && clResult.stdout.trim() &&
          vcvarsResult.status === 0 && vcvarsResult.stdout.trim()) {
        // Use last entry = newest toolset
        const clLines = clResult.stdout.trim().split('\n').map((l: string) => l.trim()).filter(Boolean);
        const vcLines = vcvarsResult.stdout.trim().split('\n').map((l: string) => l.trim()).filter(Boolean);
        const clPath = clLines[clLines.length - 1];
        const vcvarsPath = vcLines[vcLines.length - 1];
        // Return a sentinel that compileToBinary recognises
        return `msvc\x00${clPath}\x00${vcvarsPath}`;
      }
    } catch { /* vswhere not found */ }
  }

  return null;
}

export function runInterpreted(pearSource: string, argv?: string[]): number {
  return interpret(pearSource, argv);
}

export function runPear(
  pearSource: string,
  args: string[] = [],
  options: { compiler?: string } = {}
): { exitCode: number; error?: string } {
  const os = require('os');
  const ext = process.platform === 'win32' ? '.exe' : '';
  const tmpBin = path.join(os.tmpdir(), `pear_run_${Date.now()}${ext}`);

  const compiled = compileToBinary(pearSource, tmpBin, options);
  if (!compiled.success) {
    return { exitCode: 1, error: compiled.error };
  }

  const actualBin = process.platform === 'win32' && !tmpBin.endsWith('.exe')
    ? tmpBin + '.exe'
    : tmpBin;

  try {
    // Inherit stdio so output goes directly to terminal
    const result = child_process.spawnSync(actualBin, args, {
      stdio: 'inherit',
      timeout: 30000,
    });
    return { exitCode: result.status ?? 1 };
  } catch (err) {
    return { exitCode: 1, error: `Execution failed: ${err}` };
  } finally {
    try { fs.unlinkSync(actualBin); } catch { /* ok */ }
  }
}

// ─── CLI Entry Point ─────────────────────────────────────────────────────────

function main(): void {
  const args = process.argv.slice(2);

  // Start MCP server
  if (args[0] === '--mcp') {
    require('./mcp-server');
    return;
  }

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(`Pear Language Compiler v0.1.0
Usage:
  pearc <file.pr>                      Compile Pear to C (print to stdout)
  pearc <file.pr> -o <out.c>           Compile Pear to C file
  pearc <file.pr> --binary -o <out>    Compile Pear to binary via gcc/clang
  pearc run <file.pr> [args...]        Interpret and run Pear directly
  pearc --decompile <file.c>           Decompile C to Pear (print to stdout)
  pearc --decompile <file.c> -o <out.pr>  Decompile C to Pear file

Options:
  -o <file>      Output file
  --binary       Compile all the way to binary (requires gcc or clang)
  --decompile    Run decompiler (C → Pear) instead of compiler
  --run, -r      Interpret and run Pear directly (same as run subcommand)
  -h, --help     Show this help
`);
    process.exit(0);
  }

  // Handle 'run' subcommand: pearc run <file.pr> [args...]
  if (args[0] === 'run' || args[0] === '--run' || args[0] === '-r') {
    const fileArgStart = (args[0] === 'run' || args[0] === '--run' || args[0] === '-r') ? 1 : 0;
    const fileArg = args[fileArgStart];
    if (!fileArg) {
      console.error('Error: No input file specified for run');
      process.exit(1);
    }
    const inputPath = path.resolve(process.cwd(), fileArg);
    if (!fs.existsSync(inputPath)) {
      console.error(`Error: File not found: ${inputPath}`);
      process.exit(1);
    }
    const source = fs.readFileSync(inputPath, 'utf8');
    const programArgs = args.slice(fileArgStart + 1);
    const exitCode = interpret(source, programArgs);
    process.exit(exitCode);
  }

  let decompileMode = false;
  let binaryMode = false;
  let inputFile = '';
  let outputFile = '';

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--decompile') {
      decompileMode = true;
    } else if (arg === '--binary') {
      binaryMode = true;
    } else if (arg === '-o') {
      outputFile = args[++i];
    } else if (!arg.startsWith('-')) {
      inputFile = arg;
    }
  }

  if (!inputFile) {
    console.error('Error: No input file specified');
    process.exit(1);
  }

  // Resolve relative to cwd
  const inputPath = path.resolve(process.cwd(), inputFile);

  if (!fs.existsSync(inputPath)) {
    console.error(`Error: File not found: ${inputPath}`);
    process.exit(1);
  }

  const source = fs.readFileSync(inputPath, 'utf8');

  if (decompileMode) {
    // C → Pear
    const pearCode = cToPear(source);
    if (outputFile) {
      fs.writeFileSync(path.resolve(process.cwd(), outputFile), pearCode, 'utf8');
      console.log(`Decompiled to ${outputFile}`);
    } else {
      console.log(pearCode);
    }
  } else if (binaryMode) {
    // Pear → binary
    if (!outputFile) {
      outputFile = path.basename(inputPath, '.pr');
    }
    const result = compileToBinary(source, path.resolve(process.cwd(), outputFile));
    if (result.success) {
      console.log(`Compiled to binary: ${outputFile}`);
    } else {
      console.error('Compilation failed:');
      if (result.error) console.error(result.error);
      if (result.output) {
        console.error('\nGenerated C code:');
        console.error(result.output);
      }
      process.exit(1);
    }
  } else {
    // Pear → C
    let cCode: string;
    try {
      cCode = pearToC(source);
    } catch (err) {
      console.error(`Compilation error: ${err}`);
      process.exit(1);
    }

    if (outputFile) {
      fs.writeFileSync(path.resolve(process.cwd(), outputFile), cCode, 'utf8');
      console.log(`Compiled to ${outputFile}`);
    } else {
      process.stdout.write(cCode);
    }
  }
}

// Run main only when executed directly
if (require.main === module) {
  main();
}
