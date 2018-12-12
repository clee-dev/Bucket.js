/*
	Copyright (C) 2018  Cody Lee

	This program is free software: you can redistribute it and/or modify
	it under the terms of the GNU General Public License as published by
	the Free Software Foundation, either version 3 of the License, or
	(at your option) any later version.

	This program is distributed in the hope that it will be useful,
	but WITHOUT ANY WARRANTY; without even the implied warranty of
	MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
	GNU General Public License for more details.

	You should have received a copy of the GNU General Public License
	along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

const Discord = require('discord.js');
var Filter = require('bad-words');
const admin = require('firebase-admin');
var syllable = require('syllable');
const uuid = require('uuid/v4');

const secrets = require('./secrets.json');
//const serviceAccount = require('./serviceaccount_key.json'); //uncomment for local testing
const config = require('./config.json');

const client = new Discord.Client();
var filter = new Filter();
admin.initializeApp({
	// credential: admin.credential.cert(serviceAccount), //uncomment for local testing
	credential: admin.credential.applicationDefault(), //when deployed to GCP - comment for local testing
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
	punctSpace: /[\?!.; '"():]+/gm, // /[^\w]+/gm,
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

	let silenced = await getSilencedState();
	if (silenced) return;

	//haiku
	{
		let ref = await db
			.collection('state')
			.doc('recentSyllables')
			.get();
		if (ref.exists) {
			let recentSyllables = ref.data().arr;
			recentSyllables[0] = recentSyllables[1];
			recentSyllables[1] = recentSyllables[2];
			recentSyllables[2] = syllable(message);

			db.collection('state')
				.doc('recentSyllables')
				.set({ arr: recentSyllables });

			if (recentSyllables[0] == 5 && recentSyllables[1] == 7 && recentSyllables[2] == 5) {
				channel.send('Was that a haiku?');
				return;
			}
		} else {
			db.collection('state')
				.doc('recentSyllables')
				.set({ arr: [0, 0, 0] });
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
		let lastFactoid = await getLastFactoidData();
		let f = getRandomElement(matchingFactoids);
		if (f === lastFactoid && matchingFactoids.length >= 2) f = getRandomElement(matchingFactoids);

		if (matchingFactoids.length) {
			processFactoid(f, message);
			return;
		}
	}

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
			let sarcastic = client.emojis.find(emoji => emoji.name === 'sarcastic');
			channel.send(
				Array.from(lower)
					.map(x => (getRandomInt(1, 2) === 1 ? x.toUpperCase() : x.toLowerCase()))
					.join('') + sarcastic ? ` ${sarcastic}` : ''
			);
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

	let content = message.content;
	if (content.startsWith('bucket') || content.startsWith(`<@${client.user.id}>`))
		content = content.substring(content.indexOf(' ') + 1);
	else content = content.substring(0, content.lastIndexOf(', bucket'));

	let lower = content.toLowerCase();
	let words = lower.split(regex.punctSpace).filter(x => x);

	let silenced = await getSilencedState();

	//ADMIN FUNCTIONS
	if (secrets.admins[user.username]) {
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

	if (lower.replace(regex.punct, '') === 'come back' && silenced) {
		setSilencedState(false);
		channel.send('\\o/');
		return;
	}

	if (silenced) return;

	if (lower.startsWith('shut up')) {
		let timeout = lower.endsWith('for a bit')
			? 5 * 60 * 1000 //5min
			: lower.endsWith('for a min') || lower.endsWith('for a minute')
			? 1 * 60 * 1000 //1min
			: 30 * 60 * 1000; //30min

		setSilencedState(true);
		channel.send('Okay');

		setTimeout(() => {
			setSilencedState(false);
		}, timeout); //30min
		return;
	}

	//forget last-LEARNED factoid
	if (lower === 'undo last') {
		let last = await getLastLearnedFactoidData();
		if (last && (secrets.admins[user.username] || last.user.id === user.id)) {
			await unlearnFactoid(last.X, last.Middle, last.Y);
			db.collection('state')
				.doc('lastLearnedFactoid')
				.delete();

			channel.send(`Okay, ${user.username}, forgetting ${last.X} <${last.Middle}> ${last.Y}`);
			expDown(message, (sayAnything = true), getRandomInt(0, 1) === 0);
			return;
		}
	}

	//describe last-ACTIVATED factoid
	if (
		lower === 'what was that' ||
		(lower.startsWith('what was that') && lower.length === 'what was that'.length + 1)
	) {
		/*|| state.lastFactoid.user === user.id*/
		let factoid = await getLastFactoidData();
		if (factoid && (secrets.admins[user.username] || factoid.user.id === user.id)) {
			channel.send(`That was: ${factoid.X} <${factoid.Middle}> ${factoid.Y}`);
			return;
		}
	}

	//forget last-ACTIVATED factoid
	if (lower === 'forget that' || (lower.startsWith('forget that') && lower.length === 'forget that'.length + 1)) {
		let last = await getLastFactoidData();
		if (last && (secrets.admins[user.username] || factoid.user.id === user.id)) {
			await unlearnFactoid(last.X, last.Middle, last.Y);
			db.collection('state')
				.doc('lastFactoid')
				.delete();

			channel.send(`Okay, ${user.username}, forgetting ${last.X} <${last.Middle}> ${last.Y}`);
			expDown(message, (sayAnything = true), getRandomInt(0, 1) === 0);
			return;
		}
	}

	//being taught a factoid
	if (words.some(x => x.startsWith('<') && x.endsWith('>'))) {
		let div = words.find(w => w.startsWith('<') && w.endsWith('>'));
		div = div.substring(1, div.length - 1); //remove < >
		if (!div.startsWith('@')) {
			//discord mentions look like <@userid>
			let x = lower.substring(0, lower.indexOf(div) - 2).trim();
			let mid = div.trim();
			let y = content.substring(lower.indexOf(div) + div.length + 2).trim();

			learnNewFactoid(x, mid, y, user, channel);
		}
		return;
	}

	//being taught short factoids
	if (words.length >= 2) {
		if (words[1] === 'is' || words[1] === 'are') {
			learnNewFactoid(
				words[0],
				words[1],
				lower.substring(lower.indexOf(words[1]) + words[1].length + 1),
				user,
				channel
			);
			return;
		}

		if (words[1] === 'quotes') {
			let name = words[0];
			let quotes = await db
				.collection('quotes')
				.where('username', '==', name)
				.get();
			if (!quotes.empty) {
				let quote = getRandomElement(quotes.docs).data().quote;
				channel.send(`${name}: ${quote}`);
				return;
			} else channel.send(`I don't have any quotes for ${name}`);
		}

		if (words[0] === 'remember') {
			let user = Array.from(client.users)
				.map(x => x[1])
				.find(x => x.username.toLowerCase() === words[1]);
			if (user) {
				let messages = await channel.fetchMessages({ limit: 50 });
				messages = Array.from(messages)
					.map(x => x[1])
					.filter(x => x.id !== message.id)
					.filter(x => x.author.id === user.id)
					.filter(x =>
						x.content
							.toLowerCase()
							.includes(content.substring(content.indexOf(words[1]) + words[1].length + 1).toLowerCase())
					);

				if (messages.length) {
					let remember = messages[0].content;
					channel.send(`Okay, remembering ${user.username} said ${remember}`);
					db.collection('quotes')
						.doc(uuid())
						.set({ username: user.username, quote: remember });
					return;
				}
			}
		}
	}

	if (lower.startsWith('do you know')) {
		channel.send('No, but if you hum a few bars I can fake it.');
		return;
	}

	//process factoid
	let matchingFactoids = await detectedFactoids(lower);
	if (matchingFactoids.length) {
		let lastFactoid = await getLastFactoidData();
		let f = getRandomElement(matchingFactoids);
		if (f === lastFactoid && matchingFactoids.length >= 2) f = getRandomElement(matchingFactoids);

		if (matchingFactoids.length) {
			processFactoid(f, message);
			return;
		}
		return;
	}

	//"this or that?"
	if (lower.includes(' or ')) {
		if (lower.startsWith('should i') || lower.startsWith('should we')) {
			lower = lower.substring(7);
			lower = lower.substring(lower.indexOf(' ') + 1);
		}
		lower = lower.replace(regex.punct, '');
		let X = lower.substring(0, lower.indexOf(' or '));
		let Y = lower.substring(lower.indexOf(' or ') + 4);
		channel.send(getRandomElement([X, Y]));
		return;
	}

	channel.send(convertVars(message, getRandomElement(vagueResponses)));
}

