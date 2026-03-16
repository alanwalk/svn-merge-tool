// Bootstrap ts-node for the Node.js built-in test runner.
// Loaded via: node --require ./test/register.cjs --test <files>
require('ts-node').register({ project: require('path').join(__dirname, '..', 'tsconfig.test.json') });
