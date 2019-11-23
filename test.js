// https://en.wikipedia.org/wiki/Little_man_computer

class LMC {
    constructor() {
        this.inbox = () => 0;
        this.outbox = console.log;
        this.onAcculmulatorChange = 
            this.onMailboxChange = 
            this.onSignChange =
            this.onHalt = () => null;
        this.flag = false;
        this.accumulator = 0;
        this.mailbox = [];
        // Additional properties to aid disassembly
        this.mailboxName = [];
        this.codeMailboxes = new Set;
        this.labelLength = 0;
    }
    setInputFromIterable(arr) {
        let iterator = arr[Symbol.iterator]();
        this.inbox = () => iterator.next().value || 0;
    }
    reset() {
        this.programCounter = 0;
    }
    load(program) {
        // Clear
        this.mailbox.length = 0;
        this.mailboxName.length = 0;
        this.codeMailboxes.clear();
        this.labelLength = 0;
        this.err = null;

        this.lines = program.match(/.+/g);
        let lineWords = this.lines.map(line => line.match(/\S+/g) || []);
        
        // First pass: identify labels
        let labels = {};
        lineWords.some((words, address) => {
            let line = this.lines[address];
            let i = line.search(/[^\w\s]/);
            if (i > -1) return this.err = { address, msg: "Invalid character '" + line[i] + "'" };
            if (words[0] in LMC.mnemonics || !isNaN(words[0])) return;
            let label = words.shift();
            if (label[0] <= "9") return this.err = { address, msg: "Label cannot start with a digit" };
            if (labels[label]) return this.err = { address, msg: "Label cannot be defined twice" };
            labels[label] = address;
            this.mailboxName[address] = label;
            this.labelLength = Math.max(this.labelLength, label.length);
        });
        // Second pass: resolve symbols
        if (!this.err) {
            lineWords.some((words, address) => {
                let line = this.lines[address];
                let [mnemonic, arg] = words;
                let syntax = LMC.mnemonics[mnemonic];
                if (/^\d{1,3}$/.test(mnemonic)) {
                    syntax = Object.values(LMC.mnemonics).find(({ opcode, arg }) => 
                        arg === 1 ? mnemonic[0]*100 == opcode : +mnemonic == opcode
                    ) || { arg: -1 };
                    arg = +mnemonic - (syntax.opcode || 0);
                }
                if (!syntax) return this.err = { address, msg: "Unknown mnemonic '" + mnemonic + "'" };
                if (arg === undefined && syntax.arg > 0) return this.err = { address, msg: mnemonic + " needs an argument" };
                if (arg && syntax.arg === 0) arg = 0; // ignore the argument -- it should be treated as a comment
                let mailbox = arg === undefined ? 0 : isNaN(arg) ? +labels[arg] : +arg;
                if (Number.isNaN(mailbox)) return this.err = { address, msg: "Undefined label " + arg };
                if ("opcode" in syntax && (mailbox < 0 || mailbox > 99)) return this.err = { address, msg: "Mailbox must be in the range 0..99" };
                this.mailbox[address] = (syntax.opcode||0) + mailbox;
                if (this.mailbox[address] < 0 || this.mailbox[address] > 999) return this.err = { address,  msg: "Out of range value" };
                if ("opcode" in syntax) this.codeMailboxes.add(address);
            });
        }
        // Initialise calculator & program counter
        this.calculate(0, false);
        if (this.flag) this.toggleFlag();
        this.reset();
    }
    disassembled() {
        if (this.err) return this.lines;
        if (this.mailbox[this.programCounter] === undefined) this.mailbox[this.programCounter] = 0;
        return this.mailbox.map((value, address) => {
            let line = (address+"").padStart(2, "0") + ": " + (value+"").padStart(3, "0") + " "
                + (this.mailboxName[address] || "").padEnd(this.labelLength, " ") + " ";
            if (!this.codeMailboxes.has(address) && address !== this.programCounter) return line + "DAT";
            let argument = this.mailboxName[value%100] || (value+"").slice(-2);
            for (let [mnemonic, { opcode, arg }] of Object.entries(LMC.mnemonics)) {
                if (value === opcode || arg && value > opcode && value < opcode + 100) {
                    return line + mnemonic + (arg ? " " + argument : "");
                }
            }
            return line + "DAT";
        });
    }
    run() {
        while (this.mailbox[this.programCounter]) this.step();
    }
    isDone() {
        return (this.mailbox[this.programCounter] || 0) < 100
    }
    toggleFlag() {
        this.flag = !this.flag;
        this.onSignChange(this.flag);
    }
    calculate(value, relative) {
        let changeFlag = false;
        if (relative) {
            value = this.accumulator + value;
            changeFlag = this.flag !== (value < 0);
        }
        this.accumulator = (1000 + value) % 1000;
        this.onAcculmulatorChange(this.accumulator);
        if (changeFlag) this.toggleFlag();
    }
    step() {
        let functions = [
            () => this.programCounter--,
            (address) => this.calculate(this.mailbox[address], true),
            (address) => this.calculate(-this.mailbox[address], true),
            (address) => this.onMailboxChange(address, this.mailbox[address] = this.accumulator),
            () => null, // NOOP
            (address) => this.calculate(this.mailbox[address], false),
            (address) => this.programCounter = address,
            (address) => this.accumulator === 0 && (this.programCounter = address),
            (address) => !this.flag && (this.programCounter = address),
            (inout) => inout === 1 ? this.calculate(this.inbox(), false)
                     : inout === 2 ? this.outbox(this.accumulator) 
                     : null // NOOP
        ];
        // Execution
        let content = this.mailbox[this.programCounter++];
        let arg = content % 100;
        let opcode = (content - arg) / 100;
        // do something
        functions[opcode](arg);
        if (this.isDone()) this.onHalt();
    }
}

