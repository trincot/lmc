class LMC {
    static intmod(val, end=1000) {
        return (Math.floor(val) % end + end) % end || 0;
    }
    constructor() {
        this._flag = false;
        this._accumulator = 0;
        this._programCounter = 0;
        this._mailbox = [];
        this.mailbox = new Proxy(this._mailbox, {
            set(mailbox, address, value) {
                if (isNaN(address)) return mailbox[address] = value;
                return mailbox[LMC.intmod(address, 100)] = LMC.intmod(value);
            },
            get(mailbox, address) {
                if (isNaN(address)) return mailbox[address];
                return LMC.intmod(mailbox[LMC.intmod(address, 100)]);
            }
        });
        // Additional properties to aid disassembly
        this.mailboxName = [];
        this.comment = [];
        this.codeMailboxes = new Set;
        this.labelLength = 0;
        this.err = null;
        this.loaded = false;
    }
    inbox() { return 123; };
    outbox(value) { console.log(value); }
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
        this.program = program
        // Clear
        this._mailbox.length = 0;
        this.mailboxName.length = 0;
        this.comment.length = 0;
        this.codeMailboxes.clear();
        this.labelLength = 0;
        this.err = null;
        this.loaded = false;

        this.lines = program.match(/^[ \t]*\w.*/gm) || ["HLT"];
        let lineWords = this.lines.map(line => line.match(/[^\s\w].*|\S+/g) || []);
        // First pass: identify labels
        let labels = {};
        for (let [address, words] of lineWords.entries()) {
            if (words[0].toUpperCase() in LMC.mnemonics || !isNaN(words[0])) continue; // no label here
            let label = words.shift();
            if (!words.length) return this.err = { address, msg: "'" + label + "' is not a valid mnemonic" };
            if (label[0] <= "9") return this.err = { address, msg: "'" + label + "' cannot start with a digit" };
            if (labels[label]) return this.err = { address, msg: "'" + label + "' cannot be defined twice" };
            labels[label.toUpperCase()] = address;
            this.mailboxName[address] = label;
            this.labelLength = Math.max(this.labelLength, label.length);
        }
        // Second pass: resolve symbols
        for (let [address, words] of lineWords.entries()) {
            let [mnemonic, arg, more] = words;
            if (arg && /\W/.test(arg[0])) [arg, more] = [, arg]; 
            let syntax = LMC.mnemonics[mnemonic.toUpperCase()];
            if (/^\d{1,3}$/.test(mnemonic)) {
                syntax = Object.values(LMC.mnemonics).find(({ opcode, arg }) => 
                    arg === 1 ? mnemonic[0]*100 == opcode : +mnemonic == opcode
                ) || { arg: -1 };
                arg = +mnemonic - (syntax.opcode || 0);
            }
            if (!syntax) return this.err = { address, msg: "Unknown mnemonic '" + mnemonic + "'" };
            if (arg === undefined && syntax.arg > 0) return this.err = { address, msg: mnemonic + " needs an argument" };
            if (arg !== undefined && syntax.arg === 0) return this.err = { address, msg: mnemonic + " should not have an argument" };
            let mailbox = arg === undefined ? 0 : isNaN(arg) ? +labels[arg.toUpperCase()] : +arg;
            if (Number.isNaN(mailbox)) return this.err = { address, msg: "Undefined label '" + arg + "'" };
            if ("opcode" in syntax && (mailbox < 0 || mailbox > 99)) return this.err = { address, msg: "Mailbox must be in the range 0..99" };
            this._mailbox[address] = (syntax.opcode||0) + mailbox;
            if (this._mailbox[address] < 0 || this._mailbox[address] > 999) return this.err = { address,  msg: "Out of range value" };
            if ("opcode" in syntax) this.codeMailboxes.add(address);
            this.comment[address] = more || "";
        }
        // Initialise calculator & program counter
        this._accumulator = 0;
        this._flag = false;
        this._programCounter = 0;
        this.loaded = true;
    }
    /* Gets a text version of the mailbox contents */
    disassembled() {
        if (!this.loaded) {
            return this.lines.map((line, address) =>
                [(address+"").padStart(2, " "),
                 "".padStart(3, " "),
                 line,
                 "", "", "", ""]
            );
        }
        return this._mailbox.map((value, address) => {
            let line = [(address+"").padStart(2, "0"),
                        (value+"").padStart(3, "0"),
                        (this.mailboxName[address] || "").padEnd(this.labelLength, " ")];
            this.comment[address] = this.comment[address] || "";
            if (this.codeMailboxes.has(address) || address === this.programCounter) {
                let argument = this.mailboxName[value%100] || (value+"").slice(-2);
                for (let [mnemonic, { opcode, arg }] of Object.entries(LMC.mnemonics)) {
                    if (value === opcode || arg && value > opcode && value < opcode + 100) {
                        line.push(mnemonic);
                        line.push((arg ? argument : "").padEnd(this.labelLength, " "));
                        // Add the value that the argument currently has when it's not a branch instruction
                        line.push((arg && mnemonic[0] !== "B" ? ""+(this._mailbox[value%100] || 0) : "").padEnd(3, " "), this.comment[address]);
                        return line;
                    }
                }
            }
            line.push("DAT", (""+value).padEnd(this.labelLength, " "), "   ", this.comment[address]);
            return line;
        }).filter(Boolean);
    }
    /* Repeatedly performs a step */
    run() {
        while (this.step()) {}
    }
    /* Returns true when the current instruction has opcode 0.  */
    isDone() {
        return this._mailbox[this.programCounter] < 100;
    }
    get flag() {
        return this._flag;
    }
    set flag(value) {
        this._flag = !!value;
    }
    get accumulator() {
        return this._accumulator;
    }
    /* Setting the accumulator, with LDA or INP, clears the negative flag */
    set accumulator(value) {
        this.flag = false;
        this._accumulator = LMC.intmod(value);
    }
    get programCounter() {
        return this._programCounter;
    }
    set programCounter(next) {
        this._programCounter = LMC.intmod(next, 100);
        // If this instruction is undefined, initialise it, but without reading it yet
        if (this._mailbox[this.programCounter] === undefined) this._mailbox[this.programCounter] = 0;
    }
    /* Performing a calculation, i.e. with SUB or ADD, never clears the flag.
     * Only SUB can set the flag, in case the sum is negative.
     * As a consequence there is no dependecy between accumulator value
     * and flag: e.g. the accumulator can be zero and the flag set:
     *    LDA zero; SUB one; ADD one
     * Now accumulator is still undefined, but in practice it could be 0
     * So then BRP will not branch, but BRZ will.
     */
    add(delta) {
        let value = this.accumulator + delta;
        // It is debatable whether value >= 1000 should also set the flag...
        if (value < 0) this.flag = true;
        // Do not use setter, as otherwise the flag would be cleared
        return this._accumulator = LMC.intmod(value);
    }
    /* Performs the current instruction and updates the program counter. When input is needed and there is none, or when
       the instruction is HLT, then the program counter is not altered. In those cases the function returns false. In all
       other cases, true.
    */
    step() {
        let halt = () => { this.programCounter-- }; // must return undefined
        let functions = {
            0: /* HLT */ halt,
            1: /* ADD */ (opcode) => this.add(this.mailbox[opcode]),
            2: /* SUB */ (opcode) => this.add(-this.mailbox[opcode]),
            3: /* STA */ (opcode) => this.mailbox[opcode] = this.accumulator,
            5: /* LDA */ (opcode) => this.accumulator = this.mailbox[opcode],
            6: /* BRA */ (opcode) => this.programCounter = opcode,
            7: /* BRZ */ (opcode) => this.accumulator === 0 && (this.programCounter = opcode),
            8: /* BRP */ (opcode) => !this.flag && (this.programCounter = opcode),
          901: /* INP */ () => ((inputValue) => inputValue === undefined ? halt() : (this.accumulator = inputValue))(this.inbox()),
          902: /* OUT */ () => this.outbox(this.accumulator),
          922: /* OTC */ () => this.outbox(String.fromCharCode(this.accumulator)),
          999: /* ??? */ (opcode) => {
                halt(); 
                this.err = {
                    address: this.programCounter,
                    msg: "Abnormal termination: invalid opcode " + opcode
                };
            }
        };
        // Read instruction
        let opcode = this.mailbox[this.programCounter];
        // Get corresponding function
        let fun = functions[Math.floor(opcode / 100)] || functions[opcode] || functions[999];
        // Update program counter (wrap around - see setter)
        this.programCounter++;
        // Execute the instruction and return whether we can continue (input provided and valid opcode)
        return fun(opcode) !== undefined && !this.isDone();
    }
}

