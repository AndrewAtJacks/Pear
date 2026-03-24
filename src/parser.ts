// Pear Language Parser
// Recursive descent parser producing an AST

import { Token, TokenType, Lexer } from './lexer';

// ─── AST Node Types ──────────────────────────────────────────────────────────

export type ASTNode =
  | Program
  | IncludeDirective
  | DefineDirective
  | PragmaDirective
  | IncludeGuardStart
  | IncludeGuardEnd
  | RawPreprocessor
  | FunctionDecl
  | StructDecl
  | UnionDecl
  | EnumDecl
  | TypedefDecl
  | VarDecl
  | BlockStmt
  | IfStmt
  | ForStmt
  | WhileStmt
  | DoWhileStmt
  | SwitchStmt
  | CaseStmt
  | DefaultStmt
  | ReturnStmt
  | BreakStmt
  | ContinueStmt
  | GotoStmt
  | LabelStmt
  | ExprStmt
  | Expr;

export interface Program {
  kind: 'Program';
  body: ASTNode[];
}

export interface IncludeDirective {
  kind: 'IncludeDirective';
  path: string; // e.g. "<stdio.h>" or '"myfile.h"'
}

export interface DefineDirective {
  kind: 'DefineDirective';
  name: string;
  params: string[] | null; // null if not a function-like macro
  body: string;
}

export interface PragmaDirective {
  kind: 'PragmaDirective';
  value: string;
}

export interface IncludeGuardStart {
  kind: 'IncludeGuardStart';
  name: string;
}

export interface IncludeGuardEnd {
  kind: 'IncludeGuardEnd';
}

export interface RawPreprocessor {
  kind: 'RawPreprocessor';
  text: string; // full line including #
}

export interface TypeNode {
  base: string;         // 'i32', 'f64', 'void', etc.
  pointers: number;     // number of * levels
  isConst: boolean;
  isVolatile: boolean;
  isStatic: boolean;
  isExtern: boolean;
  isInline: boolean;
  arraySize: Expr | null; // if this is an array type
}

export interface ParamDecl {
  name: string;
  type: TypeNode;
  isVararg?: boolean;
}

export interface FunctionDecl {
  kind: 'FunctionDecl';
  name: string;
  params: ParamDecl[];
  returnType: TypeNode;
  body: BlockStmt | null; // null = forward declaration
  qualifiers: string[];
}

export interface StructDecl {
  kind: 'StructDecl';
  name: string | null;
  fields: FieldDecl[];
  isTypedef: boolean;
  typedefName: string | null;
}

export interface UnionDecl {
  kind: 'UnionDecl';
  name: string | null;
  fields: FieldDecl[];
  isTypedef: boolean;
  typedefName: string | null;
}

export interface FieldDecl {
  name: string;
  type: TypeNode;
  bitfield?: Expr;
}

export interface EnumDecl {
  kind: 'EnumDecl';
  name: string | null;
  members: EnumMember[];
  isTypedef: boolean;
  typedefName: string | null;
}

export interface EnumMember {
  name: string;
  value: Expr | null;
}

export interface TypedefDecl {
  kind: 'TypedefDecl';
  inner: ASTNode; // the thing being typedef'd
  alias: string;
}

export interface VarDecl {
  kind: 'VarDecl';
  name: string;
  type: TypeNode;
  init: Expr | null;
  qualifiers: string[];
}

export interface BlockStmt {
  kind: 'BlockStmt';
  body: ASTNode[];
}

export interface IfStmt {
  kind: 'IfStmt';
  condition: Expr;
  consequent: ASTNode;
  alternate: ASTNode | null; // else or else-if
}

export interface ForStmt {
  kind: 'ForStmt';
  init: ASTNode | null;
  condition: Expr | null;
  update: Expr | null;
  body: ASTNode;
}

export interface WhileStmt {
  kind: 'WhileStmt';
  condition: Expr;
  body: ASTNode;
}

export interface DoWhileStmt {
  kind: 'DoWhileStmt';
  body: ASTNode;
  condition: Expr;
}

export interface SwitchStmt {
  kind: 'SwitchStmt';
  expr: Expr;
  body: ASTNode;
}

export interface CaseStmt {
  kind: 'CaseStmt';
  value: Expr;
  body: ASTNode[];
}

export interface DefaultStmt {
  kind: 'DefaultStmt';
  body: ASTNode[];
}

export interface ReturnStmt {
  kind: 'ReturnStmt';
  value: Expr | null;
}

export interface BreakStmt {
  kind: 'BreakStmt';
}

export interface ContinueStmt {
  kind: 'ContinueStmt';
}

export interface GotoStmt {
  kind: 'GotoStmt';
  label: string;
}

export interface LabelStmt {
  kind: 'LabelStmt';
  label: string;
  body: ASTNode;
}

export interface ExprStmt {
  kind: 'ExprStmt';
  expr: Expr;
}

export type Expr =
  | NumberLiteral
  | StringLiteral
  | CharLiteral
  | BoolLiteral
  | NullLiteral
  | Identifier
  | BinaryExpr
  | UnaryExpr
  | PostfixExpr
  | AssignExpr
  | TernaryExpr
  | CallExpr
  | IndexExpr
  | MemberExpr
  | CastExpr
  | SizeofExpr
  | InitListExpr
  | FuncPtrExpr;

