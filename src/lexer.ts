// Pear Language Lexer
// Tokenizes Pear source code into a stream of tokens

export enum TokenType {
  // Literals
  NUMBER = 'NUMBER',
  STRING = 'STRING',
  CHAR = 'CHAR',
  IDENT = 'IDENT',

  // Keywords
  FN = 'fn',
  ST = 'st',
  UN = 'un',
  EN = 'en',
  IF = 'if',
  EI = 'ei',
  EL = 'el',
  LP = 'lp',
  WH = 'wh',
  DW = 'dw',
  SW = 'sw',
  CS = 'cs',
  DV = 'dv',
  RT = 'rt',
  BK = 'bk',
  CT = 'ct',
  GT = 'gt',
  SC = 'sc',
  EX = 'ex',
  IN = 'in',
  VL = 'vl',
  CN = 'cn',
  TP = 'tp',
  ND = 'nd',
  PR = 'pr',
  DN = 'dn',

  // Preprocessor
  IM = 'im',
  DF = 'df',

  // Types
  I8 = 'i8',
  I16 = 'i16',
  I32 = 'i32',
  I64 = 'i64',
  U8 = 'u8',
  U16 = 'u16',
  U32 = 'u32',
  U64 = 'u64',
  F32 = 'f32',
  F64 = 'f64',
  V = 'v',
  C = 'c',
  B = 'b',
  SZ = 'sz',
  SO = 'so',

  // Operators & Punctuation
  PLUS = '+',
  MINUS = '-',
  STAR = '*',
  SLASH = '/',
  PERCENT = '%',
  AMP = '&',
  PIPE = '|',
  CARET = '^',
  TILDE = '~',
  LSHIFT = '<<',
  RSHIFT = '>>',
  AND = '&&',
  OR = '||',
  NOT = '!',
  EQ = '==',
  NEQ = '!=',
  LT = '<',
  GT_OP = '>',
  LTE = '<=',
  GTE = '>=',
  ASSIGN = '=',
  PLUS_ASSIGN = '+=',
  MINUS_ASSIGN = '-=',
  STAR_ASSIGN = '*=',
  SLASH_ASSIGN = '/=',
  PERCENT_ASSIGN = '%=',
  AMP_ASSIGN = '&=',
  PIPE_ASSIGN = '|=',
  CARET_ASSIGN = '^=',
  LSHIFT_ASSIGN = '<<=',
  RSHIFT_ASSIGN = '>>=',
  INC = '++',
  DEC = '--',
  ARROW = '->',
  DOT = '.',
  QUESTION = '?',
  COLON = ':',
  SEMICOLON = ';',
  COMMA = ',',
  LPAREN = '(',
  RPAREN = ')',
  LBRACE = '{',
  RBRACE = '}',
  LBRACKET = '[',
  RBRACKET = ']',
  HASH = '#',
  ELLIPSIS = '...',

  // Special
  NEWLINE = 'NEWLINE',
  EOF = 'EOF',
}

export interface Token {
  type: TokenType;
  value: string;
  line: number;
  col: number;
}

const KEYWORDS: Record<string, TokenType> = {
  fn: TokenType.FN,
  st: TokenType.ST,
  un: TokenType.UN,
  en: TokenType.EN,
  if: TokenType.IF,
  ei: TokenType.EI,
  el: TokenType.EL,
  lp: TokenType.LP,
  wh: TokenType.WH,
  dw: TokenType.DW,
  sw: TokenType.SW,
  cs: TokenType.CS,
  dv: TokenType.DV,
  rt: TokenType.RT,
  bk: TokenType.BK,
  ct: TokenType.CT,
  gt: TokenType.GT,
  sc: TokenType.SC,
  ex: TokenType.EX,
  in: TokenType.IN,
  vl: TokenType.VL,
  cn: TokenType.CN,
  tp: TokenType.TP,
  im: TokenType.IM,
  df: TokenType.DF,
  nd: TokenType.ND,
  dn: TokenType.DN,
  pr: TokenType.PR,
  // Types
  i8: TokenType.I8,
  i16: TokenType.I16,
  i32: TokenType.I32,
  i64: TokenType.I64,
  u8: TokenType.U8,
  u16: TokenType.U16,
  u32: TokenType.U32,
  u64: TokenType.U64,
  f32: TokenType.F32,
  f64: TokenType.F64,
  v: TokenType.V,
  c: TokenType.C,
  b: TokenType.B,
  sz: TokenType.SZ,
  so: TokenType.SO,
};

