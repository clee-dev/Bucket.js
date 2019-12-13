const coreBehaviors = require('./behaviors/core.js');
const swapBehaviors = require('./behaviors/swap.js');
const newBehaviors = require('./behaviors/new.js');
const mentionBehaviors = require('./behaviors/mention.js');

const {
    detectedFactoids,
    processFactoid,
} = require('./util.js');

const runFactoid =
    new B(async ({ message }) => { // factoids
            const matchingFactoids = await detectedFactoids(message.content.toLowerCase());
            return matchingFactoids.length && matchingFactoids;
        }, async (_, { message }) => {
            processFactoid(matchingFactoids, message);
        }, { mention: true, nonmention: true }
    );

const allBehaviors = [
    ...coreBehaviors,
    ...swapBehaviors,
    ...newBehaviors,
    ...mentionBehaviors,
    runFactoid,
];

module.exports = allBehaviors;