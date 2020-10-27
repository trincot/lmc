# lmc

A JavaScript implementation of the [Little Man Computer (LMC)](https://en.wikipedia.org/wiki/Little_man_computer) which is intended to be used in a browser.

# How to Use

In your HTML page, define a container element with its `class` attribute set to `lmcContainer`, and put the LMC program code contents in it. For example:

```html
<div class="lmcContainer">
INP
STA 20
OUT
HLT 
</div>
```

Include the script in your HTML page with a `<script src="path/to/lmc.js"></script>` element.

Upon page load, the script will populate the `lmcContainer` container element, and allow you to define some input and run the script.

If there is no `lmcContainer` element, the first text node in the `<body>` element will be used as program code, and a container element will be created for it.

It was created in this way with StackSnippets in mind, so answers on StackOverflow could use a StackSnippet to demo some particular LMC program with nothing more than the LMC code and the `script` tag.

The page at https://trincot.github.io/lmc.html uses this implementation to provide an interactive LMC.

# Implementation details

## Ambiguities in the specifications

There are several things that are undefined by the LMC specification, and so simulators often differ in how code is interpreted. I have tried to stick as close as possible to the specification without extending it.

## The LMC can only store numbers in the range 0...999

Negative numbers cannot be stored. There are no values outside the range 0...999. This is true for the calculator (accumulator register), the mailboxes (memory cells), the input tray and the output tray.

When an `ADD` calculation would lead to a value greater than 999, or a `SUB` calculation would lead to a negative value, then the accumulator's value is undefined, but guaranteed to be in the range 0...999. This implementation will set the accumulator's value to the sum modulo 1000, but this should not be relied upon.

## The negative flag

Although negative values cannot be represented, when a `SUB` instruction is executed that would lead to a negative value, the negative flag is set. This is the only scenario where it is set. 

It is not specified when the negative flag should be cleared. This implementation will only clear that flag when a `LDA` or `INP` instruction is executed. Neither `SUB` nor `ADD` will clear the negative flag.

There is no flag for indicating a calculated value exceeded 999. Although it would make sense to somehow mark such an overflow, this is not specified, and so the only available flag, the negative flag, will *never* be touched by `ADD`, even if overflow occurs.

The LMC offers only one way to get the current value of the negative flag: the `BRP` instruction will result in a branch when the negative flag is not set. This decision is *not* determined by the value in the accumulator (which cannot be negative), but only by the negative flag. And the negative flag does not play any role in any subsequent calculation: the accumulator value is taken as-is, without taking the flag into account. For example, this means that in theory it cannot be guaranteed that doing `SUB MAILBOX` followed by `ADD MAILBOX` will restore the accumulator value to what it was before the `SUB` was executed. In this implementation this "inconsistency" will not occur as the overflow wraps around, so -1 becomes 999 and 1000 becomes 0. But this behaviour should not be relied upon.

The `BRZ` instruction however looks at the actual value in the accumulator, to see if it is zero. In this implementation the negative flag plays no role in this instruction. Note that it is possible to arrive in a situation where both the negative flag is set, and the (undefined) accumulator's value happens to be 0. In this implementation that occurs when a `SUB` is followed by an `ADD` that brings the accumulator's value to 0. In general, the specification does not forbid an implementation to set the accumulator to zero when a `SUB` leads to overflow.

## Extensions

There is one language extension (so far) in this implementation:

* `OTC` (instruction code 922). This is a variant of `OUT`. It will interpret the accumulator's value as a character code, and output the corresponding character.

## Undefined opcodes

The numbers in the range 001-099 have opcode 0 (the first digit) and so these numbers will also be executed as a `HLT` instruction.
There is however no opcode 4, and for opcode 9 the "address" part serves as an extention to the opcode: only 901, 902 and 922 are defined. This implementation will interrupt execution when instruction codes in the set 400-499, 900, 903-921, and 923-999 are encountered.

## Mnemonics

There are several variants of the mnemonics. Two common ones are supported here. They only differ for three instructions:

* `STO` = `STA`
* `BR` = `BRA`
* `IN` = `INP`

The preference is for the rightmost variants, as also listed on Wikipedia.

Some variants use `SKZ`, `SKP` and `JMP` instead of the `BR*` instructions, and assign different opcodes to the instruction set. These are not supported in this implementation.

# Other Emulators

* [Peter Higginson](https://peterhigginson.co.uk/lmc/)
* [Augustinas Lukauskas](https://code.sololearn.com/WOAExzP2u2yc/#html)
* [101Computing.net](https://www.101computing.net/LMC/)
* [SSJX.co.uk](http://ssjx.co.uk/games/educational/lmc.php)
* [Arnav Mukhopadhyay](https://sourceforge.net/projects/lmce/)
* [Paul Hankin](https://blog.paulhankin.net/lmc/lmc.html)
* [P Brinkmeier](https://github.com/pbrinkmeier/lmc-emulator)
* [Durham University](https://community.dur.ac.uk/m.j.r.bordewich/LMC.html)

# References

* [Wikipedia](https://en.wikipedia.org/wiki/Little_man_computer)
* Chapter 6 in "The Architecture of Computer Hardware and System Software", 4<sup>th</sup> edition, 2009, by Irv Englander
* [Notes by Ian! D. Allen](http://teaching.idallen.com/dat2343/01f/notes/lmc_lights.htm)
