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
const admin = require('firebase-admin');

const secrets = require('./secrets.json');
const config = require('./config.json');
// const serviceAccount = require('./serviceaccount_key.json'); //uncomment for local testing
const shell = require('child_process').exec;

const {
	incrementDocField,
	chance,
	getWords,
	getSilencedState,
} = require('./util.js');
const behaviors = require('./behaviors.js');
const Logger = require('./log.js');

const client = new Discord.Client();
let logger;

admin.initializeApp({
	// credential: admin.credential.cert(serviceAccount), //uncomment for local testing
	credential: admin.credential.applicationDefault(), //when deployed to GCP - comment for local testing
	databaseURL: secrets.dbUrl,
});
const db = admin.firestore();

client.on('ready', () => {
	logger = new Logger(client, secrets.logChannels);

	// '<@id1> <@id2> <@id3>'
	// 'Logged in as <tag>'
	const adminIDs = Object.values(secrets.admins);
	const adminsPing = adminIDs.map(id => '<@' + id + '>').join(' ');
	shell('git log -1', (err, stdout) => {
		logger.log(adminsPing,`Logged in as ${client.user.tag}!`);
		logger.log('```' + stdout + '```');
	});
});

client.on('message', msg => {
	messageReceived(msg);
});

client.login(secrets.bucketToken);

async function messageReceived(message) {
	if (!message.guild) return; //no DMs
	if (message.author.id === client.user.id) return;
	if (config.debug && !secrets.debugChannels[message.channel.name]) return;

	logger.log(`${message.author.username}: ${message.content}`, message.channel);

	//if I haven't seen this user before, add them to my database
	db.collection('users')
		.doc(message.author.id)
		.set({ name: message.author.username });
		
	if (
		!config.debug &&
		!Object.keys(secrets.logChannels).includes(message.channel.id) &&
		!Object.keys(secrets.debugChannels).includes(message.channel.id)
	)
		learn(getWords(message.content));

	//check if mentioned
	const mentionBucketRegex = /^bucket[,:].*|.+, ?bucket[.?!]*$/i;
	const mentioned = message.isMentioned(client.user) || mentionBucketRegex.test(message.content);
	const silenced = await getSilencedState(db);
	
	const context = {
		message,
		db,
		client,
		log: (...a) => logger.logInner(...a)
	};
	const mentionContext = {
		message: {
			...message,
			content: removeMention(message.content)
		},
		db,
		client,
		log: (...a) => logger.logInner(...a)
	};

	const potential = behaviors
		.filter(b => mentioned && b.mention || !mentioned && b.nonmention)
		.filter(b => silenced && b.silent || !silenced && !b.silent);
  
	let results = [];
	for (const b of potential) {
		results.push({
			name: b.name,
			action: b.action,
			data: await b.check(mentioned ? mentionContext : context)
		});
	}
	results = results.filter(r => chance(config.chances[r.name] || 100));
	
	
	logger.logInner('POTENTIAL RESPONSES', results.map(x => x.name));

	const final = results.find(r => r.data);
	logger.logInner('FINAL RESPONSE', final && final.name);
	if (!final) return;

	logger.logInner('FINAL RESPONSE', final.name);
	await final.action(mentioned ? mentionContext : context, final.data);
}

function removeMention(content) {
	// TODO regexify
	if (content.toLowerCase().startsWith('bucket') || content.startsWith(`<@${client.user.id}>`) || content.startsWith(`<@!${client.user.id}>`))
		return content.substring(content.indexOf(' ') + 1);
	else
		return content.substring(0, content.toLowerCase().lastIndexOf(', bucket'));
}

async function learn(words) {
	if (words.length < 3) return;

	for (let i = 0; i < words.length - 2; i++) {
		const docRef = db
			.collection('words')
			.doc(words[i])
			.collection(words[i + 1])
			.doc(words[i + 2]);
		incrementDocField(docRef, 'count', 1);
	}
}
