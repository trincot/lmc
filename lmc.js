// https://en.wikipedia.org/wiki/Little_man_computer

let mnemonics = {
    HLT: { opcode:   0, arg: 0 }, // HALT (or COFFEE BREAK) ignores the argument
    COB: { opcode:   0, arg: 0 }, //    alternative
    ADD: { opcode: 100, arg: 1 }, // ADD
    SUB: { opcode: 200, arg: 1 }, // SUBTRACT
    STA: { opcode: 300, arg: 1 }, // STORE
    STO: { opcode: 300, arg: 1 }, //    alternative
    LDA: { opcode: 500, arg: 1 }, // LOAD
    BRA: { opcode: 600, arg: 1 },
    BRZ: { opcode: 700, arg: 1 },
    BRP: { opcode: 800, arg: 1 },
    INP: { opcode: 901, arg: 0 }, // INPUT
    IN:  { opcode: 901, arg: 0 }, //    alternative
    OUT: { opcode: 902, arg: 0 }, // OUTPUT
    DAT: { arg: -1 } // No opcode, optional argument
};

class LMC {
    constructor(program, inbox = () => 0, outbox = console.log) {
        if (typeof inbox[Symbol.iterator] === 'function') {
            let iterator = inbox[Symbol.iterator]();
            this.inbox = () => iterator.next().value || 0;
        }
        this.inbox = inbox;
        this.outbox = outbox;
        this.load(program);
    }
    reset() {
        // Core properties
        this.mailbox = [];
        this.programCounter = 0;
        this.accumulator = 0;
        this.flag = 0;
        // Additional properties to aid disassembly
        this.mailboxName = [];
        this.codeMailboxes = new Set;
        this.labelLength = 0;

        if (/[^\w\s]/.test(this.program)) throw new Error("Invalid character in program");
        let lines = (this.program.match(/.+/g)||[]).map(line => line.match(/\w+/g));
        
        // First pass: identify labels
        let labels = {};
        lines.forEach((words, address) => {
            let line = words.join(" ");
            if (words[0] in mnemonics) return;
            let label = words.shift();
            if (label[0] <= "9") throw new Error("Label cannot start with digit in: " + line);
            labels[label] = address;
            this.mailboxName[address] = label;
            this.labelLength = Math.max(this.labelLength, label.length);
        });
        // Second pass: resolve symbols
        lines.forEach(([mnemonic, arg, more], address) => {
            let syntax = mnemonics[mnemonic];
            let line = (this.mailboxName[address]||"") + " " + lines[address].join(" ");
            if (!syntax) throw new Error("Unknown mnemonic in: " + line);
            if (!arg && syntax.arg > 0) throw new Error("Missing argument in: " + line);
            if (more || arg && syntax.arg === 0) throw new Error("Unexpected argument in: " + line);
            let numArg = arg === undefined ? 0 : isNaN(arg) ? +labels[arg] : +arg;
            if (Number.isNaN(numArg)) throw new Error("Undefined label in: " + line);
            this.mailbox[address] = (syntax.opcode || 0) + numArg;
            if (this.mailbox[address] < 0 || this.mailbox[address] > 999) throw new Error("Out of range value in: " + line);
            if ("opcode" in syntax) this.codeMailboxes.add(address);
        });
    }
    load(program) {
        if (program) this.program = program;
        this.reset();
    }
    disassembled() {
        if (this.mailbox[this.programCounter] === undefined) this.mailbox[this.programCounter] = 0;
        return this.mailbox.map((value, address) => {
            let line = (address+"").padStart(2, "0") + ": " + (value+"").padStart(3, "0") + " "
                + (this.mailboxName[address] || "").padEnd(this.labelLength, " ") + " ";
            if (!this.codeMailboxes.has(address) && address !== this.programCounter) return line + "DAT";
            let argument = this.mailboxName[value%100] || (value+"").slice(-2);
            for (let [mnemonic, { opcode, arg }] of Object.entries(mnemonics)) {
                if (value === opcode || arg && value > opcode && value < opcode + 100) {
                    return line + mnemonic + (arg ? " " + argument : "");
                }
            }
            return line + "???";
        });
    }
    run() {
        while (this.mailbox[this.programCounter]) this.step();
    }
    isDone() {
        return (this.mailbox[this.programCounter] || 0) < 100
    }
    step() {
        const add = (value) => {
            this.flag = +(this.accumulator + value < 0);
            this.accumulator = (this.accumulator + 1000 + value) % 1000;
            
        };
        let functions = [
            () => this.programCounter--,
            (address) => add(this.mailbox[address]),
            (address) => add(-this.mailbox[address]),
            (address) => this.mailbox[address] = this.accumulator,
            () => null,
            (address) => this.accumulator = this.mailbox[address],
            (address) => this.programCounter = address,
            (address) => this.accumulator === 0 && (this.programCounter = address),
            (address) => this.accumulator >=  0 && (this.programCounter = address),
            (inout) => inout === 1 ? this.accumulator = this.inbox()%1000 : this.outbox(this.accumulator)
        ];
        // Execution
        let content = this.mailbox[this.programCounter++];
        let arg = content % 100;
        let opcode = (content - arg) / 100;
        // do something
        functions[opcode](arg);
        return this.isDone();
    }
}