export class Lexer {
  private source: string;
  private pos: number = 0;
  private line: number = 1;
  private col: number = 1;
  private tokens: Token[] = [];

  constructor(source: string) {
    this.source = source;
  }

  private peek(offset = 0): string {
    return this.source[this.pos + offset] ?? '';
  }

  private advance(): string {
    const ch = this.source[this.pos++];
    if (ch === '\n') {
      this.line++;
      this.col = 1;
    } else {
      this.col++;
    }
    return ch;
  }

  private match(expected: string): boolean {
    if (this.source.startsWith(expected, this.pos)) {
      for (let i = 0; i < expected.length; i++) this.advance();
      return true;
    }
    return false;
  }

  private makeToken(type: TokenType, value: string, line: number, col: number): Token {
    return { type, value, line, col };
  }

  private skipLineComment(): void {
    while (this.pos < this.source.length && this.peek() !== '\n') {
      this.advance();
    }
  }

  private skipBlockComment(): void {
    while (this.pos < this.source.length) {
      if (this.peek() === '*' && this.peek(1) === '/') {
        this.advance();
        this.advance();
        return;
      }
      this.advance();
    }
    throw new Error(`Unterminated block comment at line ${this.line}`);
  }

  private readString(): Token {
    const startLine = this.line;
    const startCol = this.col;
    this.advance(); // consume opening "
    let str = '"';
    while (this.pos < this.source.length && this.peek() !== '"') {
      if (this.peek() === '\\') {
        str += this.advance();
        str += this.advance();
      } else {
        str += this.advance();
      }
    }
    if (this.peek() !== '"') {
      throw new Error(`Unterminated string at line ${startLine}`);
    }
    str += this.advance(); // closing "
    return this.makeToken(TokenType.STRING, str, startLine, startCol);
  }

  private readChar(): Token {
    const startLine = this.line;
    const startCol = this.col;
    this.advance(); // consume opening '
    let ch = "'";
    while (this.pos < this.source.length && this.peek() !== "'") {
      if (this.peek() === '\\') {
        ch += this.advance();
        ch += this.advance();
      } else {
        ch += this.advance();
      }
    }
    if (this.peek() !== "'") {
      throw new Error(`Unterminated char literal at line ${startLine}`);
    }
    ch += this.advance(); // closing '
    return this.makeToken(TokenType.CHAR, ch, startLine, startCol);
  }

  private readNumber(): Token {
    const startLine = this.line;
    const startCol = this.col;
    let num = '';
    // hex
    if (this.peek() === '0' && (this.peek(1) === 'x' || this.peek(1) === 'X')) {
      num += this.advance() + this.advance();
      while (/[0-9a-fA-F_]/.test(this.peek())) num += this.advance();
    } else {
      while (/[0-9_]/.test(this.peek())) num += this.advance();
      if (this.peek() === '.' && /[0-9]/.test(this.peek(1))) {
        num += this.advance();
        while (/[0-9_]/.test(this.peek())) num += this.advance();
      }
      if (this.peek() === 'e' || this.peek() === 'E') {
        num += this.advance();
        if (this.peek() === '+' || this.peek() === '-') num += this.advance();
        while (/[0-9]/.test(this.peek())) num += this.advance();
      }
    }
    // suffix: u, l, f, ul, etc.
    while (/[uUlLfF]/.test(this.peek())) num += this.advance();
    return this.makeToken(TokenType.NUMBER, num, startLine, startCol);
  }

  private readIdent(): Token {
    const startLine = this.line;
    const startCol = this.col;
    let id = '';
    while (/[a-zA-Z0-9_]/.test(this.peek())) id += this.advance();
    const kwType = KEYWORDS[id];
    if (kwType !== undefined) {
      return this.makeToken(kwType, id, startLine, startCol);
    }
    return this.makeToken(TokenType.IDENT, id, startLine, startCol);
  }

