// Node.js test runner - runs Chronicle exercise tests without a browser.
// Mocks the browser globals that the modules expect.

// Mock browser globals
global.window = global;
global.performance = { now: () => Date.now() };
global.console = console;

// Load modules in order
require('../exercises/base.js');
require('../exercises/squat.js');
require('../exercises/deadlift.js');
require('../exercises/rdl.js');
require('../exercises/single-leg-rdl.js');
require('../exercises/hack-squat.js');
require('../exercises/bulgarian-squat.js');
require('../exercises/split-squat.js');
require('../exercises/general-squat.js');
require('../exercises/general-lunge.js');
require('../exercises/general-hinge.js');
require('../exercises/registry.js');

// Load test framework
require('./test-helpers.js');

// Load tests
require('./test-base.js');
require('./test-exercises.js');

// Print results
const output = TestHelpers.printResults();
console.log(output);

// Restore time
TestHelpers.restoreTime();

// Exit with code based on results
process.exit(TestHelpers.results.failed > 0 ? 1 : 0);