let lmc, timer = null, inputQueue=[];
function grabInput() {
    while (!inputQueue.length) {
        let s = prompt("Provide input. You may provide multiple values to avoid future prompts. Empty to break out.");
        if (!s) throw new Error("User interrupted");
        inputQueue = s.match(/\d{1,3}\b/g) || [];
    }
    return inputQueue.shift();
}
function updateOutput(val) {
    output.textContent = (output.textContent + "\n" + val).trim();
}
function displayStatus() {
    inputRun.textContent = inputQueue.join`\n`;
    acc.textContent = lmc.accumulator;
    neg.textContent = lmc.flag;
    let lines = lmc.disassembled();
    lines[lmc.programCounter] = '<span style="background: yellow">' + lines[lmc.programCounter] + "</span>";
    codeRun.innerHTML = lines.filter(Boolean).join`\n`;
    step.disabled = lmc.isDone();
}

function pause() {
    clearInterval(timer);
    timer = null;
    run.disabled = false;
}
function doStep() {
    if (lmc.isDone()) return restart();
    try { 
        if (lmc.step()) pause();
    } catch(e) {
        //pause();
        restart();
        console.log(e);
    }
    displayStatus();
}
function restart() {
    lmc.reset();
    inputQueue = [];
    output.textContent = "";
    pause();
    displayStatus();
}

document.addEventListener("DOMContentLoaded", function () {
    lmc = new LMC(document.body.childNodes[0].nodeValue, grabInput, updateOutput);
    document.body.textContent = "";
    document.body.insertAdjacentHTML("beforeend", `
<style>
    #repl td { border: 1px solid; vertical-align: top; padding: 3px } 
    #inputRun,#output,#acc,#neg { text-align: right } 
    #repl { border-collapse: collapse; font-family: monospace }
    pre { margin: 0px }
</style>
<table id="repl">
<tr><td><pre id="codeRun"></pre></td>
<td>Acc:<br><pre id="acc">0</pre><br>Neg:<br><pre id="neg">0</pre></td>
<td>Input:<br></textarea><pre id="inputRun"></pre></td>
<td>Output:<br><pre id="output"></pre></td>
</tr>

</table>
<button id="reset">Reset</button><button id="step">Step</button><button id="run">Run</button><br>
<br>
<br>`);
    reset.onclick = restart;
    run.onclick = function resume() {
        if (!lmc || lmc.isDone()) restart();
        run.disabled = true;
        clearInterval(timer);
        timer = setInterval(doStep, 100);
    };
    step.onclick = function () {
        if (lmc && lmc.isDone()) return;
        pause();
        doStep();
    };
    restart();
});
