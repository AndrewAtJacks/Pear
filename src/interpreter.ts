// Pear Language Tree-Walking Interpreter
// Executes Pear code directly in Node.js without a C compiler

import { parse } from './parser';
import {
  ASTNode, Program, FunctionDecl, StructDecl, UnionDecl, EnumDecl,
  VarDecl, BlockStmt, IfStmt, ForStmt, WhileStmt, DoWhileStmt,
  SwitchStmt, CaseStmt, DefaultStmt, ReturnStmt, BreakStmt,
  ContinueStmt, GotoStmt, LabelStmt, ExprStmt, TypeNode,
  Expr, NumberLiteral, StringLiteral, CharLiteral, BoolLiteral,
  NullLiteral, Identifier, BinaryExpr, UnaryExpr, PostfixExpr,
  AssignExpr, TernaryExpr, CallExpr, IndexExpr, MemberExpr,
  CastExpr, SizeofExpr, InitListExpr, FuncPtrExpr, TypedefDecl,
  DefineDirective,
} from './parser';

// ─── Runtime Values ──────────────────────────────────────────────────────────

type Value =
  | { tag: 'i64'; v: bigint }
  | { tag: 'f64'; v: number }
  | { tag: 'ptr'; addr: number; pointee?: string }
  | { tag: 'str'; s: string; addr: number }
  | { tag: 'void' }
  | { tag: 'bool'; v: boolean }
  | { tag: 'struct'; fields: Map<string, Value>; typeName: string }
  | { tag: 'array'; elements: Value[]; addr: number };

const VOID: Value = { tag: 'void' };

function mkInt(v: number | bigint): Value {
  return { tag: 'i64', v: typeof v === 'bigint' ? v : BigInt(Math.trunc(v)) };
}
function mkFloat(v: number): Value { return { tag: 'f64', v }; }
function mkBool(v: boolean): Value { return { tag: 'bool', v }; }
function mkPtr(addr: number, pointee?: string): Value { return { tag: 'ptr', addr, pointee }; }
function NULL_PTR(): Value { return { tag: 'ptr', addr: 0 }; }

function isTruthy(v: Value): boolean {
  switch (v.tag) {
    case 'i64': return v.v !== 0n;
    case 'f64': return v.v !== 0;
    case 'bool': return v.v;
    case 'ptr': return v.addr !== 0;
    case 'str': return v.addr !== 0;
    case 'void': return false;
    case 'struct': return true;
    case 'array': return true;
  }
}

function toNumber(v: Value): number {
  switch (v.tag) {
    case 'i64': return Number(v.v);
    case 'f64': return v.v;
    case 'bool': return v.v ? 1 : 0;
    case 'ptr': return v.addr;
    case 'str': return v.addr;
    case 'void': return 0;
    default: return 0;
  }
}

function toBigInt(v: Value): bigint {
  switch (v.tag) {
    case 'i64': return v.v;
    case 'f64': return BigInt(Math.trunc(v.v));
    case 'bool': return v.v ? 1n : 0n;
    case 'ptr': return BigInt(v.addr);
    case 'str': return BigInt(v.addr);
    default: return 0n;
  }
}

// ─── Control Flow Signals ─────────────────────────────────────────────────────

class ReturnSignal {
  constructor(public value: Value) {}
}
class BreakSignal {}
class ContinueSignal {}
class GotoSignal {
  constructor(public label: string) {}
}
class ExitSignal {
  constructor(public code: number) {}
}

// ─── Scope / Environment ──────────────────────────────────────────────────────

class Scope {
  private vars = new Map<string, Value>();
  constructor(public parent: Scope | null = null) {}

  get(name: string): Value | undefined {
    const v = this.vars.get(name);
    if (v !== undefined) return v;
    return this.parent?.get(name);
  }

  set(name: string, value: Value): void {
    this.vars.set(name, value);
  }

  assign(name: string, value: Value): boolean {
    if (this.vars.has(name)) {
      this.vars.set(name, value);
      return true;
    }
    return this.parent?.assign(name, value) ?? false;
  }

  has(name: string): boolean {
    return this.vars.has(name) || (this.parent?.has(name) ?? false);
  }
}

// ─── Heap / Memory ────────────────────────────────────────────────────────────

interface HeapBlock {
  data: Uint8Array;
  size: number;
}

class Heap {
  private blocks = new Map<number, HeapBlock>();
  private nextAddr = 0x10000;
  // String pool: string content → address
  private stringPool = new Map<string, number>();
  // Address → string content (for pointer-to-string reads)
  private addrToStr = new Map<number, string>();

  allocate(size: number): number {
    const addr = this.nextAddr;
    this.nextAddr += Math.max(size, 1) + 8; // 8 bytes alignment padding
    const data = new Uint8Array(size);
    this.blocks.set(addr, { data, size });
    return addr;
  }

  reallocate(addr: number, newSize: number): number {
    const block = this.blocks.get(addr);
    if (!block) return this.allocate(newSize);
    const newAddr = this.allocate(newSize);
    const newBlock = this.blocks.get(newAddr)!;
    newBlock.data.set(block.data.slice(0, Math.min(block.size, newSize)));
    this.blocks.delete(addr);
    return newAddr;
  }

  free(addr: number): void {
    this.blocks.delete(addr);
  }

  internString(s: string): number {
    const existing = this.stringPool.get(s);
    if (existing !== undefined) return existing;
    const addr = this.nextAddr;
    this.nextAddr += s.length + 1 + 4;
    this.stringPool.set(s, addr);
    this.addrToStr.set(addr, s);
    return addr;
  }

  readString(addr: number): string {
    const s = this.addrToStr.get(addr);
    if (s !== undefined) return s;
    // Try to find string in blocks
    const block = this.blocks.get(addr);
    if (block) {
      let str = '';
      for (let i = 0; i < block.size; i++) {
        if (block.data[i] === 0) break;
        str += String.fromCharCode(block.data[i]);
      }
      return str;
    }
    return '';
  }

  writeString(addr: number, s: string): void {
    this.addrToStr.set(addr, s);
    // Also write into block if exists
    const block = this.blocks.get(addr);
    if (block) {
      for (let i = 0; i < s.length && i < block.size - 1; i++) {
        block.data[i] = s.charCodeAt(i);
      }
      if (s.length < block.size) block.data[s.length] = 0;
    }
  }

  readByte(addr: number, offset: number): number {
    const block = this.blocks.get(addr);
    if (block && offset < block.size) return block.data[offset];
    return 0;
  }

  writeByte(addr: number, offset: number, val: number): void {
    const block = this.blocks.get(addr);
    if (block && offset < block.size) block.data[offset] = val & 0xff;
  }

  // For struct/array storage as JS objects at addresses
  private structStore = new Map<number, Map<string, Value>>();
  private arrayStore = new Map<number, Value[]>();

  storeStruct(addr: number, fields: Map<string, Value>): void {
    this.structStore.set(addr, fields);
  }
  loadStruct(addr: number): Map<string, Value> | undefined {
    return this.structStore.get(addr);
  }

  storeArray(addr: number, elements: Value[]): void {
    this.arrayStore.set(addr, elements);
  }
  loadArray(addr: number): Value[] | undefined {
    return this.arrayStore.get(addr);
  }
}

// ─── Type Size Map ─────────────────────────────────────────────────────────────

function sizeofType(type: TypeNode | string): number {
  const base = typeof type === 'string' ? type : type.base;
  const ptrs = typeof type === 'string' ? 0 : type.pointers;
  if (ptrs > 0) return 8;
  switch (base) {
    case 'int8_t': case 'uint8_t': case 'char': case 'bool': return 1;
    case 'int16_t': case 'uint16_t': return 2;
    case 'int32_t': case 'uint32_t': case 'float': return 4;
    case 'int64_t': case 'uint64_t': case 'double': case 'size_t': return 8;
    case 'void': return 0;
    default: return 8; // struct/other
  }
}

// ─── printf format string parser ─────────────────────────────────────────────

