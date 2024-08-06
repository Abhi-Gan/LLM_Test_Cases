"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebAgent = void 0;
const playwright_1 = require("playwright");
const prettier = __importStar(require("prettier"));
const perf_hooks_1 = require("perf_hooks");
const json5_1 = __importDefault(require("json5"));
const fs_1 = __importDefault(require("fs"));
class WebAgent {
    constructor(llmClient, app_description, webapp_url, epsilon = 0, alpha = 1, gamma = 0.9, verbose = true) {
        // maps (x,y) -> Real
        this.Q_dict = {};
        this.elements_encodings = {};
        this.llmClient = llmClient;
        this.app_description = app_description;
        this.webapp_url = webapp_url;
        this.verbose = verbose;
        this.epsilon = epsilon;
        this.alpha = alpha;
        this.gamma = gamma;
    }
    async waitTime(seconds) {
        await this.page.waitForTimeout(seconds * 1000);
    }
    async closingActions() {
        var _a, _b, _c;
        (_a = this.page) === null || _a === void 0 ? void 0 : _a.close();
        (_b = this.context) === null || _b === void 0 ? void 0 : _b.close();
        (_c = this.browser) === null || _c === void 0 ? void 0 : _c.close();
    }
    async loadPage(webapp_url = this.webapp_url) {
        // load 
        const browser = await playwright_1.chromium.launch({ "headless": false }); //, slowMo: 100
        const context = await browser.newContext({ "ignoreHTTPSErrors": true });
        const page = await context.newPage();
        this.page = page;
        this.context = context;
        this.browser = browser;
        await page.goto(webapp_url);
        // wait until loaded?
        // domcontentloaded
        await page.waitForLoadState('networkidle');
        // inject mutation observer
        await this.injectMutationObserver();
        // do it again if there are any future changes to url
        page.on('framenavigated', async (frame) => {
            console.log("frame navigated");
            if (frame === page.mainFrame()) {
                console.log(`URL changed to: ${frame.url()}`);
                // TODO: create new observer?
                // await this.injectMutationObserver();
            }
        });
    }
    agentPrint(message) {
        if (this.verbose) {
            //console.log(message)
            fs_1.default.appendFileSync("out.tmp.txt", message + "\n");
        }
    }
    async getAllInteractableElements() {
        // assert page is defined
        const curPage = this.page;
        // CSS selector
        const locator = curPage.locator('[data-test-interactions]');
        // may need to wait until elements are visible...
        await locator.first().waitFor({ timeout: WebAgent.MAX_WAIT });
        // get list of interactable elems
        const elems = await locator.all();
        return elems;
    }
    async getRelevElements(wfStep) {
        // subject of workflow
        const regex = /\*(.*?)\*/g;
        const stringsBetweenAsterisks = wfStep.match(regex) || [];
        // define fn based on wfStep
        let isRelev;
        if (stringsBetweenAsterisks.length === 0) {
            isRelev = (objDesc) => wfStep.includes(objDesc);
        }
        else {
            isRelev = (objDesc) => { return true; }; // (objDesc: string) => objDesc.includes(stringsBetweenAsterisks);
        }
        const interactableElems = await this.getAllInteractableElements();
        // filter for only elems w same obj type that are visible
        const relevElems = [];
        for (let i = 0; i < interactableElems.length; i++) {
            const curElem = interactableElems[i];
            // TODO: for some reason this isn't working.
            const curObjDesc = await curElem.getAttribute("data-test-obj-desc");
            // Can user see?
            const curSize = await curElem.boundingBox();
            const canSee = (curSize === null || curSize === void 0 ? void 0 : curSize.height) !== 0 && (curSize === null || curSize === void 0 ? void 0 : curSize.width) !== 0;
            if (curObjDesc && canSee && isRelev(curObjDesc)) {
                relevElems.push(curElem);
            }
        }
        return relevElems;
    }
    async getLLMResponse(prompt, history, json_response = false) {
        // { role: "system", content: "You are a helpful assistant." },
        const allMessages = [];
        if (history) {
            allMessages.push(...history);
        }
        const newMessage = { role: "user", content: prompt };
        allMessages.push(newMessage);
        // [{role: "user", content: prompt}]
        const response_format = json_response ? { "type": "json_object" } : undefined;
        const completion = await this.llmClient.chat.completions.create({
            messages: allMessages,
            model: "gpt-4o-mini-2024-07-18", // "gpt-3.5-turbo-0125",
            n: 1,
            temperature: 0.1,
            response_format: response_format
        });
        const response = completion.choices[0].message.content;
        this.agentPrint(`Prompt:\n${history ? `<history>\n${prompt}` : prompt}---\nResponse:${response}\n---`);
        return response;
    }
    async getOuterHTML(elem) {
        return await elem.evaluate(elem => elem.outerHTML);
    }
    async getReadableElemsList(elemsList) {
        const elemsHTMLList = await Promise.all(elemsList.map(async (elem, index) => {
            const curOuterHTML = await this.getOuterHTML(elem);
            const prettyOuterHTML = await prettier.format(curOuterHTML, { parser: 'html' });
            return `${index}.\n${prettyOuterHTML}`;
        }));
        return `${elemsHTMLList.join("\n\n")}`;
    }
    // private async getDomTreeHelper(elem: Element, result:string[], curIndent='', spacer='   ') {
    //     // const tagName = await elem.evaluate((node) => node.tagName);
    //     const tagName = elem.tagName;
    //     let domTreeString = spacer + tagName + "\n";
    //     const children = Array.from(elem.children) // await elem.evaluate((node) => Array.from(node.children));
    //     for (const child of children) {
    //         await this.getDomTreeHelper(child,
    //             result,
    //             curIndent + spacer,
    //             spacer);
    //     }
    // }
    async getDOMTree(displayFullShadow = true, showMutations = false) {
        const curPage = this.page;
        // ensure page is stable
        await curPage.waitForLoadState('networkidle', { timeout: 10000 });
        // TODO: better soln??
        await curPage.waitForTimeout(1000);
        const domTreeString = await curPage.evaluate(({ _displayFullShadow, _showMutations }) => {
            function isHumanVisible(elem) {
                let result = true;
                const rect = elem.getBoundingClientRect();
                // TODO: sometimes width 1 elements: idk why they would be there.
                const rectVisible = rect.width > 0 && rect.height > 0;
                result = result && rectVisible;
                if (result) {
                    // is rect at least partially in viewport?
                    const isPartiallyInViewport = (rect.top < (window.innerHeight || document.documentElement.clientHeight) &&
                        rect.left < (window.innerWidth || document.documentElement.clientWidth) &&
                        rect.bottom > 0 &&
                        rect.right > 0);
                    result = result && isPartiallyInViewport;
                }
                if (result) {
                    // style visible?
                    const elemStyle = window.getComputedStyle(elem);
                    const styleHidden = elemStyle.visibility === 'hidden' || elemStyle.opacity === '0' || elemStyle.display === 'none';
                    result = result && !styleHidden;
                }
                return result; // rectVisible && isPartiallyInViewport && !styleHidden;
            }
            // function getDispChildren(elem: Element | null) {
            //     if (elem === null) {
            //         // only happens if this is a parent of a shadow dom - but then idk how many other kids there are.
            //         return displayFullShadow ? 1 : 0;
            //     }
            //     else {
            //         return elem.childElementCount + Number(displayFullShadow && elem?.shadowRoot != null);
            //     }
            // }
            // run this in the browser context
            class grayRoot {
                constructor(domElement) {
                    this.domElement = domElement;
                    if (domElement instanceof Element) {
                        this.tag = domElement.tagName;
                    }
                    else if (domElement instanceof ShadowRoot) {
                        this.tag = grayRoot.SHADOWROOT_TAG;
                    }
                    else {
                        // domElement is TextNode; no corresponding HTML elem
                        this.tag = `"${domElement.textContent.trim()}"`;
                    }
                    this.children = [];
                    // I might be visible
                    this.hasVisibleDescendant = domElement instanceof Element ? isHumanVisible(domElement) : false;
                    if (domElement instanceof Element && domElement.shadowRoot) {
                        this.shadowRoot = new grayRoot(domElement.shadowRoot);
                        // add shadowRoot to children
                        this.children.push(this.shadowRoot);
                        // visible?
                        this.hasVisibleDescendant || (this.hasVisibleDescendant = this.shadowRoot.hasVisibleDescendant);
                    }
                    // const children = Array.from(domElement.children) 
                    if (!(domElement.nodeType == Node.TEXT_NODE)) { // usually browser ignores children of TextNodes anyways
                        const childNodes = domElement.childNodes;
                        const textNodes = []; // tracks text nodes whose visibilities must be updated
                        for (const child of childNodes) {
                            if (child instanceof Element) {
                                const grayChild = new grayRoot(child);
                                // if child has visible element descendant then add it to children
                                if (grayChild.hasVisibleDescendant) {
                                    this.children.push(grayChild);
                                }
                                // now i might have visible desc
                                this.hasVisibleDescendant || (this.hasVisibleDescendant = grayChild.hasVisibleDescendant);
                            }
                            else if (child.nodeType == Node.TEXT_NODE && child.textContent.trim().length > 0) {
                                // add text node as a child 
                                // consider that only will actually render if parent has some visible child element
                                // mark this as human visible for later though
                                const grayChild = new grayRoot(child);
                                textNodes.push(grayChild);
                            }
                        }
                        // update text nodes visibility
                        for (const grayTextChild of textNodes) {
                            grayTextChild.hasVisibleDescendant = this.hasVisibleDescendant;
                            if (grayTextChild.hasVisibleDescendant) {
                                this.children.push(grayTextChild);
                            }
                        }
                    }
                }
                getVisibleTextHelper(result) {
                    var _a;
                    // base case
                    if (this.children.length == 0) {
                        // leaf node; add my text
                        if (this.hasVisibleDescendant && this.domElement.nodeType == Node.TEXT_NODE) { // this.domElement instanceof Element && isHumanVisible(this.domElement)
                            const curText = (_a = this.domElement.textContent) === null || _a === void 0 ? void 0 : _a.trim();
                            if (curText !== undefined) {
                                result.push(curText);
                            }
                        }
                    }
                    // recursive case
                    else {
                        // add visible text of children
                        for (const child of this.children) {
                            child.getVisibleTextHelper(result);
                        }
                    }
                }
                getVisibleText() {
                    let result = [];
                    this.getVisibleTextHelper(result);
                    return result.join('\n').trim();
                }
                // TODO: implement scuffed soln to display all text
                getTreeStr(collapseShadow = false, spacer = '---') {
                    const numChildren = this.children.length;
                    const visibleText = this.getVisibleText();
                    let displayText = visibleText;
                    // shorten if it looks too long
                    // if (displayText.length > 20) {
                    //     displayText = `${displayText.slice(0,10)}...${displayText.slice(-10)}`;
                    // } 
                    const clearIndentSpace = ' '.repeat(spacer.length);
                    displayText = `${displayText.replace(/\n/g, '\n' + clearIndentSpace)}`;
                    const attrMutations = [];
                    const attrMutDict = {};
                    if (_showMutations && this.domElement instanceof Element) {
                        const curElem = this.domElement;
                        const curMutations = window.mutations;
                        // find all attribute mutations relevant to this elem
                        curMutations.forEach(mutation => {
                            var _a, _b;
                            // attribute changed (if any)
                            const attrName = mutation.attributeName;
                            if (attrName && mutation.target === this.domElement) {
                                // relevant attribute change!
                                const oldVal = (_a = mutation.oldValue) === null || _a === void 0 ? void 0 : _a.trim();
                                const newVal = (_b = curElem.getAttribute(attrName)) === null || _b === void 0 ? void 0 : _b.trim();
                                if (oldVal !== newVal) {
                                    if (!(attrName in attrMutDict)) {
                                        // add to dictionary
                                        attrMutDict[attrName] = { oldValue: oldVal, newValue: newVal };
                                    }
                                    else {
                                        // update new val
                                        attrMutDict[attrName].newValue = newVal;
                                    }
                                }
                            }
                        });
                        // now push into list
                        for (const attrName in attrMutDict) {
                            let { oldValue, newValue } = attrMutDict[attrName];
                            if (newValue == '') {
                                newValue = "\'\'";
                            }
                            attrMutations.push(`${attrName}:${oldValue}->${newValue}`);
                        }
                    }
                    // get aria label, if any
                    // also get testId attribute if any
                    let ariaLabel = '';
                    let testIdStr = '';
                    if (this.domElement instanceof Element) {
                        if (this.domElement.ariaLabel) {
                            ariaLabel = this.domElement.ariaLabel.trim();
                            if (ariaLabel.length > 0) {
                                ariaLabel = ` (aria-label: \"${ariaLabel}\")`;
                            }
                        }
                        const testId = this.domElement.getAttribute('data-testid');
                        if (testId) {
                            testIdStr = ` (data-testid: \"${testId}\")`;
                        }
                    }
                    const mutationsInfo = _showMutations && attrMutations.length > 0 ? JSON.stringify(attrMutations) : '';
                    const tagDisp = `${this.tag}${testIdStr}${ariaLabel}${mutationsInfo}`;
                    if (collapseShadow && this.tag == grayRoot.SHADOWROOT_TAG) {
                        // treat as leaf node
                        // const tempDisplayText = this.domElement.textContent ? this.domElement.textContent : '';
                        // , > ${ }
                        return (visibleText.length === 0 ? tagDisp : `${tagDisp} > "${displayText}"`);
                    }
                    else if (numChildren === 0) {
                        return tagDisp;
                    }
                    else if (numChildren === 1) {
                        // numChildren > 0
                        const tagPrefix = `${tagDisp} > `;
                        const spacerPrefix = spacer; // '-'.repeat(tagPrefix.length)
                        const child = this.children[0];
                        const childLines = child.getTreeStr(collapseShadow, spacer).split('\n');
                        // if (visibleText.length > 0) {
                        //     // add text content as first line
                        //     childLines.unshift(displayText)
                        // }
                        let lines = [];
                        childLines.forEach((childLine, index) => {
                            if (index === 0) {
                                lines.push(`${tagDisp} > ${childLine}`);
                            }
                            else {
                                lines.push(`${spacerPrefix}${childLine}`);
                            }
                        });
                        return lines.join('\n');
                    }
                    else {
                        // numChildren > 1
                        //  : `${tagDisp}\n${spacer}`
                        // '---';
                        let lines = [];
                        lines.push(tagDisp);
                        // lines.push(clearIndentSpace+displayText);
                        // for each children:
                        for (const child of this.children) {
                            const childLines = child.getTreeStr(collapseShadow, spacer).split('\n');
                            childLines.forEach((childLine, index) => {
                                lines.push(`${spacer}${childLine}`);
                            });
                        }
                        return lines.join('\n');
                    }
                }
            }
            grayRoot.SHADOWROOT_TAG = '...'; //'(SHADOWROOT)';
            const bodyElem = document.body;
            // let result:string[] = [];
            // getDomTreeHelperOld(bodyElem, result, '');
            // return result.join('');
            const bodyGrayRoot = new grayRoot(bodyElem);
            return bodyGrayRoot.getTreeStr(!_displayFullShadow);
        }, { _displayFullShadow: displayFullShadow, _showMutations: showMutations });
        return domTreeString;
    }
    // end goal: create DOM tree string w info abt mutations
    async injectMutationObserver() {
        const curPage = this.page;
        // injects mutationObserver into page
        await curPage.evaluate(() => {
            window.mutations = [];
            const observer = new MutationObserver((mutationsList) => {
                const curMutations = [];
                for (let mutation of mutationsList) {
                    let newValue = null;
                    // new value
                    if (mutation.type === "attributes") {
                        // target must be instance of element; kinda redundant
                        if (mutation.target instanceof Element) {
                            newValue = mutation.target.getAttribute(mutation.attributeName);
                        }
                    }
                    // TODO: others
                    else if (mutation.type == "childList") {
                        mutation.addedNodes;
                        mutation.removedNodes;
                    }
                    // TODO:
                    // don't show attribute changes where attribute same before and now
                    // strip text and don't show multiple 
                    const meaningfulRecord = {
                        type: mutation.type,
                        attributeName: mutation.attributeName,
                        oldValue: mutation.oldValue,
                        newValue: newValue,
                        target: mutation.target
                    };
                    // only add mutation if value is different
                    if (true) { // mutation.oldValue !== newValue
                        curMutations.push(mutation);
                    }
                }
                window.mutations.push(...curMutations);
            });
            // Configure the observer to watch for all types of mutations
            const config = {
                attributes: true,
                attributeOldValue: true,
                childList: true,
                subtree: true,
                characterData: true,
                characterDataOldValue: false
            };
            // Start observing the document body
            observer.observe(document.body, config);
        });
    }
    // TODO: used to take in workflow: string[], curState: string[]
    // length of current state <= length of workflow
    // const wfStep = workflow[curState.length];
    async getSortedElements(wfStep) {
        // all relev elements
        const elemsList = await this.getRelevElements(wfStep); // await this.getAllInteractableElements(); 
        // resort relevant elements
        // const resortRelevElems: () => {}
        const elemsHTMLList = await this.getReadableElemsList(elemsList);
        console.log(`elemsHTMLList.length: ${elemsHTMLList.length}`);
        console.log(`elemsHTMLList: ${elemsHTMLList}`);
        if (elemsHTMLList.length < 2) {
            return elemsHTMLList;
        }
        else {
            // ask LLM to resort elems
            // construct prompt
            const resortingPrompt = `Rank the following elements on their relevance to accomplishing the following step. They are presented in the order they appear:

Elements:
${elemsHTMLList}

Step of Workflow:
${wfStep}

Provide a Python list of the indices of each of the elements sorted from most relevant to least. 
Only provide the list and no other information or text.`;
            // prettify HTML in List
            // LLM
            console.log(`resortingPrompt:\n${resortingPrompt}`);
            // return await this.getLLMResponse(resorting_prompt);
        }
    }
    parseElemInteractionResponse(llmResponse) {
        return JSON.parse(llmResponse);
    }
    async getElemInteractions(wfStep, prevErrorsList) {
        var _a;
        const domTreeString = await this.getDOMTree(true);
        let prevErrorsMessage = '';
        if (prevErrorsList && prevErrorsList.length > 0) {
            prevErrorsMessage = `
Avoid locators that may cause these Errors; try different ones or decrease the specificity.
${WebAgent.tripleBackQuotes}
${prevErrorsList.join('\n')}
${WebAgent.tripleBackQuotes}
`;
        }
        // create prompt
        const elemInteractionPrompt = `I need to do the following: ${wfStep}

The webapp has the following DOM Tree Structure (simplified + only human visible elements):
${WebAgent.tripleBackQuotes}
${domTreeString}
${WebAgent.tripleBackQuotes}

In this DOM Tree Structure, '...' refers to a Shadow Root.
The length of the dashes ('---') conveys the relationship between an element and the element in the previous line; longer means child, same means sibling, shorter means sibling of an ancestor.

Your task is to:
\`\`\`
Output a string representing an action that may accomplish the above task.

Each interaction should be provided in JSON format with the following structure:
{
  "action": "click|enter|type|tab|dragAndDrop|expect",
  "locatorCode": "code (to get the relevant element in Playwright)",
  "value": "value (only for type action)",
  "toLocatorCode": "code of locator for element to which first locator is being dragged to (only for dragAndDrop action)"
}
\`\`\`

Follow the following steps as a guide:

Step 1: What part(s) of the DOM Tree above is relevant to the step "${wfStep}"?
 - consider a user might say something that isn't technically correct. For example if they say to 'click the add button' the element being referred to may not literally have 'button' tag, or have its text exactly match with 'add'.
 - You must infer what elements are relevant based on the semantics of the step and context provided by the DOM.

Step 2: What type of interaction do you want to perform on the above element? (e.g. click, type, etc.)

Step 3: Based on your answer to Step 1, identify the code that in Playwright that should be passed into "locatorCode" that can be used to find the relevant element via a locator.

Note you can chain locators like so: page.getByRole('...').locator('...').getByText('...').
However, minimize the number of chained locators unless needed.
For example if there's only one element that would match getByText('add'), there is no need to chain locators before/after.

Use getByTestId if you can. This locates elements by data-testid attribute and is easier than chaining.

The locators you can may are listed in the examples below.

Also consider these notes:
 - getByRole locates elements by its implicit role; however doesn't work for custom elements. ex: works for button, but not for CALCITE-LIST-ITEM
 - getByText matches elements by text. Use exact matching ({ exact: true }). Consider applying another locator before chaining getByText.
 - Use getByLabel to find alements by associated <label> or aria-label attribute
 - If you want the nth match using the nth= locator with a 0 based index; e.g. .nth(4).
 - Minimize usage of XPath / CSS selectors as they cannot go through a Shadow DOM and are more brittle than other locators; use chaining and/or other locators instead where possible.
 - we will add some modifications to your locator to guarantee finding the first visible matching element.
 
We will evaluate the code passed into "locatorCode" in Playwright. 
You are looking at test data so try not to refer to the test data text in your selectors.

Step 4: Verify your code is well-formed Playwright code as described above. If there are errors, do your best to fix them. Try to use a different locator.
${prevErrorsMessage}

Step 5: Output the interaction in the JSON format described earlier.
Your output should be in JSON format. No trailing commas.

Examples:
${WebAgent.tripleBackQuotes}
// getByRole
{"action": "click", "locatorCode": "page.getByRole('button', { name: submit })"}
// getByLabel
{"action": “enter”, "locatorCode": "page.getByLabel('Password’)”}
// getByText
{"action": “tab”, "locatorCode": "page.getByText('Welcome, John'), { exact: true }”}
// getByTestID
{"action": “type”, "locatorCode": "page.getByTestId('directions’)”, “value”:”180 New York Street”}
// XPath:
{"action": "click", "locatorCode": "page.locator('[data-test-interactions]');"}
// CSS:
{"action": "click", "locatorCode": "page.locator('CALCITE-LIST-ITEM:nth-child(4)')"}
${WebAgent.tripleBackQuotes}

Recall, I need to: ${wfStep} 
Output:\n`;
        // console.log(elemInteractionPrompt);
        const llmResponse = (_a = await this.getLLMResponse(elemInteractionPrompt, undefined, false)) !== null && _a !== void 0 ? _a : "";
        return llmResponse; // this.parseElemInteractionResponse(llmResponse);
    }
    async writeFineTuneEx(wfStep, desiredResponse) {
        const domTreeString = await this.getDOMTree(true);
        let prevErrorsMessage = '';
        // create prompt
        const elemInteractionPrompt = `I need to do the following: ${wfStep}

The webapp has the following DOM Tree Structure (simplified + only human visible elements):
${WebAgent.tripleBackQuotes}
${domTreeString}
${WebAgent.tripleBackQuotes}

Your task is to:
\`\`\`
Output a string representing an action that may accomplish the above task.
...
Output:\n`;
        // write training output
        const outObj = { "messages": [
                { "role": "user", "content": elemInteractionPrompt },
                { "role": "assistant", "content": desiredResponse }
            ]
        };
        // TODO: write outObj
        console.log("Not done yet!");
    }
    async runElemInteraction(action, locatorCode, value, toLocatorCode) {
        // assert page is defined
        const curPage = this.page;
        curPage.evaluate(() => {
            // clear mutations
            window.mutations.clear();
        });
        // Always add .locator('visible=true') at the beginning as you only know about visible elements. Otherwise the locator might match something not in the DOM.
        const locator = await eval(`${locatorCode}`);
        const firstMatchLocator = locator.first({ timeout: WebAgent.MAX_WAIT });
        await firstMatchLocator.waitFor({ timeout: WebAgent.MAX_WAIT });
        switch (action) {
            case WebAgent.CLICK:
                // click
                // const locator = curPage.locator(selector)
                await firstMatchLocator.click({ timeout: WebAgent.MAX_WAIT });
                break;
            case WebAgent.ENTER:
                // enter
                break;
            case WebAgent.TYPE:
                // type
                // ensures value is input
                const valStr = value;
                // clear
                await firstMatchLocator.fill('', { timeout: WebAgent.MAX_WAIT });
                // use type sequentially instead!
                await firstMatchLocator.pressSequentially(valStr, { timeout: WebAgent.MAX_WAIT });
                break;
            case WebAgent.TAB:
                // tab
                break;
            case WebAgent.DRAG_AND_DROP:
                console.log("drag and dropping");
                // drag and drop
                // ensure to selectors is input
                const runnableToLocatorCode = toLocatorCode; //.replace("page", "curPage");
                const toLocator = await eval(`${runnableToLocatorCode}`);
                const firstMatchToLocator = toLocator.first();
                await firstMatchToLocator.waitFor({ timeout: WebAgent.MAX_WAIT });
                await firstMatchLocator.dragTo(firstMatchToLocator, { timeout: WebAgent.MAX_WAIT });
                break;
        }
        curPage.evaluate(({ _action, _locatorCode }) => {
            // print mutations
            console.log(`printing mutations for ${_action} on ${_locatorCode}: ${window.mutations.length}`);
            console.log(window.mutations.slice());
        }, { _action: action, _locatorCode: locatorCode });
    }
    async askCorrectAction(wfStep, expectations, beforeDOM, afterDOM) {
        var _a;
        // create prompt
        const correctActionPrompt = `An agent is exploring a web page, and is supposed to perform the following: ${wfStep}

The agent performed some action on the page.

Before the action, the webapp has the following DOM Tree Structure (simplified + only human visible elements):
${WebAgent.tripleBackQuotes}
${beforeDOM}
${WebAgent.tripleBackQuotes}

After the action, the DOM Tree Structure (with annotations for attribute changes) looks like this:
${WebAgent.tripleBackQuotes}
${afterDOM}
${WebAgent.tripleBackQuotes}

Follow the following steps:

Step 1: Identify the differences between the DOM before and after the interaction, if any.

Step 2: Use the following criteria along with any other information to determine if the step '${wfStep}' was performed.
We expect to see the following side effects:
${expectations} 

Prove if the step was performed. Answer Yes/No and Briefly explain what evidence supports your claim.

Step 3: Score the agent's action between -1 and 1 in regards to the desired action. 
Reward the agent for correct responses and punish it for incorrect ones so it eventually learns how to accomplish the task.

Format your output like so:
${WebAgent.tripleBackQuotes}
{
    "Explanation": <brief evidence to support answer>
    "Answer": <'Yes' if step was performed, 'No' otherwise>
    "Score": <score between 0-1>
}
${WebAgent.tripleBackQuotes}

Output:
`;
        const llmResponse = (_a = await this.getLLMResponse(correctActionPrompt)) !== null && _a !== void 0 ? _a : "";
        return llmResponse;
    }
    async runAssertion(assertionStr, beforeDomTreeString, afterAttrDomTreeString) {
        var _a, _b;
        // create initial prompt:
        const initialAssertionPrompt = `An autonomous agent is exploring a web page. 

The agent has recently performed an action on the web page which may have changed its content.

We want to assert whether at the current time the following is true about the web page:
    '${assertionStr}'

A simplified version of the DOM Tree after the interaction is as follows:
${WebAgent.tripleBackQuotes}
${afterAttrDomTreeString}
${WebAgent.tripleBackQuotes}

Note that tree only displays elements of the DOM that are visible (based on Bounding Rectangle and CSS Styling) and within the visible window.
It is annotated to show changes in attributes due to the most recent interaction of the agent with the web page.
These annotations are in the format ["attribute1>:oldValue->newValue","attribute2>:oldValue->newValue",...], where oldValue and newValue are values assigned to the attribute before and after the interaction, respectively.
Consider a value of 'undefined' signifies the attribute not being present.
A value of '' (empty string) represents the attribute being present but without any assigned value. This usually means the presence of the attribute is used as a flag.

Work through the following steps:

Step 1: Which element(s) are relevant to understanding the assertion? 
Step 2: Which attributes of these elements are relevant?
Step 3: How have their values changed before/after the interaction?
Step 4: What does this signify?

Step 3: Output one of the three following options:
1. 'Ready' if you are ready to answer whether the assertion is true
2. '2' if you need to know the full list of attributes for a particular element in the DOM
3. '3' if you need the DOM Tree before the interaction

Output:
`;
        const llmResponse = (_a = await this.getLLMResponse(initialAssertionPrompt)) !== null && _a !== void 0 ? _a : 'Ready';
        const parseableResponse = llmResponse.trim().toLowerCase();
        let history = [
            { role: "user", content: initialAssertionPrompt },
            { role: "assistant", content: llmResponse }
        ];
        let newInfo = '';
        if (parseableResponse === '2') {
            // ask for relevant locator
            const relevLocatorPrompt = `Identify the code that in Playwright that can be used to find the relevant element you want to view the full list of attributes for via a locator.
    i. Actually, first consider the code required to find the relevant closest ancestor that is not in the Shadow DOM. 
    ii. From there consider the code necessary to locate the relevant specific element within the Shadow DOM. Go as far down the DOM as possible (more leaf-like is preferred).
Note you can chain locators like page.getByText('...').locator('...').locator('...')

We will evaluate the code passed into "locatorCode" to get the relevant element in Playwright, and provide the list of attributes. Note that using XPath / CSS selectors are not recommended, and XPAth cannot pierce the ShadowDOM so it's advised to use the Playwright getBy* functions.
You are looking at test data so try not to refer to the test data text in your selectors.

Your Output (code only):
`;
            const locatorCodeResponse = (_b = await this.getLLMResponse(relevLocatorPrompt)) !== null && _b !== void 0 ? _b : '';
            history.push({ role: "user", content: relevLocatorPrompt });
            history.push({ role: "assistant", content: locatorCodeResponse });
            // evaluate relevant locator
            const curPage = this.page;
            const runnableLocatorCode = this.modifyLocatorCode(locatorCodeResponse); // locatorCodeResponse.replace("page", "curPage");
            const locator = await eval(`${runnableLocatorCode}`);
            const firstMatchLocator = locator.first();
            await firstMatchLocator.waitFor({ timeout: WebAgent.MAX_WAIT });
            // get attribute dictionary
            const attributeNames = await firstMatchLocator.evaluate(element => Object.keys(element.attributes));
            const outStrBuilder = ['{'];
            for (const attrName of attributeNames) {
                const attrValue = await firstMatchLocator.getAttribute(attrName);
                const curKeyValStr = `   "${attrName}": "${attrValue}"`;
                outStrBuilder.push(curKeyValStr);
            }
            outStrBuilder.push('}');
            const attrListStr = outStrBuilder.join('\n');
            // send attribute list and prompt for output
            newInfo = `Here is the list of attributes for the locator you provided:
${WebAgent.tripleBackQuotes}
${attrListStr}
${WebAgent.tripleBackQuotes}
`;
        }
        else if (parseableResponse == '3') {
            // add before string
            newInfo = `The DOM tree before the interaction was:
${WebAgent.tripleBackQuotes}
${beforeDomTreeString}
${WebAgent.tripleBackQuotes}

Note that this is only visible elements and does not include information about attributes.
`;
        }
        // send next message
        const nextPrompt = `${newInfo}
Given the information about the DOM provided and any extra information, consider the following questions:

Question 1: do you think the assertion is true or false?
Question 2: what evidence supports your claim

Considering your answers to the above questions, provide evidence, then whether the assertion '${assertionStr}' is true/false, and how confident you are (0-1).

Format like so:
${WebAgent.tripleBackQuotes}
{
    "evidence": <brief evidence>,
    "isAssertionPassed": <'true' if assertion is true; 'false' otherwise>,
    "confidence": <confidence in correctness of response (0-1)>
}
${WebAgent.tripleBackQuotes}

Your Response:
`;
        const assertionResult = await this.getLLMResponse(nextPrompt, history);
        return assertionResult !== null && assertionResult !== void 0 ? assertionResult : '';
    }
    modifyLocatorCode(locatorCode) {
        console.log(`orign locator: ${locatorCode}`);
        const runnableLocatorCode = locatorCode === null || locatorCode === void 0 ? void 0 : locatorCode.replace(/page/g, 'curPage').replace(').', ').locator(\'visible=true\').').replace(/first\./g, 'first().'); //.replace("getByLabelText", "getByText").replace("firstChild", "first");
        console.log(`modifiedLocator: ${runnableLocatorCode}`);
        return runnableLocatorCode;
    }
    // TODO: edit params
    async runStep(wfStep, expectations, prevDOM) {
        let overallStepTime = perf_hooks_1.performance.now();
        let cumLLMTime = 0;
        let cumPreprocTime = 0;
        let cumPlaywrightTime = 0;
        let afterDOMAttr;
        let passedStep = false;
        if (wfStep.startsWith("Assert")) {
            let tempTime = perf_hooks_1.performance.now();
            const curAttrDOM = await this.getDOMTree(true, true);
            cumPreprocTime += perf_hooks_1.performance.now() - tempTime;
            tempTime = perf_hooks_1.performance.now();
            const response = await this.runAssertion(wfStep, prevDOM ? prevDOM : 'unknown', curAttrDOM);
            cumLLMTime += perf_hooks_1.performance.now() - tempTime;
            // parse response
            if (response.trim().length > 0) {
                const cleanedResponse = json5_1.default.parse(response.replace(/```json|```/g, ''));
                passedStep = cleanedResponse["isAssertionPassed"] === 'true';
            }
        }
        else {
            let tempTime = perf_hooks_1.performance.now();
            // get dom string before
            const beforeDOM = await this.getDOMTree(true, false);
            cumPreprocTime += perf_hooks_1.performance.now() - tempTime;
            // find action:string, locatorCode:string
            // const elemInteractionsStr = await this.getElemInteractions(wfStep);
            // const elemInteractionObj = JSON5.parse(elemInteractionsStr);
            // // const elemInteractionsList = JSON5.parse(elemInteractionsStr);
            let successfulInteraction = false;
            // let curIdx = 0;
            // while(!successfulInteraction && curIdx < elemInteractionsList.length) {
            //     curIdx += 1;
            // }
            const errorMsgs = [];
            let numTries = 0;
            while (!successfulInteraction && numTries < 3) {
                try {
                    tempTime = perf_hooks_1.performance.now();
                    const elemInteractionsStr = await this.getElemInteractions(wfStep, errorMsgs);
                    cumLLMTime += perf_hooks_1.performance.now() - tempTime;
                    // Remove the "```json" and "```" tags from the string
                    const cleanedResponse = elemInteractionsStr.replace(/```json|```/g, '');
                    const elemInteractionObj = json5_1.default.parse(cleanedResponse);
                    let origLocatorCode = '';
                    let origToLocatorCode = '';
                    try {
                        const curDict = elemInteractionObj; //elemInteractionsList[curIdx];
                        const action = curDict["action"];
                        origLocatorCode = curDict["locatorCode"];
                        const runnableLocatorCode = this.modifyLocatorCode(origLocatorCode);
                        const value = curDict["value"];
                        origToLocatorCode = curDict["toLocatorCode"];
                        const runnableToLocatorCode = this.modifyLocatorCode(origToLocatorCode);
                        // perform action
                        tempTime = perf_hooks_1.performance.now();
                        await this.runElemInteraction(action, runnableLocatorCode, value, runnableToLocatorCode);
                        cumPlaywrightTime += perf_hooks_1.performance.now() - tempTime;
                        tempTime = perf_hooks_1.performance.now();
                        // TODO: ask correct action here
                        // get dom string after w attribute mutations
                        afterDOMAttr = await this.getDOMTree(true, true);
                        cumPreprocTime += perf_hooks_1.performance.now() - tempTime;
                        const renderExpectations = expectations ? expectations : 'unknown';
                        tempTime = perf_hooks_1.performance.now();
                        // LLM: was desired action performed?
                        const response = await this.askCorrectAction(wfStep, renderExpectations, beforeDOM, afterDOMAttr);
                        cumLLMTime += perf_hooks_1.performance.now() - tempTime;
                        const cleanedResponse = json5_1.default.parse(response.replace(/```json|```/g, ''));
                        // TODO: based on response decide if interaction is success or not
                        successfulInteraction = cleanedResponse["Answer"].toLowerCase() === "yes"; // true;
                    }
                    catch (error) {
                        console.log(`Error with step ${wfStep}!\n${error}`);
                        const responseStr = JSON.stringify(elemInteractionObj);
                        const errorStr = `${error}`.slice(0, 700);
                        // ${responseStr}
                        const errorInfoStr = `${origLocatorCode} not found; Try a different locator. Error: ${errorStr}`;
                        errorMsgs.push(errorInfoStr);
                    }
                }
                catch (error) {
                    errorMsgs.push(error);
                    //console.log(error);
                }
                // TODO: if not successful interaction but DOM changed, must restart somehow
                // for now break
                if (!successfulInteraction) {
                    tempTime = perf_hooks_1.performance.now();
                    const afterDOM = await this.getDOMTree(true, false);
                    cumPreprocTime += perf_hooks_1.performance.now() - tempTime;
                    console.log(`Unsuccessful interaction; DOM equals: ${beforeDOM === afterDOM}`);
                    if (beforeDOM !== afterDOM) {
                        // DOM changed
                        // force fail
                        numTries = 5;
                    }
                }
                numTries += 1;
            }
            passedStep = successfulInteraction;
        }
        overallStepTime = perf_hooks_1.performance.now() - overallStepTime;
        return [passedStep, afterDOMAttr, [overallStepTime / 1000, cumLLMTime / 1000, cumPreprocTime / 1000, cumPlaywrightTime / 1000]];
    }
    async runInteractionTest() {
        const curPage = this.page;
        /*const llmResponse =  "page.getByText('Total items: 4.')".replace("page", "curPage");
        const locator = curPage.locator('CALCITE-LIST-ITEM:has-text(\"Edit Field\")');
        locator.waitFor({ timeout: WebAgent.MAX_WAIT }); // eval(`(${llmResponse})`);
        const toLocator = curPage.locator('FA-ACTION-CARD-LIST > FACE-SORTABLE-LIST > SECTION');
        toLocator.waitFor({ timeout: WebAgent.MAX_WAIT });

        await locator.dragTo(toLocator);*/
        const locator = curPage.getByLabel('Undo: Create layout');
        locator.waitFor({ timeout: WebAgent.MAX_WAIT });
        await locator.click();
        // await locator.fill("test"); //locator.click();
        console.log("done");
    }
    // TODO: delete later
    async testFindingLocator() {
        const prompt = `I need to do the following: type 'example title' into the input box labeled layout title under layout properties

The webapp has the following DOM Tree Structure (simplified + only human visible elements):
\`\`\`
BODY
---DIV
---HEADER
------A > svg > path
------DIV
------NAV > OL
---------------LI > A > "Maps"
---------------LI
------------------CALCITE-ICON > ...
------------------LI > "concido debeo ademptio alienus"
---------------LI
------------------CALCITE-ICON > ...
------------------LI > "East Antwanchester"
------DIV > UL
---------------LI > DIV > CALCITE-DROPDOWN
-----------------------------...
-----------------------------CALCITE-BUTTON > ...
---------------LI > A > "Resources"
---------------DIV
---------------LI > DIV > DIV > BUTTON
-----------------------------------DIV > DIV > "DD"
-----------------------------------SPAN > "Demond"
---MAIN > DIV > DIV
-------------------CALCITE-ACTION-BAR
----------------------... > "Collapse"
----------------------CALCITE-ACTION-GROUP
-------------------------...
-------------------------CALCITE-ACTION > ... > "Overview"
-------------------------CALCITE-ACTION > ... > "Forms"
-------------------------CALCITE-ACTION > ... > "Geofences"
-------------------------CALCITE-ACTION > ... > "Offline"
-------------------------CALCITE-ACTION > ... > "App settings"
-------------------------CALCITE-ACTION > ... > "Sharing"
----------------------CALCITE-ACTION-MENU
-------------------------...
-------------------------CALCITE-ACTION > ... > "Open"
----------------------CALCITE-ACTION > ... > "What’s New"
-------------------DIV
----------------------HEADER > SPAN > "Forms"
----------------------DIV
-------------------------INPUT
-------------------------BUTTON > CALCITE-ICON > ...
----------------------DIV
-------------------------CALCITE-BLOCK
----------------------------... > "Layers"
----------------------------CALCITE-LIST
-------------------------------... > "Total items: 4."
-------------------------------CALCITE-LIST-ITEM
----------------------------------...
----------------------------------CALCITE-LABEL > ...
----------------------------------DIV > CALCITE-ICON > ...
-------------------------------CALCITE-LIST-ITEM
----------------------------------...
----------------------------------CALCITE-LABEL > ...
----------------------------------DIV > CALCITE-ICON > ...
-------------------------------CALCITE-LIST-ITEM
----------------------------------...
----------------------------------CALCITE-LABEL > ...
----------------------------------DIV > CALCITE-ICON > ...
-------------------------------CALCITE-LIST-ITEM
----------------------------------...
----------------------------------CALCITE-LABEL > ...
----------------------------------DIV
-------------------------------------CALCITE-ICON > ...
-------------------------------------CALCITE-ICON > ...
-------------------------CALCITE-BLOCK > ... > "Tables"
-------------------------CALCITE-BLOCK > ... > "Basemap"
----------------------CALCITE-SPLIT-BUTTON > ...
-------------------DIV > DIV
----------------------------CALCITE-TABS
-------------------------------...
-------------------------------DIV > DIV
----------------------------------------CALCITE-TAB-NAV
-------------------------------------------...
-------------------------------------------CALCITE-TAB-TITLE
----------------------------------------------...
----------------------------------------------SPAN > "Form"
-------------------------------------------CALCITE-TAB-TITLE
----------------------------------------------...
----------------------------------------------SPAN > "Templates"
-------------------------------------------CALCITE-TAB-TITLE
----------------------------------------------...
----------------------------------------------SPAN > "Tasks"
----------------------------------------DIV
-------------------------------------------CALCITE-BUTTON > ...
-------------------------------------------CALCITE-BUTTON > ...
-------------------------------------------CALCITE-BUTTON > ...
-------------------------------------------CALCITE-DROPDOWN
----------------------------------------------...
----------------------------------------------CALCITE-BUTTON > ...
-------------------------------CALCITE-TAB
----------------------------------...
----------------------------------DIV > FA-LAYOUT-EDITOR > DIV
--------------------------------------------------------------FA-LAYOUTS-DROPDOWN > CALCITE-LABEL
---------------------------------------------------------------------------------------...
---------------------------------------------------------------------------------------DIV
------------------------------------------------------------------------------------------SPAN > "Layouts"
------------------------------------------------------------------------------------------CALCITE-ICON > ...
---------------------------------------------------------------------------------------CALCITE-COMBOBOX > ... > "Layouts
----------------------------------------------------------------------------------------------------------   New layout
----------------------------------------------------------------------------------------------------------   
----------------------------------------------------------------------------------------------------------   All
----------------------------------------------------------------------------------------------------------   New layout"
--------------------------------------------------------------P > "New layout"
--------------------------------------------------------------FA-ACTION-CARD-LIST > FACE-SORTABLE-LIST > ...
----------------------------DIV > FACE-SIDE-PANEL-STACK
-------------------------------------... > "Layout builder"
-------------------------------------DIV
----------------------------------------FA-LAYOUT-PROPERTIES > CALCITE-BLOCK
------------------------------------------------------------------... > "Layout properties"
------------------------------------------------------------------FACE-VALIDATED-FORM > FORM > FACE-VALIDATED-LABEL
--------------------------------------------------------------------------------------------------... > "Layout title"
--------------------------------------------------------------------------------------------------FACE-VALIDATED-INPUT > ...
------------------------------------------------------------------DIV > DIV
---------------------------------------------------------------------------CALCITE-LABEL
------------------------------------------------------------------------------...
------------------------------------------------------------------------------CALCITE-CHECKBOX > ...
------------------------------------------------------------------------------DIV > P > "Visible"
---------------------------------------------------------------------------DIV > CALCITE-BUTTON > ...
----------------------------------------FA-ACTIONS-BUILDER > CALCITE-BLOCK
----------------------------------------------------------------... > "Layout elements"
----------------------------------------------------------------CALCITE-LIST
-------------------------------------------------------------------... > "Total items: 16."
-------------------------------------------------------------------CALCITE-LIST-ITEM-GROUP
----------------------------------------------------------------------... > "CONFIGURABLE"
----------------------------------------------------------------------FACE-SORTABLE-LIST
-------------------------------------------------------------------------...
-------------------------------------------------------------------------CALCITE-LIST-ITEM
----------------------------------------------------------------------------...
----------------------------------------------------------------------------SECTION
-------------------------------------------------------------------------------DIV > SPAN > "Edit Field"
-------------------------------------------------------------------------------CALCITE-ICON > ...
-------------------------------------------------------------------------CALCITE-LIST-ITEM
----------------------------------------------------------------------------...
----------------------------------------------------------------------------SECTION
-------------------------------------------------------------------------------DIV > SPAN > "Integration"
-------------------------------------------------------------------------------CALCITE-ICON > ...
-------------------------------------------------------------------CALCITE-LIST-ITEM-GROUP
----------------------------------------------------------------------... > "SYSTEM"
----------------------------------------------------------------------FACE-SORTABLE-LIST
-------------------------------------------------------------------------...
-------------------------------------------------------------------------CALCITE-LIST-ITEM
----------------------------------------------------------------------------...
----------------------------------------------------------------------------SECTION
-------------------------------------------------------------------------------DIV > SPAN > "Attach"
-------------------------------------------------------------------------------CALCITE-ICON > ...
-------------------------------------------------------------------------CALCITE-LIST-ITEM
----------------------------------------------------------------------------...
----------------------------------------------------------------------------SECTION
-------------------------------------------------------------------------------DIV > SPAN > "Choose File"
-------------------------------------------------------------------------------CALCITE-ICON > ...
-------------------------------------------------------------------------CALCITE-LIST-ITEM
----------------------------------------------------------------------------...
----------------------------------------------------------------------------SECTION
-------------------------------------------------------------------------------DIV > SPAN > "Choose Photo or Video"
-------------------------------------------------------------------------------CALCITE-ICON > ...
-------------------------------------------------------------------------CALCITE-LIST-ITEM
----------------------------------------------------------------------------...
----------------------------------------------------------------------------SECTION > "Collect HereUse only with point layers"
\`\`\`
Output a list of 1-5 strings representing interactions that may accomplish the above task. Sort by likelihood of accomplishing the task.

Each interaction should be provided in JSON format with the following structure:
{
  "action": "click|enter|type|tab|dragAndDrop",
  "locatorCode": "code (to get the relevant element in Playwright)",
  "value": "value (only for type action)",
  "toSelector": "toSelector (only for dragAndDrop action)"
}

We will evaluate the code passed into "locatorCode" to get the relevant element in Playwright. Note that using XPath / CSS selectors are not recommended, and XPAth cannot pierce the ShadowDOM so it's advised to use the Playwright getBy* functions.
You are looking at test data so try not to refer to the test data text in your selectors.
Your output should be in a JSON stringified list format. For example,
\`\`\`
// getByRole
[{"action": "click", "locator”:”page.getByRole('button', { name: submit }”)
// getByLabel
[{"action": “enter”, "locator”:”page.getByLabel('Password’)”}]
// getByText
[{"action": “tab”, "locator”:”page.getByText('Welcome, John')”}]
// getByTestId
[{"action": “type”, "locator”:”page.getByTestId('directions’)”, “value”:”180 New York Streets”}]
// XPath:
[{"action": "click", "locator": "page.locator('[data-test-interactions]');"}]
// CSS:
[{"action": "click", "locator": "CALCITE-LIST-ITEM:nth-child(4)"}]
\`\`\`

Recall, I need to: type 'example title' into the input box labeled layout title under layout properties 

Output:
`;
        const response = `\`\`\`json
[
  {
    "action": "type",
    "locatorCode": "page.getByLabelText('Layout title')",
    "value": "example title"
  },
  {
    "action": "type",
    "locatorCode": "page.getByRole('textbox', { name: 'Layout title' })",
    "value": "example title"
  },
  {
    "action": "type",
    "locatorCode": "page.getByPlaceholderText('Enter layout title')",
    "value": "example title"
  },
  {
    "action": "type",
    "locatorCode": "page.getByTestId('layout-title-input')",
    "value": "example title"
  },
  {
    "action": "type",
    "locatorCode": "page.getByText('Layout title').nextSibling",
    "value": "example title"
  }
]
\`\`\``;
        const completion = await this.llmClient.chat.completions.create({
            messages: [
                // { role: "system", content: "You are a helpful assistant." },
                { role: "user", content: prompt },
                { role: "assistant", content: response },
                { role: "user", content: "If you want to type, consider that the Element found by the locator must be an <input>, <textarea> or [contenteditable] element. Please rewrite your output." }
            ],
            model: "gpt-3.5-turbo-0125",
            n: 1,
            temperature: 0.3
        });
        const newResponse = completion.choices[0].message.content;
        //this.agentPrint(`Prompt:\n${prompt}---\nResponse:${response}`);
        this.agentPrint(newResponse !== null && newResponse !== void 0 ? newResponse : '<No response>');
        return newResponse;
    }
}
exports.WebAgent = WebAgent;
// static variables
WebAgent.WIN_EVENT = 1;
WebAgent.LOSE_EVENT = -1;
WebAgent.CONTINUE_EVENT = 0;
WebAgent.FINISH_REWARD = 10000;
WebAgent.CORRECT_STEP_REWARD = 100;
WebAgent.NO_CHANGE_REWARD = -20;
WebAgent.NO_MUTATION = 'NA';
// max # ms to wait
WebAgent.MAX_WAIT = 5000;
WebAgent.tripleBackQuotes = '\`\`\`';
// driver
// private interactions_list = ["click", "enter", "tab"];
WebAgent.CLICK = "click";
WebAgent.ENTER = "enter";
WebAgent.TYPE = "type";
WebAgent.TAB = "tab";
WebAgent.DRAG_AND_DROP = "dragAndDrop";