export interface NumberLiteral { kind: 'NumberLiteral'; value: string; }
export interface StringLiteral { kind: 'StringLiteral'; value: string; }
export interface CharLiteral { kind: 'CharLiteral'; value: string; }
export interface BoolLiteral { kind: 'BoolLiteral'; value: boolean; }
export interface NullLiteral { kind: 'NullLiteral'; }
export interface Identifier { kind: 'Identifier'; name: string; }
export interface BinaryExpr { kind: 'BinaryExpr'; op: string; left: Expr; right: Expr; }
export interface UnaryExpr { kind: 'UnaryExpr'; op: string; operand: Expr; prefix: boolean; }
export interface PostfixExpr { kind: 'PostfixExpr'; op: string; operand: Expr; }
export interface AssignExpr { kind: 'AssignExpr'; op: string; left: Expr; right: Expr; }
export interface TernaryExpr { kind: 'TernaryExpr'; condition: Expr; consequent: Expr; alternate: Expr; }
export interface CallExpr { kind: 'CallExpr'; callee: Expr; args: Expr[]; }
export interface IndexExpr { kind: 'IndexExpr'; object: Expr; index: Expr; }
export interface MemberExpr { kind: 'MemberExpr'; object: Expr; member: string; arrow: boolean; }
export interface CastExpr { kind: 'CastExpr'; targetType: TypeNode; expr: Expr; }
export interface SizeofExpr { kind: 'SizeofExpr'; operand: Expr | TypeNode; isType: boolean; }
export interface InitListExpr { kind: 'InitListExpr'; elements: Expr[]; }
export interface FuncPtrExpr { kind: 'FuncPtrExpr'; name: string; params: ParamDecl[]; returnType: TypeNode; }

// ─── Parser ──────────────────────────────────────────────────────────────────

const TYPE_KEYWORDS = new Set([
  TokenType.I8, TokenType.I16, TokenType.I32, TokenType.I64,
  TokenType.U8, TokenType.U16, TokenType.U32, TokenType.U64,
  TokenType.F32, TokenType.F64,
  TokenType.V, TokenType.C, TokenType.B, TokenType.SZ,
]);

const PEAR_TYPE_MAP: Record<string, string> = {
  i8: 'int8_t',
  i16: 'int16_t',
  i32: 'int32_t',
  i64: 'int64_t',
  u8: 'uint8_t',
  u16: 'uint16_t',
  u32: 'uint32_t',
  u64: 'uint64_t',
  f32: 'float',
  f64: 'double',
  v: 'void',
  c: 'char',
  b: 'bool',
  sz: 'size_t',
};

export { PEAR_TYPE_MAP };

export class Parser {
  private tokens: Token[];
  private pos: number = 0;

  constructor(tokens: Token[]) {
    // Filter newlines for the parser (they're only relevant for preprocessor which we handle specially)
    this.tokens = tokens.filter(t => t.type !== TokenType.NEWLINE);
  }

  private peek(offset = 0): Token {
    const idx = this.pos + offset;
    return this.tokens[idx] ?? { type: TokenType.EOF, value: '', line: 0, col: 0 };
  }

  private advance(): Token {
    const tok = this.tokens[this.pos];
    this.pos++;
    return tok;
  }

  private check(...types: TokenType[]): boolean {
    return types.includes(this.peek().type);
  }

  private eat(type: TokenType): Token {
    const tok = this.peek();
    if (tok.type !== type) {
      throw new Error(`Expected ${type} but got ${tok.type} ('${tok.value}') at line ${tok.line}:${tok.col}`);
    }
    return this.advance();
  }

  private tryEat(...types: TokenType[]): Token | null {
    if (types.includes(this.peek().type)) return this.advance();
    return null;
  }

  // Accept any token that can serve as an identifier name
  // This handles cases like parameter named 'b', 'c', 'v', 'sz', etc.
  private eatIdent(): Token {
    const tok = this.peek();
    // Allow IDENT plus any short keyword/type that might be used as a name
    const identLike = new Set([
      TokenType.IDENT,
      TokenType.B, TokenType.C, TokenType.V, TokenType.SZ,
      TokenType.I8, TokenType.I16, TokenType.I32, TokenType.I64,
      TokenType.U8, TokenType.U16, TokenType.U32, TokenType.U64,
      TokenType.F32, TokenType.F64,
      // Also allow Pear keywords that might appear as identifiers in context
      TokenType.IN, // 'in' can be a variable name
    ]);
    if (identLike.has(tok.type)) return this.advance();
    throw new Error(`Expected identifier but got ${tok.type} ('${tok.value}') at line ${tok.line}:${tok.col}`);
  }

  // ─── Type Parsing ──────────────────────────────────────────────────────────

  private parseQualifiers(): Pick<TypeNode, 'isConst' | 'isVolatile' | 'isStatic' | 'isExtern' | 'isInline'> {
    let isConst = false, isVolatile = false, isStatic = false, isExtern = false, isInline = false;
    while (true) {
      if (this.tryEat(TokenType.CN)) { isConst = true; continue; }
      if (this.tryEat(TokenType.VL)) { isVolatile = true; continue; }
      if (this.tryEat(TokenType.SC)) { isStatic = true; continue; }
      if (this.tryEat(TokenType.EX)) { isExtern = true; continue; }
      if (this.tryEat(TokenType.IN)) { isInline = true; continue; }
      break;
    }
    return { isConst, isVolatile, isStatic, isExtern, isInline };
  }