function formatPrintf(fmt: string, args: Value[], heap: Heap): string {
  let result = '';
  let argIdx = 0;
  let i = 0;

  while (i < fmt.length) {
    if (fmt[i] !== '%') {
      if (fmt[i] === '\\') {
        i++;
        switch (fmt[i]) {
          case 'n': result += '\n'; break;
          case 't': result += '\t'; break;
          case 'r': result += '\r'; break;
          case '\\': result += '\\'; break;
          case '"': result += '"'; break;
          case '0': result += '\0'; break;
          default: result += '\\' + fmt[i];
        }
        i++;
        continue;
      }
      result += fmt[i++];
      continue;
    }
    i++; // consume %
    if (fmt[i] === '%') { result += '%'; i++; continue; }

    // Parse flags
    let flags = '';
    while (i < fmt.length && '-+ #0'.includes(fmt[i])) flags += fmt[i++];

    // Width
    let width = '';
    if (fmt[i] === '*') { width = String(toNumber(args[argIdx++] ?? mkInt(0))); i++; }
    else while (i < fmt.length && /[0-9]/.test(fmt[i])) width += fmt[i++];

    // Precision
    let precision = '';
    if (fmt[i] === '.') {
      i++;
      if (fmt[i] === '*') { precision = String(toNumber(args[argIdx++] ?? mkInt(0))); i++; }
      else while (i < fmt.length && /[0-9]/.test(fmt[i])) precision += fmt[i++];
    }

    // Length modifier
    let length = '';
    if (fmt[i] === 'h') { length = 'h'; i++; if (fmt[i] === 'h') { length = 'hh'; i++; } }
    else if (fmt[i] === 'l') { length = 'l'; i++; if (fmt[i] === 'l') { length = 'll'; i++; } }
    else if (fmt[i] === 'z') { length = 'z'; i++; }
    else if (fmt[i] === 'j') { length = 'j'; i++; }
    else if (fmt[i] === 't') { length = 't'; i++; }

    const spec = fmt[i++];
    const arg = args[argIdx++] ?? mkInt(0);
    const w = width ? parseInt(width, 10) : 0;
    const p = precision !== '' ? parseInt(precision, 10) : -1;
    const leftAlign = flags.includes('-');
    const zeroPad = flags.includes('0') && !leftAlign;
    const showSign = flags.includes('+');

    function pad(s: string, padChar = ' '): string {
      if (w <= 0 || s.length >= w) return s;
      const padding = padChar.repeat(w - s.length);
      return leftAlign ? s + padding : padding + s;
    }

    switch (spec) {
      case 'd': case 'i': {
        const n = Number(toBigInt(arg));
        let s = String(n);
        if (showSign && n >= 0) s = '+' + s;
        result += pad(s, zeroPad ? '0' : ' ');
        break;
      }
      case 'u': {
        const n = toBigInt(arg);
        const u = n < 0n ? n + 0x100000000n : n;
        result += pad(String(u), zeroPad ? '0' : ' ');
        break;
      }
      case 'f': {
        const n = toNumber(arg);
        const prec = p >= 0 ? p : 6;
        let s = n.toFixed(prec);
        if (showSign && n >= 0) s = '+' + s;
        result += pad(s, zeroPad ? '0' : ' ');
        break;
      }
      case 'e': {
        const n = toNumber(arg);
        const prec = p >= 0 ? p : 6;
        result += pad(n.toExponential(prec), zeroPad ? '0' : ' ');
        break;
      }
      case 'g': {
        const n = toNumber(arg);
        const prec = p >= 0 ? p : 6;
        const s = prec === 0 ? n.toPrecision(1) : n.toPrecision(prec);
        result += pad(s, zeroPad ? '0' : ' ');
        break;
      }
      case 'x': {
        const n = Number(toBigInt(arg) & 0xffffffffn);
        let s = (n >>> 0).toString(16);
        if (p >= 0) s = s.padStart(p, '0');
        result += pad(s, zeroPad ? '0' : ' ');
        break;
      }
      case 'X': {
        const n = Number(toBigInt(arg) & 0xffffffffn);
        let s = (n >>> 0).toString(16).toUpperCase();
        if (p >= 0) s = s.padStart(p, '0');
        result += pad(s, zeroPad ? '0' : ' ');
        break;
      }
      case 'o': {
        const n = Number(toBigInt(arg) & 0xffffffffn);
        result += pad((n >>> 0).toString(8), zeroPad ? '0' : ' ');
        break;
      }
      case 'c': {
        const n = Number(toBigInt(arg));
        result += pad(String.fromCharCode(n & 0xff));
        break;
      }
      case 's': {
        let s: string;
        if (arg.tag === 'str') s = arg.s;
        else if (arg.tag === 'ptr') s = heap.readString(arg.addr);
        else s = String(toNumber(arg));
        if (p >= 0 && s.length > p) s = s.slice(0, p);
        result += pad(s);
        break;
      }
      case 'p': {
        const addr = arg.tag === 'ptr' ? arg.addr : toNumber(arg);
        result += pad('0x' + addr.toString(16));
        break;
      }
      case 'n':
        // %n writes count to pointer - skip
        break;
      default:
        result += '%' + spec;
    }
  }
  return result;
}

// ─── Interpreter ──────────────────────────────────────────────────────────────

export class Interpreter {
  private globalScope: Scope;
  private heap: Heap;
  private functions = new Map<string, FunctionDecl>();
  private structs = new Map<string, StructDecl | UnionDecl>();
  private enums = new Map<string, Map<string, number>>();
  private defines = new Map<string, string>();
  private typedefs = new Map<string, TypeNode>();
  private stdoutBuf = '';
  private stderrBuf = '';
  private captureOutput: boolean;
  private stdinData: string;
  private stdinPos = 0;

  constructor(options: { stdin?: string; captureOutput?: boolean } = {}) {
    this.globalScope = new Scope();
    this.heap = new Heap();
    this.captureOutput = options.captureOutput ?? false;
    this.stdinData = options.stdin ?? '';
    this.setupBuiltins();
  }

  private writeStdout(s: string): void {
    if (this.captureOutput) {
      this.stdoutBuf += s;
    } else {
      process.stdout.write(s);
    }
  }

  private writeStderr(s: string): void {
    if (this.captureOutput) {
      this.stderrBuf += s;
    } else {
      process.stderr.write(s);
    }
  }

  private setupBuiltins(): void {
    // NULL constant
    this.globalScope.set('NULL', NULL_PTR());
    this.globalScope.set('null', NULL_PTR());
    this.globalScope.set('true', mkBool(true));
    this.globalScope.set('false', mkBool(false));
    this.globalScope.set('EOF', mkInt(-1));
    this.globalScope.set('stdin', mkPtr(0, 'file'));
    this.globalScope.set('stdout', mkPtr(1, 'file'));
    this.globalScope.set('stderr', mkPtr(2, 'file'));
    this.globalScope.set('INT_MAX', mkInt(2147483647));
    this.globalScope.set('INT_MIN', mkInt(-2147483648));
    this.globalScope.set('UINT_MAX', mkInt(4294967295));
    this.globalScope.set('SIZE_MAX', mkInt(Number.MAX_SAFE_INTEGER));
    this.globalScope.set('M_PI', mkFloat(Math.PI));
    this.globalScope.set('M_E', mkFloat(Math.E));
    this.globalScope.set('HUGE_VAL', mkFloat(Infinity));
  }

  run(pearSource: string, argv: string[] = []): { exitCode: number; stdout: string; stderr: string } {
    let exitCode = 0;
    try {
      const ast = parse(pearSource);
      this.loadProgram(ast);

      // Set up argc/argv in global scope
      const argc = argv.length + 1; // +1 for program name
      this.globalScope.set('argc', mkInt(argc));

      // Call main
      const mainFn = this.functions.get('main');
      if (!mainFn) throw new Error('No main function found');

      const result = this.callFunction(mainFn, [mkInt(argc), NULL_PTR()], this.globalScope);
      if (result.tag === 'i64') exitCode = Number(result.v);
      else if (result.tag === 'f64') exitCode = Math.trunc(result.v);
    } catch (e) {
      if (e instanceof ExitSignal) {
        exitCode = e.code;
      } else if (e instanceof ReturnSignal) {
        const v = e.value;
        exitCode = v.tag === 'i64' ? Number(v.v) : 0;
      } else {
        const msg = e instanceof Error ? e.message : String(e);
        this.writeStderr(`Runtime error: ${msg}\n`);
        exitCode = 1;
      }
    }
    return { exitCode, stdout: this.stdoutBuf, stderr: this.stderrBuf };
  }

  private loadProgram(ast: Program): void {
    for (const node of ast.body) {
      this.loadTopLevel(node);
    }
  }

  private loadTopLevel(node: ASTNode): void {
    switch (node.kind) {
      case 'FunctionDecl':
        if (node.body !== null) {
          this.functions.set(node.name, node);
        }
        break;
      case 'StructDecl':
        if (node.name) this.structs.set(node.name, node);
        if (node.typedefName) this.structs.set(node.typedefName, node);
        break;
      case 'UnionDecl':
        if (node.name) this.structs.set(node.name, node);
        if (node.typedefName) this.structs.set(node.typedefName, node);
        break;
      case 'EnumDecl': {
        const members = new Map<string, number>();
        let counter = 0;
        for (const m of node.members) {
          if (m.value) {
            const v = this.evalExpr(m.value, this.globalScope);
            counter = Number(toBigInt(v));
          }
          members.set(m.name, counter);
          this.globalScope.set(m.name, mkInt(counter));
          counter++;
        }
        if (node.name) this.enums.set(node.name, members);
        break;
      }
      case 'VarDecl':
        this.execVarDecl(node, this.globalScope);
        break;
      case 'DefineDirective': {
        // Simple value defines only (not function-like)
        if (!node.params) {
          this.defines.set(node.name, node.body);
          // Try to eval as number constant
          if (/^-?\d+(\.\d+)?$/.test(node.body.trim())) {
            this.globalScope.set(node.name, mkFloat(parseFloat(node.body.trim())));
          } else if (/^0x[0-9a-fA-F]+$/.test(node.body.trim())) {
            this.globalScope.set(node.name, mkInt(parseInt(node.body.trim(), 16)));
          } else if (node.body.trim() === 'true') {
            this.globalScope.set(node.name, mkBool(true));
          } else if (node.body.trim() === 'false') {
            this.globalScope.set(node.name, mkBool(false));
          } else {
            // store as string
            this.defines.set(node.name, node.body);
          }
        }
        break;
      }
      case 'TypedefDecl': {
        if (node.inner && (node.inner as any).kind === 'VarDecl') {
          const vd = node.inner as VarDecl;
          this.typedefs.set(node.alias, vd.type);
        }
        break;
      }
      // Directives we ignore
      case 'IncludeDirective':
      case 'PragmaDirective':
      case 'RawPreprocessor':
      case 'IncludeGuardStart':
      case 'IncludeGuardEnd':
        break;
      default:
        break;
    }
  }

