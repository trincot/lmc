class LMC {
    constructor() {
        this.inbox = () => 0;
        this.outbox = console.log;
        this.flag = false;
        this.accumulator = 0;
        this.mailbox = [];
        this.reset();
        // Additional properties to aid disassembly
        this.mailboxName = [];
        this.codeMailboxes = new Set;
        this.labelLength = 0;
        this.err = null;
    }
    /* Sets the inbox property to a callback function that will consume the given iterable */
    setInputFromIterable(arr) {
        let iterator = arr[Symbol.iterator]();
        this.inbox = () => iterator.next().value || 0;
    }
    /* Core: resets the program counter */
    reset() {
        this.programCounter = 0;
    }
    /* Clears the state and assembles the given program into instruction codes and stores those in the mailboxes.

           error = lmc.load(program)
       
       - program: string
       Each line in the string needs to have one of the following formats:
       
           [label] mnemonic [argument] [comment]
       
       Or
       
           [label] [3 digit instruction code] [comment]
          
       Comments must start with a freely chosen non-alphanumerical delimiter, like /, # or ;
       The call may return an error object:
       
           { address: number, msg: string }

       The return value is undefined when no error occured.       
    */
    load(program) {
        // Clear
        this.mailbox.length = 0;
        this.mailboxName.length = 0;
        this.codeMailboxes.clear();
        this.labelLength = 0;
        this.err = null;

        this.lines = program.match(/^([ \t]*\w+)+/gm); // Ignore comments
        let lineWords = this.lines.map(line => line.match(/\S+/g) || []);
        
        // First pass: identify labels
        let labels = {};
        lineWords.some((words, address) => {
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
        this.accumulator = 0;
        this.flag = false;
        this.reset();
    }
    /* Gets a text version of the mailbox contents */
    disassembled() {
        if (this.err) return this.lines;
        return this.mailbox.map((value, address) => {
            let line = (address+"").padStart(2, "0") + ": " + (value+"").padStart(3, "0") + " "
                + (this.mailboxName[address] || "").padEnd(this.labelLength, " ") + " ";
            if (this.codeMailboxes.has(address) || address === this.programCounter) {
                let argument = this.mailboxName[value%100] || (value+"").slice(-2);
                for (let [mnemonic, { opcode, arg }] of Object.entries(LMC.mnemonics)) {
                    if (value === opcode || arg && value > opcode && value < opcode + 100) {
                        return line + mnemonic + (arg ? " " + argument : "");
                    }
                }
            }
            return line + "DAT" + (""+value).padStart(4, " ");
        });
    }
    /* Repeatedly performs a step */
    run() {
        while (this.step()) {}
    }
    /* Returns true when the current instruction has opcode 0.  */
    isDone() {
        return (this.mailbox[this.programCounter] || 0) < 100;
    }
    /* Performs the current instruction and updates the program counter. When input is needed and there is none, or when
       the instruction is HLT, then the program counter is not altered. In those cases the function returns false. In all
       other cases, true.
    */
    step() {
        let log = {
            reads: [],
            writes: []
        };
        let inputValue = 0;
        // Wrapper functions for accessing the LCM core
        let mailbox = (address, value) => {
            if (value !== undefined) {
                this.mailbox[address] = value;
                log.writes.push(address);
            } else {
                value = this.mailbox[address];
                if (value === undefined) this.mailbox[address] = value = 0;
                log.reads.push(address);
            }
            return value;
        };
        /* calculate(value, relative):
         * Perform an action on the accumulator. If the relative argument is set, the value is added to the accumulator and 
         * the negative flag is updated. The flag becomes true only when the calculation yields a negative value.
         * If not relative, the value is just stored in the accululator. 
         * The onAccumulatorChange callback is called with the new value as argument.
         */
        let calculator = (value, relative) => {
            if (value === undefined) {
                log.reads.push("ACC");
                return this.accumulator;
            } else {
                if (relative) {
                    value = calculator() + value;
                    flag(value < 0);
                }
                log.writes.push("ACC");
                this.accumulator = (1000 + value) % 1000;
            }
        };
        let flag = (value) => {
            if (value === undefined) {
                log.reads.push("NEG");
                return this.flag;
            } else {
                log.writes.push("NEG");
                this.flag = value;
            }
        };
        let halt = () => this.programCounter = (this.programCounter + 99) % 100;
        let functions = [
            halt,
            (address) => calculator(mailbox(address), true),
            (address) => calculator(-mailbox(address), true),
            (address) => mailbox(address, calculator()),
            () => null, // NOOP
            (address) => calculator(mailbox(address), false),
            (address) => this.programCounter = address,
            (address) => calculator() === 0 && (this.programCounter = address),
            (address) => !flag() && (this.programCounter = address),
            (inout) => inout === 1 ? !isNaN(inputValue = this.inbox()) && log.reads.push("INP") && calculator(inputValue, false)
                     : inout === 2 ? log.writes.push("OUT") && this.outbox(calculator())
                     : null // NOOP
        ];
        // Read instruction
        let content = this.mailbox[this.programCounter] || 0;
        // Update program counter (wrap around)
        this.programCounter = (this.programCounter + 1) % 100;
        // Execute the instruction
        functions[Math.floor(content / 100)](content % 100);
        if (this.mailbox[this.programCounter] === undefined) this.mailbox[this.programCounter] = 0;
        if (isNaN(inputValue)) halt(); // Input is lacking
        else if (!this.isDone()) return log;
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

/* LMC.createGUI(container)
   Reads the first text node in the given DOM container element and loads it in a new LMC instance.
   This text node is replaced by an widget allowing to run the program step by step.
*/

LMC.createGUI = function(container) {
    let timer, inputTimer, outputTimer, processedInput = [];
    
    let programNode = container.childNodes[0];
    let program = programNode.nodeValue;
    if (!/\sHLT\s/i.test(program)) return; // there is no program. Don't do anything
    programNode.remove();
    
    container.insertAdjacentHTML("afterbegin", 
        (container === document.body ? "<style>body, html { margin: 0; height: 100vh }</style>" : "") + `
<div class="lmc">
    <div><div><div data-name="code"></div></div></div>
    <div><table>
        <tr><td class="lmcLabel">Acc:</td><td><input readonly data-name="acc" size="3">
            Neg: <input readonly data-name="neg" size="3">
            <button data-name="reload">Reload</button></td></tr>
        <tr><td class="lmcLabel">Input:</td><td><input data-name="input"></td></tr>
        <tr><td class="lmcLabel"><span>Output:</span></td><td><input readonly data-name="output"></td></tr>
        <tr><td colspan="2">
            <button data-name="run">Run</button>
            <button data-name="walk">Walk</button>
            <button data-name="step">Step</button>
            </td></tr>
        <tr><td colspan="2" data-name="err"></td></tr>
    </table></div>
</div>`);
    
    let gui = {};
    for (let elem of container.querySelectorAll("[data-name]")) {
        gui[elem.dataset.name] = elem;
    }

    let lmc = new LMC;
    lmc.load(program);

    lmc.inbox = function grabInput() {
        function clipLastInputValue() {
            clearInterval(inputTimer);
            inputTimer = null;
            gui.input.value = gui.input.value.slice((gui.input.value + " ").indexOf(" ")+1);
            gui.input.readonly = false;
        }
        if (inputTimer) clipLastInputValue();
        let s = (gui.input.value.match(/\d{1,3}(?!\d)/g) || []).join(" ");
        if (!s) {
            gui.input.value = "";
            gui.input.placeholder = "Waiting for your input...";
            gui.input.focus();
            return;
        }
        gui.input.value = s;
        gui.input.placeholder = "";
        let val = parseInt(s);
        processedInput.push(val);
        // Animate the removal of the input value from the input queue
        gui.input.readonly = true;
        inputTimer = setInterval(function () {
            let ch = gui.input.value[0];
            if (ch === " " || !ch) return clipLastInputValue();
            gui.input.value = gui.input.value.slice(1);
        }, 50);
        
        return val;
    };
    
    lmc.outbox = function updateOutput(val) {
        gui.output.scrollLeft = 10000;
        gui.output.value = (gui.output.value + " " + val).trim();
        clearInterval(outputTimer);
        outputTimer = setInterval(function () {
            let left = gui.output.scrollLeft;
            gui.output.scrollLeft = left + 2;
            if (left === gui.output.scrollLeft) clearInterval(outputTimer);
        }, 10);
    };
    
    gui.run.onclick = () => run(1);
    gui.walk.onclick = () => run(200);
    gui.step.onclick = () => run(0);

    function run(delay) {
        let doStep = () => displayStatus(!lmc.step());
        clearInterval(timer);
        timer = delay ? setInterval(doStep, delay) : null;
        doStep();
    }

    gui.reload.onclick = function reload() {
        lmc.load(program);
        gui.input.value = (processedInput.join(" ") + " " + gui.input.value).trim();
        processedInput = [];
        gui.output.value = "";
        displayStatus(true);
    };

    displayStatus(true);
   
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
        let width = Math.max(...lines.filter(Boolean).map(line => line.length)) + 2;
        lines = lines.map(line => line && ('<span>' + (" " + line).padEnd(width, " ") + '</span>'));
        if (lmc.err) {
            focusLine = lmc.err.address;
            cls = "error";
            gui.err.textContent = lmc.err.msg;
        }
        lines[focusLine] = lines[focusLine].replace(">", ' class="' + cls + '">');
        gui.code.innerHTML = lines.filter(Boolean).join`\n`;
        gui.step.disabled = lmc.err || lmc.isDone();
        gui.run.disabled = gui.walk.disabled = lmc.err || lmc.isDone();
        // Scroll highlighted line into view
        let focusSpan = gui.code.querySelector("." + cls);
        let focusRect = focusSpan.getBoundingClientRect();
        let codeRect = gui.code.parentElement.getBoundingClientRect();
        let add = focusRect.bottom - codeRect.bottom;
        let sub = codeRect.top - focusRect.top;
        if (add > 0) {
            gui.code.parentElement.scrollTop += add + 2;
        } else if (sub > 0) {
            gui.code.parentElement.scrollTop -= sub + 2;
        }
    }
}

document.addEventListener("DOMContentLoaded", function () {
    document.body.insertAdjacentHTML("beforeend", 
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
            .lmc input { font-family: inherit; border: 0.5px solid; padding-right: 1px; padding-left: 1px;  }
            .lmc input::placeholder { background-color: yellow;  }
            .lmc input[readonly] { background-color: #f8f8f8; }
            .lmc input[size="3"] { text-align: right }
            .lmc input:not([size="3"]) { width: 100% }
            .lmc button { width: 4em }
            .lmc .lmcLabel { text-align: right }
            .lmc .highlight { background: yellow }
            .lmc .error { background: red }
            .lmc td { white-space:nowrap }
        </style>`);
    document.querySelectorAll(".lmcContainer, body").forEach(LMC.createGUI);
});    
