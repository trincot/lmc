var count = 0;

class LMC {
    /**
     * Returns the given value as an integer, modulo some limit value 
     *
     * @param {number} val - the value to convert to integer & modulo
     * @param {number} [end=1000] - the limit for the modulo operation
     * @return {number} the value as unsigned integer, modulo end
     *
     * @example
     *
     *     LMC.intmod(-13.3, 20) === 6
     */
    static intmod(val, end=1000) {
        return (Math.floor(val) % end + end) % end || 0;
    }
    /**
     * Callback which the LMC will call when it needs the next value from the inbox.
     *
     * @callback inboxCallback
     * @return {number|undefined} - The next available input from the input source.
     *     should be an integer in the range 0 to 999. Or, when no immediate input
     *     is available, undefined.
     */
     
    /**
     * Callback which the LMC will call when it wants to output a value to the outbox.
     *
     * @callback outboxCallback
     * @param {number} - The value to be output. Will be in the range 0 to 999.
     *
     */
    
    /** Class for a Little Man Computer which can assemble and execute code
     *
     * @class
     * @param {inboxCallback} inbox
     * @param {outboxCallback} outbox
     * @param {Object} [options] - set of options.
     * @param {boolean} [options.setFlagOnOverflow=true] - Determines whether an ADD 
     *     that leads to overflow will set the negative flag.
     * @param {boolean} [options.zeroNeedsClearedFlag=true] - Determines whether BRZ is
     *     ignored when the negative flag is set.
     * @param {boolean} [options.stopWhenUndefined=true] - Determines whether execution 
     *     stops when the accumulator does not have a reliable value and its value is
     *     needed (for SUB, ADD, BRZ, STA, OUT or OTC)
     * @param {boolean} [options.forbidProgramCounterOverflow=true] - Determines whether 
     *     execution stops when program counter reaches 100. If not, it will continue
     *     at mailbox 0
     * @return {LMC} - An instance of Little Man Computer. See member documentation.
     *
     * @example
     *
     *     let lmc = new LMC({stopWhenUndefined:false})
     */
    constructor(inbox, outbox, options={}) {
        this.options = {
			setFlagOnOverflow: true, 
			zeroNeedsClearedFlag: true,
			stopWhenUndefined: true,
			forbidProgramCounterOverflow: true,
			strictOpcode: true,
		    ...options
		};
        this._inbox = inbox;
        this._outbox = outbox;
        this._flag = false;
        this._accumulator = 0;
        this._programCounter = 0;
        this.mailboxes = new Proxy([], {
            set: (mailbox, address, objectValue) => {
                if (!isNaN(address)) {
                    address = LMC.intmod(address, 100);
                    if (address > mailbox.length) throw "creating mailbox leaving gap: " + address;
                }
                return Reflect.set(mailbox, address, objectValue);
            },
            get: (mailbox, address) => {
                if (!isNaN(address)) {
                    address = LMC.intmod(address, 100);
                    if (address >= mailbox.length) throw "accessing unexisting mailbox " + address;
                }
                return mailbox[address];
            }
        });
        // Additional properties to aid disassembly
        this.labelLength = 0;
        this.err = null;
        // Additional properties
        this.isAccUndefined = true;
    }
    ensureMailbox(address) {
        while (address >= this.mailboxes.length) this.createMailbox();
		return this.mailboxes[address];
    }
    createMailbox(lineNo, label="") {
        if (arguments.length === 0) {
            lineNo = this.tokens.length;
            this.tokens.push({
                text: " ".repeat(this.labelLength+1) + "DAT",
                address: this.mailboxes.length,
                mnemonic: { offset: this.labelLength+1, text: "DAT" }
            });
        }
        let tokens = this.tokens[lineNo];
        
        let useArgument = tokens.argument ? tokens.argument.text : "";
        let useMnemonic = tokens.mnemonic ?  tokens.mnemonic.text : "";
        
        let {value, isCode, isReference} = this.assemble(useMnemonic, useArgument);

        // Create a template with placeholders for mnemonic and argument (as they might change when the program runs)
        let lineTemplate = [tokens.text, "", ""];
        if (useArgument) {
            lineTemplate[2] = tokens.text.slice(tokens.argument.offset + useArgument.length);
            lineTemplate[0] = tokens.text.slice(0, tokens.argument.offset); 
        }
        if (useMnemonic) {
            lineTemplate[1] = lineTemplate[0].slice(tokens.mnemonic.offset + useMnemonic.length);
            lineTemplate[0] = lineTemplate[0].slice(0, tokens.mnemonic.offset);
        }
		if (useMnemonic && useArgument && !lineTemplate[1]) lineTemplate[1] = " ";

        if (isNaN(value)) throw "NaN";
        let argumentNumber = !useArgument ? undefined : isNaN(useArgument) ? this.symbolTable[useArgument.toUpperCase()] : +useArgument;
		
        let that = this; // for use in the setter below
        let mailbox = {
			...this.disassemble(value, isCode, isReference), // advised code
            label,
            isCode,
			isReference,
            lineNo,
			_value: value,
			useMnemonic,
			useArgument,
			argumentOffset: (lineTemplate[0] + useMnemonic + lineTemplate[1]).length,
			lineTemplate,
			line: tokens.text,
            get value() {
                return this._value;
            },
            set value(newValue) {
                if (isNaN(newValue)) throw "NaN";
                this._value = LMC.intmod(newValue);
                Object.assign(this, that.disassemble(this._value, this.isCode, this.isReference));
				this.useMnemonic = opcode === this.opcode
                    ? useMnemonic  // restore variant that was used
                    : this.mnemonic; // preferred mnemonic (3 letter, capitals)
                this.useArgument = argumentNumber === this.argument
                    ? useArgument
                    : this.argumentLabel;
                if (this.useMnemonic && this.useArgument && !lineTemplate[1]) lineTemplate[1] = " ";
                this.argumentOffset = (lineTemplate[0] + this.useMnemonic + lineTemplate[1]).length;
                this.line = lineTemplate[0] + this.useMnemonic
                          + lineTemplate[1] + this.useArgument
                          + lineTemplate[2];
            },
            executable() {
				if (!this.isCode) {
					this.isCode = true;
					this.value = this._value;
				}
				return this;
            }
        };
        let {opcode} = mailbox; // save for later comparison
        this.mailboxes.push(mailbox);
    }
    assemble(mnemonic, argument) {
		mnemonic = mnemonic.toUpperCase();
        let value = (LMC.mnemonics[mnemonic || "DAT"].opcode || 0)
            + (isNaN(argument) ? this.symbolTable[argument.toUpperCase()] || 0 : +argument);
		let syntax = LMC.instructions[value];
		if (!syntax) {
			syntax = LMC.instructions[value - value % 100];
			if (!syntax || syntax.arg === 0) syntax = LMC.mnemonics.DAT;
		}
        let isCode = mnemonic !== "DAT" && syntax !== LMC.mnemonics.DAT && (syntax.arg || syntax.opcode === value); 
		let isReference = (mnemonic === "DAT" || !mnemonic) && argument && isNaN(argument); // "DAT label" or "label label"
        return {value, isCode, isReference};
    }
    disassemble(value, isCode=true, isReference=false) {
		let syntax = LMC.instructions[value - value % 100];
        syntax = isCode && (
			LMC.instructions[value] || 
			syntax && syntax.arg && syntax
		) || LMC.mnemonics.DAT;
        let argument, argumentLabel = "";
        if (syntax.arg != 0) {
            argumentLabel = argument = value - (syntax.opcode || 0);
            if ((syntax.mnemonic !== "DAT" || isReference) && this.symbolTable[argument]) {
                argumentLabel = this.symbolTable[argument];
            }
        }
	    let isSloppy = isCode && !syntax.arg && this.options.strictOpcode && syntax.opcode !== value;
        return {...syntax, argument, argumentLabel, isSloppy};
    }
    /**
     * Resets the program counter without resetting any other registers or mailboxes 
     * 
     */
    reset() {
        this.programCounter = 0;
		this.err = null;
    }
    /**
     * Clears the state and assembles the given program into instruction codes and stores those in the mailboxes.
     *
     * @param {string} program - the LMC assembly code to be assembled.
     *     Each line in the string needs to have one of the following formats:
     *        [label] mnemonic [argument] [comment]
     *     Or
     *        [label] [3 digit instruction code] [comment]
     *     Comments must start with a freely chosen non-alphanumerical delimiter, like /, # or ;
     *     The call may set an error object (this.error):
     *         { address: number, msg: string }
     *
     * @return {boolean} - success
     *
     * @example
     *
     *     let program = "INP\n OUT\n HLT";
     *     lmc.load(program);
     *
    */
    load(program) {
        this.program = program;
        // Clear
        this.mailboxes.length = 0;
        this.labelLength = 0;
        this.err = null;
        
        let tokens = this.program.match(/^.*/gm).map(text =>
            ({ text, ...text.match(LMC.regex).groups})
        );
        // Add offsets to each group
        // Mutually exclusive: 
        this.tokens = tokens = tokens.map(line => {
            let offset = 0;
            let res = { text: line.text };
            for (let groupName of LMC.regex.groupNames) {
                let text = line[groupName];
                let key = groupName.replace(/\d/, "");
                if (text !== undefined && key !== "s") res[key] = { offset, text };
                offset += (text || "").length;
            }
            return res;
        });

        // Add addresses to lines, and collect label definitions
        let address = 0;
        this.symbolTable = {};
        for (let [lineNo, line] of tokens.entries()) {
            let {label, badArgument, bad, mnemonic, argument} = line;
            if (bad && !bad.message) bad.message = `Unexpected '${bad.text}'`;
            if (badArgument) {
                line.bad = badArgument.text ? badArgument : mnemonic;
                delete line.badArgument;
                line.bad.message = badArgument.text ? `Invalid argument '${badArgument.text}'` : "Missing argument";
            }

            if (label) {
                const labelUpper = label.text.toUpperCase();
                // Semantic requirement: no duplicates
                if (labelUpper in this.symbolTable) {
                    line.bad = line.label;
                    line.bad.message = `'${label.text}' cannot be defined twice`;
                }
                this.symbolTable[labelUpper] = address;
                this.symbolTable[address] = label.text;
                this.labelLength = Math.max(this.labelLength, label.text.length);
            }
            if ((label || mnemonic || argument) && address >= 100) {
                tokens[lineNo] = {
                    bad: { offset: 0, text: line.text, message: "Program is too large to fit in the 100 mailboxes." }
                }
            } 
            if (mnemonic || argument) {
                line.address = address++;
            }
        }
        // Resolve symbols and fill mailboxes
        let label = null;
        for (let [lineNo, line] of tokens.entries()) {
            let {address, mnemonic, argument, comment} = line;
            if (line.label) label = line.label;
            if (address === undefined) continue; // no code here...
            if (!line.bad && argument && isNaN(argument.text)) { // convert reference label to mailbox number
                let refValue = this.symbolTable[argument.text.toUpperCase()];
                if (refValue === undefined) {
                    line.bad = argument;
                    line.bad.message = "Undefined label '" + argument.text + "'";
                }
            }
            this.createMailbox(lineNo, label ? label.text : "");
            label = null;
        }
        // Initialise calculator & program counter now that assembly is successful.
        this._accumulator = 0;
        this._flag = false;
        this._programCounter = 0;
        let lineNo = this.tokens.findIndex(line => line.bad);
        if (lineNo > -1) this.err = { lineNo, msg: this.tokens[lineNo].bad.message };

        return !this.err;
    }
    /**
     * Runs the currently loaded program synchronously, starting at where the program counter points to. 
     * Running will stop when an error occurs, or when a HLT instruction is encountered, or
     * when input is needed, but is not available.
    */
    run() {
        while (this.step()) {}
    }
    /**
     * Get whether there is an error or the current instruction has opcode 0 (kinda look-ahead).
     * 
     * @return {boolean} - true when running cannot continue. 
     */
    isDone() {
        return this.err || this.programCounter >= this.mailboxes.length || this.mailboxes[this.programCounter].isSloppy;
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
        this.programCounterOverflowed = this._programCounter !== next;
    }
    getMailbox(address) {
        address = address % 100;
        return this.ensureMailbox(address).value;
    }
    setMailbox(address, value) {
        address = address % 100;
        this.ensureMailbox(address).value = value;
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
    }
    100(instruction) { // ADD
        this.addValue(this.getMailbox(instruction));
    }
    200(instruction) { // SUB
        this.addValue(-this.getMailbox(instruction));
    }
    300(instruction) { // STA
        if (this.failWhenUndefined()) return;
        this.setMailbox(instruction, this.accumulator);
    }
    500(instruction) { // LDA
        this.accumulator = this.getMailbox(instruction);
    }
    600(instruction) { // BRA
        this.programCounter = instruction % 100;
    }
    700(instruction) { // BRZ
        // Wikipedia: "Whether the negative flag is taken into account is undefined. [...]"
        //   "Suggested behavior would be to branch if accumulator is zero and negative flag is not set."
        if (this.failWhenUndefined()) return;
        if (this.accumulator === 0 && !(this.options.zeroNeedsClearedFlag && this.flag)) this[600](instruction);
    }
    800(instruction) { // BRP
        if (!this.flag) this[600](instruction); // BRA
    }
    901() { // INP
        let inputValue = this._inbox();
        if (inputValue === undefined) {
            this[0]();
        } else {
            this.accumulator = inputValue;
        }
    }
    902() { // OUT
        if (this.failWhenUndefined()) return;
        this._outbox(this.accumulator);
    }
    922() { // OTC
        if (this.failWhenUndefined()) return;
        this._outbox(String.fromCharCode(this.accumulator));
    }
    error(msg) {
        this[0](); // HLT
        this.err = {
            lineNo: this.mailboxes[this.programCounter].lineNo,
            msg 
        };
    }
    /* Performs the current instruction and updates the program counter. When input is needed and there is none, or when
       the instruction is HLT or invalid, then the program counter is not altered. 
       In those cases the function returns false. In all other cases, true.
    */
    step() {
        // Fetch instruction 
        let pc = this.programCounter++;
        let {value, opcode, isSloppy} = this.mailboxes[pc].executable();
		// Check validity of the instruction
	    if (!this[opcode] || isSloppy) this.error("Invalid instruction " + value);
        // Execute the instruction
		else this[opcode](value);
        if (this.programCounterOverflowed && this.options.forbidProgramCounterOverflow) this.error("Program counter exceeded 99.");
        // If neccessary, create the mailbox that the program counter now refers to, and interpret it as code (for rendering)
		this.ensureMailbox(this._programCounter).executable();
		// Stop run() when program counter did not advance (like with an error, HLT, or INP without available input)
        return pc !== this._programCounter; 
    }
}