  // ─── Statement Execution ───────────────────────────────────────────────────

  private execNode(node: ASTNode, scope: Scope): void {
    switch (node.kind) {
      case 'BlockStmt': this.execBlock(node, scope); break;
      case 'VarDecl': this.execVarDecl(node, scope); break;
      case 'IfStmt': this.execIf(node, scope); break;
      case 'ForStmt': this.execFor(node, scope); break;
      case 'WhileStmt': this.execWhile(node, scope); break;
      case 'DoWhileStmt': this.execDoWhile(node, scope); break;
      case 'SwitchStmt': this.execSwitch(node, scope); break;
      case 'ReturnStmt':
        throw new ReturnSignal(node.value ? this.evalExpr(node.value, scope) : VOID);
      case 'BreakStmt': throw new BreakSignal();
      case 'ContinueStmt': throw new ContinueSignal();
      case 'GotoStmt': throw new GotoSignal(node.label);
      case 'LabelStmt':
        // Execute the labeled statement
        this.execNode(node.body, scope);
        break;
      case 'ExprStmt': this.evalExpr(node.expr, scope); break;
      // top-level things that can appear in blocks
      case 'FunctionDecl':
        if (node.body !== null) this.functions.set(node.name, node);
        break;
      case 'StructDecl':
        if (node.name) this.structs.set(node.name, node);
        if (node.typedefName) this.structs.set(node.typedefName, node);
        break;
      case 'UnionDecl':
        if (node.name) this.structs.set(node.name, node);
        if (node.typedefName) this.structs.set(node.typedefName, node);
        break;
      case 'EnumDecl': this.loadTopLevel(node); break;
      case 'TypedefDecl': this.loadTopLevel(node); break;
      case 'DefineDirective': this.loadTopLevel(node); break;
      case 'IncludeDirective':
      case 'PragmaDirective':
      case 'RawPreprocessor':
      case 'IncludeGuardStart':
      case 'IncludeGuardEnd':
        break;
      default:
        break;
    }
  }

  private execBlock(block: BlockStmt, parentScope: Scope): void {
    const scope = new Scope(parentScope);
    this.execBlockInScope(block.body, scope);
  }

  private execBlockInScope(stmts: ASTNode[], scope: Scope): void {
    let i = 0;
    while (i < stmts.length) {
      try {
        this.execNode(stmts[i], scope);
        i++;
      } catch (e) {
        if (e instanceof GotoSignal) {
          // Scan for the label in this block
          const labelIdx = stmts.findIndex(s =>
            s.kind === 'LabelStmt' && (s as LabelStmt).label === e.label
          );
          if (labelIdx >= 0) {
            i = labelIdx;
            continue;
          }
          throw e; // propagate upward
        }
        throw e;
      }
    }
  }

  private execVarDecl(node: VarDecl, scope: Scope): void {
    // Handle array type: type with arraySize
    if (node.type.arraySize) {
      const sizeVal = this.evalExpr(node.type.arraySize, scope);
      const size = Number(toBigInt(sizeVal));
      let elements: Value[];
      if (node.init && node.init.kind === 'InitListExpr') {
        elements = [];
        const initList = node.init as InitListExpr;
        for (let i = 0; i < size; i++) {
          const initNode = initList.elements[i];
          elements.push(initNode ? this.evalExpr(initNode, scope) : this.defaultValue(node.type));
        }
      } else if (node.init) {
        const v = this.evalExpr(node.init, scope);
        if (v.tag === 'array') { elements = v.elements; }
        else { elements = new Array(size).fill(null).map(() => this.defaultValue(node.type)); }
      } else {
        elements = new Array(size).fill(null).map(() => this.defaultValue(node.type));
      }
      const elemSize = sizeofType({ ...node.type, arraySize: null, pointers: node.type.pointers });
      const addr = this.heap.allocate(size * Math.max(elemSize, 1));
      this.heap.storeArray(addr, elements);
      const arrVal: Value = { tag: 'array', elements, addr };
      scope.set(node.name, arrVal);
      return;
    }

    let value: Value;
    if (node.init) {
      value = this.evalExpr(node.init, scope);
      // Handle struct initialization from InitListExpr
      value = this.coerceInitForType(value, node.type, scope);
    } else {
      value = this.defaultValue(node.type);
    }
    scope.set(node.name, value);
  }

  private coerceInitForType(value: Value, type: TypeNode, scope: Scope): Value {
    if (type.pointers > 0) {
      // Pointer type
      if (value.tag === 'array') return mkPtr(value.addr);
      if (value.tag === 'str') return mkPtr(value.addr);
      if (value.tag === 'ptr') return value;
      if (value.tag === 'i64' && value.v === 0n) return NULL_PTR();
      return value;
    }
    // Check if we need struct coercion
    const structDef = this.lookupStruct(type.base);
    if (structDef && value.tag === 'array') {
      // Convert positional InitList to struct
      const fields = new Map<string, Value>();
      for (let i = 0; i < structDef.fields.length; i++) {
        const f = structDef.fields[i];
        fields.set(f.name, value.elements[i] ?? this.defaultValue(f.type));
      }
      return { tag: 'struct', fields, typeName: type.base };
    }
    if (structDef && value.tag === 'void') {
      return this.defaultValue(type);
    }
    return value;
  }

  private lookupStruct(name: string): StructDecl | UnionDecl | null {
    return this.structs.get(name) ||
      this.structs.get(name.replace('struct ', '').replace('union ', '')) ||
      null;
  }

  private defaultValue(type: TypeNode): Value {
    if (type.pointers > 0) return NULL_PTR();
    switch (type.base) {
      case 'int8_t': case 'int16_t': case 'int32_t': case 'int64_t':
      case 'uint8_t': case 'uint16_t': case 'uint32_t': case 'uint64_t':
      case 'size_t': case 'char':
        return mkInt(0);
      case 'float': case 'double':
        return mkFloat(0);
      case 'bool':
        return mkBool(false);
      case 'void':
        return VOID;
      default: {
        // Struct or typedef'd type
        const structDef = this.structs.get(type.base) ||
          this.structs.get(type.base.replace('struct ', '').replace('union ', ''));
        if (structDef) {
          const fields = new Map<string, Value>();
          for (const f of structDef.fields) {
            fields.set(f.name, this.defaultValue(f.type));
          }
          return { tag: 'struct', fields, typeName: type.base };
        }
        return mkInt(0);
      }
    }
  }

  private execIf(node: IfStmt, scope: Scope): void {
    const cond = this.evalExpr(node.condition, scope);
    if (isTruthy(cond)) {
      this.execNode(node.consequent, scope);
    } else if (node.alternate) {
      this.execNode(node.alternate, scope);
    }
  }

  private execFor(node: ForStmt, scope: Scope): void {
    const loopScope = new Scope(scope);
    if (node.init) this.execNode(node.init, loopScope);
    while (true) {
      if (node.condition) {
        const cond = this.evalExpr(node.condition, loopScope);
        if (!isTruthy(cond)) break;
      }
      try {
        this.execNode(node.body, loopScope);
      } catch (e) {
        if (e instanceof BreakSignal) break;
        if (e instanceof ContinueSignal) {
          // fall through to update
        } else throw e;
      }
      if (node.update) this.evalExpr(node.update, loopScope);
    }
  }

  private execWhile(node: WhileStmt, scope: Scope): void {
    while (true) {
      const cond = this.evalExpr(node.condition, scope);
      if (!isTruthy(cond)) break;
      try {
        this.execNode(node.body, scope);
      } catch (e) {
        if (e instanceof BreakSignal) break;
        if (e instanceof ContinueSignal) continue;
        throw e;
      }
    }
  }

  private execDoWhile(node: DoWhileStmt, scope: Scope): void {
    do {
      try {
        this.execNode(node.body, scope);
      } catch (e) {
        if (e instanceof BreakSignal) break;
        if (e instanceof ContinueSignal) {
          const cond = this.evalExpr(node.condition, scope);
          if (!isTruthy(cond)) return;
          continue;
        }
        throw e;
      }
    } while (isTruthy(this.evalExpr(node.condition, scope)));
  }