  private parseType(): TypeNode {
    const quals = this.parseQualifiers();

    // Additional qualifiers after the first
    let isConst = quals.isConst;
    let isVolatile = quals.isVolatile;

    // Pear supports *T syntax for pointer-to-T (prefix stars)
    let prefixPointers = 0;
    while (this.check(TokenType.STAR)) {
      this.advance();
      prefixPointers++;
    }

    let base = '';

    if (TYPE_KEYWORDS.has(this.peek().type)) {
      const tok = this.advance();
      base = PEAR_TYPE_MAP[tok.value] ?? tok.value;
    } else if (this.check(TokenType.ST)) {
      this.advance();
      const name = this.peek().type === TokenType.IDENT ? this.advance().value : '';
      base = 'struct ' + name;
    } else if (this.check(TokenType.UN)) {
      this.advance();
      const name = this.peek().type === TokenType.IDENT ? this.advance().value : '';
      base = 'union ' + name;
    } else if (this.check(TokenType.EN)) {
      this.advance();
      const name = this.peek().type === TokenType.IDENT ? this.advance().value : '';
      base = 'enum ' + name;
    } else if (this.check(TokenType.IDENT)) {
      base = this.advance().value;
    } else if (prefixPointers > 0) {
      // e.g. *v means void pointer — base type already consumed
      throw new Error(`Expected base type after '*' at line ${this.peek().line}:${this.peek().col}, got '${this.peek().value}'`);
    } else {
      throw new Error(`Expected type at line ${this.peek().line}:${this.peek().col}, got '${this.peek().value}'`);
    }

    // Count trailing pointer levels (C-style, after base type)
    let pointers = prefixPointers;
    while (this.check(TokenType.STAR)) {
      this.advance();
      pointers++;
      // const after * applies to pointer
      if (this.check(TokenType.CN)) { this.advance(); isConst = true; }
    }

    return {
      base,
      pointers,
      isConst,
      isVolatile,
      isStatic: quals.isStatic,
      isExtern: quals.isExtern,
      isInline: quals.isInline,
      arraySize: null,
    };
  }

  // ─── Top Level ─────────────────────────────────────────────────────────────

  parse(): Program {
    const body: ASTNode[] = [];
    while (!this.check(TokenType.EOF)) {
      const node = this.parseTopLevel();
      if (node) body.push(node);
    }
    return { kind: 'Program', body };
  }

  private parseTopLevel(): ASTNode | null {
    // Raw preprocessor (from # tokens)
    if (this.check(TokenType.HASH)) {
      return { kind: 'RawPreprocessor', text: this.advance().value };
    }

    // im <path> or im "path"
    if (this.check(TokenType.IM)) {
      return this.parseInclude();
    }

    // df NAME value
    if (this.check(TokenType.DF)) {
      return this.parseDefine();
    }

    // nd NAME (include guard)
    if (this.check(TokenType.ND)) {
      this.advance();
      const name = this.eat(TokenType.IDENT).value;
      return { kind: 'IncludeGuardStart', name };
    }

    // dn (#endif)
    if (this.check(TokenType.DN)) {
      this.advance();
      return { kind: 'IncludeGuardEnd' };
    }

    // pr value
    if (this.check(TokenType.PR)) {
      this.advance();
      let val = '';
      while (!this.check(TokenType.EOF) && !this.check(TokenType.NEWLINE)) {
        val += this.advance().value + ' ';
      }
      return { kind: 'PragmaDirective', value: val.trim() };
    }

    // tp (typedef)
    if (this.check(TokenType.TP)) {
      return this.parseTypedef();
    }

    // st / un / en at top level (struct/union/enum definition)
    if (this.check(TokenType.ST)) {
      return this.parseStructDecl(false);
    }
    if (this.check(TokenType.UN)) {
      return this.parseUnionDecl(false);
    }
    if (this.check(TokenType.EN)) {
      return this.parseEnumDecl(false);
    }

    // fn (function)
    if (this.check(TokenType.FN)) {
      return this.parseFunctionDecl();
    }

    // Variable declaration at top level (qualifiers + type + name : type)
    // or just a type followed by name
    return this.parseVarOrFuncDecl();
  }

  private parseInclude(): IncludeDirective {
    this.eat(TokenType.IM);
    // path token was already consumed by the lexer and placed as STRING
    const pathTok = this.eat(TokenType.STRING);
    return { kind: 'IncludeDirective', path: pathTok.value };
  }

  private parseDefine(): DefineDirective {
    this.eat(TokenType.DF);
    const name = this.advance().value; // macro name
    let params: string[] | null = null;
    let body = '';

    // function-like macro: df NAME(a,b) body
    if (this.check(TokenType.LPAREN)) {
      this.advance();
      params = [];
      while (!this.check(TokenType.RPAREN) && !this.check(TokenType.EOF)) {
        if (this.check(TokenType.ELLIPSIS)) {
          params.push('...');
          this.advance();
        } else {
          params.push(this.advance().value);
        }
        this.tryEat(TokenType.COMMA);
      }
      this.eat(TokenType.RPAREN);
    }

    // rest of line is body
    // We collect tokens until EOF or newline (but newlines were filtered — collect until semicolon or next keyword that starts a declaration)
    // Actually define body can be complex; we gather remaining tokens on the "logical line"
    // Since newlines are filtered, we use a heuristic: collect everything that could be part of an expression
    const bodyToks: Token[] = [];
    // Gather tokens that are likely part of the define body
    // Stop at top-level declaration starters
    while (!this.check(TokenType.EOF) &&
           !this.check(TokenType.FN) &&
           !this.check(TokenType.ST) &&
           !this.check(TokenType.UN) &&
           !this.check(TokenType.EN) &&
           !this.check(TokenType.TP) &&
           !this.check(TokenType.IM) &&
           !this.check(TokenType.DF) &&
           !this.check(TokenType.ND) &&
           !this.check(TokenType.DN) &&
           !this.check(TokenType.PR) &&
           !this.check(TokenType.HASH)) {
      bodyToks.push(this.advance());
    }
    // Smart join: don't put spaces around punctuation/operators
    const noSpaceBefore = new Set(['(', ')', '[', ']', ',', ';', '.', '->', '++', '--']);
    const noSpaceAfter = new Set(['(', '[', '.', '->']);
    body = bodyToks.map((t, i) => {
      const prev = bodyToks[i - 1];
      if (!prev) return t.value;
      if (noSpaceBefore.has(t.value) || noSpaceAfter.has(prev.value)) return t.value;
      // identifiers and numbers need a space before them
      if (t.type === TokenType.IDENT || t.type === TokenType.NUMBER ||
          t.type === TokenType.STRING) return ' ' + t.value;
      return t.value;
    }).join('').trim();

    return { kind: 'DefineDirective', name, params, body };
  }

