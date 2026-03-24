// Pear Language Code Generator
// Transforms AST → C source code

import {
  ASTNode, Program, IncludeDirective, DefineDirective, PragmaDirective,
  IncludeGuardStart, IncludeGuardEnd, RawPreprocessor, FunctionDecl,
  StructDecl, UnionDecl, EnumDecl, TypedefDecl, VarDecl, BlockStmt,
  IfStmt, ForStmt, WhileStmt, DoWhileStmt, SwitchStmt, CaseStmt,
  DefaultStmt, ReturnStmt, BreakStmt, ContinueStmt, GotoStmt, LabelStmt,
  ExprStmt, TypeNode, ParamDecl, FieldDecl,
  Expr, NumberLiteral, StringLiteral, CharLiteral, BoolLiteral, NullLiteral,
  Identifier, BinaryExpr, UnaryExpr, PostfixExpr, AssignExpr, TernaryExpr,
  CallExpr, IndexExpr, MemberExpr, CastExpr, SizeofExpr, InitListExpr,
} from './parser';

// Types that need stdint.h
const STDINT_TYPES = new Set(['int8_t', 'int16_t', 'int32_t', 'int64_t', 'uint8_t', 'uint16_t', 'uint32_t', 'uint64_t']);
// Types that need stdbool.h
const STDBOOL_TYPES = new Set(['bool']);
// Types that need stddef.h (size_t) — often included via stdio/stdlib
const STDDEF_TYPES = new Set(['size_t']);

export class CodeGenerator {
  private output: string[] = [];
  private indent: number = 0;
  private needsStdint: boolean = false;
  private needsStdbool: boolean = false;
  private hasStdint: boolean = false;
  private hasStdbool: boolean = false;

  generate(program: Program): string {
    // First pass: detect required headers
    this.detectRequiredHeaders(program);

    // Generate each top-level node
    for (const node of program.body) {
      this.genNode(node);
    }

    // Prepend missing headers
    const headers: string[] = [];
    if (this.needsStdint && !this.hasStdint) headers.push('#include <stdint.h>');
    if (this.needsStdbool && !this.hasStdbool) headers.push('#include <stdbool.h>');

    const code = this.output.join('');
    if (headers.length > 0) {
      return headers.join('\n') + '\n' + code;
    }
    return code;
  }

  private detectRequiredHeaders(node: ASTNode | TypeNode | Expr): void {
    if (!node || typeof node !== 'object') return;

    if ('kind' in node) {
      switch ((node as ASTNode).kind) {
        case 'Program':
          (node as Program).body.forEach(n => this.detectRequiredHeaders(n));
          break;
        case 'IncludeDirective': {
          const inc = node as IncludeDirective;
          if (inc.path === '<stdint.h>' || inc.path === '"stdint.h"') this.hasStdint = true;
          if (inc.path === '<stdbool.h>' || inc.path === '"stdbool.h"') this.hasStdbool = true;
          break;
        }
        case 'VarDecl': {
          const vd = node as VarDecl;
          this.checkTypeForHeaders(vd.type);
          if (vd.init) this.detectRequiredHeaders(vd.init);
          break;
        }
        case 'FunctionDecl': {
          const fd = node as FunctionDecl;
          this.checkTypeForHeaders(fd.returnType);
          fd.params.forEach(p => this.checkTypeForHeaders(p.type));
          if (fd.body) this.detectRequiredHeaders(fd.body);
          break;
        }
        case 'StructDecl':
        case 'UnionDecl': {
          const sd = node as StructDecl | UnionDecl;
          sd.fields.forEach(f => this.checkTypeForHeaders(f.type));
          break;
        }
        case 'BlockStmt':
          (node as BlockStmt).body.forEach(n => this.detectRequiredHeaders(n));
          break;
        case 'IfStmt': {
          const is = node as IfStmt;
          this.detectRequiredHeaders(is.condition);
          this.detectRequiredHeaders(is.consequent);
          if (is.alternate) this.detectRequiredHeaders(is.alternate);
          break;
        }
        case 'ReturnStmt':
          if ((node as ReturnStmt).value) this.detectRequiredHeaders((node as ReturnStmt).value!);
          break;
        case 'ExprStmt':
          this.detectRequiredHeaders((node as ExprStmt).expr);
          break;
        case 'ForStmt': {
          const fs = node as ForStmt;
          if (fs.init) this.detectRequiredHeaders(fs.init);
          if (fs.condition) this.detectRequiredHeaders(fs.condition);
          if (fs.update) this.detectRequiredHeaders(fs.update);
          this.detectRequiredHeaders(fs.body);
          break;
        }
        case 'WhileStmt':
          this.detectRequiredHeaders((node as WhileStmt).condition);
          this.detectRequiredHeaders((node as WhileStmt).body);
          break;
        default:
          break;
      }
    }
  }

