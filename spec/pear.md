# Pear Language Specification

Pear is an ultra-minified low-level language that transpiles to C. The goal is maximum token density — every byte saved matters.

File extension: `.pr`

---

## Types

| Pear | C              |
|------|----------------|
| i8   | int8_t         |
| i16  | int16_t        |
| i32  | int32_t        |
| i64  | int64_t        |
| u8   | uint8_t        |
| u16  | uint16_t       |
| u32  | uint32_t       |
| u64  | uint64_t       |
| f32  | float          |
| f64  | double         |
| v    | void           |
| c    | char           |
| b    | bool           |
| sz   | size_t         |
| *T   | pointer to T   |
| T[]  | array (= *T)   |

---

## Keywords

| Pear | C              |
|------|----------------|
| fn   | function def   |
| st   | struct         |
| un   | union          |
| en   | enum           |
| if   | if             |
| ei   | else if        |
| el   | else           |
| lp   | for            |
| wh   | while          |
| dw   | do...while     |
| sw   | switch         |
| cs   | case           |
| dv   | default        |
| rt   | return         |
| bk   | break          |
| ct   | continue       |
| gt   | goto           |
| sc   | static         |
| ex   | extern         |
| in   | inline         |
| vl   | volatile       |
| cn   | const          |
| tp   | typedef        |
| im   | #include       |
| df   | #define        |
| nd   | #ifndef guard  |
| dn   | #endif         |
| pr   | #pragma        |
| so   | sizeof         |

---

## Syntax

### Variable Declaration
```pear
name:type
name:type=value
name:type[size]        // array
```

### Function Definition
```pear
fn name(param:type,...)->rettype{...}
fn name(param:type,...){...}         // void return
```

### Control Flow
```pear
if(cond){...}
if(cond){...}ei(cond){...}el{...}
lp(init;cond;step){...}
wh(cond){...}
dw{...}wh(cond)
sw(expr){cs val:{...}bk dv:{...}}
```

### Struct / Union / Enum
```pear
st Name{field:type;...}
un Name{field:type;...}
en Name{A,B,C=10}
tp st Name{...} Name    // typedef struct
tp i32 MyInt            // typedef scalar
```

### Preprocessor
```pear
im<stdio.h>             // #include <stdio.h>
im"myfile.h"            // #include "myfile.h"
df NAME value           // #define NAME value
df NAME(a) (a*2)        // #define NAME(a) (a*2)
nd GUARD_H              // #ifndef GUARD_H\n#define GUARD_H
dn                      // #endif
pr once                 // #pragma once
```

Raw C preprocessor directives (`#ifdef`, `#if`, `#else`, `#endif`) are also accepted as-is.

### Operators
All C operators are supported:
```
+ - * / % & | ^ ~ << >> && || !
== != < > <= >= = += -= *= /= %= &= |= ^= <<= >>=
++ -- -> . ? :
```

### Pointers
```pear
p:*i32=&x    // pointer to i32
*p=42        // dereference
p->field     // arrow member access
```

### Cast
```pear
(i32)someFloat
(*i32)malloc(n*so(i32))
```

### Sizeof
```pear
so(i32)      // sizeof(int32_t)
so(myVar)    // sizeof(myVar)
```

### Ternary
```pear
x>0?x:-x
```

---

## Auto-Injected Headers

The compiler automatically prepends the following headers when needed:
- `#include <stdint.h>` — when `i8/i16/i32/i64/u8/u16/u32/u64` types are used
- `#include <stdbool.h>` — when `b` (bool) type is used

---

## Examples

### Hello World (`hello.pr`)
```pear
im<stdio.h>
fn main()->i32{printf("Hello, World!\n");rt 0}
```

Compiles to:
```c
#include <stdio.h>
int main(){printf("Hello, World!\n");return 0;}
```

### Structs (`structs.pr`)
```pear
im<stdint.h>
im<math.h>
st Point{x:f64;y:f64}
fn dist(a:*Point,b:*Point)->f64{dx:f64=a->x-b->x;dy:f64=a->y-b->y;rt sqrt(dx*dx+dy*dy)}
fn main()->i32{p1:Point={1.0,2.0};p2:Point={4.0,6.0};rt 0}
```

### Pointer Arithmetic (`pointers.pr`)
```pear
im<stdio.h>
fn swap(a:*i32,b:*i32){tmp:i32=*a;*a=*b;*b=tmp}
fn main()->i32{x:i32=10;y:i32=20;swap(&x,&y);rt 0}
```

---

## Compiler Usage

```sh
# Compile Pear to C
pearc hello.pr

# Compile Pear to C file
pearc hello.pr -o hello.c

# Compile Pear to binary (requires gcc or clang)
pearc hello.pr --binary -o hello

# Decompile C to Pear
pearc --decompile hello.c
```

---

## MCP Server

The MCP server exposes three tools:

- `pear_to_c(code)` — compile Pear to C source
- `c_to_pear(code)` — decompile C to minified Pear
- `pear_compile(code, output_file)` — compile Pear to binary via gcc/clang