  private parseTypedef(): ASTNode {
    this.eat(TokenType.TP);

    if (this.check(TokenType.ST)) {
      const st = this.parseStructDecl(true) as StructDecl;
      return st;
    }
    if (this.check(TokenType.UN)) {
      const un = this.parseUnionDecl(true) as UnionDecl;
      return un;
    }
    if (this.check(TokenType.EN)) {
      const en = this.parseEnumDecl(true) as EnumDecl;
      return en;
    }

    // tp i32 MyInt
    const type = this.parseType();
    const alias = this.eat(TokenType.IDENT).value;
    this.tryEat(TokenType.SEMICOLON);
    return { kind: 'TypedefDecl', inner: { kind: 'VarDecl', name: '', type, init: null, qualifiers: [] }, alias };
  }

  private parseStructDecl(isTypedef: boolean): StructDecl {
    this.eat(TokenType.ST);
    let name: string | null = null;
    if (this.check(TokenType.IDENT)) name = this.advance().value;

    const fields: FieldDecl[] = [];
    if (this.check(TokenType.LBRACE)) {
      this.eat(TokenType.LBRACE);
      while (!this.check(TokenType.RBRACE) && !this.check(TokenType.EOF)) {
        fields.push(this.parseFieldDecl());
        this.tryEat(TokenType.SEMICOLON);
      }
      this.eat(TokenType.RBRACE);
    }

    let typedefName: string | null = null;
    if (isTypedef) {
      typedefName = this.eat(TokenType.IDENT).value;
    }
    this.tryEat(TokenType.SEMICOLON);
    return { kind: 'StructDecl', name, fields, isTypedef, typedefName };
  }

  private parseUnionDecl(isTypedef: boolean): UnionDecl {
    this.eat(TokenType.UN);
    let name: string | null = null;
    if (this.check(TokenType.IDENT)) name = this.advance().value;

    const fields: FieldDecl[] = [];
    if (this.check(TokenType.LBRACE)) {
      this.eat(TokenType.LBRACE);
      while (!this.check(TokenType.RBRACE) && !this.check(TokenType.EOF)) {
        fields.push(this.parseFieldDecl());
        this.tryEat(TokenType.SEMICOLON);
      }
      this.eat(TokenType.RBRACE);
    }

    let typedefName: string | null = null;
    if (isTypedef) typedefName = this.eat(TokenType.IDENT).value;
    this.tryEat(TokenType.SEMICOLON);
    return { kind: 'UnionDecl', name, fields, isTypedef, typedefName };
  }

  private parseFieldDecl(): FieldDecl {
    const name = this.eatIdent().value;
    this.eat(TokenType.COLON);
    const type = this.parseType();
    // array field
    if (this.check(TokenType.LBRACKET)) {
      this.advance();
      if (!this.check(TokenType.RBRACKET)) {
        type.arraySize = this.parseExpr();
      }
      this.eat(TokenType.RBRACKET);
    }
    // bitfield
    let bitfield: Expr | undefined;
    if (this.check(TokenType.COLON)) {
      this.advance();
      bitfield = this.parseExpr();
    }
    return { name, type, bitfield };
  }

  private parseEnumDecl(isTypedef: boolean): EnumDecl {
    this.eat(TokenType.EN);
    let name: string | null = null;
    if (this.check(TokenType.IDENT)) name = this.advance().value;

    const members: EnumMember[] = [];
    if (this.check(TokenType.LBRACE)) {
      this.eat(TokenType.LBRACE);
      while (!this.check(TokenType.RBRACE) && !this.check(TokenType.EOF)) {
        const mname = this.advance().value;
        let value: Expr | null = null;
        if (this.tryEat(TokenType.ASSIGN)) {
          value = this.parseExpr();
        }
        members.push({ name: mname, value });
        if (!this.tryEat(TokenType.COMMA)) break;
      }
      this.eat(TokenType.RBRACE);
    }

    let typedefName: string | null = null;
    if (isTypedef) typedefName = this.eat(TokenType.IDENT).value;
    this.tryEat(TokenType.SEMICOLON);
    return { kind: 'EnumDecl', name, members, isTypedef, typedefName };
  }

  private parseFunctionDecl(): FunctionDecl {
    this.eat(TokenType.FN);
    const name = this.eat(TokenType.IDENT).value;
    this.eat(TokenType.LPAREN);

    const params: ParamDecl[] = [];
    while (!this.check(TokenType.RPAREN) && !this.check(TokenType.EOF)) {
      if (this.check(TokenType.ELLIPSIS)) {
        params.push({ name: '...', type: { base: '', pointers: 0, isConst: false, isVolatile: false, isStatic: false, isExtern: false, isInline: false, arraySize: null }, isVararg: true });
        this.advance();
        break;
      }
      const pname = this.eatIdent().value;
      this.eat(TokenType.COLON);
      const ptype = this.parseType();
      // array param
      if (this.check(TokenType.LBRACKET)) {
        this.advance();
        if (!this.check(TokenType.RBRACKET)) ptype.arraySize = this.parseExpr();
        this.eat(TokenType.RBRACKET);
        ptype.pointers = Math.max(ptype.pointers, 1);
      }
      params.push({ name: pname, type: ptype });
      if (!this.tryEat(TokenType.COMMA)) break;
    }
    this.eat(TokenType.RPAREN);

    let returnType: TypeNode = { base: 'void', pointers: 0, isConst: false, isVolatile: false, isStatic: false, isExtern: false, isInline: false, arraySize: null };

    // Optional return type
    if (this.check(TokenType.ARROW)) {
      this.advance();
      returnType = this.parseType();
    }

    // Body or semicolon (forward decl)
    let body: BlockStmt | null = null;
    if (this.check(TokenType.LBRACE)) {
      body = this.parseBlock();
    } else {
      this.tryEat(TokenType.SEMICOLON);
    }

    return { kind: 'FunctionDecl', name, params, returnType, body, qualifiers: [] };
  }