  private execSwitch(node: SwitchStmt, scope: Scope): void {
    const switchVal = this.evalExpr(node.expr, scope);
    const switchNum = toBigInt(switchVal);

    // The body should be a block with case/default statements
    const body = node.body;
    let stmts: ASTNode[] = [];
    if (body.kind === 'BlockStmt') stmts = body.body;
    else stmts = [body];

    // Find matching case or default
    let startIdx = -1;
    let defaultIdx = -1;
    for (let i = 0; i < stmts.length; i++) {
      const s = stmts[i];
      if (s.kind === 'CaseStmt') {
        const caseVal = this.evalExpr((s as CaseStmt).value, scope);
        if (toBigInt(caseVal) === switchNum) { startIdx = i; break; }
      } else if (s.kind === 'DefaultStmt') {
        defaultIdx = i;
      }
    }

    if (startIdx < 0) startIdx = defaultIdx;
    if (startIdx < 0) return; // no match

    // Execute from matched case onwards
    const switchScope = new Scope(scope);
    try {
      for (let i = startIdx; i < stmts.length; i++) {
        const s = stmts[i];
        if (s.kind === 'CaseStmt') {
          const cs = s as CaseStmt;
          for (const stmt of cs.body) this.execNode(stmt, switchScope);
        } else if (s.kind === 'DefaultStmt') {
          const ds = s as DefaultStmt;
          for (const stmt of ds.body) this.execNode(stmt, switchScope);
        } else {
          this.execNode(s, switchScope);
        }
      }
    } catch (e) {
      if (e instanceof BreakSignal) return;
      throw e;
    }
  }

  // ─── Expression Evaluation ─────────────────────────────────────────────────

  private evalExpr(expr: Expr, scope: Scope): Value {
    switch (expr.kind) {
      case 'NumberLiteral': return this.evalNumber(expr);
      case 'StringLiteral': return this.evalString(expr);
      case 'CharLiteral': return this.evalChar(expr);
      case 'BoolLiteral': return mkBool(expr.value);
      case 'NullLiteral': return NULL_PTR();
      case 'Identifier': return this.evalIdentifier(expr, scope);
      case 'BinaryExpr': return this.evalBinary(expr, scope);
      case 'UnaryExpr': return this.evalUnary(expr, scope);
      case 'PostfixExpr': return this.evalPostfix(expr, scope);
      case 'AssignExpr': return this.evalAssign(expr, scope);
      case 'TernaryExpr': {
        const cond = this.evalExpr(expr.condition, scope);
        return isTruthy(cond)
          ? this.evalExpr(expr.consequent, scope)
          : this.evalExpr(expr.alternate, scope);
      }
      case 'CallExpr': return this.evalCall(expr, scope);
      case 'IndexExpr': return this.evalIndex(expr, scope);
      case 'MemberExpr': return this.evalMember(expr, scope);
      case 'CastExpr': return this.evalCast(expr, scope);
      case 'SizeofExpr': return this.evalSizeof(expr, scope);
      case 'InitListExpr': return this.evalInitList(expr, scope);
      case 'FuncPtrExpr': return mkPtr(0, expr.name);
      case 'ParenExpr': return this.evalExpr(expr.expr, scope);
      default:
        return VOID;
    }
  }

  private evalNumber(expr: NumberLiteral): Value {
    let s = expr.value.replace(/_/g, '');
    // Strip suffix
    const suffix = s.match(/[uUlLfF]+$/)?.[0] ?? '';
    s = s.slice(0, s.length - suffix.length);
    const isFloat = suffix.toLowerCase().includes('f') || s.includes('.');
    if (s.startsWith('0x') || s.startsWith('0X')) {
      return mkInt(parseInt(s, 16));
    }
    if (isFloat || s.includes('.') || s.includes('e') || s.includes('E')) {
      return mkFloat(parseFloat(s));
    }
    return mkInt(parseInt(s, 10));
  }

  private evalString(expr: StringLiteral): Value {
    // Value is like '"Hello, World!\n"'
    let raw = expr.value;
    if (raw.startsWith('"')) raw = raw.slice(1);
    if (raw.endsWith('"')) raw = raw.slice(0, -1);
    const s = this.unescapeString(raw);
    const addr = this.heap.internString(s);
    return { tag: 'str', s, addr };
  }

  private unescapeString(s: string): string {
    let result = '';
    let i = 0;
    while (i < s.length) {
      if (s[i] === '\\') {
        i++;
        switch (s[i]) {
          case 'n': result += '\n'; break;
          case 't': result += '\t'; break;
          case 'r': result += '\r'; break;
          case '0': result += '\0'; break;
          case '\\': result += '\\'; break;
          case '"': result += '"'; break;
          case "'": result += "'"; break;
          case 'a': result += '\x07'; break;
          case 'b': result += '\x08'; break;
          case 'f': result += '\x0c'; break;
          case 'v': result += '\x0b'; break;
          case 'x': {
            const hex = s.slice(i + 1, i + 3);
            result += String.fromCharCode(parseInt(hex, 16));
            i += 2;
            break;
          }
          default: result += s[i];
        }
        i++;
      } else {
        result += s[i++];
      }
    }
    return result;
  }

  private evalChar(expr: CharLiteral): Value {
    let raw = expr.value;
    if (raw.startsWith("'")) raw = raw.slice(1);
    if (raw.endsWith("'")) raw = raw.slice(0, -1);
    const unescaped = this.unescapeString(raw);
    return mkInt(unescaped.charCodeAt(0) || 0);
  }

  private evalIdentifier(expr: Identifier, scope: Scope): Value {
    const v = scope.get(expr.name);
    if (v !== undefined) return v;
    // Check enum
    for (const [, members] of this.enums) {
      if (members.has(expr.name)) return mkInt(members.get(expr.name)!);
    }
    // Check if it's a function name (function pointer context)
    if (this.functions.has(expr.name)) {
      return mkPtr(0, expr.name);
    }
    return mkInt(0); // undefined → 0
  }

  private evalBinary(expr: BinaryExpr, scope: Scope): Value {
    // Short-circuit for &&, ||
    if (expr.op === '&&') {
      const left = this.evalExpr(expr.left, scope);
      if (!isTruthy(left)) return mkBool(false);
      const right = this.evalExpr(expr.right, scope);
      return mkBool(isTruthy(right));
    }
    if (expr.op === '||') {
      const left = this.evalExpr(expr.left, scope);
      if (isTruthy(left)) return mkBool(true);
      const right = this.evalExpr(expr.right, scope);
      return mkBool(isTruthy(right));
    }

    const left = this.evalExpr(expr.left, scope);
    const right = this.evalExpr(expr.right, scope);

    // Float arithmetic if either operand is float
    if (left.tag === 'f64' || right.tag === 'f64') {
      const l = toNumber(left);
      const r = toNumber(right);
      switch (expr.op) {
        case '+': return mkFloat(l + r);
        case '-': return mkFloat(l - r);
        case '*': return mkFloat(l * r);
        case '/': return mkFloat(r === 0 ? (l >= 0 ? Infinity : -Infinity) : l / r);
        case '%': return mkFloat(l % r);
        case '<': return mkBool(l < r);
        case '>': return mkBool(l > r);
        case '<=': return mkBool(l <= r);
        case '>=': return mkBool(l >= r);
        case '==': return mkBool(l === r);
        case '!=': return mkBool(l !== r);
        default: return mkFloat(0);
      }
    }

    // Pointer arithmetic
    if (left.tag === 'ptr' || left.tag === 'str') {
      const addr = left.tag === 'ptr' ? left.addr : left.addr;
      const r = Number(toBigInt(right));
      switch (expr.op) {
        case '+': return mkPtr(addr + r * 8); // approximate stride
        case '-':
          if (right.tag === 'ptr' || right.tag === 'str') {
            return mkInt(Math.floor((addr - toNumber(right)) / 8));
          }
          return mkPtr(addr - r * 8);
        case '==': return mkBool(addr === toNumber(right));
        case '!=': return mkBool(addr !== toNumber(right));
        case '<': return mkBool(addr < toNumber(right));
        case '>': return mkBool(addr > toNumber(right));
        case '<=': return mkBool(addr <= toNumber(right));
        case '>=': return mkBool(addr >= toNumber(right));
        default: return mkPtr(addr);
      }
    }

    // Integer arithmetic
    const l = toBigInt(left);
    const r = toBigInt(right);
    switch (expr.op) {
      case '+': return mkInt(l + r);
      case '-': return mkInt(l - r);
      case '*': return mkInt(l * r);
      case '/': return r === 0n ? mkInt(0) : mkInt(l / r);
      case '%': return r === 0n ? mkInt(0) : mkInt(l % r);
      case '&': return mkInt(l & r);
      case '|': return mkInt(l | r);
      case '^': return mkInt(l ^ r);
      case '<<': return mkInt(l << (r & 63n));
      case '>>': return mkInt(l >> (r & 63n));
      case '<': return mkBool(l < r);
      case '>': return mkBool(l > r);
      case '<=': return mkBool(l <= r);
      case '>=': return mkBool(l >= r);
      case '==': return mkBool(l === r);
      case '!=': return mkBool(l !== r);
      default: return mkInt(0);
    }
  }