LMC.mnemonics = {
    HLT: { opcode:   0, arg: 0 }, // HALT (or COFFEE BREAK) ignores the argument
    COB: { opcode:   0, arg: 0 }, //    alternative
    ADD: { opcode: 100, arg: 1 }, // ADD
    SUB: { opcode: 200, arg: 1 }, // SUBTRACT
    STA: { opcode: 300, arg: 1 }, // STORE ACCUMULATOR
    STO: { opcode: 300, arg: 1 }, //    alternative
    LDA: { opcode: 500, arg: 1 }, // LOAD ACCUMULATOR
    BRA: { opcode: 600, arg: 1 }, // BRANCH ALWAYS
    BR:  { opcode: 600, arg: 1 }, //    alternative
    BRZ: { opcode: 700, arg: 1 }, // BRANCH IF ZERO
    BRP: { opcode: 800, arg: 1 }, // BRANCH IF POSITIVE
    INP: { opcode: 901, arg: 0 }, // INPUT
    IN:  { opcode: 901, arg: 0 }, //    alternative
    OUT: { opcode: 902, arg: 0 }, // OUTPUT
    OTC: { opcode: 922, arg: 0 }, // OUTPUT CHAR = non-standard character output
    DAT: { arg: -1 } // No opcode, optional argument
};

