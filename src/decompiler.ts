// Pear Language Decompiler
// Best-effort C → Pear minification
// Transforms C source into minified Pear code

// Type mapping: C → Pear
const C_TO_PEAR_TYPES: [RegExp, string][] = [
  [/\bint8_t\b/g, 'i8'],
  [/\bint16_t\b/g, 'i16'],
  [/\bint32_t\b/g, 'i32'],
  [/\bint64_t\b/g, 'i64'],
  [/\buint8_t\b/g, 'u8'],
  [/\buint16_t\b/g, 'u16'],
  [/\buint32_t\b/g, 'u32'],
  [/\buint64_t\b/g, 'u64'],
  [/\bfloat\b/g, 'f32'],
  [/\bdouble\b/g, 'f64'],
  [/\bvoid\b/g, 'v'],
  [/\bchar\b/g, 'c'],
  [/\bbool\b/g, 'b'],
  [/\bsize_t\b/g, 'sz'],
  // unsigned int variations
  [/\bunsigned long long\b/g, 'u64'],
  [/\blong long\b/g, 'i64'],
  [/\bunsigned long\b/g, 'u32'],
  [/\bunsigned int\b/g, 'u32'],
  [/\bunsigned\b/g, 'u32'],
  [/\blong\b/g, 'i64'],
  [/\bint\b/g, 'i32'],
  [/\bshort\b/g, 'i16'],
];

// Keyword mapping: C → Pear
const C_TO_PEAR_KEYWORDS: [RegExp, string][] = [
  [/\breturn\b/g, 'rt'],
  [/\bstruct\b/g, 'st'],
  [/\bunion\b/g, 'un'],
  [/\benum\b/g, 'en'],
  [/\btypedef\b/g, 'tp'],
  [/\bstatic\b/g, 'sc'],
  [/\bextern\b/g, 'ex'],
  [/\binline\b/g, 'in'],
  [/\bvolatile\b/g, 'vl'],
  [/\bconst\b/g, 'cn'],
  [/\bif\b/g, 'if'],
  // else if must come before else
  [/\belse\s+if\b/g, 'ei'],
  [/\belse\b/g, 'el'],
  [/\bfor\b/g, 'lp'],
  [/\bwhile\b/g, 'wh'],
  [/\bdo\b/g, 'dw'],
  [/\bswitch\b/g, 'sw'],
  [/\bcase\b/g, 'cs'],
  [/\bdefault\b/g, 'dv'],
  [/\bbreak\b/g, 'bk'],
  [/\bcontinue\b/g, 'ct'],
  [/\bgoto\b/g, 'gt'],
  [/\bsizeof\b/g, 'sz'],
];