  private evalUnary(expr: UnaryExpr, scope: Scope): Value {
    if (!expr.prefix) {
      // Postfix handled in PostfixExpr
      return this.evalExpr(expr.operand, scope);
    }

    switch (expr.op) {
      case '-': {
        const v = this.evalExpr(expr.operand, scope);
        if (v.tag === 'f64') return mkFloat(-v.v);
        return mkInt(-toBigInt(v));
      }
      case '+': return this.evalExpr(expr.operand, scope);
      case '!': {
        const v = this.evalExpr(expr.operand, scope);
        return mkBool(!isTruthy(v));
      }
      case '~': {
        const v = this.evalExpr(expr.operand, scope);
        return mkInt(~toBigInt(v));
      }
      case '*': {
        // Dereference
        const v = this.evalExpr(expr.operand, scope);
        return this.deref(v, scope);
      }
      case '&': {
        // Address-of: return a pointer that can be used for assignment
        return this.addressOf(expr.operand, scope);
      }
      case '++': {
        // Prefix increment
        const val = this.evalExpr(expr.operand, scope);
        const newVal = val.tag === 'f64' ? mkFloat(val.v + 1) : mkInt(toBigInt(val) + 1n);
        this.assignTo(expr.operand, newVal, scope);
        return newVal;
      }
      case '--': {
        const val = this.evalExpr(expr.operand, scope);
        const newVal = val.tag === 'f64' ? mkFloat(val.v - 1) : mkInt(toBigInt(val) - 1n);
        this.assignTo(expr.operand, newVal, scope);
        return newVal;
      }
      default:
        return this.evalExpr(expr.operand, scope);
    }
  }

  private evalPostfix(expr: PostfixExpr, scope: Scope): Value {
    const val = this.evalExpr(expr.operand, scope);
    if (expr.op === '++') {
      const newVal = val.tag === 'f64' ? mkFloat(val.v + 1) : mkInt(toBigInt(val) + 1n);
      this.assignTo(expr.operand, newVal, scope);
      return val; // return OLD value
    }
    if (expr.op === '--') {
      const newVal = val.tag === 'f64' ? mkFloat(val.v - 1) : mkInt(toBigInt(val) - 1n);
      this.assignTo(expr.operand, newVal, scope);
      return val;
    }
    return val;
  }

  private deref(ptr: Value, scope: Scope): Value {
    if (ptr.tag === 'ptr') {
      // Check if address maps to a scope variable (read current value)
      const varRef = this.addrToVar.get(ptr.addr);
      if (varRef) {
        const v = varRef.scope.get(varRef.name);
        if (v !== undefined) return v;
      }

      // Check struct store
      const structFields = this.heap.loadStruct(ptr.addr);
      if (structFields) return { tag: 'struct', fields: structFields, typeName: ptr.pointee ?? '' };
      // Check array store (first element = scalar value)
      const arr = this.heap.loadArray(ptr.addr);
      if (arr) return arr[0] ?? mkInt(0);
      // String
      const s = this.heap.readString(ptr.addr);
      if (s.length > 0) return mkInt(s.charCodeAt(0));
      return mkInt(0);
    }
    if (ptr.tag === 'str') {
      return mkInt(ptr.s.charCodeAt(0));
    }
    return mkInt(0);
  }

  private addressOf(expr: Expr, scope: Scope): Value {
    if (expr.kind === 'Identifier') {
      const v = scope.get(expr.name);
      if (v === undefined) return mkPtr(0);
      if (v.tag === 'array') return mkPtr(v.addr);
      if (v.tag === 'str') return mkPtr(v.addr);
      if (v.tag === 'struct') {
        // Store struct in heap and return pointer; keep a mapping so writes sync back
        const addr = this.heap.allocate(8);
        this.heap.storeStruct(addr, v.fields);
        // Track this struct's pointer so mutations sync back to the original value
        this.addrToVar.set(addr, { scope, name: expr.name });
        return mkPtr(addr, 'struct');
      }
      // Scalar: allocate a cell linked to this scope variable
      const cell = this.allocScalarCell(expr.name, v, scope);
      // Ensure cell reflects the current value
      const arr = this.heap.loadArray(cell);
      if (arr) arr[0] = v;
      return mkPtr(cell);
    }
    if (expr.kind === 'MemberExpr') {
      const obj = this.evalExpr(expr.object, scope);
      if (obj.tag === 'struct') {
        const addr = this.heap.allocate(8);
        const fieldVal = obj.fields.get(expr.member) ?? mkInt(0);
        // Store only this field in the heap cell, with pointee = field name
        this.heap.storeArray(addr, [fieldVal]);
        return mkPtr(addr, expr.member);
      }
    }
    if (expr.kind === 'UnaryExpr' && expr.op === '*') {
      return this.evalExpr(expr.operand, scope);
    }
    const v = this.evalExpr(expr, scope);
    if (v.tag === 'ptr') return v;
    if (v.tag === 'str') return mkPtr(v.addr);
    if (v.tag === 'array') return mkPtr(v.addr);
    const addr = this.heap.allocate(8);
    this.heap.storeArray(addr, [v]);
    return mkPtr(addr);
  }

  // Map: heap address → {scope, name} for scalar variable cells
  private addrToVar = new Map<number, { scope: Scope; name: string }>();
  // Map: variable key (scope id + name) → heap address
  private varToAddr = new Map<string, number>();
  private scopeIdCounter = 0;
  private scopeIds = new WeakMap<Scope, number>();

  private getScopeId(scope: Scope): number {
    let id = this.scopeIds.get(scope);
    if (id === undefined) {
      id = this.scopeIdCounter++;
      this.scopeIds.set(scope, id);
    }
    return id;
  }

  private allocScalarCell(name: string, v: Value, scope: Scope): number {
    // Walk scope chain to find where the variable is defined
    let defScope: Scope = scope;
    let s: Scope | null = scope;
    while (s) {
      if ((s as any).vars.has(name)) { defScope = s; break; }
      s = (s as any).parent;
    }

    const scopeId = this.getScopeId(defScope);
    const key = `${scopeId}:${name}`;
    if (this.varToAddr.has(key)) return this.varToAddr.get(key)!;

    const addr = this.heap.allocate(8);
    this.varToAddr.set(key, addr);
    this.addrToVar.set(addr, { scope: defScope, name });
    this.heap.storeArray(addr, [v]);
    return addr;
  }

  private assignTo(target: Expr, value: Value, scope: Scope): void {
    if (target.kind === 'Identifier') {
      if (!scope.assign(target.name, value)) {
        scope.set(target.name, value);
      }
      // Also update any scalar cell linked to this variable
      // Walk all addrToVar entries to find ones pointing to this scope+name
      // (lightweight: we just update the heap array directly)
      for (const [addr, ref] of this.addrToVar) {
        if (ref.name === target.name) {
          const arr = this.heap.loadArray(addr);
          if (arr) arr[0] = value;
        }
      }
      return;
    }
    if (target.kind === 'UnaryExpr' && target.op === '*') {
      // *ptr = value
      const ptr = this.evalExpr(target.operand, scope);
      this.writeToPtr(ptr, value);
      return;
    }
    if (target.kind === 'IndexExpr') {
      const obj = this.evalExpr(target.object, scope);
      const idx = Number(toBigInt(this.evalExpr(target.index, scope)));
      this.setArrayElement(obj, idx, value, scope, target.object);
      return;
    }
    if (target.kind === 'MemberExpr') {
      const obj = this.evalExpr(target.object, scope);
      if (obj.tag === 'struct') {
        obj.fields.set(target.member, value);
        // Write back to parent if it's an identifier
        if (target.object.kind === 'Identifier') {
          scope.assign(target.object.name, obj);
        }
        return;
      }
      if (obj.tag === 'ptr') {
        // Arrow access: ptr->field
        // Check if the pointer maps to a scope variable (struct)
        const varRef = this.addrToVar.get(obj.addr);
        if (varRef) {
          const sv = varRef.scope.get(varRef.name);
          if (sv && sv.tag === 'struct') {
            sv.fields.set(target.member, value);
            varRef.scope.assign(varRef.name, sv);
            // Also update heap store
            const sf = this.heap.loadStruct(obj.addr);
            if (sf) sf.set(target.member, value);
            return;
          }
        }
        const structFields = this.heap.loadStruct(obj.addr);
        if (structFields) {
          structFields.set(target.member, value);
          return;
        }
        // No struct store yet, create one
        const newFields = new Map<string, Value>();
        newFields.set(target.member, value);
        this.heap.storeStruct(obj.addr, newFields);
      }
      return;
    }
  }

  private writeToPtr(ptr: Value, value: Value): void {
    if (ptr.tag !== 'ptr') return;

    // Check if this address maps to a scope variable
    const varRef = this.addrToVar.get(ptr.addr);
    if (varRef) {
      varRef.scope.assign(varRef.name, value);
      const arr = this.heap.loadArray(ptr.addr);
      if (arr) arr[0] = value;
      return;
    }

    // Check if it's a heap array cell
    const arr = this.heap.loadArray(ptr.addr);
    if (arr) { arr[0] = value; return; }

    // Struct store
    const structFields = this.heap.loadStruct(ptr.addr);
    if (structFields) {
      if (value.tag === 'struct') {
        for (const [k, v] of value.fields) structFields.set(k, v);
      } else if (ptr.pointee) {
        structFields.set(ptr.pointee, value);
      }
      return;
    }
    // Write string
    if (value.tag === 'str') {
      this.heap.writeString(ptr.addr, value.s);
      return;
    }
    // Create a new cell
    this.heap.storeArray(ptr.addr, [value]);
  }