  private checkTypeForHeaders(type: TypeNode): void {
    if (STDINT_TYPES.has(type.base)) this.needsStdint = true;
    if (STDBOOL_TYPES.has(type.base)) this.needsStdbool = true;
  }

  private emit(s: string): void {
    this.output.push(s);
  }

  private emitIndent(): void {
    this.emit('  '.repeat(this.indent));
  }

  // Format a type for C output
  // In C: qualifiers + base + pointers
  // For declarations we need: type varname or type *varname
  private formatType(type: TypeNode, varName = '', forParam = false): string {
    const parts: string[] = [];

    if (type.isStatic && !forParam) parts.push('static');
    if (type.isExtern && !forParam) parts.push('extern');
    if (type.isInline && !forParam) parts.push('inline');
    if (type.isConst) parts.push('const');
    if (type.isVolatile) parts.push('volatile');

    parts.push(type.base);

    let ptr = '*'.repeat(type.pointers);
    if (ptr && type.isConst) {
      // const pointer: type * const varname
      // For simplicity, just put const before type
    }

    let name = varName ? ' ' + ptr + varName : (ptr ? ' ' + ptr : '');
    if (type.arraySize) {
      const sizeStr = this.genExprStr(type.arraySize);
      name = (varName ? ' ' + ptr + varName : '') + '[' + sizeStr + ']';
    } else if (ptr && !varName) {
      name = ' ' + ptr;
    }

    return parts.join(' ') + name;
  }

  private genNode(node: ASTNode): void {
    switch (node.kind) {
      case 'Program':
        (node as Program).body.forEach(n => this.genNode(n));
        break;

      case 'IncludeDirective':
        this.emit('#include ' + (node as IncludeDirective).path + '\n');
        break;

      case 'DefineDirective': {
        const def = node as DefineDirective;
        if (def.params !== null) {
          this.emit('#define ' + def.name + '(' + def.params.join(',') + ') ' + def.body + '\n');
        } else {
          this.emit('#define ' + def.name + (def.body ? ' ' + def.body : '') + '\n');
        }
        break;
      }

      case 'PragmaDirective':
        this.emit('#pragma ' + (node as PragmaDirective).value + '\n');
        break;

      case 'IncludeGuardStart': {
        const ig = node as IncludeGuardStart;
        this.emit('#ifndef ' + ig.name + '\n');
        this.emit('#define ' + ig.name + '\n');
        break;
      }

      case 'IncludeGuardEnd':
        this.emit('#endif\n');
        break;

      case 'RawPreprocessor':
        this.emit((node as RawPreprocessor).text + '\n');
        break;

      case 'FunctionDecl':
        this.genFunction(node as FunctionDecl);
        break;

      case 'StructDecl':
        this.genStruct(node as StructDecl);
        break;

      case 'UnionDecl':
        this.genUnion(node as UnionDecl);
        break;

      case 'EnumDecl':
        this.genEnum(node as EnumDecl);
        break;

      case 'TypedefDecl':
        this.genTypedef(node as TypedefDecl);
        break;

      case 'VarDecl':
        this.emitIndent();
        this.genVarDecl(node as VarDecl);
        this.emit(';\n');
        break;

      case 'BlockStmt':
        this.genBlock(node as BlockStmt);
        break;

      case 'IfStmt':
        this.genIf(node as IfStmt);
        break;

      case 'ForStmt':
        this.genFor(node as ForStmt);
        break;

      case 'WhileStmt':
        this.emitIndent();
        this.emit('while(');
        this.emit(this.genExprStr((node as WhileStmt).condition));
        this.emit(')');
        this.genBodyStmt((node as WhileStmt).body);
        break;

      case 'DoWhileStmt':
        this.emitIndent();
        this.emit('do');
        this.genBodyStmt((node as DoWhileStmt).body, true);
        this.emit('while(');
        this.emit(this.genExprStr((node as DoWhileStmt).condition));
        this.emit(');\n');
        break;

      case 'SwitchStmt':
        this.emitIndent();
        this.emit('switch(');
        this.emit(this.genExprStr((node as SwitchStmt).expr));
        this.emit(')');
        this.genBodyStmt((node as SwitchStmt).body);
        break;

      case 'CaseStmt': {
        const cs = node as CaseStmt;
        this.emitIndent();
        this.emit('case ' + this.genExprStr(cs.value) + ':\n');
        this.indent++;
        cs.body.forEach(s => this.genNode(s));
        this.indent--;
        break;
      }

      case 'DefaultStmt': {
        const ds = node as DefaultStmt;
        this.emitIndent();
        this.emit('default:\n');
        this.indent++;
        ds.body.forEach(s => this.genNode(s));
        this.indent--;
        break;
      }

      case 'ReturnStmt': {
        const rs = node as ReturnStmt;
        this.emitIndent();
        if (rs.value) {
          this.emit('return ' + this.genExprStr(rs.value) + ';\n');
        } else {
          this.emit('return;\n');
        }
        break;
      }

      case 'BreakStmt':
        this.emitIndent();
        this.emit('break;\n');
        break;

      case 'ContinueStmt':
        this.emitIndent();
        this.emit('continue;\n');
        break;

      case 'GotoStmt':
        this.emitIndent();
        this.emit('goto ' + (node as GotoStmt).label + ';\n');
        break;

      case 'LabelStmt': {
        const ls = node as LabelStmt;
        this.emit(ls.label + ':\n');
        this.genNode(ls.body);
        break;
      }

      case 'ExprStmt':
        this.emitIndent();
        this.emit(this.genExprStr((node as ExprStmt).expr) + ';\n');
        break;

      default:
        // Expression node used as statement
        if ('kind' in node) {
          const n = node as Expr;
          this.emitIndent();
          this.emit(this.genExprStr(n) + ';\n');
        }
        break;
    }
  }

