import { chromium, Browser, Page } from 'playwright'
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
            { role: "user", content: prompt }
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
    await locator.first().waitFor({ timeout: 5000 });
    // get list of interactable elems
    const elems = await locator.all();
    return elems;
}

async function run(webapp_url: string, out_fpath: string) {
    let startupTime = curTime();

    // TODO: remove slowMo for training speed later
    const browser = await chromium.launch({ "headless": false, slowMo: 100 });
    const context = await browser.newContext({ "ignoreHTTPSErrors": true });
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

    await curAgent.runElemInteraction("click", "curPage.locator('CALCITE-LIST-ITEM:last-child')");

    curDomTreeString = await curAgent.getDOMTree();
    // console.log(`afterDomTreeString:\n${curDomTreeString}`);
    console.log("==");

    //--let elemInteractionsList = await curAgent.getElemInteractions("select the 'Tasks' tab in the Forms nav bar");
    //    await curAgent.runStep("select the 'Tasks' tab in the Forms nav bar", "content related to creating layouts is now visible");
    // console.log(elemInteractionsList);

    await curAgent.runElemInteraction("click", "curPage.getByText('Tasks')"); //"CALCITE-TAB-TITLE > SPAN:has-text('Tasks')"

    curDomTreeString = await curAgent.getDOMTree();
    // console.log(`afterDomTreeString:\n${curDomTreeString}`);
    console.log("==");


    //    await curAgent.runStep("select the button labeled 'New Layout' in the canvas") // , "The canvas has a new layout card and empty canvas instructions are removed.", undefined
    // elemInteractionsList = await curAgent.getElemInteractions("select the 'New layout' button in the canvas");
    // console.log(elemInteractionsList);

    // may have to try multiple options in the list to get correct one
    await curAgent.runElemInteraction("click", "curPage.getByText('New layout', { exact: true })"); //"page.getByRole('button', { name: 'New layout' })" //"CALCITE-BUTTON:contains('New layout')"

    // await curAgent.runElemInteraction("click", "page.getByText('Form', { exact: true })");

    // to remove the element
    curDomTreeString = await curAgent.getDOMTree();
    // console.log(`afterDomTreeString:\n${curDomTreeString}`);
    // console.log("==");
    //"page.getByRole('button', { name: 'Discard changes' })"
    // await curAgent.runStep("click on the discard changes button in the modal");
    //await curAgent.runElemInteraction("click", "page.getByText('Discard changes')");
    // await curAgent.runStep("click on the discard changes button in the modal", "    - the form tab is selected and the form builder is visible");
    //let elemInteractionsList = await curAgent.runStep("click the dropdown menu button on the first layout card", "    - options to remove and duplicate for the first layout card are now visible");
    // await curAgent.runElemInteraction("click", "page.locator('FA-LAYOUT-CARD CALCITE-DROPDOWN CALCITE-BUTTON')");

    curDomTreeString = await curAgent.getDOMTree();
    //console.log(`afterDomTreeString:\n${curDomTreeString}`);
    console.log("==");
    // let elemInteractionsList = await curAgent.getElemInteractions("click the remove button");
    // await curAgent.runElemInteraction("click", "page.getByText('Remove')");


    // await curAgent.runElemInteraction("click", "page.getByText('Duplicate')")
    // await curAgent.runStep("duplicate the first layout card", 
    //     "    - there is now a second layout card\n    - the second layout card is labeled that it is a copy of the first");


    //const beforeDOM = await curAgent.getDOMTree(true, false);
    // console.log(`afterDomTreeString:\n${curDomTreeString}`);
    // console.log("==");
    // await curAgent.getElemInteractions("click on the first layout card");
    // await curAgent.runStep("click on the first layout card", "layout builder panel is now visible")
    await curAgent.runElemInteraction("click", "curPage.locator('FA-LAYOUT-CARD')");

    let beforeDOM = await curAgent.getDOMTree(true, false);
    const [passedStep, afterDOMAttr, times] = await curAgent.runStep("Assert the check box next to the text that says 'Visible' is currently not checked", undefined, beforeDOM);
    console.log(`passed assertion: ${passedStep}`);
    // const afterDOM = await curAgent.getDOMTree(true, false); //true, false
    // const afterDOMAttr = await curAgent.getDOMTree(true, true);
    //    console.log(`afterDomTreeString:\n${afterDOMAttr}`);
    console.log("==");


    // -const assertionVal = await curAgent.runAssertion("the check box next to the text that says 'Visible' is not currently checked", beforeDOM, afterDOMAttr);
    // console.log(`assertionVal: ${assertionVal}`);

    // "click on the first layout card"
    //  and has options to remove and duplicate
    //-const response = await curAgent.askCorrectAction("click the dropdown menu button on the first layout card", "The dropdown menu for the first layout card is now visible.",beforeDOM, afterDOM);

    //    await curAgent.runStep("drag the 'Edit Field' layout element to the fa-action-card-list element in the canvas", "an 'Edit Field' card should be visible in the canvas and its properties panel shows up over the layout builder panel");
    //    await curAgent.runStep("Select the undo button (leftmost button in the group of buttons to the right of the Forms nav bar)");
    // doesnt work: await curAgent.getElemInteractions("drag the edit field layout element to the area which says 'Drag layout elements into this area'");
    // await curAgent.runElemInteraction("dragAndDrop", "page.getByText('Edit Field')", undefined, "page.getByText('Drag layout elements to this area')");
    //await curAgent.runElemInteraction("dragAndDrop", "page.getByText('Edit Field')", undefined, "page.locator('FA-ACTION-CARD-LIST')")

    // await curAgent.runStep("type 'example title' into the input box under the text 'layout title'",
    //     "    - the text in the input box under the text 'layout title' should now be titled 'example title'\n    - above the layout editor there should be text saying 'example title'",
    //     undefined
    // );
    // await curAgent.runElemInteraction("type", "page.getByLabel('Layout title').locator('input')", "test layout title");
    // await curAgent.getDOMTree();

    // await curAgent.runElemInteraction("click", "page.getByText('Layouts').locator('..').getByRole('combobox')");

    // await curAgent.runElemInteraction("type", "page.getByLabel('Display name*').locator('input')", "test field name")

    //    await curAgent.getElemInteractions("type 'example title' into the input box under the text layout title under layout properties");
    // await curAgent.runElemInteraction("type", "page.locator('fa-layout-properties').locator('face-validated-form').locator('face-validated-label').locator('face-validated-input').locator('calcite-input-text').locator('input')", "example title");

    // await curAgent.runStep("click the save button", 
    //     "a calcite alert should display saying that the layout changes were saved successfully",
    //     undefined
    // )
    // await curAgent.testFindingLocator();
    //await curAgent.runInteractionTest();

    // await curAgent.runStep("click on the duplicate button on the 'edit field' card", 
    //     "    - another card with title 'Copy of <original card title>' should appear"
    // )
    // await curAgent.getDOMTree();
    // await curAgent.runElemInteraction("click", "page.getByRole('button', { name: 'Duplicate' })")

    // await curAgent.runStep("Drag the card 'Copy of test field name' to the card 'test field name'",
    //     "    - the card 'Copy of test field name' should now be above the card 'test field name'"
    // )

    // await curAgent.runElemInteraction("dragAndDrop", "page.getByText('Copy of test field name')", undefined, "page.getByText('test field name')");

    console.log("done")
}

