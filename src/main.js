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

const {
	incrementDocField,
	chance
} = require('./util.js');
const behaviors = require('./behaviors.js');

const client = new Discord.Client();

admin.initializeApp({
	// credential: admin.credential.cert(serviceAccount), //uncomment for local testing
	credential: admin.credential.applicationDefault(), //when deployed to GCP - comment for local testing
	databaseURL: secrets.dbUrl,
});
const db = admin.firestore();

client.on('ready', () => {
	console.log(`Logged in as ${client.user.tag}!`);

	const debugChannelIDs = Object.values(secrets.channels);
	const debugChannels = client.channels.filter(c => debugChannelIDs.includes(c.id));

	// '<@id1> <@id2> <@id3>'
	// 'I just restarted!'
	const adminIDs = Object.values(secrets.admins);
	const adminsPing = adminIDs.map(id => '<@' + id + '>').join(' ');
	const message = adminsPing + '\r\n' + 'I just restarted!';
	
	debugChannels.forEach(channel => channel.send(message));
});

client.on('message', msg => {
	messageReceived(msg);
});

client.login(secrets.bucketToken);

async function messageReceived(message) {
	if (!message.guild) return; //no DMs
	if (message.author.id === client.user.id) return;
	if (config.debug && !secrets.channels[message.channel.name]) return;

	//if I haven't seen this user before, add them to my database
	db.collection('users')
		.doc(message.author.id)
		.set({ name: message.author.username });
		
	if (!config.debug) learn(words);

	//check if mentioned
	const mentionBucketRegex = /^bucket[,:].*|.+, ?bucket[.?!]*$/i;
	const mentioned = message.isMentioned(client.user) || mentionBucketRegex.test(message.content);
	const silenced = await getSilencedState(db);
	
	const context = {
		message,
		db,
		client
	};

	const potential = behaviors
		.filter(b => mentioned && b.mentioned || !mentioned && b.nonmention)
		.filter(b => silenced && b.silenced || !silenced && !b.silent);

	const results = potential.map(b => ({
		action: b.action,
		data: await b.check(context)
	})).filter(r => chance(config.chances[r.name] || 100));

	const final = results.find(r => r.data);
	await final.action(context, final.data);
}

async function learn(words) {
	const w = words.filter(x => x);
	if (words.length < 3) return;

	for (let i = 0; i < w.length - 2; i++) {
		const docRef = db
			.collection('words')
			.doc(w[i])
			.collection(w[i + 1])
			.doc(w[i + 2]);
		incrementDocField(docRef, 'count', 1);
	}
}