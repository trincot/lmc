# lmc

A JavaScript implementation of the [Little Man Computer (LMC)](https://en.wikipedia.org/wiki/Little_man_computer) which is intended to be used in a browser.

# How to Use

In your HTML page, define a container element with its `id` attribute set to `lmc`, and put the LMC program code contents in it. For example:

```html
<div id="lmc">
INP
STA 20
OUT
HLT 
</div>
```

Include the script in your HTML page with a `<script src="path/to/lmc.js"></script>` element.

Upon page load, the script will enrich the `lmc` element, and allow you to define some input and run the script.

If there is no `lmc` element, the first text node in the `<body>` element will be used as program code, and a container element will be created for it.

It was created in this way with StackSnippets in mind, so answers on StackOverflow could use a StackSnippet to demo some particular LMC program with nothing more than the LMC code and the `script` tag.

# Implementation details

## Ambiguities in the specifications

There are several things that are undefined by the LMC specification, and so simulators often differ in how code is interpreted. I have tried to stick as close as possible to the specification without extending it.

## The LMC can only store numbers in the range 0...999

Negative numbers cannot be stored. There are no values outside the range 0...999. This is true for the calculator (accumulator register), the mailboxes (memory cells), the input tray and the output tray.

The only time the notion of negative is exposed is when a `SUB` instruction is executed that would lead to a negative value. The actual result in the accumulator is undefined, and should not be relied on. It will always be in the range 0...999. However, the negative flag will be set when this happens.

With `ADD` an overflow could occur when the result would be greater than 999. Also in that case the actual result in the accumulator is undefined, but always in the range 0...999. 
Although it would make sense to somehow mark such an overflow, this is not specified, and so the only available flag, the negative flag, will *always* be cleared by `ADD`, even if overflow occurs.

The negative flag is only set or cleared by the `ADD` and `SUB` operations. It will be set only in the above described `SUB` overflow case and cleared otherwise. This means that the flag will remain unaltered when other instructions are executed.

The negative flag is only used by LMC to determine whether a `BRP` should branch or not. This decision is *not* determined by the value in the accumulator (which cannot be negative), but by the negative flag. And the negative flag does not play any role in any subsequent calculation: the accumulator value is taken as-is, without taking the flag into account. For example, this means that in theory it cannot be guaranteed that doing `SUB MAILBOX` followed by `ADD MAILBOX` will restore the accumulator value to what it was before the `SUB` was executed. In this implementation this "inconsistency" will not occur as the overflow wraps around, so -1 becomes 999 and 1000 becomes 0. But this behaviour should not be relied on.

## Undefined opcodes

The numbers in the range 001-099 have opcode 0 (the first digit) and so these numbers will also be executed as a `HLT` instruction.
There is however no opcode 4, and for opcode 9 the "address" part serves as an extention to the opcode: only 901 and 902 are defined. This implementation will interpret opcodes in the set 400-499, 900 and 903-999 as `NOP` opertations: nothing happens, and the program will just continue with the next instruction. But this behaviour should not be relied on.

## Mnemonics

There are several variants of the mnemonics. Two common ones are supported here. They only differ for three instructions:

* `STO` = `STA`
* `BR` = `BRA`
* `IN` = `INP`

The preference is for the rightmost variants, as also listed on Wikipedia.

# References

* [Wikipedia](https://en.wikipedia.org/wiki/Little_man_computer)
* Chapter 6 in "The Architecture of Computer Hardware and System Software", 4<sup>th</sup> edition, 2009, by Irv Englander
* [Notes by Ian! D. Allen](http://teaching.idallen.com/dat2343/01f/notes/lmc_lights.htm)
