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

It was created in this way with Stack Snippets in mind, so answers on Stack Overflow could use a Stack Snippet to demo some particular LMC program with nothing more than the LMC code and the `script` tag.

The page at https://trincot.github.io/lmc.html uses this implementation to provide an interactive LMC.

# Implementation details

## Ambiguities in the specifications

There are several things that are undefined by the LMC specification, and so simulators often differ in how code is interpreted.
Like other implementors I had to make some choices.

## The LMC can only store numbers in the range 0...999

Negative numbers cannot be stored. There are no values outside the range 0...999. This is true for the calculator (accumulator register), the mailboxes (memory cells), the input tray and the output tray.

When an `ADD` calculation would lead to a value greater than 999, or a `SUB` calculation would lead to a negative value, then the accumulator's value can not be relied upon. This means that although the accumulato's value will still be in the range 0...999, one cannot be sure that different LMC implementations will produce the same value in this scenario.
This implementation will use modulo 1000 arithmetic, but this should not be relied upon.

By default this LMC will produce a run time error when code needs to use the accumulator's value after it got in such an unreliable state. It is an option that can be turned off.

## The negative flag

Although negative values cannot be represented, when a `SUB` instruction is executed that would lead to a negative value, the negative flag is set. 

This is the only described scenario where it is set. By default, this implementation will also set the flag when an `ADD` leads to overflow. This option can be turned off, but it is advised to leave it on, as otherwise there is no way to detect that overflow occured.

It is not specified when the negative flag should be *cleared*. This implementation will only clear that flag when a `LDA` or `INP` instruction is executed. Neither `SUB` nor `ADD` will clear the negative flag. The idea behind this choice is that then the negative flag is an indication of whether the accumulator's value can be relied upon. And once it is not reliable, the only way to make it reliable again, is to load a new value into it that is unrelated to its current value.

The LMC offers only one way to get the current value of the negative flag: the `BRP` instruction will result in a branch when the negative flag is not set. This decision is *not* determined by the value in the accumulator (which cannot be negative), but only by the negative flag. And the negative flag does not play any role in any subsequent calculation: the accumulator value is taken as-is, without taking the flag into account. For example, this means that in theory it cannot be guaranteed that doing `SUB MAILBOX` followed by `ADD MAILBOX` will restore the accumulator value to what it was before the `SUB` was executed. 
In this implementation this "inconsistency" will not occur as the overflow wraps around, so -1 becomes 999 and 1000 becomes 0. But this behaviour should not be relied upon. What's more, by default this implementation will raise an exception when an `ADD`, `SUB`, `STA`, `OUT`, or `BRZ` is executed when the accumulator's value is not reliable.

The `BRZ` instruction looks at the actual value in the accumulator, to see if it is zero. In this implementation the negative flag plays no role in this instruction. 
Note that it is possible to arrive in a situation where both the negative flag is set, and the (undefined) accumulator's value happens to be 0. In this implementation that occurs when a `SUB` is followed by an `ADD` that brings the accumulator's value to 0. In general, the specification does not forbid an implementation to set the accumulator to zero when a `SUB` leads to overflow. Again, by default this implementation would raise an exception when you execute a `BRZ` when the negative flag is set. Portable code should avoid this situation.

To ensure that code runs as expected on different implementations:

* Only use `BRP` when the last instruction that modified the accumulator was a `SUB`.
* Only use `BRZ`, `ADD` or `SUB` when it is guaranteed that the negative flag is not set. If it is possible that the negative flag is set, then first execute a `BRP` and branch to the relevant instruction.
* Ensure that `ADD` never overflows the accumulator, as there is no specified way to detect this, nor can you rely on the accumulator's value.

## Extensions

There is one language extension (so far) in this implementation:

* `OTC` (instruction code 922). This is a variant of `OUT`. It will interpret the accumulator's value as a character code, and output the corresponding character.

## Undefined opcodes

The numbers in the range 001-099 have opcode 0 (the first digit) and so these numbers represent a `HLT` instruction. However, by default this implementation will produce an error in this case. This option can be turned off.
There is no opcode 4, and for opcode 9 the "address" part serves as an extention to the opcode: only 901, 902 and 922 are defined. This implementation will interrupt execution when instruction codes in the set 400-499, 900, 903-921, and 923-999 are encountered. There is no option to change this behaviour.

## Mnemonics

There are several variants of the mnemonics. Two common ones are supported here. They only differ for some instructions:

* `STO` = `STA`
* `BR` = `BRA`
* `IN` = `INP`
* `COB` = `HLT`

The preference is for the rightmost variants, as also listed on Wikipedia.

Some (older) variants use `SKZ`, `SKP` and `JMP` instead of the `BR*` instructions, and assign different opcodes to the instruction set. These are not supported in this implementation.

# Other Emulators

* [Peter Higginson](https://peterhigginson.co.uk/lmc/)
* [Augustinas Lukauskas](https://code.sololearn.com/WOAExzP2u2yc/#html)
* [101Computing.net](https://www.101computing.net/LMC/)
* [SSJX.co.uk](http://ssjx.co.uk/games/educational/lmc.php)
* [Arnav Mukhopadhyay](https://sourceforge.net/projects/lmce/)
* [Paul Hankin](https://blog.paulhankin.net/lmc/lmc.html)
* [P Brinkmeier](https://github.com/pbrinkmeier/lmc-emulator)
* [Magnus Bordewich, Durham University](https://community.dur.ac.uk/m.j.r.bordewich/LMC.html) (executable)
* [robowriter](http://robowriter.info/little-man-computer/)
* [Michael Schwarz](https://lmcsimulator.micschwarz.dev/) (assembly does not work)

# References

* [Wikipedia](https://en.wikipedia.org/wiki/Little_man_computer)
* Chapter 6 in "The Architecture of Computer Hardware and System Software", 4<sup>th</sup> edition, 2009, by Irv Englander
* [Notes by Ian! D. Allen](http://teaching.idallen.com/dat2343/01f/notes/lmc_lights.htm)