// Preprocessor mapping
const C_TO_PEAR_PREPROCESSOR: [RegExp, string][] = [
  [/^#include\s*<(.+?)>/gm, 'im<$1>'],
  [/^#include\s*"(.+?)"/gm, 'im"$1"'],
  [/^#define\s+/gm, 'df '],
  [/^#pragma\s+/gm, 'pr '],
  [/^#ifndef\s+(\w+)\s*\n#define\s+\1/gm, 'nd $1'],
  [/^#endif/gm, 'dn'],
];

interface DecompilerOptions {
  minifyWhitespace: boolean;
  convertTypes: boolean;
  convertKeywords: boolean;
  convertPreprocessor: boolean;
  convertDeclarations: boolean;
}

const DEFAULT_OPTIONS: DecompilerOptions = {
  minifyWhitespace: true,
  convertTypes: true,
  convertKeywords: true,
  convertPreprocessor: true,
  convertDeclarations: true,
};

export class Decompiler {
  private options: DecompilerOptions;

  constructor(options: Partial<DecompilerOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  decompile(cSource: string): string {
    let code = cSource;

    // Step 1: Convert preprocessor directives
    if (this.options.convertPreprocessor) {
      code = this.convertPreprocessor(code);
    }

    // Step 2: Convert type names
    if (this.options.convertTypes) {
      code = this.convertTypes(code);
    }

    // Step 3: Convert keywords
    if (this.options.convertKeywords) {
      code = this.convertKeywords(code);
    }

    // Step 4: Convert declarations (type name → name:type)
    if (this.options.convertDeclarations) {
      code = this.convertDeclarations(code);
    }

    // Step 5: Convert function declarations
    code = this.convertFunctions(code);

    // Step 6: Minify whitespace
    if (this.options.minifyWhitespace) {
      code = this.minifyWhitespace(code);
    }

    return code.trim();
  }

  private convertPreprocessor(code: string): string {
    // Handle include guards first (combined #ifndef/#define pattern)
    code = code.replace(/^#ifndef\s+(\w+)\s*\n#define\s+\1\s*\n/gm, 'nd $1\n');

    // Convert preprocessor directives
    code = code.replace(/^#include\s*<([^>]+)>/gm, 'im<$1>');
    code = code.replace(/^#include\s*"([^"]+)"/gm, 'im"$1"');
    code = code.replace(/^#define\s+/gm, 'df ');
    code = code.replace(/^#pragma\s+/gm, 'pr ');
    code = code.replace(/^#endif\b.*/gm, 'dn');
    // #ifdef, #if, #else keep their # prefix (already short)

    return code;
  }

  private convertTypes(code: string): string {
    // We need to be careful not to replace inside strings or comments
    // For best-effort, we'll do simple regex replacement but protect strings
    const protected_ = this.protectStringsAndComments(code);
    let result = protected_.code;

    for (const [pattern, replacement] of C_TO_PEAR_TYPES) {
      result = result.replace(pattern, replacement);
    }

    return this.restoreStringsAndComments(result, protected_.replacements);
  }

  private convertKeywords(code: string): string {
    const protected_ = this.protectStringsAndComments(code);
    let result = protected_.code;

    for (const [pattern, replacement] of C_TO_PEAR_KEYWORDS) {
      result = result.replace(pattern, replacement);
    }

    return this.restoreStringsAndComments(result, protected_.replacements);
  }

  // Convert C-style declarations "type name" to Pear style "name:type"
  // This is the most complex transformation and is best-effort
  private convertDeclarations(code: string): string {
    const lines = code.split('\n');
    const result: string[] = [];

    for (const line of lines) {
      result.push(this.convertDeclLine(line));
    }

    return result.join('\n');
  }

  private convertDeclLine(line: string): string {
    const trimmed = line.trimStart();

    // Skip preprocessor lines, comments, empty lines, labels
    if (trimmed.startsWith('im') || trimmed.startsWith('df') ||
        trimmed.startsWith('#') || trimmed.startsWith('//') ||
        trimmed.startsWith('/*') || trimmed.startsWith('*') ||
        trimmed === '') {
      return line;
    }

    // Skip already-converted or non-decl lines
    if (trimmed.startsWith('st ') || trimmed.startsWith('un ') ||
        trimmed.startsWith('en ') || trimmed.startsWith('tp ') ||
        trimmed.startsWith('fn ')) {
      return line;
    }

    // Pear type names for matching
    const pearTypes = 'i8|i16|i32|i64|u8|u16|u32|u64|f32|f64|v|c|b|sz';

    // Match: [qualifiers] type [*] name [= init] ;
    // e.g. "i32 x = 5;" → "x:i32=5;"
    // e.g. "i32 *ptr;" → "ptr:*i32;"
    // e.g. "cn i32 len = 10;" → "len:cn i32=10;"
    const declMatch = trimmed.match(
      new RegExp(
        `^((?:(?:cn|sc|vl|in|ex)\\s+)*)` +  // optional qualifiers
        `(${pearTypes})` +                     // base type
        `((?:\\s*\\*+)?)` +                    // optional pointer stars
        `\\s+(\\w+)` +                         // variable name
        `((?:\\[\\d*\\])?)` +                  // optional array subscript
        `\\s*((?:=\\s*[^;]+)?)` +             // optional initializer
        `\\s*;(.*)$`                           // semicolon + remainder
      )
    );

    if (declMatch) {
      const [, quals, baseType, stars, name, arr, init, rest] = declMatch;
      const ptrStr = (stars.trim() || '') + (arr || '');
      const typeStr = (quals.trim() ? quals.trim() + ' ' : '') + ptrStr + baseType;
      const initStr = init.trim() ? init.trim() : '';
      return `${name}:${typeStr}${initStr};${rest}`;
    }

    return line;
  }

  // Convert C function signatures to Pear fn syntax
  private convertFunctions(code: string): string {
    // Match C function definitions:
    // returntype [qualifiers] funcname(params) { or ;
    // This regex handles common cases
    const funcRegex = /^((?:sc\s+|in\s+|ex\s+|cn\s+|vl\s+)*)(\w+(?:\s*\*+)?)\s+(\w+)\s*\(([^)]*)\)\s*(?=\{|;)/gm;

    return code.replace(funcRegex, (match, quals, retType, name, params) => {
      // Don't convert if name looks like a declaration (not a function)
      // Skip things like: struct name { ... }
      if (name === 'st' || name === 'un' || name === 'en' || name === 'tp') return match;
      if (retType === 'st' || retType === 'un' || retType === 'en') return match;

      // Convert parameters
      const convertedParams = this.convertParams(params);

      const qualStr = quals.trim() ? quals.trim() + ' ' : '';

      // Build Pear function signature
      const retStr = retType.trim() === 'v' ? '' : '->' + retType.trim();
      return qualStr + 'fn ' + name + '(' + convertedParams + ')' + retStr;
    });
  }

  private convertParams(params: string): string {
    if (!params.trim()) return '';
    if (params.trim() === 'v') return '';

    return params.split(',').map(p => {
      p = p.trim();
      if (!p || p === '...') return p;

      // Match "type *name" or "type name" or "type *name[]"
      const match = p.match(/^((?:cn\s+|vl\s+)*)(\w+(?:\s*\*+)?)\s+(\*+)?(\w+)(\[\])?$/);
      if (!match) return p;

      const [, quals, type, extraPtr, name, arr] = match;
      const ptrStr = (extraPtr || '') + (arr ? '*' : '');
      const fullType = quals.trim() + (quals.trim() ? ' ' : '') + type.trim() + ptrStr;
      return name + ':' + fullType;
    }).join(',');
  }

  private minifyWhitespace(code: string): string {
    const lines = code.split('\n');
    const result: string[] = [];

    for (let line of lines) {
      // Remove trailing whitespace
      line = line.trimEnd();

      // Skip empty lines (keep one)
      if (line === '') {
        if (result.length > 0 && result[result.length - 1] !== '') {
          // Don't add extra blank lines
        }
        continue;
      }

      // Remove leading indentation for minification
      // But keep preprocessor lines at column 0
      if (!line.trimStart().startsWith('#') &&
          !line.trimStart().startsWith('im') &&
          !line.trimStart().startsWith('df')) {
        // Reduce indentation
        line = line.trimStart();
      }

      result.push(line);
    }

    // Join - semicolons separate statements already
    // Try to join short lines together for density
    return result.join('\n');
  }

  // Protect string literals and comments from transformation
  private protectStringsAndComments(code: string): { code: string; replacements: Map<string, string> } {
    const replacements = new Map<string, string>();
    let counter = 0;

    // Protect block comments
    code = code.replace(/\/\*[\s\S]*?\*\//g, (match) => {
      const key = `\x00COMMENT${counter++}\x00`;
      replacements.set(key, match);
      return key;
    });

    // Protect line comments
    code = code.replace(/\/\/[^\n]*/g, (match) => {
      const key = `\x00LINECOMMENT${counter++}\x00`;
      replacements.set(key, match);
      return key;
    });

    // Protect string literals
    code = code.replace(/"(?:[^"\\]|\\.)*"/g, (match) => {
      const key = `\x00STRING${counter++}\x00`;
      replacements.set(key, match);
      return key;
    });

    // Protect char literals
    code = code.replace(/'(?:[^'\\]|\\.)*'/g, (match) => {
      const key = `\x00CHAR${counter++}\x00`;
      replacements.set(key, match);
      return key;
    });

    return { code, replacements };
  }

  private restoreStringsAndComments(code: string, replacements: Map<string, string>): string {
    for (const [key, value] of replacements) {
      code = code.split(key).join(value);
    }
    return code;
  }
}

export function decompile(cSource: string): string {
  const decompiler = new Decompiler();
  return decompiler.decompile(cSource);
}