  private genBodyStmt(body: ASTNode, forDoWhile = false): void {
    if (body.kind === 'BlockStmt') {
      if (forDoWhile) {
        this.emit('{\n');
        this.indent++;
        (body as BlockStmt).body.forEach(s => this.genNode(s));
        this.indent--;
        this.emitIndent();
        this.emit('}');
      } else {
        this.emit('{\n');
        this.indent++;
        (body as BlockStmt).body.forEach(s => this.genNode(s));
        this.indent--;
        this.emitIndent();
        this.emit('}\n');
      }
    } else {
      if (forDoWhile) {
        this.emit('\n');
        this.indent++;
        this.genNode(body);
        this.indent--;
        this.emitIndent();
      } else {
        this.emit('\n');
        this.indent++;
        this.genNode(body);
        this.indent--;
      }
    }
  }

  private genVarDecl(vd: VarDecl): void {
    const qualParts: string[] = [];
    vd.qualifiers.forEach(q => {
      if (q === 'sc') qualParts.push('static');
      else if (q === 'ex') qualParts.push('extern');
      else if (q === 'in') qualParts.push('inline');
      else if (q === 'cn') qualParts.push('const');
      else if (q === 'vl') qualParts.push('volatile');
      else qualParts.push(q);
    });

    const typeStr = this.formatType(vd.type, vd.name);
    const prefix = qualParts.length ? qualParts.join(' ') + ' ' : '';
    this.emit(prefix + typeStr);

    if (vd.init) {
      this.emit('=' + this.genExprStr(vd.init));
    }
  }