  // Read a preprocessor include path like <stdio.h> or "file.h"
  private readIncludePath(): Token {
    const startLine = this.line;
    const startCol = this.col;
    if (this.peek() === '<') {
      let path = '<';
      this.advance();
      while (this.pos < this.source.length && this.peek() !== '>') {
        path += this.advance();
      }
      if (this.peek() === '>') path += this.advance();
      return this.makeToken(TokenType.STRING, path, startLine, startCol);
    } else if (this.peek() === '"') {
      return this.readString();
    }
    throw new Error(`Expected < or " after im at line ${startLine}`);
  }

  tokenize(): Token[] {
    while (this.pos < this.source.length) {
      // skip whitespace (not newlines — newlines are significant for preprocessor)
      while (this.pos < this.source.length && (this.peek() === ' ' || this.peek() === '\t' || this.peek() === '\r')) {
        this.advance();
      }
      if (this.pos >= this.source.length) break;

      const startLine = this.line;
      const startCol = this.col;
      const ch = this.peek();

      // Newline
      if (ch === '\n') {
        this.advance();
        this.tokens.push(this.makeToken(TokenType.NEWLINE, '\n', startLine, startCol));
        continue;
      }

      // Line comment
      if (ch === '/' && this.peek(1) === '/') {
        this.advance(); this.advance();
        this.skipLineComment();
        continue;
      }

      // Block comment
      if (ch === '/' && this.peek(1) === '*') {
        this.advance(); this.advance();
        this.skipBlockComment();
        continue;
      }

      // String
      if (ch === '"') {
        this.tokens.push(this.readString());
        continue;
      }

      // Char literal
      if (ch === "'") {
        this.tokens.push(this.readChar());
        continue;
      }

      // Number
      if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(this.peek(1)))) {
        this.tokens.push(this.readNumber());
        continue;
      }

      // Identifier / keyword
      if (/[a-zA-Z_]/.test(ch)) {
        const tok = this.readIdent();
        this.tokens.push(tok);
        // if this was 'im', next non-space token should be the path
        if (tok.type === TokenType.IM) {
          // skip spaces
          while (this.pos < this.source.length && (this.peek() === ' ' || this.peek() === '\t')) {
            this.advance();
          }
          if (this.peek() === '<' || this.peek() === '"') {
            this.tokens.push(this.readIncludePath());
          }
        }
        continue;
      }

      // Hash for raw preprocessor directives (#ifdef, #if, #else, #endif, etc.)
      if (ch === '#') {
        this.advance();
        // read the directive name
        let directive = '#';
        while (/[a-zA-Z_]/.test(this.peek())) directive += this.advance();
        // read rest of line as raw text
        let rest = '';
        while (this.pos < this.source.length && this.peek() !== '\n') rest += this.advance();
        this.tokens.push(this.makeToken(TokenType.HASH, directive + rest, startLine, startCol));
        continue;
      }

      // Multi-char operators
      // ...
      if (ch === '.' && this.peek(1) === '.' && this.peek(2) === '.') {
        this.advance(); this.advance(); this.advance();
        this.tokens.push(this.makeToken(TokenType.ELLIPSIS, '...', startLine, startCol));
        continue;
      }

      // Operators
      const op2 = ch + this.peek(1);
      const op3 = op2 + this.peek(2);

      if (op3 === '<<=') { this.advance(); this.advance(); this.advance(); this.tokens.push(this.makeToken(TokenType.LSHIFT_ASSIGN, '<<=', startLine, startCol)); continue; }
      if (op3 === '>>=') { this.advance(); this.advance(); this.advance(); this.tokens.push(this.makeToken(TokenType.RSHIFT_ASSIGN, '>>=', startLine, startCol)); continue; }

