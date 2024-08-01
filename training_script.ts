import {chromium, Browser, Page} from 'playwright'
import * as fs from "fs"
import * as fsExtra from "fs-extra"
import * as path from "path"

import OpenAI from "openai";

import { WebAgent } from './agent';

import promptSync from 'prompt-sync';


const openai = new OpenAI();

// import * as readline from 'readline';

async function getLLMResponse(prompt: string) {
    const completion = await openai.chat.completions.create({
        messages: [
            { role: "system", content: "You are a helpful assistant." },
            { role: "user", content: prompt}
        ],
        model: "gpt-3.5-turbo-0125",
        n: 1,
        temperature: 0.3
      });
    
    return completion.choices[0].message.content
}

function curTime() {
    if (SAVE_METRICS) {
        return performance.now();
    }
    else {
        return 0;
    }
}

function sleep(sec: number): Promise<void> {
    const ms = sec * 1000;
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// appends line to file; asynchronously
async function appendLineAsync(fpath: string, line: string) {
    await fs.promises.appendFile(fpath, line + "\n");
}

async function get_relev_elems(page: Page) {
    // CSS selector
    const locator = page.locator('[data-test-interactions]');
    // may need to wait until elements are visible...
    await locator.first().waitFor({timeout: 5000});
    // get list of interactable elems
    const elems = await locator.all();
    return elems;
}

async function run(webapp_url: string, out_fpath: string) {
    let startupTime = curTime();

    // TODO: remove slowMo for training speed later
    const browser = await chromium.launch({"headless": false, slowMo: 100});
    const context = await browser.newContext({"ignoreHTTPSErrors": true});
    const page = await context.newPage();

    await page.goto(webapp_url);

    // write out to a file
    startupTime = curTime() - startupTime;
    if (SAVE_METRICS) {
        appendLineAsync(out_fpath, `startup time: ${startupTime / 1000} sec`);
    }

    let relevTime = curTime();
    const relevElems = await get_relev_elems(page);
    relevTime = curTime() - relevTime;
    console.log("relev elems");
    console.log(relevElems);
    console.log(`relev time: ${relevTime / 1000} sec`);

    const llmResponse = await getLLMResponse("write a 5 word sentence.") ?? 'No Response';
    appendLineAsync(out_fpath, llmResponse);

    // close browser
    // await sleep(2);
    // await browser.close();
}

async function tryAgent() {
    const curAgent = new WebAgent(openai, "app that lets you configure layers and layouts", "https://local.arcgis.com:4200/maps/3/forms");
    await curAgent.loadPage();
    // const interactableElems = await curAgent.getAllInteractableElements();
    // // console.log(`interactableElems:\n${interactableElems}`);
    
    let curDomTreeString = await curAgent.getDOMTree();
    // console.log(`domTreeString:\n${curDomTreeString}`);
    console.log("==");
//    await curAgent.runStep("select the last layer in the layer editor", undefined, undefined);
    // let elemInteractionsList = await curAgent.getElemInteractions("select the last layer in the layer editor");
    //  let parsedElemInteractionList = JSON.parse(elemInteractionsList);
    //  console.log(parsedElemInteractionList);
    // // TODO: resort based on Q value
    // const firstElemInteraction = elemInteractionsList[0];
    // curAgent.runElemInteraction(firstElemInteraction["action"], firstElemInteraction["selector"]);
    // curAgent.getSortedElements("select the last interactable layer *list item*");

    await curAgent.runElemInteraction("click", "page.locator('CALCITE-LIST-ITEM:last-child')");

    curDomTreeString = await curAgent.getDOMTree();
    // console.log(`afterDomTreeString:\n${curDomTreeString}`);
    console.log("==");

    //--let elemInteractionsList = await curAgent.getElemInteractions("select the 'Tasks' tab in the Forms nav bar");
//    await curAgent.runStep("select the 'Tasks' tab in the Forms nav bar", "content related to creating layouts is now visible");
    // console.log(elemInteractionsList);

    await curAgent.runElemInteraction("click", "page.getByText('Tasks')"); //"CALCITE-TAB-TITLE > SPAN:has-text('Tasks')"

    curDomTreeString = await curAgent.getDOMTree();
    // console.log(`afterDomTreeString:\n${curDomTreeString}`);
    console.log("==");


//    await curAgent.runStep("select the button labeled 'New Layout' in the canvas") // , "The canvas has a new layout card and empty canvas instructions are removed.", undefined
    // elemInteractionsList = await curAgent.getElemInteractions("select the 'New layout' button in the canvas");
    // console.log(elemInteractionsList);

    // may have to try multiple options in the list to get correct one
    await curAgent.runElemInteraction("click", "page.getByText('New layout', { exact: true })"); //"page.getByRole('button', { name: 'New layout' })" //"CALCITE-BUTTON:contains('New layout')"

    await curAgent.runElemInteraction("click", "page.getByText('Form', { exact: true })");

    // to remove the element
    curDomTreeString = await curAgent.getDOMTree();
    console.log(`afterDomTreeString:\n${curDomTreeString}`);
    // console.log("==");
    // let elemInteractionsList = await curAgent.getElemInteractions("click the dropdown menu button on the first layout card");
    /*await curAgent.runElemInteraction("click", "page.locator('FA-LAYOUT-CARD CALCITE-DROPDOWN CALCITE-BUTTON')");

    curDomTreeString = await curAgent.getDOMTree();
    console.log(`afterDomTreeString:\n${curDomTreeString}`);
    console.log("==");
    // let elemInteractionsList = await curAgent.getElemInteractions("click the remove button");
    // await curAgent.runElemInteraction("click", "page.getByText('Remove')");

    
    await curAgent.runElemInteraction("click", "page.getByText('Duplicate')")
    // await curAgent.runStep("click the button to duplicate the first layout card", 
    //     "    - there is now a second layout card\n    - the second layout card is labeled that it is a copy of the first");


   const beforeDOM = await curAgent.getDOMTree(true, false);
    // console.log(`afterDomTreeString:\n${curDomTreeString}`);
    // console.log("==");
    // await curAgent.getElemInteractions("click on the first layout card");
//    await curAgent.runStep("click on the first layout card", "layout builder panel is now visible")
    await curAgent.runElemInteraction("click", "page.locator('FA-LAYOUT-CARD')");

//    await curAgent.runStep("Assert the check box next to the text that says 'Visible' is currently checked", undefined, beforeDOM);
//    const afterDOM = await curAgent.getDOMTree(true, false); //true, false
    const afterDOMAttr = await curAgent.getDOMTree(true, true);
//    console.log(`afterDomTreeString:\n${afterDOMAttr}`);
    console.log("==");*/


    // -const assertionVal = await curAgent.runAssertion("the check box next to the text that says 'Visible' is not currently checked", beforeDOM, afterDOMAttr);
    // console.log(`assertionVal: ${assertionVal}`);

    // "click on the first layout card"
    //  and has options to remove and duplicate
    //-const response = await curAgent.askCorrectAction("click the dropdown menu button on the first layout card", "The dropdown menu for the first layout card is now visible.",beforeDOM, afterDOM);

//    await curAgent.runStep("drag the 'Edit Field' layout element to the fa-action-card-list element in the canvas", "an 'Edit Field' card should be visible in the canvas and its properties panel shows up over the layout builder panel");
//    await curAgent.runStep("Select the undo button (leftmost button in the group of buttons to the right of the Forms nav bar)");
    // doesnt work: await curAgent.getElemInteractions("drag the edit field layout element to the area which says 'Drag layout elements into this area'");
    // await curAgent.runElemInteraction("dragAndDrop", "page.getByText('Edit Field')", undefined, "page.getByText('Drag layout elements to this area')");

//   // await curAgent.runStep("type 'example title' into the input box under the text 'layout title'",
    //     "    - the text in the input box under the text 'layout title' should now be titled 'example title'\n    - above the layout editor there should be text saying 'example title'",
    //     undefined
    // );

//    await curAgent.getElemInteractions("type 'example title' into the input box under the text layout title under layout properties");
    // await curAgent.runElemInteraction("type", "page.locator('fa-layout-properties').locator('face-validated-form').locator('face-validated-label').locator('face-validated-input').locator('calcite-input-text').locator('input')", "example title");
 
    // await curAgent.runStep("click the save button", 
    //     "a calcite alert should display saying that the layout changes were saved successfully",
    //     undefined
    // )
    // await curAgent.testFindingLocator();
    //await curAgent.runInteractionTest();
    console.log("done")
}

async function runSampleTest(app_description:string, webapp_url:string, testFname:string, indent='    ') {
    const prompt = promptSync();
    let testTime = performance.now();

    const curAgent = new WebAgent(openai, app_description, webapp_url);
    await curAgent.loadPage(webapp_url);

    interface Step {
        step: string;
        sideEffects: string[] | undefined;
    }

    const testFile = fs.readFileSync(testFname, 'utf-8');

    const lines = testFile.split('\n');
    const steps: Step[] = [];
    let curStep: Step|null = null;
    for (const line of lines) {
        const isSideEffect = line.startsWith(indent);
        const trimmedLine = line.trim();

        if (trimmedLine != '') {
            if (!isSideEffect) {
                curStep = {step: line, sideEffects:undefined}
                steps.push(curStep)
            }
            else {
                // add this to the list of side effects of curStep
                const curSE = curStep!.sideEffects;
                if (curSE) {
                    curSE.push(trimmedLine)
                }
                else {
                    curStep!.sideEffects = [trimmedLine];
                }
            }
        }
    }

    let prevDOM:string|undefined;

    const stepTimes:number[] = [];

    for (const curStep of steps) {
        const wfStep = curStep.step;
        const seStr = curStep.sideEffects?.map(sePlain => `${indent}- ${sePlain}`).join('\n');

        console.log(wfStep);
        console.log(seStr);

        // runStep - include prevDOM if this is an assertion
        const isAssert = curStep.step.startsWith("Assert");
        if (isAssert) {
            // pass in prevDOM (so can be compared to current)
            await curAgent.runStep(wfStep, seStr, prevDOM);
        }
        else {
            // normal wf step: doesn't need prev dom
            // just pass in wfStep and expectations
            let stepTime = 0;
            [prevDOM, stepTime] = await curAgent.runStep(wfStep, seStr, undefined)
            stepTimes.push(stepTime / 1000); // get time in sec
        }

        // TODO: incorporate accuracy
        // console.log("should ask for eval")
        // const stepPerformedHuman = prompt("Was LLM correct?");
        // console.log(`human eval: ${stepPerformedHuman}`);
    }

    console.log("done");

    testTime = performance.now() - testTime;
    // print all the times
    console.log(`testTime: ${testTime / 1000} sec`);

    stepTimes.forEach((time) => {
        console.log(time);
    })
}

const webapp_url = "https://local.arcgis.com:4200/maps/3/forms";

const parent_dir = path.dirname(__dirname);
const training_out_dir = path.join(parent_dir, "training-out");

// setup 

// Get the command-line arguments
const args = process.argv.slice(2);

var SAVE_METRICS = args.includes("--save_metrics");

// clear + delete ouput dir if exists
if (fs.existsSync(training_out_dir)) {
    // delete dir
    fsExtra.removeSync(training_out_dir);
}
// create dir
fs.mkdirSync(training_out_dir);

const out_fpath = path.join(training_out_dir, "test.txt");

// run(webapp_url, out_fpath);
tryAgent();
//runSampleTest("app that lets you configure layers and layouts", webapp_url, "./NL_tests/test1.txt");