  private setArrayElement(arr: Value, idx: number, value: Value, scope: Scope, objExpr: Expr): void {
    if (arr.tag === 'array') {
      arr.elements[idx] = value;
      return;
    }
    if (arr.tag === 'ptr') {
      // Could be a heap array
      const heapArr = this.heap.loadArray(arr.addr);
      if (heapArr) { heapArr[idx] = value; return; }
      // Try to write at offset
      const targetAddr = arr.addr + idx * 8;
      const targetCell = this.heap.loadArray(targetAddr);
      if (targetCell) { targetCell[0] = value; return; }
      this.heap.storeArray(targetAddr, [value]);
      return;
    }
  }

  private evalAssign(expr: AssignExpr, scope: Scope): Value {
    const right = this.evalExpr(expr.right, scope);
    const left = this.evalExpr(expr.left, scope);

    let newVal: Value;
    if (expr.op === '=') {
      newVal = right;
    } else {
      // Compound assignment
      const op = expr.op.slice(0, -1); // strip '='
      const combined: BinaryExpr = { kind: 'BinaryExpr', op, left: expr.left, right: expr.right };
      newVal = this.evalBinary(combined, scope);
    }

    this.assignTo(expr.left, newVal, scope);
    return newVal;
  }

  private evalCall(expr: CallExpr, scope: Scope): Value {
    // Get function name
    let fnName = '';
    if (expr.callee.kind === 'Identifier') {
      fnName = expr.callee.name;
    } else if (expr.callee.kind === 'MemberExpr') {
      fnName = expr.callee.member;
    } else {
      const v = this.evalExpr(expr.callee, scope);
      if (v.tag === 'ptr' && v.pointee) fnName = v.pointee;
    }

    // Evaluate arguments
    const args = expr.args.map(a => this.evalExpr(a, scope));

    // Try built-in first
    const builtin = this.callBuiltin(fnName, args, expr.args, scope);
    if (builtin !== undefined) return builtin;

    // User-defined function
    const fn = this.functions.get(fnName);
    if (fn) return this.callFunction(fn, args, scope);

    // Unknown function — return 0
    return mkInt(0);
  }

  private callFunction(fn: FunctionDecl, args: Value[], callerScope: Scope): Value {
    if (!fn.body) return VOID;

    const fnScope = new Scope(this.globalScope);

    // Bind parameters
    for (let i = 0; i < fn.params.length; i++) {
      const param = fn.params[i];
      if (param.isVararg) break;
      const argVal = args[i] ?? this.defaultValue(param.type);
      fnScope.set(param.name, argVal);
    }

    // Handle varargs: store remaining as __varargs
    const varargStart = fn.params.findIndex(p => p.isVararg);
    if (varargStart >= 0) {
      const varargs = args.slice(varargStart);
      this.currentVarargs = varargs;
    }

    try {
      this.execBlock(fn.body, fnScope);
      return VOID;
    } catch (e) {
      if (e instanceof ReturnSignal) return e.value;
      throw e;
    }
  }

  private currentVarargs: Value[] = [];

  // ─── Built-in Functions ────────────────────────────────────────────────────

