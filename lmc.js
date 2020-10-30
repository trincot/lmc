class LMC {
    static intmod(val, end=1000) {
        return (Math.floor(val) % end + end) % end || 0;
    }
    /*  Constructor
     *  options: 
     *      setFlagOnOverflow: determines whether an ADD that leads to overflow will set the negative flag. Default: true
     *      zeroNeedsClearedFlag: determines whether BRZ is ignored when the negative flag is set. Default: true
     *      stopWhenUndefined: determines whether execution stops when the accumulator does not have a reliable value and 
     *                         its value is needed (for SUB, ADD, BRZ, STA, OUT or OTC)
     *      stopAfterLastMailbox: determines whether execution stops when program counter reaches 100. If not, it will 
     *                            continue at mailbox 0.
     */            
    constructor(options = { 
                    setFlagOnOverflow: true, 
                    zeroNeedsClearedFlag: true,
                    stopWhenUndefined: true,
                    forbidProgramCounterOverflow: true,
                }) {
        this.options = options;
        this._flag = false;
        this._accumulator = 0;
        this._programCounter = 0;
        this._mailbox = [];
        this.mailbox = new Proxy(this._mailbox, {
            set(mailbox, address, value) {
                if (isNaN(address)) return Reflect.set(...arguments);
                return Reflect.set(mailbox, LMC.intmod(address, 100), LMC.intmod(value));
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
        this.isLoaded = false;
        // Additional properties
        this.isRunning = false;
        this.isAccUndefined = true;
    }
    /* inbox
     * Needs to be implemented by the user of the instance
     * Must return the next value available in the input box, or undefined when there currently is no input
     */
    inbox() { }
    /* inbox
     * Needs to be implemented by the user of the instance
     * Must output the given value to the output box
     */
    outbox(value) { }
    /* reset
     * Resets the program counter without resetting any other registers or mailboxes 
     */
    reset() {
        this.programCounter = 0;
    }
    /* load(program):
       Clears the state and assembles the given program into instruction codes and stores those in the mailboxes.

           error = lmc.load(program)
       
       - program: string
       Each line in the string needs to have one of the following formats:
       
           [label] mnemonic [argument] [comment]
       
       Or
       
           [label] [3 digit instruction code] [comment]
          
       Comments must start with a freely chosen non-alphanumerical delimiter, like /, # or ;
       The call may return an error object (which is also available as this.error):
       
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
        this.isLoaded = false;
        this.isRunning = false;

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
        this.isLoaded = true;
    }
    /* Gets a text version of the mailbox contents */
    disassembled() {
        if (!this.isLoaded) {
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
    /* run
     * Runs the program (synchronously) until it terminates or needs input 
     */
    run() {
        this.isRunning = true;
        while (this.isRunning) this.step();
    }
    /* isDone
     * Returns true when the current instruction has opcode 0 (kinda look-ahead).  
     */
    isDone() {
        return this.err || this._mailbox[this.programCounter] < 100;
    }
    // Getters and setters for the LMC's registers and mailboxes
    get flag() {
        return this._flag;
    }
    set flag(value) {
        this._flag = !!value;
    }
    get accumulator() {
        return this._accumulator;
    }
    set accumulator(value) {
        /* Setting the accumulator, with LDA or INP, clears the negative flag */
        this.flag = false;
        this.isAccUndefined = false;
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
    failWhenUndefined() {
        if (this.options.stopWhenUndefined && this.isAccUndefined) {
            this.error("Accumulator does not have reliable value.");
            return true;
        }
    }
    /* Performing a calculation, i.e. with SUB or ADD, never clears the flag.
     * Only SUB can set the flag, in case the sum is negative.
     * As a consequence there is no dependecy between accumulator value
     * and flag: e.g. the accumulator can be zero and the flag set:
     *    LDA zero; SUB one; ADD one
     * Now accumulator is still undefined, but in practice it could be 0
     * So then BRP will not branch, but BRZ will.
     */
    addValue(delta) {
        if (this.failWhenUndefined()) return;
        let value = this.accumulator + delta;
        // Wikipedia: "Similarly to SUBTRACT, one could set the negative flag on overflow."
        if (value < 0 || value > 999 && this.options.setFlagOnOverflow) this.flag = true;
        if (value < 0 || value > 999) this.isAccUndefined = true;
        // Do not use setter, as otherwise the flag would be cleared
        this._accumulator = LMC.intmod(value);
    }
    // methods for each of the LMC instructions:
    0() { // HLT
        // Undo the increment of the program counter. This function must return undefined
        this.programCounter--;
        this.isRunning = false;
    }
    100() { // ADD
        this.addValue(this.mailbox[this.instruction]);
    }
    200() { // SUB
        this.addValue(-this.mailbox[this.instruction]);
    }
    300() { // STA
        if (this.failWhenUndefined()) return;
        this.mailbox[this.instruction] = this.accumulator;
    }
    500() { // LDA
        this.accumulator = this.mailbox[this.instruction];
    }
    600() { // BRA
        this.programCounter = this.instruction;
    }
    700() { // BRZ
        // Wikipedia: "Whether the negative flag is taken into account is undefined. [...]"
        //   "Suggested behavior would be to branch if accumulator is zero and negative flag is not set."
        if (this.failWhenUndefined()) return;
        if (this.accumulator === 0 && !(this.options.zeroNeedsClearedFlag && this.flag)) this[600]();
    }
    800() { // BRP
        if (!this.flag) this[600](); // BRA
    }
    901() { // INP
        let inputValue = this.inbox();
        if (inputValue === undefined) {
            this[0]();
        } else {
            this.accumulator = inputValue;
        }
    }
    902() { // OUT
        if (this.failWhenUndefined()) return;
        this.outbox(this.accumulator);
    }
    922() { // OTC
        if (this.failWhenUndefined()) return;
        this.outbox(String.fromCharCode(this.accumulator));
    }
    error(msg) {
        this[0](); // HLT
        this.err = {
            address: this.programCounter,
            msg 
        };
    }
    /* Performs the current instruction and updates the program counter. When input is needed and there is none, or when
       the instruction is HLT or invalid, then the program counter is not altered. 
       In those cases the function returns false. In all other cases, true.
    */
    fetch() {
        // Fetch instruction 
        this.instruction = this.mailbox[this.programCounter];
    }
    execute() {
        // Get function that corresponds to current instruction
        let func = this[this.instruction - this.instruction % 100] || this[this.instruction];
        this.programCounter++;
        // Execute the function
        if (!func) return this.error("Invalid opcode " + this.instruction);
        if (this.programCounter === 0 && this.options.forbidProgramCounterOverflow && ![0, 600].includes(this.instruction)) {
            return this.error("Instruction at mailbox 99 should be HLT or BRA");
        }
        func.call(this);
    }
    step() {
        this.isRunning = true;
        this.fetch();
        this.execute();
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
    DAT: {              arg: -1}, // No opcode, optional argument
};

/* 
   LmcGui
   Reads the first text node in the given DOM container element and loads it in a new LMC instance.
   This text node is replaced by a widget allowing to run the program step by step.
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
                <button data-name="run">Run</button><button data-name="walk">Walk</button><button data-name="step">Step<small> F8</small></button><button data-name="totop">To top</button><button data-name="reload">Reload</button>
            </span>
            <span data-name="err"></span>
        </div>
    </div>`);
        
        this.outputAnimation = new LmcGui.Repeat(() => {
            let left = this.gui.output.scrollLeft;
            this.gui.output.scrollLeft = left + 2;
            return left !== this.gui.output.scrollLeft;
        });
        this.runAnimation = new LmcGui.Repeat(() => {
            if (this.isRunning) this.step();
            return this.isRunning; 
        });
        this.inputAnimation = new LmcGui.Repeat(() => {
            let ch = this.gui.input.value[0];
            let finish = !ch || ch === " ";
            this.gui.input.readonly = !finish;
            let i = finish ? (this.gui.input.value + " ").indexOf(" ")+1 : 1;
            this.gui.input.value = this.gui.input.value.slice(i);
            return !finish;
        });
        this.processedInput = [];
        this.gui = {};
        for (let elem of container.querySelectorAll(".lmc [data-name]")) {
            this.gui[elem.dataset.name] = elem;
        }

        this.gui.run.onclick = () => this.run(1);
        this.gui.walk.onclick = () => this.run(400);
        this.gui.step.onclick = () => this.run(0);
        document.body.addEventListener("keydown", (e) => e.key === 'F8' && this.run(0));
        this.gui.totop.onclick = () => this.reset();
        this.gui.reload.onclick = () => this.load();
        program = this.load(program);
    }
    static Repeat = class Repeat {
        constructor(stepFunc) {
            this._stepFunc = stepFunc;
            this._timer = null;
        }
        _fun(abort) {
            if (!abort && this._stepFunc()) return;
            clearInterval(this._timer);
            this._timer = null;
        }
        complete(abort) {
            while (this._timer) this._fun(abort);
            return this;
        }
        start(delay) {
            this.complete(true);
            this._timer = setInterval(() => this._fun(), delay);
            return this;
        }
    }
    inbox() { // override
        this.inputAnimation.complete();
        let s = (this.gui.input.value.match(/\d{1,3}(?!\d)/g) || []).join(" ");
        if (!s) {
            this.gui.input.value = "";
            this.gui.input.placeholder = "Waiting for your input...";
            this.gui.input.focus();
            return;
        }
        this.gui.input.value = s;
        this.gui.input.removeAttribute("placeholder");
        let val = parseInt(s);
        this.processedInput.push(val);
        // Animate the removal of the input value from the input queue
        this.inputAnimation.start(50);
        return val;
    }
    outbox(val) { // override
        this.gui.output.scrollLeft = 10000;
        if (typeof val === "number" && this.gui.output.value) val = " " + val;
        this.outputAnimation.start(10);
        return this.gui.output.value += val;
    }
    step() { // override
        super.step();
        this.displayStatus();
    }
    run(delay) { // override
        this.runAnimation.complete(true);
        if (delay) this.runAnimation.start(delay);
        this.step();
        if (!delay) this.isRunning = false;
    }    
    reset() { // override
        super.reset();
        this.inputAnimation.complete(); 
        this.gui.input.value = (this.processedInput.join(" ") + " " + this.gui.input.value).trim();
        this.gui.input.focus();
        this.gui.input.select();
        this.processedInput = [];
        this.gui.output.value = "";
        this.isRunning = false;
        this.runAnimation.complete(true);
        this.displayStatus();
    }
    load(program=this.program) { // override
        this.inputAnimation.complete();
        if (program.slice(0, 7) === "#input:") { // Get directive on first line
            let i = program.search(/\r?\n/);
            this.gui.input.value = program.slice(7, i).trim(); // pre-fill the input field.
            program = program.slice(i).trim();
        }
        super.load(program);
        this.reset();
        return program;
    }
    displayStatus() {
        let focusLine = this.err ? this.err.address : this._programCounter;
        let cls = this.err ? "error" : "highlight";
        this.gui.acc.value = this._accumulator;
        this.gui.neg.value = this._flag ? "YES" : "NO";
        this.gui.neg.style.backgroundColor = this._flag ? "orange" : "";
        let lines = this.disassembled();
        this.gui.err.textContent = this.err ? this.err.msg : "";
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
        this.gui.step.disabled = this.gui.run.disabled = this.gui.walk.disabled = this.isDone();
        this.gui.totop.disabled = !!this.err; 
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