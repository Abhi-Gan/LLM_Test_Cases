import { TextNode } from "node-html-parser";
import OpenAI from "openai";
import { ChatCompletionMessageParam } from "openai/resources";
import { chromium, Browser, Page, Locator } from 'playwright'
import * as prettier from 'prettier' 
import {performance} from 'perf_hooks'
import JSON5 from 'json5'
import fs from 'fs'

export class WebAgent {
    // static variables
    static WIN_EVENT = 1;
    static LOSE_EVENT = -1;
    static CONTINUE_EVENT = 0;

    static FINISH_REWARD = 10000;
    static CORRECT_STEP_REWARD = 100;
    static NO_CHANGE_REWARD = -20;

    static NO_MUTATION = 'NA';

    // max # ms to wait
    static MAX_WAIT = 5000;

    // dynamic variables
    private verbose: boolean;
    // Webapp
    private webapp_url: string;
    private app_description: string;
    // LLM
    private llmClient: OpenAI;
    static tripleBackQuotes:string = '\`\`\`';
    // RL
    private epsilon: number;
    private alpha: number;
    private gamma: number;

    // maps (x,y) -> Real
    private Q_dict: { [key: string]: number } = {};
    private elements_encodings: { [key: string]: any } = {};

    // driver
    // private interactions_list = ["click", "enter", "tab"];
    static CLICK = "click"
    static ENTER = "enter"
    static TYPE = "type"
    static TAB = "tab"
    static DRAG_AND_DROP = "dragAndDrop"

    private page: Page | undefined;

    public constructor(llmClient: OpenAI, app_description: string, webapp_url: string, epsilon = 0, alpha = 1, gamma = 0.9, verbose = true) {
        this.llmClient = llmClient;
        this.app_description = app_description;
        this.webapp_url = webapp_url;

        this.verbose = verbose;

        this.epsilon = epsilon;
        this.alpha = alpha;
        this.gamma = gamma;
    }

    public async loadPage(webapp_url = this.webapp_url) {
        // load 
        const browser = await chromium.launch({ "headless": false }); //, slowMo: 100
        const context = await browser.newContext({ "ignoreHTTPSErrors": true });
        const page = await context.newPage();

        this.page = page;

        await page.goto(webapp_url);

        // wait until loaded?
        // domcontentloaded
        await page.waitForLoadState('networkidle');

        // inject mutation observer
        await this.injectMutationObserver();
        // do it again if there are any future changes to url
        page.on('framenavigated', async (frame) => {
            console.log("frame navigated")
            if (frame === page.mainFrame()) {
                console.log(`URL changed to: ${frame.url()}`);
                // TODO: create new observer?
                // await this.injectMutationObserver();
            }
        })
    }

    public agentPrint(message: string) {
        if (this.verbose) {
            //console.log(message)
            fs.appendFileSync("out.tmp.txt", message+"\n");
        }
    }

    async getAllInteractableElements() {
        // assert page is defined
        const curPage = this.page!;

        // CSS selector
        const locator = curPage.locator('[data-test-interactions]');
        // may need to wait until elements are visible...
        await locator.first().waitFor({ timeout: WebAgent.MAX_WAIT });
        // get list of interactable elems
        const elems = await locator.all();
        return elems;
    }

    public async getRelevElements(wfStep: string) {
        // subject of workflow
        const regex = /\*(.*?)\*/g;
        const stringsBetweenAsterisks: string[] = wfStep.match(regex) || [];

        // define fn based on wfStep
        let isRelev: (objDesc: string) => boolean;
        if (stringsBetweenAsterisks.length === 0) {
            isRelev = (objDesc: string) => wfStep.includes(objDesc);
        } else {
            isRelev = (objDesc: string) => { return true}; // (objDesc: string) => objDesc.includes(stringsBetweenAsterisks);
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
            const canSee = curSize?.height !== 0 && curSize?.width !== 0;

            if (curObjDesc && canSee && isRelev(curObjDesc)) {
                relevElems.push(curElem);
            }
        }

        return relevElems;
    }