async function getFactoid(x, mid, y) {
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

async function learnNewFactoid(x, mid, y, user, channel) {
	let known = await getFactoid(x, mid, y);

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
		setLastLearnedFactoid(id);
		channel.send(`Okay, ${user.username}${getRandomInt(1, 2) === 1 ? ", I'll remember that." : ''}`);
	}
}

async function unlearnFactoid(x, mid, y) {
	let f = await getFactoid(x, mid, y);
	if (f) {
		await db
			.collection('factoids')
			.doc(f.id)
			.delete();
	}
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

async function getSilencedState() {
	let r = await db
		.collection('state')
		.doc('silenced')
		.get();
	if (r.exists) {
		return r.data().value;
	} else return false;
}

async function setSilencedState(bool) {
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

async function detectedFactoids(msg) {
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
	setLastFactoid(factoid.id);
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

//returns a reference
async function getLastFactoid() {
	let f = await db
		.collection('state')
		.doc('lastFactoid')
		.get();
	if (f.exists) return await db.collection('factoids').doc(f.data().id);
	else return undefined;
}
async function getLastFactoidData() {
	let f = await getLastFactoid();
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

async function setLastFactoid(id) {
	await db
		.collection('state')
		.doc('lastFactoid')
		.set({ id: id });
}

//returns a reference
async function getLastLearnedFactoid() {
	let f = await db
		.collection('state')
		.doc('lastLearnedFactoid')
		.get();
	if (f.exists) return await db.collection('factoids').doc(f.data().id);
	else return undefined;
}
async function getLastLearnedFactoidData() {
	let f = await getLastLearnedFactoid();
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

async function setLastLearnedFactoid(id) {
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
	return i <= percentage;
}

function getRandomElement(arr) {
	return arr[Math.floor(Math.random() * arr.length)];
}