  private parseVarOrFuncDecl(): ASTNode {
    // Handle qualifiers
    const qualifiers: string[] = [];
    while (this.check(TokenType.SC, TokenType.EX, TokenType.IN, TokenType.CN, TokenType.VL)) {
      qualifiers.push(this.advance().value);
    }

    // name:type[=init] or just type-based declarations
    // In Pear, declarations are: name:type[=init]
    // But we might also have identifiers being used as statements
    if (this.isIdentLike(this.peek()) && this.peek(1).type === TokenType.COLON) {
      return this.parseVarDecl(qualifiers);
    }

    // Expression statement
    const expr = this.parseExpr();
    this.tryEat(TokenType.SEMICOLON);
    return { kind: 'ExprStmt', expr };
  }

  private parseVarDecl(qualifiers: string[] = []): VarDecl {
    const name = this.eatIdent().value;
    this.eat(TokenType.COLON);
    const type = this.parseType();

    // Array declaration: name:type[size]
    if (this.check(TokenType.LBRACKET)) {
      this.advance();
      if (!this.check(TokenType.RBRACKET)) {
        type.arraySize = this.parseExpr();
      }
      this.eat(TokenType.RBRACKET);
    }

    let init: Expr | null = null;
    if (this.tryEat(TokenType.ASSIGN)) {
      if (this.check(TokenType.LBRACE)) {
        init = this.parseInitList();
      } else {
        init = this.parseExpr();
      }
    }
    this.tryEat(TokenType.SEMICOLON);
    return { kind: 'VarDecl', name, type, init, qualifiers };
  }

  // ─── Statements ────────────────────────────────────────────────────────────

  private parseStatement(): ASTNode {
    if (this.check(TokenType.HASH)) {
      return { kind: 'RawPreprocessor', text: this.advance().value };
    }
    if (this.check(TokenType.LBRACE)) return this.parseBlock();
    if (this.check(TokenType.IF)) return this.parseIf();
    if (this.check(TokenType.LP)) return this.parseFor();
    if (this.check(TokenType.WH)) return this.parseWhile();
    if (this.check(TokenType.DW)) return this.parseDoWhile();
    if (this.check(TokenType.SW)) return this.parseSwitch();
    if (this.check(TokenType.RT)) return this.parseReturn();
    if (this.check(TokenType.BK)) { this.advance(); this.tryEat(TokenType.SEMICOLON); return { kind: 'BreakStmt' }; }
    if (this.check(TokenType.CT)) { this.advance(); this.tryEat(TokenType.SEMICOLON); return { kind: 'ContinueStmt' }; }
    if (this.check(TokenType.GT)) return this.parseGoto();
    if (this.check(TokenType.ST)) return this.parseStructDecl(false);
    if (this.check(TokenType.UN)) return this.parseUnionDecl(false);
    if (this.check(TokenType.EN)) return this.parseEnumDecl(false);
    if (this.check(TokenType.TP)) return this.parseTypedef();
    if (this.check(TokenType.DF)) return this.parseDefine();
    if (this.check(TokenType.IM)) return this.parseInclude();
    if (this.check(TokenType.ND)) {
      this.advance();
      const name = this.eat(TokenType.IDENT).value;
      return { kind: 'IncludeGuardStart', name };
    }
    if (this.check(TokenType.DN)) {
      this.advance();
      return { kind: 'IncludeGuardEnd' };
    }

    // Qualifiers
    if (this.check(TokenType.SC, TokenType.EX, TokenType.IN, TokenType.VL)) {
      return this.parseVarOrFuncDecl();
    }

    // cn might be a qualifier or part of something else
    if (this.check(TokenType.CN)) {
      return this.parseVarOrFuncDecl();
    }

    // var decl: name:type
    // name can be IDENT or a short keyword used as identifier (b, c, v, sz, i32, etc.)
    if (this.isIdentLike(this.peek()) && this.peek(1).type === TokenType.COLON) {
      // Determine if this is a label or a variable declaration.
      // It's a label only if:
      //   1. The token is a plain IDENT (not a type keyword)
      //   2. After the colon there's NO type (no type keyword, no IDENT, no STAR)
      //   3. After the colon is a statement keyword or structural token
      const afterColon = this.peek(2);
      const isLabel = this.check(TokenType.IDENT) &&
          !this.isTypeToken(afterColon) &&
          !this.isTypeStartToken(afterColon) &&
          afterColon.type !== TokenType.STAR &&
          afterColon.type !== TokenType.IDENT; // IDENT after colon = typedef'd type name → var decl
      if (isLabel) {
        const label = this.advance().value;
        this.advance(); // colon
        const body = this.parseStatement();
        return { kind: 'LabelStmt', label, body };
      }
      return this.parseVarDecl();
    }

    // cs (case)
    if (this.check(TokenType.CS)) {
      this.advance();
      const val = this.parseExpr();
      this.eat(TokenType.COLON);
      const body: ASTNode[] = [];
      while (!this.check(TokenType.CS) && !this.check(TokenType.DV) && !this.check(TokenType.RBRACE) && !this.check(TokenType.EOF)) {
        body.push(this.parseStatement());
      }
      return { kind: 'CaseStmt', value: val, body };
    }

    // dv (default)
    if (this.check(TokenType.DV)) {
      this.advance();
      this.eat(TokenType.COLON);
      const body: ASTNode[] = [];
      while (!this.check(TokenType.CS) && !this.check(TokenType.RBRACE) && !this.check(TokenType.EOF)) {
        body.push(this.parseStatement());
      }
      return { kind: 'DefaultStmt', body };
    }

    // expression statement
    const expr = this.parseExpr();
    this.tryEat(TokenType.SEMICOLON);
    return { kind: 'ExprStmt', expr };
  }