  private callBuiltin(name: string, args: Value[], rawArgs: Expr[], scope: Scope): Value | undefined {
    switch (name) {
      // I/O
      case 'printf': {
        const fmt = args[0];
        const fmtStr = fmt?.tag === 'str' ? fmt.s : (fmt?.tag === 'ptr' ? this.heap.readString(fmt.addr) : '');
        const rest = args.slice(1);
        const out = formatPrintf(fmtStr, rest, this.heap);
        this.writeStdout(out);
        return mkInt(out.length);
      }
      case 'fprintf': {
        // args[0] = FILE*, args[1] = fmt, rest = ...
        const filePtr = args[0];
        const fmt = args[1];
        const fmtStr = fmt?.tag === 'str' ? fmt.s : (fmt?.tag === 'ptr' ? this.heap.readString(fmt.addr) : '');
        const rest = args.slice(2);
        const out = formatPrintf(fmtStr, rest, this.heap);
        // Check if stderr (addr=2)
        const isStderr = filePtr?.tag === 'ptr' && filePtr.addr === 2;
        if (isStderr) this.writeStderr(out);
        else this.writeStdout(out);
        return mkInt(out.length);
      }
      case 'sprintf': {
        const bufPtr = args[0];
        const fmt = args[1];
        const fmtStr = fmt?.tag === 'str' ? fmt.s : (fmt?.tag === 'ptr' ? this.heap.readString(fmt.addr) : '');
        const rest = args.slice(2);
        const out = formatPrintf(fmtStr, rest, this.heap);
        if (bufPtr?.tag === 'ptr') this.heap.writeString(bufPtr.addr, out);
        return mkInt(out.length);
      }
      case 'snprintf': {
        // snprintf(buf, n, fmt, ...)
        const bufPtr = args[0];
        // args[1] = max size, args[2] = fmt
        const fmt = args[2];
        const fmtStr = fmt?.tag === 'str' ? fmt.s : (fmt?.tag === 'ptr' ? this.heap.readString(fmt.addr) : '');
        const rest = args.slice(3);
        const out = formatPrintf(fmtStr, rest, this.heap);
        if (bufPtr?.tag === 'ptr') this.heap.writeString(bufPtr.addr, out);
        return mkInt(out.length);
      }
      case 'puts': {
        const s = args[0];
        const str = s?.tag === 'str' ? s.s : (s?.tag === 'ptr' ? this.heap.readString(s.addr) : '');
        this.writeStdout(str + '\n');
        return mkInt(str.length + 1);
      }
      case 'putchar': {
        const c = Number(toBigInt(args[0] ?? mkInt(0)));
        this.writeStdout(String.fromCharCode(c));
        return mkInt(c);
      }
      case 'putc': case 'fputc': {
        const c = Number(toBigInt(args[0] ?? mkInt(0)));
        this.writeStdout(String.fromCharCode(c));
        return mkInt(c);
      }
      case 'fputs': {
        const s = args[0];
        const str = s?.tag === 'str' ? s.s : (s?.tag === 'ptr' ? this.heap.readString(s.addr) : '');
        this.writeStdout(str);
        return mkInt(str.length);
      }
      case 'getchar': case 'fgetc': {
        if (this.stdinPos < this.stdinData.length) {
          return mkInt(this.stdinData.charCodeAt(this.stdinPos++));
        }
        return mkInt(-1); // EOF
      }
      case 'scanf': case 'fscanf': return mkInt(0); // not supported
      case 'fflush': return mkInt(0);
      case 'fopen': return NULL_PTR();
      case 'fclose': return mkInt(0);
      case 'fread': return mkInt(0);
      case 'fwrite': return mkInt(0);
      case 'feof': return mkInt(1);
      case 'ferror': return mkInt(0);
      case 'rewind': return VOID;
      case 'fseek': return mkInt(0);
      case 'ftell': return mkInt(0);
      case 'perror': {
        const msg = args[0];
        const str = msg?.tag === 'str' ? msg.s : (msg?.tag === 'ptr' ? this.heap.readString(msg.addr) : '');
        this.writeStderr(str + ': error\n');
        return VOID;
      }

      // Memory
      case 'malloc': {
        const n = Number(toBigInt(args[0] ?? mkInt(0)));
        if (n === 0) return NULL_PTR();
        const addr = this.heap.allocate(n);
        return mkPtr(addr);
      }
      case 'calloc': {
        const n = Number(toBigInt(args[0] ?? mkInt(0)));
        const sz = Number(toBigInt(args[1] ?? mkInt(1)));
        const total = n * sz;
        if (total === 0) return NULL_PTR();
        const addr = this.heap.allocate(total);
        return mkPtr(addr);
      }
      case 'realloc': {
        const ptr = args[0];
        const n = Number(toBigInt(args[1] ?? mkInt(0)));
        if (!ptr || ptr.tag !== 'ptr' || ptr.addr === 0) {
          return mkPtr(this.heap.allocate(n));
        }
        const newAddr = this.heap.reallocate(ptr.addr, n);
        return mkPtr(newAddr);
      }
      case 'free': return VOID; // no-op

      // String operations
      case 'strlen': {
        const s = args[0];
        const str = s?.tag === 'str' ? s.s : (s?.tag === 'ptr' ? this.heap.readString(s.addr) : '');
        return mkInt(str.length);
      }
      case 'strcpy': {
        const dst = args[0];
        const src = args[1];
        const str = src?.tag === 'str' ? src.s : (src?.tag === 'ptr' ? this.heap.readString(src.addr) : '');
        if (dst?.tag === 'ptr') this.heap.writeString(dst.addr, str);
        return dst ?? NULL_PTR();
      }
      case 'strncpy': {
        const dst = args[0];
        const src = args[1];
        const n = Number(toBigInt(args[2] ?? mkInt(0)));
        const str = (src?.tag === 'str' ? src.s : (src?.tag === 'ptr' ? this.heap.readString(src.addr) : '')).slice(0, n);
        if (dst?.tag === 'ptr') this.heap.writeString(dst.addr, str);
        return dst ?? NULL_PTR();
      }
      case 'strcmp': {
        const a = args[0];
        const b = args[1];
        const sa = a?.tag === 'str' ? a.s : (a?.tag === 'ptr' ? this.heap.readString(a.addr) : '');
        const sb = b?.tag === 'str' ? b.s : (b?.tag === 'ptr' ? this.heap.readString(b.addr) : '');
        if (sa < sb) return mkInt(-1);
        if (sa > sb) return mkInt(1);
        return mkInt(0);
      }
      case 'strncmp': {
        const a = args[0];
        const b = args[1];
        const n = Number(toBigInt(args[2] ?? mkInt(0)));
        const sa = (a?.tag === 'str' ? a.s : (a?.tag === 'ptr' ? this.heap.readString(a.addr) : '')).slice(0, n);
        const sb = (b?.tag === 'str' ? b.s : (b?.tag === 'ptr' ? this.heap.readString(b.addr) : '')).slice(0, n);
        if (sa < sb) return mkInt(-1);
        if (sa > sb) return mkInt(1);
        return mkInt(0);
      }
      case 'strcat': {
        const dst = args[0];
        const src = args[1];
        const sa = dst?.tag === 'ptr' ? this.heap.readString(dst.addr) : '';
        const sb = src?.tag === 'str' ? src.s : (src?.tag === 'ptr' ? this.heap.readString(src.addr) : '');
        const result = sa + sb;
        if (dst?.tag === 'ptr') this.heap.writeString(dst.addr, result);
        return dst ?? NULL_PTR();
      }
      case 'strncat': {
        const dst = args[0];
        const src = args[1];
        const n = Number(toBigInt(args[2] ?? mkInt(0)));
        const sa = dst?.tag === 'ptr' ? this.heap.readString(dst.addr) : '';
        const sb = (src?.tag === 'str' ? src.s : (src?.tag === 'ptr' ? this.heap.readString(src.addr) : '')).slice(0, n);
        const result = sa + sb;
        if (dst?.tag === 'ptr') this.heap.writeString(dst.addr, result);
        return dst ?? NULL_PTR();
      }
      case 'strchr': {
        const s = args[0];
        const c = Number(toBigInt(args[1] ?? mkInt(0)));
        const str = s?.tag === 'str' ? s.s : (s?.tag === 'ptr' ? this.heap.readString(s.addr) : '');
        const idx = str.indexOf(String.fromCharCode(c));
        if (idx < 0) return NULL_PTR();
        const addr = this.heap.internString(str.slice(idx));
        return mkPtr(addr);
      }
      case 'strstr': {
        const haystack = args[0];
        const needle = args[1];
        const hs = haystack?.tag === 'str' ? haystack.s : (haystack?.tag === 'ptr' ? this.heap.readString(haystack.addr) : '');
        const nd = needle?.tag === 'str' ? needle.s : (needle?.tag === 'ptr' ? this.heap.readString(needle.addr) : '');
        const idx = hs.indexOf(nd);
        if (idx < 0) return NULL_PTR();
        const addr = this.heap.internString(hs.slice(idx));
        return mkPtr(addr);
      }
      case 'strtok': return NULL_PTR(); // not supported properly

      // Memory operations
      case 'memset': {
        const ptr = args[0];
        const val = Number(toBigInt(args[1] ?? mkInt(0)));
        const n = Number(toBigInt(args[2] ?? mkInt(0)));
        if (ptr?.tag === 'ptr') {
          for (let i = 0; i < n; i++) {
            this.heap.writeByte(ptr.addr, i, val);
          }
        }
        return ptr ?? NULL_PTR();
      }
      case 'memcpy': {
        const dst = args[0];
        const src = args[1];
        const n = Number(toBigInt(args[2] ?? mkInt(0)));
        if (dst?.tag === 'ptr' && src?.tag === 'ptr') {
          for (let i = 0; i < n; i++) {
            const b = this.heap.readByte(src.addr, i);
            this.heap.writeByte(dst.addr, i, b);
          }
          // Also copy string/array stores
          const srcStr = this.heap.readString(src.addr);
          if (srcStr) this.heap.writeString(dst.addr, srcStr);
          const srcArr = this.heap.loadArray(src.addr);
          if (srcArr) this.heap.storeArray(dst.addr, [...srcArr]);
        }
        return dst ?? NULL_PTR();
      }
      case 'memmove': return this.callBuiltin('memcpy', args, rawArgs, scope)!;
      case 'memcmp': {
        const a = args[0];
        const b = args[1];
        const n = Number(toBigInt(args[2] ?? mkInt(0)));
        for (let i = 0; i < n; i++) {
          const ba = a?.tag === 'ptr' ? this.heap.readByte(a.addr, i) : 0;
          const bb = b?.tag === 'ptr' ? this.heap.readByte(b.addr, i) : 0;
          if (ba !== bb) return mkInt(ba - bb);
        }
        return mkInt(0);
      }

      // Math
      case 'sqrt': return mkFloat(Math.sqrt(toNumber(args[0] ?? mkFloat(0))));
      case 'sqrtf': return mkFloat(Math.sqrt(toNumber(args[0] ?? mkFloat(0))));
      case 'abs': return mkInt(Math.abs(Number(toBigInt(args[0] ?? mkInt(0)))));
      case 'fabs': case 'fabsf': return mkFloat(Math.abs(toNumber(args[0] ?? mkFloat(0))));
      case 'pow': case 'powf': return mkFloat(Math.pow(toNumber(args[0] ?? mkFloat(0)), toNumber(args[1] ?? mkFloat(0))));
      case 'floor': case 'floorf': return mkFloat(Math.floor(toNumber(args[0] ?? mkFloat(0))));
      case 'ceil': case 'ceilf': return mkFloat(Math.ceil(toNumber(args[0] ?? mkFloat(0))));
      case 'round': case 'roundf': return mkFloat(Math.round(toNumber(args[0] ?? mkFloat(0))));
      case 'sin': case 'sinf': return mkFloat(Math.sin(toNumber(args[0] ?? mkFloat(0))));
      case 'cos': case 'cosf': return mkFloat(Math.cos(toNumber(args[0] ?? mkFloat(0))));
      case 'tan': case 'tanf': return mkFloat(Math.tan(toNumber(args[0] ?? mkFloat(0))));
      case 'asin': case 'asinf': return mkFloat(Math.asin(toNumber(args[0] ?? mkFloat(0))));
      case 'acos': case 'acosf': return mkFloat(Math.acos(toNumber(args[0] ?? mkFloat(0))));
      case 'atan': case 'atanf': return mkFloat(Math.atan(toNumber(args[0] ?? mkFloat(0))));
      case 'atan2': case 'atan2f': return mkFloat(Math.atan2(toNumber(args[0] ?? mkFloat(0)), toNumber(args[1] ?? mkFloat(0))));
      case 'log': case 'logf': return mkFloat(Math.log(toNumber(args[0] ?? mkFloat(0))));
      case 'log2': case 'log2f': return mkFloat(Math.log2(toNumber(args[0] ?? mkFloat(0))));
      case 'log10': case 'log10f': return mkFloat(Math.log10(toNumber(args[0] ?? mkFloat(0))));
      case 'exp': case 'expf': return mkFloat(Math.exp(toNumber(args[0] ?? mkFloat(0))));
      case 'fmod': case 'fmodf': return mkFloat(toNumber(args[0] ?? mkFloat(0)) % toNumber(args[1] ?? mkFloat(1)));
      case 'hypot': case 'hypotf': return mkFloat(Math.hypot(toNumber(args[0] ?? mkFloat(0)), toNumber(args[1] ?? mkFloat(0))));
      case 'max': case 'fmax': {
        const a = toNumber(args[0] ?? mkFloat(0));
        const b = toNumber(args[1] ?? mkFloat(0));
        return mkFloat(Math.max(a, b));
      }
      case 'min': case 'fmin': {
        const a = toNumber(args[0] ?? mkFloat(0));
        const b = toNumber(args[1] ?? mkFloat(0));
        return mkFloat(Math.min(a, b));
      }

      // Conversion
      case 'atoi': {
        const s = args[0];
        const str = s?.tag === 'str' ? s.s : (s?.tag === 'ptr' ? this.heap.readString(s.addr) : '0');
        return mkInt(parseInt(str.trim(), 10) || 0);
      }
      case 'atol': case 'atoll': {
        const s = args[0];
        const str = s?.tag === 'str' ? s.s : (s?.tag === 'ptr' ? this.heap.readString(s.addr) : '0');
        return mkInt(parseInt(str.trim(), 10) || 0);
      }
      case 'atof': {
        const s = args[0];
        const str = s?.tag === 'str' ? s.s : (s?.tag === 'ptr' ? this.heap.readString(s.addr) : '0');
        return mkFloat(parseFloat(str.trim()) || 0);
      }
      case 'strtol': case 'strtoul': case 'strtoll': case 'strtoull': {
        const s = args[0];
        const str = s?.tag === 'str' ? s.s : (s?.tag === 'ptr' ? this.heap.readString(s.addr) : '0');
        const base = Number(toBigInt(args[2] ?? mkInt(10)));
        return mkInt(parseInt(str.trim(), base || 10) || 0);
      }
      case 'strtod': case 'strtof': {
        const s = args[0];
        const str = s?.tag === 'str' ? s.s : (s?.tag === 'ptr' ? this.heap.readString(s.addr) : '0');
        return mkFloat(parseFloat(str.trim()) || 0);
      }
      case 'itoa': {
        const n = Number(toBigInt(args[0] ?? mkInt(0)));
        const buf = args[1];
        const base = Number(toBigInt(args[2] ?? mkInt(10)));
        const str = n.toString(base);
        if (buf?.tag === 'ptr') this.heap.writeString(buf.addr, str);
        return buf ?? NULL_PTR();
      }

      // Random
      case 'rand': return mkInt((Math.random() * 32767) | 0);
      case 'srand': return VOID;
      case 'random': return mkInt((Math.random() * 2147483647) | 0);
      case 'srandom': return VOID;

      // Process control
      case 'exit': {
        const code = Number(toBigInt(args[0] ?? mkInt(0)));
        if (this.captureOutput) {
          throw new ExitSignal(code);
        } else {
          process.exit(code);
        }
      }
      case 'abort': {
        this.writeStderr('Aborted\n');
        if (this.captureOutput) throw new ExitSignal(134);
        process.exit(134);
      }
      case 'assert': {
        const cond = args[0];
        if (!isTruthy(cond)) {
          this.writeStderr('Assertion failed\n');
          if (this.captureOutput) throw new ExitSignal(1);
          process.exit(1);
        }
        return VOID;
      }

      // Type checking / misc
      case 'isdigit': return mkBool(/[0-9]/.test(String.fromCharCode(toNumber(args[0] ?? mkInt(0)))));
      case 'isalpha': return mkBool(/[a-zA-Z]/.test(String.fromCharCode(toNumber(args[0] ?? mkInt(0)))));
      case 'isalnum': return mkBool(/[a-zA-Z0-9]/.test(String.fromCharCode(toNumber(args[0] ?? mkInt(0)))));
      case 'isspace': return mkBool(/\s/.test(String.fromCharCode(toNumber(args[0] ?? mkInt(0)))));
      case 'isupper': return mkBool(/[A-Z]/.test(String.fromCharCode(toNumber(args[0] ?? mkInt(0)))));
      case 'islower': return mkBool(/[a-z]/.test(String.fromCharCode(toNumber(args[0] ?? mkInt(0)))));
      case 'ispunct': return mkBool(/[^\w\s]/.test(String.fromCharCode(toNumber(args[0] ?? mkInt(0)))));
      case 'isprint': {
        const c = toNumber(args[0] ?? mkInt(0));
        return mkBool(c >= 32 && c < 127);
      }
      case 'toupper': {
        const c = toNumber(args[0] ?? mkInt(0));
        return mkInt(String.fromCharCode(c).toUpperCase().charCodeAt(0));
      }
      case 'tolower': {
        const c = toNumber(args[0] ?? mkInt(0));
        return mkInt(String.fromCharCode(c).toLowerCase().charCodeAt(0));
      }

      // Unused / not supported
      case 'va_start': case 'va_end': case 'va_arg': case 'va_copy': return VOID;
      case 'sizeof': {
        // shouldn't be called as a function but just in case
        return mkInt(8);
      }

      default:
        return undefined; // not a builtin
    }
  }