[LMC.mnemonics, LMC.instructions] = (instructions => {
    return [
        Object.fromEntries(instructions.map(o => [o.mnemonic, o])),
        Object.fromEntries(instructions.map(o => [o.opcode, o])),
    ];
})([
   { mnemonic: "DAT", opcode:null, arg: -1}, // Optional argument
   { mnemonic: "COB", opcode:   0, arg: 0 }, //    alternative for HLT
   { mnemonic: "HLT", opcode:   0, arg: 0 }, // HALT (or COFFEE BREAK) ignores the argument
   { mnemonic: "ADD", opcode: 100, arg: 1 }, // ADD
   { mnemonic: "SUB", opcode: 200, arg: 1 }, // SUBTRACT
   { mnemonic: "STO", opcode: 300, arg: 1 }, //    alternative for STA
   { mnemonic: "STA", opcode: 300, arg: 1 }, // STORE ACCUMULATOR
   { mnemonic: "LDA", opcode: 500, arg: 1 }, // LOAD ACCUMULATOR
   { mnemonic: "BR",  opcode: 600, arg: 1 }, //    alternative for BRA
   { mnemonic: "BRA", opcode: 600, arg: 1 }, // BRANCH ALWAYS
   { mnemonic: "BRZ", opcode: 700, arg: 1 }, // BRANCH IF ZERO
   { mnemonic: "BRP", opcode: 800, arg: 1 }, // BRANCH IF POSITIVE
   { mnemonic: "IN",  opcode: 901, arg: 0 }, //    alternative for INP
   { mnemonic: "INP", opcode: 901, arg: 0 }, // INPUT
   { mnemonic: "OUT", opcode: 902, arg: 0 }, // OUTPUT
   { mnemonic: "OTC", opcode: 922, arg: 0 }, // OUTPUT CHAR = non-standard character output
]);