/* LMC.createGUI(container)
   Reads the first text node in the given DOM container element and loads it in a new LMC instance.
   This text node is replaced by an widget allowing to run the program step by step.
*/

class LmcGui extends LMC {
    constructor (container, auto=false) {
        super();
        
        let programNode = container.childNodes[0];
        let program = programNode.nodeValue.trim();
        // Do not create the GUI when in automatic mode, and there is no program.
        if (auto && !/\sHLT\b/i.test(program)) return; 

        programNode.remove();
        
        container.insertAdjacentHTML("afterbegin", 
            (container === document.body ? "<style>body, html { margin: 0; height: 100vh }</style>" : "") + `
    <div class="lmc">
        <div data-name="code"></div>
        <div>
            <span class="lmcNowrap"><span>Acc:</span><input type="text" readonly data-name="acc" size="3"></span>
            <span class="lmcNowrap"><span>Neg:</span><input type="text" readonly data-name="neg" size="3"></span>
            <span class="lmcNowrap"><span>Inp:</span><input type="text" data-name="input"></span>
            <span class="lmcNowrap"><span>Out:</span><input type="text" readonly data-name="output"></span>
            <span class="lmcActions">
                <button data-name="run">Run</button><button data-name="walk">Walk</button><button data-name="step">Step<small> F8</small></button><button data-name="reload">Reload</button>
            </span>
            <span data-name="err"></span>
        </div>
    </div>`);
        
        this.timer = this.inputTimer = this.outputTimer = null;
        this.processedInput = [];
        this.gui = {};
        for (let elem of container.querySelectorAll(".lmc [data-name]")) {
            this.gui[elem.dataset.name] = elem;
        }

        this.gui.run.onclick = () => this.run(1);
        this.gui.walk.onclick = () => this.run(400);
        this.gui.step.onclick = () => this.run(0);
        document.body.addEventListener("keydown", (e) => e.key === 'F8' && this.run(0));
        this.gui.reload.onclick = () => this.load();
        
        program = this.load(program);        
    }
    inbox() { // override
        const clipLastInputValue = () => {
            clearInterval(this.inputTimer);
            this.inputTimer = null;
            this.gui.input.value = this.gui.input.value.slice((this.gui.input.value + " ").indexOf(" ")+1);
            this.gui.input.readonly = false;
        }
        if (this.inputTimer) clipLastInputValue();
        let s = (this.gui.input.value.match(/\d{1,3}(?!\d)/g) || []).join(" ");
        if (!s) {
            this.gui.input.value = "";
            this.gui.input.placeholder = "Waiting for your input...";
            this.gui.input.focus();
            return;
        }
        this.gui.input.value = s;
        this.gui.input.placeholder = "";
        let val = parseInt(s);
        this.processedInput.push(val);
        // Animate the removal of the input value from the input queue
        this.gui.input.readonly = true;
        this.inputTimer = setInterval(() => {
            let ch = this.gui.input.value[0];
            if (ch === " " || !ch) return clipLastInputValue();
            this.gui.input.value = this.gui.input.value.slice(1);
        }, 50);
        
        return val;
    }
    outbox(val) { // override
        this.gui.output.scrollLeft = 10000;
        if (typeof val === "number" && this.gui.output.value) val = " " + val;
        clearInterval(this.outputTimer);
        this.outputTimer = setInterval(() => {
            let left = this.gui.output.scrollLeft;
            this.gui.output.scrollLeft = left + 2;
            if (left === this.gui.output.scrollLeft) clearInterval(this.outputTimer);
        }, 10);
        return this.gui.output.value += val;
    }
    run(delay) { // override
        let doStep = () => this.displayStatus(!this.step());
        clearInterval(this.timer);
        this.timer = delay ? setInterval(doStep, delay) : null;
        doStep();
    }
    
