const syllable = require('syllable');
const uuid = require('uuid/v4');

const B = require('../B.js');
const config = require('../config.json');

const {
    getWords,
    getInventory,
    getRandomInt,
    chance,
    getRandomElement,
    hasDuplicates
} = require('../util.js');

const disabled = [
];

const enabled = [
    new B(async ({ message, db }) => { // haiku
        const ref = await db
            .collection('state')
            .doc('recentSyllables')
            .get();
        if (!ref.exists) {
            db.collection('state')
                .doc('recentSyllables')
                .set({ arr: [0, 0, 0] });
            return false;
        }

        const previous = ref.data().arr;
        const recentSyllables = [
            previous[1],
            previous[2],
            syllable(message)
        ];
        db.collection('state')
            .doc('recentSyllables')
            .set({ arr: recentSyllables });
        
        return recentSyllables[0] === 5 &&
            recentSyllables[1] === 7 &&
            recentSyllables[2] === 5;
    }, async ({ message }) => {
        message.channel.send('Was that a haiku?');
    }),

    new B(async ({ message }) => { // receiving items
        const regex = /([_\*]gives bucket (.+)[_\*])|([_\*]puts (.+) in bucket([^a-zA-Z].*)[_\*]?)|([_\*]gives (.+) to bucket([^a-zA-Z].*)[_\*]?)/i;
        const groups = regex.exec(message.content);
        return groups && groups.filter(x => x);
    }, async ({ message, db }, groups) => {
        // groups[2] is the item
        const item = groups[2];
        const inventory = await getInventory();
        if (inventory.some(x => x.name === item)) {
            message.channel.send("No thanks, I've already got that");
            return;
        }

        let give;
        if (inventory.length >= config.inventorySize * 2 ||
            (inventory.length >= config.inventorySize && chance(50))) {
            give = getRandomElement(inventory);
        }

        let giveStr = give ? `${chance(50) ? 'drops' : `gives ${user.username}`} ${give.name} and ` : '';
        let str = '*'
            + giveStr
            + getRandomElement(['now contains', 'is now carrying', 'is now holding'])
            + ` ${item}*`;
        message.channel.send(str);

        db.collection('items')
            .doc(item)
            .set({ name: item, user: { id: user.id, username: user.username } });

        if (give) {
            db.collection('items')
                .doc(give.name)
                .delete();
        }
    }),
    
    new B(async ({ message }) => message.match(/^(\*uses .+\*|_uses .+_)$/i), // pokemon attack
    async ({ message }) => {
		switch (getRandomInt(1, 4)) {
			case 1:
				message.channel.send('It has no effect.');
				break;
			case 2:
				message.channel.send("It's not very effective.");
				break;
			case 3:
				message.channel.send('It hits!');
				break;
			case 4:
				message.channel.send("It's super effective!");
				break;
		}
    }),

    new B(async ({ message }) => message.content.match(/^say (.+)/i, // say blah => blah
        async ({ message }, matches) => message.channel.send(matches[1]))),

    new B(async ({ message }) => /^buckety bucket$/i.test(message.content),
    async ({ message }) => {
        const user = message.author;
        message.channel.send(`${user.username}ity ${user.username}`);
    }),

    new B(async ({ message }) => { // 3-word tumblr
        const words = getWords(message.content);
        return words.length === 3 && !hasDuplicates(words) && words;
    }, async ({ message }, words) => message.channel.send(`https://${words.join('')}.tumblr.com`)),
    
    new B(async ({ message }) => { // good band name
        const words = getWords(message.content);
        return words.length === 3 && !hasDuplicates(words) && words;
    }, async ({ message, db }, words) => {
        // "[<phrase>|that] would [make|be] a [good|nice] name for a band."
		//made up a % chance to trigger - XCKD Bucket does something more complex
		const bandName = words.map(x => x[0].toUpperCase() + x.substring(1).toLowerCase()).join(' ');
		const tla = words.map(x => x[0].toUpperCase()).join('');
		const out =
			(chance(50) ? bandName : 'That') +
			' would ' +
			(chance(50) ? 'make' : 'be') +
			' a ' +
			(chance(50) ? 'good' : 'nice') +
			' name for a ' +
			(chance(50) ? 'rock ' : '') +
			'band.';
		message.channel.send(out);

		db.collection('bands')
			.doc(uuid())
			.set({ name: bandName, acronym: tla });
    }),
    
    new B(async ({ message, db }) => { // three-letter acronym
        const words = getWords(message.content);
        const TLA = words.find(x => x.length === 3 && x === x.toUpperCase());
        if (!TLA) return false;
        const bands = await db
            .collection('bands')
            .where('acronym', '==', TLA)
            .get();
        return !bands.empty && { TLA, bands };
    }, async ({ message }, { TLA, bands }) => {
        // "<TLA> could mean <bandName>"
        const meaning = getRandomElement(bands.docs).data().name;
        message.channel.send(`${TLA} could mean ${meaning}`);
    }),
];

module.exports = enabled;