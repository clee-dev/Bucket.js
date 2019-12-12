const coreBehaviors = require('./behaviors/core.js');
const swapBehaviors = require('./behaviors/swap.js');
const newBehaviors = require('./behaviors/new.js');
const mentionBehaviors = require('./behaviors/mention.js');

const runFactoid =
    new B(async (message, db) => { // factoids
            const matchingFactoids = await detectedFactoids(message.content.toLowerCase());
            return matchingFactoids.length && matchingFactoids;
        }, async (message, db, data) => {
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