    load(program=this.program) { // override
        if (program.slice(0, 7) === "#input:") { // Get directive on first line
            let i = program.search(/\r?\n/);
            this.gui.input.value = program.slice(7, i).trim(); // pre-fill the input field.
            program = program.slice(i).trim();
        }
        super.load(program);
        this.gui.input.value = (this.processedInput.join(" ") + " " + this.gui.input.value).trim();
        this.gui.input.focus();
        this.gui.input.select();
        this.processedInput = [];
        this.gui.output.value = "";
        this.displayStatus(true);
        return program;
    }
    displayStatus(andPause=!this.timer) {
        if (andPause) {
            clearInterval(this.timer);
            this.timer = null;
        }
        let focusLine = this._programCounter;
        let cls = "highlight";
        this.gui.acc.value = this._accumulator;
        this.gui.neg.value = this._flag ? "YES" : "NO";
        this.gui.neg.style.backgroundColor = this._flag ? "orange" : "";
        let lines = this.disassembled();
        if (this.err) {
            focusLine = this.err.address;
            cls = "error";
            this.gui.err.textContent = this.err.msg;
        }
        let template = "Front>@: @.Label> @ .Mnemo>@ .Arg>@.Inspect>@.@Comment>@."
            .replace(/\w+/g, '<span class="lmc$&"').replace(/\./g, "</span>");
        
        focusLine = lines.findIndex(line => line[0] == focusLine);
        lines.forEach(line => line.splice(4, 2, line[4].trim(), (line[5].trim() ? "=" : " ") + line[5], line[4].replace(/\w+/, "")));
        lines = lines.map(line => '<tr class="lmcLine"><td>' 
            + template.replace(/@/g, () => line.shift().replace(/</g, '&lt;')).trim()
                      .replace(/(Mnemo)(.*?)(\w+)/, "$1 lmc$3$2$3")
            + "</td></tr>");
        lines[focusLine] = lines[focusLine].replace('"', '"' + cls + ' ');
        
        this.gui.code.innerHTML = "<table>" + lines.join`` + "</table>";
        this.gui.step.disabled = this.err || this.isDone();
        this.gui.run.disabled = this.gui.walk.disabled = this.err || this.isDone();
        // Scroll highlighted line into view
        let focusSpan = this.gui.code.querySelector("." + cls);
        let focusTop = focusSpan.getBoundingClientRect().top;
        let codeTop = this.gui.code.getBoundingClientRect().top;
        let add = (focusTop + focusSpan.clientHeight) - (codeTop + this.gui.code.clientHeight);
        let sub = codeTop - focusTop;
        if (add > 0) this.gui.code.scrollTop += add + 2;
        else if (sub > 0) this.gui.code.scrollTop -= sub + 2;
    }
}

