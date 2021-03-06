const uuid = require('uuid/v4');
const admin = require('firebase-admin');
const validUrl = require('valid-url');

const regex = {
	punct: /[\?!.;'"():]+/gm,
	punctNoApostrophe: /[\?!.; "():]+/gm,
	words: /[^\w'-<>]+/gm,
};

function getWords(s) {
	return s
		.split(' ')
		.filter(x => !validUrl.isUri(x))
		.join(' ')
		.split(regex.words)
		.filter(x => x);
}

function filterNonWords(s) {
	return getWords(s).join(' ');
}

function respondVaguely(sourceMessage) {
	sourceMessage.channel.send(convertVars(sourceMessage, getRandomElement([
        'Error 42: No such factoid. Please contact administrator of current universe',
        '¯\\\\(°_o)/¯', //Discord escapes \, so I need to doublescape
        'Beeeeeeeeeeeeep!',
        'What?',
        "I don't understand",
        'Can you figure out a way to say that in English?',
        'Whatever you say',
        'No',
        'Uh...',
        "I'm confused",
        '*quietly disposes of $who*',
        '*looks away*',
        'I do not know',
        "Can't talk, zombies!",
        'That is not an Uluru correction',
        'Huh?',
        "I'm not sure what you mean",
        '\\\\o/',
    ])));
}

async function getFactoid(x, mid, y, db) {
	let f = await db
		.collection('factoids')
		.where('X', '==', x)
		.where('Middle', '==', mid)
		.where('Y', '==', y)
		.get();
	if (!f.empty) {
		let r = f.docs[0].data();
		r.id = f.docs[0].id;
		return r;
	} else return undefined;
}

async function learnNewFactoid(x, mid, y, message, db) {
	const user = message.author;
	const channel = message.channel;
	let known = await getFactoid(x, mid, y, db);

	if (known) {
		channel.send(`I already do that, ${user.username}`);
	} else {
		let id = uuid();
		await db
			.collection('factoids')
			.doc(id)
			.set({
				X: x,
				Middle: mid,
				Y: y,
				user: { id: user.id, username: user.username },
			});
		setLastLearnedFactoid(id, db);
		channel.send(`Okay, ${user.username}${chance(50) ? ", I'll remember that." : ''}`);
	}
}

async function unlearnFactoid(x, mid, y, db) {
	let f = await getFactoid(x, mid, y, db);
	if (f) {
		await db
			.collection('factoids')
			.doc(f.id)
			.delete();
	}
}

async function getSilencedState(db) {
	let r = await db
		.collection('state')
		.doc('silenced')
		.get();
	if (r.exists) {
		return r.data().value;
	} else return false;
}

async function setSilencedState(bool, db) {
	await db
		.collection('state')
		.doc('silenced')
		.set({ value: bool });
}

function expUp(sourceMessage, sayAnything = true, largeGain = false) {}

function expDown(sourceMessage, sayAnything = true, largeLoss = false) {}

function convertVars(contextMessage, source) {
	return source
		.replace(/\$who/g, contextMessage.author.username)
		.replace(/\$someone/g, getRandomElement(getUsersFromGuild(contextMessage.guild).map(x => x.username)))
		.replace(/\$@someone/g, `<@${getRandomElement(getUsersFromGuild(contextMessage.guild).map(x => x.id))}>`);
}

async function detectedFactoids(msg, db) {
	let factoids = await db.collection('factoids').get();
	let matches = [];
	if (!factoids.empty) {
		factoids = factoids.docs
			.map(f => {
				let x = f.data();
				x.id = f.id;
				return x;
			})
			.filter(f => msg.includes(f.X));
		factoids.forEach(f => {
			let mid = escapeRegExp(
				f.X.startsWith('_') ? f.X.substring(1, f.X.length - 1).toLowerCase() : f.X.toLowerCase()
			);
			let r = /(_?)swap/.test(f.Middle) //'swap' or '_swap'
				? new RegExp(mid)
				: new RegExp('(?<!\\w)' + mid + '(?!\\w)');

			//X <_Middle> Y triggers if the entire message is X
			//X <Middle> Y triggers if the message contains X
			if ((!f.Middle.startsWith('_') && r.test(msg)) || (f.Middle.startsWith('_') && msg === f.X.toLowerCase()))
				matches.push(f);
		});
	}
	return matches;
}

function escapeRegExp(string) {
	return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
}

async function processFactoid(matchingFactoids, message, db) {
	const middleRegex = /^[\^\_]/g;
	if (!chance(1)) matchingFactoids = matchingFactoids.filter(x => x.Middle.replace(middleRegex, '') !== 'swap');
	// TODO figure out why the above line exists and why it's a 99% CHANCE???

	const lastFactoid = await getLastFactoidData(db);

	const factoid = getRandomElement(matchingFactoids);
	if (factoid === lastFactoid && matchingFactoids.length >= 2) factoid = getRandomElement(matchingFactoids); //this could be done better

	const channel = message.channel;
	const x = factoid.X;
	const mid = factoid.Middle;
	const y = factoid.Y;

	//remove starting _ or ^
	//TODO: Figure out what the "^" prefix does. Case-sensitivity maybe?
	switch (factoid.Middle.replace(middleRegex, '')) {
		case "'s":
			channel.send(`${x}'s ${convertVars(message, y)}`);
			setLastFactoid(factoid.id, db);
			break;
		case 'reply':
			channel.send(`${convertVars(message, y)}`);
			setLastFactoid(factoid.id, db);
			break;
		case 'action':
			channel.send(`*${convertVars(message, y)}*`);
			setLastFactoid(factoid.id, db);
			break;
		case 'swap':
			let r = new RegExp(escapeRegExp(x), 'gi');
			channel.send(`${message.content.replace(r, convertVars(message, y))}`);
			setLastFactoid(factoid.id, db);
			break;
		case 'is':
		case 'are':
		default:
			channel.send(`${x} ${mid} ${convertVars(message, y)}`);
			setLastFactoid(factoid.id, db);
			break;
	}
}

async function getInventory(db) {
	let inventory = [];
	let invRef = db.collection('items');
	let invGet = await invRef.get();
	for (item of invGet.docs) {
		inventory.push(item.data());
	}
	return inventory;
}

//returns a reference
async function getLastFactoid(db) {
	let f = await db
		.collection('state')
		.doc('lastFactoid')
		.get();
	if (f.exists) return await db.collection('factoids').doc(f.data().id);
	else return undefined;
}
async function getLastFactoidData(db) {
	let f = await getLastFactoid(db);
	if (f) {
		try {
			let x = await f.get();
			let r = x.data();
			r.id = x.id;
			return r;
		} catch {
			return undefined; //lastFactoid (last-activated) can be a factoid that no longer exists if Bucket was told to forget it
		}
	} else return undefined;
}

async function setLastFactoid(id, db) {
	await db
		.collection('state')
		.doc('lastFactoid')
		.set({ id: id });
}

//returns a reference
async function getLastLearnedFactoid(db) {
	let f = await db
		.collection('state')
		.doc('lastLearnedFactoid')
		.get();
	if (f.exists) return await db.collection('factoids').doc(f.data().id);
	else return undefined;
}
async function getLastLearnedFactoidData(db) {
	let f = await getLastLearnedFactoid(db);
	if (f) {
		try {
			let x = await f.get();
			let r = x.data();
			r.id = x.id;
			return r;
		} catch {
			return undefined; //lastLearnedFactoid could be nonexistent
		}
	} else return undefined;
}

async function setLastLearnedFactoid(id, db) {
	await db
		.collection('state')
		.doc('lastLearnedFactoid')
		.set({ id: id });
}

async function incrementDocField(docRef, field, increment) {
	let doc = await docRef.get();
	let set = {};
	set[field] = (doc.exists ? doc.data()[field] : 0) + increment;
	docRef.set(set, { merge: true });
}

function getUsersFromGuild(guild) {
	return Array.from(guild.members, ([k, v]) => v).map(x => x.user);
}

/**
 * Returns a random integer between min (inclusive) and max (inclusive).
 * The value is no lower than min (or the next integer greater than min
 * if min isn't an integer) and no greater than max (or the next integer
 * lower than max if max isn't an integer).
 * Using Math.round() will give you a non-uniform distribution!
 */
function getRandomInt(min, max) {
	min = Math.ceil(min);
	max = Math.floor(max);
	return Math.floor(Math.random() * (max - min + 1)) + min;
}

function chance(percentage) {
	let i = getRandomInt(1, 100);
	return percentage === 100 || i <= percentage;
}

function getRandomElement(arr) {
	return arr[Math.floor(Math.random() * arr.length)];
}

// https://stackoverflow.com/questions/7376598/in-javascript-how-do-i-check-if-an-array-has-duplicate-values
function hasDuplicates(array) {
	return new Set(array).size !== array.length;
}

module.exports = {
    getWords,
    filterNonWords,
    respondVaguely,
    learnNewFactoid,
    unlearnFactoid,
    getSilencedState,
    setSilencedState,
    expUp,
    expDown,
    convertVars,
    detectedFactoids,
    escapeRegExp,
    processFactoid,
    getInventory,
    getLastFactoid,
    getLastFactoidData,
    setLastFactoid,
    getLastLearnedFactoid,
    getLastLearnedFactoidData,
    setLastLearnedFactoid,
    incrementDocField,
    getUsersFromGuild,
    getRandomInt,
    chance,
    getRandomElement,
    hasDuplicates
};