LMC.regex = (() => {
    const reReserved = "\\b(?:" + Object.keys(LMC.mnemonics).join("|") + ")\\b";
    const reSimpleMnemonic = "\\b(?:" + Object.keys(LMC.mnemonics).filter(m => LMC.mnemonics[m].arg <= 0).join("|") + ")\\b";
    const reMnemonic = "\\b(?:" + Object.keys(LMC.mnemonics).filter(m => LMC.mnemonics[m].arg > 0).join("|") + ")\\b";
    const reLabel = "\\b(?!" + reReserved + ")(?!\\d)\\w+\\b"; // an identifier which is not a mnemonic
    const reInstruction = "\\b\\d{1,3}\\b"; // a word of up to three digits
    const reMailbox = "\\b\\d{1,2}\\b"; // a word of up to two digits
    const reComment = "[^\\s\\w].*"; // a non-alphanumerical (non-white space) character marks the start of a comment
    
    const regex = RegExp("^(?<s0>\\s*)(?<label>" + reLabel + ")?"
        + "(?<s1>\\s*)(?:"
            + "(?<mnemonic1>DAT)?(?<s2>\\s*)(?:(?<argument1>" + reInstruction + ")|(?<argument2>" + reLabel + "))"
            + "|(?<mnemonic2>" + reSimpleMnemonic + ")"
            + "|(?<mnemonic3>" + reMnemonic + ")(?<s3>\\s*)(?:(?<argument3>" + reMailbox + ")|(?<argument4>" + reLabel + ")|(?<badArgument>\\S*))"
        + ")?"
        + "(?<s4>\\s*)(?:"
            + "(?<comment>" + reComment + ")"
            + "|(?<bad>\\S+).*"
        + ")?", "i");
    regex.groupNames = regex.toString().match(/\(\?<[^>]+/g).map(m => m.slice(3));
    return regex;
})();

/* 
   LmcGui
   Reads the first text node in the given DOM container element and loads it in a new LMC instance.
   This text node is replaced by a widget allowing to run the program step by step.
*/

class LmcGui extends LMC {
    static RUNNING = 1
    static PAUSED = 2
    static EDITING = 3
    constructor(container, options={}) {
        options = { // extend with option defaults for extended features 
			haltRequired: false,
			onStateChange: () => null,
		    ...options
		};
        // Initialise the LMC with inbox and outbox functions:
        super(() => {
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
            // Animate the removal of the input value from the input queue
            this.inputAnimation.start(50);
            return val;
        }, (val) => {
            this.gui.output.scrollLeft = 10000;
            if (typeof val === "number" && this.gui.output.value) val = " " + val;
            this.outputAnimation.start(10);
            this.gui.output.value += val;
        }, options);
        let programNode = container.childNodes[0];
        let program = programNode.nodeValue.trim();
        // Do not create the GUI when in automatic mode, and there is no program.
        if (options.haltRequired && !/\sHLT\b/i.test(program)) return; 

        programNode.remove();
        
        container.insertAdjacentHTML("afterbegin", 
            (container === document.body ? "<style>body, html { margin: 0; height: 100vh }</style>" : "") + `
    <div class="lmc">
        <div>
            <div>
                <div data-name="gutter"></div>
                <div data-name="code"></div>
            </div>
        </div>
        <div>
			<button class="lmcEditButton" data-name="edit">🖉 Edit</button>
            <span class="lmcNowrap"><span>Acc:</span><input type="text" readonly data-name="acc" size="3"></span>
            <span class="lmcNowrap"><span>Neg:</span><input type="text" readonly data-name="neg" size="3"></span>
            <span class="lmcNowrap"><span>Inp:</span><input type="text" data-name="input"></span>
            <span class="lmcNowrap"><span>Out:</span><input type="text" readonly data-name="output"></span>
            <span class="lmcActions">
                <button data-name="run">▶▶&nbsp;Run</button><button 
                        data-name="walk">▶&nbsp;Walk</button><button 
                        data-name="step" title="Step and pause [F8]">❚❚&nbsp;Step</button><button 
                        data-name="totop" title="Set program counter to 0"><b>⭮</b>&nbsp;Reset</button>
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
            if (this.state === LmcGui.RUNNING) this.step();
            return this.state === LmcGui.RUNNING; 
        });
        this.inputAnimation = new LmcGui.Repeat(() => {
            let ch = this.gui.input.value[0];
            let finish = !ch || ch === " ";
            this.gui.input.readonly = !finish;
            let i = finish ? (this.gui.input.value + " ").indexOf(" ")+1 : 1;
            this.gui.input.value = this.gui.input.value.slice(i);
            return !finish;
        });
        this.originalInput = "";
        this.gui = {};
        for (let elem of container.querySelectorAll(".lmc [data-name]")) {
            this.gui[elem.dataset.name] = elem;
        }
        this.gui.run.onclick = () => this.run(1);
        this.gui.walk.onclick = () => this.run(400);
        this.gui.step.onclick = () => this.run(0);
        document.body.addEventListener("keydown", (e) => e.key === 'F8' && this.run(0));
        this.gui.totop.onclick = () => this.reset();
        this.gui.edit.onclick = () => this.state === LmcGui.EDITING ? this.tidy() : this.load();
		this.gui.input.onkeydown = (e) => { if (e.key === "Enter") this.run(this.delay); }
		
        this._state = LmcGui.EDITING;
        this.editor = new Editor(this.gui.code, (program) => this.parse(program));
        program = this.load(program);
    }
	hideEditButton() {
		// Hide the edit button temporary while the user is editing or running the program, so it does not obscure it.
		clearTimeout(this.showButtonTimer);
		this.gui.edit.style.display = "none";
		this.showButtonTimer = setTimeout(() => {
			this.gui.edit.style.display = "";
			this.showButtonTimer = 0;
		}, 1500);
	}
    parse(program) {
		this.hideEditButton();
        if (this.state === LmcGui.EDITING) {
            super.load(program);
            this.gui.run.disabled = this.gui.walk.disabled = this.gui.step.disabled = !this.mailboxes.length;
        }
        // Fill the gutter
        let gutterLines = this.tokens.map(({address}) => 
            `<div>${address !== undefined ? (address+":").padStart(3, "0") + (this.mailboxes[address].value+"").padStart(3, "0") : "      \n"}</div>`
        );
        if (gutterLines[this.focusLine] && this.state !== LmcGui.EDITING) gutterLines[this.focusLine] = gutterLines[this.focusLine].replace('>', ' class="' + this.focusClass + '">');
        this.gui.gutter.innerHTML = gutterLines.join("");
        // Collect and return formatting information to be applied to the program editor
        return this.tokens.map((line, lineNo) => {
            let format = {};
            if (lineNo === this.focusLine && this.state !== LmcGui.EDITING) format.background = this.focusClass;
            if (line.address !== undefined) {
                let mailbox = this.mailboxes[line.address];
                if (mailbox.useMnemonic) {
                    let { offset } = line.mnemonic || line.argument;
                    format[offset] = { "class": "lmc" + mailbox.useMnemonic.toUpperCase() };
                    format[offset + mailbox.useMnemonic.length] = "";
                }
                if (mailbox.useArgument && mailbox.useMnemonic && !"BD".includes(mailbox.useMnemonic[0].toUpperCase())) {
                    let target = isNaN(mailbox.useArgument) ? this.symbolTable[mailbox.useArgument.toUpperCase()] : +mailbox.useArgument;
                    if (target in this.mailboxes) {
                        format[mailbox.argumentOffset] = { "title": "[" + mailbox.useArgument + "]=" + this.mailboxes[target].value };
                        format[mailbox.argumentOffset + (mailbox.useArgument+"").length] = "";
                    }
                }
            }
            if (line.bad) {
                format[line.bad.offset] = { "class": "lmcError", title: line.bad.message };
                format[line.bad.offset+(line.bad.text.length || 1)] = "";
            }
            if (line.comment) format[line.comment.offset] = { "class": "lmcComment" };
            return format;
        });
    }
    /**
     * Align the mnemonics, capitalise them, and use single space separator 
     * before argument and comment. 
    */
    tidy() {
        //this.load();
        let tab = this.labelLength;
        let start = tab && (tab + 1);
        this.editor.loadWithUndo(this.tokens.map(tokens => {
            let {address, label, mnemonic, argument, comment, text} = tokens;
            let coreText = text;
            if (comment) coreText = coreText.slice(0, comment.offset);
            coreText = coreText.trim().replace(/\s+/g, " ");
            if (mnemonic || argument) {
                coreText = label
                    ? coreText.replace(" ", " ".repeat(start - label.text.length))
                    : " ".repeat(start) + coreText;
                let size = (argument || mnemonic).offset + (argument || mnemonic).text.length
                         - (mnemonic || argument).offset;
                // grab disassembly info:
                let {mnemonic: mnemonic2, argumentLabel} = this.mailboxes[address];
                if (!argument && mnemonic2.toUpperCase() === "DAT") argumentLabel = "";
                coreText = coreText.slice(0, start) + (mnemonic2.toUpperCase() + " " + argumentLabel).trim()
                        + coreText.slice(start + size);
            }
            return comment ? (coreText ? coreText + " " : "") + comment.text : coreText;
        }).join("\n"));
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
    get state() {
        return this._state;
    }
    set state(toState) {
        this.gui.edit.textContent = toState === LmcGui.EDITING ? "☷ Tidy" : "🖉 Edit";
        if (![LmcGui.RUNNING, LmcGui.PAUSED, LmcGui.EDITING].includes(toState)) throw "invalid state " + toState;
        let fromState = this._state;
        this._state = toState;
        if (fromState !== toState) this.options.onStateChange(fromState, toState);
    }
    step() { // override
        if (!this.err) {
            let wasEditing = this.state === LmcGui.EDITING;
            this.state = LmcGui.RUNNING;
            if (!wasEditing && !super.step()) this.state = LmcGui.PAUSED;
        }
        this.displayStatus();
    }
    run(delay) { // override
        this.delay = delay;
        if (this.state === LmcGui.EDITING) this.originalInput = this.gui.input.value;
        this.runAnimation.complete(true);
        if (delay) this.runAnimation.start(delay);
        this.step();
        if (!delay) this.state = LmcGui.PAUSED;
    }
    reset() { // override
        super.reset();
        this.inputAnimation.complete(); 
        if (this.originalInput) this.gui.input.value = this.originalInput;
		this.gui.input.removeAttribute("placeholder");
        this.gui.input.focus();
        this.gui.input.select();
        this.gui.output.value = "";
        if (this.state === LmcGui.RUNNING) this.state = LmcGui.PAUSED;
        this.runAnimation.complete(true);
        this.displayStatus();
    }
    load(program=this.program) { // override
        this.state = LmcGui.EDITING;
        this.inputAnimation.complete();
        if (program.startsWith("#input:") && !this.gui.input.value) { // Get directive on first line
            this.gui.input.value = program.match(/:(.*)/)[1].trim(); // pre-fill the input field.
        }
        this.editor.load(program); // will trigger this.parse (cf new Editor) > super.load
        this.reset();
        return program;
    }
    displayStatus() {
        this.editor.readonly = this.state !== LmcGui.EDITING && "#aaa";
        this.focusLine = this.err ? this.err.lineNo 
                    : this._programCounter < this.mailboxes.length ? this.mailboxes[this._programCounter].lineNo
                    : -1;
        this.focusClass = this.err ? "error" : "highlight";
        this.gui.acc.value = this._accumulator;
        this.gui.neg.value = this._flag ? "YES" : "NO";
        this.gui.neg.style.backgroundColor = this._flag ? "orange" : "";
        this.gui.err.textContent = this.err ? this.err.msg : "";        
        if (this.state === LmcGui.RUNNING) {
            this.editor.load(this.tokens.map(tokens => tokens.address ? this.mailboxes[tokens.address].line : tokens.text).join("\n"));
        }
        this.editor.displayFormatted();
        //this.gui.step.disabled = this.gui.run.disabled = this.gui.walk.disabled = this.isDone();
        //this.gui.totop.disabled = !!this.err || this.state === LmcGui.EDITING;
        // Scroll highlighted line into view (if there is a highlighted line)
        let focusElem = this.gui.code.querySelector("." + this.focusClass);
        if (focusElem) {
            let focusTop = focusElem.getBoundingClientRect().top;
            let container = this.gui.code.parentNode.parentNode;
            let codeTop = container.getBoundingClientRect().top;
            let add = (focusTop + focusElem.clientHeight) - (codeTop + container.clientHeight);
            let sub = codeTop - focusTop;
            if (add > 0) container.scrollTop += add + 0.5;
            else if (sub > 0) container.scrollTop -= sub - 0.5;
        }
    }
}

class Editor {
    constructor(container, formatter = (plainText) => [{ /* background: "", 1: { "class": "mnemonic" }, 4: null */ }]) {
        this.container = container;
        this.formatter = formatter;
        container.spellcheck = false;
        for (let event of Object.getOwnPropertyNames(Editor.prototype)) {
            if (!event.startsWith("on")) continue;
            container.addEventListener(event.slice(2), (e) => this.eventHandler(e));
        }
        this.load("");
        document.addEventListener("selectionchange", (e) => this.onselectionchange(e));
        this.readonly = false;
    }
	loadWithUndo(text) {
		return this.perform(() => {
			this.actionType = "complex";
			this.lines = text.split(/\r?\n/);
		});
	}
    load(text) {
        this.lines = text.split(/\r?\n/);
        if (!this.readonly) {
            this.y1 = this.y2 = this.x1 = this.x2 = this.order = 0;
            this.container.scrollLeft = this.container.scrollTop = 0;
            this.undoStack = [];
            this.redoStack = [];
            this.dirty = false;
        }
        this.displayFormatted();
        this.displaySelection();
    }
    get readonly() {
        return this._readonly;
    }
    set readonly(isReadOnly) {
        if (this._readonly === !!isReadOnly) return;
        this._readonly = !!isReadOnly;
        this.container.setAttribute("contenteditable", !isReadOnly);
        if (isReadOnly) {
            this.backup = [...this.lines];
            this.backupBackground = this.container.style.background;
            if (typeof isReadOnly === "string") this.container.style.background = isReadOnly;
        } else if (this.backup) {
            this.container.style.background = this.backupBackground;
            this.lines = this.backup;
            this.displayFormatted();
            this.displaySelection();
        }
    }
    eventHandler(e) {
        let todo = this["on" + e.type](e);
        if (!todo) return;
        // A change to the text will occur:
        e.preventDefault();
		this.perform(todo);
	}
	perform(todo) {
        let prevActionType = this.actionType;
        if (this.syncRange()) prevActionType = "complex";
        let before;
        if (todo !== this.keyCtrlZ) {
            before = JSON.stringify(this.lines);
			this.undoStack.push([[...this.lines], this.order, this.y1, this.x1, this.y2, this.x2]);
        }
        if (typeof todo === "function") todo.call(this);
        else this.insert(todo);
        let hasChanged = before !== JSON.stringify(this.lines);
        if (this.actionType === prevActionType && prevActionType !== "complex" || !hasChanged) {
            this.undoStack.pop();
        }
        if (hasChanged) {
            this.dirty = true;
            this.displayFormatted();
        }
        this.displaySelection();
    }
    displayFormatted() {
        let formats = this.formatter(this.text()) || [];
        this.container.innerHTML = this.lines.map((line, y) => {
            let {background, ...format} = formats[y] || {};
            format = Object.entries(format).map(([k,v]) => [+k,v])
                           .sort(([a], [b]) => a - b);  // pairs [x, style]
            let shift = 0;
            let i = 0;
            for (let {index} of line.matchAll(/[<&]/g) || []) {
                while (i < format.length && index >= format[i][0]) {
                    format[i++][0] += shift; 
                }
                shift += line[index] === "&" ? 4 : line[index] === "<" ? 3 : 0; // "&amp;" or "&lt;"
            }
            line = line.replace(/&/g, "&amp;").replace(/</g, "&lt;");
            let inside = false;
            for (let [x, attrib] of format.reverse()) {
                attrib = Object.entries(Object(attrib)).map(([k, v]) => ` ${k}="${v}"`).join("");
                let tag = `</span><span${attrib}>`;
                line = line.slice(0, x) + tag + line.slice(x);
            }
            line = `<span>${line}</span>`.replace(/<span>([^<]*)<\/span>/g, "$1");
            background = background ? ` class="${background}"` : "";
            return `<div${background}>${line}<br></div>`;
        }).join("");
    }
    displaySelection() {
        // set Selection:
        var range = document.createRange();
        range.setStart(...this.getNodeAndOffset(this.y1, this.x1));
        range.setEnd(...this.getNodeAndOffset(this.y2, this.x2));
        
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
    }
    onselectionchange(e) {
		
        if (this.readonly) return;
        // Verify that the selection is within the container:
        let sel = window.getSelection();
        let {rangeCount, focusNode, focusOffset, anchorNode, anchorOffset} = sel;
        if (!rangeCount || !this.container.contains(anchorNode) || !this.container.contains(focusNode)) return;
        // Create a fine-grained range that corresponds to the caret position
        let isForward = focusNode === anchorNode 
            ? focusOffset >= anchorOffset 
            : anchorNode.compareDocumentPosition(focusNode) & Node.DOCUMENT_POSITION_FOLLOWING;
        let range = sel.getRangeAt(0).cloneRange();
        range.collapse(!isForward);
        // Drill down
        while (range.startContainer.nodeType === 1 && range.startContainer.childNodes.length) {
            let child = range.startContainer.childNodes[range.startOffset];
            if (!child) break;
            range.setEnd(child, !isForward ? 0 : child.nodeType === 1 ? child.childNodes.length : child.textContent.length);
            range.collapse();
        }
        // For some reason BR must be selected for it to get any meaningful getBoundingClientRect result (FireFox)
        if (range.startContainer.nodeName === "BR" && range.startOffset === 0) { 
            range.selectNode(range.startContainer);
        }
        // Scroll selection into view if needed:
        for (let container = this.container; container !== document.body; container = container.parentNode) {
            let focus = range.getBoundingClientRect();
            let style = getComputedStyle(container);
            let {left, top} = container.getBoundingClientRect();
            let width = container.clientWidth / 3;
            let height = container.clientHeight / 3

            left += parseFloat(style.borderLeftWidth);
            top += parseFloat(style.borderTopWidth);
            let right = left + container.clientWidth;
            let bottom = top + container.clientHeight;
            if (focus.right >= right) {
                container.scrollLeft += focus.right - right + width;
            } else if (focus.left < left + width) {
                container.scrollLeft -= left - focus.left + width;
            }
            if (focus.bottom >= bottom) {
                container.scrollTop += focus.bottom - bottom;
            } else if (focus.top < top + height) {
                container.scrollTop -= top - focus.top + height;
            }
        }
    }
    getNodeAndOffset(y, x) {
        function getOffset(node, x) {
            if (!node.childNodes || !node.childNodes.length) return [node, x];
            for (let child of node.childNodes) {
                if (child.textContent.length >= x) {
                    return getOffset(child, x);
                }
                x -= child.textContent.length;
            }
        }
        let pair = getOffset(this.container.childNodes[y], x);
        return pair;
    }
    getLineAndColumn(node, offset) {
        let charCount = node.nodeType === 3 ? offset : 0;
        while (node !== this.container) {
            if (node.nodeType !== 3) {
                for (let i = 0; i < offset; i++) {
                    charCount += node.childNodes[i].textContent.length;
                }
            }
            offset = Array.from(node.parentNode.childNodes).indexOf(node);
            node = node.parentNode;
        }
        // Avoid a reference to a non-existing trailing childnode.
        if (offset >= this.container.childNodes.length && this.container.childNodes.length > 0) {
            if (charCount) throw "getLineAndColumn finds an offset beyond the size of the content??";
            return [offset-1, this.container.childNodes[this.container.childNodes.length-1].textContent.length];
        }
        return [offset, charCount];
    }    
    syncRange() {
        let selection = window.getSelection();
        let [y1, x1] = this.getLineAndColumn(selection.anchorNode, selection.anchorOffset);
        let [y2, x2] = this.getLineAndColumn(selection.focusNode, selection.focusOffset);
        let order = y2 - y1 || x2 - x1;
        if (order < 0) [y1, x1, y2, x2] = [y2, x2, y1, x1];
        let changedPosition = order !== this.order || x1 != this.x1 || x2 != this.x2 || y1 != this.y1 || y2 != this.y2;
        this.order = order;
        this.x1 = x1;
        this.x2 = x2;
        this.y1 = y1;
        this.y2 = y2;

        return changedPosition;
    }
    text() {
        return this.lines.join("\n");
    }
    selectedText() {
        if (this.y1 === this.y2) return this.lines[this.y1].slice(Math.min(this.x1, this.x2), Math.max(this.x1, this.x2));
        return this.lines[this.y1].slice(this.x1) + "\n"
            + this.lines.slice(this.y1+1, this.y2).map(line => line + "\n").join("")
            + this.lines[this.y2].slice(0, this.x2);
    }
    isEmpty() {
        return !this.order;
    }
    deleteRange() {
        this.lines[this.y1] = this.lines[this.y1].slice(0, this.x1) + this.lines[this.y2].slice(this.x2);
        this.lines.splice(this.y1 + 1, this.y2 - this.y1);
        this.y2 = this.y1;
        this.x2 = this.x1;
        return this;
    }
    insert(newText) {
        this.deleteRange();
        newText = newText.split(/\r?\n/);
        this.x2 = newText.length === 1 ? this.x1 + newText[0].length 
                : newText[newText.length-1].length;
        newText[0] = this.lines[this.y1].slice(0, this.x1) + newText[0];
        newText[newText.length-1] += this.lines[this.y1].slice(this.x1);
        this.lines.splice(this.y1, 1, ...newText);
        this.y1 = this.y2 = this.y1 + newText.length - 1;
        this.x1 = this.x2;
        return this;
    }
    leftMargin() {
        return this.lines[this.y1].length - this.lines[this.y1].replace(/^\s+/, "").length;
    }
    selectWholeLines() {
        this.x1 = 0;
        if (this.x2) {
            if (this.y2 === this.lines.length - 1) this.x2 = this.lines[this.y2].length;
            else {
                this.x2 = 0;
                this.y2++;
            }
        }
    }
    nextTabSize() {
        if (this.lines.length <= 1) {
            // assume TAB stops at multiples of 4
            return 4 - this.x1 % 4;
        }
        let y = this.y1 ? this.y1 - 1 : this.y1 + 1;
        let s = this.lines[y].slice(this.x1);
        let x = s.search(/\s/);
        if (x < 0) {
            // assume TAB stops at multiples of 4
            return 4 - this.x1 % 4;
        }
        s = s.slice(x).replace(/^\s+/, "");
        x = this.lines[y].length - s.length;
        return x - this.x1; 
    }
    prevTabSize() {
        if (this.lines.length <= 1) {
            // assume TAB stops at multiples of 4
            return this.x1 % 4 || (this.x1 ? 4 : 0);
        }
        let y = this.y1 ? this.y1 - 1 : this.y1 + 1;
        let s = this.lines[y].slice(0, this.x1);
        let x = s.search(/\S+\s*$/);
        if (x < 0) {
            // assume TAB stops at multiples of 4
            return this.x1 % 4 || (this.x1 ? 4 : 0);
        }
        return this.x1 - x;
    }
    indent(dir=1) {
        for (let y = this.y1; y < this.y2 + (this.x2 > 0); y++) {
            this.lines[y] = dir > 0 ? "    " + this.lines[y] : this.lines[y].replace(/^ {1,4}/, "");
        }
        if (this.x2) this.x2 = this.lines[this.y2].length;
    }
    undo() {
        if (!this.undoStack.length) return this;
        this.actionType = "complex";
        this.redoStack.push([this.lines, this.order, this.y1, this.x1, this.y2, this.x2]);
        [this.lines, this.order, this.y1, this.x1, this.y2, this.x2] = this.undoStack.pop();
        return this;
    }
    redo() {
        if (!this.redoStack.length) return this;
        this.actionType = "complex";
        [this.lines, this.order, this.y1, this.x1, this.y2, this.x2] = this.redoStack.pop();
        return this;
    }
    word() {
        this.x2 = this.x1;
        this.y2 = this.y1;
        if (this.x2 >= this.lines[this.y2].length) { // at end of line? Select the new line delimiter
            if (this.y2 + 1 < this.lines.length) {
                this.x2 = 0;
                this.y2++;
            }
        } else {
            this.x2 += (this.lines[this.y2].slice(this.x2)+" ").search(/\s/);
        }
        this.x2 += (this.lines[this.y2].slice(this.x2)+"A").search(/\S/);
        return this;
    }
    prevWord() {
        this.x2 = this.x1;
        this.y2 = this.y1;
        if (!this.x1) { // at start of line? Select the new line delimiter
            if (this.y1) {
                this.y1--;
                this.x1 = this.lines[this.y1].length;
            }
        } else {
            this.x1 = this.lines[this.y2].slice(0, this.x2).search(/\S+\s*$/);
            if (this.x1 < 0) this.x1 = 0;
        }
        return this;
    }
    avoidEmpty(delta) {
        if (!this.isEmpty()) return this;
        if (delta === 1) {
            if (this.x1 < this.lines[this.y1].length) this.x2++;
            else if (this.y1 < this.lines.length) {
                this.y2++;
                this.x2 = 0;
            }
        } else {
            if (this.x1) this.x1--;
            else if (this.y1) {
                this.y1--;
                this.x1 = this.lines[this.y1].length;
            }
        }
        return this;
    }
    keyBackspace() {
        this.actionType = "delete";
        this.avoidEmpty(-1).deleteRange();
    }
    keyCtrlBackspace() {
        this.actionType = "complex";
        this.prevWord().deleteRange();
    }
    keyCtrlDelete() {
        this.actionType = "complex";
        this.word().deleteRange();
    }
    keyDelete() {
        this.actionType = "delete";
        this.avoidEmpty(1).deleteRange();
    }
    keyCtrlZ() {
        this.undo();
    }
    keyCtrlY() {
        this.redo();
    }
    keyTab() {
        this.actionType = "complex";
        if (this.y1 === this.y2) {
            this.deleteRange();
            this.x1 = this.x2 = Math.max(this.x1, this.leftMargin());
            this.insert(" ".repeat(this.nextTabSize()));
        } else {
            this.selectWholeLines();
            this.indent();
        }
    }
    keyShiftTab() {
        this.actionType = "complex";
        if (this.y1 === this.y2) {
            this.x1 = this.x2 = this.leftMargin();
            this.x1 -= this.prevTabSize();
            this.deleteRange();
        } else {
            this.selectWholeLines();
            this.indent(-1);
        }
    }
    keyReturn() {
        this.insert("\n" + " ".repeat(this.leftMargin()));
    }
    onkeydown(e) {
        let combi = "key" + (e.ctrlKey ? "Ctrl" : "") + (e.altKey ? "Alt" : "") + (e.shiftKey ? "Shift" : "") 
                + e.key[0].toUpperCase() + e.key.slice(1);
        return this[combi[0].toLowerCase() + combi.slice(1)];
    }
    onkeypress(e) {
        this.actionType = "insert";
        if (e.key === "Enter") return this.keyReturn;
        return { "Spacebar": " " }[e.key] || e.key;
    }
    oncut(e) {
        this.actionType = "complex";
        return () => {
            event.clipboardData.setData('text/plain', this.selectedText());
            this.deleteRange();
        }
    }
    onpaste(e) {
        this.actionType = "complex";
        return (e.clipboardData || window.clipboardData).getData('text');
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
                    _align-content: stretch;
                }
                .lmc>div:first-child {
                    flex: 1;
                    overflow-y: scroll;
                    min-height: 0;
                }
                .lmc>div:first-child>div {
                    min-height: 100%;
                    min-width: min-content;
                    display: flex;
                    flex-direction: row;
                }
                .lmc>div:first-child>div>div:first-child {
                    background-color: #f0f0f0;
                    color: #808080;
                    min-height: 100%;
                    white-space: pre;
                    padding: 0;
                    font: 14px monospace;
                    border: 0;
                }
                .lmc>div:first-child>div>div:last-child {
                    background-color: #f8f8f8;
                    min-height: 100%;
                    flex:1;
                    white-space: pre;
                    padding: 0;
                    font: 14px monospace;
                    border: 0;
                }
                .lmc>div:first-child>div>div>div {
                    padding-left: 3px;
                    padding-right: 3px;
                }
                .lmc>div:last-child {
                    padding: 10px;
                    background-color: #0B5AB0;
                    color: white;
                    flex: 0.5;
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
                .lmc button { width: 5em; line-height: 1.5em; margin-bottom: 2px; margin-top: 2px; margin-right: 4px; border-radius: 4px; border: 0px }
				.lmc [data-name="edit"] { position: absolute; opacity: 0.2; left: 65%; margin-left:-7.5em; font-weight: bold; padding-top: 1em; padding-bottom: 1em; border: 1px solid #666 }
				.lmc [data-name="edit"]:hover { border: 1px solid black; opacity: 1 }
				.lmcNowrap { white-space: nowrap; display: flex; flex-direction: row; align-items: baseline; }
                .lmc .highlight { background: yellow }
                .lmc .error { background: darkorange; font-weight: bold }
                .lmc [data-name="err"] { color: darkorange; font-weight: bold }
                .lmcFront { color: #aaa }
                .lmcInspect { font-size: smaller; color: darkorange; vertical-align: text-top; }
                .lmcComment { font-style: italic; color: darkgreen; }
                .lmcMnemo { font-weight: bold; }
                .lmcBRZ, .lmcBRP, .lmcBRA, .lmcBR, .lmcHLT, .lmcCOB { color: darkviolet }
                .lmcINP, .lmcIN, .lmcOUT, .lmcOTC { color: indianred }
                .lmcLDA, .lmcSTA, .lmcSTO, .lmcADD, .lmcSUB { color: navy }
                .lmcDAT { color: silver }
                .lmcLabel { color: black }
                .lmcError {
                    text-decoration-line: underline;
                    text-decoration-style: wavy;
                    text-decoration-color: red;
                }
            </style>`);
        document.querySelectorAll(".lmcContainer, body").forEach(container => new LmcGui(container, {haltRequired: true}));
    });
}