  private genFunction(fd: FunctionDecl): void {
    const qualParts: string[] = [];
    if (fd.qualifiers) {
      fd.qualifiers.forEach(q => {
        if (q === 'sc') qualParts.push('static');
        else if (q === 'in') qualParts.push('inline');
        else qualParts.push(q);
      });
    }
    if (fd.returnType.isStatic) qualParts.push('static');
    if (fd.returnType.isInline) qualParts.push('inline');
    if (fd.returnType.isExtern) qualParts.push('extern');

    const retTypeStr = this.formatType({ ...fd.returnType, isStatic: false, isInline: false, isExtern: false });
    const prefix = qualParts.length ? qualParts.join(' ') + ' ' : '';

    const params = fd.params.map(p => {
      if (p.isVararg) return '...';
      return this.formatType(p.type, p.name, true);
    }).join(',');

    this.emit(prefix + retTypeStr + ' ' + fd.name + '(' + params + ')');

    if (fd.body) {
      this.emit('{\n');
      this.indent++;
      fd.body.body.forEach(s => this.genNode(s));
      this.indent--;
      this.emit('}\n');
    } else {
      this.emit(';\n');
    }
  }

  private genStruct(sd: StructDecl): void {
    const name = sd.name ?? '';
    if (sd.isTypedef) {
      this.emit('typedef struct ' + name + '{\n');
    } else {
      this.emit('struct ' + name + '{\n');
    }
    this.indent++;
    sd.fields.forEach(f => {
      this.emitIndent();
      this.emit(this.formatType(f.type, f.name));
      if (f.bitfield) this.emit(':' + this.genExprStr(f.bitfield));
      this.emit(';\n');
    });
    this.indent--;
    if (sd.isTypedef && sd.typedefName) {
      this.emit('} ' + sd.typedefName + ';\n');
    } else {
      this.emit('};\n');
    }
  }

  private genUnion(ud: UnionDecl): void {
    const name = ud.name ?? '';
    if (ud.isTypedef) {
      this.emit('typedef union ' + name + '{\n');
    } else {
      this.emit('union ' + name + '{\n');
    }
    this.indent++;
    ud.fields.forEach(f => {
      this.emitIndent();
      this.emit(this.formatType(f.type, f.name));
      this.emit(';\n');
    });
    this.indent--;
    if (ud.isTypedef && ud.typedefName) {
      this.emit('} ' + ud.typedefName + ';\n');
    } else {
      this.emit('};\n');
    }
  }

  private genEnum(ed: EnumDecl): void {
    const name = ed.name ?? '';
    if (ed.isTypedef) {
      this.emit('typedef enum ' + name + '{\n');
    } else {
      this.emit('enum ' + name + '{\n');
    }
    this.indent++;
    ed.members.forEach((m, i) => {
      this.emitIndent();
      this.emit(m.name);
      if (m.value) this.emit('=' + this.genExprStr(m.value));
      if (i < ed.members.length - 1) this.emit(',');
      this.emit('\n');
    });
    this.indent--;
    if (ed.isTypedef && ed.typedefName) {
      this.emit('} ' + ed.typedefName + ';\n');
    } else {
      this.emit('};\n');
    }
  }

  private genTypedef(td: TypedefDecl): void {
    const inner = td.inner;
    if (inner.kind === 'VarDecl') {
      const vd = inner as VarDecl;
      this.emit('typedef ' + this.formatType(vd.type) + ' ' + td.alias + ';\n');
    } else {
      this.genNode(inner);
    }
  }

  private genBlock(block: BlockStmt): void {
    this.emit('{\n');
    this.indent++;
    block.body.forEach(s => this.genNode(s));
    this.indent--;
    this.emitIndent();
    this.emit('}\n');
  }

  private genIf(is: IfStmt): void {
    this.emitIndent();
    this.emit('if(' + this.genExprStr(is.condition) + ')');
    if (is.consequent.kind === 'BlockStmt') {
      this.emit('{\n');
      this.indent++;
      (is.consequent as BlockStmt).body.forEach(s => this.genNode(s));
      this.indent--;
      this.emitIndent();
      this.emit('}');
    } else {
      this.emit('\n');
      this.indent++;
      this.genNode(is.consequent);
      this.indent--;
      this.emitIndent();
    }

    if (is.alternate) {
      if (is.alternate.kind === 'IfStmt') {
        this.emit('else ');
        this.indent = this.indent; // no change
        // inline the else-if without indent prefix
        const savedOutput = this.output;
        this.output = [];
        this.genIf(is.alternate as IfStmt);
        const elseIfStr = this.output.join('').trimStart();
        this.output = savedOutput;
        this.emit(elseIfStr);
        return;
      } else if (is.alternate.kind === 'BlockStmt') {
        this.emit('else{\n');
        this.indent++;
        (is.alternate as BlockStmt).body.forEach(s => this.genNode(s));
        this.indent--;
        this.emitIndent();
        this.emit('}\n');
      } else {
        this.emit('else\n');
        this.indent++;
        this.genNode(is.alternate);
        this.indent--;
      }
    } else {
      this.emit('\n');
    }
  }