if (document && document.addEventListener) {
    // Convert content automatically into widget upon page load
    document.addEventListener("DOMContentLoaded", function () {
        document.body.insertAdjacentHTML("beforeend", 
            `<style>
                .lmc {
                  height: 100%;
                  display: flex;
                  flex-direction: row;
                  font-family: monospace;
                   align-content: stretch;
                }
                .lmc table { border-collapse: collapse; width: 100%}
                .lmc table td { padding: 0 5px 0 5px; }

                .lmc>div:first-child {
                  min-height: 0px;
                  overflow: auto;
                  overflow-y: scroll;
                  background-color: #f8f8f8;
                  white-space: pre;
                }

                .lmc>div:last-child {
                  padding: 10px;
                  background-color: #0B5AB0;
                  color: white;
                  flex: 1;
                  overflow-y: auto;
                  min-width: 6em;
                  display: flex;
                  flex-direction: column;
                }

                .lmc input[type="text"] { font-family: inherit; border: 0.5px solid; padding-right: 1px; padding-left: 1px; margin-bottom: 2px; }
                .lmc input[type="text"] { font-family: inherit; border: 0.5px solid; padding-right: 1px; padding-left: 1px; }
                .lmc input::placeholder { background-color: yellow; }
                .lmc input[readonly] { background-color: #f0f0f0; }
                .lmc input[size="3"] { text-align: right }
                .lmc input[type="text"]:not([size="3"]) { flex-grow: 1;  width: 100%; min-width: 3em }
                .lmc button { width: 5em; margin-bottom: 2px; margin-top: 2px; margin-right: 4px; border-radius: 4px; border: 0px }
                .lmcNowrap { white-space: nowrap; display: flex; flex-direction: row; align-items: baseline; }
                .lmc .highlight { background: yellow }
                .lmc .error { background: darkorange; font-weight: bold }
                .lmc [data-name="err"] { color: darkorange; font-weight: bold }
                .lmcFront { font-size: smaller; color: #aaa }
                .lmcInspect { font-size: smaller; color: darkorange; vertical-align: text-top; }
                .lmcComment { font-style: italic; color: darkgreen; }
                .lmcMnemo { font-weight: bold; }
                .lmcBRZ, .lmcBRP, .lmcBRA, .lmcBR, .lmcHLT, .lmcCOB { color: darkviolet }
                .lmcINP, .lmcIN, .lmcOUT, .lmcOTC { color: indianred }
                .lmcLDA, .lmcSTA, .lmcSTO, .lmcADD, .lmcSUB { color: navy }
                .lmcDAT { color: silver }
                .lmcLabel { color: black }
                .lmcDAT+span { color: darkred }
            </style>`);
        document.querySelectorAll(".lmcContainer, body").forEach(container => new LmcGui(container, true));
    });
}