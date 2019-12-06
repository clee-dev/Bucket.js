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
var validUrl = require('valid-url');

const secrets = require('./secrets.json');
// const serviceAccount = require('./serviceaccount_key.json'); //uncomment for local testing
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

	const debugChannelIDs = Object.values(secrets.channels);
	const debugChannels = client.channels.filter(c => debugChannelIDs.includes(c.id));

	// '<@id1> <@id2> <@id3>'
	// 'I just restarted!'
	const adminIDs = Object.values(secrets.admins);
	const adminsPing = adminIDs.map(id => '<@' + id + '>').join(' ');
	const message = adminsPing + '\r\n' +
					'I just restarted!';
	
	debugChannels.forEach(channel => channel.send(message));
});

client.on('message', msg => {
	messageReceived(msg);
});

client.login(secrets.bucketToken);

const regex = {
	punct: /[\?!.;'"():]+/gm,
	punctNoApostrophe: /[\?!.; "():]+/gm,
	words: /[^\w'-<>]+/gm,
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

async function messageReceived(message) {
	if (!message.guild) return; //no DMs

	let user = message.author;
	let channel = message.channel;
	let lower = message.content.toLowerCase();
	let words = getWords(lower);

	if (config.debug && !secrets.channels[channel.name]) return; //!secrets.admins[user.username]) return;
	if (message.author.id === client.user.id) return;

	//if I haven't seen this user before, add them to my database
	db.collection('users')
		.doc(user.id)
		.set({ name: user.username });

	//check if mentioned
	//"@Bucket *" || "bucket,*" || "bucket:*" || "*, bucket" || "*,bucket"
	const mentionBucketRegex = /^bucket[,:].*|.+, ?bucket$/;
	if (message.isMentioned(client.user) || mentionBucketRegex.test(lower)) {
		mentionedBy(message);
		return;
	}

	if (!config.debug) learn(words);

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
			if (
				inventory.length >= config.inventorySize * 2 ||
				(inventory.length >= config.inventorySize && chance(50))
			) {
				give = getRandomElement(inventory);
			}

			let giveStr = give ? `${chance(50) ? 'drops' : `gives ${user.username}`} ${give.name} and ` : '';
			let str =
				'*' + giveStr + getRandomElement(['now contains', 'is now carrying', 'is now holding']) + ` ${item}*`;
			channel.send(str);
			expUp(message, (sayAnything = true), (largeGain = false));

			db.collection('items')
				.doc(item)
				.set({ name: item, user: { id: user.id, username: user.username } });

			if (give) {
				db.collection('items')
					.doc(give.name)
					.delete();
			}
		}

		return;
	}

	//FACTOIDS
	let matchingFactoids = await detectedFactoids(lower);
	if (matchingFactoids.length) {
		processFactoid(matchingFactoids, message);
		return;
	}

	//*USES X*
	if ((lower.startsWith('*uses ') || lower.startsWith('_uses ')) && (lower.endsWith('*') || lower.endsWith('_'))) {
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

	//SWAPS
	if (words.length > 0) {
		//EX -> SEX
		if (words.some(x => x.startsWith('ex')) && chance(1)) {
			channel.send(message.content.replace('ex', 'sex').replace('Ex', 'Sex'));
			return;
		}

		//ELECT -> ERECT
		if (words.some(x => x.startsWith('elect')) && chance(1)) {
			channel.send(message.content.replace('elect', 'erect').replace('Elect', 'Erect'));
			return;
		}

		//THE FUCKING -> FUCKING THE
		if (lower.includes('the fucking') && chance(100)) {
			channel.send(message.content.replace('the fucking', 'fucking the'));
			return;
		}

		//THIS FUCKING -> FUCKING THIS
		if (lower.includes('this fucking') && chance(100)) {
			channel.send(message.content.replace('this fucking', 'fucking this'));
			return;
		}

		//sarcasm -> SArcAsM (2% CHANCE)
		//disabled because it happens way too much, even at 2%
		if (false && words.length <= 6 && chance(2)) {
			let sarcastic = client.emojis.find(emoji => emoji.name === 'sarcastic');
			channel.send(
				Array.from(lower)
					.map(x => (chance(50) ? x.toUpperCase() : x.toLowerCase()))
					.join('') + (sarcastic ? ` ${sarcastic}` : '')
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
	//disabled because not funny enough
	if (false && !message.embeds.length && words.some(x => syllable(x) >= 3) && chance(3)) {
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
	//discontinued until I build a better bad words regex
	if (false && !message.embeds.length && filter.isProfane(lower)) {
		//*takes a quarter | dime from ${user} and puts it in the swear jar*
		let coin = getRandomElement([{ name: 'quarter', value: 25 }, { name: 'dime', value: 10 }]);
		//represented in pennies because fuck javascript http://adripofjavascript.com/blog/drips/avoiding-problems-with-decimal-math-in-javascript.html

		incrementDocField(db.collection('swearjar').doc(user.id), 'total', coin.value);
		channel.send(`*takes a ${coin.name} from ${user.username} and puts it in the swear jar*`);
		return;
	}

	if (lower === 'buckety bucket') {
		channel.send(`${user.username}ity ${user.username}`);
		return;
	}

	//3-WORD TUMBLR
	//chance that a message with 3 words makes a link to 3words.tumblr.com
	if ((words.length === 3) & chance(3) && !hasDuplicates(words)) {
		//made up a % chance to trigger - XCKD Bucket has a config database entry for % chance
		channel.send(`https://${words.join('')}.tumblr.com`)
		return;
	}

	//GOOD BAND NAME
	//"[<phrase>|that] would [make|be] a [good|nice] name for a band."
	if ((words.length === 3) && chance(3) && !hasDuplicates(words)) {
		//made up a % chance to trigger - XCKD Bucket does something more complex

		let bandName = words.map(x => x[0].toUpperCase() + x.substring(1).toLowerCase()).join(' ');
		let tla = words.map(x => x[0].toUpperCase()).join('');
		let out =
			(chance(50) ? bandName : 'That') +
			' would ' +
			(chance(50) ? 'make' : 'be') +
			' a ' +
			(chance(50) ? 'good' : 'nice') +
			' name for a ' +
			(chance(50) ? 'rock ' : '') +
			'band.';
		channel.send(out);

		db.collection('bands')
			.doc(uuid())
			.set({ name: bandName, acronym: tla });
		return;
	}

	//TLA
	//"<TLA> could mean <band_name>"
	//TODO: figure out why this never happens?
	let TLA = words.find(
		x => x.length === 3 && x === x.toUpperCase()
	);
	if (TLA) {
		let bands = await db
			.collection('bands')
			.where('acronym', '==', TLA)
			.get();
		if (!bands.empty) {
			let meaning = getRandomElement(bands.docs).data().name;
			channel.send(`${TLA} could mean ${meaning}`);
			return;
		}
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
	let lower = content.toLowerCase();
	if (lower.startsWith('bucket') || content.startsWith(`<@${client.user.id}>`))
		lower = lower.substring(lower.indexOf(' ') + 1);
	else lower = lower.substring(0, lower.lastIndexOf(', bucket'));

	let words = getWords(lower);

	let silenced = await getSilencedState();

	//ADMIN FUNCTIONS
	if (secrets.admins[user.username]) {
		if (lower === 'inventory?') {
			let out = '';
			let inventory = await getInventory();
			inventory.forEach(item => {
				if (item.name.startsWith('his') || item.name.startsWith('her'))
					out += `${item.user.username}'s ${item.name.substring(4)}, `;
				else if (item.name.startsWith('their')) out += `${item.user.username}'s ${item.name.substring(6)}, `;
				else out += item.name + ', ';
			});
			out = out === '' ? "I don't have anything :(" : out.substring(0, out.length - 2);
			channel.send(out);
			return;
		}
	}

	let matchingFactoids;
	if (!message.embeds.length && words.length < 2 && lower[0] !== '`') {
		matchingFactoids = await detectedFactoids(lower);
		if (matchingFactoids.length) {
			processFactoid(matchingFactoids, message);
		} else {
			respondVaguely(message);
		}
		return;
	}

	if (filterNonWords(lower) === 'come back' && silenced) {
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
			expDown(message, (sayAnything = true), chance(50));
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
			expDown(message, (sayAnything = true), chance(50));
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

			if (chance(95)) learnNewFactoid(x, mid, y, user, channel);
			else channel.send(`Your mom is ${y}!`);
		}
		return;
	}

	if (words.length >= 2) {
		//being taught short factoids
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
			let users = Array.from(client.users).map(x => x[1]);
			let user = users.find(x => x.username.toLowerCase() === name);
			if (user) {
				let quotes = await db
					.collection('quotes')
					.where('user.username', '==', user.username)
					.get();
				if (!quotes.empty) {
					let quote = getRandomElement(quotes.docs).data().quote;
					channel.send(`${user.username}: ${quote}`);
					return;
				} else {
					channel.send(`I don't have any quotes for ${name}`);
					return;
				}
			}
		}

		if (words[0] === 'remember') {
			let users = Array.from(client.users).map(x => x[1]);
			let user = users.find(x => x.username.toLowerCase() === words[1]);
			if (user) {
				let messages = await channel.fetchMessages({ limit: 50 });
				messages = Array.from(messages)
					.map(x => x[1])
					.filter(x => x.id !== message.id)
					.filter(x => x.author.id === user.id)
					.filter(x =>
						x.content.toLowerCase().includes(
							content
								.toLowerCase()
								.substring(content.toLowerCase().indexOf(words[1]) + words[1].length + 1)
								.toLowerCase()
						)
					);
				console.log('MESSAGES');
				console.log(messages);
				if (messages.length) {
					let remember = messages[0].content;
					channel.send(`Okay, remembering ${user.username} said ${remember}`);
					db.collection('quotes')
						.doc(uuid())
						.set({ user: { id: user.id, username: user.username }, quote: remember });
					return;
				}
			}
		}
	}

	// needs to match:
	// 'i want a present'
	// 'give me a present'
	// 'give me a gift'
	// 'i want a gift'
	// allow punctuation after
	const giveItemRegex = /^(i want a|give me a) (present|gift)[.?!]*$/;
	if (giveItemRegex.test(lower)) {
		let inv = await getInventory();
		let give = getRandomElement(inv);

		channel.send(
			`*gives ${user.username} ${
				give.name.startsWith('his')
					? give.name.replace('his', give.user.username)
					: give.name.startsWith('her')
					? give.name.replace('her', give.user.username)
					: give.name.startsWith('their')
					? give.name.replace('their', give.user.username)
					: give.name
			}*`
		);
		db.collection('items')
			.doc(give.name)
			.delete();
		return;
	}

	if (lower.startsWith('do you know')) {
		channel.send('No, but if you hum a few bars I can fake it.');
		return;
	}

	if (lower.startsWith('how much is in the swear jar') && words.length === 7) {
		let swearjar = await db.collection('swearjar').get();
		let totalPennies = 0;
		if (!swearjar.empty) swearjar.docs.forEach(x => (totalPennies += x.data().total));

		channel.send(
			`The swear jar currently holds ${(totalPennies / 100).toLocaleString('en-US', {
				style: 'currency',
				currency: 'USD',
			})}`
		);
		return;
	}

	//process factoid
	matchingFactoids = await detectedFactoids(lower);
	if (matchingFactoids.length) {
		processFactoid(matchingFactoids, message);
		return;
	}

	//"this or that?"
	if (lower.includes(' or ')) {
		if (lower.startsWith('should i') || lower.startsWith('should we')) {
			lower = lower.substring(7);
			lower = lower.substring(lower.indexOf(' ') + 1);
		}
		lower = filterNonWords(lower);
		let X = lower.substring(0, lower.indexOf(' or '));
		let Y = lower.substring(lower.indexOf(' or ') + 4);
		channel.send(getRandomElement([X, Y]));
		return;
	}

	respondVaguely(message);
}

function respondVaguely(sourceMessage) {
	sourceMessage.channel.send(convertVars(sourceMessage, getRandomElement(vagueResponses)));
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
		channel.send(`Okay, ${user.username}${chance(50) ? ", I'll remember that." : ''}`);
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

async function processFactoid(matchingFactoids, message) {
	let middleRegex = /^[\^\_]/g;
	if (!chance(1)) matchingFactoids = matchingFactoids.filter(x => x.Middle.replace(middleRegex, '') !== 'swap');

	let lastFactoid = await getLastFactoidData();

	let factoid = getRandomElement(matchingFactoids);
	if (factoid === lastFactoid && matchingFactoids.length >= 2) factoid = getRandomElement(matchingFactoids); //this could be done better

	let channel = message.channel;
	let x = factoid.X;
	let mid = factoid.Middle;
	let y = factoid.Y;

	//remove starting _ or ^
	//TODO: Figure out what the "^" prefix does. Case-sensitivity maybe?
	switch (factoid.Middle.replace(middleRegex, '')) {
		case "'s":
			channel.send(`${x}'s ${convertVars(message, y)}`);
			setLastFactoid(factoid.id);
			break;
		case 'reply':
			channel.send(`${convertVars(message, y)}`);
			setLastFactoid(factoid.id);
			break;
		case 'action':
			channel.send(`*${convertVars(message, y)}*`);
			setLastFactoid(factoid.id);
			break;
		case 'swap':
			let r = new RegExp(escapeRegExp(x), 'gi');
			channel.send(`${message.content.replace(r, convertVars(message, y))}`);
			setLastFactoid(factoid.id);
			break;
		case 'is':
		case 'are':
		default:
			channel.send(`${x} ${mid} ${convertVars(message, y)}`);
			setLastFactoid(factoid.id);
			break;
	}
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

// https://stackoverflow.com/questions/7376598/in-javascript-how-do-i-check-if-an-array-has-duplicate-values
function hasDuplicates(array) {
	return new Set(array).size !== array.length;
}