LMC.mnemonics = {
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

LMC.createGUI = function(container) {
    let timer = null, inputTimer = null, originalInput = "";
    
    let programNode = container.childNodes[0];
    let program = programNode.nodeValue;
    if (!/\sHLT\s/.test(program)) return; // there is no program. Don't do anything
/*
    programNode.remove();
    container.insertAdjacentHTML("afterbegin", 
        (container === document.body ? "<style>body, html { margin: 0; }</style>" : "") + `
<div class="lmc">
    <div><div><div data-name="code"></div></div></div>
    <div><table>
        <tr><td class="lmcLabel">Acc:</td><td><input readonly data-name="acc" size="3"></td></tr>
        <tr><td class="lmcLabel">Neg:</td><td><input readonly data-name="neg" size="3"></td></tr>
        <tr><td class="lmcLabel">Input:</td><td><input data-name="input"></td></tr>
        <tr><td class="lmcLabel"><span>Output:</span></td><td><input readonly data-name="output"></td></tr>
        <tr><td colspan="2">
            <button data-name="run">Run</button>
            <button data-name="step">Step</button>
            <button data-name="reset">Reset</button>
            <button data-name="reload">Reload</button></td></tr>
        <tr><td colspan="2" data-name="err"></td></tr>
    </table></div>
</div>`);*/
    let lmc = new LMC;
    lmc.load(program);
    lmc.inbox = grabInput;
    lmc.outbox = updateOutput;
    let gui = {};
    for (let elem of container.querySelectorAll("[data-name]")) {
        gui[elem.dataset.name] = elem;
    }
    gui.run.onclick = run;
    gui.step.onclick = step;
    gui.reset.onclick = reset;
    gui.reload.onclick = reload;
    reset();

    function clipLastInputValue() {
        clearInterval(inputTimer);
        inputTimer = null;
        gui.input.value = gui.input.value.slice((gui.input.value + " ").indexOf(" ")+1);
        gui.input.readonly = false;
    }
    
    function grabInput() {
        if (inputTimer) clipLastInputValue();
        let s = gui.input.value;
        let prompted = false;
        while (true) {
            s = (s.match(/\d{1,3}(?!\d)/g) || []).join(" ");
            if (s) break;
            prompted = true;
            s = prompt("There is no input. Please provide one or more values. Leave empty to interrupt to program.");
            if (!s) throw new Error("User interrupted");
        }
        if (prompted || !originalInput) originalInput = (originalInput + " " + s).trim();
        gui.input.value = s;
        let val = parseInt(s);
        
        // Animate the removal of the input value from the input queue
        gui.input.readonly = true;
        inputTimer = setInterval(function () {
            let ch = gui.input.value[0];
            if (ch === " " || !ch) return clipLastInputValue();
            gui.input.value = gui.input.value.slice(1);
        }, 50);
        
        return val;
    }
    
    function updateOutput(val) {
        gui.output.value = (gui.output.value + " " + val).trim();
    }
    
    function displayStatus(andPause) {
        if (andPause) {
            clearInterval(timer);
            timer = null;
        }
        let focusLine = lmc.programCounter;
        let cls = "highlight";
        gui.acc.value = lmc.accumulator;
        gui.neg.value = lmc.flag ? "YES" : "NO";
        let lines = lmc.disassembled();
        let width = Math.max(...lines.map(line => line.length)) + 2;
        lines = lines.map(line => line && ('<span>' + (" " + line).padEnd(width, " ") + '</span>'));
        if (lmc.err) {
            focusLine = lmc.err.address;
            cls = "error";
            gui.err.textContent = lmc.err.msg;
        }
        lines[focusLine] = lines[focusLine].replace(">", ' class="' + cls + '">');
        gui.code.innerHTML = lines.filter(Boolean).join`\n`;
        gui.step.disabled = lmc.err || lmc.isDone();
        gui.run.disabled = !!timer || lmc.err || lmc.isDone();
        // Scroll highlighted line into view
        let focusSpan = gui.code.querySelector("." + cls);
        let scroll = gui.code.parentElement.scrollTop;
        let focusRect = focusSpan.getBoundingClientRect();
        let codeRect = gui.code.parentElement.getBoundingClientRect();
        let leastScroll = focusRect.bottom - codeRect.top - codeRect.height;
        let mostScroll = focusRect.top - codeRect.top;
        if (scroll > mostScroll) {
            gui.code.parentElement.scrollTop = mostScroll - 2;
        } else if (scroll < leastScroll) {
            gui.code.parentElement.scrollTop = leastScroll + 2;
        }
    }

    function doStep(andPause) {
        try {
            lmc.step();
            displayStatus(andPause || lmc.isDone());
        }
        catch (e) { // When user interrupts via prompt
            reload();
        }
    }
    
    function reset() {
        lmc.reset();
        displayStatus(true);
    }

    function reload() {
        lmc.load(program);
        gui.input.value = originalInput;
        originalInput = "";
        gui.output.value = "";
        reset();
    }

    function run() {
        timer = setInterval(doStep, 100);
        doStep();
    }

    function step() {
        doStep(true);
    }
}

document.addEventListener("DOMContentLoaded", function () {
/*    document.body.insertAdjacentHTML("beforeend", 
        `<style>
            .lmc {
              height: 100%;
              display: flex;
              flex-direction: row;
              font-family: monospace;
            }

            .lmc>div:first-child {
              display: flex;
              flex: 1;
              min-height: 0px;
            }

            .lmc>div:first-child>div {
              flex: 1;
              overflow-y: scroll;
              background-color: #f8f8f8;
            }

            .lmc>div:first-child>div>div {
              padding: 5px;
              white-space: pre;
            }

            .lmc>div:last-child {
              padding: 10px;
              background-color: #0B5AB0;
              color: white;
              width: 100%;
            }

            .lmc>div:last-child td:last-child { width: 100%; }
            .lmc input { font-family: inherit; border: 0.5px solid  }
            .lmc input[readonly] { background-color: #f8f8f8; }
            .lmc input[size="3"] { text-align: right }
            .lmc input:not([size="3"]) { width: 100% }
            .lmc .lmcLabel { text-align: right }
            .lmc .highlight { background: yellow }
            .lmc .error { background: red }
        </style>`);
*/
    document.querySelectorAll(".lmcContainer, body").forEach(LMC.createGUI);
});    
