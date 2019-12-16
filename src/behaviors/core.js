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
    new B('core:haiku', async ({ message, db }) => {
        const ref = await db
            .collection('state')
            .doc('recentSyllables')
            .get();
        if (!ref.exists) {
            db.collection('state')
                .doc('recentSyllables')
                .set({ arr: [0, 0, syllable(message.content)] });
            return false;
        }

        const previous = ref.data().arr;
        const recentSyllables = [
            previous[1],
            previous[2],
            syllable(message.content)
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

    new B('core:receive-item', async ({ message }) => {
        const regex = /([_\*]gives bucket (.+)[_\*])|([_\*]puts (.+) in bucket([^a-zA-Z].*)[_\*]?)|([_\*]gives (.+) to bucket([^a-zA-Z].*)[_\*]?)/i;
        const groups = regex.exec(message.content);
        return groups && groups.filter(x => x);
    }, async ({ message, db }, groups) => {
        // groups[2] is the item
        const item = groups[2];
        const inventory = await getInventory(db);
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
            .set({ name: item, user: { id: message.author.id, username: message.author.username } });

        if (give) {
            db.collection('items')
                .doc(give.name)
                .delete();
        }
    }),
    
    new B('core:pokemon-attack', async ({ message }) => message.content.match(/^(\*uses .+\*|_uses .+_)$/i),
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

    new B('core:say-literal', async ({ message }) => message.content.match(/^say (.+)/i,
        async ({ message }, matches) => message.channel.send(matches[1]))),

    new B('core:buckety-bucket', async ({ message }) => /^buckety bucket$/i.test(message.content),
    async ({ message }) => {
        const user = message.author;
        message.channel.send(`${user.username}ity ${user.username}`);
    }),

    new B('core:3-word-tumblr', async ({ message }) => {
        const words = getWords(message.content);
        return words.length === 3 && !hasDuplicates(words) && words;
    }, async ({ message }, words) => message.channel.send(`https://${words.join('')}.tumblr.com`)),
    
    new B('core:good-band-name', async ({ message }) => {
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
    
    new B('core:three-letter-acronym', async ({ message, db }) => {
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