  private genFor(fs: ForStmt): void {
    this.emitIndent();
    this.emit('for(');

    if (fs.init) {
      if (fs.init.kind === 'VarDecl') {
        const vd = fs.init as VarDecl;
        this.emit(this.formatType(vd.type, vd.name));
        if (vd.init) this.emit('=' + this.genExprStr(vd.init));
      } else if (fs.init.kind === 'ExprStmt') {
        this.emit(this.genExprStr((fs.init as ExprStmt).expr));
      }
    }
    this.emit(';');

    if (fs.condition) this.emit(this.genExprStr(fs.condition));
    this.emit(';');

    if (fs.update) this.emit(this.genExprStr(fs.update));
    this.emit(')');

    if (fs.body.kind === 'BlockStmt') {
      this.emit('{\n');
      this.indent++;
      (fs.body as BlockStmt).body.forEach(s => this.genNode(s));
      this.indent--;
      this.emitIndent();
      this.emit('}\n');
    } else {
      this.emit('\n');
      this.indent++;
      this.genNode(fs.body);
      this.indent--;
    }
  }

  // Generate expression as a string (no side effects on output buffer)
  genExprStr(expr: Expr): string {
    switch (expr.kind) {
      case 'NumberLiteral': return (expr as NumberLiteral).value;
      case 'StringLiteral': return (expr as StringLiteral).value;
      case 'CharLiteral': return (expr as CharLiteral).value;
      case 'BoolLiteral': return (expr as BoolLiteral).value ? 'true' : 'false';
      case 'NullLiteral': return 'NULL';
      case 'Identifier': return (expr as Identifier).name;

      case 'BinaryExpr': {
        const be = expr as BinaryExpr;
        return this.genExprStr(be.left) + be.op + this.genExprStr(be.right);
      }

      case 'UnaryExpr': {
        const ue = expr as UnaryExpr;
        if (ue.prefix) return ue.op + this.genExprStr(ue.operand);
        return this.genExprStr(ue.operand) + ue.op;
      }

      case 'PostfixExpr': {
        const pe = expr as PostfixExpr;
        return this.genExprStr(pe.operand) + pe.op;
      }

      case 'AssignExpr': {
        const ae = expr as AssignExpr;
        return this.genExprStr(ae.left) + ae.op + this.genExprStr(ae.right);
      }

      case 'TernaryExpr': {
        const te = expr as TernaryExpr;
        return this.genExprStr(te.condition) + '?' + this.genExprStr(te.consequent) + ':' + this.genExprStr(te.alternate);
      }

      case 'CallExpr': {
        const ce = expr as CallExpr;
        const args = ce.args.map(a => this.genExprStr(a)).join(',');
        return this.genExprStr(ce.callee) + '(' + args + ')';
      }

      case 'IndexExpr': {
        const ie = expr as IndexExpr;
        return this.genExprStr(ie.object) + '[' + this.genExprStr(ie.index) + ']';
      }

      case 'MemberExpr': {
        const me = expr as MemberExpr;
        return this.genExprStr(me.object) + (me.arrow ? '->' : '.') + me.member;
      }

      case 'CastExpr': {
        const ce = expr as CastExpr;
        return '(' + this.formatType(ce.targetType) + ')' + this.genExprStr(ce.expr);
      }

      case 'SizeofExpr': {
        const se = expr as SizeofExpr;
        if (se.isType) {
          return 'sizeof(' + this.formatType(se.operand as TypeNode) + ')';
        }
        return 'sizeof(' + this.genExprStr(se.operand as Expr) + ')';
      }

      case 'InitListExpr': {
        const il = expr as InitListExpr;
        return '{' + il.elements.map(e => this.genExprStr(e)).join(',') + '}';
      }

      default:
        return '/* unknown expr */';
    }
  }
}

export function generate(program: import('./parser').Program): string {
  const gen = new CodeGenerator();
  return gen.generate(program);
}