    public async getLLMResponse(prompt: string, 
        history?: ChatCompletionMessageParam[],
        json_response = false
    ) {
        // { role: "system", content: "You are a helpful assistant." },
        const allMessages:ChatCompletionMessageParam[] = [];
        if (history) {
            allMessages.push(...history)
        }
        const newMessage:ChatCompletionMessageParam = { role: "user", content: prompt}
        allMessages.push(newMessage);

        // [{role: "user", content: prompt}]
        const response_format:OpenAI.Chat.Completions.ChatCompletionCreateParams.ResponseFormat | undefined = json_response ? { "type": "json_object" }: undefined;

        const completion = await this.llmClient.chat.completions.create({
            messages: allMessages,
            model: "gpt-3.5-turbo-0125",
            n: 1,
            temperature: 0.1,
            response_format: response_format
        });

        const response = completion.choices[0].message.content;

        this.agentPrint(`Prompt:\n${history ? `<history>\n${prompt}` : prompt}---\nResponse:${response}\n---`);
        
        return response;
    }

    private async getOuterHTML(elem: Locator) {
        return await elem.evaluate(elem => elem.outerHTML);
    }

    private async getReadableElemsList(elemsList: Locator[]) {
        const elemsHTMLList = await Promise.all(
            elemsList.map(
                async (elem, index) => {
                    const curOuterHTML = await this.getOuterHTML(elem);
                    const prettyOuterHTML = await prettier.format(curOuterHTML, {parser:'html'})
                    return `${index}.\n${prettyOuterHTML}`;
                }
            )
        );

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

    async getDOMTree(displayFullShadow=true, showMutations=false) {
        const curPage = this.page!;
        // ensure page is stable
        await curPage.waitForLoadState('networkidle', {timeout: 10000});
        // TODO: better soln??
        await curPage.waitForTimeout(1000);
        
        const domTreeString = await curPage.evaluate(({_displayFullShadow, _showMutations}) => {
            function isHumanVisible(elem: Element) {
                let result = true;

                const rect = elem.getBoundingClientRect();
                // TODO: sometimes width 1 elements: idk why they would be there.
                const rectVisible = rect.width > 0 && rect.height > 0;

                result = result && rectVisible;

                if (result) {
                    // is rect at least partially in viewport?
                    const isPartiallyInViewport = (
                        rect.top < (window.innerHeight || document.documentElement.clientHeight) &&
                        rect.left < (window.innerWidth || document.documentElement.clientWidth) &&
                        rect.bottom > 0 &&
                        rect.right > 0
                    );

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
                tag:string;
                children:grayRoot[];
                domElement:Element | ShadowRoot | TextNode;
                shadowRoot?:grayRoot;
                hasVisibleDescendant:boolean;

                private static SHADOWROOT_TAG = '...'; //'(SHADOWROOT)';

                constructor(domElement:Element | ShadowRoot | TextNode) {
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
                        this.hasVisibleDescendant ||= this.shadowRoot.hasVisibleDescendant;
                    }

                    // const children = Array.from(domElement.children) 
                    if (!(domElement.nodeType == Node.TEXT_NODE)) { // usually browser ignores children of TextNodes anyways
                        const childNodes = domElement.childNodes
                        const textNodes:grayRoot[] = []; // tracks text nodes whose visibilities must be updated
                        for (const child of childNodes) {
                            if (child instanceof Element) {
                                const grayChild = new grayRoot(child);
                                // if child has visible element descendant then add it to children
                                if (grayChild.hasVisibleDescendant) {
                                    this.children.push(grayChild);   
                                }
                                // now i might have visible desc
                                this.hasVisibleDescendant ||= grayChild.hasVisibleDescendant;
                            }
                            else if (child.nodeType == Node.TEXT_NODE && (child as TextNode).textContent.trim().length > 0) {
                                // add text node as a child 
                                // consider that only will actually render if parent has some visible child element
                                // mark this as human visible for later though
                                const grayChild = new grayRoot((child as TextNode));
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

                private getVisibleTextHelper(result:string[]) {
                    // base case
                    if (this.children.length == 0) {
                        // leaf node; add my text
                        if (this.hasVisibleDescendant && this.domElement.nodeType == Node.TEXT_NODE) { // this.domElement instanceof Element && isHumanVisible(this.domElement)
                            const curText = this.domElement.textContent?.trim()
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

                public getVisibleText() {
                    let result:string[] = [];
                    this.getVisibleTextHelper(result);
                    return result.join('\n').trim();
                }

                // TODO: implement scuffed soln to display all text
                public getTreeStr(collapseShadow=false, spacer='---') {
                    const numChildren = this.children.length;

                    const visibleText = this.getVisibleText();
                    let displayText = visibleText;
                    // shorten if it looks too long
                    // if (displayText.length > 20) {
                    //     displayText = `${displayText.slice(0,10)}...${displayText.slice(-10)}`;
                    // } 
                    const clearIndentSpace = ' '.repeat(spacer.length)
                    displayText = `${displayText.replace(/\n/g, '\n'+clearIndentSpace)}`

                    const attrMutations:string[] = [];
                    const attrMutDict:Record<string, {oldValue:string | undefined, newValue:string | undefined}> = {};

                    if (_showMutations && this.domElement instanceof Element) {
                        const curElem = this.domElement;
                        const curMutations:MutationRecord[] = (window as any).mutations;
                        // find all attribute mutations relevant to this elem
                        curMutations.forEach(mutation => {
                            // attribute changed (if any)
                            const attrName = mutation.attributeName;
                            if (attrName && mutation.target === this.domElement) {
                                // relevant attribute change!
                                const oldVal = mutation.oldValue?.trim();
                                const newVal = curElem.getAttribute(attrName)?.trim();
                                if (oldVal !== newVal) {
                                    if (!(attrName in attrMutDict)) {
                                        // add to dictionary
                                        attrMutDict[attrName] = {oldValue: oldVal, newValue: newVal};
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
                            let {oldValue, newValue} = attrMutDict[attrName];
                            if (newValue == '') {
                                newValue = "\'\'";
                            }
                            attrMutations.push(`${attrName}:${oldValue}->${newValue}`)
                        }
                    }

                    // get aria label, if any
                    let ariaLabel = ''
                    if (this.domElement instanceof Element && this.domElement.ariaLabel) {
                        ariaLabel = this.domElement.ariaLabel.trim()
                        if (ariaLabel.length > 0) {
                            ariaLabel = ` (aria-label: \"${ariaLabel}\")`
                        }
                    }
                    const mutationsInfo = _showMutations && attrMutations.length > 0 ? JSON.stringify(attrMutations) : '';
                    const tagDisp = `${this.tag}${ariaLabel}${mutationsInfo}`;

                    if (collapseShadow && this.tag == grayRoot.SHADOWROOT_TAG) {
                        // treat as leaf node
                        // const tempDisplayText = this.domElement.textContent ? this.domElement.textContent : '';
                        // , > ${ }
                        return (visibleText.length === 0 ? tagDisp : `${tagDisp} > "${displayText}"`);
                    }
                    else if (numChildren === 0) {
                        return tagDisp;
                    }
                    else if (numChildren === 1){
                        // numChildren > 0
                        const tagPrefix = `${tagDisp} > `;
                        const spacerPrefix = spacer // '-'.repeat(tagPrefix.length)
                        const child = this.children[0]

                        const childLines = child.getTreeStr(collapseShadow, spacer).split('\n');
                        // if (visibleText.length > 0) {
                        //     // add text content as first line
                        //     childLines.unshift(displayText)
                        // }
                        let lines:string[] = [];
                        childLines.forEach((childLine, index) => {
                            if (index === 0) {
                                lines.push(`${tagDisp} > ${childLine}`)
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
                        let lines:string[] = [];
                        lines.push(tagDisp);
                        // lines.push(clearIndentSpace+displayText);
                        // for each children:
                        for (const child of this.children) {
                            const childLines = child.getTreeStr(collapseShadow, spacer).split('\n');
                            childLines.forEach((childLine, index) => {
                                lines.push(`${spacer}${childLine}`)
                            })
                        }
                        return lines.join('\n');
                    }
                }
            }
 
            const bodyElem =  document.body;
            // let result:string[] = [];
            // getDomTreeHelperOld(bodyElem, result, '');
            // return result.join('');

            const bodyGrayRoot = new grayRoot(bodyElem);
            return bodyGrayRoot.getTreeStr(!_displayFullShadow);
        }, {_displayFullShadow:displayFullShadow, _showMutations:showMutations})

        return domTreeString;
    }

    // end goal: create DOM tree string w info abt mutations
    private async injectMutationObserver() {
        const curPage = this.page!;

        // injects mutationObserver into page
        await curPage.evaluate(() => {
            (window as any).mutations = [];

            const observer = new MutationObserver((mutationsList) => {
                const curMutations = [];

                for (let mutation of mutationsList) {
                    let newValue = null;
                    // new value
                    if (mutation.type === "attributes") {
                        // target must be instance of element; kinda redundant
                        if (mutation.target instanceof Element) {
                            newValue = mutation.target.getAttribute(mutation.attributeName!);
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
                    }

                    // only add mutation if value is different

                    if (true) { // mutation.oldValue !== newValue
                        curMutations.push(mutation);   
                    }
                }

                (window as any).mutations.push(... curMutations);
            })

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
    public async getSortedElements(wfStep:string) {
        // all relev elements
        const elemsList = await this.getRelevElements(wfStep); // await this.getAllInteractableElements(); 

        // resort relevant elements
        // const resortRelevElems: () => {}
        const elemsHTMLList = await this.getReadableElemsList(elemsList);

        console.log(`elemsHTMLList.length: ${elemsHTMLList.length}`)
        console.log(`elemsHTMLList: ${elemsHTMLList}`)

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

    public parseElemInteractionResponse(llmResponse:string) {
        return JSON.parse(llmResponse);
    }

    public async getElemInteractions(wfStep: string, prevErrorsList?:string[]) {
        const domTreeString = await this.getDOMTree(true);

        let prevErrorsMessage = '';
        if (prevErrorsList && prevErrorsList.length > 0) {
            prevErrorsMessage = `
Avoid selectors that may cause these Errors; try different ones:
${WebAgent.tripleBackQuotes}
${prevErrorsList.join('\n')}
${WebAgent.tripleBackQuotes}
`
        }

        // create prompt
        const elemInteractionPrompt = `I need to do the following: ${wfStep}

The webapp has the following DOM Tree Structure (simplified + only human visible elements):
${WebAgent.tripleBackQuotes}
${domTreeString}
${WebAgent.tripleBackQuotes}

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
 - consider that relevant element(s) may not be exact string matches
 - consider the step is written without knowledge of the DOM

Step 2: What type of interaction do you want to perform on the above element? (e.g. click, type, etc.)

Step 3: Based on your answer to Step 1, identify the code that in Playwright that should be passed into "locatorCode" that can be used to find the relevant element via a locator.
        i. Actually, first consider the code required to find the relevant closest ancestor that is not in the Shadow DOM. 
        ii. From there consider the code necessary to locate the relevant specific element within the Shadow DOM. Go as far down the DOM as possible (more leaf-like is preferred).
Note you can chain locators like page.getByRole('...').locator('...').getByText('...').

The locators you can may are listed in the examples below.

Also consider these notes:
 - Use getByLabel to find alements by associated <label> or aria-label attribute
 - When using any locator that matches by text, use exact matching. Be careful as multiple elements could match.
 - There could be multiple elements that match a locator, so be as specific as possible. We only take the first match.
 - XPath / CSS selectors cannot go through a Shadow DOM; You can try chaining locators to circumvent this.
 - prioritize locators as follows: getByRole > getByLabel > getByText > CSS / XPath selector
 
We will evaluate the code passed into "locatorCode" to get the relevant element in Playwright. 
You are looking at test data so try not to refer to the test data text in your selectors.

Step 4: Verify your code is well-formed Playwright code as described above. If there are errors, chain locators to follow the XPath.

Step 5: Output the interaction in the JSON format described earlier.
Your output should be in JSON format. No trailing commas.

Examples:
${WebAgent.tripleBackQuotes}
// getByRole
{"action": "click", "locatorCode:”page.getByRole('button', { name: submit }”)}
// getByLabel
{"action": “enter”, "locatorCode:”page.getByLabel('Password’)”}
// getByText
{"action": “tab”, "locatorCode:”page.getByText('Welcome, John'), { exact: true }”}
// getByTestID
{"action": “type”, "locatorCode:”page.getByTestId('directions’)”, “value”:”180 New York Streets”}
// XPath:
{"action": "click", "locatorCode": "page.locator('[data-test-interactions]');"}
// CSS:
{"action": "click", "locatorCode": "CALCITE-LIST-ITEM:nth-child(4)"}
${WebAgent.tripleBackQuotes}

Recall, I need to: ${wfStep} 
${prevErrorsMessage}
Output:\n`

        // console.log(elemInteractionPrompt);
        const llmResponse = await this.getLLMResponse(elemInteractionPrompt, undefined, false) ?? "";
        return llmResponse;// this.parseElemInteractionResponse(llmResponse);
    }

    public async runElemInteraction(action:string, locatorCode:string, value?:string, toLocatorCode?:string) {
        // assert page is defined
        const curPage = this.page!;

        curPage.evaluate(() => {
            // clear mutations
            (window as any).mutations.clear() 
        })

        const runnableLocatorCode = locatorCode.replace("page", "curPage") //.replace("getByLabelText", "getByText").replace("firstChild", "first");
        const locator = await eval(`${runnableLocatorCode}`);
        const firstMatchLocator = locator.first();
        await firstMatchLocator.waitFor({ timeout: WebAgent.MAX_WAIT })

        switch(action) {
            case WebAgent.CLICK:
                // click
                // const locator = curPage.locator(selector)
                await firstMatchLocator.click();
                break;
            case WebAgent.ENTER:
                // enter
                break;
            case WebAgent.TYPE:
                // type
                // ensures value is input
                const valStr = value!;
                await firstMatchLocator.fill(valStr);
                break;
            case WebAgent.TAB:
                // tab
                break;
            case WebAgent.DRAG_AND_DROP:
                console.log("drag and dropping")
                // drag and drop
                // ensure to selectors is input
                const runnableToLocatorCode = toLocatorCode!.replace("page", "curPage");
                const toLocator = await eval(`${runnableToLocatorCode}`);
                const firstMatchToLocator = toLocator.first();
                await firstMatchToLocator.waitFor({ timeout: WebAgent.MAX_WAIT })
                await firstMatchLocator.dragTo(firstMatchToLocator);

                break;
        }

        curPage.evaluate(({_action, _locatorCode}) => {
            // print mutations
            console.log(`printing mutations for ${_action} on ${_locatorCode}: ${(window as any).mutations.length}`)
            console.log((window as any).mutations.slice())
        }, {_action:action, _locatorCode:locatorCode})
    }

    public async askCorrectAction(wfStep:string, expectations:string, beforeDOM:string, afterDOM:string) {
        // create prompt
        const correctActionPrompt = `An agent is exploring a web page, and is supposed to perform the following: ${wfStep}

The agent performed some action on the page.

The webapp has the following DOM Tree Structure (simplified + only human visible elements) before the action:
${WebAgent.tripleBackQuotes}
${beforeDOM}
${WebAgent.tripleBackQuotes}

After the action, the DOM Tree Structure (with annotations for attribute changes) looks like this:
${WebAgent.tripleBackQuotes}
${afterDOM}
${WebAgent.tripleBackQuotes}

Follow the following steps:

Step 1: Use the following criteria along with any other information to determine if the step '${wfStep}' was performed.
${expectations} 

Note: all criteria must be met for the step to be performed.
Prove if the step was performed. Answer Yes/No and Briefly explain what evidence supports your claim.

Step 3: Score the agent's action between -1 and 1 in regards to the desired action. 
Reward the agent for correct responses and punish it for incorrect ones so it eventually learns how to accomplish the task.

Output:
`;

        const llmResponse = await this.getLLMResponse(correctActionPrompt) ?? "";
        return llmResponse;
    }

    public async runAssertion(assertionStr:string, beforeDomTreeString:string, afterAttrDomTreeString:string) {
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

Ouput one of the three following options:
1. 'Ready' if you are ready to answer whether the assertion is true
2. '2' if you need to know the full list of attributes for a particular element in the DOM
3. '3' if you need the DOM Tree before the interaction

Output:
`

        const llmResponse = await this.getLLMResponse(initialAssertionPrompt) ?? 'Ready';
        const parseableResponse = llmResponse.trim().toLowerCase()

        let history:ChatCompletionMessageParam[] = [
            {role:"user", content:initialAssertionPrompt}, 
            {role:"assistant", content:llmResponse}
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
`
            const locatorCodeResponse = await this.getLLMResponse(relevLocatorPrompt) ?? '';
            history.push({role:"user", content:relevLocatorPrompt})
            history.push({role:"assistant", content:locatorCodeResponse})

            // evaluate relevant locator
            const curPage = this.page!
            const runnableLocatorCode = locatorCodeResponse.replace("page", "curPage");
            const locator:Locator = await eval(`${runnableLocatorCode}`);
            const firstMatchLocator = locator.first();
            await firstMatchLocator.waitFor({ timeout: WebAgent.MAX_WAIT })
            
            // get attribute dictionary
            const attributeNames = await firstMatchLocator.evaluate(element => Object.keys(element.attributes));
            const outStrBuilder = ['{'];
            for (const attrName of attributeNames) {
                const attrValue = await firstMatchLocator.getAttribute(attrName);
                const curKeyValStr = `   "${attrName}": "${attrValue}"`
                outStrBuilder.push(curKeyValStr);
            }
            outStrBuilder.push('}');
            const attrListStr = outStrBuilder.join('\n')

            // send attribute list and prompt for output
            newInfo = `Here is the list of attributes for the locator you provided:
${WebAgent.tripleBackQuotes}
${attrListStr}
${WebAgent.tripleBackQuotes}
`
        }
        else if (parseableResponse == '3') {
            // add before string
            newInfo = `The DOM tree before the interaction was:
${WebAgent.tripleBackQuotes}
${beforeDomTreeString}
${WebAgent.tripleBackQuotes}

Note that this is only visible elements and does not include information about attributes.
`
        }

        // send next message
        const nextPrompt = `${newInfo}
Given the information about the DOM provided and any extra information, consider the following questions:

Question 1: do you think the assertion is true or false?
Question 2: what evidence supports your claim

Considering your answers to the above questions, provide evidence, then whether the assertion '${assertionStr}' is true/false, and how confident you are (0-1).

Format like so:
${WebAgent.tripleBackQuotes}
The node corresponding with the 3rd list element is no longer on the DOM tree so it has been removed
F
0.8
${WebAgent.tripleBackQuotes}

Your Response:
`
        const assertionResult = await this.getLLMResponse(nextPrompt, history);
        return assertionResult ?? '';
    }

    // TODO: edit params
    public async runStep(wfStep:string, expectations?:string, prevDOM?:string):Promise<[string | undefined, number]> {
        let startTime = performance.now();

        let afterDOM:string|undefined;

        if (wfStep.startsWith("Assert")) {
            const curAttrDOM = await this.getDOMTree(true, true);
            const response = await this.runAssertion(wfStep, prevDOM ? prevDOM: 'unknown', curAttrDOM); 
        }
        else {
            // get dom string before
            const beforeDOM = await this.getDOMTree(true, false);

            // find action:string, locatorCode:string
            // const elemInteractionsStr = await this.getElemInteractions(wfStep);
            // const elemInteractionObj = JSON5.parse(elemInteractionsStr);
            // // const elemInteractionsList = JSON5.parse(elemInteractionsStr);
            let successfulInteraction = false;
            // let curIdx = 0;
            // while(!successfulInteraction && curIdx < elemInteractionsList.length) {
                

            //     curIdx += 1;
            // }

            const errorMsgs:string[] = [];
            let numTries = 0;
            while(!successfulInteraction && numTries < 3) {
                try {
                    const elemInteractionsStr = await this.getElemInteractions(wfStep, errorMsgs);
                    const elemInteractionObj = JSON5.parse(elemInteractionsStr);
                    try {
                        const curDict = elemInteractionObj; //elemInteractionsList[curIdx];
                        const action = curDict["action"];
                        const locatorCode = curDict["locatorCode"];
                        const value = curDict["value"];
                        const toLocatorCode = curDict["toLocatorCode"];
        
                        // perform action
                        await this.runElemInteraction(action, locatorCode, value, toLocatorCode);
                        
                        // TODO: ask correct action here
                        // get dom string after w attribute mutations
                        afterDOM = await this.getDOMTree(true, true);
        
                        const renderExpectations = expectations ? expectations : 'unknown';
                        // LLM: was desired action performed?
                        const response = await this.askCorrectAction(wfStep, renderExpectations, beforeDOM, afterDOM);
                    
                        // TODO: based on response decide if interaction is success or not
                        successfulInteraction = true;
                    }
                    catch (error) {
                        console.log(`Error with step ${wfStep}!\n${error}`)
                        const errorInfoStr = `${error}`;
                        errorMsgs.push(errorInfoStr);
                    }
                }
                catch (error) {
                    console.log(error);
                }

                numTries += 1
            }
        }
        
        startTime = performance.now() - startTime;

        return [afterDOM, startTime];
    }

    public async runInteractionTest() {
        const curPage = this.page!;

        /*const llmResponse =  "page.getByText('Total items: 4.')".replace("page", "curPage");
        const locator = curPage.locator('CALCITE-LIST-ITEM:has-text(\"Edit Field\")');
        locator.waitFor({ timeout: WebAgent.MAX_WAIT }); // eval(`(${llmResponse})`);
        const toLocator = curPage.locator('FA-ACTION-CARD-LIST > FACE-SORTABLE-LIST > SECTION');
        toLocator.waitFor({ timeout: WebAgent.MAX_WAIT });

        await locator.dragTo(toLocator);*/

        const locator = curPage.getByLabel('Undo: Create layout')
        locator.waitFor({timeout: WebAgent.MAX_WAIT})
        await locator.click();

        // await locator.fill("test"); //locator.click();
        console.log("done");
    }

    // TODO: delete later
    public async testFindingLocator() {
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
// getByTestID
[{"action": “type”, "locator”:”page.getByTestId('directions’)”, “value”:”180 New York Streets”}]
// XPath:
[{"action": "click", "locator": "page.locator('[data-test-interactions]');"}]
// CSS:
[{"action": "click", "locator": "CALCITE-LIST-ITEM:nth-child(4)"}]
\`\`\`

Recall, I need to: type 'example title' into the input box labeled layout title under layout properties 

Output:
`
    
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
\`\`\``

        const completion = await this.llmClient.chat.completions.create({
            messages: [
                // { role: "system", content: "You are a helpful assistant." },
                { role: "user", content: prompt},
                { role: "assistant", content: response},
                { role: "user", content: "If you want to type, consider that the Element found by the locator must be an <input>, <textarea> or [contenteditable] element. Please rewrite your output."}
            ],
            model: "gpt-3.5-turbo-0125",
            n: 1,
            temperature: 0.3
        });

        const newResponse = completion.choices[0].message.content;

        //this.agentPrint(`Prompt:\n${prompt}---\nResponse:${response}`);
        this.agentPrint(newResponse ?? '<No response>');

        return newResponse;
    }
}