  private isIdentLike(tok: Token): boolean {
    return tok.type === TokenType.IDENT ||
           tok.type === TokenType.B || tok.type === TokenType.C ||
           tok.type === TokenType.V || tok.type === TokenType.SZ ||
           tok.type === TokenType.I8 || tok.type === TokenType.I16 ||
           tok.type === TokenType.I32 || tok.type === TokenType.I64 ||
           tok.type === TokenType.U8 || tok.type === TokenType.U16 ||
           tok.type === TokenType.U32 || tok.type === TokenType.U64 ||
           tok.type === TokenType.F32 || tok.type === TokenType.F64 ||
           tok.type === TokenType.IN;
  }

  private isTypeToken(tok: Token): boolean {
    return TYPE_KEYWORDS.has(tok.type) || tok.type === TokenType.ST || tok.type === TokenType.UN || tok.type === TokenType.EN;
  }

  private isTypeStartToken(tok: Token): boolean {
    if (this.isTypeToken(tok)) return true;
    if (tok.type === TokenType.CN || tok.type === TokenType.VL ||
        tok.type === TokenType.SC || tok.type === TokenType.EX ||
        tok.type === TokenType.IN) return true;
    // Could also be a typedef'd name (IDENT) — assume it is if followed by reasonable stuff
    return false;
  }

  private parseBlock(): BlockStmt {
    this.eat(TokenType.LBRACE);
    const body: ASTNode[] = [];
    while (!this.check(TokenType.RBRACE) && !this.check(TokenType.EOF)) {
      body.push(this.parseStatement());
    }
    this.eat(TokenType.RBRACE);
    return { kind: 'BlockStmt', body };
  }

  private parseIf(): IfStmt {
    this.eat(TokenType.IF);
    this.eat(TokenType.LPAREN);
    const condition = this.parseExpr();
    this.eat(TokenType.RPAREN);
    const consequent = this.parseStatement();
    let alternate: ASTNode | null = null;
    if (this.check(TokenType.EI)) {
      this.advance();
      this.eat(TokenType.LPAREN);
      const eicond = this.parseExpr();
      this.eat(TokenType.RPAREN);
      const eibody = this.parseStatement();
      alternate = { kind: 'IfStmt', condition: eicond, consequent: eibody, alternate: null };
      // chain else-ifs
      let cur = alternate as IfStmt;
      while (this.check(TokenType.EI)) {
        this.advance();
        this.eat(TokenType.LPAREN);
        const c2 = this.parseExpr();
        this.eat(TokenType.RPAREN);
        const b2 = this.parseStatement();
        const next: IfStmt = { kind: 'IfStmt', condition: c2, consequent: b2, alternate: null };
        cur.alternate = next;
        cur = next;
      }
      if (this.check(TokenType.EL)) {
        this.advance();
        cur.alternate = this.parseStatement();
      }
    } else if (this.check(TokenType.EL)) {
      this.advance();
      alternate = this.parseStatement();
    }
    return { kind: 'IfStmt', condition, consequent, alternate };
  }

  private parseFor(): ForStmt {
    this.eat(TokenType.LP);
    this.eat(TokenType.LPAREN);

    let init: ASTNode | null = null;
    if (!this.check(TokenType.SEMICOLON)) {
      if (this.isIdentLike(this.peek()) && this.peek(1).type === TokenType.COLON) {
        // var decl without trailing semicolon eaten
        const name = this.advance().value;
        this.advance(); // colon
        const type = this.parseType();
        let initExpr: Expr | null = null;
        if (this.tryEat(TokenType.ASSIGN)) {
          initExpr = this.parseExpr();
        }
        init = { kind: 'VarDecl', name, type, init: initExpr, qualifiers: [] };
      } else {
        const expr = this.parseExpr();
        init = { kind: 'ExprStmt', expr };
      }
    }
    this.eat(TokenType.SEMICOLON);

    let condition: Expr | null = null;
    if (!this.check(TokenType.SEMICOLON)) {
      condition = this.parseExpr();
    }
    this.eat(TokenType.SEMICOLON);

    let update: Expr | null = null;
    if (!this.check(TokenType.RPAREN)) {
      update = this.parseExpr();
    }
    this.eat(TokenType.RPAREN);

    const body = this.parseStatement();
    return { kind: 'ForStmt', init, condition, update, body };
  }

  private parseWhile(): WhileStmt {
    this.eat(TokenType.WH);
    this.eat(TokenType.LPAREN);
    const condition = this.parseExpr();
    this.eat(TokenType.RPAREN);
    const body = this.parseStatement();
    return { kind: 'WhileStmt', condition, body };
  }

  private parseDoWhile(): DoWhileStmt {
    this.eat(TokenType.DW);
    const body = this.parseStatement();
    this.eat(TokenType.WH);
    this.eat(TokenType.LPAREN);
    const condition = this.parseExpr();
    this.eat(TokenType.RPAREN);
    this.tryEat(TokenType.SEMICOLON);
    return { kind: 'DoWhileStmt', body, condition };
  }

  private parseSwitch(): SwitchStmt {
    this.eat(TokenType.SW);
    this.eat(TokenType.LPAREN);
    const expr = this.parseExpr();
    this.eat(TokenType.RPAREN);
    const body = this.parseBlock();
    return { kind: 'SwitchStmt', expr, body };
  }