      if (op2 === '<<') { this.advance(); this.advance(); this.tokens.push(this.makeToken(TokenType.LSHIFT, '<<', startLine, startCol)); continue; }
      if (op2 === '>>') { this.advance(); this.advance(); this.tokens.push(this.makeToken(TokenType.RSHIFT, '>>', startLine, startCol)); continue; }
      if (op2 === '&&') { this.advance(); this.advance(); this.tokens.push(this.makeToken(TokenType.AND, '&&', startLine, startCol)); continue; }
      if (op2 === '||') { this.advance(); this.advance(); this.tokens.push(this.makeToken(TokenType.OR, '||', startLine, startCol)); continue; }
      if (op2 === '==') { this.advance(); this.advance(); this.tokens.push(this.makeToken(TokenType.EQ, '==', startLine, startCol)); continue; }
      if (op2 === '!=') { this.advance(); this.advance(); this.tokens.push(this.makeToken(TokenType.NEQ, '!=', startLine, startCol)); continue; }
      if (op2 === '<=') { this.advance(); this.advance(); this.tokens.push(this.makeToken(TokenType.LTE, '<=', startLine, startCol)); continue; }
      if (op2 === '>=') { this.advance(); this.advance(); this.tokens.push(this.makeToken(TokenType.GTE, '>=', startLine, startCol)); continue; }
      if (op2 === '+=') { this.advance(); this.advance(); this.tokens.push(this.makeToken(TokenType.PLUS_ASSIGN, '+=', startLine, startCol)); continue; }
      if (op2 === '-=') { this.advance(); this.advance(); this.tokens.push(this.makeToken(TokenType.MINUS_ASSIGN, '-=', startLine, startCol)); continue; }
      if (op2 === '*=') { this.advance(); this.advance(); this.tokens.push(this.makeToken(TokenType.STAR_ASSIGN, '*=', startLine, startCol)); continue; }
      if (op2 === '/=') { this.advance(); this.advance(); this.tokens.push(this.makeToken(TokenType.SLASH_ASSIGN, '/=', startLine, startCol)); continue; }
      if (op2 === '%=') { this.advance(); this.advance(); this.tokens.push(this.makeToken(TokenType.PERCENT_ASSIGN, '%=', startLine, startCol)); continue; }
      if (op2 === '&=') { this.advance(); this.advance(); this.tokens.push(this.makeToken(TokenType.AMP_ASSIGN, '&=', startLine, startCol)); continue; }
      if (op2 === '|=') { this.advance(); this.advance(); this.tokens.push(this.makeToken(TokenType.PIPE_ASSIGN, '|=', startLine, startCol)); continue; }
      if (op2 === '^=') { this.advance(); this.advance(); this.tokens.push(this.makeToken(TokenType.CARET_ASSIGN, '^=', startLine, startCol)); continue; }
      if (op2 === '++') { this.advance(); this.advance(); this.tokens.push(this.makeToken(TokenType.INC, '++', startLine, startCol)); continue; }
      if (op2 === '--') { this.advance(); this.advance(); this.tokens.push(this.makeToken(TokenType.DEC, '--', startLine, startCol)); continue; }
      if (op2 === '->') { this.advance(); this.advance(); this.tokens.push(this.makeToken(TokenType.ARROW, '->', startLine, startCol)); continue; }

      // Single char operators
      const singleMap: Record<string, TokenType> = {
        '+': TokenType.PLUS,
        '-': TokenType.MINUS,
        '*': TokenType.STAR,
        '/': TokenType.SLASH,
        '%': TokenType.PERCENT,
        '&': TokenType.AMP,
        '|': TokenType.PIPE,
        '^': TokenType.CARET,
        '~': TokenType.TILDE,
        '!': TokenType.NOT,
        '<': TokenType.LT,
        '>': TokenType.GT_OP,
        '=': TokenType.ASSIGN,
        '?': TokenType.QUESTION,
        ':': TokenType.COLON,
        ';': TokenType.SEMICOLON,
        ',': TokenType.COMMA,
        '(': TokenType.LPAREN,
        ')': TokenType.RPAREN,
        '{': TokenType.LBRACE,
        '}': TokenType.RBRACE,
        '[': TokenType.LBRACKET,
        ']': TokenType.RBRACKET,
        '.': TokenType.DOT,
      };

      if (singleMap[ch]) {
        this.advance();
        this.tokens.push(this.makeToken(singleMap[ch], ch, startLine, startCol));
        continue;
      }

      throw new Error(`Unexpected character '${ch}' at line ${this.line}, col ${this.col}`);
    }

    this.tokens.push(this.makeToken(TokenType.EOF, '', this.line, this.col));
    return this.tokens;
  }
}