  private evalIndex(expr: IndexExpr, scope: Scope): Value {
    const obj = this.evalExpr(expr.object, scope);
    const idx = Number(toBigInt(this.evalExpr(expr.index, scope)));

    if (obj.tag === 'array') {
      return obj.elements[idx] ?? mkInt(0);
    }
    if (obj.tag === 'ptr') {
      // Check heap array
      const arr = this.heap.loadArray(obj.addr);
      if (arr) return arr[idx] ?? mkInt(0);
      // Could be offset-based: each element at addr + idx*stride
      const elemAddr = obj.addr + idx * 8;
      const elemArr = this.heap.loadArray(elemAddr);
      if (elemArr) return elemArr[0] ?? mkInt(0);
      // String indexing
      const s = this.heap.readString(obj.addr);
      if (s.length > 0) return mkInt(s.charCodeAt(idx) || 0);
      return mkInt(0);
    }
    if (obj.tag === 'str') {
      return mkInt(obj.s.charCodeAt(idx) || 0);
    }
    return mkInt(0);
  }

  private evalMember(expr: MemberExpr, scope: Scope): Value {
    const obj = this.evalExpr(expr.object, scope);

    if (expr.arrow) {
      // obj->member (obj is a pointer)
      if (obj.tag === 'ptr') {
        // Check if addr maps to a scope variable with a struct value
        const varRef = this.addrToVar.get(obj.addr);
        if (varRef) {
          const sv = varRef.scope.get(varRef.name);
          if (sv && sv.tag === 'struct') return sv.fields.get(expr.member) ?? mkInt(0);
        }

        const structFields = this.heap.loadStruct(obj.addr);
        if (structFields) return structFields.get(expr.member) ?? mkInt(0);

        return mkInt(0);
      }
      if (obj.tag === 'struct') return obj.fields.get(expr.member) ?? mkInt(0);
      return mkInt(0);
    } else {
      // obj.member
      if (obj.tag === 'struct') return obj.fields.get(expr.member) ?? mkInt(0);
      if (obj.tag === 'ptr') {
        const varRef = this.addrToVar.get(obj.addr);
        if (varRef) {
          const sv = varRef.scope.get(varRef.name);
          if (sv && sv.tag === 'struct') return sv.fields.get(expr.member) ?? mkInt(0);
        }
        const structFields = this.heap.loadStruct(obj.addr);
        if (structFields) return structFields.get(expr.member) ?? mkInt(0);
      }
      return mkInt(0);
    }
  }

  private evalCast(expr: CastExpr, scope: Scope): Value {
    const v = this.evalExpr(expr.expr, scope);
    const target = expr.targetType;

    if (target.pointers > 0) {
      // Cast to pointer
      if (v.tag === 'ptr') return v;
      if (v.tag === 'str') return mkPtr(v.addr);
      if (v.tag === 'array') return mkPtr(v.addr);
      return mkPtr(toNumber(v));
    }

    switch (target.base) {
      case 'int8_t': return mkInt(Number(BigInt.asIntN(8, toBigInt(v))));
      case 'uint8_t': return mkInt(Number(BigInt.asUintN(8, toBigInt(v))));
      case 'int16_t': return mkInt(Number(BigInt.asIntN(16, toBigInt(v))));
      case 'uint16_t': return mkInt(Number(BigInt.asUintN(16, toBigInt(v))));
      case 'int32_t': return mkInt(Number(BigInt.asIntN(32, toBigInt(v))));
      case 'uint32_t': return mkInt(Number(BigInt.asUintN(32, toBigInt(v))));
      case 'int64_t': return mkInt(toBigInt(v));
      case 'uint64_t': return mkInt(BigInt.asUintN(64, toBigInt(v)));
      case 'float': case 'double': return mkFloat(toNumber(v));
      case 'char': return mkInt(Number(BigInt.asIntN(8, toBigInt(v))));
      case 'bool': return mkBool(isTruthy(v));
      case 'void': return VOID;
      default: return v;
    }
  }

  private evalSizeof(expr: SizeofExpr, scope: Scope): Value {
    if (expr.isType) {
      const t = expr.operand as TypeNode;
      return mkInt(sizeofType(t));
    }
    // sizeof(expr) — evaluate type from expression
    const v = this.evalExpr(expr.operand as Expr, scope);
    switch (v.tag) {
      case 'i64': return mkInt(8);
      case 'f64': return mkInt(8);
      case 'ptr': return mkInt(8);
      case 'str': return mkInt(v.s.length + 1);
      case 'bool': return mkInt(1);
      case 'struct': return mkInt(v.fields.size * 8);
      case 'array': return mkInt(v.elements.length * 8);
      default: return mkInt(0);
    }
  }

  private evalInitList(expr: InitListExpr, scope: Scope): Value {
    // Used for struct/array initialization
    const elements = expr.elements.map(e => this.evalExpr(e, scope));

    // If it's being used in a struct context, we can't know the field names here
    // Return as an array; the VarDecl handler will match to struct fields
    const addr = this.heap.allocate(elements.length * 8);
    this.heap.storeArray(addr, elements);
    return { tag: 'array', elements, addr };
  }
}

// ─── Handle struct initialization from InitList ────────────────────────────

// We need to patch VarDecl execution to handle struct init lists
// This is done in the Interpreter class above via the defaultValue + init logic

// ─── Interpreter Instance Helper ──────────────────────────────────────────────

// Override execVarDecl to handle struct init from init list
// This is already handled in the Interpreter class.

// ─── Public API ──────────────────────────────────────────────────────────────

export function interpret(pearSource: string, argv?: string[]): number {
  const interp = new Interpreter();
  const result = interp.run(pearSource, argv);
  return result.exitCode;
}