  private parseReturn(): ReturnStmt {
    this.eat(TokenType.RT);
    let value: Expr | null = null;
    if (!this.check(TokenType.SEMICOLON) && !this.check(TokenType.RBRACE) && !this.check(TokenType.EOF)) {
      value = this.parseExpr();
    }
    this.tryEat(TokenType.SEMICOLON);
    return { kind: 'ReturnStmt', value };
  }

  private parseGoto(): GotoStmt {
    this.eat(TokenType.GT);
    const label = this.eat(TokenType.IDENT).value;
    this.tryEat(TokenType.SEMICOLON);
    return { kind: 'GotoStmt', label };
  }

  private parseInitList(): InitListExpr {
    this.eat(TokenType.LBRACE);
    const elements: Expr[] = [];
    while (!this.check(TokenType.RBRACE) && !this.check(TokenType.EOF)) {
      if (this.check(TokenType.LBRACE)) {
        elements.push(this.parseInitList());
      } else {
        elements.push(this.parseExpr());
      }
      if (!this.tryEat(TokenType.COMMA)) break;
    }
    this.eat(TokenType.RBRACE);
    return { kind: 'InitListExpr', elements };
  }

  // ─── Expression Parsing (Pratt-style) ──────────────────────────────────────

  private parseExpr(minPrec = 0): Expr {
    return this.parseAssignment();
  }

  private parseAssignment(): Expr {
    const left = this.parseTernary();

    const assignOps = [
      TokenType.ASSIGN, TokenType.PLUS_ASSIGN, TokenType.MINUS_ASSIGN,
      TokenType.STAR_ASSIGN, TokenType.SLASH_ASSIGN, TokenType.PERCENT_ASSIGN,
      TokenType.AMP_ASSIGN, TokenType.PIPE_ASSIGN, TokenType.CARET_ASSIGN,
      TokenType.LSHIFT_ASSIGN, TokenType.RSHIFT_ASSIGN,
    ];

    if (assignOps.includes(this.peek().type)) {
      const op = this.advance().value;
      const right = this.parseAssignment();
      return { kind: 'AssignExpr', op, left, right };
    }

    return left;
  }

  private parseTernary(): Expr {
    const cond = this.parseOr();
    if (this.tryEat(TokenType.QUESTION)) {
      const consequent = this.parseExpr();
      this.eat(TokenType.COLON);
      const alternate = this.parseTernary();
      return { kind: 'TernaryExpr', condition: cond, consequent, alternate };
    }
    return cond;
  }

  private parseOr(): Expr {
    let left = this.parseAnd();
    while (this.check(TokenType.OR)) {
      const op = this.advance().value;
      left = { kind: 'BinaryExpr', op, left, right: this.parseAnd() };
    }
    return left;
  }

  private parseAnd(): Expr {
    let left = this.parseBitOr();
    while (this.check(TokenType.AND)) {
      const op = this.advance().value;
      left = { kind: 'BinaryExpr', op, left, right: this.parseBitOr() };
    }
    return left;
  }

  private parseBitOr(): Expr {
    let left = this.parseBitXor();
    while (this.check(TokenType.PIPE)) {
      const op = this.advance().value;
      left = { kind: 'BinaryExpr', op, left, right: this.parseBitXor() };
    }
    return left;
  }

  private parseBitXor(): Expr {
    let left = this.parseBitAnd();
    while (this.check(TokenType.CARET)) {
      const op = this.advance().value;
      left = { kind: 'BinaryExpr', op, left, right: this.parseBitAnd() };
    }
    return left;
  }

  private parseBitAnd(): Expr {
    let left = this.parseEquality();
    while (this.check(TokenType.AMP)) {
      const op = this.advance().value;
      left = { kind: 'BinaryExpr', op, left, right: this.parseEquality() };
    }
    return left;
  }

  private parseEquality(): Expr {
    let left = this.parseRelational();
    while (this.check(TokenType.EQ) || this.check(TokenType.NEQ)) {
      const op = this.advance().value;
      left = { kind: 'BinaryExpr', op, left, right: this.parseRelational() };
    }
    return left;
  }

  private parseRelational(): Expr {
    let left = this.parseShift();
    while (this.check(TokenType.LT) || this.check(TokenType.GT_OP) || this.check(TokenType.LTE) || this.check(TokenType.GTE)) {
      const op = this.advance().value;
      left = { kind: 'BinaryExpr', op, left, right: this.parseShift() };
    }
    return left;
  }

  private parseShift(): Expr {
    let left = this.parseAddSub();
    while (this.check(TokenType.LSHIFT) || this.check(TokenType.RSHIFT)) {
      const op = this.advance().value;
      left = { kind: 'BinaryExpr', op, left, right: this.parseAddSub() };
    }
    return left;
  }

  private parseAddSub(): Expr {
    let left = this.parseMulDiv();
    while (this.check(TokenType.PLUS) || this.check(TokenType.MINUS)) {
      const op = this.advance().value;
      left = { kind: 'BinaryExpr', op, left, right: this.parseMulDiv() };
    }
    return left;
  }

  private parseMulDiv(): Expr {
    let left = this.parseUnary();
    while (this.check(TokenType.STAR) || this.check(TokenType.SLASH) || this.check(TokenType.PERCENT)) {
      const op = this.advance().value;
      left = { kind: 'BinaryExpr', op, left, right: this.parseUnary() };
    }
    return left;
  }

