# pearc

**Pear** is an ultra-minified C-targeting programming language designed to reduce token usage in LLM workflows while producing real, executable code.

The idea: write code that compiles to C — with ~35–50% fewer tokens than idiomatic C — then expand it back to readable code via a decompiler or MCP tool.

```pear
im<stdio.h>
st Point{x:f64;y:f64}
fn dist(a:*Point,b:*Point)->f64{dx:f64=a->x-b->x;dy:f64=a->y-b->y;rt sqrt(dx*dx+dy*dy)}
fn main()->i32{p1:Point={1.0,2.0};p2:Point={4.0,6.0};printf("%f\n",dist(&p1,&p2));rt 0}
```

## Install

```bash
npm install -g pearc
```

## Usage

```bash
pearc run file.pr                  # interpret and run directly (no C compiler needed)
pearc file.pr                      # compile Pear → C (stdout)
pearc file.pr -o out.c             # compile Pear → C file
pearc file.pr --binary -o out      # compile Pear → native binary (requires gcc/clang)
pearc --decompile file.c           # minify existing C → Pear
pearc --mcp                        # start MCP server (stdio)
```

## MCP Server

Add to Claude Code or any MCP client:

```json
{
  "mcpServers": {
    "pear": {
      "command": "npx",
      "args": ["pearc", "--mcp"]
    }
  }
}
```

**Tools exposed:**

| Tool | Description |
|------|-------------|
| `pear_to_c` | Compile Pear → C source |
| `c_to_pear` | Minify C → Pear |
| `pear_run` | Interpret and run Pear, returns stdout/stderr |
| `pear_compile` | Compile Pear → binary via gcc/clang |

## Language Reference

### Types

| Pear | C |
|------|---|
| `i8` `i16` `i32` `i64` | `int8_t` `int16_t` `int32_t` `int64_t` |
| `u8` `u16` `u32` `u64` | `uint8_t` `uint16_t` `uint32_t` `uint64_t` |
| `f32` `f64` | `float` `double` |
| `v` | `void` |
| `c` | `char` |
| `b` | `bool` |
| `sz` | `size_t` |
| `*T` | pointer to T |

### Keywords

| Pear | C |
|------|---|
| `fn` | function |
| `st` | struct |
| `un` | union |
| `en` | enum |
| `tp` | typedef |
| `if` `ei` `el` | if / else if / else |
| `lp` | for |
| `wh` | while |
| `dw` | do...while |
| `sw` `cs` `dv` | switch / case / default |
| `rt` | return |
| `bk` `ct` | break / continue |
| `sc` `ex` `in` `vl` `cn` | static / extern / inline / volatile / const |
| `im` | #include |
| `df` | #define |
| `pr` | #pragma |
| `so` | sizeof |

### Syntax

```pear
// Variable declaration: name:type = value
x:i32=5
ptr:*c=name

// Function: fn name(param:type,...)->rettype{...}
fn add(a:i32,b:i32)->i32{rt a+b}

// Struct
st Vec3{x:f32;y:f32;z:f32}

// For loop (same structure as C)
lp(i:i32=0;i<10;i++){printf("%d\n",i)}

// Include / define
im<stdio.h>
df MAX 1024
```

### Preprocessor

```pear
im<stdio.h>       // #include <stdio.h>
im"myfile.h"      // #include "myfile.h"
df NAME value     // #define NAME value
pr once           // #pragma once
```

## Token Savings

Pear reduces token count by ~35–50% vs idiomatic C:

```pear
// Pear: ~45 tokens
im<stdint.h>
st Point{x:f64;y:f64}
fn dist(a:*Point,b:*Point)->f64{dx:f64=a->x-b->x;dy:f64=a->y-b->y;rt sqrt(dx*dx+dy*dy)}
```

```c
// C: ~85 tokens
#include <stdint.h>
typedef struct { double x; double y; } Point;
double dist(Point *a, Point *b) {
    double dx = a->x - b->x;
    double dy = a->y - b->y;
    return sqrt(dx*dx + dy*dy);
}
```

## License

MIT
