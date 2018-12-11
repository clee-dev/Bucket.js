const Discord = require('discord.js');
var Filter = require('bad-words');
const admin = require('firebase-admin');
var syllable = require('syllable');
const uuid = require('uuid/v4');

const secrets = require('./secrets.json');
const serviceAccount = require('./serviceaccount_key.json');
const config = require('./config.json');

const client = new Discord.Client();
var filter = new Filter();
admin.initializeApp({
	credential: admin.credential.cert(serviceAccount),
	//credential: admin.credential.applicationDefault(), //when deployed to GCP
	databaseURL: secrets.dbUrl,
});
var db = admin.firestore();

client.on('ready', () => {
	console.log(`Logged in as ${client.user.tag}!`);
});

client.on('message', msg => {
	messageReceived(msg);
});

client.login(secrets.bucketToken);

const regex = {
	punct: /[\?!.;'"():]+/gm,
	punctNoApostrophe: /[\?!.; "():]+/gm,
	punctSpace: /[^\w]+/gm,
};
const vagueResponses = [
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
	'\\o/',
];

var memory = {
	recentSyllables: [0, 0, 0],
	lastFactoid: {},
};
var state = {
	silenced: false,
};

async function messageReceived(message) {
	if (!message.guild) return; //no DMs

	let user = message.author;
	let channel = message.channel;
	let lower = message.content.toLowerCase();
	let words = lower.split(regex.punctSpace).filter(x => x);

	if (config.debug && !secrets.channels[channel.name]) return; //!secrets.admins[user.username]) return;
	if (message.author.id === client.user.id) return;

	//if I haven't seen this user before, add them to my database
	db.collection('users')
		.doc(user.id)
		.set({ name: user.username });

	//check if mentioned
	//"@Bucket *" || "bucket,*" || "bucket:*" || "*, bucket" || "*,bucket"
	if (
		message.isMentioned(client.user) ||
		lower.startsWith('bucket,') ||
		lower.startsWith('bucket:') ||
		lower.endsWith(', bucket') ||
		lower.endsWith(',bucket')
	) {
		mentionedBy(message);
		return;
	}

	learn(words);

	if (state.silenced) return;

	//haiku
	{
		memory.recentSyllables[0] = memory.recentSyllables[1];
		memory.recentSyllables[1] = memory.recentSyllables[2];
		memory.recentSyllables[2] = syllable(message);

		if (memory.recentSyllables[0] == 5 && memory.recentSyllables[1] == 7 && memory.recentSyllables[2] == 5) {
			channel.send('Was that a haiku?');
			return;
		}
	}

	//RECEIVING ITEMS
	let itemDetection = /([_\*]gives bucket (.+)[_\*])|([_\*]puts (.+) in bucket([^a-zA-Z].*)[_\*]?)|([_\*]gives (.+) to bucket([^a-zA-Z].*)[_\*]?)/g;
	let groups = itemDetection.exec(lower);
	if (groups) groups = groups.filter(x => x); //boil down to non-empty capture groups

	//groups[2] is the capture group for the item given to Bucket
	if (groups && groups.length >= 3) {
		let item = groups[2];

		let inventory = await getInventory();
		if (inventory.some(x => x.name === item)) {
			channel.send("No thanks, I've already got that");
		} else {
			let give;
			if (inventory.length >= config.inventorySize) {
				give = getRandomElement(inventory);
			}

			let str;
			let giveStr = give
				? `${getRandomInt(0, 1) === 0 ? 'drops' : `gives ${user.username}`} ${give.name} and `
				: '';
			switch (getRandomInt(0, 2)) {
				case 0:
					str = '*' + giveStr + `now contains ${item}*`;
					break;
				case 1:
					str = '*' + giveStr + `is now carrying ${item}*`;
					break;
				case 2:
					str = '*' + giveStr + `is now holding ${item}*`;
					break;
			}
			channel.send(str);
			expUp(message, (sayAnything = true), (largeGain = false));

			db.collection('items')
				.doc(item)
				.set({ name: item, user: { id: user.id, username: user.username } });
		}

		return;
	}

	//FACTOIDS

	let matchingFactoids = await detectedFactoids(lower);
	if (matchingFactoids.length) {
		let f = getRandomElement(matchingFactoids);
		if (f === state.lastFactoid && matchingFactoids.length >= 2) f = getRandomElement(matchingFactoids);

		if (matchingFactoids.length) {
			processFactoid(f, message);
			return;
		}
	}
	0;

	//SWAPS
	{
		//EX -> SEX
		if (words.some(x => x.startsWith('ex')) && chance(20)) {
			channel.send(message.content.replace('ex', 'sex').replace('Ex', 'Sex'));
			return;
		}

		//ELECT -> ERECT
		if (words.some(x => x.startsWith('elect')) && chance(20)) {
			channel.send(message.content.replace('elect', 'erect').replace('Elect', 'Erect'));
			return;
		}

		//*USES X*
		if (
			(lower.startsWith('*uses ') || lower.startsWith('_uses ')) &&
			(lower.endsWith('*') || lower.endsWith('_'))
		) {
			switch (getRandomInt(1, 4)) {
				case 1:
					channel.send('It has no effect.');
					break;
				case 2:
					channel.send("It's not very effective.");
					break;
				case 3:
					channel.send('It hits!');
					break;
				case 4:
					channel.send("It's super effective!");
					break;
			}
			return;
		}

		//THE FUCKING -> FUCKING THE
		if (lower.includes('the fucking')) {
			channel.send(message.content.replace('the fucking', 'fucking the'));
			return;
		}

		//THIS FUCKING -> FUCKING THIS
		if (lower.includes('this fucking')) {
			channel.send(message.content.replace('this fucking', 'fucking this'));
			return;
		}

		//IDEA -> IDEAL (30% CHANCE)
		if (words.some(x => x === 'idea') && chance(30)) {
			channel.send(message.content.replace('idea', 'ideal').replace('Idea', 'Ideal'));
			return;
		}

		//sarcasm -> SArcAsM (3% CHANCE)
		if (words.length < 6 && chance(3)) {
			let out = '';
			for (var c of lower) {
				switch (getRandomInt(1, 2)) {
					case 1:
						out += c.toUpperCase();
						break;
					case 2:
						out += c.toLowerCase();
						break;
				}
			}
			channel.send(out);
			return;
		}
	}

	//SAY ABCD -> ABCD
	if (words[0] === 'say') {
		let s = lower.substring(lower.indexOf(' ') + 1);
		channel.send(s);
		return;
	}

	//ANY WORD SYLLABLES >= 3 (3% CHANCE) -> "FE FI FO"
	if (words.some(x => syllable(x) >= 3) && chance(3)) {
		let word = words.find(x => syllable(x) >= 3);
		let sub = '';
		let sub2 = '';
		let first = false;
		for (let i = 1; i < word.length; i++) {
			if (!'aeiouAEIOU'.includes(word[i]) && !first) {
				sub = word.substring(i);
				first = true;
			} else if (!'aeiouAEIOU'.includes(word[i]) && first) {
				sub2 = word.substring(i + 1);
				break;
			}
		}

		channel.send(`${word} bo${sub}, fe fi fo f${sub2}, ${word}!`);
		return;
	}

	//SWEARJAR
	if (filter.isProfane(lower)) {
		//*takes a quarter | dime from ${user} and puts it in the swear jar*
		let coin = getRandomElement([{ name: 'quarter', value: 0.25 }, { name: 'dime', value: 0.1 }]);
		incrementDocField(db.collection('swearjar').doc(user.id), 'total', coin.value);
		channel.send(`*takes a ${coin.name} from ${user.username} and puts it in the swear jar*`);
		return;
	}

	return; //move further down as more functions are completed

	//TLA
	//"<TLA> could mean <band_name>"
	{
		return;
	}

	//GOOD BAND NAME
	//"<phrase> would be a good name for a band."
	{
		return;
	}

	//GOOD ANIME NAME
	//"<phrase> would be a good name for an anime."
	{
		return;
	}

	//GENERATE MARKOV SENTENCE
	{
		return;
	}

	//EXP
	{
		return;
	}
}

//"@Bucket *" || "bucket,*" || "bucket:*" || "*, bucket" || "*,bucket"
async function mentionedBy(message) {
	let user = message.author;
	let channel = message.channel;
	let lower = message.content.toLowerCase();
	if (lower.startsWith('bucket') || lower.startsWith(`<@${client.user.id}>`))
		lower = lower.substring(lower.indexOf(' ') + 1);
	else lower = lower.substring(0, lower.lastIndexOf(', bucket'));

	let words = lower.split(regex.punctSpace).filter(x => x);

	//ADMIN FUNCTIONS
	if (secrets.admin[user.username]) {
		if (lower === 'inventory?') {
			let out = '';
			let inventory = await getInventory();
			inventory.forEach(item => {
				if (item.name.startsWith('his') || item.name.startsWith('her'))
					out += `${item.user.username}'s ${item.name.substring(4)}, `;
				else out += item.name + ', ';
			});
			out = out === '' ? "I don't have anything :(" : out.substring(0, out.length - 2);
			channel.send(out);
			return;
		}
	}

	if (words.length < 2 && lower[0] !== '`') {
		channel.send(convertVars(message, getRandomElement(vagueResponses)));
		return;
	}

	if (lower.replace(regex.punct, '') === 'come back' && state.silenced) {
		state.silenced = false;
		channel.send('\\o/');
		return;
	}

	if (state.silenced) return;

	if (lower.startsWith('shut up')) {
		let timeout = lower.endsWith('for a bit')
			? 5 * 60 * 1000 //5min
			: lower.endsWith('for a min') || lower.endsWith('for a minute')
			? 1 * 60 * 1000 //1min
			: 30 * 60 * 1000; //30min

		state.silenced = true;
		channel.send('Okay');

		setTimeout(() => {
			state.silenced = false;
		}, timeout); //30min
		return;
	}

	return; //move further down as more functions are completed

	if (lower === 'undo last' && secrets.admins[user.username] /*|| state.lastFactoid.user === user.id*/) {
		//forget last-LEARNED factoid
		channel.send(`Okay, ${user.username}, forgetting ${factoid.x} <${factoid.mid}> ${factoid.y}`);
		expDown(message, (sayAnything = true), getRandomInt(0, 1) === 0);
		return;
	}

	if (
		(lower === 'what was that' ||
			(lower.startsWith('what was that') && lower.length === 'what was that'.length + 1)) &&
		secrets.admins[user.username] /*|| state.lastFactoid.user === user.id*/
	) {
		//describe last-ACTIVATED factoid
		channel.send(`That was: ${factoid.x} <${factoid.mid}> ${factoid.y}`);
		return;
	}

	if (
		(lower === 'forget that' || (lower.startsWith('forget that') && lower.length === 'forget that'.length + 1)) &&
		secrets.admins[user.username] /*|| state.lastFactoid.user === user.id*/
	) {
		//forget last-ACTIVATED factoid
		channel.send(`Okay, ${user.username}, forgetting ${factoid.x} <${factoid.mid}> ${factoid.y}`);
		expDown(message, (sayAnything = true), getRandomInt(0, 1) === 0);
		return;
	}

	if (words.some(x => x.startsWith('<') && x.endsWith('>'))) {
		return;
	}

	if (words.length >= 2) {
		return;
	}

	if (lower.startsWith('do you know')) {
		channel.send('No, but if you hum a few bars I can fake it.');
		return;
	}

	let matchingFactoids = await detectedFactoids(lower);
	if (matchingFactoids.length) {
		let f = getRandomElement(matchingFactoids);
		if (f === state.lastFactoid && matchingFactoids.length >= 2) f = getRandomElement(matchingFactoids);

		if (matchingFactoids.length) {
			processFactoid(f, message);
			return;
		}
		return;
	}

	if (lower.includes(' or ')) {
		if (lower.startsWith('should i') || lower.startsWith('should we')) {
			lower = lower.substring(7);
			lower = lower.substring(lower.indexOf(' ') + 1);
		}
		lower = lower.replace(regex.punct, '');
		let X = lower.substring(0, lower.indexOf(' or '));
		let Y = lower.substring(lower.indexOf(' or ') + 4);
		let arr = [X, Y];
		channel.send(getRandomElement(arr));
		return;
	}

	channel.send(convertVars(message, getRandomElement(vagueResponses)));
}

async function learn(words) {
	words = words.filter(x => x);
	if (words.length < 3) return;
	let len = words.length - 2;

	for (let i = 0; i < len; i++) {
		let docRef = db
			.collection('words')
			.doc(words[i])
			.collection(words[i + 1])
			.doc(words[i + 2]);
		incrementDocField(docRef, 'count', 1);
	}
}

function expUp(sourceMessage, sayAnything = true, largeGain = false) {}

function expDown(sourceMessage, sayAnything = true, largeLoss = false) {}

function convertVars(contextMessage, source) {
	return source
		.replace(/\$who/g, contextMessage.author.username)
		.replace(/\$someone/g, getRandomElement(getUsersFromGuild(contextMessage.guild).map(x => x.username)))
		.replace(/\$@someone/g, `<@${getRandomElement(getUsersFromGuild(contextMessage.guild).map(x => x.id))}>`);
}

async function detectedFactoids(msg) {
	let factoids = await db.collection('factoids').get();
	let matches = [];
	if (!factoids.empty) {
		factoids = factoids.docs.map(f => f.data()).filter(f => msg.includes(f.X));
		factoids.forEach(f => {
			let r = new RegExp(
				'(?<!\\w)(' +
					escapeRegExp(
						f.X.startsWith('_') ? f.X.substring(1, f.X.length - 1).toLowerCase() : f.X.toLowerCase()
					) +
					')(?!\\w)'
			);

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

function processFactoid(factoid, message) {
	let channel = message.channel;
	let x = factoid.X;
	let mid = factoid.Middle;
	let y = factoid.Y;

	//remove starting _ or ^
	//TODO: Figure out what the "^" prefix does. Case-sensitivity maybe?
	switch (factoid.Middle.replace(/^[\^\_]/g, '')) {
		case "'s":
			channel.send(`${x}'s ${convertVars(message, y)}`);
			break;
		case 'reply':
			channel.send(`${convertVars(message, y)}`);
			break;
		case 'action':
			channel.send(`*${convertVars(message, y)}*`);
			break;
		case 'is':
		case 'are':
		default:
			channel.send(`${x} ${mid} ${convertVars(message, y)}`);
			break;
	}
	state.lastFactoid = factoid;
}

async function getInventory() {
	let inventory = [];
	let invRef = db.collection('items');
	let invGet = await invRef.get();
	for (item of invGet.docs) {
		inventory.push(item.data());
	}
	return inventory;
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
	return i <= percentage;
}

function getRandomElement(arr) {
	return arr[Math.floor(Math.random() * arr.length)];
}