async function runSampleTest(app_description: string, webapp_url: string, testFname: string, indent = '    ', metrics_csv:string = 'metrics.csv', shouldPass:boolean, closeAtEnd=false) {
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
    let curStep: Step | null = null;

    for (const line of lines) {
        const isSideEffect = line.startsWith(indent);
        const trimmedLine = line.trim();

        if (trimmedLine != '') {
            if (!isSideEffect) {
                curStep = { step: line, sideEffects: undefined }
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

    let prevDOM: string | undefined;

    const stepTimes: number[] = [];

    let passingTest = true;
    let [testOverallTime, testLLMTime, testPreprocTime, testPlaywrightTime] = [0,0,0,0];

    for (let index = 0; index < steps.length; index++) {
        const curStep = steps[index];

        const wfStep = curStep.step;
        const seStr = curStep.sideEffects?.map(sePlain => `${indent}- ${sePlain}`).join('\n');

        console.log(wfStep);
        console.log(seStr);

        // runStep - include prevDOM if this is an assertion
        const isAssert = curStep.step.startsWith("Assert");
        const isRun = curStep.step.startsWith("/run");

        if (isRun) {
            const fname = curStep.step.split(' ')[1];

            const elemInteractionsLines = fs.readFileSync(fname, 'utf-8').split("\n");
            console.log(elemInteractionsLines)
            for (const line of elemInteractionsLines) {
                const trimmedLine = line.trim();
                if (trimmedLine.length > 0) {
                    const lineArr = await eval(`[${trimmedLine}]`);
                    console.log(lineArr);
                    const interaction = lineArr[0];
                    const locatorCode = lineArr[1];
                    const value = lineArr.length > 3 ? lineArr[2] : undefined;
                    const toLocatorCode = lineArr.length > 4 ? lineArr[3] : undefined;

                    await curAgent.runElemInteraction(interaction, locatorCode, value, toLocatorCode);
                }
            }
        }
        else {
            // normal wf step doesn't need prev dom
            const passPrevDOM = isAssert ? prevDOM : undefined;
            let stepTimes: number[] = [0,0,0,0];
            let passedStep: boolean = false;
            [passedStep, prevDOM, stepTimes] = await curAgent.runStep(wfStep, seStr, passPrevDOM);
            const [stepOverallTime, stepLLMTime, stepPreprocTime, stepPlaywrightTime] = stepTimes
            testOverallTime += stepOverallTime;
            testLLMTime += stepLLMTime;
            testPreprocTime += stepPreprocTime;
            testPlaywrightTime += stepPlaywrightTime;

            console.log(`${passedStep ? 'passed' : 'failed'} step.`)
            // stop early if failed step
            if (!passedStep) {
                passingTest = false;
                break;
            }

            // if (isAssert) {
            //     // pass in prevDOM (so can be compared to current)
            //     //console.log(`skipping assertion:${curStep}`);
            //     await curAgent.runStep(wfStep, seStr, prevDOM);
            // }
            // else {
            //     // normal wf step: doesn't need prev dom
            //     // just pass in wfStep and expectations
            //     let stepTime = 0;
            //     let passedStep:boolean = false;
            //     [passedStep, prevDOM, stepTime] = await curAgent.runStep(wfStep, seStr, undefined)
            //     stepTimes.push(stepTime / 1000); // get time in sec

            //     console.log(`${passedStep ? 'passed' : 'failed'} step.`)
            //     if (!passedStep) {
            //         break;
            //     }
            // }
        }

        // TODO: incorporate accuracy
        // console.log("should ask for eval")
        // const stepPerformedHuman = prompt("Was LLM correct?");
        // console.log(`human eval: ${stepPerformedHuman}`);
    }

    // write info to metrics_csv

    // create write stream
    const writeStream = fs.createWriteStream(metrics_csv, { flags: 'a' });
    // const colNames = [
    //     'testName',
    //     'passed',
    //     'OverallTime','LLMTime', 'PreprocTime', 'PlaywrightTime',
    // ]
    // // write col headers
    // writeStream.write(`${colNames.join(',')}\n`);
    const colVals = [testFname, passingTest, shouldPass, steps.length, testOverallTime, testLLMTime, testPreprocTime, testPlaywrightTime];
    writeStream.write(`${colVals.join(',')}\n`);

    console.log(passingTest ? "passed test." : "failed test.")
    console.log("done");

    testTime = performance.now() - testTime;
    // print all the times
    console.log(`testTime: ${testTime / 1000} sec`);

    stepTimes.forEach((time) => {
        console.log(time);
    })

    if (closeAtEnd) {
        await curAgent.closingActions();
    }
}

async function repeatTests(testFnameList:string[], shouldPassList:boolean[], nReps:number =1) {
    if (testFnameList.length !== shouldPassList.length) {
        console.log("Error! list lengths of repeatTests do not match!");
        return false;
    }
    else {
        const runNTimes = async (testFname:string, shouldPass:boolean) => {
            for (let i=0; i<nReps; i++) {
                await runSampleTest("app that lets you configure layers and layouts", webapp_url, testFname, undefined, undefined, shouldPass, true);
            }
        }

        console.log(`training on all ${testFnameList.length} tests`);
        for (let i = 0; i < testFnameList.length; i++) {
            const testFname = testFnameList[i];
            const shouldPass = shouldPassList[i];
            await runNTimes(testFname, shouldPass);
        }
        return true;
    }
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
//tryAgent();

//"./NL_tests/test4.txt"
//"test1.txt", 
//runSampleTest("app that lets you configure layers and layouts", webapp_url, "./NL_tests/test3.txt", undefined, undefined, true, true);


//const testCaseFpaths = ["test1.txt", "test2.txt", "test3.txt", "test4.txt", "test7.txt"].map(fname => `./NL_tests/${fname}`);
//const shouldPass = [true, true, true, true, false]

repeatTests(["./NL_tests/test3.txt"], [true], 10);