  private parseUnary(): Expr {
    // Prefix operators
    if (this.check(TokenType.MINUS)) { this.advance(); return { kind: 'UnaryExpr', op: '-', operand: this.parseUnary(), prefix: true }; }
    if (this.check(TokenType.NOT)) { this.advance(); return { kind: 'UnaryExpr', op: '!', operand: this.parseUnary(), prefix: true }; }
    if (this.check(TokenType.TILDE)) { this.advance(); return { kind: 'UnaryExpr', op: '~', operand: this.parseUnary(), prefix: true }; }
    if (this.check(TokenType.INC)) { this.advance(); return { kind: 'UnaryExpr', op: '++', operand: this.parseUnary(), prefix: true }; }
    if (this.check(TokenType.DEC)) { this.advance(); return { kind: 'UnaryExpr', op: '--', operand: this.parseUnary(), prefix: true }; }

    // Address-of & and dereference *
    if (this.check(TokenType.AMP)) { this.advance(); return { kind: 'UnaryExpr', op: '&', operand: this.parseUnary(), prefix: true }; }
    if (this.check(TokenType.STAR)) { this.advance(); return { kind: 'UnaryExpr', op: '*', operand: this.parseUnary(), prefix: true }; }
    if (this.check(TokenType.PLUS)) { this.advance(); return { kind: 'UnaryExpr', op: '+', operand: this.parseUnary(), prefix: true }; }

    // sizeof
    if (this.check(TokenType.SZ)) {
      this.advance();
      this.eat(TokenType.LPAREN);
      // Check if it's a type or expression
      if (this.isTypeStartToken(this.peek()) || TYPE_KEYWORDS.has(this.peek().type)) {
        const t = this.parseType();
        this.eat(TokenType.RPAREN);
        return { kind: 'SizeofExpr', operand: t, isType: true };
      }
      const expr = this.parseExpr();
      this.eat(TokenType.RPAREN);
      return { kind: 'SizeofExpr', operand: expr, isType: false };
    }

    return this.parsePostfix();
  }

  private parsePostfix(): Expr {
    let expr = this.parsePrimary();

    while (true) {
      if (this.check(TokenType.INC)) { this.advance(); expr = { kind: 'PostfixExpr', op: '++', operand: expr }; continue; }
      if (this.check(TokenType.DEC)) { this.advance(); expr = { kind: 'PostfixExpr', op: '--', operand: expr }; continue; }
      if (this.check(TokenType.LBRACKET)) {
        this.advance();
        const idx = this.parseExpr();
        this.eat(TokenType.RBRACKET);
        expr = { kind: 'IndexExpr', object: expr, index: idx };
        continue;
      }
      if (this.check(TokenType.LPAREN)) {
        this.advance();
        const args: Expr[] = [];
        while (!this.check(TokenType.RPAREN) && !this.check(TokenType.EOF)) {
          args.push(this.parseExpr());
          if (!this.tryEat(TokenType.COMMA)) break;
        }
        this.eat(TokenType.RPAREN);
        expr = { kind: 'CallExpr', callee: expr, args };
        continue;
      }
      if (this.check(TokenType.DOT)) {
        this.advance();
        const member = this.advance().value;
        expr = { kind: 'MemberExpr', object: expr, member, arrow: false };
        continue;
      }
      if (this.check(TokenType.ARROW)) {
        this.advance();
        const member = this.advance().value;
        expr = { kind: 'MemberExpr', object: expr, member, arrow: true };
        continue;
      }
      break;
    }
    return expr;
  }

  private parsePrimary(): Expr {
    const tok = this.peek();

    if (tok.type === TokenType.NUMBER) {
      this.advance();
      return { kind: 'NumberLiteral', value: tok.value };
    }
    if (tok.type === TokenType.STRING) {
      this.advance();
      // Handle adjacent string literal concatenation
      let val = tok.value;
      while (this.check(TokenType.STRING)) {
        val = val.slice(0, -1) + this.advance().value.slice(1);
      }
      return { kind: 'StringLiteral', value: val };
    }
    if (tok.type === TokenType.CHAR) {
      this.advance();
      return { kind: 'CharLiteral', value: tok.value };
    }

    // Parenthesized expression or cast
    if (tok.type === TokenType.LPAREN) {
      this.advance();

      // Check for cast: (type)expr
      if (this.isTypeStartToken(this.peek()) || TYPE_KEYWORDS.has(this.peek().type)) {
        // Could be cast or just grouped expr
        const savedPos = this.pos;
        try {
          const type = this.parseType();
          if (this.check(TokenType.RPAREN)) {
            this.advance();
            // Check it's followed by something that can be an expression
            if (!this.check(TokenType.SEMICOLON) && !this.check(TokenType.COMMA) &&
                !this.check(TokenType.RPAREN) && !this.check(TokenType.RBRACKET) &&
                !this.check(TokenType.EOF)) {
              const expr = this.parseUnary();
              return { kind: 'CastExpr', targetType: type, expr };
            }
          }
        } catch {
          // not a cast
        }
        this.pos = savedPos;
      }

      const expr = this.parseExpr();
      this.eat(TokenType.RPAREN);
      return expr;
    }

    // Identifiers (including keywords used as identifiers in context)
    if (tok.type === TokenType.IDENT ||
        tok.type === TokenType.B || // 'b' as a type used in expression context might just be an identifier
        tok.type === TokenType.C ||
        tok.type === TokenType.V) {
      this.advance();
      if (tok.value === 'NULL') return { kind: 'NullLiteral' };
      if (tok.value === 'true') return { kind: 'BoolLiteral', value: true };
      if (tok.value === 'false') return { kind: 'BoolLiteral', value: false };
      return { kind: 'Identifier', name: tok.value };
    }

    // Any keyword that might be used as an identifier
    if (tok.type !== TokenType.EOF) {
      this.advance();
      return { kind: 'Identifier', name: tok.value };
    }

    throw new Error(`Unexpected token '${tok.value}' (${tok.type}) at line ${tok.line}:${tok.col}`);
  }
}

export function parse(source: string): Program {
  const lexer = new Lexer(source);
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens);
  return parser.parse();
}
