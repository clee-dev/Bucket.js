const coreBehaviors = require('./behaviors/core.js');
const swapBehaviors = require('./behaviors/swap.js');
const newBehaviors = require('./behaviors/new.js');
const mentionBehaviors = require('./behaviors/mention.js');
const B = require('./B.js');

const {
    detectedFactoids,
    processFactoid,
} = require('./util.js');

const runFactoid =
    new B('core:run-factoid', async ({ message, db }) => { // factoids
            const matchingFactoids = await detectedFactoids(message.content.toLowerCase(), db);
            return matchingFactoids.length && matchingFactoids; // [] is truthy
        }, async ({ message, db }, matchingFactoids) => {
            await processFactoid(matchingFactoids, message, db);
        }, { mention: true, nonmention: true, silent: false }
    );

const allBehaviors = [
    ...coreBehaviors,
    ...swapBehaviors,
    ...newBehaviors,
    ...mentionBehaviors,
    runFactoid,
];

module.exports = allBehaviors;